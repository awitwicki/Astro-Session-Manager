import { useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { confirm, open, save } from '@tauri-apps/plugin-dialog'
import { Download, Trash2, Upload } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { persistHorizonProfile, useHorizonProfile } from '../../hooks/useHorizon'
import {
  formatHrz, horizonAltAt, nearestFreeAz, parseHrz, removePoint, setPoint,
  type HorizonPoint, type HorizonProfile,
} from '../../lib/horizon'

const W = 900
const H = 280
const PAD_L = 36
const PAD_R = 12
const PAD_T = 12
const PAD_B = 28

const CARDINALS: { az: number; label: string }[] = [
  { az: 0, label: 'N' }, { az: 45, label: 'NE' }, { az: 90, label: 'E' },
  { az: 135, label: 'SE' }, { az: 180, label: 'S' }, { az: 225, label: 'SW' },
  { az: 270, label: 'W' }, { az: 315, label: 'NW' }, { az: 360, label: 'N' },
]

// A brand-new profile starts flat: two anchors are the minimum a profile needs,
// and starting at 0 means "nothing blocked" until the user draws something.
const FLAT: HorizonProfile = { points: [{ az: 0, alt: 0 }, { az: 180, alt: 0 }], name: null }

export function HorizonEditor() {
  // useHorizonProfile (not the raw store selector) so the profile is actually
  // hydrated from settings on first mount — otherwise it reads as unset until
  // some other page happens to call the hook first.
  const profile = useHorizonProfile()
  const setProfile = useAppStore((s) => s.setHorizonProfile)
  const [status, setStatus] = useState<string | null>(null)
  // The point currently being dragged, identified by `originalAz` — its
  // *committed* azimuth, which stays stable through the whole gesture so the
  // dragged circle's `key` never changes mid-drag. Re-keying it would remount
  // the DOM node and drop pointer capture (the exact failure mode that caused
  // the delete bug this component used to have).
  const [drag, setDrag] = useState<{ originalAz: number; az: number; alt: number } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  // `profile` with the dragged point's committed entry swapped for its live
  // preview position — used only for the scale and silhouette, so both track
  // the drag in real time instead of jumping once on release.
  const liveProfile: HorizonProfile | null = !profile ? null
    : !drag ? profile
      : {
        ...profile,
        points: [...profile.points.filter((p) => p.az !== drag.originalAz), { az: drag.az, alt: drag.alt }]
          .sort((a, b) => a.az - b.az),
      }

  const plotW = W - PAD_L - PAD_R
  const plotH = H - PAD_T - PAD_B
  // Scale to the tallest obstruction so a low treeline is not a flat sliver,
  // with a floor so an empty profile still shows a usable range.
  const peak = liveProfile ? Math.max(...liveProfile.points.map((p) => p.alt)) : 0
  const topAlt = Math.min(90, Math.max(30, Math.ceil((peak + 10) / 10) * 10))

  const xOf = (az: number) => PAD_L + (az / 360) * plotW
  const yOf = (alt: number) => PAD_T + (1 - alt / topAlt) * plotH

  const commit = (next: HorizonProfile) => {
    setProfile(next)
    persistHorizonProfile(next)
  }

  /** Pointer position in chart units, clamped into the plot's valid range.
   *  Only returns null when the SVG element itself isn't mounted yet —
   *  azimuth clamps rather than rejects, the same as altitude already does,
   *  so a drag never "freezes" just because the pointer strays slightly past
   *  an edge (points at az 0 or 360 sit exactly on the plot's boundary, and a
   *  vertical drag there will naturally jitter left/right by a pixel or two). */
  const chartPos = (e: React.PointerEvent | React.MouseEvent) => {
    const svg = svgRef.current
    if (!svg) return null
    const r = svg.getBoundingClientRect()
    // The SVG scales to its container, so convert through the viewBox.
    const sx = ((e.clientX - r.left) / r.width) * W
    const sy = ((e.clientY - r.top) / r.height) * H
    const az = ((sx - PAD_L) / plotW) * 360
    const alt = (1 - (sy - PAD_T) / plotH) * topAlt
    return { az: Math.min(360, Math.max(0, az)), alt: Math.min(topAlt, Math.max(0, alt)) }
  }

  const handleChartClick = (e: React.MouseEvent<SVGRectElement>) => {
    const pos = chartPos(e)
    if (!pos) return
    commit(setPoint(profile ?? FLAT, pos.az, pos.alt))
    setStatus(null)
  }

  const handleHandleDown = (p: HorizonPoint) => (e: React.PointerEvent<SVGCircleElement>) => {
    // Only the primary (left) button starts a drag — a right-click is a
    // delete gesture, not a drag-start, and must never arm drag state.
    if (e.button !== 0) return
    e.stopPropagation()
    // Suppresses the browser's default text-selection drag, which otherwise
    // highlights the chart's axis labels as the pointer sweeps across them.
    e.preventDefault()
    setDrag({ originalAz: p.az, az: p.az, alt: p.alt })
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const handleHandleMove = (e: React.PointerEvent<SVGCircleElement>) => {
    if (!drag || !profile) return
    const pos = chartPos(e)
    if (!pos) return
    // Free azimuth so it can't land exactly on another point (which would
    // silently replace that point once the drag commits).
    const others = profile.points.filter((p) => p.az !== drag.originalAz).map((p) => p.az)
    setDrag({ ...drag, az: nearestFreeAz(others, pos.az), alt: pos.alt })
  }

  const handleHandleUp = (e: React.PointerEvent<SVGCircleElement>) => {
    if (drag && profile) {
      const withoutOriginal = { ...profile, points: profile.points.filter((p) => p.az !== drag.originalAz) }
      commit(setPoint(withoutOriginal, drag.az, drag.alt))
    }
    setDrag(null)
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  // Some platforms (e.g. right-clicking to delete a point) release pointer
  // capture — by removing the point's own element from the DOM — without
  // ever firing pointerup on it. Without this, drag state stays stuck on the
  // deleted point's azimuth and the next pointermove over any other handle
  // resurrects it as a phantom point.
  const handleHandleCancel = () => {
    setDrag(null)
  }

  const handleHandleContext = (az: number) => (e: React.MouseEvent<SVGCircleElement>) => {
    e.preventDefault()
    e.stopPropagation()
    if (!profile) return
    if (profile.points.length <= 2) {
      setStatus('A horizon needs at least two points')
      return
    }
    commit(removePoint(profile, az))
  }

  const handleImport = async () => {
    const path = await open({
      multiple: false,
      filters: [{ name: 'Horizon', extensions: ['hrz', 'txt'] }],
    })
    if (typeof path !== 'string') return
    try {
      const text = await invoke<string>('read_horizon_file', { filePath: path })
      const name = path.split(/[\\/]/).pop() ?? null
      const { profile: parsed, warnings } = parseHrz(text, name)
      if (!parsed) {
        setStatus(`Import failed — ${warnings.join('; ')}`)
        return
      }
      commit(parsed)
      const suffix = warnings.length > 0 ? ` — ${warnings.join('; ')}` : ''
      setStatus(`Imported ${parsed.points.length} points from ${name}${suffix}`)
    } catch (err) {
      setStatus(String(err))
    }
  }

  const handleExport = async () => {
    if (!profile) return
    const path = await save({
      defaultPath: profile.name ?? 'horizon.hrz',
      filters: [{ name: 'Horizon', extensions: ['hrz'] }],
    })
    if (!path) return
    try {
      await invoke('write_horizon_file', { filePath: path, contents: formatHrz(profile) })
      setStatus(`Exported ${profile.points.length} points to ${path}`)
    } catch (err) {
      setStatus(String(err))
    }
  }

  const handleClear = async () => {
    if (!profile) return
    const ok = await confirm(
      'Remove the horizon profile? Everything above 0° will count as visible again.',
      { title: 'Clear horizon', kind: 'warning' },
    )
    if (!ok) return
    setProfile(null)
    persistHorizonProfile(null)
    setStatus('Horizon cleared')
  }

  // One point per degree: the profile is piecewise-linear, so this is smooth
  // enough to read as a skyline without being expensive.
  const silhouette = (() => {
    if (!liveProfile) return ''
    const steps: string[] = []
    for (let az = 0; az <= 360; az++) {
      steps.push(`${xOf(az).toFixed(1)},${yOf(horizonAltAt(liveProfile, az)).toFixed(1)}`)
    }
    return `M${steps.join('L')}L${xOf(360).toFixed(1)},${yOf(0).toFixed(1)}`
      + `L${xOf(0).toFixed(1)},${yOf(0).toFixed(1)}Z`
  })()

  return (
    <div className="horizon-editor">
      <div className="horizon-toolbar">
        <button onClick={handleImport}><Upload size={14} /> Import .hrz…</button>
        <button onClick={handleExport} disabled={!profile}><Download size={14} /> Export .hrz…</button>
        <button onClick={handleClear} disabled={!profile}><Trash2 size={14} /> Clear</button>
        <span className="horizon-summary">
          {profile
            ? `${profile.name ?? 'Unsaved horizon'} · ${profile.points.length} points`
            : 'No horizon set'}
        </span>
      </div>

      {status !== null && <div className="horizon-status">{status}</div>}

      {!profile && (
        <div className="horizon-empty">
          No horizon set — everything above 0° counts as visible.
          Import a .hrz file, or click the chart below to start drawing your skyline.
        </div>
      )}

      <svg ref={svgRef} className="horizon-chart" viewBox={`0 0 ${W} ${H}`}>
        <rect
          className="horizon-plot"
          x={PAD_L} y={PAD_T} width={plotW} height={plotH}
          onClick={handleChartClick}
        />

        {[0, 15, 30, 45, 60, 75, 90].filter((a) => a <= topAlt).map((alt) => (
          <g key={alt}>
            <line
              className="horizon-grid"
              x1={PAD_L} y1={yOf(alt)} x2={PAD_L + plotW} y2={yOf(alt)}
            />
            <text className="horizon-axis" x={PAD_L - 6} y={yOf(alt) + 3} textAnchor="end">
              {alt}°
            </text>
          </g>
        ))}

        {CARDINALS.map(({ az, label }) => (
          <g key={`${az}-${label}`}>
            <line
              className="horizon-grid"
              x1={xOf(az)} y1={PAD_T} x2={xOf(az)} y2={PAD_T + plotH}
            />
            <text className="horizon-axis" x={xOf(az)} y={H - 8} textAnchor="middle">
              {label}
            </text>
          </g>
        ))}

        {liveProfile && <path className="horizon-silhouette" d={silhouette} />}

        {profile?.points.map((p) => {
          const dragging = drag !== null && drag.originalAz === p.az
          const az = dragging ? drag.az : p.az
          const alt = dragging ? drag.alt : p.alt
          return (
            <circle
              key={p.az}
              className="horizon-handle"
              cx={xOf(az)} cy={yOf(alt)} r={5}
              onPointerDown={handleHandleDown(p)}
              onPointerMove={handleHandleMove}
              onPointerUp={handleHandleUp}
              onPointerCancel={handleHandleCancel}
              onContextMenu={handleHandleContext(p.az)}
            />
          )
        })}

        {drag && (() => {
          const boxW = 92
          const boxH = 20
          const px = xOf(drag.az)
          const py = yOf(drag.alt)
          const cx = Math.min(PAD_L + plotW - boxW / 2, Math.max(PAD_L + boxW / 2, px))
          // Sits above the point by default; flips below when there's no room above.
          const above = py - 12 - boxH >= PAD_T
          const boxY = above ? py - 12 - boxH : py + 12
          return (
            <g className="horizon-drag-readout" pointerEvents="none">
              <rect x={cx - boxW / 2} y={boxY} width={boxW} height={boxH} rx={4} />
              <text x={cx} y={boxY + boxH / 2 + 4} textAnchor="middle">
                {`Az ${Math.round(drag.az)}° Alt ${Math.round(drag.alt)}°`}
              </text>
            </g>
          )
        })()}
      </svg>

      <p className="horizon-hint">
        Click the chart to add a point · drag a point to move it ·
        right-click a point to delete it
      </p>
    </div>
  )
}
