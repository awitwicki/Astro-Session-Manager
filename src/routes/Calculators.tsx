import { useState } from 'react'
import { Calculator } from 'lucide-react'
import '../styles/calculators.css'

// ─── Bortle reference data ──────────────────────────────────────────────────
// Relative integration time needed to match Bortle 2 (base) skies, per channel.
interface BortleRow {
  bortle: number
  broadband: number
  ha: number
  oiii: number
}

const BORTLE_ROWS: BortleRow[] = [
  { bortle: 1, broadband: 0.8, ha: 1.0, oiii: 1.0 },
  { bortle: 2, broadband: 1.0, ha: 1.0, oiii: 1.0 }, // base
  { bortle: 3, broadband: 1.5, ha: 1.0, oiii: 1.1 },
  { bortle: 4, broadband: 2.3, ha: 1.1, oiii: 1.3 },
  { bortle: 5, broadband: 4.8, ha: 1.2, oiii: 1.8 },
  { bortle: 6, broadband: 11, ha: 1.6, oiii: 3.0 },
  { bortle: 7, broadband: 17, ha: 1.9, oiii: 4.3 },
  { bortle: 8, broadband: 30, ha: 2.6, oiii: 6.8 },
]

const BORTLE_BASE = 2

// Base-time dropdown values: whole numbers 1–100 (in the selected unit).
const BASE_TIME_OPTIONS = Array.from({ length: 100 }, (_, i) => i + 1)

type TimeUnit = 'min' | 'h'

