import { useState, useEffect } from 'react'
import type { Ref } from 'react'
import { useLocation, Link } from 'react-router-dom'
import { ArrowUpCircle, MapPin } from 'lucide-react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useAppStore } from '../../store/appStore'
import { projectPath } from '../../lib/constants'
import type { PlannerTarget } from '../../types/planner'

declare const __APP_VERSION__: string

function isNewerVersion(remote: string, current: string): boolean {
  const r = remote.split('.').map(Number)
  const c = current.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((r[i] || 0) > (c[i] || 0)) return true
    if ((r[i] || 0) < (c[i] || 0)) return false
  }
  return false
}

const GITHUB_REPO = 'awitwicki/Astro-Session-Manager'
const RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases`

/** `actionsRef` receives the container pages portal their header controls into (see `TopBarActions`). */
export function TopBar({ actionsRef }: { actionsRef: Ref<HTMLDivElement> }) {
  const location = useLocation()
  const plannerTargets = useAppStore((s) => s.plannerTargets)
  const [latestVersion, setLatestVersion] = useState<string | null>(null)
  const weatherLat = useAppStore((s) => s.weatherLat)
  const weatherLon = useAppStore((s) => s.weatherLon)
  const weatherShowMap = useAppStore((s) => s.weatherShowMap)
  const setWeatherShowMap = useAppStore((s) => s.setWeatherShowMap)
  const isAstroWeather = location.pathname === '/astroweather'

  useEffect(() => {
    fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.tag_name) return
        const remote = data.tag_name.replace(/^v/, '')
        if (isNewerVersion(remote, __APP_VERSION__)) {
          setLatestVersion(remote)
        }
      })
      .catch(() => {})
  }, [])

  const breadcrumbs = buildBreadcrumbs(location.pathname, location.search, plannerTargets)

  return (
    <div className="app-topbar titlebar-drag">
      <div className="breadcrumb titlebar-no-drag">
        {breadcrumbs.map((crumb, i) => (
          <span key={i} className="breadcrumb-item">
            {i > 0 && <span className="breadcrumb-separator">/</span>}
            {crumb.path ? (
              <Link to={crumb.path}>{crumb.label}</Link>
            ) : (
              <span className="breadcrumb-current" title={crumb.label}>{crumb.label}</span>
            )}
          </span>
        ))}
      </div>

      <div ref={actionsRef} className="topbar-actions titlebar-no-drag" />

      {latestVersion && (
        <button
          className="btn btn-sm titlebar-no-drag"
          onClick={() => openUrl(RELEASES_URL)}
          title={`Update available: v${latestVersion}`}
          style={{ color: 'var(--color-warning)', gap: 4 }}
        >
          <ArrowUpCircle size={14} />
          Update v{latestVersion}
        </button>
      )}

      {isAstroWeather && (
        <button
          className="btn btn-sm titlebar-no-drag"
          onClick={() => setWeatherShowMap(!weatherShowMap)}
          title="Set location"
          style={{ gap: 4 }}
        >
          <MapPin size={14} />
          {weatherLat !== null ? `${weatherLat}, ${weatherLon}` : 'Set Location'}
        </button>
      )}

    </div>
  )
}

interface Breadcrumb {
  label: string
  path?: string
}

function buildBreadcrumbs(pathname: string, search: string, plannerTargets: PlannerTarget[]): Breadcrumb[] {
  const crumbs: Breadcrumb[] = []
  const home = { label: 'Dashboard', path: '/' }

  if (pathname === '/') {
    crumbs.push({ label: 'Dashboard' })
  } else if (pathname === '/masters') {
    crumbs.push(home, { label: 'Masters Library' })
  } else if (pathname === '/settings') {
    crumbs.push(home, { label: 'Settings' })
  } else if (pathname === '/astroweather') {
    crumbs.push({ label: 'Astro Weather' })
  } else if (pathname === '/skymap') {
    crumbs.push({ label: 'Sky Map' })
  } else if (pathname === '/calculators') {
    crumbs.push({ label: 'Calculators' })
  } else if (pathname === '/converter') {
    crumbs.push({ label: 'DSLR to FITS Converter (experimental)' })
  } else if (pathname === '/planner') {
    crumbs.push({ label: 'Planner' })
  } else if (pathname.startsWith('/planner/')) {
    const id = decodeURIComponent(pathname.slice('/planner/'.length))
    crumbs.push({ label: 'Planner', path: '/planner' })
    crumbs.push({ label: plannerTargets.find((t) => t.id === id)?.name ?? id })
  } else if (pathname.startsWith('/project/')) {
    crumbs.push(home)
    const parts = pathname.split('/').filter(Boolean)
    // /project/:name
    if (parts.length >= 2) {
      const projectName = decodeURIComponent(parts[1])
      if (parts.length === 2) {
        crumbs.push({ label: projectName })
      } else {
        crumbs.push({
          label: projectName,
          path: `/project/${parts[1]}`
        })
      }
    }
    // /project/:name/:filter/:date
    if (parts.length >= 4) {
      const filterName = decodeURIComponent(parts[2])
      const date = decodeURIComponent(parts[3])
      crumbs.push({ label: `${filterName} / ${date}` })
    }
  } else if (pathname.startsWith('/fits')) {
    const params = new URLSearchParams(search)
    const project = params.get('project')
    const file = (params.get('path') ?? '').split(/[\\/]/).pop()
    crumbs.push(home)
    if (project) crumbs.push({ label: project, path: projectPath(project) })
    crumbs.push({ label: file || 'FITS Detail' })
  }

  return crumbs
}
