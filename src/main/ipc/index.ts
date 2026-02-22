import { registerSettingsHandler } from './settingsHandler'
import { registerDialogHandler } from './dialogHandler'
import { registerFileScanner } from './fileScanner'
import { registerFitsParser } from './fitsParser'
import { registerXisfParser } from './xisfParser'
import { registerThumbnailGenerator } from './thumbnailGenerator'
import { registerMastersManager } from './mastersManager'
import { registerCacheManager } from './cacheManager'

export function registerAllHandlers(): void {
  registerSettingsHandler()
  registerDialogHandler()
  registerFileScanner()
  registerFitsParser()
  registerXisfParser()
  registerThumbnailGenerator()
  registerMastersManager()
  registerCacheManager()
}
