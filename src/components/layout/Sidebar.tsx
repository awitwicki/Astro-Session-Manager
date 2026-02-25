import { useNavigate, useLocation } from 'react-router-dom'
import {
  FolderOpen,
  Settings,
  Database,
  RefreshCw
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
        </div>

        {projects.length > 0 && (
          <div className="sidebar-section">
            <div className="sidebar-section-title">Projects</div>
            {projects.map((p) => {
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
