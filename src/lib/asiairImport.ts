import type { FilterGroup, FitsHeader, Project } from '../types'
import type { ImportSourceFile, ImportSourceScan, UnreadableFile } from '../types/importSource'
import { isDslrFile } from './dslrUtils'
import { separationDeg } from './ephemeris'
import { flatIdentity, identityCompatible, nightKeyFor, type FlatIdentity } from './sharedFlats'
import { extractCoordinates } from './skymap'
import { nightDateFor, parseDateObs } from './wbppExport'

/** Same tolerance as masters matching. */
export const EXPOSURE_TOLERANCE_S = 0.5
/** Subs of one target in one night stay within this of the first sub. */
export const GROUP_RADIUS_DEG = 0.5
/** A project folder is a candidate only when its latest lights are this close. */
export const MATCH_RADIUS_DEG = 1
/** Candidates this close to the nearest one count as the same distance, so
 *  exposure and FILTER can separate UV/IR-cut 30 s from dual-band 180 s on
 *  one target while mosaic panels a panel-width apart still split. */
export const DISTANCE_TIE_DEG = 0.2

export interface GroupingOptions {
  matchTemperature: boolean
  /** `darkTempTolerance`, °C. */
  tempTolerance: number
}

const fileKey = (filename: string, sizeBytes: number) => `${filename}\u0000${sizeBytes}`

/** Source files not already in the library. ASIAIR filenames carry a
 *  timestamp, so name + size identifies a sub without reading it. */
export function newFiles(files: ImportSourceFile[], projects: Project[]): ImportSourceFile[] {
  const known = new Set<string>()
  for (const p of projects)
    for (const f of p.filters)
      for (const s of f.sessions)
        for (const x of [...s.lights, ...s.flats]) known.add(fileKey(x.filename, x.sizeBytes))
  return files.filter((f) => !known.has(fileKey(f.filename, f.sizeBytes)))
}

const norm = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim().toLowerCase().replace(/\s+/g, ' ') : null

/** `FILTER` compared exactly; a missing one is its own value. */
export const filterKey = (h: FitsHeader | null | undefined): string => norm(h?.filter) ?? ''

/** The shared-flats optical-train identity without FILTER, plus TELESCOP. */
export interface Rig {
  identity: FlatIdentity
  telescop: string | null
}

export function rigOf(h: FitsHeader | null | undefined): Rig | null {
  const identity = flatIdentity(h)
  if (!identity) return null
  return { identity: { ...identity, filter: '' }, telescop: norm(h?.telescop) }
}

export function rigCompatible(a: Rig, b: Rig): boolean {
  return identityCompatible(a.identity, b.identity)
    && (a.telescop === null || b.telescop === null || a.telescop === b.telescop)
}

export interface LightGroup {
  /** Stable within one proposal: `light:<night>:<index>`. */
  id: string
  nightKey: string
  /** FILTER as written by the first sub, for display; '' when none. */
  filter: string
  exposure: number
  ccdTemp: number | null
  ra: number
  dec: number
  rig: Rig
  /** First sub's header — the group's reference for matching. */
  header: FitsHeader
  firstDateObs: string
  files: ImportSourceFile[]
  sizeBytes: number
}

export interface FlatGroup {
  id: string
  nightKey: string
  filter: string
  identity: FlatIdentity
  header: FitsHeader
  firstDateObs: string
  files: ImportSourceFile[]
  sizeBytes: number
}

const byDate = <T extends { date: Date; file: ImportSourceFile }>(a: T, b: T) =>
  a.date.getTime() - b.date.getTime() || a.file.path.localeCompare(b.file.path)

const nightOf = (date: Date) => nightDateFor([date], '')

const tempsAgree = (a: number | null, b: number | null, opts: GroupingOptions) =>
  !opts.matchTemperature || a === null || b === null || Math.abs(a - b) <= opts.tempTolerance

/** Buckets new lights by night, FILTER, exposure, temperature, position and
 *  rig. Subs without DATE-OBS, coordinates, EXPTIME or a rig identity cannot
 *  be placed and are only counted. */
