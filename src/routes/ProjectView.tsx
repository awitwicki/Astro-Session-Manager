import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ChevronRight, ChevronDown, Clock, Image, Check, X, AlertCircle, FolderOpen, Plus, Pencil, Eye, RefreshCw } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { useAppStore } from '../store/appStore'
import { useProjects } from '../hooks/useProjects'
import { formatIntegrationTime, formatFileSize, formatTemperature, formatExposure } from '../lib/formatters'
import { projectPath, fitsGalleryPath } from '../lib/constants'

export function ProjectView() {
  const { projectName } = useParams<{ projectName: string }>()
  const navigate = useNavigate()
  const projects = useAppStore((s) => s.projects)
  const rootFolder = useAppStore((s) => s.rootFolder)
  const removeProject = useAppStore((s) => s.removeProject)
  const { scanProject } = useProjects()
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
      await invoke('rename_path', {
        oldPath: project.path,
        newPath: rootFolder + '/' + newName,
        rootFolder
      })
      setRenameProject(false)
      removeProject(project.path)
      await scanProject(rootFolder + '/' + newName)
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
      await invoke('rename_path', {
        oldPath: filterObj.path,
        newPath: project.path + '/' + newName,
        rootFolder
      })
      setRenameFilter(null)
      await scanProject(project.path)
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
          <button
            className="btn btn-sm"
            style={{ padding: '2px 6px' }}
            onClick={() => scanProject(project.path)}
            title="Rescan project"
          >
            <RefreshCw size={13} />
          </button>
          {project.totalLightFrames > 0 && (() => {
            const firstLight = project.filters.flatMap((f) => f.sessions.flatMap((s) => s.lights))[0]
            return firstLight ? (
              <button
                className="btn btn-sm"
                style={{ padding: '2px 6px' }}
                onClick={() => navigate(fitsGalleryPath(firstLight.path, 'project', project.name))}
                title="View all project frames"
              >
                <Eye size={13} />
              </button>
            ) : null
          })()}
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
              onClick={() => invoke('show_in_folder', { path: filterData.path })}
              title="Show in Finder"
            >
              <FolderOpen size={13} />
            </button>
            {(() => {
              const firstLight = filterData.sessions.flatMap((s) => s.lights)[0]
              return firstLight ? (
                <button
                  className="btn btn-sm"
                  style={{ padding: '2px 6px' }}
                  onClick={() => navigate(fitsGalleryPath(firstLight.path, 'filter', project.name, filterData.name))}
                  title="View all filter frames"
                >
                  <Eye size={13} />
                </button>
              ) : null
            })()}
            <button
              className="btn btn-sm"
              onClick={async () => {
                const maxNight = filterData.sessions.reduce((max, s) => {
                  const m = s.date.match(/^night(\d+)$/i)
                  return m ? Math.max(max, parseInt(m[1])) : max
                }, 0)
                const nextName = `night${Math.max(maxNight, filterData.sessions.length) + 1}`
                await invoke('create_session', {
                  filterPath: filterData.path,
                  sessionName: nextName,
                  rootFolder
                })
                await scanProject(project.path)
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
              onRescan={() => scanProject(project.path)}
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
  projectName,
  filterName,
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
  onRescan: () => Promise<void>
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [lightsExpanded, setLightsExpanded] = useState(false)
  const [flatsExpanded, setFlatsExpanded] = useState(false)
  const [lightHeaders, setLightHeaders] = useState<Record<string, Record<string, unknown>>>({})
  const navigate = useNavigate()
  const cal = session.calibration

  // Lazy-load FITS headers when lights list is expanded
  useEffect(() => {
    if (!lightsExpanded || Object.keys(lightHeaders).length > 0) return
    const paths = session.lights.map((l) => l.path)
    if (paths.length === 0) return
    invoke<Record<string, unknown>[]>('batch_read_fits_headers', { filePaths: paths })
      .then((headers) => {
        const map: Record<string, Record<string, unknown>> = {}
        for (let i = 0; i < paths.length; i++) {
          if (headers[i]) map[paths[i]] = headers[i] as Record<string, unknown>
        }
        setLightHeaders(map)
      })
      .catch(() => {})
  }, [lightsExpanded, lightHeaders, session.lights])

  return (
    <div className="accordion-item">
      <button
        className={`accordion-header ${isOpen ? 'open' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
      >
        <ChevronRight size={16} className="rotatable" />
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

          {session.lights.length > 0 && (
            <span
              style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}
              onClick={(e) => {
                e.stopPropagation()
                navigate(fitsGalleryPath(session.lights[0].path, 'session', projectName, filterName, session.date))
              }}
              title="View session frames"
            >
              <Eye size={13} />
            </span>
          )}
        </span>
      </button>

      {isOpen && (
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

          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button
              className="btn btn-sm"
              onClick={async () => {
                const files = await open({
                  multiple: true,
                  title: 'Import Light Frames',
                  filters: [
                    { name: 'FITS/XISF files', extensions: ['fits', 'fit', 'fts', 'xisf'] },
                    { name: 'All files', extensions: ['*'] }
                  ]
                })
                if (!files || (Array.isArray(files) && files.length === 0)) return
                const fileList = Array.isArray(files) ? files : [files]
                const lightsDir = session.path + '/lights'
                invoke('copy_to_directory', { files: fileList, targetDir: lightsDir })
                  .then(() => onRescan())
                  .catch(() => {})
              }}
            >
              <Plus size={12} />
              Import Lights
            </button>
            <button
              className="btn btn-sm"
              onClick={async () => {
                const files = await open({
                  multiple: true,
                  title: 'Import Flat Frames',
                  filters: [
                    { name: 'FITS/XISF files', extensions: ['fits', 'fit', 'fts', 'xisf'] },
                    { name: 'All files', extensions: ['*'] }
                  ]
                })
                if (!files || (Array.isArray(files) && files.length === 0)) return
                const fileList = Array.isArray(files) ? files : [files]
                const flatsDir = session.path + '/flats'
                invoke('copy_to_directory', { files: fileList, targetDir: flatsDir })
                  .then(() => onRescan())
                  .catch(() => {})
              }}
            >
              <Plus size={12} />
              Import Flats
            </button>
            <button
              className="btn btn-sm"
              style={{ padding: '4px 8px' }}
              onClick={() => invoke('show_in_folder', { path: session.path })}
              title="Show in Finder"
            >
              <FolderOpen size={13} />
            </button>
          </div>

          {/* Collapsible Lights list */}
          {session.lights.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <button
                className="btn btn-sm"
                style={{ padding: '4px 8px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}
                onClick={() => setLightsExpanded(!lightsExpanded)}
              >
                {lightsExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                Lights ({session.lights.length})
              </button>
              {lightsExpanded && (
                <div style={{ marginTop: 4, maxHeight: 300, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 6 }}>
                  <table className="table" style={{ margin: 0, fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th>Filename</th>
                        <th>Temperature</th>
                        <th>Exposure</th>
                        <th>Size</th>
                        <th style={{ width: 36 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {session.lights.map((light) => (
                        <tr key={light.path}>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{light.filename}</td>
                          <td>{lightHeaders[light.path]?.ccdTemp != null ? formatTemperature(lightHeaders[light.path].ccdTemp as number) : '-'}</td>
                          <td>{lightHeaders[light.path]?.exptime != null ? formatExposure(lightHeaders[light.path].exptime as number) : '-'}</td>
                          <td>{formatFileSize(light.sizeBytes)}</td>
                          <td>
                            <button
                              className="btn btn-sm"
                              style={{ padding: '2px 6px' }}
                              onClick={() => navigate(fitsGalleryPath(light.path, 'session', projectName, filterName, session.date))}
                              title="View details"
                            >
                              <Eye size={12} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Collapsible Flats list */}
          {session.flats.length > 0 && (
            <div>
              <button
                className="btn btn-sm"
                style={{ padding: '4px 8px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}
                onClick={() => setFlatsExpanded(!flatsExpanded)}
              >
                {flatsExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                Flats ({session.flats.length})
              </button>
              {flatsExpanded && (
                <div style={{ marginTop: 4, maxHeight: 300, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 6 }}>
                  <table className="table" style={{ margin: 0, fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th>Filename</th>
                        <th>Size</th>
                      </tr>
                    </thead>
                    <tbody>
                      {session.flats.map((flat) => (
                        <tr key={flat.path}>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{flat.filename}</td>
                          <td>{formatFileSize(flat.sizeBytes)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
