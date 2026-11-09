import { invoke } from '@tauri-apps/api/core'
import { useAppStore, type ScanResultRaw } from '../store/appStore'

/** Writes one project's fresh scan into the on-disk scan cache, so the next
 *  cache load (app start, Dashboard init) does not bring back its old state. */
async function persistProjectScan(scan: ScanResultRaw): Promise<void> {
  const rootFolder = useAppStore.getState().rootFolder
  const project = scan.projects[0]
  if (!rootFolder || !project) return
  const cached = await invoke<{ scanResult?: ScanResultRaw } | null>('load_cache', { rootFolder })
  const existing = cached?.scanResult ?? { rootPath: rootFolder, projects: [], projectHeaders: {}, scanDurationMs: 0 }
  const projects = [...existing.projects]
  const idx = projects.findIndex((p) => p.path === project.path)
  if (idx >= 0) projects[idx] = project
  else projects.push(project)
  await invoke('save_cache', {
    rootFolder,
    data: {
      scanResult: {
        ...existing,
        projects,
        projectHeaders: { ...existing.projectHeaders, ...scan.projectHeaders },
      },
    },
  })
}

let chain: Promise<unknown> = Promise.resolve()

/** Rescans one project, merges it into the store and the scan cache.
 *  Calls run one at a time in call order, so an older scan never lands on
 *  top of a newer one and cache writes never interleave. Rejects when the
 *  scan fails; a failed cache write is ignored (the cache is best-effort). */
export function rescanProject(projectPath: string): Promise<void> {
  const run = chain.then(async () => {
    const scan = await invoke<ScanResultRaw>('scan_single_project', { projectPath })
    useAppStore.getState().mergeProjectScan(scan)
    await persistProjectScan(scan).catch(() => {})
  })
  chain = run.catch(() => {})
  return run
}
