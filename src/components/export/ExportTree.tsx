import { useState } from 'react'
import { ChevronDown, ChevronRight, Link2, Star } from 'lucide-react'
import { formatFileSize } from '../../lib/formatters'
import {
  calEnabled, calFiles, frameExclusion, isFrameIncluded,
  type CalKind, type ExportSelection, type ExportSettings, type FilterNode, type FrameRow, type NightNode,
} from '../../lib/wbppExport'

type SortKey = 'filename' | 'dateObs' | 'moonSepDeg' | 'moonIllum' | 'fwhm' | 'ecc'

const CAL_LABELS: Record<CalKind, string> = {
  masterFlat: 'Master flat', flat: 'Flats', sharedFlat: 'Shared flats', masterDark: 'Master dark', masterDarkFlat: 'Master darkflat', masterBias: 'Master bias', dark: 'Darks', bias: 'Biases',
}

function TriCheckbox({ checked, indeterminate, onChange }: { checked: boolean; indeterminate: boolean; onChange: () => void }) {
  return (
    <input
      type="checkbox"
      checked={checked}
      ref={(el) => { if (el) el.indeterminate = indeterminate }}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
    />
  )
}

const fmt = (v: number | null, digits: number) => (v === null ? '—' : v.toFixed(digits))
const fmtTime = (iso: string | null) => {
  if (!iso) return '—'
  const d = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function sortRows(rows: FrameRow[], key: SortKey, dir: 1 | -1): FrameRow[] {
  return [...rows].sort((a, b) => {
    const av = a[key]
    const bv = b[key]
    if (av === null && bv === null) return 0
    if (av === null) return 1
    if (bv === null) return -1
    return (av < bv ? -1 : av > bv ? 1 : 0) * dir
  })
}

interface Props {
  tree: FilterNode[]
  settings: ExportSettings
  selection: ExportSelection
  onSelectionChange: (s: ExportSelection) => void
}

export function ExportTree({ tree, settings, selection, onSelectionChange }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'filename', dir: 1 })

  const included = (n: NightNode) => n.frames.filter((f) => isFrameIncluded(f, n, settings, selection))
  const nightDisabled = (n: NightNode) => selection.disabledNights.includes(n.key)

  const setNightsEnabled = (keys: string[], enabled: boolean) => {
    const rest = selection.disabledNights.filter((k) => !keys.includes(k))
    onSelectionChange({ ...selection, disabledNights: enabled ? rest : [...rest, ...keys] })
  }
  const toggleFrame = (row: FrameRow, n: NightNode) =>
    onSelectionChange({
      ...selection,
      frameOverrides: { ...selection.frameOverrides, [row.path]: !isFrameIncluded(row, n, settings, selection) },
    })
  const toggleCal = (n: NightNode, kind: CalKind) =>
    onSelectionChange({
      ...selection,
      nightCal: {
        ...selection.nightCal,
        [n.key]: { ...selection.nightCal[n.key], [kind]: !calEnabled(n, kind, settings, selection) },
      },
    })
  const header = (key: SortKey, label: string) => (
    <th
      className="wbpp-sortable"
      onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : 1 }))}
    >
      {label}{sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
    </th>
  )

  return (
    <div className="wbpp-tree">
      {tree.map((filter) => {
        const total = filter.nights.reduce((s, n) => s + n.frames.length, 0)
        const inc = filter.nights.reduce((s, n) => s + included(n).length, 0)
        const size = filter.nights.reduce((s, n) => s + included(n).reduce((a, f) => a + f.sizeBytes, 0), 0)
        const allEnabled = filter.nights.every((n) => !nightDisabled(n))
        const fKey = `f:${filter.name}`
        return (
          <div key={filter.name} className="wbpp-filter">
            <div className="wbpp-row wbpp-row-filter" onClick={() => setExpanded((e) => ({ ...e, [fKey]: !e[fKey] }))}>
              {expanded[fKey] === false ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              <TriCheckbox
                checked={inc > 0 && inc === total}
                indeterminate={inc > 0 && inc < total}
                onChange={() => setNightsEnabled(filter.nights.map((n) => n.key), !allEnabled)}
              />
              <span className="wbpp-name">{filter.name}</span>
              <span className="wbpp-meta">{inc}/{total} frames · {formatFileSize(size)}</span>
            </div>
            {expanded[fKey] !== false && filter.nights.map((n) => {
              const nInc = included(n).length
              const nKey = `n:${n.key}`
              return (
                <div key={n.key} className="wbpp-night">
                  <div className="wbpp-row" onClick={() => setExpanded((e) => ({ ...e, [nKey]: !e[nKey] }))}>
                    {expanded[nKey] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <TriCheckbox
                      checked={nInc > 0 && nInc === n.frames.length}
                      indeterminate={nInc > 0 && nInc < n.frames.length}
                      onChange={() => setNightsEnabled([n.key], nightDisabled(n))}
                    />
                    <span className="wbpp-name">{n.sessionName}</span>
                    <span className="wbpp-meta">NIGHT_{n.nightDate} · {nInc}/{n.frames.length}</span>
                  </div>
                  <div className="wbpp-chips">
                    {(Object.keys(CAL_LABELS) as CalKind[]).map((kind) => {
                      const files = calFiles(n, kind)
                      if (files.length === 0) return null
                      const on = calEnabled(n, kind, settings, selection)
                      return (
                        <button
                          key={kind}
                          className={`wbpp-chip${on ? ' wbpp-chip-on' : ''}`}
                          onClick={() => toggleCal(n, kind)}
                          title={
                            kind === 'sharedFlat' && n.sharedFlats
                              ? `From ${n.sharedFlats.label}\n${files.map((f) => f.filename).join('\n')}`
                              : files.map((f) => f.filename).join('\n')
                          }
                        >
                          {kind === 'masterFlat' && <Star size={11} />}
                          {kind === 'sharedFlat' && <Link2 size={11} />}
                          {CAL_LABELS[kind]}{files.length > 1 ? ` (${files.length})` : ''}
                          {kind === 'sharedFlat' && n.sharedFlats ? ` · ${n.sharedFlats.label}` : ''}
                        </button>
                      )
                    })}
                  </div>
                  {expanded[nKey] && (
                    <table className="table wbpp-frames">
                      <thead>
                        <tr>
                          <th />
                          {header('filename', 'File')}
                          {header('dateObs', 'Time')}
                          {header('moonSepDeg', 'Moon °')}
                          {header('moonIllum', 'Illum')}
                          {header('fwhm', 'FWHM')}
                          {header('ecc', 'Ecc')}
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {sortRows(n.frames, sort.key, sort.dir).map((row) => {
                          const on = isFrameIncluded(row, n, settings, selection)
                          const reason = frameExclusion(row, settings)
                          return (
                            <tr key={row.path} className={on ? '' : 'wbpp-excluded'}>
                              <td><input type="checkbox" checked={on} onChange={() => toggleFrame(row, n)} /></td>
                              <td>{row.filename}</td>
                              <td>{fmtTime(row.dateObs)}</td>
                              <td>{fmt(row.moonSepDeg, 0)}</td>
                              <td>{row.moonIllum === null ? '—' : `${Math.round(row.moonIllum * 100)}%`}</td>
                              <td>{fmt(row.fwhm, 2)}</td>
                              <td>{fmt(row.ecc, 2)}</td>
                              <td className="wbpp-reason">{reason ?? ''}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
