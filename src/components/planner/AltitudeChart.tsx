import { useMemo, useState } from 'react'
import { altAzCurve, azimuthTicks, sunAltitudes } from '../../lib/ephemeris'
import { azToCompass } from '../../lib/formatters'
import { horizonAltAt, type HorizonProfile } from '../../lib/horizon'
import { twilightBands } from '../../lib/twilightBands'

interface AltitudeChartProps {
  raDeg: number
  decDeg: number
  lat: number
  lon: number
  dayStart: Date          // start of the plotted 24h window — pass a value
                          // from nightWindowStart() so night sits centered
                          // instead of split across both edges
  markerTime?: Date | null
  horizon?: HorizonProfile | null
  width?: number
  height?: number
  onPickTime?: (time: Date) => void
  showAzimuth?: boolean
}

const PAD_X = 4
const PAD_TOP = 6
const PAD_BOTTOM = 16
const DAY_MS = 86_400_000
const TICK_HOURS = [0, 6, 12, 18, 24]

export function AltitudeChart({
  raDeg, decDeg, lat, lon, dayStart, markerTime = null, horizon = null,
  width = 320, height = 110, onPickTime, showAzimuth = false,
}: AltitudeChartProps) {
  const dayMs = dayStart.getTime()
  const plotW = width - PAD_X * 2
  const padBottom = showAzimuth ? PAD_BOTTOM + 14 : PAD_BOTTOM
  const plotH = height - PAD_TOP - padBottom
  const [hoverFrac, setHoverFrac] = useState<number | null>(null)

  // Explicit useMemo, not compiler-inferred: the compiler folds these into a
  // memo scope guarded by hoverFrac, which would redo all the ephemeris math
  // on every hover mousemove.
  const curve = useMemo(
    () => altAzCurve(raDeg, decDeg, dayStart, lat, lon),
    [raDeg, decDeg, dayStart, lat, lon],
  )
  const bands = useMemo(
    () => twilightBands(sunAltitudes(dayStart, lat, lon)),
    [dayStart, lat, lon],
  )
  const azTicks = useMemo(
    () => (showAzimuth ? azimuthTicks(curve, TICK_HOURS) : null),
    [showAzimuth, curve],
  )

  const x = (i: number) => PAD_X + (i / (curve.length - 1)) * plotW
  const y = (alt: number) => PAD_TOP + (1 - Math.max(alt, 0) / 90) * plotH
  const pathD = curve
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.alt).toFixed(1)}`)
    .join('')

  // The skyline at the azimuth the target actually occupies at each moment —
  // so the filled region shows exactly when it is behind something.
  const terrainD = horizon
    ? curve
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(horizonAltAt(horizon, p.az)).toFixed(1)}`)
        .join('')
      + `L${(PAD_X + plotW).toFixed(1)},${(PAD_TOP + plotH).toFixed(1)}`
      + `L${PAD_X.toFixed(1)},${(PAD_TOP + plotH).toFixed(1)}Z`
    : null

  const markerFrac = markerTime ? (markerTime.getTime() - dayMs) / DAY_MS : null

  const handleClick = onPickTime
    ? (e: React.MouseEvent<SVGSVGElement>) => {
        const rect = e.currentTarget.getBoundingClientRect()
        const frac = Math.min(1, Math.max(0, (e.clientX - rect.left - PAD_X) / (rect.width - PAD_X * 2)))
        onPickTime(new Date(dayMs + Math.round((frac * 24 * 60) / 5) * 5 * 60_000))
      }
    : undefined

  const handleMouseMove = onPickTime
    ? (e: React.MouseEvent<SVGSVGElement>) => {
        const rect = e.currentTarget.getBoundingClientRect()
        setHoverFrac(Math.min(1, Math.max(0, (e.clientX - rect.left - PAD_X) / (rect.width - PAD_X * 2))))
      }
    : undefined
  const handleMouseLeave = onPickTime ? () => setHoverFrac(null) : undefined

  const hoverPt = hoverFrac !== null ? curve[Math.round(hoverFrac * (curve.length - 1))] : null
  const hoverX = hoverFrac !== null ? PAD_X + hoverFrac * plotW : 0
  const hoverY = hoverPt ? y(hoverPt.alt) : 0
  const hoverMin = hoverFrac !== null ? Math.round(hoverFrac * 24 * 60) : 0
  // Time-of-day from the window offset — dayStart is local noon (nightWindowStart),
  // matching the existing tick-label convention, so no timezone plumbing needed.
  const hoverTime = `${String(Math.floor(((12 * 60 + hoverMin) % 1440) / 60)).padStart(2, '0')}:${String(hoverMin % 60).padStart(2, '0')}`
  const hoverOnLeft = hoverFrac !== null && hoverFrac > 0.72

  return (
    <svg
      width={width}
      height={height}
      className={`altitude-chart${onPickTime ? ' altitude-chart--clickable' : ''}`}
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {bands.map((b, i) => (
        <rect
          key={i}
          className={`altitude-band altitude-band--${b.kind}`}
          x={PAD_X + b.startFrac * plotW}
          y={PAD_TOP}
          width={(b.endFrac - b.startFrac) * plotW}
          height={plotH}
        />
      ))}
      {terrainD && <path className="altitude-terrain" d={terrainD} />}
      <line
        className="altitude-horizon"
        x1={PAD_X} y1={PAD_TOP + plotH} x2={PAD_X + plotW} y2={PAD_TOP + plotH}
      />
      <path className="altitude-curve" d={pathD} fill="none" />
      {markerFrac !== null && markerFrac >= 0 && markerFrac <= 1 && (
        <line
          className="altitude-marker"
          x1={PAD_X + markerFrac * plotW} y1={PAD_TOP}
          x2={PAD_X + markerFrac * plotW} y2={PAD_TOP + plotH}
        />
      )}
      {TICK_HOURS.map((h) => (
        <text
          key={h}
          className="altitude-tick"
          x={PAD_X + (h / 24) * plotW}
          y={showAzimuth ? height - 18 : height - 4}
          textAnchor={h === 0 ? 'start' : h === 24 ? 'end' : 'middle'}
        >
          {String((12 + h) % 24).padStart(2, '0')}
        </text>
      ))}
      {azTicks && TICK_HOURS.map((h, i) => {
        const az = azTicks[i]
        return (
          <text
            key={`az-${h}`}
            className="altitude-az-tick"
            x={PAD_X + (h / 24) * plotW}
            y={height - 4}
            textAnchor={h === 0 ? 'start' : h === 24 ? 'end' : 'middle'}
          >
            {az === null
              ? '—'
              : <>{Math.round(az)}° <tspan className="altitude-az-compass">{azToCompass(az)}</tspan></>}
          </text>
        )
      })}
      {hoverPt && (
        <g className="altitude-hover">
          <line className="altitude-hover-line" x1={hoverX} y1={PAD_TOP} x2={hoverX} y2={PAD_TOP + plotH} />
          <line className="altitude-hover-line" x1={PAD_X} y1={hoverY} x2={PAD_X + plotW} y2={hoverY} />
          <circle className="altitude-hover-dot" cx={hoverX} cy={hoverY} r={3} />
          <text
            className="altitude-hover-label"
            x={hoverOnLeft ? hoverX - 8 : hoverX + 8}
            y={Math.max(hoverY - 8, PAD_TOP + 10)}
            textAnchor={hoverOnLeft ? 'end' : 'start'}
          >
            {hoverTime} · {hoverPt.alt.toFixed(1)}° / {Math.round(hoverPt.az)}° {azToCompass(hoverPt.az)}
          </text>
        </g>
      )}
    </svg>
  )
}
