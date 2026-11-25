import { useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import { Plus, X } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { BORTLE_ROWS } from '../../lib/bortle'
import { parseNum, formatNumber } from './shared'
import {
  loadCameraCatalog, nearestMode, type Camera, type CameraMode,
} from '../../lib/cameraCatalog'
import {
  collectUserCameras, restoreState, DEFAULT_STATE, type CalcState, type UserCamera,
} from '../../lib/userCameras'
import {
  FILTER_PRESETS, NOISE_OPTIONS, subExposure, sensorParams, defaultSensorTemp, formatSub,
  sweepByFocalRatio, type SensorParams, type Conditions, type SubResult,
} from '../../lib/subExposure'
import { subChart } from '../../lib/subExposureChart'
import { CameraPicker } from './CameraPicker'
import { SubExposureChartView } from './SubExposureChart'

const SETTINGS_KEY = 'subExposureCalc'
const FOCAL_RATIO_CHIPS = [2, 2.8, 4, 5, 5.6, 7, 10]
const MAX_COMPARE = 5

const GLOVER_SOURCE_URL = 'https://forums.sharpcap.co.uk/viewtopic.php?p=29102'

type Selection =
  | { kind: 'catalog'; camera: Camera }
  | { kind: 'user'; userCamera: UserCamera }
  | { kind: 'custom' }

function resolveSelection(cameraId: string | null, catalog: Camera[], userCameras: UserCamera[]): Selection | null {
  if (cameraId === null) return null
  if (cameraId === 'custom') return { kind: 'custom' }
  if (cameraId.startsWith('user:')) {
    const instrume = cameraId.slice('user:'.length)
    const uc = userCameras.find((u) => u.instrume === instrume)
    return uc ? { kind: 'user', userCamera: uc } : { kind: 'custom' }
  }
  const camera = catalog.find((c) => c.id === cameraId)
  return camera ? { kind: 'catalog', camera } : null
}

function blankSensor(pixelSize: number | null): SensorParams {
  return {
    mono: false, pixelSize: pixelSize ?? 0, qe: 0, readNoise: 0, fullWell: 0,
    bitDepth: 16, darkRef: 0, darkRefTemp: 0, darkDoubling: 6,
  }
}

/** Up to `digits` decimals, trailing zeros dropped. */
function trim(n: number, digits: number): string {
  return String(Number(n.toFixed(digits)))
}

/** Sky and dark rates span a wide range (a narrowband sky can be a few
 *  ten-thousandths of an electron) — formatNumber's 2-decimal cap would show
 *  most of them as a flat "0". Three significant figures, with thousands
 *  separators once the value is large enough for formatNumber to read better. */
function formatRate(n: number): string {
  if (n === 0) return '0'
  if (Math.abs(n) >= 1) return formatNumber(n)
  return String(Number(n.toPrecision(3)))
}

function cameraLabel(camera: Camera, mode: CameraMode): string {
  return camera.modes.length > 1 ? `${camera.model} (${mode.label})` : camera.model
}

function verdictCopy(result: SubResult, extraNoisePct: number): string {
  switch (result.verdict) {
    case 'ok':
      return `Longer subs lower the noise by less than ${trim(extraNoisePct, 0)} %.`
    case 'darkLimited':
      return 'Dark current outweighs the sky here. Cooling or faster optics would help more than longer subs.'
    case 'veryLong':
      return 'The sky is too faint to swamp the read noise in a practical sub. Shoot as long as tracking allows.'
    case 'clipping':
      return `The background alone fills ${trim(result.skyFill * 100, 0)} % of the well. Use a shorter sub or a lower gain.`
  }
}

function heroToneClass(result: SubResult | null): string {
  if (!result) return ''
  if (result.verdict === 'darkLimited') return 'fc-poor'
  if (result.verdict === 'veryLong' || result.verdict === 'clipping') return 'fc-fair'
  return ''
}

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

const SENSOR_FIELD_KEYS = ['pixelSize', 'qe', 'readNoise', 'fullWell', 'bitDepth', 'darkRef'] as const
type SensorFieldKey = typeof SENSOR_FIELD_KEYS[number]

function seedSensorText(sensor: SensorParams): Record<SensorFieldKey, string> {
  const text = {} as Record<SensorFieldKey, string>
  for (const key of SENSOR_FIELD_KEYS) text[key] = sensor[key] ? String(sensor[key]) : ''
  return text
}

export function SubExposureCalculator() {
  const projects = useAppStore((s) => s.projects)

  const [catalog, setCatalog] = useState<Camera[]>([])
  const [calcState, setCalcState] = useState<CalcState>(DEFAULT_STATE)
  const [restored, setRestored] = useState(false)
  const autoSelectedRef = useRef(false)

  const [editingSensorManual, setEditingSensorManual] = useState(false)
  const [sensorText, setSensorText] = useState<Record<SensorFieldKey, string>>(seedSensorText(blankSensor(null)))
  const [showComparePicker, setShowComparePicker] = useState(false)

  const userCameras = useMemo(() => collectUserCameras(projects, catalog), [projects, catalog])

  // Init: load the catalog and the saved state together, so a saved camera
  // id is validated against the real catalog rather than an empty one.
  useEffect(() => {
    let cancelled = false
    Promise.all([
      loadCameraCatalog().catch(() => [] as Camera[]),
      invoke<unknown>('get_setting', { key: SETTINGS_KEY }).catch(() => null),
    ]).then(([cat, saved]) => {
      if (cancelled) return
      setCatalog(cat)
      setCalcState(restoreState(saved, cat))
      setRestored(true)
    })
    return () => { cancelled = true }
  }, [])

  // Persist every change, once the initial restore has landed.
  useEffect(() => {
    if (!restored) return
    invoke('set_setting', { key: SETTINGS_KEY, value: calcState }).catch(() => {})
  }, [calcState, restored])

  const selection = useMemo(
    () => resolveSelection(calcState.cameraId, catalog, userCameras),
    [calcState.cameraId, catalog, userCameras],
  )

  const primaryUserCamera: UserCamera | null = selection?.kind === 'catalog'
    ? userCameras.find((u) => u.camera?.id === selection.camera.id) ?? null
    : selection?.kind === 'user' ? selection.userCamera : null

  const modes: CameraMode[] = selection?.kind === 'catalog' ? selection.camera.modes : []
  const mode: CameraMode | null = selection?.kind === 'catalog'
    ? modes.find((m) => m.id === calcState.modeId) ?? nearestMode(selection.camera, primaryUserCamera?.gain)
    : null

  const baseSensor: SensorParams = selection?.kind === 'catalog' && mode
    ? sensorParams(selection.camera, mode)
    : selection?.kind === 'user'
      ? blankSensor(selection.userCamera.pixelSize)
      : blankSensor(null)

  const currentOverrides: Partial<SensorParams> = calcState.cameraId !== null
    ? calcState.overridesByCamera[calcState.cameraId] ?? {}
    : {}
  const effectiveSensor: SensorParams = { ...baseSensor, ...currentOverrides }

  // Reseed the sensor-editor text fields whenever the camera or mode
  // changes — a remount-by-key would also work, this avoids it.
  useEffect(() => {
    setSensorText(seedSensorText(effectiveSensor))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calcState.cameraId, calcState.modeId])

  // With nothing saved, start from the camera the user has the most subs on.
  // A saved unmatched camera ('user:<instrume>') that the catalog now
  // matches (a newer catalog, or better matching) moves to the catalog entry
  // instead of staying a blank custom sensor.
  useEffect(() => {
    if (!restored || autoSelectedRef.current) return
    const savedId = calcState.cameraId
    if (savedId !== null) {
      if (!savedId.startsWith('user:')) { autoSelectedRef.current = true; return }
      const uc = userCameras.find((u) => `user:${u.instrume}` === savedId)
      if (!uc) return // library not loaded yet
      autoSelectedRef.current = true
      if (uc.camera) selectCamera(uc.camera.id)
      return
    }
    if (userCameras.length === 0) return
    autoSelectedRef.current = true
    const top = userCameras[0]
    const id = top.camera ? top.camera.id : `user:${top.instrume}`
    selectCamera(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored, userCameras, calcState.cameraId])

  function selectCamera(cameraId: string) {
    setCalcState((prev) => {
      const sel = resolveSelection(cameraId, catalog, userCameras)
      // The telescope doesn't change with the camera: a ratio typed for this
      // camera wins, then the one its subs record, else the current one stays.
      const recordedFocalRatio = (v: number | null) =>
        prev.focalRatioByCamera[cameraId] ?? (v !== null ? String(v) : prev.focalRatio)

      let sensorTemp: string
      let focalRatio: string
      let modeId: string | null = null

      if (sel?.kind === 'catalog') {
        const uc = userCameras.find((u) => u.camera?.id === sel.camera.id)
        modeId = nearestMode(sel.camera, uc?.gain).id
        sensorTemp = String(uc?.sensorTemp ?? defaultSensorTemp(sel.camera))
        focalRatio = recordedFocalRatio(uc?.focalRatio ?? null)
      } else if (sel?.kind === 'user') {
        sensorTemp = String(sel.userCamera.sensorTemp ?? defaultSensorTemp({ maxCooling: null }))
        focalRatio = recordedFocalRatio(sel.userCamera.focalRatio)
      } else {
        sensorTemp = String(defaultSensorTemp({ maxCooling: null }))
        focalRatio = recordedFocalRatio(null)
      }

      // Overrides are kept per camera id (see CalcState), so switching
      // cameras and back doesn't lose what was typed for a custom one.
      return { ...prev, cameraId, modeId, sensorTemp, focalRatio }
    })
    setEditingSensorManual(false)
  }

  /** Updates the current camera's own override slot. No-op without a
   *  selected camera — the sensor fields aren't reachable without one. */
  function updateCurrentOverrides(updater: (prev: Partial<SensorParams>) => Partial<SensorParams>) {
    setCalcState((prev) => {
      if (prev.cameraId === null) return prev
      const key = prev.cameraId
      return {
        ...prev,
        overridesByCamera: { ...prev.overridesByCamera, [key]: updater(prev.overridesByCamera[key] ?? {}) },
      }
    })
  }

  function handleSensorField(key: SensorFieldKey, text: string) {
    setSensorText((prev) => ({ ...prev, [key]: text }))
    const n = parseNum(text)
    updateCurrentOverrides((prevOverrides) => {
      const next = { ...prevOverrides }
      if (n === null) delete next[key]
      else next[key] = n
      return next
    })
  }

  function handleMonoChange(monoVal: boolean) {
    updateCurrentOverrides((prevOverrides) => ({ ...prevOverrides, mono: monoVal }))
  }

  function handleResetSensor() {
    setCalcState((prev) => {
      if (prev.cameraId === null) return prev
      const rest = { ...prev.overridesByCamera }
      delete rest[prev.cameraId]
      return { ...prev, overridesByCamera: rest }
    })
    setSensorText(seedSensorText(baseSensor))
  }

  function handleFocalRatioChange(text: string) {
    setCalcState((prev) => ({
      ...prev,
      focalRatio: text,
      focalRatioByCamera: prev.cameraId !== null
        ? { ...prev.focalRatioByCamera, [prev.cameraId]: text }
        : prev.focalRatioByCamera,
    }))
  }

  function handleAddCompare(cameraId: string) {
    const camera = catalog.find((c) => c.id === cameraId)
    if (!camera) return // 'custom' and unmatched user cameras have no sensor to compare without overrides
    const uc = userCameras.find((u) => u.camera?.id === camera.id)
    const modeId = nearestMode(camera, uc?.gain).id
    setCalcState((prev) => ({ ...prev, compare: [...prev.compare, { cameraId, modeId }].slice(0, MAX_COMPARE) }))
    setShowComparePicker(false)
  }

  function handleRemoveCompare(key: string) {
    setCalcState((prev) => ({ ...prev, compare: prev.compare.filter((e) => `${e.cameraId}:${e.modeId}` !== key) }))
  }

  function handleCompareModeChange(key: string, modeId: string) {
    setCalcState((prev) => ({
      ...prev,
      compare: prev.compare.map((e) => (`${e.cameraId}:${e.modeId}` === key ? { ...e, modeId } : e)),
    }))
  }

  const bortleRow = BORTLE_ROWS.find((r) => r.bortle === calcState.bortle) ?? null
  const sqmVal = calcState.skyMode === 'bortle' ? bortleRow?.sqm ?? null : parseNum(calcState.sqm)
  const focalRatioVal = parseNum(calcState.focalRatio)
  const filterPreset = FILTER_PRESETS.find((f) => f.id === calcState.filterId) ?? null
  const filterShareVal = calcState.filterId === 'custom'
    ? (() => { const p = parseNum(calcState.customFilterPct); return p !== null ? p / 100 : null })()
    : filterPreset?.share ?? null
  const sensorTempVal = parseNum(calcState.sensorTemp)

  const conditions: Conditions | null = sqmVal !== null && focalRatioVal !== null
    && filterShareVal !== null && sensorTempVal !== null
    ? { sqm: sqmVal, focalRatio: focalRatioVal, filterShare: filterShareVal, sensorTemp: sensorTempVal, extraNoise: calcState.extraNoise }
    : null

  const result: SubResult | null = conditions ? subExposure(effectiveSensor, conditions) : null

  const compareRows = calcState.compare.flatMap((entry) => {
    const camera = catalog.find((c) => c.id === entry.cameraId)
    const cameraMode = camera?.modes.find((m) => m.id === entry.modeId)
    if (!camera || !cameraMode) return []
    const sensor = sensorParams(camera, cameraMode)
    return [{
      key: `${entry.cameraId}:${entry.modeId}`,
      camera,
      mode: cameraMode,
      sensor,
      result: conditions ? subExposure(sensor, conditions) : null,
    }]
  })

  const primaryLabel = selection?.kind === 'catalog' && mode
    ? cameraLabel(selection.camera, mode)
    : selection?.kind === 'user'
      ? selection.userCamera.instrume
      : selection?.kind === 'custom'
        ? 'Custom camera'
        : 'No camera selected'

  const chart = useMemo(() => {
    const series = conditions
      ? [
        { id: 'primary', label: primaryLabel, points: sweepByFocalRatio(effectiveSensor, conditions) },
        ...compareRows.map((row) => ({
          id: row.key, label: cameraLabel(row.camera, row.mode), points: sweepByFocalRatio(row.sensor, conditions),
        })),
      ]
      : []
    return subChart(series, focalRatioVal)
  }, [conditions, effectiveSensor, compareRows, focalRatioVal, primaryLabel])

  const focalLengthHint = primaryUserCamera && primaryUserCamera.focalRatio === null && primaryUserCamera.focalLength !== null
    ? `${formatNumber(primaryUserCamera.focalLength)} mm in your subs`
    : null

  const sensorFieldsOpen = selection?.kind !== 'catalog' ? true : editingSensorManual
  // A recorded CCD-TEMP means the subs came from a regulated sensor, even when
  // the camera itself isn't in the catalog.
  const sensorCooled = selection?.kind === 'catalog'
    ? selection.camera.maxCooling !== null
    : selection?.kind === 'user' && selection.userCamera.sensorTemp !== null
  const hasOverrides = Object.keys(currentOverrides).length > 0

  return (
    <section className="calc-section se">
      <h2 className="calc-section-title">Sub exposure</h2>
      <p className="calc-section-desc">
        The longest single sub that still pays off: once the sky's own shot noise swamps the
        camera's read noise, a longer sub only costs dynamic range and lost frames.
      </p>

      <div className="fc-inputs">
        <div className="calc-panel fc-card">
          <h3 className="fc-card-title">Camera</h3>
          <div className="calc-field">
            <label className="calc-field-label" htmlFor="se-camera">Camera</label>
            <CameraPicker
              catalog={catalog}
              userCameras={userCameras}
              value={calcState.cameraId}
              onChange={selectCamera}
            />
          </div>

          {modes.length > 1 && (
            <Field id="se-mode" label="Mode">
              <select id="se-mode" className="calc-select" value={mode?.id ?? ''}
                onChange={(e) => setCalcState((prev) => ({ ...prev, modeId: e.target.value }))}>
                {modes.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </Field>
          )}

          <Field id="se-sensor-temp" label={sensorCooled ? 'Sensor' : 'Air temperature'} unit="°C">
            <input id="se-sensor-temp" className="calc-input" type="number" step="any"
              value={calcState.sensorTemp}
              onChange={(e) => setCalcState((prev) => ({ ...prev, sensorTemp: e.target.value }))} />
          </Field>

          {selection?.kind === 'catalog' && (
            <p className="calc-hint se-summary">
              {selection.camera.sensor} · {effectiveSensor.mono ? 'mono' : 'colour'} · {trim(effectiveSensor.pixelSize, 2)} µm
              {' '}· RN {trim(effectiveSensor.readNoise, 2)} e⁻ · FW {formatNumber(effectiveSensor.fullWell)} e⁻
            </p>
          )}

          {selection?.kind === 'catalog' ? (
            <div className="se-sensor-toggle">
              <button type="button" className="fc-link" onClick={() => setEditingSensorManual((v) => !v)}>
                {sensorFieldsOpen ? 'Hide sensor values' : 'Edit sensor values'}
              </button>
              {hasOverrides && (
                <span className="se-edited">
                  edited · <button type="button" className="fc-link" onClick={handleResetSensor}>Reset</button>
                </span>
              )}
            </div>
          ) : (
            <p className="calc-field-label">Sensor values</p>
          )}

          {sensorFieldsOpen && (
            <div className="fc-grid">
              <Field id="se-pixel" label="Pixel size" unit="µm">
                <input id="se-pixel" className="calc-input" type="number" step="any" min="0"
                  value={sensorText.pixelSize} onChange={(e) => handleSensorField('pixelSize', e.target.value)} />
              </Field>
              <Field id="se-qe" label="Quantum efficiency" unit="%">
                <input id="se-qe" className="calc-input" type="number" step="any" min="0" max="100"
                  value={sensorText.qe} onChange={(e) => handleSensorField('qe', e.target.value)} />
              </Field>
              <Field id="se-rn" label="Read noise" unit="e⁻">
                <input id="se-rn" className="calc-input" type="number" step="any" min="0"
                  value={sensorText.readNoise} onChange={(e) => handleSensorField('readNoise', e.target.value)} />
              </Field>
              <Field id="se-fw" label="Full well" unit="e⁻">
                <input id="se-fw" className="calc-input" type="number" step="any" min="0"
                  value={sensorText.fullWell} onChange={(e) => handleSensorField('fullWell', e.target.value)} />
              </Field>
              <Field id="se-bitdepth" label="Bit depth">
                <input id="se-bitdepth" className="calc-input" type="number" step="1" min="1"
                  value={sensorText.bitDepth} onChange={(e) => handleSensorField('bitDepth', e.target.value)} />
              </Field>
              <Field id="se-mono" label="Sensor colour">
                <div className="calc-seg" role="group" aria-label="Mono or colour">
                  <button type="button" className={`calc-seg-btn ${effectiveSensor.mono ? 'active' : ''}`}
                    onClick={() => handleMonoChange(true)}>Mono</button>
                  <button type="button" className={`calc-seg-btn ${!effectiveSensor.mono ? 'active' : ''}`}
                    onClick={() => handleMonoChange(false)}>Colour</button>
                </div>
              </Field>
              <Field id="se-dark" label="Dark current (ref. temp.)" unit="e⁻/px/s">
                <input id="se-dark" className="calc-input" type="number" step="any" min="0"
                  value={sensorText.darkRef} onChange={(e) => handleSensorField('darkRef', e.target.value)} />
              </Field>
            </div>
          )}
        </div>

        <div className="calc-panel fc-card">
          <h3 className="fc-card-title">Conditions</h3>
          <div className="se-switch-row">
            <div className="calc-field">
              <span className="calc-field-label">Sky</span>
              <div className="calc-seg" role="group" aria-label="Sky input mode">
                <button type="button" className={`calc-seg-btn ${calcState.skyMode === 'bortle' ? 'active' : ''}`}
                  onClick={() => setCalcState((prev) => ({ ...prev, skyMode: 'bortle' }))}>Bortle</button>
                <button type="button" className={`calc-seg-btn ${calcState.skyMode === 'sqm' ? 'active' : ''}`}
                  onClick={() => setCalcState((prev) => ({ ...prev, skyMode: 'sqm' }))}>SQM</button>
              </div>
            </div>
            <div className="calc-field">
              <span className="calc-field-label">Accepted extra noise</span>
              <div className="calc-seg" role="group" aria-label="Accepted extra noise">
                {NOISE_OPTIONS.map((n) => (
                  <button key={n} type="button" className={`calc-seg-btn ${calcState.extraNoise === n ? 'active' : ''}`}
                    onClick={() => setCalcState((prev) => ({ ...prev, extraNoise: n }))}>{trim(n * 100, 0)} %</button>
                ))}
              </div>
            </div>
          </div>

          {calcState.skyMode === 'bortle' ? (
            <Field id="se-bortle" label="Bortle class">
              <select id="se-bortle" className="calc-select" value={String(calcState.bortle)}
                onChange={(e) => setCalcState((prev) => ({ ...prev, bortle: Number(e.target.value) }))}>
                {BORTLE_ROWS.map((row) => (
                  <option key={row.bortle} value={row.bortle}>{row.bortle} · {row.sqm.toFixed(1)} mag/arcsec²</option>
                ))}
              </select>
            </Field>
          ) : (
            <Field id="se-sqm" label="SQM" unit="mag/arcsec²">
              <input id="se-sqm" className="calc-input" type="number" step="0.1"
                value={calcState.sqm} onChange={(e) => setCalcState((prev) => ({ ...prev, sqm: e.target.value }))} />
            </Field>
          )}

          <Field id="se-filter" label="Filter">
            <select id="se-filter" className="calc-select" value={calcState.filterId}
              onChange={(e) => setCalcState((prev) => ({ ...prev, filterId: e.target.value }))}>
              {FILTER_PRESETS.map((f) => (
                <option key={f.id} value={f.id}>{f.label} ({trim(f.share * 100, 1)} %)</option>
              ))}
              <option value="custom">Custom…</option>
            </select>
          </Field>

          {calcState.filterId === 'custom' && (
            <Field id="se-filter-pct" label="Filter passes" unit="%">
              <input id="se-filter-pct" className="calc-input" type="number" step="any" min="0" max="100"
                value={calcState.customFilterPct}
                onChange={(e) => setCalcState((prev) => ({ ...prev, customFilterPct: e.target.value }))} />
            </Field>
          )}

          <Field id="se-focal-ratio" label="Focal ratio" unit="f/">
            <input id="se-focal-ratio" className="calc-input" type="number" step="0.1" min="0"
              value={calcState.focalRatio} onChange={(e) => handleFocalRatioChange(e.target.value)} />
          </Field>
          <div className="fc-chips" role="group" aria-label="Common focal ratios">
            {FOCAL_RATIO_CHIPS.map((v) => (
              <button key={v} type="button" className={`fc-chip ${parseNum(calcState.focalRatio) === v ? 'active' : ''}`}
                onClick={() => handleFocalRatioChange(String(v))}>f/{v}</button>
            ))}
          </div>
          {focalLengthHint && <p className="calc-hint">{focalLengthHint}</p>}
        </div>
      </div>

      <div className="fc-results">
        <div className={`fc-hero ${heroToneClass(result)}`}>
          <div className="calc-result-label">Recommended sub exposure</div>
          <div className="fc-hero-row">
            <div className="fc-hero-value">{result ? formatSub(result.suggested) : '—'}</div>
          </div>
          <div className="fc-verdict">{result ? verdictCopy(result, calcState.extraNoise * 100) : ' '}</div>
          <div className="calc-result-sub">
            {result ? `Read noise is swamped from ${formatSub(result.minSub)}` : ' '}
          </div>
        </div>

        <div className="fc-stats">
          <div className="calc-result-card">
            <div className="calc-result-label">Sky</div>
            <div className="calc-result-value">{result ? `${formatRate(result.skyRate)} e⁻/px/s` : '—'}</div>
          </div>
          <div className="calc-result-card">
            <div className="calc-result-label">Dark</div>
            <div className="calc-result-value">{result ? `${formatRate(result.darkRate)} e⁻/px/s` : '—'}</div>
          </div>
          <div className="calc-result-card">
            <div className="calc-result-label">Sky fill</div>
            <div className="calc-result-value">{result ? `${trim(result.skyFill * 100, 1)} %` : '—'}</div>
          </div>
          <div className="calc-result-card">
            <div className="calc-result-label">Background clips after</div>
            <div className="calc-result-value">{result ? formatSub(result.clipTime) : '—'}</div>
          </div>
        </div>
      </div>

      <div className="calc-panel fc-card">
        <h3 className="fc-card-title">Sub length by focal ratio</h3>
        <p className="fc-caption">
          Same camera, sky and filter at every focal ratio. The dot is your telescope.
        </p>
        <SubExposureChartView chart={chart} />
      </div>

      <div className="calc-panel fc-card">
        <div className="fc-card-head">
          <h3 className="fc-card-title">Compare cameras</h3>
          {calcState.compare.length < MAX_COMPARE && (
            <button type="button" className="btn" onClick={() => setShowComparePicker((v) => !v)}>
              <Plus size={14} /> <span className="btn-label">Compare with another camera</span>
            </button>
          )}
        </div>

        {showComparePicker && (
          <CameraPicker catalog={catalog} userCameras={userCameras} value={null} onChange={handleAddCompare} />
        )}

        {compareRows.length > 0 && (
          <div className="calc-table-wrapper">
            <table className="calc-table">
              <thead>
                <tr>
                  <th>Camera</th>
                  <th>Mode</th>
                  <th className="calc-num">Sky</th>
                  <th className="calc-num">Dark</th>
                  <th className="calc-num">Sub</th>
                  <th className="calc-num">Sky fill</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                <tr className="calc-row-active">
                  <td>{primaryLabel}</td>
                  <td>{modes.length > 1 ? mode?.label : '—'}</td>
                  <td className="calc-num">{result ? `${formatRate(result.skyRate)} e⁻/px/s` : '—'}</td>
                  <td className="calc-num">{result ? `${formatRate(result.darkRate)} e⁻/px/s` : '—'}</td>
                  <td className="calc-num">{result ? formatSub(result.suggested) : '—'}</td>
                  <td className="calc-num">{result ? `${trim(result.skyFill * 100, 1)} %` : '—'}</td>
                  <td />
                </tr>
                {compareRows.map((row) => (
                  <tr key={row.key}>
                    <td>{row.camera.model}</td>
                    <td>
                      {row.camera.modes.length > 1 ? (
                        <select className="calc-select" value={row.mode.id}
                          onChange={(e) => handleCompareModeChange(row.key, e.target.value)}>
                          {row.camera.modes.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                        </select>
                      ) : '—'}
                    </td>
                    <td className="calc-num">{row.result ? `${formatRate(row.result.skyRate)} e⁻/px/s` : '—'}</td>
                    <td className="calc-num">{row.result ? `${formatRate(row.result.darkRate)} e⁻/px/s` : '—'}</td>
                    <td className="calc-num">{row.result ? formatSub(row.result.suggested) : '—'}</td>
                    <td className="calc-num">{row.result ? `${trim(row.result.skyFill * 100, 1)} %` : '—'}</td>
                    <td>
                      <button type="button" className="fc-link" onClick={() => handleRemoveCompare(row.key)} title="Remove">
                        <X size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="calc-panel fc-card fc-sources">
        <h3 className="fc-card-title">Method and credit</h3>
        <p className="fc-caption">
          The longest sub is t = C · RN² / (sky + dark): the Glover constant C set by the accepted
          extra noise, over the electrons a pixel collects each second from the sky background (from
          sky brightness, pixel size, focal ratio, quantum efficiency and the filter) and from dark
          current. Binning, optics transmission and the target itself are not modelled; catalog
          sensor values are typical for the model, not measured on your own unit — treat the result
          as a good estimate, not a measurement.
        </p>
        <ul className="fc-source-list">
          <li>
            <b>astrodes.com</b>{' '}
            <a href="https://astrodes.com/misc/astrosubcalc/"
              onClick={(e) => { e.preventDefault(); void openUrl('https://astrodes.com/misc/astrosubcalc/') }}>
              AstroSubCalc
            </a>
            <span>The camera database and the idea for this calculator, used with the author's permission.</span>
          </li>
          <li>
            <b>Robin Glover</b>{' '}
            <a href={GLOVER_SOURCE_URL}
              onClick={(e) => { e.preventDefault(); void openUrl(GLOVER_SOURCE_URL) }}>
              SharpCap forum, 2022
            </a>
            <span>The sub-exposure method, and the sky-rate estimate this model is checked against.</span>
          </li>
        </ul>
      </div>
    </section>
  )
}
