import { useState, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  FolderOpen,
  Settings,
  Database,
  RefreshCw,
  Map,
  CloudSun,
  Search,
  X,
  FileOutput
} from 'lucide-react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useAppStore } from '../../store/appStore'
import { useProjects } from '../../hooks/useProjects'
import { projectPath } from '../../lib/constants'
import { version } from '../../../package.json'

export function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const projects = useAppStore((s) => s.projects)
  const rootFolder = useAppStore((s) => s.rootFolder)
  const isScanning = useAppStore((s) => s.isScanning)
  const { scan } = useProjects()
  const [searchQuery, setSearchQuery] = useState('')

  const filteredProjects = useMemo(() => {
    if (!searchQuery.trim()) return projects
    const q = searchQuery.toLowerCase()
    return projects.filter((p) => p.name.toLowerCase().includes(q))
  }, [projects, searchQuery])

  return (
    <div className="app-sidebar">
      <nav className="sidebar-nav">
        <div className="sidebar-section">
          <button
            className={`sidebar-item ${location.pathname === '/' ? 'active' : ''}`}
            onClick={() => navigate('/')}
          >
            <FolderOpen size={16} />
            Dashboard
          </button>

          <button
            className={`sidebar-item ${location.pathname === '/masters' ? 'active' : ''}`}
            onClick={() => navigate('/masters')}
          >
            <Database size={16} />
            Masters Library
          </button>

          <button
            className={`sidebar-item ${location.pathname === '/skymap' ? 'active' : ''}`}
            onClick={() => navigate('/skymap')}
          >
            <Map size={16} />
            Sky Map
          </button>

          <button
            className={`sidebar-item ${location.pathname === '/weather' ? 'active' : ''}`}
            onClick={() => navigate('/weather')}
          >
            <CloudSun size={16} />
            Weather
          </button>

        </div>

        {projects.length > 0 && (
          <div className="sidebar-section">
            <div className="sidebar-section-title">Projects</div>
            <div className="sidebar-search">
              <Search size={14} className="sidebar-search-icon" />
              <input
                type="text"
                className="sidebar-search-input"
                placeholder="Search projects..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  className="sidebar-search-clear"
                  onClick={() => setSearchQuery('')}
                >
                  <X size={12} />
                </button>
              )}
            </div>
            {filteredProjects.map((p) => {
              const prefix = `/project/${encodeURIComponent(p.name)}`
              const isActive = location.pathname === prefix || location.pathname.startsWith(`${prefix}/`)
              return (
              <button
                key={p.name}
                className={`sidebar-item ${isActive ? 'active' : ''}`}
                onClick={() => navigate(projectPath(p.name))}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
              </button>
              )
            })}
          </div>
        )}
      </nav>

      <div className="sidebar-footer">
        {rootFolder && (
          <button
            className="sidebar-item"
            onClick={scan}
            disabled={isScanning}
          >
            <RefreshCw size={16} className={isScanning ? 'spinning' : ''} />
            {isScanning ? 'Synchronizing...' : 'Synchronize'}
          </button>
        )}

        <button
          className={`sidebar-item ${location.pathname === '/converter' ? 'active' : ''}`}
          onClick={() => navigate('/converter')}
        >
          <FileOutput size={16} />
          Converter
        </button>

        <button
          className={`sidebar-item ${location.pathname === '/settings' ? 'active' : ''}`}
          onClick={() => navigate('/settings')}
        >
          <Settings size={16} />
          Settings
        </button>

        <div className="sidebar-version" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>Astro Session Manager v{version}</span>
          <button
            onClick={() => openUrl('https://github.com/awitwicki/Astro-Session-Manager')}
            title="Open GitHub repository"
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', display: 'flex' }}
          >
            <svg width="14" height="14" viewBox="0 0 98 96" fill="currentColor">
              <path d="M48.854 0C21.839 0 0 22 0 49.217c0 21.756 13.993 40.172 33.405 46.69 2.427.49 3.316-1.059 3.316-2.362 0-1.141-.08-5.052-.08-9.127-13.59 2.934-16.42-5.867-16.42-5.867-2.184-5.704-5.42-7.17-5.42-7.17-4.448-3.015.324-3.015.324-3.015 4.934.326 7.523 5.052 7.523 5.052 4.367 7.496 11.404 5.378 14.235 4.074.404-3.178 1.699-5.378 3.074-6.6C29.304 70.025 17.9 65.787 17.9 46.853c0-5.378 1.94-9.778 5.014-13.2-.485-1.222-2.184-6.275.486-13.038 0 0 4.125-1.304 13.426 5.052a46.97 46.97 0 0 1 12.214-1.63c4.125 0 8.33.571 12.213 1.63 9.302-6.356 13.427-5.052 13.427-5.052 2.67 6.763.97 11.816.485 13.038 3.155 3.422 5.015 7.822 5.015 13.2 0 18.905-11.404 23.06-22.324 24.283 1.78 1.548 3.316 4.481 3.316 9.126 0 6.6-.08 11.897-.08 13.526 0 1.304.89 2.853 3.316 2.364 19.412-6.52 33.405-24.935 33.405-46.691C97.707 22 75.788 0 48.854 0z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
