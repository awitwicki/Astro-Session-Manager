import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Trash2, Eye, Plus, FolderOpen, LayoutGrid, List, Image } from 'lucide-react'
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { useProjects } from '../hooks/useProjects'
import { useAppStore } from '../store/appStore'
import { formatIntegrationTime, formatFileSize, formatTemperature, formatExposure } from '../lib/formatters'
import { fitsDetailPath } from '../lib/constants'

type SortColumn = 'filename' | 'fwhm' | 'ccdTemp' | 'exptime' | 'size'
type SortDirection = 'asc' | 'desc'

export function SessionView() {
  const { projectName, filterName, date } = useParams<{
    projectName: string
    filterName: string
    date: string
  }>()
  const navigate = useNavigate()
  const projects = useAppStore((s) => s.projects)
  const thumbnailPaths = useAppStore((s) => s.thumbnailPaths)
  const fwhmData = useAppStore((s) => s.fwhmData)
  const removeLight = useAppStore((s) => s.removeLight)
  const enqueueThumbnails = useAppStore((s) => s.enqueueThumbnails)
  const thumbnailProcessing = useAppStore((s) => s.thumbnailProcessing)
  const { scan } = useProjects()

  const [selectedFrames, setSelectedFrames] = useState<Set<string>>(new Set())
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('table')
  const [sortColumn, setSortColumn] = useState<SortColumn>('filename')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [headersLoaded, setHeadersLoaded] = useState(false)
  const [lightHeaders, setLightHeaders] = useState<Record<string, Record<string, unknown>>>({})

  const project = projects.find((p) => p.name === decodeURIComponent(projectName || ''))
  const filter = project?.filters.find((f) => f.name === decodeURIComponent(filterName || ''))
  const session = filter?.sessions.find((s) => s.date === decodeURIComponent(date || ''))

  // Enqueue thumbnail generation for missing thumbnails
  const generateThumbnails = useCallback(() => {
    if (!session || !project || !filter) return

    const missingPaths = session.lights
      .filter((l) => !thumbnailPaths[l.path])
      .map((l) => l.path)

    if (missingPaths.length === 0) return

    const label = `${project.name} / ${filter.name} / ${session.date}`
    enqueueThumbnails(label, missingPaths)
  }, [session, project, filter, thumbnailPaths, enqueueThumbnails])

  // Lazy-load FITS headers when switching to table view
  useEffect(() => {
    if (viewMode !== 'table' || headersLoaded || !session) return

    const paths = session.lights.map((l) => l.path)
    if (paths.length === 0) return

    invoke<Record<string, unknown>[]>('batch_read_fits_headers', { filePaths: paths }).then((headers) => {
      const headerMap: Record<string, Record<string, unknown>> = {}
      for (let i = 0; i < paths.length; i++) {
        if (headers[i]) {
          headerMap[paths[i]] = headers[i] as Record<string, unknown>
        }
      }
      setLightHeaders(headerMap)
      setHeadersLoaded(true)
    }).catch(() => {})
  }, [viewMode, headersLoaded, session])

  if (!session || !project || !filter) {
    return (
      <div className="empty-state">
        <h3>Session Not Found</h3>
      </div>
    )
  }

  const toggleSelection = (path: string): void => {
    const next = new Set(selectedFrames)
    if (next.has(path)) {
      next.delete(path)
    } else {
      next.add(path)
    }
    setSelectedFrames(next)
  }

  const handleDelete = async (): Promise<void> => {
    for (const filePath of selectedFrames) {
      const result = await invoke<{ success: boolean }>('move_to_trash', { filePath })
      if (result.success) {
        removeLight(filePath)
      }
    }
    setSelectedFrames(new Set())
    setDeleteConfirm(false)
  }

  const handleSort = (col: SortColumn): void => {
    if (sortColumn === col) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortColumn(col)
      setSortDirection('asc')
    }
  }

  const getHeader = (filePath: string): Record<string, unknown> | undefined => {
    return lightHeaders[filePath]
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">
          {project.name} / {filter.name} / {session.date}
        </h1>
        <div style={{ display: 'flex', gap: 16, fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
          <span>{session.lights.length} lights</span>
          <span>{formatIntegrationTime(session.integrationSeconds)}</span>
          <span>{formatFileSize(session.totalSizeBytes)}</span>
          {session.flats.length > 0 && <span>{session.flats.length} flats</span>}
        </div>
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 2 }}>
          <button
            className={`btn btn-sm ${viewMode === 'grid' ? 'btn-primary' : ''}`}
            onClick={() => setViewMode('grid')}
            title="Grid view"
          >
            <LayoutGrid size={14} />
          </button>
          <button
            className={`btn btn-sm ${viewMode === 'table' ? 'btn-primary' : ''}`}
            onClick={() => setViewMode('table')}
            title="Table view"
          >
            <List size={14} />
          </button>
        </div>

        <button
          className="btn btn-sm"
          onClick={generateThumbnails}
          disabled={thumbnailProcessing}
          title="Generate thumbnails and compute FWHM"
        >
          <Image size={14} />
          Generate Thumbnails
        </button>

        <button
          className="btn btn-sm"
          onClick={async () => {
            const files = await open({
              multiple: true,
              title: 'Import Light Frames',
              filters: [
                { name: 'FITS files', extensions: ['fits', 'fit', 'fts'] },
                { name: 'All files', extensions: ['*'] }
              ]
            })
            if (!files || (Array.isArray(files) && files.length === 0)) return
            const fileList = Array.isArray(files) ? files : [files]
            const lightsDir = session.path + '/lights'
            await invoke('copy_to_directory', { files: fileList, targetDir: lightsDir })
            await scan()
          }}
        >
          <Plus size={14} />
          Import Lights
        </button>

        <button
          className="btn btn-sm"
          onClick={async () => {
            const files = await open({
              multiple: true,
              title: 'Import Flat Frames',
              filters: [
                { name: 'FITS files', extensions: ['fits', 'fit', 'fts'] },
                { name: 'All files', extensions: ['*'] }
              ]
            })
            if (!files || (Array.isArray(files) && files.length === 0)) return
            const fileList = Array.isArray(files) ? files : [files]
            const flatsDir = session.path + '/flats'
            await invoke('copy_to_directory', { files: fileList, targetDir: flatsDir })
            await scan()
          }}
        >
          <Plus size={14} />
          Import Flats
        </button>

        <button
          className="btn btn-sm"
          style={{ padding: '4px 8px' }}
          onClick={() => invoke('show_in_folder', { path: session.path })}
          title="Show in Finder"
        >
          <FolderOpen size={13} />
        </button>

        <div style={{ flex: 1 }} />

        {selectedFrames.size > 0 && (
          <>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
              {selectedFrames.size} selected
            </span>
            <button
              className="btn btn-danger btn-sm"
              onClick={() => setDeleteConfirm(true)}
            >
              <Trash2 size={14} />
              Delete Selected
            </button>
          </>
        )}
      </div>

      {viewMode === 'table' ? (
        <TableView
          lights={session.lights}
          fwhmData={fwhmData}
          lightHeaders={lightHeaders}
          sortColumn={sortColumn}
          sortDirection={sortDirection}
          selectedFrames={selectedFrames}
          onSort={handleSort}
          onToggleSelection={toggleSelection}
          onNavigate={(path) => navigate(fitsDetailPath(path))}
          getHeader={getHeader}
        />
      ) : (
        <div className="grid-thumbnails">
          {session.lights.map((light) => {
            const thumbPath = thumbnailPaths[light.path]
            const selected = selectedFrames.has(light.path)
            const fwhm = fwhmData[light.path]

            return (
              <div
                key={light.path}
                className="thumbnail-card"
                style={{
                  outline: selected ? '2px solid var(--color-accent)' : undefined,
                  outlineOffset: -2
                }}
                onClick={() => toggleSelection(light.path)}
              >
                {thumbPath ? (
                  <img
                    src={convertFileSrc(thumbPath)}
                    alt={light.filename}
                    loading="lazy"
                  />
                ) : (
                  <div className="thumbnail-placeholder">
                    <Eye size={24} />
                  </div>
                )}

                <div className="thumbnail-card-info">
                  <div className="thumbnail-card-filename">{light.filename}</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <span>{formatFileSize(light.sizeBytes)}</span>
                    {fwhm != null && (
                      <span style={{ color: 'var(--color-accent)' }}>FWHM: {fwhm.toFixed(1)} px</span>
                    )}
                  </div>
                </div>

                <div className="thumbnail-card-actions">
                  <button
                    className="btn btn-sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      navigate(fitsDetailPath(light.path))
                    }}
                    title="View details"
                  >
                    <Eye size={12} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteConfirm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Delete {selectedFrames.size} frame(s)?</h3>
            <p style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>
              Files will be moved to the system trash. This can be undone from the trash.
            </p>
            <div className="modal-actions">
              <button className="btn" onClick={() => setDeleteConfirm(false)}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={handleDelete}>
                <Trash2 size={14} />
                Move to Trash
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function TableView({
  lights,
  fwhmData,
  lightHeaders,
  sortColumn,
  sortDirection,
  selectedFrames,
  onSort,
  onToggleSelection,
  onNavigate,
  getHeader
}: {
  lights: { filename: string; path: string; sizeBytes: number }[]
  fwhmData: Record<string, number>
  lightHeaders: Record<string, Record<string, unknown>>
  sortColumn: SortColumn
  sortDirection: SortDirection
  selectedFrames: Set<string>
  onSort: (col: SortColumn) => void
  onToggleSelection: (path: string) => void
  onNavigate: (path: string) => void
  getHeader: (path: string) => Record<string, unknown> | undefined
}) {
  // Compute anomaly thresholds
  const fwhmValues = lights.map((l) => fwhmData[l.path]).filter((v): v is number => v != null)
  let fwhmMedian = 0
  let fwhmMad = 0
  if (fwhmValues.length > 3) {
    const sorted = [...fwhmValues].sort((a, b) => a - b)
    fwhmMedian = sorted[Math.floor(sorted.length / 2)]
    const devs = sorted.map((v) => Math.abs(v - fwhmMedian))
    devs.sort((a, b) => a - b)
    fwhmMad = devs[Math.floor(devs.length / 2)] * 1.4826
  }

  // Compute exposure anomaly thresholds
  const exptimeValues = lights
    .map((l) => {
      const h = getHeader(l.path)
      return h && typeof h.exptime === 'number' ? h.exptime : null
    })
    .filter((v): v is number => v != null)
  let expMedian = 0
  let expMad = 0
  if (exptimeValues.length > 3) {
    const sorted = [...exptimeValues].sort((a, b) => a - b)
    expMedian = sorted[Math.floor(sorted.length / 2)]
    const devs = sorted.map((v) => Math.abs(v - expMedian))
    devs.sort((a, b) => a - b)
    expMad = devs[Math.floor(devs.length / 2)] * 1.4826
  }

  const isAnomaly = (value: number, median: number, mad: number): boolean => {
    if (mad < 0.0001) return false
    return Math.abs(value - median) > 2 * mad
  }

  const sortedLights = useMemo(() => {
    const sorted = [...lights]
    sorted.sort((a, b) => {
      let va: number | string
      let vb: number | string
      switch (sortColumn) {
        case 'filename':
          va = a.filename
          vb = b.filename
          break
        case 'fwhm':
          va = fwhmData[a.path] ?? Infinity
          vb = fwhmData[b.path] ?? Infinity
          break
        case 'ccdTemp': {
          const ha = getHeader(a.path)
          const hb = getHeader(b.path)
          va = ha && typeof ha.ccdTemp === 'number' ? ha.ccdTemp : -999
          vb = hb && typeof hb.ccdTemp === 'number' ? hb.ccdTemp : -999
          break
        }
        case 'exptime': {
          const ha2 = getHeader(a.path)
          const hb2 = getHeader(b.path)
          va = ha2 && typeof ha2.exptime === 'number' ? ha2.exptime : 0
          vb = hb2 && typeof hb2.exptime === 'number' ? hb2.exptime : 0
          break
        }
        case 'size':
          va = a.sizeBytes
          vb = b.sizeBytes
          break
        default:
          va = a.filename
          vb = b.filename
      }
      const cmp = va < vb ? -1 : va > vb ? 1 : 0
      return sortDirection === 'asc' ? cmp : -cmp
    })
    return sorted
  }, [lights, sortColumn, sortDirection, fwhmData, lightHeaders])

  const sortIndicator = (col: SortColumn): string => {
    if (sortColumn !== col) return ''
    return sortDirection === 'asc' ? ' \u2191' : ' \u2193'
  }

  return (
    <table className="table">
      <thead>
        <tr>
          <th style={{ cursor: 'pointer' }} onClick={() => onSort('filename')}>
            Filename{sortIndicator('filename')}
          </th>
          <th style={{ cursor: 'pointer' }} onClick={() => onSort('fwhm')}>
            FWHM (px){sortIndicator('fwhm')}
          </th>
          <th style={{ cursor: 'pointer' }} onClick={() => onSort('ccdTemp')}>
            Temperature{sortIndicator('ccdTemp')}
          </th>
          <th style={{ cursor: 'pointer' }} onClick={() => onSort('exptime')}>
            Exposure{sortIndicator('exptime')}
          </th>
          <th style={{ cursor: 'pointer' }} onClick={() => onSort('size')}>
            Size{sortIndicator('size')}
          </th>
          <th />
        </tr>
      </thead>
      <tbody>
        {sortedLights.map((light) => {
          const fwhm = fwhmData[light.path]
          const header = getHeader(light.path)
          const ccdTemp = header && typeof header.ccdTemp === 'number' ? header.ccdTemp : null
          const exptime = header && typeof header.exptime === 'number' ? header.exptime : null
          const selected = selectedFrames.has(light.path)

          const fwhmAnomaly = fwhm != null && isAnomaly(fwhm, fwhmMedian, fwhmMad)
          const expAnomaly = exptime != null && isAnomaly(exptime, expMedian, expMad)

          return (
            <tr
              key={light.path}
              style={{
                cursor: 'pointer',
                background: selected ? 'var(--color-bg-hover)' : undefined
              }}
              onClick={() => onToggleSelection(light.path)}
            >
              <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                {light.filename}
              </td>
              <td style={{ color: fwhmAnomaly ? 'var(--color-warning, #f59e0b)' : undefined, fontWeight: fwhmAnomaly ? 600 : undefined }}>
                {fwhm != null ? `${fwhm.toFixed(2)} px` : '-'}
              </td>
              <td>
                {ccdTemp != null ? formatTemperature(ccdTemp) : '-'}
              </td>
              <td style={{ color: expAnomaly ? 'var(--color-warning, #f59e0b)' : undefined, fontWeight: expAnomaly ? 600 : undefined }}>
                {exptime != null ? formatExposure(exptime) : '-'}
              </td>
              <td>{formatFileSize(light.sizeBytes)}</td>
              <td>
                <button
                  className="btn btn-sm"
                  style={{ padding: '2px 6px' }}
                  onClick={(e) => {
                    e.stopPropagation()
                    onNavigate(light.path)
                  }}
                  title="View details"
                >
                  <Eye size={12} />
                </button>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
