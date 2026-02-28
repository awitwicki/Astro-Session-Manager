export const ROUTES = {
  DASHBOARD: '/',
  PROJECT: '/project/:projectName',
  FITS_DETAIL: '/fits',
  MASTERS: '/masters',
  SKYMAP: '/skymap',
  SETTINGS: '/settings'
} as const

export function projectPath(name: string): string {
  return `/project/${encodeURIComponent(name)}`
}

export function fitsDetailPath(filePath: string): string {
  return `/fits?path=${encodeURIComponent(filePath)}`
}

export type GalleryScope = 'session' | 'filter' | 'project'
export type GalleryViewType = 'lights' | 'flats' | 'both'

export function fitsGalleryPath(
  filePath: string,
  scope: GalleryScope,
  project: string,
  filter?: string,
  date?: string,
  viewType?: GalleryViewType
): string {
  const params = new URLSearchParams()
  params.set('path', filePath)
  params.set('scope', scope)
  params.set('project', project)
  if (filter) params.set('filter', filter)
  if (date) params.set('date', date)
  if (viewType && viewType !== 'lights') params.set('viewType', viewType)
  return `/fits?${params.toString()}`
}
