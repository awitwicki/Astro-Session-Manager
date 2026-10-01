import { Fragment, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'
import { FolderOpen } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import type { ImportSourceScan } from '../../types/importSource'
import {
  buildProposal, planImport, proposalTotals, validateProposal, withLightRows,
  type FlatDestination, type FolderRef, type ImportProposal, type LightRow,
} from '../../lib/asiairImport'
import { formatFileSize, formatTemperature } from '../../lib/formatters'
import { groupCheckState } from '../../lib/groupCheck'
import { Checkbox } from '../ui/Checkbox'

const SOURCE_KEY = 'importSourcePath'

const encodeDest = (d: FlatDestination) =>
  d.kind === 'row' ? `row:${d.rowId}` : d.kind === 'session' ? `session:${d.sessionPath}` : 'skip'

export function AsiairImportDialog({ onClose }: { onClose: () => void }) {
  const projects = useAppStore((s) => s.projects)
  const rootFolder = useAppStore((s) => s.rootFolder)
  const tempTolerance = useAppStore((s) => s.darkTempTolerance)
  const enqueueImport = useAppStore((s) => s.enqueueImport)

  const [sourcePath, setSourcePath] = useState<string | null>(null)
  const [scan, setScan] = useState<ImportSourceScan | null>(null)
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null)
  const [matchTemperature, setMatchTemperature] = useState(true)
  const [proposal, setProposal] = useState<ImportProposal | null>(null)
  const [showUnreadable, setShowUnreadable] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runScan = async (path: string) => {
    setScanning(true)
    setError(null)
    setScan(null)
    setProposal(null)
    setProgress(null)
    try {
      const result = await invoke<ImportSourceScan>('scan_import_source', { path })
      setScan(result)
      setProposal(buildProposal(result, projects, { matchTemperature, tempTolerance }))
    } catch (e) {
      setError(String(e))
    } finally {
      setScanning(false)
    }
  }

  const pickFolder = async () => {
    const picked = await open({ directory: true, title: 'Choose the ASIAIR folder (mounted share, USB stick or SD card)' })
    if (typeof picked !== 'string') return
    setSourcePath(picked)
    invoke('set_setting', { key: SOURCE_KEY, value: picked }).catch(() => {})
    void runScan(picked)
  }

  useEffect(() => {
    invoke<unknown>('get_setting', { key: SOURCE_KEY })
      .then((saved) => {
        if (typeof saved === 'string' && saved) {
          setSourcePath(saved)
          void runScan(saved)
        }
      })
      .catch(() => {})
    // Runs once on open; the saved path is read only here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const unlisten = listen<{ current: number; total: number }>('import_source:progress', (e) => setProgress(e.payload))
    return () => { unlisten.then((fn) => fn()) }
  }, [])

  const toggleTemperature = (on: boolean) => {
    setMatchTemperature(on)
    if (scan) setProposal(buildProposal(scan, projects, { matchTemperature: on, tempTolerance }))
  }

  const updateRow = (id: string, patch: Partial<LightRow>) => {
    if (!proposal) return
    const rows = proposal.lightRows.map((r) => (r.id === id ? { ...r, ...patch } : r))
    setProposal(withLightRows(proposal, rows, projects))
  }

  // Night select-all: everything on unless all are on already.
  const toggleNight = (night: string) => {
    if (!proposal) return
    const inNight = (r: LightRow) => r.group.nightKey === night
    const on = groupCheckState(proposal.lightRows.filter(inNight).map((r) => r.include)) !== 'all'
    setProposal(withLightRows(proposal, proposal.lightRows.map((r) => (inNight(r) ? { ...r, include: on } : r)), projects))
  }

  const foldersOf = (projectPath: string): FolderRef[] => {
    const p = projects.find((x) => x.path === projectPath)
    return p ? p.filters.map((f) => ({ projectPath: p.path, projectName: p.name, filterPath: f.path, filterName: f.name })) : []
  }

  const pickProject = (row: LightRow, projectPath: string) =>
    updateRow(row.id, projectPath
      ? { folder: foldersOf(projectPath)[0] ?? null, include: true }
      : { folder: null })

  const sessionOptions = projects.flatMap((p) => p.filters.flatMap((f) =>
    f.sessions.map((s) => ({ path: s.path, label: `${p.name} / ${f.name} / ${s.date}` }))))

  const setFlatDest = (id: string, value: string) => {
    if (!proposal) return
    let destination: FlatDestination = { kind: 'skip' }
    if (value.startsWith('row:')) destination = { kind: 'row', rowId: value.slice(4) }
    if (value.startsWith('session:')) {
      const sessionPath = value.slice(8)
      const label = sessionOptions.find((o) => o.path === sessionPath)?.label ?? sessionPath
      destination = { kind: 'session', sessionPath, label }
    }
    setProposal({ ...proposal, flatRows: proposal.flatRows.map((f) => (f.id === id ? { ...f, destination } : f)) })
  }

  const issues = proposal ? validateProposal(proposal, projects) : new Map()
  const blocked = [...issues.values()].some((i) => i.level === 'error')
  const totals = proposal ? proposalTotals(proposal) : null
  const nights = proposal
    ? [...new Set(proposal.lightRows.map((r) => r.group.nightKey))].sort().reverse()
    : []

  const doImport = async () => {
    if (!proposal || !rootFolder) return
    setImporting(true)
    setError(null)
    try {
      const plan = planImport(proposal)
      const dirs = new Map<string, string>()
      for (const s of plan.sessions) {
        dirs.set(s.rowId, await invoke<string>('create_session', { filterPath: s.filterPath, sessionName: s.sessionName, rootFolder, subfolders: s.subfolders }))
      }
      for (const c of plan.copies) {
        const base = 'rowId' in c.target ? dirs.get(c.target.rowId) : c.target.sessionPath
        if (!base) throw new Error(`No session folder for ${c.label}`)
        enqueueImport({ files: c.files, targetDir: `${base}/${c.sub}`, label: c.label })
      }
      onClose()
    } catch (e) {
      setError(String(e))
      setImporting(false)
    }
  }

  const issueLine = (id: string) => {
    const issue = issues.get(id)
    return issue ? (
      <tr className="data-grid-note"><td /><td colSpan={4} className={`asiair-issue ${issue.level}`}>{issue.message}</td></tr>
    ) : null
  }

  return (
    <div className="modal-overlay" onClick={() => !importing && !scanning && onClose()}>
      <div className="modal asiair-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">Import from ASIAIR</h3>
        <div className="asiair-source">
          <FolderOpen size={14} />
          <code title={sourcePath ?? ''}>{sourcePath ?? 'No folder chosen'}</code>
          <button className="btn btn-sm" onClick={pickFolder} disabled={scanning || importing}>
            {sourcePath ? 'Change' : 'Choose folder'}
          </button>
          {sourcePath && (
            <button className="btn btn-sm" onClick={() => runScan(sourcePath)} disabled={scanning || importing}>Rescan</button>
          )}
        </div>
        <div className="asiair-hint">Over Wi-Fi, run this after the session ends — copying while imaging can disturb the ASIAIR.</div>

        <div className="asiair-body">
          {scanning && (
            <div className="wbpp-loading">
              Reading headers… {progress ? `${progress.current} / ${progress.total}` : ''}
              <button className="btn btn-sm" style={{ marginLeft: 12 }} onClick={() => invoke('cancel_operation', { operation: 'source_scan' })}>Cancel</button>
            </div>
          )}
          {!scanning && proposal && proposal.lightRows.length === 0 && (
            <div className="wbpp-loading">No new subs for existing projects.</div>
          )}
          {!scanning && proposal && nights.length > 0 && (
            <table className="data-grid asiair-grid">
              <colgroup><col style={{ width: 44 }} /><col /><col style={{ width: 180 }} /><col style={{ width: 150 }} /><col style={{ width: 110 }} /></colgroup>
              <thead>
                <tr><th /><th>Subs</th><th>Project</th><th>Folder</th><th>Session</th></tr>
              </thead>
              {nights.map((night) => {
                const rows = proposal.lightRows.filter((r) => r.group.nightKey === night)
                const state = groupCheckState(rows.map((r) => r.include))
                return (
                  <tbody key={night}>
                    <tr className="data-grid-group">
                      <td>
                        <Checkbox checked={state === 'all'} indeterminate={state === 'some'} onChange={() => toggleNight(night)}
                          ariaLabel={`Select all subs from the night of ${night}`} />
                      </td>
                      <td colSpan={4}>
                        Night of {night}
                        <span className="data-grid-group-meta">{rows.filter((r) => r.include).length} of {rows.length} selected</span>
                      </td>
                    </tr>
                    {rows.map((r, i) => (
                      <Fragment key={r.id}>
                        <tr className={i % 2 ? 'data-grid-zebra' : undefined}>
                          <td><input type="checkbox" checked={r.include} onChange={(e) => updateRow(r.id, { include: e.target.checked })} /></td>
                          <td className="asiair-summary">
                            {[r.group.filter || 'No filter', `${r.group.exposure} s`, r.group.ccdTemp !== null ? formatTemperature(r.group.ccdTemp) : null].filter(Boolean).join(' · ')}
                            <span className="data-grid-muted"> · {r.group.files.length} subs · {formatFileSize(r.group.sizeBytes)}</span>
                          </td>
                          <td>
                            <select className="settings-input" value={r.folder?.projectPath ?? ''}
                              onChange={(e) => pickProject(r, e.target.value)}>
                              <option value="">— project —</option>
                              {projects.map((p) => <option key={p.path} value={p.path}>{p.name}</option>)}
                            </select>
                          </td>
                          <td>
                            <select className="settings-input" value={r.folder?.filterPath ?? ''} disabled={!r.folder}
                              onChange={(e) => updateRow(r.id, { folder: foldersOf(r.folder?.projectPath ?? '').find((f) => f.filterPath === e.target.value) ?? null })}>
                              {!r.folder && <option value="">— folder —</option>}
                              {r.folder && foldersOf(r.folder.projectPath).map((f) => <option key={f.filterPath} value={f.filterPath}>{f.filterName}</option>)}
                            </select>
                          </td>
                          <td>
                            <input type="text" className="settings-input" value={r.sessionName} disabled={!r.include || !r.folder}
                              onChange={(e) => updateRow(r.id, { sessionName: e.target.value, nameEdited: true })} />
                          </td>
                        </tr>
                        {issueLine(r.id)}
                      </Fragment>
                    ))}
                    {proposal.flatRows.filter((f) => f.group.nightKey === night).map((f) => (
                      <Fragment key={f.id}>
                        <tr className="data-grid-flat">
                          <td />
                          <td className="asiair-summary">
                            Flats · {f.group.filter || 'No filter'}
                            <span className="data-grid-muted"> · {f.group.files.length} subs · {formatFileSize(f.group.sizeBytes)}</span>
                          </td>
                          <td colSpan={3}>
                            <select className="settings-input" value={encodeDest(f.destination)} onChange={(e) => setFlatDest(f.id, e.target.value)}>
                              <option value="skip">Don't import</option>
                              <optgroup label="This night">
                                {rows.filter((r) => r.include && r.folder).map((r) => (
                                  <option key={r.id} value={`row:${r.id}`}>{`${r.folder?.projectName} / ${r.folder?.filterName} / ${r.sessionName}`}</option>
                                ))}
                              </optgroup>
                              <optgroup label="Other session">
                                {sessionOptions.map((o) => <option key={o.path} value={`session:${o.path}`}>{o.label}</option>)}
                              </optgroup>
                            </select>
                          </td>
                        </tr>
                        {issueLine(f.id)}
                      </Fragment>
                    ))}
                  </tbody>
                )
              })}
            </table>
          )}
        </div>

        {proposal && !scanning && (
          <div className="asiair-footer">
            <label className="asiair-check"><input type="checkbox" checked={matchTemperature} onChange={(e) => toggleTemperature(e.target.checked)} /> Match temperature</label>
            {proposal.unmatchedCount > 0 && <span className="asiair-muted">{proposal.unmatchedCount} subs didn't match any project</span>}
            {proposal.unreadable.length > 0 && (
              <button className="btn btn-sm" onClick={() => setShowUnreadable(!showUnreadable)}>
                {proposal.unreadable.length} files unreadable
              </button>
            )}
            {totals && <span>{totals.nights} nights · {totals.sessions} sessions · {totals.files} files · {formatFileSize(totals.bytes)}</span>}
          </div>
        )}
        {showUnreadable && proposal && (
          <ul className="wbpp-warnings">
            {proposal.unreadable.map((u) => <li key={u.path}>{u.path} — {u.error}</li>)}
          </ul>
        )}
        {error && <div className="wbpp-error">{error}</div>}
        <div className="modal-actions">
          <button className="btn" onClick={onClose} disabled={importing}>Close</button>
          <button className="btn btn-primary" onClick={doImport}
            disabled={!proposal || blocked || importing || scanning || !totals || totals.files === 0}>
            Import
          </button>
        </div>
      </div>
    </div>
  )
}
