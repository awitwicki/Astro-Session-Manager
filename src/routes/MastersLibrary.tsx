import { useEffect, useState } from 'react'
import { Database, Plus, FolderOpen, Pencil, AlertTriangle, X, ChevronDown, ChevronRight, File, Folder, Info, Star, Undo2 } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { useAppStore } from '../store/appStore'
import { formatFileSize, formatTemperature, formatExposure } from '../lib/formatters'
import type { MastersLibrary as MastersLibraryType, MasterFileEntry } from '../types'

function generateFilename(
  type: 'darks' | 'biases',
  temperature: string,
  binning: string,
  width: string,
  height: string,
  exposure: string,
  ext: string,
): string {
  const prefix = type === 'darks' ? 'masterDark' : 'masterBias'
  const temp = Number.parseInt(temperature)
  const tempStr = Number.isNaN(temp) ? 'undefinedC' : `${temp >= 0 ? '+' : ''}${temp}C`
  const bin = Number.parseInt(binning)
  const binStr = `BIN-${Number.isNaN(bin) ? 1 : bin}`
  const w = Number.parseInt(width)
  const h = Number.parseInt(height)
  const resStr = (!Number.isNaN(w) && !Number.isNaN(h)) ? `${w}x${h}` : 'unknown'

  let name = `${prefix}_${tempStr}_${binStr}_${resStr}`
  const exp = Number.parseFloat(exposure)
  if (type === 'darks' && !Number.isNaN(exp) && exp > 0) {
    name += `_EXPOSURE-${exp.toFixed(2)}s`
  }
  return `${name}.${ext}`
}

interface HeaderValues {
  temperature: string
  binning: string
  width: string
  height: string
  exposure: string
}

interface FormModal {
  mode: 'import' | 'edit'
  type: 'darks' | 'biases'
  files: string[]
  entry: MasterFileEntry | null
  temperature: string
  binning: string
  width: string
  height: string
  exposure: string
  header: HeaderValues | null
}

function HeaderInput({
  label,
  value,
  headerValue,
  onChange,
  onRevert,
  type = 'number',
  step,
  min,
  autoFocus,
}: {
  label: string
  value: string
  headerValue: string | null | undefined
  onChange: (v: string) => void
  onRevert: () => void
  type?: string
  step?: string
  min?: number
  autoFocus?: boolean
}) {
  const hasHeader = headerValue != null && headerValue !== ''
  const isDifferent = hasHeader && value !== headerValue

  return (
    <div>
      <label style={{ display: 'block', marginBottom: 4, fontWeight: 500, fontSize: 12 }}>
        {label}
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoFocus={autoFocus}
          step={step}
          min={min}
          style={{
            flex: 1,
            minWidth: 0,
            padding: '7px 10px',
            fontSize: 13,
            background: isDifferent ? 'rgba(232, 168, 48, 0.08)' : 'var(--color-bg)',
            border: `1px solid ${isDifferent ? 'var(--color-warning, #e8a830)' : 'var(--color-border)'}`,
            borderRadius: 6,
            color: 'var(--color-text)',
            outline: 'none',
            transition: 'border-color 0.2s, background-color 0.2s',
          }}
        />
        <button
          onClick={onRevert}
          title={isDifferent ? `Revert to header value: ${headerValue}` : ''}
          disabled={!isDifferent}
          style={{
            flexShrink: 0,
            width: 26,
            height: 26,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: isDifferent ? 'var(--color-warning, #e8a830)' : 'transparent',
            border: isDifferent ? 'none' : '1px solid transparent',
            borderRadius: 6,
            cursor: isDifferent ? 'pointer' : 'default',
            color: isDifferent ? '#fff' : 'transparent',
            padding: 0,
            opacity: isDifferent ? 1 : 0,
            transition: 'opacity 0.2s, background 0.2s',
            pointerEvents: isDifferent ? 'auto' : 'none',
          }}
        >
          <Undo2 size={12} />
        </button>
      </div>
      {hasHeader && (
        <div style={{
          fontSize: 11,
          marginTop: 3,
          color: isDifferent ? 'var(--color-warning, #e8a830)' : 'var(--color-text-muted)',
          opacity: isDifferent ? 1 : 0.7,
          transition: 'color 0.2s, opacity 0.2s',
        }}>
          From fits header: {headerValue}
        </div>
      )}
    </div>
  )
}

