import { AlertTriangle, FolderOpen } from 'lucide-react'
import { formatFileSize } from '../../lib/formatters'
import type { ExportKind, ExportSettings } from '../../lib/wbppExport'
import type { Placement, PreflightResult } from '../../types/wbppExport'

// Laid out column-first in two columns: raw frames on the left, masters on the right.
const INCLUDE_LABELS: [ExportKind, string][] = [
  ['light', 'Lights'], ['flat', 'Flats'], ['sharedFlat', 'Shared flats'], ['dark', 'Session darks'], ['bias', 'Session biases'],
  ['masterFlat', 'Master flats'], ['masterDark', 'Master dark'], ['masterDarkFlat', 'Master darkflat'], ['masterBias', 'Master bias'],
]

const KIND_SHORT: Record<ExportKind, string> = {
  light: 'lights', flat: 'flats', sharedFlat: 'shared flats', masterFlat: 'master flats', masterDark: 'master darks',
  masterDarkFlat: 'master darkflats', masterBias: 'master biases', dark: 'darks', bias: 'biases',
}

interface Props {
  settings: ExportSettings
  onChange: (patch: Partial<ExportSettings>) => void
  moonReason: string | null
  anyAnalyzed: boolean
  folderName: string
  onPickDestination: () => void
  preflight: PreflightResult | null
  preflightError: string | null
  placement: Placement | null
  counts: Record<ExportKind, number>
  sourceBytes: number
  diskBytes: number
  warnings: string[]
}

function placementBadge(placement: Placement | null, preflight: PreflightResult | null) {
  if (!placement || !preflight) return null
  if (placement === 'symlink')
    return <span className="badge badge-success">Symlinks ✓ — no extra space; originals must stay in place</span>
  if (placement === 'hardlink')
    return <span className="badge badge-success">Hard links — same volume, no extra space</span>
  return (
    <span className="badge badge-warning">
      Copy — links unavailable: {preflight.symlink.reason ?? preflight.hardlink.reason}
    </span>
  )
}

export function ExportSettingsPanel(p: Props) {
  const { settings, onChange } = p
  const numInput = (value: number | null, set: (v: number | null) => void, step: number) => (
    <input
      className="settings-input wbpp-num"
      type="number"
      step={step}
      min={0}
      value={value ?? ''}
      placeholder="off"
      onChange={(e) => set(e.target.value === '' ? null : Math.max(0, Number(e.target.value)))}
    />
  )
  const freeBytes = p.preflight?.freeBytes ?? null

  return (
    <div className="wbpp-settings">
      <section>
        <h4>Include</h4>
        <div className="wbpp-include">
          {INCLUDE_LABELS.map(([kind, label]) => (
            <label key={kind} className="wbpp-check">
              <input
                type="checkbox"
                checked={settings.include[kind]}
                onChange={(e) => onChange({ include: { ...settings.include, [kind]: e.target.checked } })}
              />
              {label}
            </label>
          ))}
        </div>
      </section>

      <section>
        <h4>Moon</h4>
        <label className="wbpp-check">
          <input
            type="checkbox"
            disabled={p.moonReason !== null}
            checked={settings.moonCutoffEnabled}
            onChange={(e) => onChange({ moonCutoffEnabled: e.target.checked })}
          />
          Exclude when Moon closer than {settings.moonMinSepDeg}°
        </label>
        <input
          type="range" min={0} max={120} step={5}
          disabled={p.moonReason !== null || !settings.moonCutoffEnabled}
          value={settings.moonMinSepDeg}
          onChange={(e) => onChange({ moonMinSepDeg: Number(e.target.value) })}
        />
        <label className="wbpp-check">
          <input
            type="checkbox"
            disabled={p.moonReason !== null || !settings.moonCutoffEnabled}
            checked={settings.moonOnlyAboveHorizon}
            onChange={(e) => onChange({ moonOnlyAboveHorizon: e.target.checked })}
          />
          Only when Moon is above horizon
        </label>
        {p.moonReason && <div className="wbpp-hint">Unavailable: {p.moonReason}</div>}
      </section>

      <section>
        <h4>Quality</h4>
        {!p.anyAnalyzed && <div className="wbpp-hint">Run Analyze on a filter first</div>}
        <div className="wbpp-cutoffs">
          <label>
            <span>FWHM ≤</span>
            {numInput(settings.fwhmMax, (v) => onChange({ fwhmMax: v }), 0.1)}
          </label>
          <label>
            <span>Eccentricity ≤</span>
            {numInput(settings.eccMax, (v) => onChange({ eccMax: v }), 0.05)}
          </label>
        </div>
      </section>

      <section>
        <h4>Destination</h4>
        <button className="btn btn-sm" onClick={p.onPickDestination}>
          <FolderOpen size={13} /> {settings.destinationParent ? 'Change…' : 'Choose folder…'}
        </button>
        {settings.destinationParent && (
          <div className="wbpp-path">{settings.destinationParent}/{p.folderName}</div>
        )}
        {p.preflightError && <div className="wbpp-error">{p.preflightError}</div>}
      </section>

      <section>
        <h4>Summary</h4>
        <div className="wbpp-summary">
          {(Object.keys(p.counts) as ExportKind[])
            .filter((k) => p.counts[k] > 0)
            .map((k) => `${p.counts[k]} ${KIND_SHORT[k]}`)
            .join(' · ') || 'Nothing selected'}
        </div>
        <div className="wbpp-summary">Source size: {formatFileSize(p.sourceBytes)}</div>
        <div className="wbpp-summary">
          Disk space used: <strong>{p.placement ? formatFileSize(p.diskBytes) : '— (choose a destination)'}</strong>
        </div>
        {freeBytes !== null && <div className="wbpp-summary">Free on target: {formatFileSize(freeBytes)}</div>}
        {placementBadge(p.placement, p.preflight)}
        {p.placement === 'hardlink' && (
          <div className="wbpp-hint">Hard-linked files share data with the originals; WBPP never writes to its inputs.</div>
        )}
        {p.warnings.length > 0 && (
          <ul className="wbpp-warnings">
            {p.warnings.map((w) => <li key={w}><AlertTriangle size={12} /> {w}</li>)}
          </ul>
        )}
      </section>
    </div>
  )
}
