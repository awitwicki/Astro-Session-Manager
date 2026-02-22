import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ChevronRight, Clock, Image, Check, X, AlertCircle, FolderOpen, Plus, Pencil } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { useProjects } from '../hooks/useProjects'
import { formatIntegrationTime, formatFileSize } from '../lib/formatters'
import { sessionPath, projectPath } from '../lib/constants'

export function ProjectView() {
  const { projectName } = useParams<{ projectName: string }>()
  const navigate = useNavigate()
  const projects = useAppStore((s) => s.projects)
  const rootFolder = useAppStore((s) => s.rootFolder)
  const { scan } = useProjects()
  const project = projects.find((p) => p.name === decodeURIComponent(projectName || ''))
  const [activeFilter, setActiveFilter] = useState<string | null>(null)
  const [renameProject, setRenameProject] = useState(false)
  const [renameProjectName, setRenameProjectName] = useState('')
  const [renameFilter, setRenameFilter] = useState<string | null>(null)
  const [renameFilterName, setRenameFilterName] = useState('')
  const [renaming, setRenaming] = useState(false)

  if (!project) {
    return (
      <div className="empty-state">
        <h3>Project Not Found</h3>
        <p>Could not find project &quot;{projectName}&quot;</p>
      </div>
    )
  }

  const currentFilter = activeFilter || (project.filters.length > 0 ? project.filters[0].name : null)
  const filterData = project.filters.find((f) => f.name === currentFilter)

  const handleRenameProject = async (): Promise<void> => {
    const newName = renameProjectName.trim()
    if (!newName || !rootFolder || newName === project.name) {
      setRenameProject(false)
      return
    }
    setRenaming(true)
    try {
      await window.electronAPI.file.rename({
        oldPath: project.path,
        newPath: rootFolder + '/' + newName
      })
      setRenameProject(false)
      await scan()
      navigate(projectPath(newName), { replace: true })
    } catch (err) {
      alert('Rename failed: ' + String(err))
    } finally {
      setRenaming(false)
    }
  }

  const handleRenameFilter = async (): Promise<void> => {
    const newName = renameFilterName.trim()
    if (!newName || !renameFilter || newName === renameFilter) {
      setRenameFilter(null)
      return
    }
    const filterObj = project.filters.find((f) => f.name === renameFilter)
    if (!filterObj) return
    setRenaming(true)
    try {
      await window.electronAPI.file.rename({
        oldPath: filterObj.path,
        newPath: project.path + '/' + newName
      })
      setRenameFilter(null)
      await scan()
      setActiveFilter(newName)
    } catch (err) {
      alert('Rename failed: ' + String(err))
    } finally {
      setRenaming(false)
    }
  }

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h1 className="page-title" style={{ textTransform: 'uppercase' }}>
            {project.name}
          </h1>
          <button
            className="btn btn-sm"
            style={{ padding: '2px 6px' }}
            onClick={() => {
              setRenameProjectName(project.name)
              setRenameProject(true)
            }}
            title="Rename project"
          >
            <Pencil size={13} />
          </button>
        </div>
        <div style={{ display: 'flex', gap: 16, fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Clock size={13} />
            {formatIntegrationTime(project.totalIntegrationSeconds)} total
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Image size={13} />
            {project.totalLightFrames} lights
          </span>
          <span>{project.filters.length} filters</span>
          <span>
            {project.filters.reduce((s, f) => s + f.sessions.length, 0)} nights
          </span>
        </div>
      </div>

      {/* Filter tabs */}
      {project.filters.length > 0 && (
        <div className="tabs">
          {project.filters.map((f) => (
            <button
              key={f.name}
              className={`tab ${f.name === currentFilter ? 'active' : ''}`}
              onClick={() => setActiveFilter(f.name)}
            >
              {f.name}
              <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--color-text-muted)' }}>
                {formatIntegrationTime(f.totalIntegrationSeconds)}
              </span>
              <span
                style={{ marginLeft: 4, cursor: 'pointer', opacity: 0.5 }}
                onClick={(e) => {
                  e.stopPropagation()
                  setRenameFilterName(f.name)
                  setRenameFilter(f.name)
                }}
                title="Rename filter"
              >
                <Pencil size={10} />
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Sessions for active filter */}
      {filterData && (
        <div>
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, fontSize: 13, color: 'var(--color-text-muted)', alignItems: 'center' }}>
            <span>{filterData.totalLightFrames} light frames</span>
            <span>{filterData.sessions.length} sessions</span>
            <span>{formatIntegrationTime(filterData.totalIntegrationSeconds)}</span>
            <span>{formatFileSize(filterData.totalSizeBytes)}</span>
            <button
              className="btn btn-sm"
              style={{ padding: '2px 6px' }}
              onClick={() => window.electronAPI.shell.showInFolder(filterData.path)}
              title="Show in Finder"
            >
              <FolderOpen size={13} />
            </button>
            <button
              className="btn btn-sm"
              onClick={async () => {
                const maxNight = filterData.sessions.reduce((max, s) => {
                  const m = s.date.match(/^night(\d+)$/i)
                  return m ? Math.max(max, parseInt(m[1])) : max
                }, 0)
                const nextName = `night${Math.max(maxNight, filterData.sessions.length) + 1}`
                await window.electronAPI.session.create({
                  filterPath: filterData.path,
                  sessionName: nextName
                })
                await scan()
              }}
              title="Create new empty night"
            >
              <Plus size={12} />
              New Night
            </button>
          </div>

          {filterData.sessions.map((session) => (
            <SessionAccordion
              key={session.date}
              session={session}
              projectName={project.name}
              filterName={filterData.name}
              onNavigate={() =>
                navigate(sessionPath(project.name, filterData.name, session.date))
              }
              onRescan={scan}
            />
          ))}
        </div>
      )}

      {/* Rename Project Modal */}
      {renameProject && (
        <div className="modal-overlay" onClick={() => setRenameProject(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Rename Project</h3>
            <div style={{ margin: '16px 0' }}>
              <label style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'block', marginBottom: 4 }}>
                New Project Name
              </label>
              <input
                className="settings-input"
                value={renameProjectName}
                onChange={(e) => setRenameProjectName(e.target.value)}
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleRenameProject()}
              />
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setRenameProject(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleRenameProject}
                disabled={!renameProjectName.trim() || renaming}
              >
                {renaming ? 'Renaming...' : 'Rename'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Filter Modal */}
      {renameFilter && (
        <div className="modal-overlay" onClick={() => setRenameFilter(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Rename Filter</h3>
            <div style={{ margin: '16px 0' }}>
              <label style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'block', marginBottom: 4 }}>
                New Filter Name
              </label>
              <input
                className="settings-input"
                value={renameFilterName}
                onChange={(e) => setRenameFilterName(e.target.value)}
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleRenameFilter()}
              />
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setRenameFilter(null)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleRenameFilter}
                disabled={!renameFilterName.trim() || renaming}
              >
                {renaming ? 'Renaming...' : 'Rename'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SessionAccordion({
  session,
  projectName: _projectName,
  filterName: _filterName,
  onNavigate,
  onRescan
}: {
  session: {
    date: string
    path: string
    lights: { filename: string; path: string; sizeBytes: number }[]
    flats: { filename: string; path: string; sizeBytes: number }[]
    integrationSeconds: number
    totalSizeBytes: number
    calibration: {
      darksMatched: boolean
      darkGroupName?: string
      darkCount?: number
      biasCount?: number
      flatsAvailable: boolean
      flatCount?: number
    }
  }
  projectName: string
  filterName: string
  onNavigate: () => void
  onRescan: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const cal = session.calibration

  return (
    <div className="accordion-item">
      <button
        className={`accordion-header ${open ? 'open' : ''}`}
        onClick={() => setOpen(!open)}
      >
        <ChevronRight size={16} />
        <span style={{ fontWeight: 600 }}>{session.date}</span>
        <span style={{ color: 'var(--color-text-muted)', fontSize: 12, marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
          <span>{session.lights.length} lights</span>
          {session.flats.length > 0 && <span>{session.flats.length} flats</span>}
          <span>{formatIntegrationTime(session.integrationSeconds)}</span>
          <span>{formatFileSize(session.totalSizeBytes)}</span>

          {cal.darksMatched ? (
            <span className="badge badge-success"><Check size={10} /> Darks</span>
          ) : (
            <span className="badge badge-warning"><AlertCircle size={10} /> No darks</span>
          )}

          {cal.flatsAvailable ? (
            <span className="badge badge-success"><Check size={10} /> Flats</span>
          ) : (
            <span className="badge badge-error"><X size={10} /> No flats</span>
          )}
        </span>
      </button>

      {open && (
        <div className="accordion-content">
          <div style={{ display: 'flex', gap: 24, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 4 }}>Light Frames</div>
              <div style={{ fontSize: 20, fontWeight: 600 }}>{session.lights.length}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 4 }}>Flat Frames</div>
              <div style={{ fontSize: 20, fontWeight: 600 }}>{session.flats.length}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 4 }}>Integration</div>
              <div style={{ fontSize: 20, fontWeight: 600 }}>
                {formatIntegrationTime(session.integrationSeconds)}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {cal.darksMatched && cal.darkGroupName && (
              <span className="badge badge-success">
                Dark match from masters library: {cal.darkGroupName}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={onNavigate}>
              View Frames
              <ChevronRight size={14} />
            </button>
            <button
              className="btn btn-sm"
              onClick={async () => {
                const files = await window.electronAPI.dialog.openFiles({
                  title: 'Import Light Frames',
                  filters: [
                    { name: 'FITS/XISF files', extensions: ['fits', 'fit', 'fts', 'xisf'] },
                    { name: 'All files', extensions: ['*'] }
                  ]
                })
                if (files.length === 0) return
                const lightsDir = session.path + '/lights'
                await window.electronAPI.file.copyToDirectory({ files, targetDir: lightsDir })
                await onRescan()
              }}
            >
              <Plus size={12} />
              Import Lights
            </button>
            <button
              className="btn btn-sm"
              onClick={async () => {
                const files = await window.electronAPI.dialog.openFiles({
                  title: 'Import Flat Frames',
                  filters: [
                    { name: 'FITS/XISF files', extensions: ['fits', 'fit', 'fts', 'xisf'] },
                    { name: 'All files', extensions: ['*'] }
                  ]
                })
                if (files.length === 0) return
                const flatsDir = session.path + '/flats'
                await window.electronAPI.file.copyToDirectory({ files, targetDir: flatsDir })
                await onRescan()
              }}
            >
              <Plus size={12} />
              Import Flats
            </button>
            <button
              className="btn btn-sm"
              style={{ padding: '4px 8px' }}
              onClick={() => window.electronAPI.shell.showInFolder(session.path)}
              title="Show in Finder"
            >
              <FolderOpen size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
