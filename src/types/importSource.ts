import type { FitsHeader } from './fits'

/** One light or flat on the import source, as `scan_import_source` reads it. */
export interface ImportSourceFile {
  path: string
  filename: string
  sizeBytes: number
  kind: 'light' | 'flat'
  header: FitsHeader
}

export interface UnreadableFile {
  path: string
  error: string
}

export interface ImportSourceScan {
  files: ImportSourceFile[]
  unreadable: UnreadableFile[]
}

export interface CopyFailure {
  file: string
  error: string
}

/** What `copy_to_directory` returns. */
export interface CopyResult {
  copied: string[]
  skipped: string[]
  failed: CopyFailure[]
}
