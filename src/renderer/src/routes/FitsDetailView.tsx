import { useState, useEffect, useRef, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react'

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

interface FitsPixelData {
  header: FitsHeader
  pixels: number[]
  width: number
  height: number
}

const VALID_BAYER_PATTERNS = ['RGGB', 'BGGR', 'GRBG', 'GBRG']

// Midtone Transfer Function
function mtf(m: number, x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  return ((m - 1) * x) / ((2 * m - 1) * x - m)
}

// Auto-stretch using STF based on median + MAD
function autoStretch(pixels: Float32Array): { shadows: number; midtones: number; highlights: number } {
  const sampleSize = Math.min(pixels.length, 100000)
  const step = Math.max(1, Math.floor(pixels.length / sampleSize))
  const samples: number[] = []
  for (let i = 0; i < pixels.length; i += step) {
    samples.push(pixels[i])
  }
  samples.sort((a, b) => a - b)
  const median = samples[Math.floor(samples.length / 2)]
  const deviations = samples.map((v) => Math.abs(v - median))
  deviations.sort((a, b) => a - b)
  const mad = deviations[Math.floor(deviations.length / 2)] * 1.4826
  return {
    shadows: Math.max(0, median - 2.8 * mad),
    midtones: 0.25,
    highlights: Math.min(1, median + 10 * mad)
  }
}

// Debayer a single-channel Bayer-pattern image to RGB using bilinear interpolation
function debayer(
  mono: Float32Array,
  width: number,
  height: number,
  pattern: string
): { r: Float32Array; g: Float32Array; b: Float32Array } {
  const r = new Float32Array(width * height)
  const g = new Float32Array(width * height)
  const b = new Float32Array(width * height)

  const colorAt = (row: number, col: number): string =>
    pattern[(row % 2) * 2 + (col % 2)]

  const px = (row: number, col: number): number => {
    const cr = Math.max(0, Math.min(height - 1, row))
    const cc = Math.max(0, Math.min(width - 1, col))
    return mono[cr * width + cc]
  }

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i = row * width + col
      const color = colorAt(row, col)
      const val = mono[i]

      if (color === 'R') {
        r[i] = val
        g[i] = (px(row - 1, col) + px(row + 1, col) + px(row, col - 1) + px(row, col + 1)) / 4
        b[i] = (px(row - 1, col - 1) + px(row - 1, col + 1) + px(row + 1, col - 1) + px(row + 1, col + 1)) / 4
      } else if (color === 'B') {
        b[i] = val
        g[i] = (px(row - 1, col) + px(row + 1, col) + px(row, col - 1) + px(row, col + 1)) / 4
        r[i] = (px(row - 1, col - 1) + px(row - 1, col + 1) + px(row + 1, col - 1) + px(row + 1, col + 1)) / 4
      } else {
        g[i] = val
        const rowColor0 = pattern[(row % 2) * 2]
        if (rowColor0 === 'R' || rowColor0 === 'r') {
          r[i] = (px(row, col - 1) + px(row, col + 1)) / 2
          b[i] = (px(row - 1, col) + px(row + 1, col)) / 2
        } else {
          b[i] = (px(row, col - 1) + px(row, col + 1)) / 2
          r[i] = (px(row - 1, col) + px(row + 1, col)) / 2
        }
      }
    }
  }

  return { r, g, b }
}

