import type { FitsHeader, MastersLibrary, Project, SubAnalysisResult } from '../types'
import type { Placement, PreflightResult } from '../types/wbppExport'
import { isMasterFlat, matchDarkFlats, matchMasters } from './calibration'
import { isDslrFile } from './dslrUtils'
import { moonInfo, separationDeg } from './ephemeris'
import { extractCoordinates } from './skymap'

// Headers store CCD-TEMP as float32 (-20.1 arrives as -20.1000003814697).
const tempText = (c: number) => `${Math.round(c * 10) / 10 || 0} °C`

export type ExportKind = 'light' | 'flat' | 'sharedFlat' | 'masterFlat' | 'masterDark' | 'masterDarkFlat' | 'masterBias' | 'dark' | 'bias'
export type CalKind = Exclude<ExportKind, 'light'>

export interface FileRef {
  path: string
  filename: string
  sizeBytes: number
}

/** A flat set borrowed from another session of the same observing night. */
export interface SharedFlatNode {
  /** `<source project> / <source session>`, for the chip and the warning. */
  label: string
  isMaster: boolean
  files: FileRef[]
}

export interface FrameRow extends FileRef {
  dateObs: string | null
  moonSepDeg: number | null
  moonIllum: number | null
  moonAltDeg: number | null
  fwhm: number | null
  ecc: number | null
}

export interface NightNode {
  /** The session folder path — unique per night within a project. */
  key: string
  sessionName: string
  /** Value of the WBPP `NIGHT_` keyword. */
  nightDate: string
  exposure: number | null
  ccdTemp: number | null
  isDslr: boolean
  frames: FrameRow[]
  masterFlat: FileRef | null
  rawFlats: FileRef[]
  /** Null unless the night has no flats of its own and a match was resolved. */
  sharedFlats: SharedFlatNode | null
  darks: FileRef[]
  biases: FileRef[]
  masterDark: FileRef | null
  masterDarkFlat: FileRef | null
  masterBias: FileRef | null
  /** Exposure of the first raw flat, when known. */
  flatExposure: number | null
}

export interface FilterNode {
  name: string
  /** Value of the WBPP `FILTER_` keyword. */
  keyword: string
  nights: NightNode[]
  /** At least one frame has sub-frame analysis results. */
  analyzed: boolean
}

export interface MoonContext {
  targetRa: number
  targetDec: number
  lat: number
  lon: number
}

const HOUR_MS = 3_600_000

