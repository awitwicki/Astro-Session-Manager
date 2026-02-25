import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, ZoomIn, ZoomOut, RotateCcw, ChevronLeft, ChevronRight, ChevronDown, FolderOpen } from 'lucide-react'
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useAppStore } from '../store/appStore'
import { fitsGalleryPath, type GalleryScope } from '../lib/constants'

interface FitsHeader {
  bayerpat?: string
  naxis1?: number
  naxis2?: number
  naxis3?: number
  object?: string
  exptime?: number
  ccdTemp?: number
  filter?: string
  dateObs?: string
  instrume?: string
  telescop?: string
  gain?: number
  bitpix?: number
  raw?: Record<string, unknown>
  [key: string]: unknown
}

interface FitsPreviewResult {
  imagePath: string
  width: number
  height: number
  originalWidth: number
  originalHeight: number
  header: FitsHeader
}

export function FitsDetailView() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const filePath = searchParams.get('path') || ''
  const scope = searchParams.get('scope') as GalleryScope | null
  const projectParam = searchParams.get('project') || ''
  const filterParam = searchParams.get('filter') || ''
  const dateParam = searchParams.get('date') || ''

  const projects = useAppStore((s) => s.projects)

  // Derive gallery frame list from store based on scope
  const frames = useMemo(() => {
    if (!scope || !projectParam) return []
    const project = projects.find((p) => p.name === projectParam)
    if (!project) return []

    if (scope === 'session') {
      const filter = project.filters.find((f) => f.name === filterParam)
      if (!filter) return []
      const session = filter.sessions.find((s) => s.date === dateParam)
      if (!session) return []
      return session.lights.map((l) => l.path)
    }

    if (scope === 'filter') {
      const filter = project.filters.find((f) => f.name === filterParam)
      if (!filter) return []
      return filter.sessions.flatMap((s) => s.lights.map((l) => l.path))
    }

    if (scope === 'project') {
      return project.filters.flatMap((f) =>
        f.sessions.flatMap((s) => s.lights.map((l) => l.path))
      )
    }

    return []
  }, [scope, projectParam, filterParam, dateParam, projects])

  const currentIndex = useMemo(() => {
    if (frames.length === 0) return -1
    return frames.indexOf(filePath)
  }, [frames, filePath])

  const hasGallery = frames.length > 0
  const hasPrev = currentIndex > 0
  const hasNext = currentIndex < frames.length - 1

  const navigateToFrame = useCallback(
    (index: number) => {
      if (index < 0 || index >= frames.length || !scope) return
      navigate(fitsGalleryPath(frames[index], scope, projectParam, filterParam || undefined, dateParam || undefined))
    },
    [frames, scope, projectParam, filterParam, dateParam, navigate]
  )

  const goPrev = useCallback(() => {
    if (hasPrev) navigateToFrame(currentIndex - 1)
  }, [hasPrev, currentIndex, navigateToFrame])

  const goNext = useCallback(() => {
    if (hasNext) navigateToFrame(currentIndex + 1)
  }, [hasNext, currentIndex, navigateToFrame])

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        goPrev()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        goNext()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [goPrev, goNext])

  // Build scope switch URL
  const scopeUrl = useCallback(
    (newScope: GalleryScope) => {
      return fitsGalleryPath(
        filePath,
        newScope,
        projectParam,
        filterParam || undefined,
        dateParam || undefined
      )
    },
    [filePath, projectParam, filterParam, dateParam]
  )

  // Check which scopes are available
  const canShowSessionScope = !!(projectParam && filterParam && dateParam)
  const canShowFilterScope = !!(projectParam && filterParam)
  const canShowProjectScope = !!projectParam

  const [keywordsExpanded, setKeywordsExpanded] = useState(() => {
    return localStorage.getItem('fitsDetail.keywordsExpanded') === 'true'
  })

  const toggleKeywords = useCallback(() => {
    setKeywordsExpanded((prev) => {
      const next = !prev
      localStorage.setItem('fitsDetail.keywordsExpanded', String(next))
      return next
    })
  }, [])

  const [preview, setPreview] = useState<FitsPreviewResult | null>(null)
  const [headerData, setHeaderData] = useState<FitsHeader | null>(null)
  const [headerLoading, setHeaderLoading] = useState(true)
  const [imageLoading, setImageLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [imageUrl, setImageUrl] = useState<string>('')
  const [previewProgress, setPreviewProgress] = useState<{ current: number; total: number } | null>(null)
  const initialFitDoneRef = useRef(false)
  const lastPreviewSizeRef = useRef<{ w: number; h: number } | null>(null)
  const batchFramesKeyRef = useRef<string>('')

  // Batch preview generation: start from current image, generate all in background
  // Only depends on `frames` — navigating between images should NOT restart the batch.
  useEffect(() => {
    if (frames.length === 0) return
    const framesKey = frames.join('|')
    if (batchFramesKeyRef.current === framesKey) return
    batchFramesKeyRef.current = framesKey

    let cancelled = false
    let unlisten: (() => void) | null = null

    // Use current filePath for ordering without adding it as a dependency
    const idx = frames.indexOf(filePath)
    const startIdx = idx >= 0 ? idx : 0
    const reordered = [...frames.slice(startIdx), ...frames.slice(0, startIdx)]

    async function run() {
      unlisten = await listen<{ current: number; total: number; filePath: string }>(
        'preview:progress',
        (event) => {
          if (!cancelled) {
            setPreviewProgress({ current: event.payload.current, total: event.payload.total })
          }
        }
      )
      try {
        await invoke('batch_generate_previews', { filePaths: reordered })
      } catch {
        // ignore batch errors
      } finally {
        if (unlisten) unlisten()
        if (!cancelled) setPreviewProgress(null)
      }
    }

    run()

    return () => {
      cancelled = true
      if (unlisten) unlisten()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frames])

  // Clear preview cache from RAM only when unmounting (leaving the detail view entirely)
  useEffect(() => {
    return () => {
      invoke('clear_preview_cache').catch(() => {})
      batchFramesKeyRef.current = ''
    }
  }, [])

  // Reset error when file changes; zoom/pan are preserved if resolution matches
  useEffect(() => {
    setError(null)
  }, [filePath])

  // Fit image to container
  const fitToView = useCallback(() => {
    if (!preview || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const scaleX = rect.width / preview.width
    const scaleY = rect.height / preview.height
    const fitZoom = Math.min(scaleX, scaleY, 1)
    const scaledW = preview.width * fitZoom
    const scaledH = preview.height * fitZoom
    setZoom(fitZoom)
    setPan({ x: (rect.width - scaledW) / 2, y: (rect.height - scaledH) / 2 })
  }, [preview])

  const handleImageLoad = useCallback(() => {
    if (!initialFitDoneRef.current) {
      initialFitDoneRef.current = true
      fitToView()
    }
  }, [fitToView])

  // Phase 1: Load header quickly
  useEffect(() => {
    if (!filePath) return
    let cancelled = false
    setHeaderLoading(true)
    setHeaderData(null)

    invoke<FitsHeader>('read_fits_header', { filePath })
      .then((data) => {
        if (!cancelled) {
          setHeaderData(data)
          setHeaderLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(String(err))
          setHeaderLoading(false)
        }
      })

    return () => { cancelled = true }
  }, [filePath])

  // Phase 2: Load preview
  // Keep the old image visible while loading; only show spinner after a delay
  // so cached images swap instantly without a flash.
  useEffect(() => {
    if (!filePath) return
    let cancelled = false
    const loadingTimer = setTimeout(() => {
      if (!cancelled) {
        setImageLoading(true)
        setPreview(null)
      }
    }, 150)

    invoke<FitsPreviewResult>('get_fits_preview', { filePath })
      .then((result) => {
        if (!cancelled) {
          clearTimeout(loadingTimer)
          const prev = lastPreviewSizeRef.current
          const sameSize = prev != null && prev.w === result.width && prev.h === result.height
          lastPreviewSizeRef.current = { w: result.width, h: result.height }
          if (!sameSize) {
            initialFitDoneRef.current = false
          }
          setPreview(result)
          setImageUrl(convertFileSrc(result.imagePath) + '?t=' + Date.now())
          setImageLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          clearTimeout(loadingTimer)
          setError(String(err))
          setImageLoading(false)
        }
      })

    return () => {
      cancelled = true
      clearTimeout(loadingTimer)
    }
  }, [filePath])

  // Mouse handlers for pan
  const handleMouseDown = (e: React.MouseEvent): void => {
    if (e.button === 0) {
      setDragging(true)
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y })
    }
  }

  const handleMouseMove = (e: React.MouseEvent): void => {
    if (dragging) {
      setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y })
    }
  }

  const handleMouseUp = (): void => {
    setDragging(false)
  }

  const containerRef = useRef<HTMLDivElement>(null)

  const handleWheel = (e: React.WheelEvent): void => {
    e.preventDefault()
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return

    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top

    const oldZoom = zoom
    const delta = e.deltaY > 0 ? -0.1 : 0.1
    const newZoom = Math.max(0.1, Math.min(10, oldZoom + delta))

    const scale = newZoom / oldZoom
    const newPanX = mouseX - scale * (mouseX - pan.x)
    const newPanY = mouseY - scale * (mouseY - pan.y)

    setZoom(newZoom)
    setPan({ x: newPanX, y: newPanY })
  }

  const resetView = (): void => {
    fitToView()
  }

  // Extract filename from path
  const filename = filePath.split('/').pop() || filePath

  if (error) {
    return (
      <div className="empty-state">
        <h3>Failed to load FITS file</h3>
        <p style={{ color: 'var(--color-error)' }}>{error}</p>
        <button className="btn" style={{ marginTop: 16 }} onClick={() => navigate(-1)}>
          <ArrowLeft size={14} /> Go Back
        </button>
      </div>
    )
  }

  const displayHeader = headerData || preview?.header || null
  const bayerpat = displayHeader?.bayerpat
  const naxis3 = displayHeader?.naxis3 || 1
  const hasBayer =
    naxis3 <= 1 &&
    bayerpat != null &&
    ['RGGB', 'BGGR', 'GRBG', 'GBRG'].includes(String(bayerpat).toUpperCase())
  const isColor = hasBayer || naxis3 > 1

  const headerEntries = displayHeader
    ? Object.entries((displayHeader.raw as Record<string, unknown>) || {})
    : []

  return (
    <div style={{ display: 'flex', gap: 16, height: '100%' }}>
      {/* Image area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Gallery toolbar */}
        <div className="gallery-toolbar">
          <div className="gallery-toolbar-group">
            <button className="btn btn-sm" onClick={() => navigate(-1)}>
              <ArrowLeft size={14} /> Back
            </button>
          </div>

          {hasGallery && (
            <div className="gallery-toolbar-group">
              <button
                className="btn btn-sm"
                onClick={goPrev}
                disabled={!hasPrev}
                title="Previous frame (Left arrow)"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="gallery-counter">
                {currentIndex >= 0 ? currentIndex + 1 : '?'} / {frames.length}
              </span>
              <button
                className="btn btn-sm"
                onClick={goNext}
                disabled={!hasNext}
                title="Next frame (Right arrow)"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          )}

          {hasGallery && (
            <div className="gallery-toolbar-group gallery-scope-selector">
              {canShowSessionScope && (
                <button
                  className={`btn btn-sm ${scope === 'session' ? 'btn-primary' : ''}`}
                  onClick={() => navigate(scopeUrl('session'))}
                  title="Show frames from this night only"
                >
                  Night
                </button>
              )}
              {canShowFilterScope && (
                <button
                  className={`btn btn-sm ${scope === 'filter' ? 'btn-primary' : ''}`}
                  onClick={() => navigate(scopeUrl('filter'))}
                  title="Show frames from all nights of this filter"
                >
                  Filter
                </button>
              )}
              {canShowProjectScope && (
                <button
                  className={`btn btn-sm ${scope === 'project' ? 'btn-primary' : ''}`}
                  onClick={() => navigate(scopeUrl('project'))}
                  title="Show all frames in this project"
                >
                  Project
                </button>
              )}
            </div>
          )}

          <div className="gallery-toolbar-group">
            <button
              className="btn btn-sm"
              onClick={() => invoke('show_in_folder', { path: filePath })}
              title="Show in Explorer"
            >
              <FolderOpen size={14} />
            </button>
          </div>

          <div style={{ flex: 1 }} />

          <div className="gallery-toolbar-group">
            {isColor && (
              <span className="badge badge-info" style={{ fontSize: 10 }}>
                {hasBayer ? `Bayer ${String(bayerpat).toUpperCase()}` : 'RGB'}
              </span>
            )}
            {preview && (
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                {preview.originalWidth}x{preview.originalHeight}
                {preview.width !== preview.originalWidth && (
                  <> (preview {preview.width}x{preview.height})</>
                )}
              </span>
            )}
          </div>

          <div className="gallery-toolbar-group">
            <button
              className="btn btn-sm"
              onClick={() => {
                const rect = containerRef.current?.getBoundingClientRect()
                if (!rect) { setZoom((z) => Math.min(10, z + 0.25)); return }
                const cx = rect.width / 2
                const cy = rect.height / 2
                const newZoom = Math.min(10, zoom + 0.25)
                const scale = newZoom / zoom
                setPan({ x: cx - scale * (cx - pan.x), y: cy - scale * (cy - pan.y) })
                setZoom(newZoom)
              }}
            >
              <ZoomIn size={14} />
            </button>
            <span
              style={{
                fontSize: 12,
                color: 'var(--color-text-muted)',
                minWidth: 40,
                textAlign: 'center',
              }}
            >
              {Math.round(zoom * 100)}%
            </span>
            <button
              className="btn btn-sm"
              onClick={() => {
                const rect = containerRef.current?.getBoundingClientRect()
                if (!rect) { setZoom((z) => Math.max(0.1, z - 0.25)); return }
                const cx = rect.width / 2
                const cy = rect.height / 2
                const newZoom = Math.max(0.1, zoom - 0.25)
                const scale = newZoom / zoom
                setPan({ x: cx - scale * (cx - pan.x), y: cy - scale * (cy - pan.y) })
                setZoom(newZoom)
              }}
            >
              <ZoomOut size={14} />
            </button>
            <button className="btn btn-sm" onClick={resetView}>
              <RotateCcw size={14} />
            </button>
          </div>
        </div>

        {/* Filename display */}
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 4, fontFamily: 'var(--font-mono)' }}>
          {filename}
        </div>

        {/* Preview generation progress */}
        {previewProgress && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, fontSize: 12, color: 'var(--color-text-muted)' }}>
            <div className="spinner" style={{ width: 12, height: 12 }} />
            <span>Generating previews: {previewProgress.current}/{previewProgress.total}</span>
            <div className="progress-bar" style={{ flex: 1, height: 3 }}>
              <div
                className="progress-bar-fill"
                style={{ width: `${(previewProgress.current / previewProgress.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        {imageLoading ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--color-bg-primary)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border)',
              flexDirection: 'column',
              gap: 16,
            }}
          >
            <div className="spinner" />
            <span style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
              Loading image data...
            </span>
          </div>
        ) : (
          <div
            ref={containerRef}
            style={{
              flex: 1,
              overflow: 'hidden',
              background: 'var(--color-bg-primary)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border)',
              cursor: dragging ? 'grabbing' : 'grab',
              position: 'relative',
            }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onWheel={handleWheel}
          >
            {imageUrl && (
              <img
                src={imageUrl}
                alt="FITS preview"
                draggable={false}
                onLoad={handleImageLoad}
                style={{
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  transformOrigin: '0 0',
                  imageRendering: zoom > 2 ? 'pixelated' : 'auto',
                  display: 'block',
                }}
              />
            )}
          </div>
        )}

      </div>

      {/* Header sidebar */}
      <div
        style={{
          width: 320,
          minWidth: 320,
          overflow: 'auto',
          background: 'var(--color-bg-secondary)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-border)',
          padding: 16,
        }}
      >
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>FITS Header</h3>

        {headerLoading ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              color: 'var(--color-text-muted)',
              fontSize: 13,
            }}
          >
            <div className="spinner" style={{ width: 16, height: 16 }} />
            Loading header...
          </div>
        ) : displayHeader ? (
          <>
            <div style={{ marginBottom: 16 }}>
              {displayHeader.object != null && (
                <HeaderRow label="Object" value={String(displayHeader.object)} />
              )}
              {displayHeader.exptime != null && (
                <HeaderRow label="Exposure" value={`${String(displayHeader.exptime)}s`} />
              )}
              {displayHeader.ccdTemp != null && (
                <HeaderRow
                  label="Temperature"
                  value={`${String(displayHeader.ccdTemp)}\u00B0C`}
                />
              )}
              {displayHeader.filter != null && (
                <HeaderRow label="Filter" value={String(displayHeader.filter)} />
              )}
              {displayHeader.dateObs != null && (
                <HeaderRow label="Date" value={String(displayHeader.dateObs)} />
              )}
              {displayHeader.instrume != null && (
                <HeaderRow label="Camera" value={String(displayHeader.instrume)} />
              )}
              {displayHeader.telescop != null && (
                <HeaderRow label="Telescope" value={String(displayHeader.telescop)} />
              )}
              {displayHeader.gain != null && (
                <HeaderRow label="Gain" value={String(displayHeader.gain)} />
              )}
              {displayHeader.bayerpat != null && (
                <HeaderRow label="Bayer Pattern" value={String(displayHeader.bayerpat)} />
              )}
              <HeaderRow
                label="Dimensions"
                value={`${String(displayHeader.naxis1)} x ${String(displayHeader.naxis2)}`}
              />
              <HeaderRow label="Bit Depth" value={`${String(displayHeader.bitpix)}-bit`} />
            </div>

            <h4
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--color-text-muted)',
                marginBottom: 8,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                userSelect: 'none',
              }}
              onClick={toggleKeywords}
            >
              {keywordsExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              All Keywords ({headerEntries.length})
            </h4>

            {keywordsExpanded && (
              <table className="table" style={{ fontSize: 11 }}>
                <thead>
                  <tr>
                    <th>Keyword</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {headerEntries.map(([key, val]) => (
                    <tr key={key}>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{key}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
                        {String(val)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        ) : null}
      </div>
    </div>
  )
}

function HeaderRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        padding: '4px 0',
        borderBottom: '1px solid var(--color-border)',
        fontSize: 12,
      }}
    >
      <span style={{ color: 'var(--color-text-muted)' }}>{label}</span>
      <span style={{ fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{value}</span>
    </div>
  )
}
