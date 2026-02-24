import { useLocation, Link } from 'react-router-dom'
import { Sun, Moon } from 'lucide-react'
import { useTheme } from '../../context/ThemeContext'

export function TopBar() {
  const location = useLocation()
  const { theme, toggleTheme } = useTheme()

  const breadcrumbs = buildBreadcrumbs(location.pathname)

  return (
    <div className="app-topbar titlebar-drag">
      <div className="breadcrumb titlebar-no-drag">
        {breadcrumbs.map((crumb, i) => (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {i > 0 && <span className="breadcrumb-separator">/</span>}
            {crumb.path ? (
              <Link to={crumb.path}>{crumb.label}</Link>
            ) : (
              <span style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>
                {crumb.label}
              </span>
            )}
          </span>
        ))}
      </div>

      <div style={{ flex: 1 }} />

      <button
        className="btn btn-sm titlebar-no-drag"
        onClick={toggleTheme}
        title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      >
        {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
      </button>
    </div>
  )
}

interface Breadcrumb {
  label: string
  path?: string
}

function buildBreadcrumbs(pathname: string): Breadcrumb[] {
  const crumbs: Breadcrumb[] = []

  if (pathname === '/') {
    crumbs.push({ label: 'Dashboard' })
  } else if (pathname === '/masters') {
    crumbs.push({ label: 'Dashboard', path: '/' })
    crumbs.push({ label: 'Masters Library' })
  } else if (pathname === '/settings') {
    crumbs.push({ label: 'Dashboard', path: '/' })
    crumbs.push({ label: 'Settings' })
  } else if (pathname.startsWith('/project/')) {
    crumbs.push({ label: 'Dashboard', path: '/' })
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
    crumbs.push({ label: 'Dashboard', path: '/' })
    crumbs.push({ label: 'FITS Detail' })
  }

  return crumbs
}