/** FITS DATE-OBS is UTC; capture software usually omits the zone. */
export function parseDateObs(s: string | null | undefined): Date | null {
  if (!s || !s.trim()) return null
  const trimmed = s.trim()
  const hasZone = /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(trimmed)
  const d = new Date(hasZone ? trimmed : `${trimmed}Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

/** WBPP splits path tokens `KEY_VALUE` on `_`, so values keep only [A-Za-z0-9-]. */
export function sanitizeKeywordValue(s: string): string {
  const v = s.replace(/[^A-Za-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return v || 'unknown'
}

/** Observing night: earliest exposure minus 12 h, so a session crossing
 *  midnight keeps one date. Without timestamps, the session folder name. */
export function nightDateFor(dates: Date[], sessionName: string): string {
  if (dates.length === 0) return sanitizeKeywordValue(sessionName)
  const earliest = Math.min(...dates.map((d) => d.getTime()))
  return new Date(earliest - 12 * HOUR_MS).toISOString().slice(0, 10)
}

export function resolveMoonContext(
  project: Project,
  headers: Record<string, FitsHeader | null>,
  lat: number | null,
  lon: number | null,
): { ctx: MoonContext | null; reason: string | null } {
  for (const f of project.filters) {
    for (const s of f.sessions) {
      for (const l of s.lights) {
        const h = headers[l.path] ?? l.header
        if (!h?.raw) continue
        const c = extractCoordinates(h.raw, h.naxis1, h.naxis2)
        if (!c) continue
        // The site the frames were shot from beats the saved home location.
        const siteLat = rawNumber(h.raw.SITELAT)
        const siteLon = rawNumber(h.raw.SITELONG)
        const useSite = siteLat !== null && siteLon !== null
        const obsLat = useSite ? siteLat : lat
        const obsLon = useSite ? siteLon : lon
        if (obsLat === null || obsLon === null) return { ctx: null, reason: 'set your location in Settings' }
        return { ctx: { targetRa: c.ra, targetDec: c.dec, lat: obsLat, lon: obsLon }, reason: null }
      }
    }
  }
  return { ctx: null, reason: 'no target coordinates in FITS headers' }
}

function rawNumber(v: string | number | boolean | undefined): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

const ref = (f: { path: string; filename: string; sizeBytes: number }): FileRef => ({
  path: f.path,
  filename: f.filename,
  sizeBytes: f.sizeBytes,
})

/** Two different filter names can sanitize to the same keyword (e.g. "Hα"/"Hβ"
 *  both become "H"). WBPP groups purely by the FILTER_<keyword> folder name,
 *  so a collision would silently merge two different filters into one
 *  calibration group. Compared case-insensitively (APFS/NTFS both commonly
 *  fold case); every collision after the first gets `-2`, `-3`, … */
function disambiguateFilterKeywords(filters: FilterNode[]): FilterNode[] {
  const seen = new Map<string, number>()
  return filters.map((f) => {
    const lower = f.keyword.toLowerCase()
    const count = (seen.get(lower) ?? 0) + 1
    seen.set(lower, count)
    return count === 1 ? f : { ...f, keyword: `${f.keyword}-${count}` }
  })
}

export function buildExportTree(input: {
  project: Project
  headers: Record<string, FitsHeader | null>
  subAnalysis: Record<string, SubAnalysisResult>
  moon: MoonContext | null
  library: MastersLibrary | null
  tempTolerance: number
}): FilterNode[] {
  const { project, headers, subAnalysis, moon, library, tempTolerance } = input
  const filters = project.filters.map((filter) => {
    const nights: NightNode[] = filter.sessions
      .filter((s) => s.lights.length > 0)
      .map((s) => {
        const dates: Date[] = []
        const frames: FrameRow[] = s.lights.map((l) => {
          const h = headers[l.path] ?? l.header ?? null
          const dateObs = h?.dateObs ?? null
          const start = parseDateObs(dateObs)
          if (start) dates.push(start)
          let moonSepDeg: number | null = null
          let moonIllum: number | null = null
          let moonAltDeg: number | null = null
          if (moon && start) {
            const mid = new Date(start.getTime() + ((h?.exptime ?? 0) * 1000) / 2)
            const m = moonInfo(mid, moon.lat, moon.lon)
            moonSepDeg = separationDeg(moon.targetRa, moon.targetDec, m.raDeg, m.decDeg)
            moonIllum = m.illumination
            moonAltDeg = m.alt
          }
          const a = subAnalysis[l.path]
          return {
            ...ref(l),
            dateObs,
            moonSepDeg,
            moonIllum,
            moonAltDeg,
            fwhm: a?.medianFwhm ?? null,
            ecc: a?.medianEccentricity ?? null,
          }
        })
        const first = headers[s.lights[0].path] ?? s.lights[0].header ?? null
        const isDslr = isDslrFile(s.lights[0].filename)
        const match = isDslr ? null : matchMasters(first, library, tempTolerance)
        const masterFlat = s.flats.find((f) => isMasterFlat(f.filename))
        const rawFlats = s.flats.filter((f) => !isMasterFlat(f.filename))
        const shared = s.flats.length === 0 ? (s.calibration.sharedFlats ?? null) : null
        const sharedFlats: SharedFlatNode | null = shared
          ? {
              label: `${shared.projectName} / ${shared.sessionDate}`,
              isMaster: shared.isMaster,
              files: shared.flats.map(ref),
            }
          : null
        // A borrowed raw set still needs its darkflat, and supplies the flat exposure.
        const sharedRawHeader = shared && !shared.isMaster ? (shared.flats[0]?.header ?? null) : null
        const flatHeader = rawFlats[0]?.header ?? sharedRawHeader
        const darkFlat = isDslr ? null : matchDarkFlats(flatHeader, first, library, tempTolerance)?.[0]
        return {
          key: s.path,
          sessionName: s.date,
          nightDate: nightDateFor(dates, s.date),
          exposure: first?.exptime ?? null,
          ccdTemp: first?.ccdTemp ?? null,
          isDslr,
          frames,
          masterFlat: masterFlat ? ref(masterFlat) : null,
          rawFlats: rawFlats.map(ref),
          sharedFlats,
          darks: s.darks.map(ref),
          biases: s.biases.map(ref),
          masterDark: match?.darks[0] ? ref(match.darks[0]) : null,
          masterDarkFlat: darkFlat ? ref(darkFlat) : null,
          masterBias: match?.biases[0] ? ref(match.biases[0]) : null,
          flatExposure: flatHeader?.exptime ?? null,
        }
      })
    return {
      name: filter.name,
      keyword: sanitizeKeywordValue(filter.name),
      nights,
      analyzed: nights.some((n) => n.frames.some((f) => f.fwhm !== null)),
    }
  })
  return disambiguateFilterKeywords(filters)
}

/** `<Project>_WBPP_<local yyyy-mm-dd>`; characters illegal in folder names become `-`. */
export function exportFolderName(projectName: string, today: Date): string {
  const safe = projectName.replace(/[/\\:*?"<>|]/g, '-').trim() || 'Project'
  const pad = (n: number) => String(n).padStart(2, '0')
  const date = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
  return `${safe}_WBPP_${date}`
}

export interface ExportSettings {
  include: Record<ExportKind, boolean>
  moonCutoffEnabled: boolean
  moonMinSepDeg: number
  moonOnlyAboveHorizon: boolean
  fwhmMax: number | null
  eccMax: number | null
  destinationParent: string | null
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  include: { light: true, flat: true, sharedFlat: false, masterFlat: true, masterDark: true, masterDarkFlat: true, masterBias: false, dark: false, bias: false },
  moonCutoffEnabled: false,
  moonMinSepDeg: 30,
  moonOnlyAboveHorizon: true,
  fwhmMax: null,
  eccMax: null,
  destinationParent: null,
}

const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Stored settings (unknown JSON) merged over defaults, keeping only known keys. */
export function mergeSettings(saved: unknown): ExportSettings {
  const d = DEFAULT_EXPORT_SETTINGS
  if (!saved || typeof saved !== 'object') return { ...d, include: { ...d.include } }
  const s = saved as Record<string, unknown>
  const inc = (s.include && typeof s.include === 'object' ? s.include : {}) as Record<string, unknown>
  const include = { ...d.include }
  for (const k of Object.keys(include) as ExportKind[]) {
    if (typeof inc[k] === 'boolean') include[k] = inc[k] as boolean
  }
  return {
    include,
    moonCutoffEnabled: typeof s.moonCutoffEnabled === 'boolean' ? s.moonCutoffEnabled : d.moonCutoffEnabled,
    moonMinSepDeg: numOrNull(s.moonMinSepDeg) ?? d.moonMinSepDeg,
    moonOnlyAboveHorizon: typeof s.moonOnlyAboveHorizon === 'boolean' ? s.moonOnlyAboveHorizon : d.moonOnlyAboveHorizon,
    fwhmMax: numOrNull(s.fwhmMax),
    eccMax: numOrNull(s.eccMax),
    destinationParent: typeof s.destinationParent === 'string' ? s.destinationParent : null,
  }
}

export interface ExportSelection {
  /** Night keys (session paths) switched off entirely. */
  disabledNights: string[]
  /** Per-frame manual include (true) / exclude (false); beats cutoffs. */
  frameOverrides: Record<string, boolean>
  /** Per-night calibration toggles overriding the global include flags. */
  nightCal: Record<string, Partial<Record<CalKind, boolean>>>
}

export const EMPTY_SELECTION: ExportSelection = { disabledNights: [], frameOverrides: {}, nightCal: {} }

/** Why a cutoff removes this frame, or null if none applies. Frames without
 *  Moon or analysis data are never cut by that criterion. */
export function frameExclusion(row: FrameRow, settings: ExportSettings): string | null {
  if (
    settings.moonCutoffEnabled &&
    row.moonSepDeg !== null &&
    row.moonSepDeg < settings.moonMinSepDeg &&
    !(settings.moonOnlyAboveHorizon && row.moonAltDeg !== null && row.moonAltDeg <= 0)
  ) {
    return `Moon ${Math.round(row.moonSepDeg)}°`
  }
  if (settings.fwhmMax !== null && row.fwhm !== null && row.fwhm > settings.fwhmMax) {
    return `FWHM ${row.fwhm.toFixed(1)}`
  }
  if (settings.eccMax !== null && row.ecc !== null && row.ecc > settings.eccMax) {
    return `Ecc ${row.ecc.toFixed(2)}`
  }
  return null
}

export function isFrameIncluded(row: FrameRow, night: NightNode, settings: ExportSettings, selection: ExportSelection): boolean {
  if (!settings.include.light) return false
  if (selection.disabledNights.includes(night.key)) return false
  const override = selection.frameOverrides[row.path]
  if (override !== undefined) return override
  return frameExclusion(row, settings) === null
}

export function calFiles(night: NightNode, kind: CalKind): FileRef[] {
  switch (kind) {
    case 'flat': return night.rawFlats
    case 'sharedFlat': return night.sharedFlats?.files ?? []
    case 'masterFlat': return night.masterFlat ? [night.masterFlat] : []
    case 'masterDark': return night.masterDark ? [night.masterDark] : []
    case 'masterDarkFlat': return night.masterDarkFlat ? [night.masterDarkFlat] : []
    case 'masterBias': return night.masterBias ? [night.masterBias] : []
    case 'dark': return night.darks
    case 'bias': return night.biases
  }
}

export function calEnabled(night: NightNode, kind: CalKind, settings: ExportSettings, selection: ExportSelection): boolean {
  const override = selection.nightCal[night.key]?.[kind]
  if (override !== undefined) return override
  if (!settings.include[kind]) return false
  // A stacked master flat replaces the raw flats unless asked otherwise.
  if (kind === 'flat' && night.masterFlat && settings.include.masterFlat) return false
  // Darkflats calibrate raw flats; a stacked master flat already used them.
  if (kind === 'masterDarkFlat') {
    const ownRawOut = calEnabled(night, 'flat', settings, selection) && night.rawFlats.length > 0
    const sharedRawOut =
      calEnabled(night, 'sharedFlat', settings, selection) &&
      night.sharedFlats !== null &&
      !night.sharedFlats.isMaster
    return ownRawOut || sharedRawOut
  }
  return true
}

export interface PlanEntry {
  src: string
  relDst: string
  kind: ExportKind
  sizeBytes: number
}

function uniqueDst(dir: string, filename: string, used: Set<string>): string {
  let candidate = `${dir}/${filename}`
  const dot = filename.lastIndexOf('.')
  const stem = dot > 0 ? filename.slice(0, dot) : filename
  const ext = dot > 0 ? filename.slice(dot) : ''
  for (let n = 1; used.has(candidate.toLowerCase()); n++) candidate = `${dir}/${stem}_${n}${ext}`
  used.add(candidate.toLowerCase())
  return candidate
}

const CAL_ORDER: CalKind[] = ['masterFlat', 'flat', 'sharedFlat', 'masterDark', 'masterDarkFlat', 'masterBias', 'dark', 'bias']

function calDir(kind: CalKind, nightKw: string, filterKw: string): string {
  switch (kind) {
    case 'flat':
    case 'sharedFlat':
    case 'masterFlat': return `Flats/${nightKw}/${filterKw}`
    case 'masterDark':
    case 'masterDarkFlat': return 'Darks' // WBPP groups darks by exposure, so a darkflat pairs with the flats
    case 'masterBias': return 'Bias'
    case 'dark': return `Darks/${nightKw}`
    case 'bias': return `Bias/${nightKw}`
  }
}

export function buildPlan(tree: FilterNode[], settings: ExportSettings, selection: ExportSelection): PlanEntry[] {
  const plan: PlanEntry[] = []
  // Keyed by destination folder + source, so a master dark reused by several
  // nights lands once in Darks/ while a shared flat set lands once per night.
  const placed = new Set<string>()
  const usedDst = new Set<string>()
  const add = (file: FileRef, dir: string, kind: ExportKind) => {
    const key = `${dir}\u0000${file.path}`
    if (placed.has(key)) return
    placed.add(key)
    plan.push({ src: file.path, relDst: uniqueDst(dir, file.filename, usedDst), kind, sizeBytes: file.sizeBytes })
  }
  for (const filter of tree) {
    const filterKw = `FILTER_${filter.keyword}`
    for (const night of filter.nights) {
      const lights = night.frames.filter((f) => isFrameIncluded(f, night, settings, selection))
      if (lights.length === 0) continue
      const nightKw = `NIGHT_${night.nightDate}`
      for (const l of lights) add(l, `Lights/${nightKw}/${filterKw}`, 'light')
      for (const kind of CAL_ORDER) {
        if (!calEnabled(night, kind, settings, selection)) continue
        for (const f of calFiles(night, kind)) add(f, calDir(kind, nightKw, filterKw), kind)
      }
    }
  }
  return plan
}

export function predictPlacement(preflight: PreflightResult | null): Placement | null {
  if (!preflight) return null
  if (preflight.symlink.ok) return 'symlink'
  if (preflight.hardlink.ok) return 'hardlink'
  return 'copy'
}

/** Links take no data blocks; an unknown placement is costed as a copy. */
export function estimateSize(plan: PlanEntry[], placement: Placement | null): { sourceBytes: number; diskBytes: number } {
  const sourceBytes = plan.reduce((sum, e) => sum + e.sizeBytes, 0)
  const linked = placement === 'symlink' || placement === 'hardlink'
  return { sourceBytes, diskBytes: linked ? 0 : sourceBytes }
}

export function countByKind(plan: PlanEntry[]): Record<ExportKind, number> {
  const counts: Record<ExportKind, number> = { light: 0, flat: 0, sharedFlat: 0, masterFlat: 0, masterDark: 0, masterDarkFlat: 0, masterBias: 0, dark: 0, bias: 0 }
  for (const e of plan) counts[e.kind]++
  return counts
}

export function exportWarnings(
  tree: FilterNode[],
  settings: ExportSettings,
  selection: ExportSelection,
  moonReason: string | null,
  opts: { warnMissingDarkFlat?: boolean } = {},
): string[] {
  const warnings: string[] = []
  if (settings.moonCutoffEnabled && moonReason) warnings.push(`Moon filter unavailable: ${moonReason}`)
  let undated = 0
  for (const filter of tree) {
    for (const night of filter.nights) {
      const lights = night.frames.filter((f) => isFrameIncluded(f, night, settings, selection))
      if (lights.length === 0) continue
      const label = `${night.sessionName} / ${filter.name}`
      const hasFlats = (['masterFlat', 'flat', 'sharedFlat'] as const).some(
        (k) => calEnabled(night, k, settings, selection) && calFiles(night, k).length > 0,
      )
      if (!hasFlats) {
        const available = night.sharedFlats?.files.length ?? 0
        warnings.push(
          available > 0
            ? `${label}: no flats — ${available} shared flat${available === 1 ? '' : 's'} available from ${night.sharedFlats!.label}`
            : `${label}: no flats`,
        )
      }
      if (settings.include.masterDark && !night.masterDark && !night.isDslr) {
        warnings.push(
          night.exposure !== null && night.ccdTemp !== null
            ? `${label}: no master dark matches ${night.exposure} s @ ${tempText(night.ccdTemp)}`
            : `${label}: no master dark match (exposure or temperature unknown)`,
        )
      }
      const rawFlatsOut =
        (calEnabled(night, 'flat', settings, selection) && night.rawFlats.length > 0) ||
        (calEnabled(night, 'sharedFlat', settings, selection) && night.sharedFlats !== null && !night.sharedFlats.isMaster)
      if ((opts.warnMissingDarkFlat ?? true) && rawFlatsOut && !night.masterDarkFlat && !night.isDslr) {
        const what = [
          night.flatExposure !== null ? `${night.flatExposure} s` : null,
          night.ccdTemp !== null ? tempText(night.ccdTemp) : null,
        ].filter(Boolean).join(' @ ')
        warnings.push(`${label}: raw flats but no master darkflat matches ${what || '(exposure and temperature unknown)'}`)
      }
      if (settings.moonCutoffEnabled && !moonReason) undated += lights.filter((f) => f.moonSepDeg === null).length
    }
  }
  if (undated > 0) warnings.push(`${undated} frame${undated === 1 ? '' : 's'} without DATE-OBS — Moon filter not applied`)
  return warnings
}