export function groupLights(
  files: ImportSourceFile[],
  opts: GroupingOptions,
): { groups: LightGroup[]; unplaceable: number } {
  let unplaceable = 0
  const placed: { file: ImportSourceFile; date: Date; ra: number; dec: number; rig: Rig; exposure: number }[] = []
  for (const file of files) {
    if (file.kind !== 'light') continue
    const h = file.header
    const date = parseDateObs(h.dateObs)
    const coords = extractCoordinates(h.raw ?? {}, h.naxis1, h.naxis2)
    const rig = rigOf(h)
    if (!date || !coords || !rig || typeof h.exptime !== 'number') {
      unplaceable++
      continue
    }
    placed.push({ file, date, ra: coords.ra, dec: coords.dec, rig, exposure: h.exptime })
  }
  placed.sort(byDate)

  const groups: LightGroup[] = []
  for (const p of placed) {
    const nightKey = nightOf(p.date)
    const fk = filterKey(p.file.header)
    const temp = p.file.header.ccdTemp ?? null
    const g = groups.find((g) =>
      g.nightKey === nightKey
      && filterKey(g.header) === fk
      && Math.abs(g.exposure - p.exposure) <= EXPOSURE_TOLERANCE_S
      && tempsAgree(g.ccdTemp, temp, opts)
      && separationDeg(g.ra, g.dec, p.ra, p.dec) <= GROUP_RADIUS_DEG
      && rigCompatible(g.rig, p.rig))
    if (g) {
      g.files.push(p.file)
      g.sizeBytes += p.file.sizeBytes
      // The first known temperature becomes the group's, so a sub without
      // CCD-TEMP cannot bridge two set points.
      if (g.ccdTemp === null && temp !== null) g.ccdTemp = temp
      continue
    }
    groups.push({
      id: `light:${nightKey}:${groups.length}`,
      nightKey,
      filter: p.file.header.filter?.trim() ?? '',
      exposure: p.exposure,
      ccdTemp: temp,
      ra: p.ra,
      dec: p.dec,
      rig: p.rig,
      header: p.file.header,
      firstDateObs: p.file.header.dateObs ?? '',
      files: [p.file],
      sizeBytes: p.file.sizeBytes,
    })
  }
  return { groups, unplaceable }
}

/** Flats by night and optical train (FILTER included). ASIAIR flats carry no
 *  meaningful pointing, so position plays no part. */
export function groupFlats(files: ImportSourceFile[]): { groups: FlatGroup[]; unplaceable: number } {
  let unplaceable = 0
  const placed: { file: ImportSourceFile; date: Date; identity: FlatIdentity }[] = []
  for (const file of files) {
    if (file.kind !== 'flat') continue
    const date = parseDateObs(file.header.dateObs)
    const identity = flatIdentity(file.header)
    if (!date || !identity) {
      unplaceable++
      continue
    }
    placed.push({ file, date, identity })
  }
  placed.sort(byDate)

  const groups: FlatGroup[] = []
  for (const p of placed) {
    const nightKey = nightOf(p.date)
    const g = groups.find((g) => g.nightKey === nightKey && identityCompatible(g.identity, p.identity))
    if (g) {
      g.files.push(p.file)
      g.sizeBytes += p.file.sizeBytes
      continue
    }
    groups.push({
      id: `flat:${nightKey}:${groups.length}`,
      nightKey,
      filter: p.file.header.filter?.trim() ?? '',
      identity: p.identity,
      header: p.file.header,
      firstDateObs: p.file.header.dateObs ?? '',
      files: [p.file],
      sizeBytes: p.file.sizeBytes,
    })
  }
  return { groups, unplaceable }
}

export interface FolderRef {
  projectPath: string
  projectName: string
  filterPath: string
  filterName: string
}

export interface FolderCandidate {
  folder: FolderRef
  separation: number
  exposureMatch: boolean
  filterMatch: boolean
}

/** The scanner shows only `Night <n>` folders (`scanner.rs` `is_night_session`). */
export function nightNumber(name: string): number | null {
  const m = /^night\s*(\d+)$/i.exec(name.trim())
  return m ? Number(m[1]) : null
}

/** First-light header of the folder's latest session: by DATE-OBS, then by
 *  Night number (sessions sort as strings, so `Night 10` < `Night 9`). */
export function folderReference(filter: FilterGroup): FitsHeader | null {
  let best: { header: FitsHeader; time: number; night: number } | null = null
  for (const s of filter.sessions) {
    const first = s.lights[0]
    if (!first?.header || isDslrFile(first.filename)) continue
    const time = parseDateObs(first.header.dateObs)?.getTime() ?? Number.NEGATIVE_INFINITY
    const night = nightNumber(s.date) ?? 0
    if (!best || time > best.time || (time === best.time && night > best.night)) {
      best = { header: first.header, time, night }
    }
  }
  return best?.header ?? null
}

