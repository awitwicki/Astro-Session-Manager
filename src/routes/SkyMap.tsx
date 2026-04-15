import { useEffect, useMemo, useRef, useState } from 'react'
import { ZoomIn, ZoomOut, Layers } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import {
  extractSkyMapTargets,
  fovToPolygonCoords,
  computeInitialCenter,
  getTargetColor,
  getTargetFillColor,
  type SkyMapTarget,
} from '../lib/skymap'
import { NSNS_RGB, NSNS_OHS, NSNS_HA, renderHiPSTiles, setHiPSRedrawCallback, type HiPSConfig } from '../lib/hips'
import '../styles/skymap.css'

const HIPS_SURVEYS: HiPSConfig[] = [NSNS_RGB, NSNS_OHS, NSNS_HA]

// Load d3-celestial via script tags (not ES modules).
// d3 v3 uses `this.d3 = d3` which needs `this === window` (non-strict mode).
// Vite's ESM pre-bundling runs code in strict mode, breaking this.
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve()
      return
    }
    const s = document.createElement('script')
    s.src = src
    s.onload = () => resolve()
    s.onerror = reject
    document.head.appendChild(s)
  })
}

let celestialLoadPromise: Promise<void> | null = null

function ensureCelestialLoaded(): Promise<void> {
  if (typeof window !== 'undefined' && (window as any).Celestial) {
    return Promise.resolve()
  }
  if (!celestialLoadPromise) {
    celestialLoadPromise = loadScript('/d3-celestial-data/d3.min.js')
      .then(() => loadScript('/d3-celestial-data/d3.geo.projection.min.js'))
      .then(() => loadScript('/d3-celestial-data/celestial.js'))
  }
  return celestialLoadPromise
}

// Module-level state so d3-celestial callbacks (which persist across remounts)
// always read the current value.
let activeHipsOverlay: HiPSConfig | null = null
let activeTargets: SkyMapTarget[] = []

