import { useEffect, useState } from 'react'
import { Database, Plus, FolderOpen, Pencil, AlertTriangle, X } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { formatFileSize, formatTemperature, formatExposure } from '../lib/formatters'
import type { MastersLibrary as MastersLibraryType, MasterFileEntry } from '../types'

function generateProperFilename(
  type: 'darks' | 'biases',
  entry: MasterFileEntry,
  overrideTemp?: number
): string {
  const prefix = type === 'darks' ? 'masterDark' : 'masterBias'
  const temp = overrideTemp ?? entry.ccdTemp
  const tempStr =
    temp !== null ? `${temp >= 0 ? '+' : ''}${temp}C` : 'undefinedC'
  const binStr = `BIN-${entry.binning ?? 1}`
  const resStr = entry.resolution ?? 'unknown'

  let name = `${prefix}_${tempStr}_${binStr}_${resStr}`
  if (type === 'darks' && entry.exposureTime > 0) {
    name += `_EXPOSURE-${entry.exposureTime.toFixed(2)}s`
  }
  return `${name}.${entry.format}`
}

export function MastersLibrary() {
  const mastersLibrary = useAppStore((s) => s.mastersLibrary)
  const setMastersLibrary = useAppStore((s) => s.setMastersLibrary)
  const rootFolder = useAppStore((s) => s.rootFolder)

  const [importing, setImporting] = useState(false)
  const [scanning, setScanning] = useState(false)

  // Import modal state
  const [importModal, setImportModal] = useState<{
    type: 'darks' | 'biases'
    files: string[]
    temperature: string
  } | null>(null)

  // Rename modal state
  const [renameModal, setRenameModal] = useState<{
    entry: MasterFileEntry
    type: 'darks' | 'biases'
    temperature: string
    newFilename: string
  } | null>(null)

  useEffect(() => {
    if (rootFolder && !mastersLibrary) {
      setScanning(true)
      window.electronAPI.masters
        .scan()
        .then((data) => {
          setMastersLibrary(data as MastersLibraryType)
        })
        .catch(() => {})
        .finally(() => setScanning(false))
    }
  }, [rootFolder, mastersLibrary, setMastersLibrary])

  const rescanMasters = async (): Promise<void> => {
    setScanning(true)
    try {
      const data = await window.electronAPI.masters.scan()
      setMastersLibrary(data as MastersLibraryType)
    } catch {
      // scan failed
    } finally {
      setScanning(false)
    }
  }

  const openImportDialog = async (type: 'darks' | 'biases'): Promise<void> => {
    if (!rootFolder) return
    const files = await window.electronAPI.dialog.openFiles({
      title: type === 'darks' ? 'Import Dark Frames' : 'Import Bias Frames',
      filters: [
        { name: 'FITS/XISF files', extensions: ['fits', 'fit', 'fts', 'xisf'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (files.length === 0) return
    setImportModal({ type, files, temperature: '-20' })
  }

  const handleImport = async (): Promise<void> => {
    if (!importModal) return
    const temp = parseInt(importModal.temperature)
    if (isNaN(temp)) return

    setImporting(true)
    setImportModal(null)
    try {
      await window.electronAPI.masters.import({
        files: importModal.files,
        type: importModal.type,
        ccdTemp: temp
      })
      await rescanMasters()
    } finally {
      setImporting(false)
    }
  }

  const openRenameModal = (entry: MasterFileEntry, type: 'darks' | 'biases'): void => {
    const tempStr = entry.ccdTemp !== null ? String(entry.ccdTemp) : ''
    const newFilename = generateProperFilename(type, entry)
    setRenameModal({ entry, type, temperature: tempStr, newFilename })
  }

  const updateRenameTemp = (tempStr: string): void => {
    if (!renameModal) return
    const temp = parseInt(tempStr)
    const newFilename = generateProperFilename(
      renameModal.type,
      renameModal.entry,
      isNaN(temp) ? undefined : temp
    )
    setRenameModal({ ...renameModal, temperature: tempStr, newFilename })
  }

  const handleRename = async (): Promise<void> => {
    if (!renameModal) return
    const dir = renameModal.entry.path.replace(
      renameModal.entry.filename,
      ''
    )
    const newPath = dir + renameModal.newFilename
    try {
      await window.electronAPI.file.rename({
        oldPath: renameModal.entry.path,
        newPath
      })
      setRenameModal(null)
      await rescanMasters()
    } catch {
      // rename failed
    }
  }

  if (!rootFolder) {
    return (
      <div className="empty-state">
        <Database size={64} />
        <h3>No Root Folder</h3>
        <p>Select a root folder to view the masters library.</p>
      </div>
    )
  }

  if (!mastersLibrary && scanning) {
    return (
      <div className="loading-spinner">
        <div className="spinner" />
      </div>
    )
  }

  if (!mastersLibrary) {
    return (
      <div className="empty-state">
        <Database size={64} />
        <h3>Masters Library</h3>
        <p>No masters data loaded.</p>
      </div>
    )
  }

  const totalSize = [...mastersLibrary.darks, ...mastersLibrary.biases].reduce(
    (s, f) => s + f.sizeBytes,
    0
  )

  const renderTempCell = (entry: MasterFileEntry) => {
    if (entry.tempSource === 'unknown' || entry.ccdTemp === null) {
      return (
        <span
          style={{ color: 'var(--color-warning, #e8a830)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
          title="Temperature could not be determined from header or filename"
        >
          <AlertTriangle size={13} />
          Undefined
        </span>
      )
    }
    return (
      <span>
        {formatTemperature(entry.ccdTemp)}
        {entry.tempSource === 'filename' && (
          <span
            style={{ color: 'var(--color-text-muted)', fontSize: 11, marginLeft: 4 }}
            title="Parsed from filename"
          >
            (file)
          </span>
        )}
      </span>
    )
  }

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 className="page-title">Masters Library</h1>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn btn-sm"
              onClick={() => window.electronAPI.shell.showInFolder(mastersLibrary.rootPath)}
              title="Show in Finder"
            >
              <FolderOpen size={13} />
            </button>
          </div>
        </div>
      </div>

      <div className="stat-row" style={{ marginBottom: 24 }}>
        <div className="stat-card">
          <div className="stat-value">{mastersLibrary.darks.length}</div>
          <div className="stat-label">Dark Files</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{mastersLibrary.biases.length}</div>
          <div className="stat-label">Bias Files</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{formatFileSize(totalSize)}</div>
          <div className="stat-label">Total Size</div>
        </div>
      </div>

      {/* Darks */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>Darks</h2>
        <button
          className="btn btn-sm"
          onClick={() => openImportDialog('darks')}
          disabled={importing}
        >
          <Plus size={14} />
          Import Darks
        </button>
      </div>

      {mastersLibrary.darks.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)', marginBottom: 24 }}>No dark frames found.</p>
      ) : (
        <table className="table" style={{ marginBottom: 24 }}>
          <thead>
            <tr>
              <th>Filename</th>
              <th>Exposure</th>
              <th>Temperature</th>
              <th>Binning</th>
              <th>Resolution</th>
              <th>Size</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {mastersLibrary.darks.map((f, i) => (
              <tr key={i}>
                <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.filename}>
                  {f.filename}
                </td>
                <td>{formatExposure(f.exposureTime)}</td>
                <td>{renderTempCell(f)}</td>
                <td>{f.binning !== null ? `${f.binning}x${f.binning}` : '-'}</td>
                <td>{f.resolution ?? '-'}</td>
                <td>{formatFileSize(f.sizeBytes)}</td>
                <td>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      className="btn btn-sm"
                      style={{ padding: '2px 6px' }}
                      onClick={() => window.electronAPI.shell.showInFolder(f.path)}
                      title="Show in Finder"
                    >
                      <FolderOpen size={13} />
                    </button>
                    <button
                      className="btn btn-sm"
                      style={{ padding: '2px 6px' }}
                      onClick={() => openRenameModal(f, 'darks')}
                      title="Rename to proper template"
                    >
                      <Pencil size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Biases */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>Biases</h2>
        <button
          className="btn btn-sm"
          onClick={() => openImportDialog('biases')}
          disabled={importing}
        >
          <Plus size={14} />
          Import Biases
        </button>
      </div>

      {mastersLibrary.biases.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)' }}>No bias frames found.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Filename</th>
              <th>Temperature</th>
              <th>Binning</th>
              <th>Resolution</th>
              <th>Size</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {mastersLibrary.biases.map((f, i) => (
              <tr key={i}>
                <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.filename}>
                  {f.filename}
                </td>
                <td>{renderTempCell(f)}</td>
                <td>{f.binning !== null ? `${f.binning}x${f.binning}` : '-'}</td>
                <td>{f.resolution ?? '-'}</td>
                <td>{formatFileSize(f.sizeBytes)}</td>
                <td>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      className="btn btn-sm"
                      style={{ padding: '2px 6px' }}
                      onClick={() => window.electronAPI.shell.showInFolder(f.path)}
                      title="Show in Finder"
                    >
                      <FolderOpen size={13} />
                    </button>
                    <button
                      className="btn btn-sm"
                      style={{ padding: '2px 6px' }}
                      onClick={() => openRenameModal(f, 'biases')}
                      title="Rename to proper template"
                    >
                      <Pencil size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Import Modal */}
      {importModal && (
        <div className="modal-overlay" onClick={() => setImportModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Import {importModal.type === 'darks' ? 'Dark' : 'Bias'} Frames</h3>
              <button className="btn btn-sm" onClick={() => setImportModal(null)}>
                <X size={14} />
              </button>
            </div>
            <div className="modal-body">
              <p style={{ marginBottom: 12, color: 'var(--color-text-muted)' }}>
                {importModal.files.length} file{importModal.files.length > 1 ? 's' : ''} selected.
                Files will be saved with proper template filename.
              </p>
              <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>
                CCD Temperature (C)
              </label>
              <input
                type="number"
                className="input"
                value={importModal.temperature}
                onChange={(e) =>
                  setImportModal({ ...importModal, temperature: e.target.value })
                }
                style={{ width: '100%', marginBottom: 16 }}
                autoFocus
              />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-sm" onClick={() => setImportModal(null)}>
                  Cancel
                </button>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={handleImport}
                  disabled={isNaN(parseInt(importModal.temperature))}
                >
                  Import
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Rename Modal */}
      {renameModal && (
        <div className="modal-overlay" onClick={() => setRenameModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Rename to Proper Template</h3>
              <button className="btn btn-sm" onClick={() => setRenameModal(null)}>
                <X size={14} />
              </button>
            </div>
            <div className="modal-body">
              <label style={{ display: 'block', marginBottom: 4, fontWeight: 500, fontSize: 12 }}>
                Current filename
              </label>
              <p style={{ marginBottom: 12, fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all' }}>
                {renameModal.entry.filename}
              </p>

              <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>
                CCD Temperature (C)
              </label>
              <input
                type="number"
                className="input"
                value={renameModal.temperature}
                onChange={(e) => updateRenameTemp(e.target.value)}
                style={{ width: '100%', marginBottom: 12 }}
                autoFocus
              />

              <label style={{ display: 'block', marginBottom: 4, fontWeight: 500, fontSize: 12 }}>
                New filename
              </label>
              <p style={{ marginBottom: 16, fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all', color: 'var(--color-accent)' }}>
                {renameModal.newFilename}
              </p>

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-sm" onClick={() => setRenameModal(null)}>
                  Cancel
                </button>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={handleRename}
                  disabled={renameModal.newFilename === renameModal.entry.filename}
                >
                  Rename
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