const preference = (c: FolderCandidate) => (c.exposureMatch ? 0 : 2) + (c.filterMatch ? 0 : 1)

/** Folders whose latest lights are within 1° on a compatible rig. The nearest
 *  ones (within `DISTANCE_TIE_DEG` of the closest) come first, ordered by
 *  exposure match, then FILTER match, then distance; the rest by distance. */
export function rankFolders(group: LightGroup, projects: Project[]): FolderCandidate[] {
  const candidates: FolderCandidate[] = []
  for (const project of projects) {
    for (const filter of project.filters) {
      const ref = folderReference(filter)
      const rig = rigOf(ref)
      const coords = ref ? extractCoordinates(ref.raw ?? {}, ref.naxis1, ref.naxis2) : null
      if (!ref || !rig || !coords || !rigCompatible(group.rig, rig)) continue
      const separation = separationDeg(group.ra, group.dec, coords.ra, coords.dec)
      if (separation > MATCH_RADIUS_DEG) continue
      candidates.push({
        folder: { projectPath: project.path, projectName: project.name, filterPath: filter.path, filterName: filter.name },
        separation,
        exposureMatch: typeof ref.exptime === 'number' && Math.abs(ref.exptime - group.exposure) <= EXPOSURE_TOLERANCE_S,
        filterMatch: filterKey(ref) === filterKey(group.header),
      })
    }
  }
  if (candidates.length === 0) return []
  const nearest = Math.min(...candidates.map((c) => c.separation))
  const isNear = (c: FolderCandidate) => c.separation - nearest <= DISTANCE_TIE_DEG
  return candidates.sort((a, b) =>
    Number(!isNear(a)) - Number(!isNear(b))
    || (isNear(a) ? preference(a) - preference(b) : 0)
    || a.separation - b.separation
    || a.folder.filterPath.localeCompare(b.folder.filterPath))
}

export type FolderProposal =
  | { status: 'matched'; folder: FolderRef }
  | { status: 'ambiguous' }
  | { status: 'unmatched' }

/** Ambiguous when the top two are near, equally preferred, and in different
 *  projects — e.g. the same target shot again under a new project. */
export function proposeFolder(group: LightGroup, projects: Project[]): FolderProposal {
  const ranked = rankFolders(group, projects)
  if (ranked.length === 0) return { status: 'unmatched' }
  const [top, next] = ranked
  if (next
    && next.separation - top.separation <= DISTANCE_TIE_DEG
    && preference(next) === preference(top)
    && next.folder.projectPath !== top.folder.projectPath) {
    return { status: 'ambiguous' }
  }
  return { status: 'matched', folder: top.folder }
}

export interface LightRow {
  id: string
  group: LightGroup
  include: boolean
  folder: FolderRef | null
  /** `Night <n>`; '' while the row has no folder or is excluded. */
  sessionName: string
  /** Set once the user types a name; auto-numbering then leaves it alone. */
  nameEdited: boolean
}

export type FlatDestination =
  | { kind: 'row'; rowId: string }
  | { kind: 'session'; sessionPath: string; label: string }
  | { kind: 'skip' }

export interface FlatRow {
  id: string
  group: FlatGroup
  destination: FlatDestination
}

export interface ImportProposal {
  /** Chronological. */
  lightRows: LightRow[]
  flatRows: FlatRow[]
  /** Subs that cannot be placed or match no project, plus flats of nights
   *  with no light row. */
  unmatchedCount: number
  unreadable: UnreadableFile[]
}

const activeRow = (r: LightRow): r is LightRow & { folder: FolderRef } => r.include && r.folder !== null

/** `Night <max + 1>` per folder, in night order. A night the folder already
 *  has a session for (an interrupted import being topped up) reuses that
 *  session once. Edited names are kept and raise the folder's maximum so
 *  later rows number past them. */
