import { useState } from 'react'
import { parseNum, formatNumber } from './shared'
import {
  BORTLE_ROWS, factorsAtBortle, factorsAtSqm, nearestBortleForSqm, timeRatio,
} from '../../lib/bortle'
import type { BortleFactors } from '../../lib/bortle'

const BASE_TIME_OPTIONS = Array.from({ length: 100 }, (_, i) => i + 1)

type TimeUnit = 'min' | 'h'
type SkyMode = 'bortle' | 'sqm'

function toMinutes(value: number, unit: TimeUnit): number {
  return unit === 'h' ? value * 60 : value
}

function formatDuration(totalMinutes: number): string {
  if (!Number.isFinite(totalMinutes) || totalMinutes < 0) return '—'
  const totalSec = Math.round(totalMinutes * 60)
  if (totalSec === 0) return '0 s'
  if (totalSec < 60) return `${totalSec} s`
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const parts: string[] = []
  if (h) parts.push(`${h} h`)
  if (m) parts.push(`${m} min`)
  if (s && !h) parts.push(`${s} s`)
  return parts.join(' ')
}

const UNIT_LABEL: Record<TimeUnit, string> = { min: 'min', h: 'h' }

function ResultCard({ label, value, ratio, unit }: {
  label: string
  value: number | null
  ratio: number | null
  unit: TimeUnit
}) {
  return (
    <div className="calc-result-card">
      <div className="calc-result-label">{label}</div>
      <div className="calc-result-value">
        {value === null ? '—' : `${formatNumber(value)} ${UNIT_LABEL[unit]}`}
      </div>
      <div className="calc-result-sub">
        {value === null || ratio === null
          ? ' '
          : `${formatDuration(toMinutes(value, unit))} · ×${formatNumber(ratio)}`}
      </div>
    </div>
  )
}

