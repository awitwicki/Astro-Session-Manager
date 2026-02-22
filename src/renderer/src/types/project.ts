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
}

export interface FilterGroup {
  name: string
  path: string
  sessions: Session[]
  totalIntegrationSeconds: number
  totalLightFrames: number
  totalSizeBytes: number
}

export interface Session {
  date: string
  path: string
  lights: LightFrame[]
  flats: FlatFrame[]
  integrationSeconds: number
  totalSizeBytes: number
  calibration: CalibrationMatch
}

export interface LightFrame {
  filename: string
  path: string
  sizeBytes: number
  header?: FitsHeader
  thumbnailPath?: string
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
