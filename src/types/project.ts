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

export interface CalibrationMatch {
  darksMatched: boolean
  darkGroupName?: string
  darkCount?: number
  biasCount?: number
  flatsAvailable: boolean
  flatCount?: number
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