export function SkyMap() {
  const projects = useAppStore((s) => s.projects)
  const containerRef = useRef<HTMLDivElement>(null)
  const celestialInit = useRef(false)
  const [loading, setLoading] = useState(true)
  const [hipsOverlay, setHipsOverlay] = useState<HiPSConfig | null>(activeHipsOverlay)
  const [pointerCoords, setPointerCoords] = useState<{ ra: number; dec: number } | null>(null)

  const targets = useMemo(() => extractSkyMapTargets(projects), [projects])

  useEffect(() => {
    activeTargets = targets
  }, [targets])

  useEffect(() => {
    activeHipsOverlay = hipsOverlay
    if (celestialInit.current) {
      try { Celestial.redraw() } catch {}
    }
  }, [hipsOverlay])

  // Initialize d3-celestial
  useEffect(() => {
    if (!containerRef.current || celestialInit.current) return
    let cancelled = false

    ensureCelestialLoaded().then(() => {
      if (cancelled || celestialInit.current || !containerRef.current) return
      if (typeof Celestial === 'undefined') {
        console.error('d3-celestial failed to load')
        return
      }
      celestialInit.current = true
      setLoading(false)

      const center = computeInitialCenter(activeTargets)

      // Size the canvas to fill the container
      const rect = containerRef.current.getBoundingClientRect()
      const containerWidth = Math.floor(rect.width)
      const containerAspect = rect.width / rect.height

      // Aitoff and most whole-sky projections have ~2:1 natural aspect.
      // Zoom so the projection fills the container height.
      const fillZoom = containerAspect < 2 ? 2 / containerAspect : 1

      Celestial.display({
        width: containerWidth,
        projectionRatio: containerAspect,
        container: 'celestial-map',
        datapath: '/d3-celestial-data/',
        projection: 'stereographic',
        transform: 'equatorial',
        center,
        interactive: true,
        disableAnimations: true,
        form: false,
        controls: false,
        zoomlevel: fillZoom,
        zoomextend: 12,
        adaptable: true,
        stars: {
          show: true,
          limit: 6,
          colors: true,
          size: 5,
          exponent: -0.28,
          names: true,
          proper: true,
          desig: false,
          namelimit: 2.5,
          namestyle: {
            fill: '#ddddbb',
            font: '11px -apple-system, BlinkMacSystemFont, sans-serif',
            align: 'left',
            baseline: 'top',
          },
          propernamestyle: {
            fill: '#ddddbb',
            font: '11px -apple-system, BlinkMacSystemFont, sans-serif',
            align: 'right',
            baseline: 'bottom',
          },
          propernamelimit: 1.5,
          style: { fill: '#ffffff', opacity: 0.85 },
        },
        dsos: {
          show: true,
          limit: 6,
          colors: true,
          size: 6,
          names: true,
          desig: true,
          namelimit: 4,
          namestyle: {
            fill: '#aaaacc',
            font: '10px -apple-system, BlinkMacSystemFont, sans-serif',
            align: 'left',
            baseline: 'top',
          },
        },
        constellations: {
          names: true,
          lines: true,
          bounds: false,
          desig: false,
          namestyle: {
            fill: '#3d4260',
            font: '13px -apple-system, BlinkMacSystemFont, sans-serif',
            align: 'center',
            baseline: 'middle',
          },
          linestyle: { stroke: '#1e2236', width: 1.2, opacity: 0.7 },
        },
        mw: {
          show: true,
          style: { fill: '#0d1525', opacity: 0.18 },
        },
        lines: {
          graticule: {
            show: true,
            style: { stroke: '#151929', width: 0.6, opacity: 0.8, dash: [2, 4] },
          },
          equatorial: { show: true, style: { stroke: '#2a3f5a', width: 1.2, opacity: 0.4 } },
          ecliptic: { show: false },
          galactic: { show: false },
        },
        background: {
          fill: '#070b14',
          stroke: '#1a1d27',
          opacity: 1,
          width: 1.5,
        },
      })

      // Remove d3-celestial's own window resize handler to prevent initial jump
      try {
        const d3ref = (globalThis as Record<string, unknown>)['d3'] as
          { select: (t: EventTarget) => { on: (e: string, h: null) => void } } | undefined
        d3ref?.select(globalThis).on('resize', null)
      } catch { /* ignore */ }

      // Register redraw callback for HiPS tile loading
      setHiPSRedrawCallback(() => {
        try { Celestial.redraw() } catch { /* ignore */ }
      })

      // Add custom overlay layer (HiPS background + FOV targets)
      Celestial.add({
        type: 'raw',
        callback: () => { /* data loaded via props/state, no file to fetch */ },
        redraw: () => {
          const ctx = Celestial.context
          const proj = Celestial.map.projection()
          if (!ctx || !proj) return

          // Draw HiPS survey background if enabled
          const overlay = activeHipsOverlay
          if (overlay) {
            const canvas = ctx.canvas
            renderHiPSTiles(ctx, proj, overlay, canvas.width, canvas.height, 0.7)
          }

          // Draw coordinate ticks at edges
          drawGridTicks(ctx, proj, ctx.canvas.width, ctx.canvas.height)

          const currentTargets = activeTargets
          for (const target of currentTargets) {
            drawTarget(ctx, proj, target)
          }
        },
      })

      // d3-celestial's async catalog loads (stars, DSOs, MW) can reset the
      // projection center after display(). Re-apply until all data has loaded.
      let reCenterCount = 0
      const reCenterInterval = setInterval(() => {
        try { Celestial.rotate({ center }) } catch { /* ignore */ }
        if (++reCenterCount >= 5) clearInterval(reCenterInterval)
      }, 300)
    })

    return () => {
      cancelled = true
    }
  }, [])

  // Handle resize — update canvas dimensions and preserve zoom
  useEffect(() => {
    if (!containerRef.current) return
    let prevWidth = containerRef.current.getBoundingClientRect().width
    let resizeTimer: ReturnType<typeof setTimeout>
    let firstFire = true

    const observer = new ResizeObserver(() => {
      if (!celestialInit.current) return
      // Skip the initial fire that happens immediately after observe()
      if (firstFire) { firstFire = false; return }
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        const el = containerRef.current
        if (!el) return
        const rect = el.getBoundingClientRect()
        const newWidth = Math.floor(rect.width)
        const newHeight = Math.floor(rect.height)
        if (newWidth <= 0 || newHeight <= 0) return
        if (Math.abs(newWidth - Math.floor(prevWidth)) < 2) return

        const proj = Celestial.mapProjection
        const currentScale = proj?.scale?.() ?? null

        try {
          Celestial.resize({ width: newWidth, projectionRatio: rect.width / rect.height })
        } catch { /* ignore */ }

        // Restore zoom proportionally to width change
        if (currentScale !== null && prevWidth > 0) {
          const freshScale = Celestial.mapProjection?.scale?.() ?? 1
          const targetScale = currentScale * (newWidth / prevWidth)
          const factor = targetScale / freshScale
          if (Math.abs(factor - 1) > 0.001) {
            try { Celestial.zoomBy(factor) } catch { /* ignore */ }
          }
        }

        prevWidth = rect.width
      }, 250)
    })
    observer.observe(containerRef.current)
    return () => {
      observer.disconnect()
      clearTimeout(resizeTimer)
    }
  }, [])

  return (
    <div className="skymap-page">
      <div
        ref={containerRef}
        id="celestial-map"
        className="skymap-container"
        onMouseMove={(e) => {
          if (!celestialInit.current) return
          const proj = Celestial.map?.projection?.()
          const inv = proj?.invert
          if (!inv) return
          const rect = e.currentTarget.getBoundingClientRect()
          const x = e.clientX - rect.left
          const y = e.clientY - rect.top
          const coord = inv([x, y])
          if (coord && !Number.isNaN(coord[0]) && !Number.isNaN(coord[1])) {
            setPointerCoords({ ra: ((coord[0] % 360) + 360) % 360, dec: coord[1] })
          } else {
            setPointerCoords(null)
          }
        }}
        onMouseLeave={() => setPointerCoords(null)}
      />

      {loading && (
        <div className="skymap-loading">Loading sky map...</div>
      )}

      {/* Header overlay */}
      <div className="skymap-header">
        <div className="skymap-title">
          Sky Map
          {targets.length > 0 && (
            <span className="skymap-title-count">
              {targets.length} target{targets.length !== 1 ? 's' : ''}
              {targets.length < projects.length && ` of ${projects.length} projects`}
            </span>
          )}
        </div>

        <div className="skymap-controls">
          <button
            className="skymap-btn"
            onClick={() => { try { Celestial.zoomBy(1.4) } catch {} }}
            title="Zoom in"
          >
            <ZoomIn size={15} />
          </button>
          <button
            className="skymap-btn"
            onClick={() => { try { Celestial.zoomBy(0.7) } catch {} }}
            title="Zoom out"
          >
            <ZoomOut size={15} />
          </button>
        
          <div className="skymap-controls-separator" />

          <div className="skymap-survey-dropdown">
            <button
              className={`skymap-btn${hipsOverlay ? ' skymap-btn-active' : ''}`}
              onClick={() => setHipsOverlay(hipsOverlay ? null : NSNS_RGB)}
              title="Toggle survey overlay"
            >
              <Layers size={15} />
            </button>
            {hipsOverlay && (
              <select
                className="skymap-survey-select"
                value={hipsOverlay.id}
                onChange={(e) => {
                  const survey = HIPS_SURVEYS.find((s) => s.id === e.target.value)
                  if (survey) setHipsOverlay(survey)
                }}
              >
                {HIPS_SURVEYS.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            )}
          </div>
        </div>
      </div>

      {/* Pointer coordinates */}
      {pointerCoords && (
        <div className="skymap-pointer-coords">
          RA {formatRA(pointerCoords.ra)} &nbsp; Dec {formatDec(pointerCoords.dec)}
        </div>
      )}
    </div>
  )
}

