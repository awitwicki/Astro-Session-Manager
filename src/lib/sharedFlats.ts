import type { FilterGroup, FitsHeader, Project, Session, SharedFlatSet } from '../types'
import { isMasterFlat } from './calibration'
import { isDslrFile } from './dslrUtils'
import { nightDateFor, parseDateObs } from './wbppExport'

/** Header fields that decide whether two sessions shot through the same
 *  optical train. `instrume`, `filter` and `resolution` are required and
 *  compared exactly; the rest are compared only when both sides report them. */
export interface FlatIdentity {
  instrume: string
  filter: string
  resolution: string
  binning: string | null
  focalLen: number | null
  focRatio: number | null
}

const norm = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim().toLowerCase().replace(/\s+/g, ' ') : null

const positive = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Focal length and f-ratio are not in `FitsHeader`'s typed fields. */
const rawPositive = (h: FitsHeader, key: string): number | null => positive(h.raw?.[key])

/** Null when a required field is missing — such a session neither offers nor
 *  borrows. Nothing is ever guessed from the filename. */
export function flatIdentity(h: FitsHeader | null | undefined): FlatIdentity | null {
  if (!h) return null
  const instrume = norm(h.instrume)
  const filter = norm(h.filter)
  if (!instrume || !filter || !h.naxis1 || !h.naxis2) return null
  const xb = positive(h.xbinning)
  const yb = positive(h.ybinning)
  return {
    instrume,
    filter,
    resolution: `${h.naxis1}x${h.naxis2}`,
    binning: xb !== null && yb !== null ? `${xb}x${yb}` : null,
    focalLen: rawPositive(h, 'FOCALLEN'),
    focRatio: rawPositive(h, 'FOCRATIO'),
  }
}

/** The required, exactly-compared fields, for bucketing the index. */
export function identityKey(id: FlatIdentity): string {
  return [id.instrume, id.filter, id.resolution].join('\u0000')
}

/** A 0.8× reducer moves the focal length ~20 %; 2 % absorbs rounding. */
const FOCAL_TOLERANCE = 0.02

const withinTolerance = (a: number | null, b: number | null): boolean =>
  a === null || b === null || Math.abs(a - b) <= Math.max(a, b) * FOCAL_TOLERANCE

export function identityCompatible(a: FlatIdentity, b: FlatIdentity): boolean {
  if (identityKey(a) !== identityKey(b)) return false
  if (a.binning !== null && b.binning !== null && a.binning !== b.binning) return false
  return withinTolerance(a.focalLen, b.focalLen) && withinTolerance(a.focRatio, b.focRatio)
}

/** The observing night, as `nightDateFor` computes it for WBPP's `NIGHT_`
 *  folders. A date-named session folder already names the night, so the 12 h
 *  shift must not be applied to it a second time. */
export function nightKeyFor(
  header: FitsHeader | null | undefined,
  session: { date: string; subsDateRange: string | null },
): string {
  const observed = parseDateObs(header?.dateObs)
  if (observed) return nightDateFor([observed], session.date)
  const folder = /^(\d{4}-\d{2}-\d{2})/.exec(session.date)
  if (folder) return folder[1]
  const span = /^(\d{4}-\d{2}-\d{2})/.exec(session.subsDateRange ?? '')
  if (span) return span[1]
  return nightDateFor([], session.date)
}

/** An offerable set plus the fields only the resolver needs. */
export interface FlatSetCandidate extends SharedFlatSet {
  identity: FlatIdentity
  /** `takenAt` as epoch milliseconds, when known. */
  takenAtMs: number | null
}

/** Offerable flat sets bucketed by night + exactly-compared identity. */
export type FlatIndex = Map<string, FlatSetCandidate[]>

const bucketKey = (nightDate: string, id: FlatIdentity) => `${nightDate}\u0000${identityKey(id)}`

/** The set a session can lend: its stacked master flat when it has one (what
 *  its own export uses by default), else its raw flats. Identity and time come
 *  from the first raw flat when there is one — the scanner reads that header,
 *  and a stack can lose `FILTER`/`INSTRUME`. Null when it has nothing to lend
 *  or no usable header. */