export function MastersLibrary() {
  const mastersLibrary = useAppStore((s) => s.mastersLibrary)
  const setMastersLibrary = useAppStore((s) => s.setMastersLibrary)
  const rootFolder = useAppStore((s) => s.rootFolder)

  const [importing, setImporting] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [otherFilesOpen, setOtherFilesOpen] = useState(false)
  const [namingInfoOpen, setNamingInfoOpen] = useState(false)

  const [formModal, setFormModal] = useState<FormModal | null>(null)

  useEffect(() => {
    if (rootFolder && !mastersLibrary) {
      setScanning(true)
      invoke<MastersLibraryType>('scan_masters', { rootFolder })
        .then((data) => {
          setMastersLibrary(data)
        })
        .catch(() => {})
        .finally(() => setScanning(false))
    }
  }, [rootFolder, mastersLibrary, setMastersLibrary])

  const rescanMasters = async (): Promise<void> => {
    if (!rootFolder) return
    setScanning(true)
    try {
      const data = await invoke<MastersLibraryType>('scan_masters', { rootFolder })
      setMastersLibrary(data)
    } catch {
      // scan failed
    } finally {
      setScanning(false)
    }
  }

  const loadHeaderValues = async (filePath: string): Promise<HeaderValues | null> => {
    try {
      const headers = await invoke<(Record<string, unknown> | null)[]>('batch_read_fits_headers', { filePaths: [filePath] })
      const h = headers?.[0]
      if (h) {
        return {
          temperature: h.ccdTemp != null ? String(Math.round(h.ccdTemp as number)) : '',
          binning: h.xbinning != null ? String(h.xbinning) : '',
          width: h.naxis1 != null ? String(h.naxis1) : '',
          height: h.naxis2 != null ? String(h.naxis2) : '',
          exposure: h.exptime != null ? String(h.exptime) : '',
        }
      }
    } catch { /* ignore */ }
    return null
  }

  const openImportDialog = async (type: 'darks' | 'biases'): Promise<void> => {
    if (!rootFolder) return
    const files = await open({
      multiple: true,
      title: type === 'darks' ? 'Import Dark Frames' : 'Import Bias Frames',
      filters: [
        { name: 'FITS/XISF files', extensions: ['fits', 'fit', 'fts', 'xisf'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (!files || (Array.isArray(files) && files.length === 0)) return
    const fileList = Array.isArray(files) ? files : [files]

    const header = await loadHeaderValues(fileList[0])

    setFormModal({
      mode: 'import',
      type,
      files: fileList,
      entry: null,
      temperature: header?.temperature || '-20',
      binning: header?.binning || '1',
      width: header?.width || '',
      height: header?.height || '',
      exposure: header?.exposure || '',
      header,
    })
  }

  const openEditModal = async (entry: MasterFileEntry, type: 'darks' | 'biases'): Promise<void> => {
    const [w, h] = entry.resolution?.split('x') ?? ['', '']

    // Pre-fill from filename-parsed values
    const modal: FormModal = {
      mode: 'edit',
      type,
      files: [],
      entry,
      temperature: entry.ccdTemp !== null ? String(entry.ccdTemp) : '',
      binning: entry.binning !== null ? String(entry.binning) : '1',
      width: w,
      height: h,
      exposure: entry.exposureTime > 0 ? String(entry.exposureTime) : '',
      header: null,
    }

    setFormModal(modal)

    // Load headers in background
    const header = await loadHeaderValues(entry.path)
    if (header) {
      setFormModal((prev) => prev ? { ...prev, header } : prev)
    }
  }

  const handleSave = async (): Promise<void> => {
    if (!formModal || !rootFolder) return
    const temp = Number.parseInt(formModal.temperature)
    if (Number.isNaN(temp)) return

    const bin = Number.parseInt(formModal.binning)
    const w = Number.parseInt(formModal.width)
    const h = Number.parseInt(formModal.height)
    const exp = Number.parseFloat(formModal.exposure)

    if (formModal.mode === 'import') {
      setImporting(true)
      setFormModal(null)
      try {
        await invoke('import_masters', {
          rootFolder,
          files: formModal.files,
          masterType: formModal.type,
          ccdTemp: temp,
          binning: Number.isNaN(bin) ? null : bin,
          width: Number.isNaN(w) ? null : w,
          height: Number.isNaN(h) ? null : h,
          exposure: Number.isNaN(exp) ? null : exp,
        })
        await rescanMasters()
      } finally {
        setImporting(false)
      }
    } else if (formModal.mode === 'edit' && formModal.entry) {
      const ext = formModal.entry.format
      const newFilename = generateFilename(
        formModal.type, formModal.temperature, formModal.binning,
        formModal.width, formModal.height, formModal.exposure, ext,
      )

      if (newFilename === formModal.entry.filename) {
        setFormModal(null)
        return
      }

      const dir = formModal.entry.path.replace(formModal.entry.filename, '')
      const newPath = dir + newFilename
      setFormModal(null)
      try {
        await invoke('rename_path', { oldPath: formModal.entry.path, newPath, rootFolder })
        await rescanMasters()
      } catch {
        // rename failed
      }
    }
  }

  const updateField = (field: string, value: string) => {
    setFormModal((prev) => prev ? { ...prev, [field]: value } : prev)
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
          <div style={{ paddingLeft: "8px"}}>
            <button
              className="btn btn-sm"
              onClick={() => invoke('show_in_folder', { path: mastersLibrary.rootPath })}
              title="Show in Finder"
            >
              <FolderOpen size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* Naming Convention Info */}
      <div style={{ marginBottom: 24 }}>
        <button
          onClick={() => setNamingInfoOpen(!namingInfoOpen)}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--color-text-muted)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 0',
            fontSize: 13,
          }}
        >
          <Info size={14} />
          File naming convention
          {namingInfoOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        {namingInfoOpen && (
          <div
            style={{
              marginTop: 8,
              padding: '12px 16px',
              background: 'var(--color-bg-secondary)',
              borderRadius: 8,
              border: '1px solid var(--color-border)',
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            <p style={{ marginBottom: 8, fontWeight: 500 }}>
              Name your master files using these templates for automatic matching:
            </p>
            <p style={{ marginBottom: 4, color: 'var(--color-text-muted)', fontSize: 12, fontWeight: 500 }}>Darks (with exposure):</p>
            <code
              style={{
                display: 'block',
                padding: '8px 12px',
                background: 'var(--color-bg)',
                borderRadius: 6,
                fontFamily: 'monospace',
                fontSize: 12,
                wordBreak: 'break-all',
                marginBottom: 10,
              }}
            >
              masterDark_&#123;temperature&#125;C_BIN-&#123;binning&#125;_&#123;width&#125;x&#123;height&#125;_EXPOSURE-&#123;xx.xx&#125;s.fits
            </code>
            <p style={{ marginBottom: 4, color: 'var(--color-text-muted)', fontSize: 12, fontWeight: 500 }}>Biases (no exposure):</p>
            <code
              style={{
                display: 'block',
                padding: '8px 12px',
                background: 'var(--color-bg)',
                borderRadius: 6,
                fontFamily: 'monospace',
                fontSize: 12,
                wordBreak: 'break-all',
                marginBottom: 10,
              }}
            >
              masterBias_&#123;temperature&#125;C_BIN-&#123;binning&#125;_&#123;width&#125;x&#123;height&#125;.fits
            </code>
            <p style={{ marginBottom: 6, color: 'var(--color-text-muted)', fontWeight: 500 }}>Examples:</p>
            <code
              style={{
                display: 'block',
                paddingLeft: '12px',
                background: 'var(--color-bg)',
                borderRadius: 6,
                fontFamily: 'monospace',
                fontSize: 12,
                wordBreak: 'break-all',
                marginBottom: 4,
              }}
            >
              masterDark_-10C_BIN-1_4656x3520_EXPOSURE-60.00s.fits
            </code>
            <code
              style={{
                display: 'block',
                paddingLeft: '12px',
                background: 'var(--color-bg)',
                borderRadius: 6,
                fontFamily: 'monospace',
                fontSize: 12,
                wordBreak: 'break-all',
                marginBottom: 4,
              }}
            >
              masterBias_-20C_BIN-1_6248x4176.xisf
            </code>
          </div>
        )}
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
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <Star size={12} fill="var(--color-accent)" color="var(--color-accent)" />
                    {f.filename}
                  </span>
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
                      onClick={() => invoke('show_in_folder', { path: f.path })}
                      title="Show in Finder"
                    >
                      <FolderOpen size={13} />
                    </button>
                    <button
                      className="btn btn-sm"
                      style={{ padding: '2px 6px' }}
                      onClick={() => openEditModal(f, 'darks')}
                      title="Edit metadata & rename"
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
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <Star size={12} fill="var(--color-accent)" color="var(--color-accent)" />
                    {f.filename}
                  </span>
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
                      onClick={() => invoke('show_in_folder', { path: f.path })}
                      title="Show in Finder"
                    >
                      <FolderOpen size={13} />
                    </button>
                    <button
                      className="btn btn-sm"
                      style={{ padding: '2px 6px' }}
                      onClick={() => openEditModal(f, 'biases')}
                      title="Edit metadata & rename"
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

      {/* Other Files */}
      {(mastersLibrary.otherFiles?.length ?? 0) > 0 && (
        <div style={{ marginTop: 24, marginBottom: 24 }}>
          <button
            onClick={() => setOtherFilesOpen(!otherFilesOpen)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 0',
              fontSize: 13,
            }}
          >
            {otherFilesOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            Other files ({mastersLibrary.otherFiles.length})
          </button>
          {otherFilesOpen && (
            <table className="table" style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Size</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {mastersLibrary.otherFiles.map((f, i) => (
                  <tr key={i}>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        {f.isDir ? <Folder size={14} /> : <File size={14} />}
                        {f.name}
                      </span>
                    </td>
                    <td>{f.isDir ? '-' : formatFileSize(f.sizeBytes)}</td>
                    <td>
                      <button
                        className="btn btn-sm"
                        style={{ padding: '2px 6px' }}
                        onClick={() => invoke('show_in_folder', { path: f.path })}
                        title="Show in Explorer"
                      >
                        <FolderOpen size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Unified Form Modal (Import / Edit) */}
      {formModal && (() => {
        const ext = formModal.mode === 'import'
          ? (formModal.files[0]?.split('.').pop() ?? 'fits')
          : (formModal.entry?.format ?? 'fits')
        const previewName = generateFilename(
          formModal.type, formModal.temperature, formModal.binning,
          formModal.width, formModal.height, formModal.exposure, ext,
        )
        const isImport = formModal.mode === 'import'
        const isEdit = formModal.mode === 'edit'
        const filenameUnchanged = isEdit && formModal.entry && previewName === formModal.entry.filename

        return (
          <div className="modal-overlay" onClick={() => setFormModal(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 480, position: 'relative', padding: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px 0' }}>
                <h3 style={{ fontSize: 16, fontWeight: 600 }}>
                  {isImport
                    ? `Import ${formModal.type === 'darks' ? 'Dark' : 'Bias'} Frames`
                    : `Edit ${formModal.type === 'darks' ? 'Dark' : 'Bias'} Frame`
                  }
                </h3>
                <button className="btn btn-sm" onClick={() => setFormModal(null)}>
                  <X size={14} />
                </button>
              </div>
              <div style={{ padding: '16px 24px 24px' }}>
                {isImport && (
                  <p style={{ marginBottom: 16, color: 'var(--color-text-muted)' }}>
                    {formModal.files.length} file{formModal.files.length > 1 ? 's' : ''} selected.
                  </p>
                )}
                {isEdit && formModal.entry && (
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: 'block', marginBottom: 4, fontWeight: 500, fontSize: 12 }}>
                      Current filename
                    </label>
                    <p style={{ fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all', color: 'var(--color-text-muted)' }}>
                      {formModal.entry.filename}
                    </p>
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px', marginBottom: 16 }}>
                  <HeaderInput
                    label="Temperature (°C)"
                    value={formModal.temperature}
                    headerValue={formModal.header?.temperature}
                    onChange={(v) => updateField('temperature', v)}
                    onRevert={() => formModal.header && updateField('temperature', formModal.header.temperature)}
                    autoFocus
                  />
                  <HeaderInput
                    label="Binning"
                    value={formModal.binning}
                    headerValue={formModal.header?.binning}
                    onChange={(v) => updateField('binning', v)}
                    onRevert={() => formModal.header && updateField('binning', formModal.header.binning)}
                    min={1}
                  />
                  <HeaderInput
                    label="Width (px)"
                    value={formModal.width}
                    headerValue={formModal.header?.width}
                    onChange={(v) => updateField('width', v)}
                    onRevert={() => formModal.header && updateField('width', formModal.header.width)}
                  />
                  <HeaderInput
                    label="Height (px)"
                    value={formModal.height}
                    headerValue={formModal.header?.height}
                    onChange={(v) => updateField('height', v)}
                    onRevert={() => formModal.header && updateField('height', formModal.header.height)}
                  />
                  {formModal.type === 'darks' && (
                    <HeaderInput
                      label="Exposure (s)"
                      value={formModal.exposure}
                      headerValue={formModal.header?.exposure}
                      onChange={(v) => updateField('exposure', v)}
                      onRevert={() => formModal.header && updateField('exposure', formModal.header.exposure)}
                      step="0.01"
                    />
                  )}
                </div>

                <label style={{ display: 'block', marginBottom: 4, fontWeight: 500, fontSize: 12 }}>
                  {isEdit ? 'New filename' : 'Filename preview'}
                </label>
                <p style={{ marginBottom: 16, fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all', color: 'var(--color-accent)' }}>
                  {previewName}
                </p>

                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button className="btn btn-sm" onClick={() => setFormModal(null)}>
                    Cancel
                  </button>
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={handleSave}
                    disabled={Number.isNaN(Number.parseInt(formModal.temperature)) || !!filenameUnchanged}
                  >
                    {isImport ? 'Save' : 'Rename'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
