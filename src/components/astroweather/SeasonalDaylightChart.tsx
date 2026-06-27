import { useMemo } from 'react'
import { eveningCrossings, dayOfYear } from '../../lib/sun'

interface SeasonalDaylightChartProps {
  lat: number | null
  lon: number | null
}

const W = 760
const H = 380
const PAD_L = 46
const PAD_R = 14
const PAD_T = 16
const PAD_B = 30
const DAYS = 365
const Y_MIN = 12 // solar hours: 12:00 noon (top)
const Y_MAX = 36 // 12:00 noon next day (bottom); 24 = midnight (centre)

const DAYLIGHT = '#6a93ba'

// Nested darkness regions, painted light → dark over the daylight background.
// Index aligns with THRESHOLDS [0, -6, -12, -18] from sun.ts.
const REGIONS = [
  { color: '#3f5f80', label: 'Civil twilight' },
  { color: '#27405c', label: 'Nautical twilight' },
  { color: '#172a40', label: 'Astronomical twilight' },
  { color: '#0b0f16', label: 'Astronomical dark' },
]

const MONTHS = [
  { v: 1, l: 'Jan' }, { v: 32, l: 'Feb' }, { v: 60, l: 'Mar' }, { v: 91, l: 'Apr' },
  { v: 121, l: 'May' }, { v: 152, l: 'Jun' }, { v: 182, l: 'Jul' }, { v: 213, l: 'Aug' },
  { v: 244, l: 'Sep' }, { v: 274, l: 'Oct' }, { v: 305, l: 'Nov' }, { v: 335, l: 'Dec' },
]

const Y_TICKS = [
  { h: 12, l: '12:00' }, { h: 18, l: '18:00' }, { h: 24, l: '00:00' },
  { h: 30, l: '06:00' }, { h: 36, l: '12:00' },
]

export function SeasonalDaylightChart({ lat }: SeasonalDaylightChartProps) {
  const cols = useMemo(() => {
    if (lat === null) return null
    const arr: number[][] = []
    for (let d = 1; d <= DAYS; d++) arr.push(eveningCrossings(lat, d))
    return arr
  }, [lat])

  if (lat === null || cols === null) {
    return (
      <div className="empty-state">
        <h3>No Location Set</h3>
        <p>Click "Set Location" to pick your coordinates on the map</p>
      </div>
    )
  }

  const plotW = W - PAD_L - PAD_R
  const plotH = H - PAD_T - PAD_B
  const xForIndex = (i: number) => PAD_L + (i / (DAYS - 1)) * plotW
  const xForDay = (v: number) => xForIndex(v - 1)
  const y = (h: number) => PAD_T + ((h - Y_MIN) / (Y_MAX - Y_MIN)) * plotH

  // Polygon enclosing everything at/below threshold `idx`:
  // upper boundary = evening crossing time; lower boundary = 48 - evening (morning, by symmetry).
  const regionPath = (idx: number) => {
    const up = cols
      .map((c, i) => `${i === 0 ? 'M' : 'L'}${xForIndex(i).toFixed(1)},${y(c[idx]).toFixed(1)}`)
      .join(' ')
    const down = cols
      .map((c, i) => ({ i, h: 48 - c[idx] }))
      .reverse()
      .map((o) => `L${xForIndex(o.i).toFixed(1)},${y(o.h).toFixed(1)}`)
      .join(' ')
    return `${up} ${down} Z`
  }

  // Clamp to DAYS so the today-marker on Dec 31 of a leap year (day 366) stays on-axis.
  const today = Math.min(dayOfYear(new Date()), DAYS)

  return (
    <div className="daylight-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="daylight-chart-svg"
        role="img"
        aria-label="Seasonal daylight and astronomical darkness across the year"
      >
        {/* daylight background */}
        <rect x={PAD_L} y={PAD_T} width={plotW} height={plotH} fill={DAYLIGHT} />

        {/* nested darkness bands, light → dark */}
        {REGIONS.map((r, idx) => (
          <path key={r.label} d={regionPath(idx)} fill={r.color} stroke="none" />
        ))}

        {/* today marker */}
        <line
          x1={xForDay(today)}
          y1={PAD_T}
          x2={xForDay(today)}
          y2={H - PAD_B}
          stroke="var(--color-error)"
          strokeWidth={1}
          strokeDasharray="3 2"
        />

        {/* axes */}
        <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} stroke="var(--color-border)" />
        <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={H - PAD_B} stroke="var(--color-border)" />

        {/* y tick labels */}
        {Y_TICKS.map((t) => (
          <text key={t.h} x={PAD_L - 6} y={y(t.h) + 3} textAnchor="end" fontSize={10} fill="var(--color-text-muted)">
            {t.l}
          </text>
        ))}

        {/* x tick labels */}
        {MONTHS.map((m) => (
          <text key={m.v} x={xForDay(m.v)} y={H - 10} textAnchor="middle" fontSize={10} fill="var(--color-text-muted)">
            {m.l}
          </text>
        ))}
      </svg>

      <div className="daylight-chart-legend">
        <span><i className="daylight-swatch" style={{ background: DAYLIGHT }} /> Daylight</span>
        {REGIONS.map((r) => (
          <span key={r.label}><i className="daylight-swatch" style={{ background: r.color }} /> {r.label}</span>
        ))}
      </div>
    </div>
  )
}