export function offerableFlats(
  project: Project,
  filter: FilterGroup,
  session: Session,
): FlatSetCandidate | null {
  if (session.flats.length === 0) return null
  const raw = session.flats.filter((f) => !isMasterFlat(f.filename))
  const master = session.flats.filter((f) => isMasterFlat(f.filename))
  const flats = master.length > 0 ? master.slice(0, 1) : raw
  const source = raw[0] ?? master[0]
  if (isDslrFile(source.filename)) return null
  const header = source.header
  const identity = flatIdentity(header)
  if (!identity) return null
  const takenAt = header?.dateObs ?? null
  return {
    projectName: project.name,
    projectPath: project.path,
    filterName: filter.name,
    sessionDate: session.date,
    sessionPath: session.path,
    nightDate: nightKeyFor(header, session),
    isMaster: master.length > 0,
    flats,
    takenAt,
    identity,
    takenAtMs: parseDateObs(takenAt)?.getTime() ?? null,
  }
}

export function buildFlatIndex(projects: Project[]): FlatIndex {
  const index: FlatIndex = new Map()
  for (const project of projects) {
    for (const filter of project.filters) {
      for (const session of filter.sessions) {
        const candidate = offerableFlats(project, filter, session)
        if (!candidate) continue
        const key = bucketKey(candidate.nightDate, candidate.identity)
        const bucket = index.get(key)
        if (bucket) bucket.push(candidate)
        else index.set(key, [candidate])
      }
    }
  }
  return index
}

/** Same project first, then the flats shot closest to the lights, then the
 *  larger set. Total order, so rebuilds pick the same set every time. */
function compareCandidates(projectPath: string, lightMs: number | null) {
  const foreign = (c: FlatSetCandidate) => (c.projectPath === projectPath ? 0 : 1)
  const gap = (c: FlatSetCandidate) =>
    lightMs !== null && c.takenAtMs !== null ? Math.abs(c.takenAtMs - lightMs) : Number.POSITIVE_INFINITY
  return (a: FlatSetCandidate, b: FlatSetCandidate): number => {
    const ga = gap(a)
    const gb = gap(b)
    return (
      foreign(a) - foreign(b) ||
      (ga === gb ? 0 : ga < gb ? -1 : 1) ||
      b.flats.length - a.flats.length ||
      a.sessionPath.localeCompare(b.sessionPath)
    )
  }
}

/** The best set another session can lend this one, or null. Only sessions
 *  with no flats of their own borrow. */
export function findSharedFlats(
  project: Project,
  _filter: FilterGroup,
  session: Session,
  index: FlatIndex,
): SharedFlatSet | null {
  if (session.flats.length > 0 || session.lights.length === 0) return null
  const first = session.lights[0]
  if (isDslrFile(first.filename)) return null
  const identity = flatIdentity(first.header)
  if (!identity) return null
  const bucket = index.get(bucketKey(nightKeyFor(first.header, session), identity))
  if (!bucket) return null
  const usable = bucket.filter((c) => c.sessionPath !== session.path && identityCompatible(c.identity, identity))
  if (usable.length === 0) return null
  const lightMs = parseDateObs(first.header?.dateObs)?.getTime() ?? null
  const best = [...usable].sort(compareCandidates(project.path, lightMs))[0]
  // Built field by field so the resolver's bookkeeping never leaks into the store.
  return {
    projectName: best.projectName,
    projectPath: best.projectPath,
    filterName: best.filterName,
    sessionDate: best.sessionDate,
    sessionPath: best.sessionPath,
    nightDate: best.nightDate,
    isMaster: best.isMaster,
    flats: best.flats,
    takenAt: best.takenAt,
  }
}

/** Resolves a borrowed flat set for every session, and clears any that no
 *  longer resolves. Unlike `applyCalibration` this needs no masters library. */
export function applySharedFlats(projects: Project[]): Project[] {
  const index = buildFlatIndex(projects)
  return projects.map((project) => ({
    ...project,
    filters: project.filters.map((filter) => ({
      ...filter,
      sessions: filter.sessions.map((session) => {
        const shared = findSharedFlats(project, filter, session, index)
        if (!shared && !session.calibration.sharedFlats) return session
        const calibration = { ...session.calibration }
        if (shared) calibration.sharedFlats = shared
        else delete calibration.sharedFlats
        return { ...session, calibration }
      }),
    })),
  }))
}