function formatRA(raDeg: number): string {
  const h = raDeg / 15
  const hours = Math.floor(h)
  const m = (h - hours) * 60
  const mins = Math.floor(m)
  const secs = (m - mins) * 60
  return `${hours}h ${String(mins).padStart(2, '0')}m ${secs.toFixed(1).padStart(4, '0')}s`
}

function formatDec(dec: number): string {
  const sign = dec >= 0 ? '+' : '-'
  const abs = Math.abs(dec)
  const deg = Math.floor(abs)
  const m = (abs - deg) * 60
  const mins = Math.floor(m)
  const secs = (m - mins) * 60
  return `${sign}${deg}° ${String(mins).padStart(2, '0')}′ ${secs.toFixed(0).padStart(2, '0')}″`
}

function drawGridTicks(
  ctx: CanvasRenderingContext2D,
  proj: ((coords: [number, number]) => [number, number] | null) & { invert?: (pt: [number, number]) => [number, number] | null },
  w: number,
  h: number
) {
  const inv = proj.invert
  if (!inv) return

  const margin = 4
  const tickLen = 6
  const labelFont = '10px -apple-system, BlinkMacSystemFont, sans-serif'
  const labelColor = '#6b7085'
  const tickColor = '#3d4260'

  // Sample edges to find where round RA/Dec values cross
  const samples = 300

  type EdgeHit = { x: number; y: number; label: string; edge: 'top' | 'bottom' | 'left' | 'right' }
  const hits: EdgeHit[] = []
  const placed = new Set<string>()

  // Normalize RA to [0, 360)
  const normRA = (ra: number) => ((ra % 360) + 360) % 360

  // RA tick spacing: every 1h (15°); Dec tick spacing: every 10°
  const raStep = 15
  const decStep = 10

  // Edges: [start, end, axis]
  const edges: { pts: (t: number) => [number, number]; edge: 'top' | 'bottom' | 'left' | 'right' }[] = [
    { pts: (t) => [margin + t * (w - 2 * margin), margin], edge: 'top' },
    { pts: (t) => [margin + t * (w - 2 * margin), h - margin], edge: 'bottom' },
    { pts: (t) => [margin, margin + t * (h - 2 * margin)], edge: 'left' },
    { pts: (t) => [w - margin, margin + t * (h - 2 * margin)], edge: 'right' },
  ]

  for (const { pts, edge } of edges) {
    let prevCoord: [number, number] | null = null
    for (let i = 0; i <= samples; i++) {
      const t = i / samples
      const screenPt = pts(t)
      const coord = inv(screenPt)
      if (!coord || Number.isNaN(coord[0]) || Number.isNaN(coord[1])) {
        prevCoord = null
        continue
      }
      const ra = normRA(coord[0])
      const dec = coord[1]

      if (prevCoord) {
        const prevRA = normRA(prevCoord[0])
        const prevDec = prevCoord[1]

        // Check RA crossings (horizontal axis — top/bottom edges preferred)
        for (let raVal = 0; raVal < 360; raVal += raStep) {
          // Handle wrapping: check if raVal is between prevRA and ra
          let crossed = false
          if (Math.abs(ra - prevRA) < 180) {
            crossed = (prevRA <= raVal && ra >= raVal) || (prevRA >= raVal && ra <= raVal)
          }
          if (crossed) {
            const key = `ra-${raVal}-${edge}`
            if (!placed.has(key)) {
              placed.add(key)
              // Interpolate position
              const frac = Math.abs(raVal - prevRA) / Math.abs(ra - prevRA)
              const prevPt = pts((i - 1) / samples)
              const x = prevPt[0] + frac * (screenPt[0] - prevPt[0])
              const y = prevPt[1] + frac * (screenPt[1] - prevPt[1])
              const hours = Math.round(raVal / 15)
              hits.push({ x, y, label: `${hours}h`, edge })
            }
          }
        }

        // Check Dec crossings
        for (let decVal = -80; decVal <= 80; decVal += decStep) {
          if (decVal === 0) continue // skip equator, already shown as a line
          const crossed = (prevDec <= decVal && dec >= decVal) || (prevDec >= decVal && dec <= decVal)
          if (crossed) {
            const key = `dec-${decVal}-${edge}`
            if (!placed.has(key)) {
              placed.add(key)
              const frac = Math.abs(decVal - prevDec) / Math.abs(dec - prevDec)
              const prevPt = pts((i - 1) / samples)
              const x = prevPt[0] + frac * (screenPt[0] - prevPt[0])
              const y = prevPt[1] + frac * (screenPt[1] - prevPt[1])
              hits.push({ x, y, label: `${decVal > 0 ? '+' : ''}${decVal}°`, edge })
            }
          }
        }
      }
      prevCoord = coord
    }
  }

  // Draw ticks and labels
  ctx.save()
  ctx.font = labelFont
  ctx.fillStyle = labelColor
  ctx.strokeStyle = tickColor
  ctx.lineWidth = 1

  for (const hit of hits) {
    ctx.beginPath()
    switch (hit.edge) {
      case 'top':
        ctx.moveTo(hit.x, hit.y)
        ctx.lineTo(hit.x, hit.y + tickLen)
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.stroke()
        ctx.fillText(hit.label, hit.x, hit.y + tickLen + 2)
        break
      case 'bottom':
        ctx.moveTo(hit.x, hit.y)
        ctx.lineTo(hit.x, hit.y - tickLen)
        ctx.textAlign = 'center'
        ctx.textBaseline = 'bottom'
        ctx.stroke()
        ctx.fillText(hit.label, hit.x, hit.y - tickLen - 2)
        break
      case 'left':
        ctx.moveTo(hit.x, hit.y)
        ctx.lineTo(hit.x + tickLen, hit.y)
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.stroke()
        ctx.fillText(hit.label, hit.x + tickLen + 2, hit.y)
        break
      case 'right':
        ctx.moveTo(hit.x, hit.y)
        ctx.lineTo(hit.x - tickLen, hit.y)
        ctx.textAlign = 'right'
        ctx.textBaseline = 'middle'
        ctx.stroke()
        ctx.fillText(hit.label, hit.x - tickLen - 2, hit.y)
        break
    }
  }

  ctx.restore()
}

