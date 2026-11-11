import { useState } from 'react'
import { HelpCircle } from 'lucide-react'
import { openUrl } from '@tauri-apps/plugin-opener'
import {
  analyze, baaderCategory, lineColor, opticsFromScope,
  type FilterDef, type Optics,
} from '../../lib/fbsc'
import { apertureView, bandChart, sweepChart } from '../../lib/fbscCharts'
import { ApertureViewSvg, BandChartView, SweepChartView } from './FilterCharts'
import { FilterExplainer } from './FilterExplainer'
import { parseNum } from './shared'

const LINES = [
  { id: 'ha', name: 'Hα', nm: 656.3 },
  { id: 'oiii', name: 'OIII', nm: 500.7 },
  { id: 'sii', name: 'SII', nm: 671.6 },
  { id: 'sii2', name: 'SII', nm: 673.1 },
  { id: 'hb', name: 'Hβ', nm: 486.1 },
  { id: 'oiii2', name: 'OIII', nm: 495.9 },
]

const FWHM_PRESETS = [3, 3.5, 4, 6.5, 7, 12]

// Aperture, focal length and obstruction diameter in mm. Obstruction shares
// are the ones Baader plots in the selection charts of the paper.
const SCOPES = [
  { id: 'rasa8', label: 'RASA 8 (f/2, 46 %)', aperture: 203, focal: 400, obstruction: 93 },
  { id: 'rasa11', label: 'RASA 11 (f/2.2, 40 %)', aperture: 279, focal: 620, obstruction: 112 },
  { id: 'newton', label: '8" f/4 Newtonian (34 %)', aperture: 200, focal: 800, obstruction: 68 },
  { id: 'refractor', label: 'Refractor f/6 (none)', aperture: 100, focal: 600, obstruction: 0 },
]

const RATIO_CHIPS = [2, 2.2, 2.8, 3.3, 4, 5.6]

const SOURCES = [
  {
    author: 'Baader Planetarium GmbH',
    title: 'Narrowband Filters on Astronomical Telescopes (3 May 2022, PDF)',
    url: 'https://www.baader-planetarium.com/media/mageworx/downloads/attachment/file/1794/EN_Baader_filter_selection_03Mai22.pdf',
    note: 'The model used here: the tilt formula, adding up rings of the aperture, the central obstruction, and the pre-shifted filter classes.',
  },
  {
    author: 'Cuiv, The Lazy Geek',
    title: 'Video on filter bandpass shift, with the spreadsheet these calculators grew from',
    url: 'https://www.youtube.com/watch?v=V4snlZYduNg',
    note: 'The flat-top Gaussian band shape and the area-weighted transmission at one emission line.',
  },
  {
    author: 'Orphi',
    title: 'Online Filter Bandpass Shift Calculator',
    url: 'https://astronomytools.orphi.eu/fbsc.html',
    note: 'The web version of that spreadsheet, and the search for the filter centre that passes the most light.',
  },
  {
    author: 'A. Tofahrn',
    title: 'Bandpass Shift Calculator',
    url: 'https://www.tofahrn-foto.de/en/tips-and-tricks/astro-photography/bandpass-shift-calculator/',
    note: 'An extension of Orphi\'s calculator that shows transmission across the aperture radius.',
  },
]

type ScopeMode = 'scope' | 'ratio'

/** Up to `digits` decimals, trailing zeros dropped. */
function trim(n: number, digits: number): string {
  return String(Number(n.toFixed(digits)))
}

