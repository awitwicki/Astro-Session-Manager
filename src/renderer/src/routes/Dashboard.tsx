import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { FolderOpen, Clock, Image, Camera, Plus, LayoutGrid, List } from 'lucide-react'
import { useProjects } from '../hooks/useProjects'
import { formatIntegrationTime, formatFileSize } from '../lib/formatters'
import { projectPath } from '../lib/constants'

type ProjectSortColumn = 'name' | 'integration' | 'size' | 'lastDate' | 'lights'
type SortDirection = 'asc' | 'desc'

export function Dashboard() {
  const { projects, isScanning, scanError, rootFolder, selectFolder, scan, init } = useProjects()
  const navigate = useNavigate()

  const [showNewProject, setShowNewProject] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectFilters, setNewProjectFilters] = useState('')
  const [creating, setCreating] = useState(false)
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid')
  const [sortColumn, setSortColumn] = useState<ProjectSortColumn>('name')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')

  useEffect(() => {
    init()
  }, [init])

  const handleCreateProject = async (): Promise<void> => {
    if (!newProjectName.trim()) return
    setCreating(true)
    try {
      const filters = newProjectFilters
        .split(',')
        .map((f) => f.trim())
        .filter((f) => f.length > 0)
      await window.electronAPI.project.create({
        projectName: newProjectName.trim(),
        filters: filters.length > 0 ? filters : ['default']
      })
      setShowNewProject(false)
      setNewProjectName('')
      setNewProjectFilters('')
      await scan()
    } finally {
      setCreating(false)
    }
  }

  const handleSort = (col: ProjectSortColumn): void => {
    if (sortColumn === col) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortColumn(col)
      setSortDirection('asc')
    }
  }

  const sortIndicator = (col: ProjectSortColumn): string => {
    if (sortColumn !== col) return ''
    return sortDirection === 'asc' ? ' \u2191' : ' \u2193'
  }

  const sortedProjects = useMemo(() => {
    const sorted = [...projects]
    sorted.sort((a, b) => {
      let va: string | number
      let vb: string | number
      switch (sortColumn) {
        case 'name':
          va = a.name
          vb = b.name
          break
        case 'integration':
          va = a.totalIntegrationSeconds
          vb = b.totalIntegrationSeconds
          break
        case 'size':
          va = a.totalSizeBytes
          vb = b.totalSizeBytes
          break
        case 'lastDate':
          va = a.lastCaptureDate || ''
          vb = b.lastCaptureDate || ''
          break
        case 'lights':
          va = a.totalLightFrames
          vb = b.totalLightFrames
          break
        default:
          va = a.name
          vb = b.name
      }
      const cmp = va < vb ? -1 : va > vb ? 1 : 0
      return sortDirection === 'asc' ? cmp : -cmp
    })
    return sorted
  }, [projects, sortColumn, sortDirection])

  if (!rootFolder) {
    return (
      <div className="empty-state">
        <FolderOpen size={64} />
        <h3>Welcome to Astro Session Manager</h3>
        <p>
          Select your astrophotography root folder to get started. The app will scan your
          directory structure for projects, sessions, and masters.
        </p>
        <button
          className="btn btn-primary"
          style={{ marginTop: 16 }}
          onClick={selectFolder}
        >
          <FolderOpen size={14} />
          Select Root Folder
        </button>
      </div>
    )
  }

  if (isScanning && projects.length === 0) {
    return (
      <div className="loading-spinner" style={{ flexDirection: 'column', gap: 16 }}>
        <div className="spinner" />
        <span style={{ color: 'var(--color-text-muted)' }}>Scanning directory...</span>
      </div>
    )
  }

  if (scanError) {
    return (
      <div className="empty-state">
        <h3>Scan Error</h3>
        <p style={{ color: 'var(--color-error)' }}>{scanError}</p>
        <button className="btn" style={{ marginTop: 16 }} onClick={selectFolder}>
          Change Folder
        </button>
      </div>
    )
  }

  const totalIntegration = projects.reduce((s, p) => s + p.totalIntegrationSeconds, 0)
  const totalLights = projects.reduce((s, p) => s + p.totalLightFrames, 0)
  const totalSessions = projects.reduce(
    (s, p) => s + p.filters.reduce((sf, f) => sf + f.sessions.length, 0),
    0
  )
  const totalSize = projects.reduce((s, p) => s + p.totalSizeBytes, 0)

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title">Dashboard</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 2 }}>
            <button
              className={`btn btn-sm ${viewMode === 'grid' ? 'btn-primary' : ''}`}
              onClick={() => setViewMode('grid')}
              title="Grid view"
            >
              <LayoutGrid size={14} />
            </button>
            <button
              className={`btn btn-sm ${viewMode === 'table' ? 'btn-primary' : ''}`}
              onClick={() => setViewMode('table')}
              title="Table view"
            >
              <List size={14} />
            </button>
          </div>
          <button className="btn btn-primary" onClick={() => setShowNewProject(true)}>
            <Plus size={14} />
            New Project
          </button>
        </div>
      </div>

      <div className="stat-row" style={{ marginBottom: 24 }}>
        <div className="stat-card">
          <div className="stat-value">{projects.length}</div>
          <div className="stat-label">Projects</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{formatIntegrationTime(totalIntegration)}</div>
          <div className="stat-label">Total Integration</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{totalLights.toLocaleString()}</div>
          <div className="stat-label">Light Frames</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{totalSessions}</div>
          <div className="stat-label">Sessions</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{formatFileSize(totalSize)}</div>
          <div className="stat-label">Total Size</div>
        </div>
      </div>

      {projects.length === 0 ? (
        <div className="empty-state">
          <Camera size={64} />
          <h3>No Projects Found</h3>
          <p>
            No imaging projects detected in the selected folder. Make sure your directory
            follows the expected structure: project/filter/date/lights/
          </p>
        </div>
      ) : viewMode === 'table' ? (
        <table className="table">
          <thead>
            <tr>
              <th style={{ cursor: 'pointer' }} onClick={() => handleSort('name')}>
                Name{sortIndicator('name')}
              </th>
              <th style={{ cursor: 'pointer' }} onClick={() => handleSort('integration')}>
                Integration{sortIndicator('integration')}
              </th>
              <th style={{ cursor: 'pointer' }} onClick={() => handleSort('size')}>
                Size{sortIndicator('size')}
              </th>
              <th style={{ cursor: 'pointer' }} onClick={() => handleSort('lastDate')}>
                Last Sub{sortIndicator('lastDate')}
              </th>
              <th>Filters</th>
              <th style={{ cursor: 'pointer' }} onClick={() => handleSort('lights')}>
                Lights{sortIndicator('lights')}
              </th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sortedProjects.map((project) => (
              <tr
                key={project.name}
                style={{ cursor: 'pointer' }}
                onClick={() => navigate(projectPath(project.name))}
              >
                <td style={{ fontWeight: 600, textTransform: 'uppercase' }}>{project.name}</td>
                <td>{formatIntegrationTime(project.totalIntegrationSeconds)}</td>
                <td>{formatFileSize(project.totalSizeBytes)}</td>
                <td>{project.lastCaptureDate || '-'}</td>
                <td>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {project.filters.map((f) => (
                      <span key={f.name} className="badge badge-info" style={{ fontSize: 10 }}>
                        {f.name}
                      </span>
                    ))}
                  </div>
                </td>
                <td>{project.totalLightFrames}</td>
                <td>
                  <button
                    className="btn btn-sm"
                    style={{ padding: '2px 6px' }}
                    onClick={(e) => {
                      e.stopPropagation()
                      window.electronAPI.shell.showInFolder(project.path)
                    }}
                    title="Show in Finder"
                  >
                    <FolderOpen size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="grid-cards">
          {sortedProjects.map((project) => (
            <div
              key={project.name}
              className="card card-clickable"
              onClick={() => navigate(projectPath(project.name))}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
                <h3 style={{ fontSize: 18, fontWeight: 600, textTransform: 'uppercase' }}>
                  {project.name}
                </h3>
                {project.lastCaptureDate && (
                  <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                    {project.lastCaptureDate}
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
                {project.filters.map((f) => (
                  <span key={f.name} className="badge badge-info">
                    {f.name}
                  </span>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 16, fontSize: 13, color: 'var(--color-text-secondary)', alignItems: 'center' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Clock size={13} />
                  {formatIntegrationTime(project.totalIntegrationSeconds)}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Image size={13} />
                  {project.totalLightFrames} lights
                </span>
                <span>
                  {project.filters.reduce((s, f) => s + f.sessions.length, 0)} nights
                </span>
                <span>{formatFileSize(project.totalSizeBytes)}</span>
                <button
                  className="btn btn-sm"
                  style={{ marginLeft: 'auto', padding: '2px 6px' }}
                  onClick={(e) => {
                    e.stopPropagation()
                    window.electronAPI.shell.showInFolder(project.path)
                  }}
                  title="Show in Finder"
                >
                  <FolderOpen size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* New Project Modal */}
      {showNewProject && (
        <div className="modal-overlay" onClick={() => setShowNewProject(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Create New Project</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, margin: '16px 0' }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'block', marginBottom: 4 }}>
                  Project Name
                </label>
                <input
                  className="settings-input"
                  placeholder="e.g. ic1805"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateProject()}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'block', marginBottom: 4 }}>
                  Filters (comma-separated)
                </label>
                <input
                  className="settings-input"
                  placeholder="e.g. ha, oiii, sii"
                  value={newProjectFilters}
                  onChange={(e) => setNewProjectFilters(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateProject()}
                />
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setShowNewProject(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleCreateProject}
                disabled={!newProjectName.trim() || creating}
              >
                <Plus size={14} />
                {creating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
