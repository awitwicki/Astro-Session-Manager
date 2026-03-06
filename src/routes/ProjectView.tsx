import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ChevronRight, ChevronDown, Clock, Image, Check, X, AlertCircle, FolderOpen, Plus, Pencil, Eye, RefreshCw, FileText, BarChart3, EyeOff, Star } from 'lucide-react'
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
  const subAnalysis = useAppStore((s) => s.subAnalysis)
  const setSubAnalysis = useAppStore((s) => s.setSubAnalysis)
  const isAnalyzing = useAppStore((s) => s.isAnalyzing)
  const setAnalyzing = useAppStore((s) => s.setAnalyzing)
  const { scanProject } = useProjects()
  const project = projects.find((p) => p.name === decodeURIComponent(projectName || ''))
  const [activeFilter, setActiveFilter] = useState<string | null>(null)
  const [renameProject, setRenameProject] = useState(false)
  const [renameProjectName, setRenameProjectName] = useState('')
  const [renameFilter, setRenameFilter] = useState<string | null>(null)
  const [renameFilterName, setRenameFilterName] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [notesPath, setNotesPath] = useState<string | null>(null)
  const [notesTitle, setNotesTitle] = useState('')
  const [notesContent, setNotesContent] = useState('')
  const [notesSaving, setNotesSaving] = useState(false)
  const [excludeConfirm, setExcludeConfirm] = useState<{ name: string; type: 'project' | 'filter' | 'night' } | null>(null)
  const [patternsText, setPatternsText] = useState('')

  useEffect(() => {
    invoke<unknown>('get_setting', { key: 'excludePatterns' }).then((val) => {
      if (typeof val === 'string') setPatternsText(val)
    })
  }, [])

  const doExclude = async (name: string, type: 'project' | 'filter' | 'night') => {
    const updated = patternsText ? patternsText + '\n' + name : name
    setPatternsText(updated)
    await invoke('set_setting', { key: 'excludePatterns', value: updated })
    useAppStore.getState().applyExcludePatterns(updated)
    setExcludeConfirm(null)
    if (type === 'project') {
      navigate('/')
    }
  }

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

  const openNotes = async (folderPath: string, title: string) => {
    setNotesTitle(title)
    setNotesPath(folderPath)
    try {
      const content = await invoke<string>('read_note', { folderPath })
      setNotesContent(content)
    } catch {
      setNotesContent('')
    }
  }

  const saveNotes = async () => {
    if (!notesPath) return
    setNotesSaving(true)
    try {
      await invoke('write_note', { folderPath: notesPath, content: notesContent })
      setNotesPath(null)
      await scanProject(project.path)
    } catch (err) {
      alert('Failed to save notes: ' + String(err))
    } finally {
      setNotesSaving(false)
    }
  }

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
          <button
            className="btn btn-sm"
            style={{ padding: '2px 6px' }}
            onClick={() => setExcludeConfirm({ name: project.name, type: 'project' })}
            title="Exclude project"
          >
            <EyeOff size={13} />
          </button>
          <button
            className="btn btn-sm"
            style={{ padding: '2px 6px', opacity: project.hasNotes ? 1 : 0.5 }}
            onClick={() => openNotes(project.path, `Project: ${project.name}`)}
            title={project.hasNotes ? 'View notes' : 'Create notes'}
          >
            <FileText size={13} />
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
            <button
              className="btn btn-sm"
              style={{ padding: '2px 6px', opacity: filterData.hasNotes ? 1 : 0.5 }}
              onClick={() => openNotes(filterData.path, `Filter: ${filterData.name}`)}
              title={filterData.hasNotes ? 'View notes' : 'Create notes'}
            >
              <FileText size={13} />
            </button>
            <button
              className="btn btn-sm"
              style={{ padding: '2px 6px' }}
              onClick={() => setExcludeConfirm({ name: filterData.name, type: 'filter' })}
              title="Exclude filter"
            >
              <EyeOff size={13} />
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
                  const m = s.date.match(/^night\s*(\d+)$/i)
                  return m ? Math.max(max, parseInt(m[1])) : max
                }, 0)
                const nextName = `Night ${maxNight + 1}`
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
            <button
              className="btn btn-sm"
              disabled={isAnalyzing}
              onClick={async () => {
                const allLightPaths = filterData.sessions.flatMap((s) => s.lights.map((l) => l.path))
                const unanalyzed = allLightPaths.filter((p) => !subAnalysis[p])
                if (unanalyzed.length === 0) return
                setAnalyzing(true)
                try {
                  const results = await invoke<Record<string, { medianFwhm: number; medianEccentricity: number; starsDetected: number }>>('analyze_subs', { filePaths: unanalyzed })
                  setSubAnalysis(results)
                  if (rootFolder) {
                    const merged = { ...subAnalysis, ...results }
                    await invoke('save_cache', { rootFolder, data: { subAnalysis: merged } }).catch(() => {})
                  }
                } catch (err) {
                  console.error('Analysis failed:', err)
                } finally {
                  setAnalyzing(false)
                }
              }}
              title="Analyze light frames (FWHM & Eccentricity)"
            >
              <BarChart3 size={12} />
              {isAnalyzing ? 'Analyzing...' : 'Analyze Subs'}
            </button>
          </div>

          {filterData.sessions.map((session) => (
            <SessionAccordion
              key={session.date}
              session={session}
              projectName={project.name}
              filterName={filterData.name}
              subAnalysis={subAnalysis}
              onRescan={() => scanProject(project.path)}
              onOpenNotes={openNotes}
              onExclude={(name) => setExcludeConfirm({ name, type: 'night' })}
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

      {/* Notes Modal */}
      {notesPath && (
        <div className="modal-overlay" onClick={() => setNotesPath(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 560 }}>
            <h3 className="modal-title">{notesTitle}</h3>
            <div style={{ margin: '16px 0' }}>
              <textarea
                className="settings-input"
                value={notesContent}
                onChange={(e) => setNotesContent(e.target.value)}
                autoFocus
                rows={12}
                style={{ resize: 'vertical', fontFamily: 'var(--font-mono)', fontSize: 13 }}
                placeholder="Write your notes here..."
              />
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setNotesPath(null)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={saveNotes}
                disabled={notesSaving}
              >
                {notesSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Exclude Confirmation Modal */}
      {excludeConfirm && (
        <div className="modal-overlay" onClick={() => setExcludeConfirm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Exclude {excludeConfirm.type}</h3>
            <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '12px 0' }}>
              Are you sure you want to exclude <strong>{excludeConfirm.name}</strong>?
              It will be hidden from scanning and viewing. You can restore it later from the Exclude Patterns on the Dashboard.
            </p>
            <div className="modal-actions">
              <button className="btn" onClick={() => setExcludeConfirm(null)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={() => doExclude(excludeConfirm.name, excludeConfirm.type)}
              >
                Proceed
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
  subAnalysis,
  onRescan,
  onOpenNotes,
  onExclude
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
    hasNotes: boolean
    subsDateRange: string | null
  }
  projectName: string
  filterName: string
  subAnalysis: Record<string, { medianFwhm: number; medianEccentricity: number; starsDetected: number }>
  onRescan: () => Promise<void>
  onOpenNotes: (folderPath: string, title: string) => void
  onExclude: (name: string) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [lightsExpanded, setLightsExpanded] = useState(false)
  const [flatsExpanded, setFlatsExpanded] = useState(false)
  const [lightHeaders, setLightHeaders] = useState<Record<string, Record<string, unknown>>>({})
  const navigate = useNavigate()
  const cal = session.calibration

  // Compute session-level FWHM and ECC from analyzed subs
  const analyzedLights = session.lights
    .map((l) => subAnalysis[l.path])
    .filter((a): a is { medianFwhm: number; medianEccentricity: number; starsDetected: number } => a != null)
  const sessionFwhm = analyzedLights.length > 0
    ? analyzedLights.reduce((sum, a) => sum + a.medianFwhm, 0) / analyzedLights.length
    : null
  const sessionEcc = analyzedLights.length > 0
    ? analyzedLights.reduce((sum, a) => sum + a.medianEccentricity, 0) / analyzedLights.length
    : null

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
        {session.subsDateRange && (
          <span style={{ color: 'var(--color-text-muted)', fontSize: 12, fontWeight: 400 }}>
            ({session.subsDateRange})
          </span>
        )}
        <span style={{ color: 'var(--color-text-muted)', fontSize: 12, marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
          <span>{session.lights.length} lights</span>
          {session.flats.length > 0 && <span>{session.flats.length} flats</span>}
          <span>{formatIntegrationTime(session.integrationSeconds)}</span>
          <span>{formatFileSize(session.totalSizeBytes)}</span>

          {sessionFwhm != null && (
            <span title="Average median FWHM across subs">FWHM {sessionFwhm.toFixed(2)}</span>
          )}
          {sessionEcc != null && (
            <span title="Average median eccentricity across subs" style={{ color: sessionEcc >= 0.6 ? '#e74c3c' : sessionEcc >= 0.55 ? '#f0ad4e' : undefined }}>ECC {sessionEcc.toFixed(2)}</span>
          )}

          {cal.darksMatched ? (
            <span className="badge badge-success"><Check size={10} /> Darks</span>
          ) : session.lights.length === 0 ? (
            <span className="badge">Darks</span>
          ) : (
            <span className="badge badge-warning"><AlertCircle size={10} /> No darks</span>
          )}

          {cal.flatsAvailable ? (
            <span className="badge badge-success"><Check size={10} /> Flats</span>
          ) : session.lights.length === 0 ? (
            <span className="badge">Flats</span>
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
          <span
            style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', opacity: session.hasNotes ? 1 : 0.5 }}
            onClick={(e) => {
              e.stopPropagation()
              onOpenNotes(session.path, `Night: ${session.date}`)
            }}
            title={session.hasNotes ? 'View notes' : 'Create notes'}
          >
            <FileText size={13} />
          </span>
        </span>
      </button>

      {isOpen && (
        <div className="accordion-content">
          <div style={{ display: 'flex', gap: 16, marginBottom: 12, alignItems: 'stretch' }}>
            <div style={{ display: 'flex', gap: 24, flexShrink: 0 }}>
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

            {/* FWHM / Eccentricity chart */}
            {analyzedLights.length > 0 && (
              <SubsChart
                lights={session.lights}
                subAnalysis={subAnalysis}
              />
            )}
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
            <button
              className="btn btn-sm"
              style={{ padding: '4px 8px' }}
              onClick={() => onExclude(session.date)}
              title="Exclude night"
            >
              <EyeOff size={13} />
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
                        <tr key={flat.path} style={{ verticalAlign: 'middle' }}>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              {flat.filename.toLowerCase().startsWith('masterflat') && (
                                <span title="Master flat"><Star size={12} fill="var(--color-accent)" color="var(--color-accent)" /></span>
                              )}
                              {flat.filename}
                            </span>
                          </td>
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

function SubsChart({
  lights,
  subAnalysis,
}: Readonly<{
  lights: { filename: string; path: string }[]
  subAnalysis: Record<string, { medianFwhm: number; medianEccentricity: number; starsDetected: number }>
}>) {
  const [metric, setMetric] = useState<'fwhm' | 'ecc'>('fwhm')

  const data = useMemo(() => {
    return lights
      .map((l) => {
        const a = subAnalysis[l.path]
        if (!a) return null
        return {
          filename: l.filename,
          fwhm: a.medianFwhm,
          ecc: a.medianEccentricity,
        }
      })
      .filter((d): d is NonNullable<typeof d> => d != null)
  }, [lights, subAnalysis])

  if (data.length === 0) return null

  const values = data.map((d) => (metric === 'fwhm' ? d.fwhm : d.ecc))
  const maxVal = Math.max(...values)
  const minVal = Math.min(...values)
  const avg = values.reduce((s, v) => s + v, 0) / values.length
  const sorted = [...values].sort((a, b) => a - b)
  const median = sorted.length % 2 === 1
    ? sorted[Math.floor(sorted.length / 2)]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2

  // Y-axis layout
  const axisW = 36
  const chartH = 80
  const padTop = 12
  const padBot = 4
  const plotH = chartH - padTop - padBot

  const range = maxVal - minVal || 1
  const valToY = (v: number) => padTop + plotH - ((v - minVal) / range) * plotH

  // Generate ~3 tick values: min, mid, max
  const mid = (minVal + maxVal) / 2
  const ticks = minVal === maxVal ? [maxVal] : [minVal, mid, maxVal]

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', gap: 8 }}>
      {/* Left: toggle + stats */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 2 }}>
          <button
            className={`btn btn-sm ${metric === 'fwhm' ? 'btn-primary' : ''}`}
            style={{ fontSize: 10, padding: '2px 8px' }}
            onClick={() => setMetric('fwhm')}
          >
            FWHM
          </button>
          <button
            className={`btn btn-sm ${metric === 'ecc' ? 'btn-primary' : ''}`}
            style={{ fontSize: 10, padding: '2px 8px' }}
            onClick={() => setMetric('ecc')}
          >
            ECC
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span>avg: {avg.toFixed(2)}</span>
          <span>med: {median.toFixed(2)}</span>
        </div>
      </div>
      {/* Right: chart */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', border: '1px solid var(--color-border)', borderRadius: 6, background: 'var(--color-bg-primary)', overflow: 'hidden' }}>
        {/* Y-axis */}
        <svg width={axisW} height={chartH} style={{ display: 'block', flexShrink: 0 }}>
          {/* Axis line */}
          <line x1={axisW - 1} x2={axisW - 1} y1={padTop} y2={padTop + plotH} stroke="var(--color-border)" strokeWidth={1} />
          {/* Ticks */}
          {ticks.map((v) => {
            const y = valToY(v)
            return (
              <g key={v}>
                <line x1={axisW - 4} x2={axisW - 1} y1={y} y2={y} stroke="var(--color-text-muted)" strokeWidth={1} />
                <text x={axisW - 6} y={y + 3} textAnchor="end" fontSize={9} fill="var(--color-text-muted)">
                  {v.toFixed(1)}
                </text>
              </g>
            )
          })}
        </svg>
        {/* Chart area */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <svg width="100%" height={chartH} style={{ display: 'block' }}
            preserveAspectRatio="none" viewBox={`0 0 ${data.length * 8} ${chartH}`}
          >
            {/* Average line */}
            <line
              x1={0} x2={data.length * 8}
              y1={valToY(avg)} y2={valToY(avg)}
              stroke="var(--color-text-muted)" strokeWidth={0.5} strokeDasharray="3 2" opacity={0.6}
            />
            {/* Bars */}
            {data.map((d, i) => {
              const v = metric === 'fwhm' ? d.fwhm : d.ecc
              const barH = Math.max(((v - minVal) / range) * plotH, 0.5)
              const x = i * 8 + 1
              const y = padTop + plotH - barH
              return (
                <rect key={d.filename} x={x} y={y} width={6} height={barH} rx={0.5}
                  fill="var(--color-accent)" opacity={0.75}
                >
                  <title>{d.filename}: {v.toFixed(2)}</title>
                </rect>
              )
            })}
          </svg>
        </div>
      </div>
    </div>
  )
}
