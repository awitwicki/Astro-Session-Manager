import type { FitsHeader } from './fits'

export interface Project {
  name: string
  path: string
  filters: FilterGroup[]
  totalIntegrationSeconds: number
  totalLightFrames: number
  totalFlatFrames: number
  totalSizeBytes: number
  lastCaptureDate: string | null
  hasNotes: boolean
}

export interface OtherFileEntry {
  name: string
  path: string
  sizeBytes: number
  isDir: boolean
}

export interface FilterGroup {
  name: string
  path: string
  sessions: Session[]
  otherFiles: OtherFileEntry[]
  totalIntegrationSeconds: number
  totalLightFrames: number
  totalSizeBytes: number
  hasNotes: boolean
}

export interface Session {
  date: string
  path: string
  lights: LightFrame[]
  flats: FlatFrame[]
  darks: LightFrame[]
  biases: LightFrame[]
  integrationSeconds: number
  totalSizeBytes: number
  calibration: CalibrationMatch
  hasNotes: boolean
  subsDateRange: string | null
}

export interface LightFrame {
  filename: string
  path: string
  sizeBytes: number
  header?: FitsHeader
}

export interface FlatFrame {
  filename: string
  path: string
  sizeBytes: number
  header?: FitsHeader
}

/** A flat set borrowed from another session of the same observing night and
 *  the same optical train. Resolved in `src/lib/sharedFlats.ts`. */
export interface SharedFlatSet {
  /** Project the flats physically live in. */
  projectName: string
  projectPath: string
  /** Filter-group folder name in the source project. */
  filterName: string
  /** Source session folder name. */
  sessionDate: string
  sessionPath: string
  /** Observing night both sessions resolve to. */
  nightDate: string
  /** True when the set is a single stacked `masterFlat_*`. */
  isMaster: boolean
  flats: FlatFrame[]
  /** DATE-OBS of the first flat, for the tooltip. */
  takenAt: string | null
}

export interface CalibrationMatch {
  darksMatched: boolean
  darkGroupName?: string
  darkCount?: number
  biasCount?: number
  darkFlatMatched?: boolean
  darkFlatName?: string
  rawFlatCount?: number
  flatsAvailable: boolean
  flatCount?: number
  /** Set only when the session has no flats of its own and a match exists. */
  sharedFlats?: SharedFlatSet
}

export interface SubAnalysisResult {
  medianFwhm: number
  medianEccentricity: number
  starsDetected: number
}

export interface StarDetail {
  x: number
  y: number
  fwhm: number
  eccentricity: number
}

export interface StarsDetailResult {
  stars: StarDetail[]
  imageWidth: number
  imageHeight: number
  medianFwhm: number
}
