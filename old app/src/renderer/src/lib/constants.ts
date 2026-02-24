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
