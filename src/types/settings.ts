export interface AppSettings {
  rootFolder: string | null
  theme: 'dark' | 'light'
  cachePath: string
  thumbnailSize: number
  darkTempTolerance: number
  autoScanOnStartup: boolean
}
