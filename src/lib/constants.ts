export const ROUTES = {
  DASHBOARD: '/',
  PROJECT: '/project/:projectName',
  SESSION: '/project/:projectName/:filterName/:date',
  FITS_DETAIL: '/fits',
  MASTERS: '/masters',
  SETTINGS: '/settings'
} as const

export function projectPath(name: string): string {
  return `/project/${encodeURIComponent(name)}`
}

export function sessionPath(project: string, filter: string, date: string): string {
  return `/project/${encodeURIComponent(project)}/${encodeURIComponent(filter)}/${encodeURIComponent(date)}`
}

export function fitsDetailPath(filePath: string): string {
  return `/fits?path=${encodeURIComponent(filePath)}`
}

export type GalleryScope = 'session' | 'filter' | 'project'

export function fitsGalleryPath(
  filePath: string,
  scope: GalleryScope,
  project: string,
  filter?: string,
  date?: string
): string {
  const params = new URLSearchParams()
  params.set('path', filePath)
  params.set('scope', scope)
  params.set('project', project)
  if (filter) params.set('filter', filter)
  if (date) params.set('date', date)
  return `/fits?${params.toString()}`
}
