import { useEffect } from 'react'
import {
  FileOutput,
  FolderOpen,
  FilePlus,
  FolderPlus,
  Play,
  X,
  Trash2,
  Check,
  AlertCircle,
  Loader,
  SkipForward,
  Ban,
} from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'
import { useAppStore } from '../store/appStore'
import type { ConverterFile } from '../store/appStore'
import { formatFileSize } from '../lib/formatters'
import '../styles/converter.css'

interface RawFileInfo {
  path: string
  filename: string
  sizeBytes: number
  format: string
}

interface ConversionProgress {
  current: number
  total: number
  filename: string
  sourcePath: string
  success: boolean
  skipped: boolean
  error: string | null
}

export function Converter() {
  const files = useAppStore((s) => s.converterFiles)
  const outputPath = useAppStore((s) => s.converterOutputPath)
  const isConverting = useAppStore((s) => s.isConverting)
  const addFiles = useAppStore((s) => s.addConverterFiles)
  const removeFile = useAppStore((s) => s.removeConverterFile)
  const clearFiles = useAppStore((s) => s.clearConverterFiles)
  const setOutputPath = useAppStore((s) => s.setConverterOutputPath)
  const setFileStatus = useAppStore((s) => s.setConverterFileStatus)
  const setIsConverting = useAppStore((s) => s.setIsConverting)

  // Load persisted output path on mount
  useEffect(() => {
    invoke<string | null>('get_setting', { key: 'converterOutputPath' })
      .then((val) => {
        if (val && typeof val === 'string') setOutputPath(val)
      })
      .catch(() => {})
  }, [setOutputPath])

  // Listen for progress events (match by sourcePath, no dependency on files)
  useEffect(() => {
    const unlisten = listen<ConversionProgress>('converter-progress', (event) => {
      const p = event.payload
      if (p.skipped) {
        setFileStatus(p.sourcePath, 'skipped')
      } else if (p.success) {
        setFileStatus(p.sourcePath, 'done')
      } else {
        setFileStatus(p.sourcePath, 'error', p.error ?? 'Unknown error')
      }
    })

    return () => {
      unlisten.then((fn) => fn())
    }
  }, [setFileStatus])

  const handleSelectOutputPath = async () => {
    const selected = await open({ directory: true, multiple: false })
    if (selected) {
      setOutputPath(selected)
      invoke('set_setting', {
        key: 'converterOutputPath',
        value: selected,
      }).catch(() => {})
    }
  }

  const handleAddFiles = async () => {
    const selected = await open({
      multiple: true,
      filters: [
        {
          name: 'DSLR Raw Files',
          extensions: ['cr2', 'cr3', 'arw', 'CR2', 'CR3', 'ARW'],
        },
      ],
    })
    if (!selected) return

    const paths = Array.isArray(selected) ? selected : [selected]
    const newFiles: ConverterFile[] = paths.map((p) => {
      const parts = p.replace(/\\/g, '/').split('/')
      const filename = parts[parts.length - 1]
      const ext = filename.split('.').pop()?.toUpperCase() ?? 'CR2'
      return {
        path: p,
        filename,
        format: ext as ConverterFile['format'],
        sizeBytes: 0,
        status: 'pending' as const,
      }
    })
    addFiles(newFiles)
  }

  const handleAddFolder = async () => {
    const selected = await open({ directory: true, multiple: false })
    if (!selected) return

    try {
      const rawFiles = await invoke<RawFileInfo[]>('scan_raw_files', {
        dir: selected,
      })
      const newFiles: ConverterFile[] = rawFiles.map((f) => ({
        path: f.path,
        filename: f.filename,
        format: f.format as ConverterFile['format'],
        sizeBytes: f.sizeBytes,
        status: 'pending' as const,
      }))
      addFiles(newFiles)
    } catch (err) {
      console.error('Failed to scan folder:', err)
    }
  }

  const handleConvert = async () => {
    if (!outputPath || files.length === 0) return

    setIsConverting(true)

    // Only send files that still need conversion
    const pendingFiles = files.filter(
      (f) => f.status !== 'done' && f.status !== 'skipped'
    )

    try {
      await invoke('convert_dslr_to_fits', {
        files: pendingFiles.map((f) => f.path),
        outputDir: outputPath,
      })
    } catch (err) {
      console.error('Conversion failed:', err)
    } finally {
      setIsConverting(false)
    }
  }

  const handleCancel = () => {
    invoke('cancel_operation', { operation: 'convert' }).catch(() => {})
  }

  const completedCount = files.filter(
    (f) => f.status === 'done' || f.status === 'skipped'
  ).length
  const totalCount = files.length

  const statusIcon = (file: ConverterFile) => {
    switch (file.status) {
      case 'pending':
        return null
      case 'converting':
        return <Loader size={14} className="spinning" />
      case 'done':
        return <Check size={14} className="text-success" />
      case 'skipped':
        return <SkipForward size={14} className="text-warning" />
      case 'error':
        return (
          <span title={file.error}>
            <AlertCircle size={14} className="text-error" />
          </span>
        )
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>
          <FileOutput size={22} /> DSLR to FITS Converter (experimental)
        </h1>
      </div>

      {/* Output path */}
      <div className="converter-section">
        <label className="converter-label">Output Directory</label>
        <div className="converter-path-row">
          <span className="converter-path">
            {outputPath ?? 'No directory selected'}
          </span>
          <button
            className="btn"
            onClick={handleSelectOutputPath}
            disabled={isConverting}
          >
            <FolderOpen size={14} />
            Browse
          </button>
        </div>
      </div>

      {/* File actions */}
      <div className="converter-section">
        <div className="converter-actions-row">
          <button
            className="btn"
            onClick={handleAddFiles}
            disabled={isConverting}
          >
            <FilePlus size={14} />
            Add Files
          </button>
          <button
            className="btn"
            onClick={handleAddFolder}
            disabled={isConverting}
          >
            <FolderPlus size={14} />
            Add Folder
          </button>
          {files.length > 0 && (
            <button
              className="btn"
              onClick={clearFiles}
              disabled={isConverting}
            >
              <Trash2 size={14} />
              Clear All
            </button>
          )}
        </div>
      </div>

      {/* File table */}
      {files.length > 0 ? (
        <div className="converter-table-wrapper">
          <table className="converter-table">
            <thead>
              <tr>
                <th>Filename</th>
                <th>Format</th>
                <th>Size</th>
                <th>Status</th>
                <th>Remove from list</th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.path}>
                  <td className="converter-filename">{f.filename}</td>
                  <td>{f.format}</td>
                  <td>{f.sizeBytes > 0 ? formatFileSize(f.sizeBytes) : '—'}</td>
                  <td className="converter-status">
                    {statusIcon(f)}
                    <span>{f.status}</span>
                  </td>
                  <td>
                    {!isConverting && (
                      <button
                        className="btn-icon"
                        onClick={() => removeFile(f.path)}
                        title="Remove"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="converter-empty">
          <FileOutput size={48} strokeWidth={1} />
          <p>Add DSLR raw files (CR2, CR3, ARW) to convert to FITS format</p>
        </div>
      )}

      {/* Convert / Cancel button + progress */}
      <div className="converter-section converter-bottom">
        {isConverting && (
          <div className="converter-progress">
            <div className="converter-progress-bar">
              <div
                className="converter-progress-fill"
                style={{
                  width: `${totalCount > 0 ? (completedCount / totalCount) * 100 : 0}%`,
                }}
              />
            </div>
            <span className="converter-progress-text">
              {completedCount} / {totalCount}
            </span>
          </div>
        )}
        <div className="converter-actions-row">
          {isConverting ? (
            <button className="btn btn-danger" onClick={handleCancel}>
              <Ban size={14} />
              Cancel
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={handleConvert}
              disabled={files.length === 0 || !outputPath}
            >
              <Play size={14} />
              Convert
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
