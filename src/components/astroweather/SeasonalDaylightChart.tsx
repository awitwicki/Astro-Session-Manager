import { useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { dayPhases, dayOfYear, type DayPhases } from '../../lib/sun'
import { listTimeZones, detectTimeZone, tzOffsetHours, zoneFromCoords } from '../../lib/timezone'

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
const Y_MIN = 12 // clock noon (top)
const Y_MAX = 36 // clock noon next day (bottom); 24 = midnight (centre)
const PLOT_W = W - PAD_L - PAD_R
const PLOT_H = H - PAD_T - PAD_B

const DAYLIGHT = '#6a93ba'
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

// Clock hour [0,24) → plot Y window [12,36) (noon-top, midnight-centre).
const toWindow = (clock: number) => (clock < 12 ? clock + 24 : clock)
const xForIndex = (i: number) => PAD_L + (i / (DAYS - 1)) * PLOT_W
const xForDay = (v: number) => xForIndex(v - 1)
const yScale = (win: number) => PAD_T + ((win - Y_MIN) / (Y_MAX - Y_MIN)) * PLOT_H

// Per-threshold dusk/dawn lookups (index aligns with REGIONS and bandKinds).
const DUSK = [
  (p: DayPhases) => p.sunset, (p: DayPhases) => p.civilDusk,
  (p: DayPhases) => p.nauticalDusk, (p: DayPhases) => p.astroDusk,
]
const DAWN = [
  (p: DayPhases) => p.sunrise, (p: DayPhases) => p.civilDawn,
  (p: DayPhases) => p.nauticalDawn, (p: DayPhases) => p.astroDawn,
]

// Plot-window boundaries {up, down} of region `idx` for day `p`.
function regionBoundary(p: DayPhases, idx: number): { up: number; down: number } {
  const kind = p.bandKinds[idx]
  if (kind === 'alwaysBelow') return { up: Y_MIN, down: Y_MAX } // darker than this all day → fill
  if (kind === 'alwaysAbove') { const c = toWindow(p.nightCenter); return { up: c, down: c } } // never this dark → collapse
  const dusk = DUSK[idx](p)
  const dawn = DAWN[idx](p)
  if (dusk === null || dawn === null) { const c = toWindow(p.nightCenter); return { up: c, down: c } }
  return { up: toWindow(dusk), down: toWindow(dawn) }
}

// Sentinel select value: resolve the zone from the chart's coordinates.
const AUTO_TZ = 'auto'

// tzdata renamed the zone; ICU keeps listing the old spelling.
const zoneLabel = (z: string) => (z === 'Europe/Kiev' ? 'Europe/Kyiv' : z)

const pad2 = (n: number) => String(n).padStart(2, '0')
function fmtClock(h: number | null): string {
  if (h === null) return '—'
  let hh = Math.floor(h)
  let mm = Math.round((h - hh) * 60)
  if (mm === 60) { mm = 0; hh = (hh + 1) % 24 }
  return `${pad2(hh)}:${pad2(mm)}`
}
function fmtDur(hours: number): string {
  const total = Math.round(hours * 60)
  return `${Math.floor(total / 60)}h ${pad2(total % 60)}m`
}

export function SeasonalDaylightChart({ lat, lon }: SeasonalDaylightChartProps) {
  const zones = useMemo(() => listTimeZones(), [])
  const refYear = useMemo(() => new Date().getFullYear(), [])
  const [tz, setTz] = useState<string>(AUTO_TZ)
  const [hoverDay, setHoverDay] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  // Load the saved timezone once.
  useEffect(() => {
    invoke<Record<string, unknown>>('get_all_settings').then((s) => {
      if (typeof s.daylightTimezone === 'string' && s.daylightTimezone) setTz(s.daylightTimezone)
    }).catch(() => {})
  }, [])

  // In auto mode the location's own zone (and thus its DST rules) wins; the
  // machine's zone is only the no-location fallback.
  const effectiveTz = useMemo(() => {
    if (tz !== AUTO_TZ) return tz
    return (lat !== null && lon !== null ? zoneFromCoords(lat, lon) : null) ?? detectTimeZone()
  }, [tz, lat, lon])

  // Per-day DST-aware offset (recomputed when the zone changes).
  const offsets = useMemo(() => {
    const arr: number[] = []
    for (let d = 1; d <= DAYS; d++) arr.push(tzOffsetHours(effectiveTz, new Date(Date.UTC(refYear, 0, d, 12))))
    return arr
  }, [effectiveTz, refYear])

  // Per-day phases (clock time).
  const cols = useMemo(() => {
    if (lat === null || lon === null) return null
    const arr: DayPhases[] = []
    for (let d = 1; d <= DAYS; d++) arr.push(dayPhases(lat, lon, d, offsets[d - 1]))
    return arr
  }, [lat, lon, offsets])

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const vx = ((e.clientX - rect.left) / rect.width) * W
    const i = Math.round(((vx - PAD_L) / PLOT_W) * (DAYS - 1))
    setHoverDay(i >= 0 && i < DAYS ? i : null)
  }

  const tzOptions = tz === AUTO_TZ || zones.includes(tz) ? zones : [tz, ...zones]

  function onTz(e: React.ChangeEvent<HTMLSelectElement>) {
    const v = e.target.value
    setTz(v)
    invoke('set_setting', { key: 'daylightTimezone', value: v }).catch(() => {})
  }

  if (lat === null || lon === null || cols === null) {
    return (
      <div className="empty-state">
        <h3>No Location Set</h3>
        <p>Click “Set Location” to pick your coordinates on the map</p>
      </div>
    )
  }

  const today = Math.min(dayOfYear(new Date()), DAYS)
  const regionPath = (idx: number) => {
    const up = cols
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${xForIndex(i).toFixed(1)},${yScale(regionBoundary(p, idx).up).toFixed(1)}`)
      .join(' ')
    const down = cols
      .map((p, i) => ({ i, v: regionBoundary(p, idx).down }))
      .reverse()
      .map((o) => `L${xForIndex(o.i).toFixed(1)},${yScale(o.v).toFixed(1)}`)
      .join(' ')
    return `${up} ${down} Z`
  }

  const hovered = hoverDay !== null ? cols[hoverDay] : null

  return (
    <div className="daylight-chart">
      <div className="daylight-toolbar">
        <label htmlFor="daylight-tz">Timezone</label>
        <select id="daylight-tz" className="daylight-tz-select" value={tz} onChange={onTz}>
          <option value={AUTO_TZ}>Auto — {zoneLabel(effectiveTz)}</option>
          {tzOptions.map((z) => (
            <option key={z} value={z}>{zoneLabel(z)}</option>
          ))}
        </select>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="daylight-chart-svg"
        role="img"
        aria-label="Seasonal daylight and astronomical darkness across the year (local time)"
        onMouseMove={onMove}
        onMouseLeave={() => setHoverDay(null)}
      >
        <rect x={PAD_L} y={PAD_T} width={PLOT_W} height={PLOT_H} fill={DAYLIGHT} />

        {REGIONS.map((r, idx) => (
          <path key={r.label} d={regionPath(idx)} fill={r.color} stroke="none" />
        ))}

        {hoverDay !== null && (
          <line
            x1={xForIndex(hoverDay)} y1={PAD_T} x2={xForIndex(hoverDay)} y2={H - PAD_B}
            stroke="var(--color-text-primary)" strokeWidth={1} strokeDasharray="2 2" opacity={0.7}
          />
        )}

        <line
          x1={xForDay(today)} y1={PAD_T} x2={xForDay(today)} y2={H - PAD_B}
          stroke="var(--color-error)" strokeWidth={1} strokeDasharray="3 2"
        />

        <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} stroke="var(--color-border)" />
        <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={H - PAD_B} stroke="var(--color-border)" />

        {Y_TICKS.map((t) => (
          <text key={t.h} x={PAD_L - 6} y={yScale(t.h) + 3} textAnchor="end" fontSize={10} fill="var(--color-text-muted)">
            {t.l}
          </text>
        ))}
        {MONTHS.map((m) => (
          <text key={m.v} x={xForDay(m.v)} y={H - 10} textAnchor="middle" fontSize={10} fill="var(--color-text-muted)">
            {m.l}
          </text>
        ))}
      </svg>

      {hovered && hoverDay !== null && (
        <div className="daylight-hover-panel">
          <div className="daylight-hover-date">
            {new Date(refYear, 0, hoverDay + 1).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </div>
          <div>
            {hovered.sunUpAllDay
              ? 'Sun up all day'
              : hovered.sunDownAllDay
                ? 'Sun down all day'
                : `Sunrise ${fmtClock(hovered.sunrise)} · Sunset ${fmtClock(hovered.sunset)}`}
          </div>
          <div>Daylight: {hovered.daylightHours !== null ? fmtDur(hovered.daylightHours) : '—'}</div>
          <div className="daylight-hover-dark">
            Astro night:{' '}
            {hovered.darkHours > 0
              ? `${fmtClock(hovered.astroDusk)}–${fmtClock(hovered.astroDawn)} (${fmtDur(hovered.darkHours)})`
              : 'none'}
          </div>
        </div>
      )}

      <div className="daylight-chart-legend">
        <span><i className="daylight-swatch" style={{ background: DAYLIGHT }} /> Daylight</span>
        {REGIONS.map((r) => (
          <span key={r.label}><i className="daylight-swatch" style={{ background: r.color }} /> {r.label}</span>
        ))}
      </div>
    </div>
  )
}
