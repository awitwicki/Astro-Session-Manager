import { useEffect, useMemo, useRef, useState } from 'react'
import { Map, ZoomIn, ZoomOut, Crosshair } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import {
  extractSkyMapTargets,
  fovToPolygonCoords,
  computeInitialCenter,
  getTargetColor,
  getTargetFillColor,
  type SkyMapTarget,
} from '../lib/skymap'
import '../styles/skymap.css'

const LEGEND_ITEMS = [
  { label: 'Ha', color: '#ff4444' },
  { label: 'OIII', color: '#44ddaa' },
  { label: 'SII', color: '#ff8844' },
  { label: 'L', color: '#8888cc' },
  { label: 'RGB', color: '#5b9bd5' },
]

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

export function SkyMap() {
  const projects = useAppStore((s) => s.projects)
  const containerRef = useRef<HTMLDivElement>(null)
  const celestialInit = useRef(false)
  const [loading, setLoading] = useState(true)

  const targets = useMemo(() => extractSkyMapTargets(projects), [projects])
  const targetsRef = useRef(targets)

  useEffect(() => {
    targetsRef.current = targets
  }, [targets])

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

      const center = computeInitialCenter(targetsRef.current)

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
        projection: 'airy',
        transform: 'equatorial',
        center,
        interactive: true,
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

      // Add custom FOV overlay layer
      Celestial.add({
        type: 'raw',
        callback: () => { /* data loaded via props, no file to fetch */ },
        redraw: () => {
          const ctx = Celestial.context
          const proj = Celestial.map.projection()
          if (!ctx || !proj) return

          const currentTargets = targetsRef.current

          for (const target of currentTargets) {
            drawTarget(ctx, proj, target)
          }
        },
      })
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

    const observer = new ResizeObserver(() => {
      if (!celestialInit.current) return
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

  if (targets.length === 0) {
    return (
      <div className="skymap-page">
        <div className="skymap-empty">
          <Map size={64} />
          <h3>No Targets on Sky Map</h3>
          <p>
            Plate-solved FITS files with RA/DEC coordinates are needed to display
            targets on the sky map. Ensure your capture software saves WCS
            coordinate data in the FITS headers.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="skymap-page">
      <div
        ref={containerRef}
        id="celestial-map"
        className="skymap-container"
      />

      {loading && (
        <div className="skymap-loading">Loading sky map...</div>
      )}

      {/* Header overlay */}
      <div className="skymap-header">
        <div className="skymap-title">
          Sky Map
          <span className="skymap-title-count">
            {targets.length} target{targets.length !== 1 ? 's' : ''}
            {targets.length < projects.length && ` of ${projects.length} projects`}
          </span>
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
          <button
            className="skymap-btn"
            onClick={() => {
              try {
                const center = computeInitialCenter(targets)
                Celestial.rotate({ center })
              } catch {}
            }}
            title="Center on targets"
          >
            <Crosshair size={15} />
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="skymap-legend">
        {LEGEND_ITEMS.map((item) => (
          <div key={item.label} className="skymap-legend-item">
            <span
              className="skymap-legend-color"
              style={{ backgroundColor: item.color, color: item.color }}
            />
            {item.label}
          </div>
        ))}
      </div>
    </div>
  )
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
