// Mirrors the Rust IPC structs from Tasks 1-2 (src-tauri/src/wbpp_export.rs).
export type Placement = 'symlink' | 'hardlink' | 'copy'

export interface LinkCheck {
  ok: boolean
  reason: string | null
}

export interface PreflightResult {
  symlink: LinkCheck
  hardlink: LinkCheck
  freeBytes: number | null
}

export interface ExportProgress {
  current: number
  total: number
  filename: string
  placement: Placement | null
}

export interface ExportFailure {
  src: string
  error: string
}

export interface ExportResult {
  exportDir: string
  symlinked: number
  hardlinked: number
  copied: number
  failed: ExportFailure[]
  bytesCopied: number
  cancelled: boolean
}
