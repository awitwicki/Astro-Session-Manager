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
  X
} from 'lucide-react'
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
  const { selectFolder, scan } = useProjects()
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
                {p.name}
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

        <button className="sidebar-item" onClick={selectFolder}>
          <FolderOpen size={16} />
          {rootFolder ? 'Change Folder' : 'Select Folder'}
        </button>

        <button
          className={`sidebar-item ${location.pathname === '/settings' ? 'active' : ''}`}
          onClick={() => navigate('/settings')}
        >
          <Settings size={16} />
          Settings
        </button>

        <div className="sidebar-version">Astro Session Manager v{version}</div>
      </div>
    </div>
  )
}
