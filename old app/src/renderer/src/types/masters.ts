export interface MasterFileEntry {
  filename: string
  path: string
  sizeBytes: number
  format: 'fits' | 'fit' | 'fts' | 'xisf'
  exposureTime: number
  ccdTemp: number | null
  binning: number | null
  resolution: string | null
  camera: string
  tempSource: 'header' | 'filename' | 'unknown'
}

export interface MastersLibrary {
  darks: MasterFileEntry[]
  biases: MasterFileEntry[]
  rootPath: string
}
