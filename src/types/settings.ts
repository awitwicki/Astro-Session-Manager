export interface AppSettings {
  rootFolder: string | null
  theme: 'dark' | 'light'
  darkTempTolerance: number
  autoScanOnStartup: boolean
}
