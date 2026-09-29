import { useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'
import { FolderOpen } from 'lucide-react'
import { isDslrFile } from '../../lib/dslrUtils'
import { useAppStore } from '../../store/appStore'
import type { FitsHeader, Project } from '../../types'
import type { ExportProgress, ExportResult, PreflightResult } from '../../types/wbppExport'
import {
  buildExportTree, buildPlan, countByKind, EMPTY_SELECTION, estimateSize, exportFolderName, exportWarnings,
  mergeSettings, predictPlacement, resolveMoonContext, DEFAULT_EXPORT_SETTINGS,
  type ExportSelection, type ExportSettings,
} from '../../lib/wbppExport'
import { ExportTree } from './ExportTree'
import { ExportSettingsPanel } from './ExportSettingsPanel'

const SETTINGS_KEY = 'wbppExportSettings'

interface Props {
  project: Project
  onClose: () => void
}

export function WbppExportDialog({ project, onClose }: Props) {
  const rootFolder = useAppStore((s) => s.rootFolder)
  const mastersLibrary = useAppStore((s) => s.mastersLibrary)
  const tempTolerance = useAppStore((s) => s.darkTempTolerance)
  const subAnalysis = useAppStore((s) => s.subAnalysis)
  const lat = useAppStore((s) => s.weatherLat)
  const lon = useAppStore((s) => s.weatherLon)

  const [headers, setHeaders] = useState<Record<string, FitsHeader | null> | null>(null)
  const [settings, setSettings] = useState<ExportSettings>(DEFAULT_EXPORT_SETTINGS)
  const [warnMissingDarkFlat, setWarnMissingDarkFlat] = useState(true)
  const [selection, setSelection] = useState<ExportSelection>(EMPTY_SELECTION)
  const [preflight, setPreflight] = useState<PreflightResult | null>(null)
  const [preflightError, setPreflightError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [result, setResult] = useState<ExportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const lightPaths = useMemo(
    () => project.filters.flatMap((f) => f.sessions.flatMap((s) => s.lights.map((l) => l.path))),
    [project],
  )
  const nonDslrLightPaths = useMemo(
    () => lightPaths.filter((p) => !isDslrFile(p)),
    [lightPaths],
  )

  useEffect(() => {
    invoke<unknown>('get_setting', { key: 'warnMissingDarkFlat' })
      .then((v) => { if (typeof v === 'boolean') setWarnMissingDarkFlat(v) })
      .catch(() => {})
    invoke<unknown>('get_setting', { key: SETTINGS_KEY })
      .then((saved) => setSettings(mergeSettings(saved)))
      .catch(() => {})
    // The saved location only reaches the store once Weather or Planner has
    // been opened; hydrate it here too so the Moon columns work regardless.
    if (useAppStore.getState().weatherLat !== null) return
    invoke<Record<string, unknown>>('get_all_settings')
      .then((saved) => {
        const state = useAppStore.getState()
        if (state.weatherLat === null
          && typeof saved.weatherLat === 'number' && typeof saved.weatherLon === 'number') {
          state.setWeatherLocation(saved.weatherLat, saved.weatherLon)
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    invoke<(FitsHeader | null)[]>('batch_read_fits_headers', { filePaths: nonDslrLightPaths })
      .then((list) => setHeaders(Object.fromEntries(nonDslrLightPaths.map((p, i) => [p, list[i] ?? null]))))
      .catch(() => setHeaders({}))
  }, [nonDslrLightPaths])

  const destination = settings.destinationParent
  const sample = lightPaths[0]
  useEffect(() => {
    if (!destination || !sample) return
    let stale = false
    invoke<PreflightResult>('wbpp_export_preflight', { targetParent: destination, sampleSource: sample })
      .then((r) => { if (!stale) { setPreflight(r); setPreflightError(null) } })
      .catch((e) => { if (!stale) { setPreflight(null); setPreflightError(String(e)) } })
    return () => { stale = true }
  }, [destination, sample])

  const updateSettings = (patch: Partial<ExportSettings>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    invoke('set_setting', { key: SETTINGS_KEY, value: next }).catch(() => {})
  }

  const moon = useMemo(() => resolveMoonContext(project, headers ?? {}, lat, lon), [project, headers, lat, lon])
  const tree = useMemo(
    () => headers === null ? [] : buildExportTree({ project, headers, subAnalysis, moon: moon.ctx, library: mastersLibrary, tempTolerance }),
    [project, headers, subAnalysis, moon, mastersLibrary, tempTolerance],
  )
  const plan = buildPlan(tree, settings, selection)
  const placement = predictPlacement(preflight)
  const { sourceBytes, diskBytes } = estimateSize(plan, placement)
  const warnings = exportWarnings(tree, settings, selection, moon.reason, { warnMissingDarkFlat })
  const folderName = exportFolderName(project.name, new Date())
  const freeBytes = preflight?.freeBytes ?? null
  const tooBig = freeBytes !== null && diskBytes > freeBytes
  const canExport = plan.length > 0 && destination !== null && preflight !== null && !tooBig && !running && rootFolder !== null

  const pickDestination = async () => {
    const picked = await open({ directory: true, defaultPath: destination ?? undefined })
    if (typeof picked === 'string') updateSettings({ destinationParent: picked })
  }

  const runExport = async () => {
    if (!canExport || !destination || !rootFolder) return
    setRunning(true)
    setError(null)
    setProgress(null)
    const unlisten = await listen<ExportProgress>('wbpp-export:progress', (e) => setProgress(e.payload))
    try {
      const r = await invoke<ExportResult>('wbpp_export', {
        parentDir: destination,
        folderName,
        rootFolder,
        entries: plan.map(({ src, relDst }) => ({ src, relDst })),
        settings: { ...settings, project: project.name, selection },
      })
      setResult(r)
    } catch (e) {
      setError(String(e))
    } finally {
      unlisten()
      setRunning(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={() => !running && onClose()}>
      <div className="modal wbpp-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">Export to WBPP — {project.name}</h3>

        {result ? (
          <div className="wbpp-result">
            <p>{result.cancelled ? 'Export cancelled — the folder is incomplete.' : 'Export finished.'}</p>
            <p>
              {result.symlinked} symlinked · {result.hardlinked} hard-linked · {result.copied} copied
              {result.failed.length > 0 && ` · ${result.failed.length} failed`}
            </p>
            <div className="wbpp-path">{result.exportDir}</div>
            {result.failed.length > 0 && (
              <ul className="wbpp-warnings">
                {result.failed.map((f) => <li key={f.src}>{f.src}: {f.error}</li>)}
              </ul>
            )}
            <div className="modal-actions">
              <button className="btn" onClick={() => invoke('show_in_folder', { path: result.exportDir })}>
                <FolderOpen size={13} /> Show in Finder
              </button>
              <button className="btn btn-primary" onClick={onClose}>Close</button>
            </div>
          </div>
        ) : (
          <>
            <div className="wbpp-body">
              {headers === null ? (
                <div className="wbpp-loading">Reading frame headers…</div>
              ) : (
                <ExportTree tree={tree} settings={settings} selection={selection} onSelectionChange={setSelection} />
              )}
              <ExportSettingsPanel
                settings={settings}
                onChange={updateSettings}
                moonReason={moon.reason}
                anyAnalyzed={tree.some((f) => f.analyzed)}
                folderName={folderName}
                onPickDestination={pickDestination}
                preflight={preflight}
                preflightError={preflightError}
                placement={placement}
                counts={countByKind(plan)}
                sourceBytes={sourceBytes}
                diskBytes={diskBytes}
                warnings={tooBig ? ['Not enough free space for a copy', ...warnings] : warnings}
              />
            </div>
            {error && <div className="wbpp-error">{error}</div>}
            <div className="modal-actions">
              {running && progress && (
                <div className="wbpp-progress">
                  <progress max={progress.total} value={progress.current} />
                  <span>{progress.current}/{progress.total} {progress.filename}</span>
                </div>
              )}
              {running ? (
                <button className="btn" onClick={() => invoke('cancel_operation', { operation: 'export' })}>Cancel</button>
              ) : (
                <button className="btn" onClick={onClose}>Close</button>
              )}
              <button className="btn btn-primary" disabled={!canExport} onClick={runExport}>
                {running ? 'Exporting…' : `Export ${plan.length} files`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
