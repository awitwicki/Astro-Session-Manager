export const IPC_CHANNELS = {
  SCANNER_SELECT_ROOT: 'scanner:selectRootFolder',
  SCANNER_SCAN_ROOT: 'scanner:scanRoot',
  SCANNER_FILE_CHANGED: 'scanner:fileChanged',

  FITS_READ_HEADER: 'fits:readHeader',
  FITS_READ_PIXEL_DATA: 'fits:readPixelData',
  FITS_BATCH_READ_HEADERS: 'fits:batchReadHeaders',

  XISF_READ_HEADER: 'xisf:readHeader',

  THUMBNAIL_GENERATE: 'thumbnail:generate',
  THUMBNAIL_BATCH_GENERATE: 'thumbnail:batchGenerate',
  THUMBNAIL_GET_CACHED: 'thumbnail:getCached',
  THUMBNAIL_PROGRESS: 'thumbnail:progress',

  MASTERS_SCAN: 'masters:scan',
  MASTERS_FIND_MATCH: 'masters:findMatch',

  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_GET_ALL: 'settings:getAll',

  DIALOG_OPEN_FOLDER: 'dialog:openFolder',

  FILE_DELETE: 'file:delete',
  FILE_MOVE_TO_TRASH: 'file:moveToTrash'
} as const