export function BortleCalculator() {
  const [mode, setMode] = useState<SkyMode>('bortle')
  const [baseTime, setBaseTime] = useState('1')
  const [unit, setUnit] = useState<TimeUnit>('h')
  const [fromBortle, setFromBortle] = useState('2')
  const [toBortle, setToBortle] = useState('5')
  const [fromSqm, setFromSqm] = useState('21.9')
  const [toSqm, setToSqm] = useState('20.0')
  const [customBroadband, setCustomBroadband] = useState('1.0')
  const [customHa, setCustomHa] = useState('1.0')
  const [customOiii, setCustomOiii] = useState('1.0')

  const isCustom = mode === 'bortle' && toBortle === 'custom'
  const fromSqmVal = parseNum(fromSqm)
  const toSqmVal = parseNum(toSqm)

  const fromFactors: BortleFactors | null = mode === 'bortle'
    ? factorsAtBortle(Number(fromBortle))
    : fromSqmVal !== null ? factorsAtSqm(fromSqmVal) : null

  const toFactors: BortleFactors | null = mode === 'bortle'
    ? isCustom
      ? { broadband: parseNum(customBroadband) ?? NaN, ha: parseNum(customHa) ?? NaN, oiii: parseNum(customOiii) ?? NaN }
      : factorsAtBortle(Number(toBortle))
    : toSqmVal !== null ? factorsAtSqm(toSqmVal) : null

  const ratios = fromFactors && toFactors ? timeRatio(fromFactors, toFactors) : null
  const baseVal = parseNum(baseTime)

  const channel = (key: keyof BortleFactors): { time: number | null; ratio: number | null } => {
    const r = ratios?.[key]
    if (r === undefined || !Number.isFinite(r) || r <= 0) return { time: null, ratio: null }
    if (baseVal === null || baseVal <= 0) return { time: null, ratio: r }
    return { time: baseVal * r, ratio: r }
  }

  const broadband = channel('broadband')
  const ha = channel('ha')
  const oiii = channel('oiii')

  // Table highlight: "base" tag on the from-sky row, active row on the to-sky.
  const baseRowBortle = mode === 'bortle'
    ? Number(fromBortle)
    : fromSqmVal !== null ? nearestBortleForSqm(fromSqmVal) : null
  const activeRowBortle = mode === 'bortle'
    ? (isCustom ? null : Number(toBortle))
    : toSqmVal !== null ? nearestBortleForSqm(toSqmVal) : null

  const handleToBortleChange = (val: string) => {
    if (val === 'custom') {
      const row = BORTLE_ROWS.find((r) => String(r.bortle) === toBortle)
      if (row) {
        setCustomBroadband(String(row.broadband))
        setCustomHa(String(row.ha))
        setCustomOiii(String(row.oiii))
      }
    }
    setToBortle(val)
  }

  return (
    <section className="calc-section">
      <h2 className="calc-section-title">Bortle / light pollution</h2>
      <p className="calc-section-desc">
        Convert integration time between two skies: pick the sky your base time
        was gathered under and the sky you want the equivalent time for — by
        Bortle class or by SQM reading (mag/arcsec²). Broadband suffers most
        from light pollution; narrowband (Ha&nbsp;3&nbsp;nm, O&nbsp;III&nbsp;3&nbsp;nm)
        is far more resilient. Table factors are relative to Bortle&nbsp;2.
      </p>

      <div className="calc-table-wrapper">
        <table className="calc-table">
          <thead>
            <tr>
              <th>Bortle</th>
              <th className="calc-num">SQM</th>
              <th className="calc-num">Broadband</th>
              <th className="calc-num">Ha 3 nm</th>
              <th className="calc-num">OIII 3 nm</th>
            </tr>
          </thead>
          <tbody>
            {BORTLE_ROWS.map((row) => (
              <tr key={row.bortle} className={row.bortle === activeRowBortle ? 'calc-row-active' : undefined}>
                <td>
                  {row.bortle}
                  {row.bortle === baseRowBortle && <span className="calc-tag">base</span>}
                </td>
                <td className="calc-num">{formatNumber(row.sqm)}</td>
                <td className="calc-num">{formatNumber(row.broadband)}</td>
                <td className="calc-num">{formatNumber(row.ha)}</td>
                <td className="calc-num">{formatNumber(row.oiii)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="calc-panel">
        <div className="calc-fields">
          <div className="calc-field">
            <span className="calc-field-label">Mode</span>
            <div className="calc-seg" role="group" aria-label="Sky input mode">
              <button
                type="button"
                className={`calc-seg-btn ${mode === 'bortle' ? 'active' : ''}`}
                onClick={() => setMode('bortle')}
              >
                Bortle
              </button>
              <button
                type="button"
                className={`calc-seg-btn ${mode === 'sqm' ? 'active' : ''}`}
                onClick={() => setMode('sqm')}
              >
                SQM
              </button>
            </div>
          </div>

          {mode === 'bortle' ? (
            <div className="calc-field">
              <label className="calc-field-label" htmlFor="bortle-from">From (base sky)</label>
              <select
                id="bortle-from"
                className="calc-select"
                value={fromBortle}
                onChange={(e) => setFromBortle(e.target.value)}
              >
                {BORTLE_ROWS.map((row) => (
                  <option key={row.bortle} value={String(row.bortle)}>Bortle {row.bortle}</option>
                ))}
              </select>
            </div>
          ) : (
            <div className="calc-field">
              <label className="calc-field-label" htmlFor="sqm-from">From SQM (base sky)</label>
              <div className="calc-inline calc-inline-center">
                <input
                  id="sqm-from"
                  className="calc-input calc-input-sm"
                  type="number"
                  min="16"
                  max="22.1"
                  step="0.1"
                  value={fromSqm}
                  onChange={(e) => setFromSqm(e.target.value)}
                />
                <span className="calc-hint">
                  {fromSqmVal !== null ? `≈ Bortle ${nearestBortleForSqm(fromSqmVal)}` : ''}
                </span>
              </div>
            </div>
          )}

          <div className="calc-field">
            <label className="calc-field-label" htmlFor="bortle-base-time">Base time</label>
            <div className="calc-inline">
              <select
                id="bortle-base-time"
                className="calc-select calc-input-sm"
                value={baseTime}
                onChange={(e) => setBaseTime(e.target.value)}
              >
                {BASE_TIME_OPTIONS.map((n) => (
                  <option key={n} value={String(n)}>{n}</option>
                ))}
              </select>
              <select
                className="calc-select"
                aria-label="Base time unit"
                value={unit}
                onChange={(e) => setUnit(e.target.value as TimeUnit)}
              >
                <option value="min">min</option>
                <option value="h">h</option>
              </select>
            </div>
          </div>

          {mode === 'bortle' ? (
            <div className="calc-field">
              <label className="calc-field-label" htmlFor="bortle-to">To (target sky)</label>
              <select
                id="bortle-to"
                className="calc-select"
                value={toBortle}
                onChange={(e) => handleToBortleChange(e.target.value)}
              >
                {BORTLE_ROWS.map((row) => (
                  <option key={row.bortle} value={String(row.bortle)}>Bortle {row.bortle}</option>
                ))}
                <option value="custom">Custom…</option>
              </select>
            </div>
          ) : (
            <div className="calc-field">
              <label className="calc-field-label" htmlFor="sqm-to">To SQM (target sky)</label>
              <div className="calc-inline calc-inline-center">
                <input
                  id="sqm-to"
                  className="calc-input calc-input-sm"
                  type="number"
                  min="16"
                  max="22.1"
                  step="0.1"
                  value={toSqm}
                  onChange={(e) => setToSqm(e.target.value)}
                />
                <span className="calc-hint">
                  {toSqmVal !== null ? `≈ Bortle ${nearestBortleForSqm(toSqmVal)}` : ''}
                </span>
              </div>
            </div>
          )}

          {isCustom && (
            <>
              <div className="calc-field">
                <label className="calc-field-label" htmlFor="custom-broadband">Broadband (× vs B2)</label>
                <input id="custom-broadband" className="calc-input calc-input-sm" type="number" min="0" step="any" value={customBroadband} onChange={(e) => setCustomBroadband(e.target.value)} />
              </div>
              <div className="calc-field">
                <label className="calc-field-label" htmlFor="custom-ha">Ha 3 nm (× vs B2)</label>
                <input id="custom-ha" className="calc-input calc-input-sm" type="number" min="0" step="any" value={customHa} onChange={(e) => setCustomHa(e.target.value)} />
              </div>
              <div className="calc-field">
                <label className="calc-field-label" htmlFor="custom-oiii">O III 3 nm (× vs B2)</label>
                <input id="custom-oiii" className="calc-input calc-input-sm" type="number" min="0" step="any" value={customOiii} onChange={(e) => setCustomOiii(e.target.value)} />
              </div>
            </>
          )}
        </div>

        <div className="calc-results">
          <ResultCard label="Broadband" value={broadband.time} ratio={broadband.ratio} unit={unit} />
          <ResultCard label="Ha 3 nm" value={ha.time} ratio={ha.ratio} unit={unit} />
          <ResultCard label="O III 3 nm" value={oiii.time} ratio={oiii.ratio} unit={unit} />
        </div>
      </div>
    </section>
  )
}