export function assignSessionNames(rows: LightRow[], projects: Project[]): LightRow[] {
  const max = new Map<string, number>()
  const existingNight = new Map<string, string>()
  for (const p of projects)
    for (const f of p.filters)
      for (const s of f.sessions) {
        max.set(f.path, Math.max(max.get(f.path) ?? 0, nightNumber(s.date) ?? 0))
        const first = s.lights[0]
        if (nightNumber(s.date) !== null && first?.header?.dateObs && !isDslrFile(first.filename)) {
          const key = `${f.path}\u0000${nightKeyFor(first.header, s)}`
          if (!existingNight.has(key)) existingNight.set(key, s.date)
        }
      }
  for (const r of rows) {
    if (activeRow(r) && r.nameEdited) {
      const n = nightNumber(r.sessionName)
      if (n !== null) max.set(r.folder.filterPath, Math.max(max.get(r.folder.filterPath) ?? 0, n))
    }
  }
  const order = rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => a.r.group.firstDateObs.localeCompare(b.r.group.firstDateObs) || a.i - b.i)
  const names = new Map<string, string>()
  const reused = new Set<string>()
  for (const { r } of order) {
    if (!activeRow(r)) {
      // A typed name outlives unticking, so ticking the row again restores it.
      names.set(r.id, r.nameEdited ? r.sessionName : '')
      continue
    }
    if (r.nameEdited) {
      names.set(r.id, r.sessionName)
      continue
    }
    const key = `${r.folder.filterPath}\u0000${r.group.nightKey}`
    const existing = existingNight.get(key)
    if (existing && !reused.has(key)) {
      reused.add(key)
      names.set(r.id, existing)
      continue
    }
    const n = (max.get(r.folder.filterPath) ?? 0) + 1
    max.set(r.folder.filterPath, n)
    names.set(r.id, `Night ${n}`)
  }
  return rows.map((r) => ({ ...r, sessionName: names.get(r.id) ?? '' }))
}

/** The earliest same-night active row with the same FILTER and rig, else skip. */
export function proposeFlatDestination(group: FlatGroup, rows: LightRow[]): FlatDestination {
  const rig = rigOf(group.header)
  const match = rows
    .filter((r) => activeRow(r)
      && r.group.nightKey === group.nightKey
      && filterKey(r.group.header) === filterKey(group.header)
      && rig !== null && rigCompatible(r.group.rig, rig))
    .sort((a, b) => a.group.firstDateObs.localeCompare(b.group.firstDateObs))[0]
  return match ? { kind: 'row', rowId: match.id } : { kind: 'skip' }
}

/** Applies edited light rows: renumbers, and re-proposes any flat set whose
 *  destination row is no longer imported. */
export function withLightRows(p: ImportProposal, rows: LightRow[], projects: Project[]): ImportProposal {
  const named = assignSessionNames(rows, projects)
  const active = new Set(named.filter(activeRow).map((r) => r.id))
  const flatRows = p.flatRows.map((f) =>
    f.destination.kind === 'row' && !active.has(f.destination.rowId)
      ? { ...f, destination: proposeFlatDestination(f.group, named) }
      : f)
  return { ...p, lightRows: named, flatRows }
}

export function buildProposal(scan: ImportSourceScan, projects: Project[], opts: GroupingOptions): ImportProposal {
  const fresh = newFiles(scan.files, projects)
  const lights = groupLights(fresh, opts)
  const flats = groupFlats(fresh)
  let unmatchedCount = lights.unplaceable + flats.unplaceable

  const rows: LightRow[] = []
  for (const group of lights.groups) {
    const proposal = proposeFolder(group, projects)
    if (proposal.status === 'unmatched') {
      unmatchedCount += group.files.length
      continue
    }
    rows.push({
      id: group.id,
      group,
      include: proposal.status === 'matched',
      folder: proposal.status === 'matched' ? proposal.folder : null,
      sessionName: '',
      nameEdited: false,
    })
  }
  const lightRows = assignSessionNames(rows, projects)

  const nights = new Set(lightRows.map((r) => r.group.nightKey))
  const flatRows: FlatRow[] = []
  for (const group of flats.groups) {
    if (!nights.has(group.nightKey)) {
      unmatchedCount += group.files.length
      continue
    }
    flatRows.push({ id: group.id, group, destination: proposeFlatDestination(group, lightRows) })
  }
  return { lightRows, flatRows, unmatchedCount, unreadable: scan.unreadable }
}

export interface RowIssue {
  level: 'error' | 'warning'
  message: string
}

