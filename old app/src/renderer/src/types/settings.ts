export interface AppSettings {
  rootFolder: string | null
  theme: 'dark' | 'light'
  cachePath: string
  thumbnailSize: number
  darkTempTolerance: number
  autoScanOnStartup: boolean
  windowBounds: WindowBounds
}

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}