function drawTarget(
  ctx: CanvasRenderingContext2D,
  proj: (coords: [number, number]) => [number, number] | null,
  target: SkyMapTarget
) {
  const corners = fovToPolygonCoords(target)
  const projected: [number, number][] = []
  for (const corner of corners) {
    const pt = proj(corner)
    if (!pt) return
    projected.push(pt)
  }
  if (projected.length < 4) return

  const color = getTargetColor(target.filters)
  const fillColor = getTargetFillColor(target.filters)

  ctx.save()
  ctx.shadowColor = color
  ctx.shadowBlur = 10
  ctx.strokeStyle = color
  ctx.lineWidth = 1.8
  ctx.globalAlpha = 0.9

  ctx.beginPath()
  ctx.moveTo(projected[0][0], projected[0][1])
  for (let i = 1; i < projected.length; i++) {
    ctx.lineTo(projected[i][0], projected[i][1])
  }
  ctx.closePath()
  ctx.stroke()

  ctx.shadowBlur = 0
  ctx.fillStyle = fillColor
  ctx.globalAlpha = 1
  ctx.fill()

  ctx.shadowBlur = 0
  ctx.strokeStyle = color
  ctx.lineWidth = 1.2
  ctx.globalAlpha = 0.7
  ctx.stroke()

  const labelName = target.objectName || target.projectName
  if (labelName) {
    const cx = (projected[0][0] + projected[2][0]) / 2
    const cy = (projected[0][1] + projected[2][1]) / 2
    const dx = projected[1][0] - projected[0][0]
    const dy = projected[1][1] - projected[0][1]
    const apparentWidth = Math.sqrt(dx * dx + dy * dy)

    ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = color
    ctx.globalAlpha = 0.85
    ctx.shadowColor = '#000'
    ctx.shadowBlur = 3

    if (apparentWidth > 40) {
      ctx.fillText(labelName, cx, cy)
    } else {
      const bottom = Math.max(projected[0][1], projected[1][1], projected[2][1], projected[3][1])
      ctx.fillText(labelName, cx, bottom + 12)
    }
  }

  ctx.restore()
}