/** Keyed by light- or flat-row id. Any `error` blocks Import. */
export function validateProposal(p: ImportProposal, projects: Project[]): Map<string, RowIssue> {
  const issues = new Map<string, RowIssue>()
  const sessionsOf = new Map<string, string[]>()
  for (const pr of projects) for (const f of pr.filters) sessionsOf.set(f.path, f.sessions.map((s) => s.date))

  const destinations = new Map<string, string[]>()
  for (const r of p.lightRows) {
    if (!r.include) continue
    if (!r.folder) {
      issues.set(r.id, { level: 'error', message: 'Pick a project and folder' })
      continue
    }
    if (nightNumber(r.sessionName) === null) {
      issues.set(r.id, { level: 'error', message: 'Session names must look like "Night 5"' })
      continue
    }
    const key = `${r.folder.filterPath}\u0000${r.sessionName.trim().toLowerCase()}`
    destinations.set(key, [...(destinations.get(key) ?? []), r.id])
    const existing = (sessionsOf.get(r.folder.filterPath) ?? []).find((s) => s.toLowerCase() === r.sessionName.trim().toLowerCase())
    if (existing) issues.set(r.id, { level: 'warning', message: `Adds to existing ${existing}` })
  }
  for (const ids of destinations.values()) {
    if (ids.length < 2) continue
    for (const id of ids) issues.set(id, { level: 'error', message: 'Two rows import into the same session' })
  }
  const active = new Set(p.lightRows.filter(activeRow).map((r) => r.id))
  for (const f of p.flatRows) {
    if (f.destination.kind === 'row' && !active.has(f.destination.rowId)) {
      issues.set(f.id, { level: 'error', message: 'Its destination row is not being imported' })
    }
  }
  return issues
}

export interface PlannedSession {
  rowId: string
  filterPath: string
  sessionName: string
  /** Only the subfolders this import fills — no empty `flats/`. */
  subfolders: ('lights' | 'flats')[]
}

export interface PlannedCopy {
  files: string[]
  target: { rowId: string } | { sessionPath: string }
  sub: 'lights' | 'flats'
  label: string
}

const rowLabel = (r: LightRow & { folder: FolderRef }) => `${r.folder.projectName} / ${r.folder.filterName} / ${r.sessionName.trim()}`

/** Sessions to create, then copies into them (or into an existing session). */
export function planImport(p: ImportProposal): { sessions: PlannedSession[]; copies: PlannedCopy[] } {
  const rows = p.lightRows.filter(activeRow)
  const byId = new Map(rows.map((r) => [r.id, r]))
  // Trimmed: the scanner's `^night\s*\d+$` is not, so a stray space would hide the session.
  const copies: PlannedCopy[] = rows.map((r) => ({
    files: r.group.files.map((f) => f.path),
    target: { rowId: r.id },
    sub: 'lights',
    label: `Lights → ${rowLabel(r)}`,
  }))
  for (const f of p.flatRows) {
    const files = f.group.files.map((x) => x.path)
    if (f.destination.kind === 'row') {
      const row = byId.get(f.destination.rowId)
      if (row) copies.push({ files, target: { rowId: row.id }, sub: 'flats', label: `Flats → ${rowLabel(row)}` })
    } else if (f.destination.kind === 'session') {
      copies.push({ files, target: { sessionPath: f.destination.sessionPath }, sub: 'flats', label: `Flats → ${f.destination.label}` })
    }
  }
  const sessions = rows.map((r): PlannedSession => ({
    rowId: r.id,
    filterPath: r.folder.filterPath,
    sessionName: r.sessionName.trim(),
    subfolders: copies.some((c) => c.sub === 'flats' && 'rowId' in c.target && c.target.rowId === r.id) ? ['lights', 'flats'] : ['lights'],
  }))
  return { sessions, copies }
}

export function proposalTotals(p: ImportProposal): { nights: number; sessions: number; files: number; bytes: number } {
  const rows = p.lightRows.filter(activeRow)
  const active = new Set(rows.map((r) => r.id))
  const flats = p.flatRows.filter((f) =>
    f.destination.kind === 'session' || (f.destination.kind === 'row' && active.has(f.destination.rowId)))
  const groups = [...rows.map((r) => r.group), ...flats.map((f) => f.group)]
  return {
    nights: new Set(rows.map((r) => r.group.nightKey)).size,
    sessions: rows.length,
    files: groups.reduce((n, g) => n + g.files.length, 0),
    bytes: groups.reduce((n, g) => n + g.sizeBytes, 0),
  }
}