const pct = (t: number) => `${trim(t * 100, 1)} %`
const deg = (rad: number) => trim((rad * 180) / Math.PI, 1)
const signed = (n: number, digits: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${trim(Math.abs(n), digits)}`

function Field({ id, label, unit, children }: {
  id: string
  label: string
  unit?: string
  children: React.ReactNode
}) {
  return (
    <div className="calc-field">
      <label className="calc-field-label" htmlFor={id}>
        {label}{unit && <span className="fc-unit">{unit}</span>}
      </label>
      {children}
    </div>
  )
}

export function FilterCalculator() {
  const [lineId, setLineId] = useState('ha')
  const [targetNm, setTargetNm] = useState('656.3')
  const [centerNm, setCenterNm] = useState('656.3')
  const [fwhm, setFwhm] = useState('6.5')
  const [flatTop, setFlatTop] = useState('4')
  const [peakPct, setPeakPct] = useState('94')
  const [nEff, setNEff] = useState('2')

  const [mode, setMode] = useState<ScopeMode>('scope')
  const [scopeId, setScopeId] = useState('rasa8')
  const [aperture, setAperture] = useState('203')
  const [focal, setFocal] = useState('400')
  const [obstructionMm, setObstructionMm] = useState('93')
  const [fRatio, setFRatio] = useState('2')
  const [obstructionPct, setObstructionPct] = useState('46')

  const [showExplainer, setShowExplainer] = useState(false)

  const target = parseNum(targetNm)
  const center = parseNum(centerNm)

  const pickLine = (id: string) => {
    setLineId(id)
    const line = LINES.find((l) => l.id === id)
    if (!line) return
    // Keep a pre-shift the user has dialled in.
    const offset = target !== null && center !== null ? center - target : 0
    setTargetNm(String(line.nm))
    setCenterNm(trim(line.nm + offset, 2))
  }

  const pickFwhm = (value: string) => {
    setFwhm(value)
    // Typical for the measured curves in Baader's figures: 4 of 6.5 nm, 2 of 3.5 nm.
    setFlatTop(trim(Number(value) * 0.6, 1))
  }

  const pickScope = (id: string) => {
    setScopeId(id)
    const s = SCOPES.find((x) => x.id === id)
    if (!s) return
    setAperture(String(s.aperture))
    setFocal(String(s.focal))
    setObstructionMm(String(s.obstruction))
    setFRatio(trim(s.focal / s.aperture, 2))
    setObstructionPct(trim((s.obstruction / s.aperture) * 100, 0))
  }

  const scopeOptics = (() => {
    const a = parseNum(aperture)
    const fl = parseNum(focal)
    const o = parseNum(obstructionMm)
    return a === null || fl === null || o === null ? null : opticsFromScope(a, fl, o)
  })()
  const ratioOptics: Optics | null = (() => {
    const f = parseNum(fRatio)
    const o = parseNum(obstructionPct)
    return f === null || o === null ? null : { fRatio: f, obstruction: o / 100 }
  })()
  const optics = mode === 'scope' ? scopeOptics : ratioOptics

  // Carry the telescope over so both modes describe the same instrument.
  const switchMode = (next: ScopeMode) => {
    if (next === mode) return
    if (next === 'ratio' && scopeOptics) {
      setFRatio(trim(scopeOptics.fRatio, 2))
      setObstructionPct(trim(scopeOptics.obstruction * 100, 1))
    }
    if (next === 'scope' && ratioOptics) {
      const a = parseNum(aperture)
      if (a !== null && a > 0) {
        setFocal(trim(a * ratioOptics.fRatio, 0))
        setObstructionMm(trim(a * ratioOptics.obstruction, 1))
      }
    }
    setMode(next)
  }

  const filter: FilterDef | null = (() => {
    const w = parseNum(fwhm)
    const ft = parseNum(flatTop)
    const p = parseNum(peakPct)
    const n = parseNum(nEff)
    if (center === null || w === null || ft === null || p === null || n === null) return null
    return { centerNm: center, fwhmNm: w, flatTopNm: ft, peak: p / 100, nEff: n }
  })()

  const result = filter && optics && target !== null ? analyze(filter, optics, target) : null

  const problem = (() => {
    if (result) return null
    if (!filter || !optics || target === null) return 'Fill in every field.'
    if (filter.flatTopNm >= filter.fwhmNm) return 'The flat top has to be narrower than the FWHM.'
    if (filter.peak <= 0 || filter.peak > 1) return 'Peak transmission is a percentage between 0 and 100.'
    if (filter.nEff < 1) return 'The effective refractive index cannot be below 1.'
    if (optics.obstruction >= 1 || optics.obstruction < 0) return 'The obstruction has to be smaller than the aperture.'
    return 'Check the numbers: one of them is zero or negative.'
  })()

  const line = LINES.find((l) => l.id === lineId)
  const lineName = line && target === line.nm ? line.name : 'the line'
  const lineLabel = target === null ? '' : `${line && target === line.nm ? `${line.name} ` : ''}${trim(target, 1)} nm`
  const color = target === null ? 'var(--color-error)' : lineColor(target)
  const offset = center !== null && target !== null ? center - target : null

  // How much of what the filter could pass at best actually arrives.
  const kept = result && filter ? result.atTarget / filter.peak : null
  const verdict = kept === null ? null
    : kept >= 0.9 ? { cls: 'good', text: 'Good match' }
    : kept >= 0.7 ? { cls: 'fair', text: 'Noticeable loss' }
    : { cls: 'poor', text: 'Poor match' }

  const category = filter && optics ? baaderCategory(filter.fwhmNm, optics.fRatio) : null

  const open = (url: string) => (e: React.MouseEvent) => {
    e.preventDefault()
    void openUrl(url)
  }

  return (
    <section className="calc-section fc">
      <div className="fc-head">
        <div>
          <h2 className="calc-section-title">Filter bandpass shift</h2>
          <p className="calc-section-desc">
            How much of an emission line a narrowband filter still passes once it sits in your
            telescope's light cone.
          </p>
        </div>
        <button className="btn" onClick={() => setShowExplainer(true)}>
          <HelpCircle /> Why do I need this?
        </button>
      </div>

      <div className="fc-inputs">
        <div className="calc-panel fc-card">
          <h3 className="fc-card-title">Filter</h3>
          <div className="fc-grid">
            <Field id="fc-line" label="Emission line">
              <select id="fc-line" className="calc-select" value={line && target === line.nm ? lineId : 'custom'}
                onChange={(e) => pickLine(e.target.value)}>
                {LINES.map((l) => <option key={l.id} value={l.id}>{l.name} {l.nm} nm</option>)}
                <option value="custom" disabled>Custom</option>
              </select>
            </Field>
            <Field id="fc-target" label="Line wavelength" unit="nm">
              <input id="fc-target" className="calc-input" type="number" step="any" value={targetNm}
                onChange={(e) => setTargetNm(e.target.value)} />
            </Field>
            <Field id="fc-center" label="Filter centre" unit="nm">
              <input id="fc-center" className="calc-input" type="number" step="any" value={centerNm}
                onChange={(e) => setCenterNm(e.target.value)} />
            </Field>
            <Field id="fc-fwhm" label="Width (FWHM)" unit="nm">
              <div className="fc-combo">
                <input id="fc-fwhm" className="calc-input" type="number" step="any" value={fwhm}
                  onChange={(e) => setFwhm(e.target.value)} />
                <select className="calc-select" aria-label="Common widths"
                  value={FWHM_PRESETS.includes(Number(fwhm)) ? String(Number(fwhm)) : ''}
                  onChange={(e) => pickFwhm(e.target.value)}>
                  <option value="" disabled>…</option>
                  {FWHM_PRESETS.map((v) => <option key={v} value={String(v)}>{v} nm</option>)}
                </select>
              </div>
            </Field>
            <Field id="fc-flat" label="Flat top" unit="nm">
              <input id="fc-flat" className="calc-input" type="number" step="any" min="0" value={flatTop}
                onChange={(e) => setFlatTop(e.target.value)} />
            </Field>
            <Field id="fc-peak" label="Peak transmission" unit="%">
              <input id="fc-peak" className="calc-input" type="number" step="any" min="0" max="100" value={peakPct}
                onChange={(e) => setPeakPct(e.target.value)} />
            </Field>
            <Field id="fc-neff" label="Effective index">
              <input id="fc-neff" className="calc-input" type="number" step="0.05" min="1" value={nEff}
                onChange={(e) => setNEff(e.target.value)} />
            </Field>
            <div className="fc-field-note">
              {offset === null ? ' '
                : Math.abs(offset) < 0.05 ? 'Centred on the line'
                : `Centre is ${signed(offset, 2)} nm from the line${offset > 0 ? ' (pre-shifted)' : ''}`}
            </div>
          </div>
        </div>

        <div className="calc-panel fc-card">
          <div className="fc-card-head">
            <h3 className="fc-card-title">Telescope</h3>
            <div className="calc-seg" role="group" aria-label="How to describe the telescope">
              <button type="button" className={`calc-seg-btn ${mode === 'scope' ? 'active' : ''}`}
                onClick={() => switchMode('scope')}>Aperture + focal length</button>
              <button type="button" className={`calc-seg-btn ${mode === 'ratio' ? 'active' : ''}`}
                onClick={() => switchMode('ratio')}>Focal ratio</button>
            </div>
          </div>

          <div className="fc-grid">
            <div className="fc-span">
              <Field id="fc-scope" label="Start from">
                <select id="fc-scope" className="calc-select" value={scopeId}
                  onChange={(e) => pickScope(e.target.value)}>
                  {SCOPES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  <option value="" disabled>My own numbers</option>
                </select>
              </Field>
            </div>

            {mode === 'scope' ? (
              <>
                <Field id="fc-aperture" label="Aperture" unit="mm">
                  <input id="fc-aperture" className="calc-input" type="number" step="any" min="0" value={aperture}
                    onChange={(e) => { setAperture(e.target.value); setScopeId('') }} />
                </Field>
                <Field id="fc-focal" label="Focal length" unit="mm">
                  <input id="fc-focal" className="calc-input" type="number" step="any" min="0" value={focal}
                    onChange={(e) => { setFocal(e.target.value); setScopeId('') }} />
                </Field>
                <Field id="fc-obstruction" label="Obstruction" unit="mm">
                  <input id="fc-obstruction" className="calc-input" type="number" step="any" min="0" value={obstructionMm}
                    onChange={(e) => { setObstructionMm(e.target.value); setScopeId('') }} />
                </Field>
              </>
            ) : (
              <>
                <Field id="fc-ratio" label="Focal ratio" unit="f/">
                  <input id="fc-ratio" className="calc-input" type="number" step="0.1" min="0" value={fRatio}
                    onChange={(e) => { setFRatio(e.target.value); setScopeId('') }} />
                </Field>
                <Field id="fc-obstruction-pct" label="Obstruction" unit="% of diameter">
                  <input id="fc-obstruction-pct" className="calc-input" type="number" step="any" min="0" max="99"
                    value={obstructionPct}
                    onChange={(e) => { setObstructionPct(e.target.value); setScopeId('') }} />
                </Field>
                <div className="fc-span fc-chips" role="group" aria-label="Common focal ratios">
                  {RATIO_CHIPS.map((v) => (
                    <button key={v} type="button"
                      className={`fc-chip ${parseNum(fRatio) === v ? 'active' : ''}`}
                      onClick={() => { setFRatio(String(v)); setScopeId('') }}>f/{v}</button>
                  ))}
                </div>
              </>
            )}

            <div className="fc-field-note fc-span">
              {optics && optics.fRatio > 0
                ? `f/${trim(optics.fRatio, 2)} · obstruction ${trim(optics.obstruction * 100, 0)} % of the diameter`
                : ' '}
            </div>
          </div>
        </div>
      </div>

      {!result || !filter || !optics || target === null || !verdict ? (
        <div className="fc-problem">{problem}</div>
      ) : (
        <>
          <div className="fc-results">
            <div className={`fc-hero fc-${verdict.cls}`}>
              <div className="calc-result-label">Light of {lineName} that gets through</div>
              <div className="fc-hero-row">
                <div className="fc-hero-value">{pct(result.atTarget)}</div>
                <div className="fc-verdict">{verdict.text}</div>
              </div>
              <div className="fc-meter" aria-hidden="true">
                <i className="fc-meter-fill" style={{ width: `${result.atTarget * 100}%` }} />
                <i className="fc-meter-mark" style={{ left: `${result.parallelAtTarget * 100}%` }} />
              </div>
              <div className="calc-result-sub">
                Same filter in straight light: {pct(result.parallelAtTarget)}
                {result.parallelAtTarget - result.atTarget > 0.0005
                  ? ` · the light cone costs ${trim((result.parallelAtTarget - result.atTarget) * 100, 1)} points`
                  : result.atTarget - result.parallelAtTarget > 0.0005
                    ? ` · the light cone gains ${trim((result.atTarget - result.parallelAtTarget) * 100, 1)} points`
                    : ' · the light cone costs nothing'}
              </div>
            </div>

            <div className="fc-stats">
              <div className="calc-result-card">
                <div className="calc-result-label">Band moves by</div>
                <div className="calc-result-value">−{trim(result.meanShiftNm, 2)} nm</div>
                <div className="calc-result-sub">
                  −{trim(result.shiftMinNm, 2)} nm (inner rays) to −{trim(result.shiftMaxNm, 2)} nm (edge)
                </div>
              </div>
              <div className="calc-result-card">
                <div className="calc-result-label">Band at the camera</div>
                <div className="calc-result-value">{trim(result.effCenterNm, 1)} nm</div>
                <div className="calc-result-sub">
                  {trim(result.effFwhmNm, 1)} nm wide · peak {pct(result.peakT)}
                </div>
              </div>
              <div className="calc-result-card">
                <div className="calc-result-label">Best filter centre</div>
                <div className="calc-result-value">{trim(result.bestCenterNm, 1)} nm</div>
                <div className="calc-result-sub fc-sub-action">
                  <span>{signed(result.bestCenterNm - target, 1)} nm from the line → {pct(result.bestAtTarget)}</span>
                  <button type="button" className="fc-link" onClick={() => setCenterNm(trim(result.bestCenterNm, 1))}>
                    Try it
                  </button>
                </div>
              </div>
              {category && (
                <div className="calc-result-card">
                  <div className="calc-result-label">Baader would sell you</div>
                  <div className="calc-result-value fc-value-text">{category.name}</div>
                  <div className="calc-result-sub">
                    their {category.family} class for {category.range}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="calc-panel fc-card">
            <h3 className="fc-card-title">What the filter passes</h3>
            <p className="fc-caption">
              Each zone of the aperture sees the filter moved by a different amount. Added together
              they give a band that is shifted towards blue, wider and lower than the one printed on
              the box.
            </p>
            <BandChartView chart={bandChart(filter, result, target)} lineLabel={lineLabel} lineColor={color} />
          </div>

          <div className="fc-pair">
            <div className="calc-panel fc-card">
              <h3 className="fc-card-title">Where the light is lost</h3>
              <p className="fc-caption">
                The front of your telescope. Green zones deliver {lineName}, red zones are blocked by
                the filter.
              </p>
              <ApertureViewSvg view={apertureView(filter, result, target)}
                centerDeg={deg(result.thetaMinRad)} edgeDeg={deg(result.thetaMaxRad)} />
            </div>
            <div className="calc-panel fc-card">
              <h3 className="fc-card-title">This filter on other telescopes</h3>
              <p className="fc-caption">
                Same filter and obstruction at every focal ratio. The dot is your telescope.
              </p>
              <SweepChartView chart={sweepChart(filter, optics, target, result.atTarget)}
                markerColor={`var(--color-${verdict.cls === 'good' ? 'success' : verdict.cls === 'fair' ? 'warning' : 'error'})`} />
            </div>
          </div>
        </>
      )}

      <div className="calc-panel fc-card fc-sources">
        <h3 className="fc-card-title">Method and sources</h3>
        <p className="fc-caption">
          A ray tilted by θ sees the band at λ·√(1 − (sin θ / n)²). The aperture is cut into 120 rings
          between the obstruction and the edge, each with its own tilt (tan θ = radius / focal
          length), and their bands are added weighted by ring area. The band shape is a flat top
          with Gaussian edges. With an effective index of 2.0 the result lands within a few points
          of the losses Baader reports for their 3.5 nm filters at f/2.3; real filters differ, so
          treat the numbers as a good estimate, not a measurement. Temperature drift is not modelled.
        </p>
        <ul className="fc-source-list">
          {SOURCES.map((s) => (
            <li key={s.url}>
              <b>{s.author}</b>{' '}
              <a href={s.url} onClick={open(s.url)}>{s.title}</a>
              <span>{s.note}</span>
            </li>
          ))}
        </ul>
      </div>

      {showExplainer && <FilterExplainer onClose={() => setShowExplainer(false)} />}
    </section>
  )
}
