import type { Project } from '../types'

export type ProjectSortColumn = 'name' | 'integration' | 'size' | 'lastDate' | 'lights' | 'opened'
export type SortDirection = 'asc' | 'desc'
export interface DashboardSort {
  column: ProjectSortColumn
  direction: SortDirection
}

export const DEFAULT_DASHBOARD_SORT: DashboardSort = { column: 'name', direction: 'asc' }

/** Project name → epoch ms of the last time its page was opened. */
export type ProjectOpenedMap = Record<string, number>

const COLUMNS: readonly ProjectSortColumn[] = ['name', 'integration', 'size', 'lastDate', 'lights', 'opened']

export function isDashboardSort(val: unknown): val is DashboardSort {
  if (typeof val !== 'object' || val === null) return false
  const v = val as Record<string, unknown>
  return COLUMNS.includes(v.column as ProjectSortColumn) && (v.direction === 'asc' || v.direction === 'desc')
}

export function parseProjectOpenedMap(val: unknown): ProjectOpenedMap {
  const out: ProjectOpenedMap = {}
  if (typeof val !== 'object' || val === null || Array.isArray(val)) return out
  for (const [name, ts] of Object.entries(val)) {
    if (typeof ts === 'number' && Number.isFinite(ts)) out[name] = ts
  }
  return out
}

/** Clicking a column toggles direction; switching columns starts at the
 *  direction that puts the "interesting" end first (newest for recency). */
export function nextDashboardSort(current: DashboardSort, column: ProjectSortColumn): DashboardSort {
  if (current.column === column) {
    return { column, direction: current.direction === 'asc' ? 'desc' : 'asc' }
  }
  return { column, direction: column === 'opened' ? 'desc' : 'asc' }
}

export function sortProjects(projects: Project[], sort: DashboardSort, opened: ProjectOpenedMap): Project[] {
  const key = (p: Project): string | number => {
    switch (sort.column) {
      case 'integration': return p.totalIntegrationSeconds
      case 'size': return p.totalSizeBytes
      case 'lastDate': return p.lastCaptureDate || ''
      case 'lights': return p.totalLightFrames
      case 'opened': return opened[p.name] ?? 0
      default: return p.name
    }
  }
  return [...projects].sort((a, b) => {
    const va = key(a)
    const vb = key(b)
    // Never-opened projects always sink to the bottom, by name.
    if (sort.column === 'opened' && (va === 0 || vb === 0)) {
      if (va !== vb) return va === 0 ? 1 : -1
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    }
    const cmp = va < vb ? -1 : va > vb ? 1 : 0
    return sort.direction === 'asc' ? cmp : -cmp
  })
}
