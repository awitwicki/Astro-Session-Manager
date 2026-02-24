import { useState, useEffect, useRef, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react'
import { invoke, convertFileSrc } from '@tauri-apps/api/core'

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
  shadows: number
  midtones: number
  highlights: number
  header: FitsHeader
}

export function FitsDetailView() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const filePath = searchParams.get('path') || ''

  const [preview, setPreview] = useState<FitsPreviewResult | null>(null)
  const [headerData, setHeaderData] = useState<FitsHeader | null>(null)
  const [headerLoading, setHeaderLoading] = useState(true)
  const [imageLoading, setImageLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [shadows, setShadows] = useState(0)
  const [midtones, setMidtones] = useState(0.25)
  const [highlights, setHighlights] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [imageUrl, setImageUrl] = useState<string>('')
  const [rendering, setRendering] = useState(false)

  // Debounce timer for slider changes
  const renderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Phase 1: Load header quickly
  useEffect(() => {
    if (!filePath) return
    let cancelled = false
    setHeaderLoading(true)

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

  // Phase 2: Load preview (binned + stretched image from backend)
  useEffect(() => {
    if (!filePath) return
    let cancelled = false
    setImageLoading(true)

    invoke<FitsPreviewResult>('get_fits_preview', { filePath })
      .then((result) => {
        if (!cancelled) {
          setPreview(result)
          setShadows(result.shadows)
          setMidtones(result.midtones)
          setHighlights(result.highlights)
          setImageUrl(convertFileSrc(result.imagePath) + '?t=' + Date.now())
          setImageLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(String(err))
          setImageLoading(false)
        }
      })

    return () => { cancelled = true }
  }, [filePath])

  // Re-render when stretch params change (debounced)
  const requestRerender = useCallback(
    (s: number, m: number, h: number) => {
      if (!filePath) return

      if (renderTimerRef.current) {
        clearTimeout(renderTimerRef.current)
      }

      renderTimerRef.current = setTimeout(() => {
        setRendering(true)
        invoke<FitsPreviewResult>('render_fits_preview', {
          filePath,
          shadows: s,
          midtones: m,
          highlights: h,
        })
          .then((result) => {
            setImageUrl(convertFileSrc(result.imagePath) + '?t=' + Date.now())
            setRendering(false)
          })
          .catch(() => {
            setRendering(false)
          })
      }, 150)
    },
    [filePath]
  )

  const handleShadowsChange = (val: number) => {
    setShadows(val)
    requestRerender(val, midtones, highlights)
  }

  const handleMidtonesChange = (val: number) => {
    setMidtones(val)
    requestRerender(shadows, val, highlights)
  }

  const handleHighlightsChange = (val: number) => {
    setHighlights(val)
    requestRerender(shadows, midtones, val)
  }

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

    // Mouse position relative to container
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top

    const oldZoom = zoom
    const delta = e.deltaY > 0 ? -0.1 : 0.1
    const newZoom = Math.max(0.1, Math.min(10, oldZoom + delta))

    // Adjust pan so the point under the cursor stays fixed
    const scale = newZoom / oldZoom
    const newPanX = mouseX - scale * (mouseX - pan.x)
    const newPanY = mouseY - scale * (mouseY - pan.y)

    setZoom(newZoom)
    setPan({ x: newPanX, y: newPanY })
  }

  const resetView = (): void => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

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
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
          <button className="btn btn-sm" onClick={() => navigate(-1)}>
            <ArrowLeft size={14} /> Back
          </button>
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
          {rendering && (
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Rendering...</span>
          )}
          <div style={{ flex: 1 }} />
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

        {/* Stretch controls */}
        {!imageLoading && (
          <div
            style={{
              display: 'flex',
              gap: 16,
              padding: '12px 0',
              alignItems: 'center',
              fontSize: 12,
            }}
          >
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                color: 'var(--color-text-secondary)',
              }}
            >
              Shadows
              <input
                type="range"
                min="0"
                max="1"
                step="0.001"
                value={shadows}
                onChange={(e) => handleShadowsChange(Number(e.target.value))}
                style={{ width: 120 }}
              />
              <span style={{ minWidth: 40, color: 'var(--color-text-muted)' }}>
                {shadows.toFixed(3)}
              </span>
            </label>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                color: 'var(--color-text-secondary)',
              }}
            >
              Midtones
              <input
                type="range"
                min="0.001"
                max="0.999"
                step="0.001"
                value={midtones}
                onChange={(e) => handleMidtonesChange(Number(e.target.value))}
                style={{ width: 120 }}
              />
              <span style={{ minWidth: 40, color: 'var(--color-text-muted)' }}>
                {midtones.toFixed(3)}
              </span>
            </label>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                color: 'var(--color-text-secondary)',
              }}
            >
              Highlights
              <input
                type="range"
                min="0"
                max="1"
                step="0.001"
                value={highlights}
                onChange={(e) => handleHighlightsChange(Number(e.target.value))}
                style={{ width: 120 }}
              />
              <span style={{ minWidth: 40, color: 'var(--color-text-muted)' }}>
                {highlights.toFixed(3)}
              </span>
            </label>
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
              }}
            >
              All Keywords ({headerEntries.length})
            </h4>

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
