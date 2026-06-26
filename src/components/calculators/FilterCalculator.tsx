import { useMemo, useState } from 'react'
import { computeFbsc, transmissionAt, filterProfile, type FilterDef, type TelescopeDef } from '../../lib/fbsc'
import { FilterProfileChart } from './FilterProfileChart'
import { parseNum, formatNumber } from './shared'

interface LinePreset {
  id: string
  label: string
  nm: number | null
}

const LINE_PRESETS: LinePreset[] = [
  { id: 'ha', label: 'Hα — 656.3 nm', nm: 656.3 },
  { id: 'sii', label: 'SII — 671.6 nm', nm: 671.6 },
  { id: 'oiii', label: 'OIII — 500.7 nm', nm: 500.7 },
  { id: 'hb', label: 'Hβ — 486.1 nm', nm: 486.1 },
  { id: 'custom', label: 'Custom…', nm: null },
]

const FWHM_PRESETS = [3, 3.5, 5, 6.5]

export function FilterCalculator() {
  const [lineSel, setLineSel] = useState('ha')
  const [centerNm, setCenterNm] = useState('656.3')
  const [targetNm, setTargetNm] = useState('656.3')
  const [fwhmSel, setFwhmSel] = useState('custom')
  const [fwhm, setFwhm] = useState('7')
  const [refractiveIndex, setRefractiveIndex] = useState('1.8')
  const [flatTop, setFlatTop] = useState('1.5')
  const [peak, setPeak] = useState('0.9')
  const [aperture, setAperture] = useState('150')
  const [focal, setFocal] = useState('600')
  const [obstruction, setObstruction] = useState('62')

  const handleLineChange = (id: string) => {
    setLineSel(id)
    const preset = LINE_PRESETS.find((p) => p.id === id)
    if (preset && preset.nm !== null) {
      setCenterNm(String(preset.nm))
      setTargetNm(String(preset.nm))
    }
  }

  const handleFwhmChange = (val: string) => {
    setFwhmSel(val)
    if (val !== 'custom') setFwhm(val)
  }

  const filter: FilterDef | null = useMemo(() => {
    const c = parseNum(centerNm)
    const f = parseNum(fwhm)
    const n = parseNum(refractiveIndex)
    const ft = parseNum(flatTop)
    const p = parseNum(peak)
    if (c === null || f === null || n === null || ft === null || p === null) return null
    return { centerNm: c, fwhmNm: f, refractiveIndex: n, flatTopNm: ft, peakTransmittance: p }
  }, [centerNm, fwhm, refractiveIndex, flatTop, peak])

  const scope: TelescopeDef | null = useMemo(() => {
    const a = parseNum(aperture)
    const fl = parseNum(focal)
    const o = parseNum(obstruction)
    if (a === null || fl === null || o === null) return null
    return { apertureMm: a, focalLengthMm: fl, obstructionMm: o }
  }, [aperture, focal, obstruction])

  const target = parseNum(targetNm)

  const result = useMemo(() => {
    if (!filter || !scope || target === null) return null
    return computeFbsc(filter, scope, target)
  }, [filter, scope, target])

  const fRatio = useMemo(() => {
    const a = parseNum(aperture)
    const fl = parseNum(focal)
    if (a === null || fl === null || a <= 0) return null
    return fl / a
  }, [aperture, focal])

  // On-axis transmission (angle 0 → unshifted center) for the "cost" comparison.
  const onAxis = useMemo(() => {
    if (!filter || target === null || !result) return null
    return transmissionAt(target, filter.centerNm, filter.flatTopNm, filter.peakTransmittance, result.sigma)
  }, [filter, target, result])

  const overallPct = result ? result.overall * 100 : null
  const lossPct = result && onAxis !== null ? (onAxis - result.overall) * 100 : null

  const chart = useMemo(() => {
    if (!filter || !result || target === null) return null
    const samples = 160
    const span = Math.max(filter.fwhmNm * 1.6, Math.abs(filter.centerNm - target) * 1.4, 4)
    const halfRange = span
    const domainMinNm = Math.min(result.shiftMaxNm, target) - halfRange
    const domainMaxNm = Math.max(filter.centerNm, target) + halfRange
    const mk = (c: number) => filterProfile(c, filter.flatTopNm, filter.peakTransmittance, result.sigma, halfRange + Math.abs(filter.centerNm - c), samples)
    return {
      onAxis: mk(filter.centerNm),
      shiftedMin: mk(result.shiftMinNm),
      shiftedMax: mk(result.shiftMaxNm),
      targetNm: target,
      domainMinNm,
      domainMaxNm,
      peak: filter.peakTransmittance,
    }
  }, [filter, result, target])

  return (
    <section className="calc-section">
      <h2 className="calc-section-title">Filter bandpass shift</h2>
      <p className="calc-section-desc">
        Narrowband interference filters blue-shift their passband as light hits
        them at steeper angles. A fast telescope's light cone pushes the passband
        off the target emission line, lowering effective transmission. This is the
        area-weighted transmission across the whole aperture.
      </p>

      <div className="calc-panel">
        <div className="calc-fields calc-fields-grid">
          <div className="calc-field">
            <label className="calc-field-label" htmlFor="filter-line">Emission line</label>
            <select id="filter-line" className="calc-select" value={lineSel} onChange={(e) => handleLineChange(e.target.value)}>
              {LINE_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>

          <div className="calc-field">
            <label className="calc-field-label" htmlFor="filter-center">Bandpass center (nm)</label>
            <input id="filter-center" className="calc-input calc-input-sm" type="number" step="any" value={centerNm}
              onChange={(e) => { setCenterNm(e.target.value); setLineSel('custom') }} />
          </div>

          <div className="calc-field">
            <label className="calc-field-label" htmlFor="filter-target">Target wavelength (nm)</label>
            <input id="filter-target" className="calc-input calc-input-sm" type="number" step="any" value={targetNm}
              onChange={(e) => setTargetNm(e.target.value)} />
          </div>

          <div className="calc-field">
            <label className="calc-field-label" htmlFor="filter-fwhm-sel">FWHM (nm)</label>
            <div className="calc-inline">
              <select id="filter-fwhm-sel" className="calc-select" value={fwhmSel} onChange={(e) => handleFwhmChange(e.target.value)}>
                {FWHM_PRESETS.map((v) => (
                  <option key={v} value={String(v)}>{v} nm</option>
                ))}
                <option value="custom">Custom…</option>
              </select>
              <input className="calc-input calc-input-sm" type="number" step="any" aria-label="FWHM value" value={fwhm}
                onChange={(e) => { setFwhm(e.target.value); setFwhmSel('custom') }} />
            </div>
          </div>

          <div className="calc-field">
            <label className="calc-field-label" htmlFor="filter-flat">Flat top (nm)</label>
            <input id="filter-flat" className="calc-input calc-input-sm" type="number" step="any" value={flatTop} onChange={(e) => setFlatTop(e.target.value)} />
          </div>

          <div className="calc-field">
            <label className="calc-field-label" htmlFor="filter-peak">Peak transmittance</label>
            <input id="filter-peak" className="calc-input calc-input-sm" type="number" step="any" min="0" max="1" value={peak} onChange={(e) => setPeak(e.target.value)} />
          </div>

          <div className="calc-field">
            <label className="calc-field-label" htmlFor="filter-n">Refractive index</label>
            <input id="filter-n" className="calc-input calc-input-sm" type="number" step="any" value={refractiveIndex} onChange={(e) => setRefractiveIndex(e.target.value)} />
          </div>

          <div className="calc-field">
            <label className="calc-field-label" htmlFor="filter-aperture">Aperture (mm)</label>
            <input id="filter-aperture" className="calc-input calc-input-sm" type="number" step="any" value={aperture} onChange={(e) => setAperture(e.target.value)} />
          </div>

          <div className="calc-field">
            <label className="calc-field-label" htmlFor="filter-focal">Focal length (mm)</label>
            <input id="filter-focal" className="calc-input calc-input-sm" type="number" step="any" value={focal} onChange={(e) => setFocal(e.target.value)} />
          </div>

          <div className="calc-field">
            <label className="calc-field-label" htmlFor="filter-obstruction">Central obstruction (mm)</label>
            <input id="filter-obstruction" className="calc-input calc-input-sm" type="number" step="any" value={obstruction} onChange={(e) => setObstruction(e.target.value)} />
          </div>
        </div>

        <div className="calc-results">
          <div className="calc-result-card calc-result-card-lg">
            <div className="calc-result-label">Overall transmission</div>
            <div className="calc-result-value">
              {overallPct === null ? '—' : `${formatNumber(overallPct)} %`}
            </div>
            <div className="calc-result-sub">
              {fRatio === null ? ' ' : `f/${formatNumber(fRatio)}`}
              {lossPct !== null && lossPct > 0.05 ? ` · −${formatNumber(lossPct)} pts vs on-axis` : ''}
            </div>
          </div>
        </div>
      </div>
      {chart && (
        <FilterProfileChart
          onAxis={chart.onAxis}
          shiftedMin={chart.shiftedMin}
          shiftedMax={chart.shiftedMax}
          targetNm={chart.targetNm}
          domainMinNm={chart.domainMinNm}
          domainMaxNm={chart.domainMaxNm}
          peak={chart.peak}
        />
      )}
    </section>
  )
}