// ─── Helpers ────────────────────────────────────────────────────────────────
function parseNum(s: string): number | null {
  if (s.trim() === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

// Up to 2 decimals, trailing zeros stripped, with thousands separators
// (e.g. 4.80 → "4.8", 4.00 → "4", 29970 → "29,970").
function formatNumber(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

function toMinutes(value: number, unit: TimeUnit): number {
  return unit === 'h' ? value * 60 : value
}

// Friendly human-readable duration from a minute value.
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
  if (s && !h) parts.push(`${s} s`) // drop seconds once we're in the hours range
  return parts.join(' ')
}

const UNIT_LABEL: Record<TimeUnit, string> = { min: 'min', h: 'h' }

// A single computed-result card.
function ResultCard({
  label,
  value,
  unit,
}: {
  label: string
  value: number | null
  unit: TimeUnit
}) {
  return (
    <div className="calc-result-card">
      <div className="calc-result-label">{label}</div>
      <div className="calc-result-value">
        {value === null ? '—' : `${formatNumber(value)} ${UNIT_LABEL[unit]}`}
      </div>
      <div className="calc-result-sub">
        {value === null ? ' ' : formatDuration(toMinutes(value, unit))}
      </div>
    </div>
  )
}

export function Calculators() {
  // ─── Bortle calculator state ──────────────────────────────────────────────
  const [bortleBaseTime, setBortleBaseTime] = useState('1')
  const [bortleUnit, setBortleUnit] = useState<TimeUnit>('h')
  // Selection: '1'..'8' for a preset, or 'custom'.
  const [bortleSel, setBortleSel] = useState('2')
  const [customBroadband, setCustomBroadband] = useState('1.0')
  const [customHa, setCustomHa] = useState('1.0')
  const [customOiii, setCustomOiii] = useState('1.0')

  const isCustomBortle = bortleSel === 'custom'
  const selectedRow = BORTLE_ROWS.find((r) => String(r.bortle) === bortleSel)

  const factorBroadband = isCustomBortle
    ? parseNum(customBroadband)
    : selectedRow?.broadband ?? null
  const factorHa = isCustomBortle ? parseNum(customHa) : selectedRow?.ha ?? null
  const factorOiii = isCustomBortle
    ? parseNum(customOiii)
    : selectedRow?.oiii ?? null

  const bortleBaseVal = parseNum(bortleBaseTime)

  const requiredTime = (factor: number | null): number | null => {
    if (bortleBaseVal === null || bortleBaseVal <= 0) return null
    if (factor === null || factor <= 0) return null
    return bortleBaseVal * factor
  }

  const handleBortleSelChange = (val: string) => {
    // Seed the custom fields from the previously selected preset so switching
    // to "Custom" starts from a sensible row rather than blank values.
    if (val === 'custom' && selectedRow) {
      setCustomBroadband(String(selectedRow.broadband))
      setCustomHa(String(selectedRow.ha))
      setCustomOiii(String(selectedRow.oiii))
    }
    setBortleSel(val)
  }

  return (
    <div className="calc-page">
      <div className="page-header">
        <h1 className="page-title">
          <Calculator size={22} /> Bortle Calculator
        </h1>
      </div>

      <section className="calc-section">
        <h2 className="calc-section-title">Bortle / light pollution</h2>
        <p className="calc-section-desc">
          Relative integration time needed to gather the same signal as under
          dark Bortle&nbsp;2 (base) skies. Broadband suffers most from light
          pollution; narrowband (Ha&nbsp;3&nbsp;nm, O&nbsp;III&nbsp;3&nbsp;nm)
          is far more resilient.
        </p>

        <div className="calc-table-wrapper">
          <table className="calc-table">
            <thead>
              <tr>
                <th>Bortle</th>
                <th className="calc-num">Broadband</th>
                <th className="calc-num">Ha/SII 3 nm</th>
                <th className="calc-num">OIII 3 nm</th>
              </tr>
            </thead>
            <tbody>
              {BORTLE_ROWS.map((row) => {
                const isActive = !isCustomBortle && row.bortle === selectedRow?.bortle
                const isBase = row.bortle === BORTLE_BASE
                return (
                  <tr
                    key={row.bortle}
                    className={isActive ? 'calc-row-active' : undefined}
                  >
                    <td>
                      {row.bortle}
                      {isBase && <span className="calc-tag">base</span>}
                    </td>
                    <td className="calc-num">{formatNumber(row.broadband)}</td>
                    <td className="calc-num">{formatNumber(row.ha)}</td>
                    <td className="calc-num">{formatNumber(row.oiii)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="calc-panel">
          <div className="calc-fields">
            <div className="calc-field">
              <label className="calc-field-label" htmlFor="bortle-base-time">
                Base time (at Bortle 2)
              </label>
              <div className="calc-inline">
                <select
                  id="bortle-base-time"
                  className="calc-select calc-input-sm"
                  value={bortleBaseTime}
                  onChange={(e) => setBortleBaseTime(e.target.value)}
                >
                  {BASE_TIME_OPTIONS.map((n) => (
                    <option key={n} value={String(n)}>
                      {n}
                    </option>
                  ))}
                </select>
                <select
                  className="calc-select"
                  aria-label="Base time unit"
                  value={bortleUnit}
                  onChange={(e) => setBortleUnit(e.target.value as TimeUnit)}
                >
                  <option value="min">min</option>
                  <option value="h">h</option>
                </select>
              </div>
            </div>

            <div className="calc-field">
              <label className="calc-field-label" htmlFor="bortle-select">
                Your Bortle
              </label>
              <select
                id="bortle-select"
                className="calc-select"
                value={bortleSel}
                onChange={(e) => handleBortleSelChange(e.target.value)}
              >
                {BORTLE_ROWS.map((row) => (
                  <option key={row.bortle} value={String(row.bortle)}>
                    Bortle {row.bortle}
                    {row.bortle === BORTLE_BASE ? ' (base)' : ''}
                  </option>
                ))}
                <option value="custom">Custom…</option>
              </select>
            </div>

            {isCustomBortle && (
              <>
                <div className="calc-field">
                  <label className="calc-field-label" htmlFor="custom-broadband">
                    Broadband (×)
                  </label>
                  <input
                    id="custom-broadband"
                    className="calc-input calc-input-sm"
                    type="number"
                    min="0"
                    step="any"
                    value={customBroadband}
                    onChange={(e) => setCustomBroadband(e.target.value)}
                  />
                </div>
                <div className="calc-field">
                  <label className="calc-field-label" htmlFor="custom-ha">
                    Ha 3 nm (×)
                  </label>
                  <input
                    id="custom-ha"
                    className="calc-input calc-input-sm"
                    type="number"
                    min="0"
                    step="any"
                    value={customHa}
                    onChange={(e) => setCustomHa(e.target.value)}
                  />
                </div>
                <div className="calc-field">
                  <label className="calc-field-label" htmlFor="custom-oiii">
                    O III 3 nm (×)
                  </label>
                  <input
                    id="custom-oiii"
                    className="calc-input calc-input-sm"
                    type="number"
                    min="0"
                    step="any"
                    value={customOiii}
                    onChange={(e) => setCustomOiii(e.target.value)}
                  />
                </div>
              </>
            )}
          </div>

          <div className="calc-results">
            <ResultCard
              label="Broadband"
              value={requiredTime(factorBroadband)}
              unit={bortleUnit}
            />
            <ResultCard
              label="Ha/SII 3 nm"
              value={requiredTime(factorHa)}
              unit={bortleUnit}
            />
            <ResultCard
              label="O III 3 nm"
              value={requiredTime(factorOiii)}
              unit={bortleUnit}
            />
          </div>
        </div>
      </section>
    </div>
  )
}
