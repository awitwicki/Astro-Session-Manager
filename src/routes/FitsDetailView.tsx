import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, ZoomIn, ZoomOut, RotateCcw, ChevronLeft, ChevronRight, ChevronDown, FolderOpen, Eye } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useAppStore } from '../store/appStore'
import type { SubAnalysisResult, StarsDetailResult } from '../types'
import { fitsGalleryPath, projectPath, type GalleryScope, type GalleryViewType } from '../lib/constants'
import { computeMedian } from '../lib/formatters'

interface FitsHeader {
  bayerpat?: string
  naxis1?: number
  naxis2?: number
  naxis3?: number
  object?: string
  exptime?: number
  ccdTemp?: number
  filter?: string
  dateObs?: string
  instrume?: string
  telescop?: string
  gain?: number
  bitpix?: number
  raw?: Record<string, unknown>
  [key: string]: unknown
}

interface FitsPreviewResult {
  imageData: string
  width: number
  height: number
  originalWidth: number
  originalHeight: number
  header: FitsHeader
}

export function FitsDetailView() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const filePath = searchParams.get('path') || ''
  const scope = searchParams.get('scope') as GalleryScope | null
  const projectParam = searchParams.get('project') || ''
  const filterParam = searchParams.get('filter') || ''
  const dateParam = searchParams.get('date') || ''
  const viewTypeParam = (searchParams.get('viewType') as GalleryViewType) || 'lights'

  const projects = useAppStore((s) => s.projects)
  const subAnalysis = useAppStore((s) => s.subAnalysis)

  const [analysisResult, setAnalysisResult] = useState<SubAnalysisResult | null>(null)
  const [analysisLoading, setAnalysisLoading] = useState(false)

  const starsCacheRef = useRef<Map<string, StarsDetailResult>>(new Map())
  const starsFailedRef = useRef<Set<string>>(new Set())
  const [starsCacheVersion, setStarsCacheVersion] = useState(0)
  const [starsLoading, setStarsLoading] = useState(false)

  const project = useMemo(() => projects.find((p) => p.name === projectParam), [projects, projectParam])

  // Helper to get frames for a given scope and viewType
  const getFrames = useCallback(
    (s: GalleryScope, vt: GalleryViewType, proj: string, flt: string, dt: string) => {
      const p = projects.find((pr) => pr.name === proj)
      if (!p) return []

      const collectFrames = (sessions: typeof p.filters[0]['sessions']) => {
        const lights = vt !== 'flats' ? sessions.flatMap((ses) => ses.lights.map((l) => l.path)) : []
        const flats = vt !== 'lights' ? sessions.flatMap((ses) => ses.flats.map((f) => f.path)) : []
        return [...lights, ...flats]
      }

      if (s === 'session') {
        const filter = p.filters.find((f) => f.name === flt)
        if (!filter) return []
        const session = filter.sessions.find((ses) => ses.date === dt)
        if (!session) return []
        return collectFrames([session])
      }

      if (s === 'filter') {
        const filter = p.filters.find((f) => f.name === flt)
        if (!filter) return []
        return collectFrames(filter.sessions)
      }

      if (s === 'project') {
        return p.filters.flatMap((f) => collectFrames(f.sessions))
      }

      return []
    },
    [projects]
  )

  // Derive gallery frame list from store based on scope
  const frames = useMemo(() => {
    if (!scope || !projectParam) return []
    return getFrames(scope, viewTypeParam, projectParam, filterParam, dateParam)
  }, [scope, projectParam, filterParam, dateParam, viewTypeParam, getFrames])

  const currentIndex = useMemo(() => {
    if (frames.length === 0) return -1
    return frames.indexOf(filePath)
  }, [frames, filePath])

  const hasGallery = frames.length > 0
  const hasPrev = currentIndex > 0
  const hasNext = currentIndex < frames.length - 1

  const buildUrl = useCallback(
    (path: string, s: GalleryScope, proj: string, flt?: string, dt?: string, vt?: GalleryViewType) => {
      return fitsGalleryPath(path, s, proj, flt, dt, vt)
    },
    []
  )

  const navigateToFrame = useCallback(
    (index: number) => {
      if (index < 0 || index >= frames.length || !scope) return
      navigate(buildUrl(frames[index], scope, projectParam, filterParam || undefined, dateParam || undefined, viewTypeParam))
    },
    [frames, scope, projectParam, filterParam, dateParam, viewTypeParam, navigate, buildUrl]
  )

  const goPrev = useCallback(() => {
    if (hasPrev) navigateToFrame(currentIndex - 1)
  }, [hasPrev, currentIndex, navigateToFrame])

  const goNext = useCallback(() => {
    if (hasNext) navigateToFrame(currentIndex + 1)
  }, [hasNext, currentIndex, navigateToFrame])

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        goPrev()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        goNext()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [goPrev, goNext])

  // Navigate to a tree node — pick first frame in that scope
  const navigateToTreeNode = useCallback(
    (newScope: GalleryScope, flt?: string, dt?: string, vt?: GalleryViewType) => {
      const effectiveVt = vt ?? viewTypeParam
      const newFrames = getFrames(newScope, effectiveVt, projectParam, flt || '', dt || '')
      if (newFrames.length === 0) return
      // If current file is in the new frames, keep it; otherwise pick first
      const target = newFrames.includes(filePath) ? filePath : newFrames[0]
      navigate(buildUrl(target, newScope, projectParam, flt, dt, effectiveVt))
    },
    [projectParam, filePath, viewTypeParam, getFrames, navigate, buildUrl]
  )

  // Handle view type change
  const handleViewTypeChange = useCallback(
    (newVt: GalleryViewType) => {
      if (!scope) return
      const newFrames = getFrames(scope, newVt, projectParam, filterParam, dateParam)
      if (newFrames.length === 0) {
        // Navigate anyway to show empty state
        navigate(buildUrl(filePath, scope, projectParam, filterParam || undefined, dateParam || undefined, newVt))
        return
      }
      const target = newFrames.includes(filePath) ? filePath : newFrames[0]
      navigate(buildUrl(target, scope, projectParam, filterParam || undefined, dateParam || undefined, newVt))
    },
    [scope, projectParam, filterParam, dateParam, filePath, getFrames, navigate, buildUrl]
  )

  const [keywordsExpanded, setKeywordsExpanded] = useState(() => {
    return localStorage.getItem('fitsDetail.keywordsExpanded') === 'true'
  })

  const toggleKeywords = useCallback(() => {
    setKeywordsExpanded((prev) => {
      const next = !prev
      localStorage.setItem('fitsDetail.keywordsExpanded', String(next))
      return next
    })
  }, [])

  const [showHeatmap, setShowHeatmap] = useState(() => {
    return localStorage.getItem('fitsDetail.showHeatmap') === 'true'
  })

  const [showTilt, setShowTilt] = useState(() => {
    return localStorage.getItem('fitsDetail.showTilt') === 'true'
  })

  const toggleHeatmap = useCallback(() => {
    setShowHeatmap((prev) => {
      const next = !prev
      localStorage.setItem('fitsDetail.showHeatmap', String(next))
      return next
    })
  }, [])

  const toggleTilt = useCallback(() => {
    setShowTilt((prev) => {
      const next = !prev
      localStorage.setItem('fitsDetail.showTilt', String(next))
      return next
    })
  }, [])

  const [preview, setPreview] = useState<FitsPreviewResult | null>(null)
  const [headerData, setHeaderData] = useState<FitsHeader | null>(null)
  const [headerLoading, setHeaderLoading] = useState(true)
  const [imageLoading, setImageLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [imageUrl, setImageUrl] = useState<string>('')
  const [previewProgress, setPreviewProgress] = useState<{ current: number; total: number } | null>(null)
  const initialFitDoneRef = useRef(false)
  const lastPreviewSizeRef = useRef<{ w: number; h: number } | null>(null)
  const batchFramesKeyRef = useRef<string>('')

  // Batch preview generation
  useEffect(() => {
    if (frames.length === 0) return
    const framesKey = frames.join('|')
    if (batchFramesKeyRef.current === framesKey) return
    batchFramesKeyRef.current = framesKey

    let cancelled = false
    let unlisten: (() => void) | null = null

    const idx = frames.indexOf(filePath)
    const startIdx = idx >= 0 ? idx : 0
    const reordered = [...frames.slice(startIdx), ...frames.slice(0, startIdx)]

    async function run() {
      unlisten = await listen<{ current: number; total: number; filePath: string }>(
        'preview:progress',
        (event) => {
          if (!cancelled) {
            setPreviewProgress({ current: event.payload.current, total: event.payload.total })
          }
        }
      )
      try {
        await invoke('batch_generate_previews', { filePaths: reordered })
      } catch {
        // ignore batch errors
      } finally {
        if (unlisten) unlisten()
        if (!cancelled) setPreviewProgress(null)
      }
    }

    run()

    return () => {
      cancelled = true
      if (unlisten) unlisten()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frames])

  // Clear preview cache from RAM only when unmounting
  useEffect(() => {
    return () => {
      invoke('clear_preview_cache').catch(() => {})
      batchFramesKeyRef.current = ''
    }
  }, [])

  // Reset error and clear overlay canvases when file changes
  useEffect(() => {
    setError(null)
    for (const ref of [heatmapCanvasRef, tiltCanvasRef]) {
      const canvas = ref.current
      if (canvas) {
        const ctx = canvas.getContext('2d')
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
      }
    }
  }, [filePath])

  // Show cached analysis if available (no auto-analyze)
  useEffect(() => {
    if (!filePath) return
    const cached = subAnalysis[filePath]
    if (cached) {
      setAnalysisResult(cached)
    } else {
      setAnalysisResult(null)
    }
    setAnalysisLoading(false)
  }, [filePath, subAnalysis])

  // Fetch per-star detail when heatmap or tilt is enabled
  useEffect(() => {
    if (!filePath || (!showHeatmap && !showTilt)) return
    if (starsCacheRef.current.has(filePath) || starsFailedRef.current.has(filePath)) return

    let cancelled = false
    setStarsLoading(true)

    invoke<StarsDetailResult>('analyze_stars_detail', { filePath })
      .then((result) => {
        if (!cancelled) {
          starsCacheRef.current.set(filePath, result)
          setStarsCacheVersion((v) => v + 1)
          setStarsLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('Star analysis failed:', err)
          starsFailedRef.current.add(filePath)
          setStarsLoading(false)
        }
      })

    return () => { cancelled = true }
  }, [filePath, showHeatmap, showTilt])

  // Fit image to container
  const fitToView = useCallback(() => {
    if (!preview || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const scaleX = rect.width / preview.width
    const scaleY = rect.height / preview.height
    const fitZoom = Math.min(scaleX, scaleY, 1)
    const scaledW = preview.width * fitZoom
    const scaledH = preview.height * fitZoom
    setZoom(fitZoom)
    setPan({ x: (rect.width - scaledW) / 2, y: (rect.height - scaledH) / 2 })
  }, [preview])

  const handleImageLoad = useCallback(() => {
    if (!initialFitDoneRef.current) {
      initialFitDoneRef.current = true
      fitToView()
    }
  }, [fitToView])

  // Phase 1: Load header quickly
  useEffect(() => {
    if (!filePath) return
    let cancelled = false
    setHeaderLoading(true)
    setHeaderData(null)

    invoke<FitsHeader>('read_fits_header', { filePath })
      .then((data) => {
        if (!cancelled) {
          setHeaderData(data)
          setHeaderLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(String(err))
          setHeaderLoading(false)
        }
      })

    return () => { cancelled = true }
  }, [filePath])

  // Phase 2: Load preview
  useEffect(() => {
    if (!filePath) return
    let cancelled = false
    const loadingTimer = setTimeout(() => {
      if (!cancelled) {
        setImageLoading(true)
        setPreview(null)
      }
    }, 150)

    invoke<FitsPreviewResult>('get_fits_preview', { filePath })
      .then((result) => {
        if (!cancelled) {
          clearTimeout(loadingTimer)
          const prev = lastPreviewSizeRef.current
          const sameSize = prev != null && prev.w === result.width && prev.h === result.height
          lastPreviewSizeRef.current = { w: result.width, h: result.height }
          if (!sameSize) {
            initialFitDoneRef.current = false
          }
          setPreview(result)
          setImageUrl('data:image/jpeg;base64,' + result.imageData)
          setImageLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          clearTimeout(loadingTimer)
          setError(String(err))
          setImageLoading(false)
        }
      })

    return () => {
      cancelled = true
      clearTimeout(loadingTimer)
    }
  }, [filePath])

  // Mouse handlers for pan
  const handleMouseDown = (e: React.MouseEvent): void => {
    if (e.button === 0) {
      setDragging(true)
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y })
    }
  }

  const handleMouseMove = (e: React.MouseEvent): void => {
    if (dragging) {
      setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y })
    }
  }

  const handleMouseUp = (): void => {
    setDragging(false)
  }

  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const heatmapCanvasRef = useRef<HTMLCanvasElement>(null)
  const tiltCanvasRef = useRef<HTMLCanvasElement>(null)

  // Draw image onto canvas when imageUrl changes
  useEffect(() => {
    if (!imageUrl || !preview) return
    const canvas = canvasRef.current
    if (!canvas) return

    const img = new Image()
    img.onload = () => {
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.drawImage(img, 0, 0)
      }
      handleImageLoad()
    }
    img.src = imageUrl
  }, [imageUrl, preview, handleImageLoad])

  // Draw FWHM heatmap overlay
  useEffect(() => {
    const canvas = heatmapCanvasRef.current
    if (!canvas || !preview || !showHeatmap) {
      if (canvas) {
        const ctx = canvas.getContext('2d')
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
      }
      return
    }

    const starData = starsCacheRef.current.get(filePath)
    if (!starData || starData.stars.length === 0) return

    canvas.width = preview.width
    canvas.height = preview.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const gridCols = 20
    const gridRows = 20
    const cellW = starData.imageWidth / gridCols
    const cellH = starData.imageHeight / gridRows

    // Scale factors from original image to preview
    const scaleX = preview.width / starData.imageWidth
    const scaleY = preview.height / starData.imageHeight

    // Accumulate FWHM values per grid cell
    const grid: number[][][] = Array.from({ length: gridRows }, () =>
      Array.from({ length: gridCols }, () => [] as number[])
    )

    for (const star of starData.stars) {
      const col = Math.min(Math.floor(star.x / cellW), gridCols - 1)
      const row = Math.min(Math.floor(star.y / cellH), gridRows - 1)
      grid[row][col].push(star.fwhm)
    }

    const medianFwhm = starData.medianFwhm
    if (medianFwhm === 0) return

    // Draw grid cells
    for (let row = 0; row < gridRows; row++) {
      for (let col = 0; col < gridCols; col++) {
        const cell = grid[row][col]
        if (cell.length === 0) continue

        const avgFwhm = computeMedian(cell)
        const deviation = Math.abs(avgFwhm - medianFwhm) / medianFwhm

        // Color: green (0% deviation) -> yellow (25%) -> red (50%+)
        let r: number, g: number, b: number
        if (deviation < 0.25) {
          const t = deviation / 0.25
          r = Math.round(255 * t)
          g = 255
          b = 0
        } else {
          const t = Math.min((deviation - 0.25) / 0.25, 1)
          r = 255
          g = Math.round(255 * (1 - t))
          b = 0
        }

        const px = col * cellW * scaleX
        const py = row * cellH * scaleY
        const pw = cellW * scaleX
        const ph = cellH * scaleY

        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.5)`
        ctx.fillRect(px, py, pw, ph)
      }
    }
  }, [filePath, preview, showHeatmap, starsCacheVersion])

  // Draw tilt diagram overlay
  useEffect(() => {
    const canvas = tiltCanvasRef.current
    if (!canvas || !preview || !showTilt) {
      if (canvas) {
        const ctx = canvas.getContext('2d')
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
      }
      return
    }

    const starData = starsCacheRef.current.get(filePath)
    if (!starData || starData.stars.length === 0) return

    canvas.width = preview.width
    canvas.height = preview.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const imgW = starData.imageWidth
    const imgH = starData.imageHeight

    // Define 5 regions: 4 corners + center
    const regionSize = 0.25
    const regions = [
      { name: 'TL', xMin: 0, xMax: imgW * regionSize, yMin: 0, yMax: imgH * regionSize },
      { name: 'TR', xMin: imgW * (1 - regionSize), xMax: imgW, yMin: 0, yMax: imgH * regionSize },
      { name: 'BL', xMin: 0, xMax: imgW * regionSize, yMin: imgH * (1 - regionSize), yMax: imgH },
      { name: 'BR', xMin: imgW * (1 - regionSize), xMax: imgW, yMin: imgH * (1 - regionSize), yMax: imgH },
      { name: 'C', xMin: imgW * 0.25, xMax: imgW * 0.75, yMin: imgH * 0.25, yMax: imgH * 0.75 },
    ]

    const regionFwhm: Record<string, number[]> = {}
    for (const r of regions) {
      regionFwhm[r.name] = []
    }

    // Assign stars to regions
    for (const star of starData.stars) {
      for (const r of regions) {
        if (star.x >= r.xMin && star.x < r.xMax && star.y >= r.yMin && star.y < r.yMax) {
          regionFwhm[r.name].push(star.fwhm)
        }
      }
    }

    // Compute median FWHM per region
    const avgFwhm: Record<string, number | null> = {}
    for (const name of Object.keys(regionFwhm)) {
      const values = regionFwhm[name]
      avgFwhm[name] = values.length > 0 ? computeMedian(values) : null
    }

    const centerFwhm = avgFwhm['C']
    if (centerFwhm == null) return

    // Scale fonts relative to canvas size
    const baseSize = Math.min(canvas.width, canvas.height)
    const labelFontSize = Math.max(14, Math.round(baseSize * 0.03))
    const pctFontSize = Math.max(12, Math.round(baseSize * 0.025))
    const lineWidth = Math.max(2, Math.round(baseSize * 0.004))

    // Position labels in preview coordinates
    const margin = 0.12
    const positions: Record<string, { x: number; y: number }> = {
      TL: { x: preview.width * margin, y: preview.height * margin },
      TR: { x: preview.width * (1 - margin), y: preview.height * margin },
      BL: { x: preview.width * margin, y: preview.height * (1 - margin) },
      BR: { x: preview.width * (1 - margin), y: preview.height * (1 - margin) },
      C: { x: preview.width * 0.5, y: preview.height * 0.5 },
    }

    // Draw lines from corners to center
    const corners = ['TL', 'TR', 'BL', 'BR']
    for (const corner of corners) {
      const cornerFwhm = avgFwhm[corner]
      if (cornerFwhm == null) continue

      const deviation = Math.abs(cornerFwhm - centerFwhm) / centerFwhm
      const t = Math.min(deviation / 0.5, 1)
      const r = Math.round(255 * t)
      const g = Math.round(255 * (1 - t))

      const from = positions[corner]
      const to = positions['C']

      ctx.beginPath()
      ctx.moveTo(from.x, from.y)
      ctx.lineTo(to.x, to.y)
      ctx.strokeStyle = `rgba(${r}, ${g}, 0, 0.8)`
      ctx.lineWidth = lineWidth
      ctx.stroke()

      // Deviation percentage label on line midpoint
      const midX = (from.x + to.x) / 2
      const midY = (from.y + to.y) / 2
      const pct = ((cornerFwhm - centerFwhm) / centerFwhm * 100).toFixed(1)
      const sign = cornerFwhm >= centerFwhm ? '+' : ''

      // Background for readability
      const text = `${sign}${pct}%`
      ctx.font = `bold ${pctFontSize}px monospace`
      const metrics = ctx.measureText(text)
      const pctPadX = Math.round(pctFontSize * 0.25)
      const pctPadY = Math.round(pctFontSize * 0.65)
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
      ctx.fillRect(midX - metrics.width / 2 - pctPadX, midY - pctPadY / 2 - pctPadX, metrics.width + pctPadX * 2, pctPadY + pctPadX)
      ctx.fillStyle = `rgb(${r}, ${g}, 0)`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(text, midX, midY)
    }

    // Draw FWHM value labels at each position
    for (const [name, pos] of Object.entries(positions)) {
      const fwhm = avgFwhm[name]
      if (fwhm == null) continue

      const label = fwhm.toFixed(2)
      ctx.font = `bold ${labelFontSize}px monospace`
      const metrics = ctx.measureText(label)

      // Background pill
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
      const pw = metrics.width + Math.round(labelFontSize * 0.85)
      const ph = Math.round(labelFontSize * 1.6)
      ctx.beginPath()
      ctx.roundRect(pos.x - pw / 2, pos.y - ph / 2, pw, ph, 4)
      ctx.fill()

      // Text
      ctx.fillStyle = name === 'C' ? '#4fc3f7' : '#ffffff'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, pos.x, pos.y)
    }
  }, [filePath, preview, showTilt, starsCacheVersion])

  const handleWheel = (e: React.WheelEvent): void => {
    e.preventDefault()
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return

    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top

    const oldZoom = zoom
    const delta = e.deltaY > 0 ? -0.1 : 0.1
    const newZoom = Math.max(0.1, Math.min(10, oldZoom + delta))

    const scale = newZoom / oldZoom
    const newPanX = mouseX - scale * (mouseX - pan.x)
    const newPanY = mouseY - scale * (mouseY - pan.y)

    setZoom(newZoom)
    setPan({ x: newPanX, y: newPanY })
  }

  const resetView = (): void => {
    fitToView()
  }

  // Extract filename from path
  const filename = filePath.split('/').pop() || filePath

  if (error) {
    return (
      <div className="empty-state">
        <h3>Failed to load FITS file</h3>
        <p style={{ color: 'var(--color-error)' }}>{error}</p>
        <button className="btn" style={{ marginTop: 16 }} onClick={() => projectParam ? navigate(projectPath(projectParam)) : navigate(-1)}>
          <ArrowLeft size={14} /> Go Back
        </button>
      </div>
    )
  }

  const displayHeader = headerData || preview?.header || null
  const bayerpat = displayHeader?.bayerpat
  const naxis3 = displayHeader?.naxis3 || 1
  const hasBayer =
    naxis3 <= 1 &&
    bayerpat != null &&
    ['RGGB', 'BGGR', 'GRBG', 'GBRG'].includes(String(bayerpat).toUpperCase())
  const isColor = hasBayer || naxis3 > 1

  const headerEntries = displayHeader
    ? Object.entries((displayHeader.raw as Record<string, unknown>) || {})
    : []

  return (
    <div style={{ display: 'flex', gap: 0, height: '100%' }}>
      {/* Left sidebar: Folder tree */}
      {project && (
        <div
          style={{
            width: 260,
            minWidth: 260,
            overflow: 'auto',
            background: 'var(--color-bg-secondary)',
            borderRight: '1px solid var(--color-border)',
            padding: '12px 0',
            marginRight: '12px',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ padding: '0 12px 8px', fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Scope
          </div>

          {/* View type selector */}
          <div style={{ padding: '0 12px 10px', display: 'flex', gap: 2 }}>
            {(['lights', 'flats', 'both'] as GalleryViewType[]).map((vt) => (
              <button
                key={vt}
                className={`btn btn-sm ${viewTypeParam === vt ? 'btn-primary' : ''}`}
                style={{ flex: 1, fontSize: 11, padding: '3px 6px', textTransform: 'capitalize' }}
                onClick={() => handleViewTypeChange(vt)}
              >
                {vt}
              </button>
            ))}
          </div>

          <div style={{ padding: '0 8px', fontSize: 12 }}>
            <FolderTree
              project={project}
              scope={scope}
              filterParam={filterParam}
              dateParam={dateParam}
              viewTypeParam={viewTypeParam}
              onNavigate={navigateToTreeNode}
            />
          </div>
        </div>
      )}

      {/* Main content: Image + header below */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, padding: '0 0 0 0' }}>
        {/* Gallery toolbar */}
        <div className="gallery-toolbar">
          <div className="gallery-toolbar-group">
            <button className="btn btn-sm" onClick={() => projectParam ? navigate(projectPath(projectParam)) : navigate(-1)}>
              <ArrowLeft size={14} /> Back
            </button>
          </div>

          {hasGallery && (
            <div className="gallery-toolbar-group">
              <button
                className="btn btn-sm"
                onClick={goPrev}
                disabled={!hasPrev}
                title="Previous frame (Left arrow)"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="gallery-counter">
                {currentIndex >= 0 ? currentIndex + 1 : '?'} / {frames.length}
              </span>
              <button
                className="btn btn-sm"
                onClick={goNext}
                disabled={!hasNext}
                title="Next frame (Right arrow)"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          )}

          <div className="gallery-toolbar-group">
            <button
              className="btn btn-sm"
              onClick={() => invoke('show_in_folder', { path: filePath })}
              title="Show in Explorer"
            >
              <FolderOpen size={14} />
            </button>
          </div>

          <div style={{ flex: 1 }} />

          <div className="gallery-toolbar-group" style={{ gap: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer', color: 'var(--color-text-secondary)' }}>
              <input type="checkbox" checked={showHeatmap} onChange={toggleHeatmap} />
              FWHM Heatmap
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer', color: 'var(--color-text-secondary)' }}>
              <input type="checkbox" checked={showTilt} onChange={toggleTilt} />
              Tilt Diagram
            </label>
            {starsLoading && <div className="spinner" style={{ width: 12, height: 12 }} />}
          </div>

          <div className="gallery-toolbar-group">
            {isColor && (
              <span className="badge badge-info" style={{ fontSize: 10 }}>
                {hasBayer ? `Bayer ${String(bayerpat).toUpperCase()}` : 'RGB'}
              </span>
            )}
            {preview && (
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                {preview.originalWidth}x{preview.originalHeight}
                {preview.width !== preview.originalWidth && (
                  <> (preview {preview.width}x{preview.height})</>
                )}
              </span>
            )}
          </div>

          <div className="gallery-toolbar-group">
            <button
              className="btn btn-sm"
              onClick={() => {
                const rect = containerRef.current?.getBoundingClientRect()
                if (!rect) { setZoom((z) => Math.min(10, z + 0.25)); return }
                const cx = rect.width / 2
                const cy = rect.height / 2
                const newZoom = Math.min(10, zoom + 0.25)
                const scale = newZoom / zoom
                setPan({ x: cx - scale * (cx - pan.x), y: cy - scale * (cy - pan.y) })
                setZoom(newZoom)
              }}
            >
              <ZoomIn size={14} />
            </button>
            <span
              style={{
                fontSize: 12,
                color: 'var(--color-text-muted)',
                minWidth: 40,
                textAlign: 'center',
              }}
            >
              {Math.round(zoom * 100)}%
            </span>
            <button
              className="btn btn-sm"
              onClick={() => {
                const rect = containerRef.current?.getBoundingClientRect()
                if (!rect) { setZoom((z) => Math.max(0.1, z - 0.25)); return }
                const cx = rect.width / 2
                const cy = rect.height / 2
                const newZoom = Math.max(0.1, zoom - 0.25)
                const scale = newZoom / zoom
                setPan({ x: cx - scale * (cx - pan.x), y: cy - scale * (cy - pan.y) })
                setZoom(newZoom)
              }}
            >
              <ZoomOut size={14} />
            </button>
            <button className="btn btn-sm" onClick={resetView}>
              <RotateCcw size={14} />
            </button>
          </div>
        </div>

        {/* Filename display */}
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 4, fontFamily: 'var(--font-mono)', padding: '0 8px' }}>
          {filename}
        </div>

        {/* Preview generation progress */}
        {previewProgress && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, fontSize: 12, color: 'var(--color-text-muted)', padding: '0 8px' }}>
            <div className="spinner" style={{ width: 12, height: 12 }} />
            <span>Generating previews: {previewProgress.current}/{previewProgress.total}</span>
            <div className="progress-bar" style={{ flex: 1, height: 3 }}>
              <div
                className="progress-bar-fill"
                style={{ width: `${(previewProgress.current / previewProgress.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Image area */}
        {imageLoading ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--color-bg-primary)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border)',
              flexDirection: 'column',
              gap: 16,
              margin: '0 8px',
            }}
          >
            <div className="spinner" />
            <span style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
              Loading image data...
            </span>
          </div>
        ) : (
          <div
            ref={containerRef}
            style={{
              flex: 1,
              overflow: 'hidden',
              background: 'var(--color-bg-primary)',
              border: '1px solid var(--color-border)',
              cursor: dragging ? 'grabbing' : 'grab',
              position: 'relative',
              margin: '0 8px',
            }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onWheel={handleWheel}
          >
            <canvas
              ref={canvasRef}
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: '0 0',
                imageRendering: zoom > 2 ? 'pixelated' : 'auto',
                display: 'block',
              }}
            />
            <canvas
              ref={heatmapCanvasRef}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: '0 0',
                pointerEvents: 'none',
                display: showHeatmap ? 'block' : 'none',
              }}
            />
            <canvas
              ref={tiltCanvasRef}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: '0 0',
                pointerEvents: 'none',
                display: showTilt ? 'block' : 'none',
              }}
            />
          </div>
        )}

        {/* FITS Header below image */}
        <div
          style={{
            maxHeight: 220,
            overflow: 'auto',
            background: 'var(--color-bg-secondary)',
            borderTop: '1px solid var(--color-border)',
            padding: '8px 12px',
            margin: '0 8px 0 8px',
            fontSize: 12,
          }}
        >
          {headerLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-text-muted)' }}>
              <div className="spinner" style={{ width: 14, height: 14 }} />
              Loading header...
            </div>
          ) : displayHeader ? (
            <div>
              {/* Compact header row */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', marginBottom: 4 }}>
                {displayHeader.object != null && <HeaderChip label="Object" value={String(displayHeader.object)} />}
                {displayHeader.exptime != null && <HeaderChip label="Exp" value={`${String(displayHeader.exptime)}s`} />}
                {displayHeader.ccdTemp != null && <HeaderChip label="Temp" value={`${String(displayHeader.ccdTemp)}\u00B0C`} />}
                {displayHeader.filter != null && <HeaderChip label="Filter" value={String(displayHeader.filter)} />}
                {displayHeader.dateObs != null && <HeaderChip label="Date" value={String(displayHeader.dateObs)} />}
                {displayHeader.instrume != null && <HeaderChip label="Camera" value={String(displayHeader.instrume)} />}
                {displayHeader.telescop != null && <HeaderChip label="Telescope" value={String(displayHeader.telescop)} />}
                {displayHeader.gain != null && <HeaderChip label="Gain" value={String(displayHeader.gain)} />}
                {displayHeader.bayerpat != null && <HeaderChip label="Bayer" value={String(displayHeader.bayerpat)} />}
                <HeaderChip label="Size" value={`${String(displayHeader.naxis1)}x${String(displayHeader.naxis2)}`} />
                <HeaderChip label="Bits" value={`${String(displayHeader.bitpix)}`} />
                {analysisLoading && <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>Analyzing...</span>}
                {analysisResult && (
                  <>
                    <HeaderChip label="FWHM" value={analysisResult.medianFwhm.toFixed(2)} />
                    <HeaderChip label="ECC" value={analysisResult.medianEccentricity.toFixed(2)} />
                    <HeaderChip label="Stars" value={String(analysisResult.starsDetected)} />
                  </>
                )}
              </div>

              {/* Expandable raw keywords */}
              <div
                style={{
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  color: 'var(--color-text-muted)',
                  fontSize: 11,
                  userSelect: 'none',
                  marginTop: 4,
                }}
                onClick={toggleKeywords}
              >
                {keywordsExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                All Keywords ({headerEntries.length})
              </div>

              {keywordsExpanded && (
                <table className="table" style={{ fontSize: 11, marginTop: 4 }}>
                  <thead>
                    <tr>
                      <th>Keyword</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {headerEntries.map(([key, val]) => (
                      <tr key={key}>
                        <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{key}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
                          {String(val)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

// Compact header chip for the bottom panel
function HeaderChip({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      <span style={{ color: 'var(--color-text-muted)' }}>{label}:</span>
      <span style={{ fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{value}</span>
    </span>
  )
}

// Folder tree component showing project -> filter -> session hierarchy
function FolderTree({
  project,
  scope,
  filterParam,
  dateParam,
  viewTypeParam,
  onNavigate,
}: {
  project: { name: string; filters: { name: string; sessions: { date: string; lights: { path: string }[]; flats: { path: string }[] }[] }[] }
  scope: GalleryScope | null
  filterParam: string
  dateParam: string
  viewTypeParam: GalleryViewType
  onNavigate: (scope: GalleryScope, filter?: string, date?: string) => void
}) {
  const isProjectSelected = scope === 'project'

  const getFrameCount = (sessions: typeof project.filters[0]['sessions']) => {
    let count = 0
    if (viewTypeParam !== 'flats') count += sessions.reduce((s, ses) => s + ses.lights.length, 0)
    if (viewTypeParam !== 'lights') count += sessions.reduce((s, ses) => s + ses.flats.length, 0)
    return count
  }

  const totalFrames = getFrameCount(project.filters.flatMap((f) => f.sessions))

  return (
    <div>
      {/* Project node */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 8px',
          borderRadius: 4,
          cursor: 'pointer',
          fontWeight: 600,
          fontSize: 12,
          background: isProjectSelected ? 'var(--color-bg-active)' : 'transparent',
          color: isProjectSelected ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
        }}
        onClick={() => onNavigate('project')}
        title={`View all ${totalFrames} frames`}
      >
        <Eye size={12} style={{ opacity: 0.6, flexShrink: 0 }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.name}</span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--color-text-muted)', flexShrink: 0 }}>{totalFrames}</span>
      </div>

      {/* Filter nodes */}
      {project.filters.map((filter) => {
        const isFilterSelected = scope === 'filter' && filterParam === filter.name
        const isFilterParent = scope === 'session' && filterParam === filter.name
        const filterFrames = getFrameCount(filter.sessions)

        return (
          <div key={filter.name} style={{ marginLeft: 12 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 8px',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: isFilterSelected ? 600 : 400,
                background: isFilterSelected ? 'var(--color-bg-active)' : 'transparent',
                color: isFilterSelected ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
              }}
              onClick={() => onNavigate('filter', filter.name)}
              title={`View ${filterFrames} frames in ${filter.name}`}
            >
              <Eye size={11} style={{ opacity: 0.5, flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{filter.name}</span>
              <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--color-text-muted)', flexShrink: 0 }}>{filterFrames}</span>
            </div>

            {/* Session (night) nodes — show if this filter is selected or is parent */}
            {(isFilterSelected || isFilterParent) &&
              filter.sessions.map((session) => {
                const isSessionSelected = scope === 'session' && dateParam === session.date && filterParam === filter.name
                const sessionFrames = getFrameCount([session])

                return (
                  <div
                    key={session.date}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '3px 8px',
                      marginLeft: 14,
                      borderRadius: 4,
                      cursor: 'pointer',
                      fontSize: 11,
                      fontWeight: isSessionSelected ? 600 : 400,
                      background: isSessionSelected ? 'var(--color-bg-active)' : 'transparent',
                      color: isSessionSelected ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                    }}
                    onClick={() => onNavigate('session', filter.name, session.date)}
                    title={`View ${sessionFrames} frames from ${session.date}`}
                  >
                    <Eye size={10} style={{ opacity: 0.4, flexShrink: 0 }} />
                    <span>{session.date}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--color-text-muted)', flexShrink: 0 }}>{sessionFrames}</span>
                  </div>
                )
              })}
          </div>
        )
      })}
    </div>
  )
}
