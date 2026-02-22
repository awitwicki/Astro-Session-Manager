import type { ElectronAPI } from '../../../preload/index'

declare const __APP_VERSION__: string

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