export function FitsDetailView() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const filePath = searchParams.get('path') || ''

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [header, setHeader] = useState<FitsHeader | null>(null)
  const [pixelData, setPixelData] = useState<FitsPixelData | null>(null)
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
  const [autoStretched, setAutoStretched] = useState(false)

  // Phase 1: Load header quickly
  useEffect(() => {
    if (!filePath) return
    let cancelled = false
    setHeaderLoading(true)

    window.electronAPI.fits
      .readHeader(filePath)
      .then((data) => {
        if (!cancelled) {
          setHeader(data as FitsHeader)
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

  // Phase 2: Load pixel data (slower)
  useEffect(() => {
    if (!filePath) return
    let cancelled = false
    setImageLoading(true)
    setAutoStretched(false)

    window.electronAPI.fits
      .readPixelData(filePath)
      .then((data) => {
        if (!cancelled) {
          setPixelData(data as FitsPixelData)
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

  // Determine image type
  const bayerpat = (header?.bayerpat || pixelData?.header?.bayerpat) as string | undefined
  const naxis3 = (header?.naxis3 || pixelData?.header?.naxis3 || 1) as number
  const hasBayer = naxis3 <= 1 && bayerpat != null && VALID_BAYER_PATTERNS.includes(String(bayerpat).toUpperCase())
  const isColor = hasBayer || naxis3 > 1

  // Auto-stretch on first pixel data load
  useEffect(() => {
    if (!pixelData || autoStretched) return

    const { pixels, width, height } = pixelData
    const pixelCount = width * height

    // Normalize
    let min = Infinity
    let max = -Infinity
    for (let i = 0; i < pixels.length; i++) {
      if (pixels[i] < min) min = pixels[i]
      if (pixels[i] > max) max = pixels[i]
    }
    const range = max - min || 1
    const normalized = new Float32Array(pixels.length)
    for (let i = 0; i < pixels.length; i++) {
      normalized[i] = (pixels[i] - min) / range
    }

    if (hasBayer) {
      // Per-channel auto-stretch on debayered data
      const { r, g, b } = debayer(normalized, width, height, String(bayerpat).toUpperCase())
      const strR = autoStretch(r)
      const strG = autoStretch(g)
      const strB = autoStretch(b)
      // Use averaged values for the linked controls
      setShadows(Math.max(0, (strR.shadows + strG.shadows + strB.shadows) / 3))
      setHighlights(Math.min(1, (strR.highlights + strG.highlights + strB.highlights) / 3))
      setMidtones(0.25)
    } else if (naxis3 > 1) {
      // Per-channel averaged for multi-plane
      const stretches = []
      for (let c = 0; c < Math.min(naxis3, 3); c++) {
        const plane = normalized.subarray(c * pixelCount, (c + 1) * pixelCount)
        stretches.push(autoStretch(plane))
      }
      setShadows(Math.max(0, stretches.reduce((s, st) => s + st.shadows, 0) / stretches.length))
      setHighlights(Math.min(1, stretches.reduce((s, st) => s + st.highlights, 0) / stretches.length))
      setMidtones(0.25)
    } else {
      // Mono
      const str = autoStretch(normalized)
      setShadows(str.shadows)
      setHighlights(str.highlights)
      setMidtones(str.midtones)
    }

    setAutoStretched(true)
  }, [pixelData, autoStretched, hasBayer, bayerpat, naxis3])

  // Render to canvas
  const renderCanvas = useCallback(() => {
    if (!pixelData || !canvasRef.current) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const { pixels, width, height } = pixelData
    const pixelCount = width * height

    canvas.width = width
    canvas.height = height

    // Normalize to [0, 1]
    let min = Infinity
    let max = -Infinity
    for (let i = 0; i < pixels.length; i++) {
      if (pixels[i] < min) min = pixels[i]
      if (pixels[i] > max) max = pixels[i]
    }
    const range = max - min || 1
    const normalized = new Float32Array(pixels.length)
    for (let i = 0; i < pixels.length; i++) {
      normalized[i] = (pixels[i] - min) / range
    }

    const imageData = ctx.createImageData(width, height)
    const data = imageData.data

    if (hasBayer) {
      // Debayer and render as RGB
      const { r, g, b } = debayer(normalized, width, height, String(bayerpat).toUpperCase())
      for (let i = 0; i < pixelCount; i++) {
        let valR = (r[i] - shadows) / (highlights - shadows)
        valR = Math.max(0, Math.min(1, valR))
        if (valR > 0 && valR < 1) valR = mtf(midtones, valR)

        let valG = (g[i] - shadows) / (highlights - shadows)
        valG = Math.max(0, Math.min(1, valG))
        if (valG > 0 && valG < 1) valG = mtf(midtones, valG)

        let valB = (b[i] - shadows) / (highlights - shadows)
        valB = Math.max(0, Math.min(1, valB))
        if (valB > 0 && valB < 1) valB = mtf(midtones, valB)

        const j = i * 4
        data[j] = Math.round(valR * 255)
        data[j + 1] = Math.round(valG * 255)
        data[j + 2] = Math.round(valB * 255)
        data[j + 3] = 255
      }
    } else if (naxis3 > 1) {
      // Multi-plane RGB
      const channels = Math.min(naxis3, 3)
      for (let i = 0; i < pixelCount; i++) {
        const j = i * 4
        for (let c = 0; c < channels; c++) {
          let val = (normalized[c * pixelCount + i] - shadows) / (highlights - shadows)
          val = Math.max(0, Math.min(1, val))
          if (val > 0 && val < 1) val = mtf(midtones, val)
          data[j + c] = Math.round(val * 255)
        }
        for (let c = channels; c < 3; c++) {
          data[j + c] = 0
        }
        data[j + 3] = 255
      }
    } else {
      // Mono grayscale
      for (let i = 0; i < pixelCount; i++) {
        let val = (normalized[i] - shadows) / (highlights - shadows)
        val = Math.max(0, Math.min(1, val))
        if (val > 0 && val < 1) val = mtf(midtones, val)
        const byte = Math.round(val * 255)
        const j = i * 4
        data[j] = byte
        data[j + 1] = byte
        data[j + 2] = byte
        data[j + 3] = 255
      }
    }

    ctx.putImageData(imageData, 0, 0)
  }, [pixelData, shadows, midtones, highlights, hasBayer, bayerpat, naxis3])

  useEffect(() => {
    renderCanvas()
  }, [renderCanvas])

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

  const handleWheel = (e: React.WheelEvent): void => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? -0.1 : 0.1
    setZoom((z) => Math.max(0.1, Math.min(10, z + delta)))
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

  // Use header from either the fast header load or the pixel data response
  const displayHeader = header || pixelData?.header || null
  const headerEntries = displayHeader
    ? Object.entries((displayHeader.raw as Record<string, unknown>) || {})
    : []

  return (
    <div style={{ display: 'flex', gap: 16, height: '100%' }}>
      {/* Canvas area */}
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
          <div style={{ flex: 1 }} />
          <button className="btn btn-sm" onClick={() => setZoom((z) => Math.min(10, z + 0.25))}>
            <ZoomIn size={14} />
          </button>
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)', minWidth: 40, textAlign: 'center' }}>
            {Math.round(zoom * 100)}%
          </span>
          <button className="btn btn-sm" onClick={() => setZoom((z) => Math.max(0.1, z - 0.25))}>
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
              gap: 16
            }}
          >
            <div className="spinner" />
            <span style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Loading image data...</span>
          </div>
        ) : (
          <div
            style={{
              flex: 1,
              overflow: 'hidden',
              background: 'var(--color-bg-primary)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border)',
              cursor: dragging ? 'grabbing' : 'grab'
            }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onWheel={handleWheel}
          >
            <canvas
              ref={canvasRef}
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: '0 0',
                imageRendering: zoom > 2 ? 'pixelated' : 'auto'
              }}
            />
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
              fontSize: 12
            }}
          >
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-text-secondary)' }}>
              Shadows
              <input
                type="range"
                min="0"
                max="1"
                step="0.001"
                value={shadows}
                onChange={(e) => setShadows(Number(e.target.value))}
                style={{ width: 120 }}
              />
              <span style={{ minWidth: 40, color: 'var(--color-text-muted)' }}>
                {shadows.toFixed(3)}
              </span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-text-secondary)' }}>
              Midtones
              <input
                type="range"
                min="0.001"
                max="0.999"
                step="0.001"
                value={midtones}
                onChange={(e) => setMidtones(Number(e.target.value))}
                style={{ width: 120 }}
              />
              <span style={{ minWidth: 40, color: 'var(--color-text-muted)' }}>
                {midtones.toFixed(3)}
              </span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-text-secondary)' }}>
              Highlights
              <input
                type="range"
                min="0"
                max="1"
                step="0.001"
                value={highlights}
                onChange={(e) => setHighlights(Number(e.target.value))}
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
          padding: 16
        }}
      >
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>FITS Header</h3>

        {headerLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-text-muted)', fontSize: 13 }}>
            <div className="spinner" style={{ width: 16, height: 16 }} />
            Loading header...
          </div>
        ) : displayHeader ? (
          <>
            {/* Key properties */}
            <div style={{ marginBottom: 16 }}>
              {displayHeader.object != null && <HeaderRow label="Object" value={String(displayHeader.object)} />}
              {displayHeader.exptime != null && (
                <HeaderRow label="Exposure" value={`${String(displayHeader.exptime)}s`} />
              )}
              {displayHeader.ccdTemp != null && (
                <HeaderRow label="Temperature" value={`${String(displayHeader.ccdTemp)}\u00B0C`} />
              )}
              {displayHeader.filter != null && <HeaderRow label="Filter" value={String(displayHeader.filter)} />}
              {displayHeader.dateObs != null && <HeaderRow label="Date" value={String(displayHeader.dateObs)} />}
              {displayHeader.instrume != null && <HeaderRow label="Camera" value={String(displayHeader.instrume)} />}
              {displayHeader.telescop != null && <HeaderRow label="Telescope" value={String(displayHeader.telescop)} />}
              {displayHeader.gain != null && (
                <HeaderRow label="Gain" value={String(displayHeader.gain)} />
              )}
              {displayHeader.bayerpat != null && (
                <HeaderRow label="Bayer Pattern" value={String(displayHeader.bayerpat)} />
              )}
              <HeaderRow label="Dimensions" value={`${String(displayHeader.naxis1)} x ${String(displayHeader.naxis2)}`} />
              <HeaderRow label="Bit Depth" value={`${String(displayHeader.bitpix)}-bit`} />
            </div>

            <h4 style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 8 }}>
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
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--color-border)', fontSize: 12 }}>
      <span style={{ color: 'var(--color-text-muted)' }}>{label}</span>
      <span style={{ fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{value}</span>
    </div>
  )
}
