import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { invoke } from '@tauri-apps/api/core'
import { MapPin, ZoomIn, ZoomOut } from 'lucide-react'
import { ensureCelestialLoaded } from '../../lib/celestialLoader'
import {
  altAzAt, altitudeCircleJ2000, azimuthLineJ2000, equatorialToHorizon, horizonPathJ2000,
  horizonToEquatorial,
  moonInfo, parallacticAngleDeg, sunInfo, zenithEquatorial,
  type MoonInfo, type SunInfo,
} from '../../lib/ephemeris'
import { skyTintLevels } from '../../lib/skyTint'
import { horizonAltAt, type HorizonProfile } from '../../lib/horizon'
import { useEffectiveHorizonProfile } from '../../hooks/useHorizon'
import { useAppStore } from '../../store/appStore'
import { usePlannerData } from '../../hooks/usePlanner'
import { useSimTime } from '../../hooks/useSimTime'
import {
  HORIZON_STROKE, fillGround, fitShape, isFinitePoint, longestRunPolyline, projectPoints,
  raToCelestial, strokePolyline, visiblePolyline,
} from '../../lib/altAzView'
import { clampLook, pannedCentre } from '../../lib/skyPan'
import { trajectoryPathJ2000, type TrajectoryPoint } from '../../lib/trajectory'
import { nightWindowStart, formatTimeInZone } from '../../lib/localTime'
import { PlannerTargetPanel, type TargetRow } from './PlannerTargetPanel'
import type { PlannerTarget } from '../../types/planner'
import { PlannerTimeToolbar } from './PlannerTimeToolbar'

const ALT_RINGS = [30, 60]
const RING_STEP_DEG = 30
const AZ_LINE_STEP_DEG = 15
const FLAT_HORIZON_STEP_DEG = 5
const PROFILE_HORIZON_STEP_DEG = 2

const COMPASS_MARKS: { az: number; label: string }[] = [
  { az: 0, label: 'N' }, { az: 30, label: '30' }, { az: 60, label: '60' },
  { az: 90, label: 'E' }, { az: 120, label: '120' }, { az: 150, label: '150' },
  { az: 180, label: 'S' }, { az: 210, label: '210' }, { az: 240, label: '240' },
  { az: 270, label: 'W' }, { az: 300, label: '300' }, { az: 330, label: '330' },
]

interface FrameData {
  time: Date
  lat: number
  lon: number
  timeZone: string
  profile: HorizonProfile | null
  horizonStepDeg: number
  horizonPts: [number, number][]
  altRings: [number, number][][]
  azLines: [number, number][][]
  zenith: [number, number]
  sun: SunInfo
  moon: MoonInfo
  sunHorizon: [number, number]
  altAzGridVisible: boolean
}

interface SkyMarker { ra: number; dec: number; name: string; selected: boolean }

// Module-level: the persistent d3-celestial redraw callback must always read
// current values across React renders and remounts (same pattern as
// ClassicSkyView's activeTargets).
let frame: FrameData | null = null
let markers: SkyMarker[] = []
let trajectory: TrajectoryPoint[] | null = null
// The look direction IS the view state — az/alt, not RA/Dec, so the ground
// stays down as time flows. Only this module ever moves it: the mouse drag
// pans in alt-az (panBy), focusTarget aims at a target, and every change
// reaches d3-celestial through pointCamera's single rotate(). d3-celestial's
// own drag/zoom behaviour is detached at init, so no redraw ever moves the
// view behind our back and nothing has to be read back from the projection.
let viewAz = 180
let viewAlt = 35

/** Points the camera at the stored look direction as the sky stands at the
 *  current frame's time. */
function pointCamera(): void {
  const f = frame
  if (!f) return
  const [ra, dec] = horizonToEquatorial(viewAz, viewAlt, f.time, f.lat, f.lon)
  const roll = parallacticAngleDeg(ra, dec, f.time, f.lat, f.lon)
  try { Celestial.rotate({ center: [raToCelestial(ra), dec, roll] }) } catch { /* ignore */ }
}

/** Drag step: the sky point under `from` (canvas px) moves to `to` and the
 *  horizon stays level — one rotate(), hence one full redraw, per mouse move.
 *  d3-celestial's own drag rotated the sphere freely and left the roll to a
 *  second full redraw queued from drawOverlay, which halved the frame rate
 *  and made the whole view twist visibly at every step. */
function panBy(from: [number, number], to: [number, number]): void {
  const f = frame
  const proj = Celestial.map?.projection?.()
  if (!f || !proj) return
  const p0 = proj.invert(from), p1 = proj.invert(to)
  const centre = proj.invert(proj.translate())
  if (!isFinitePoint(p0) || !isFinitePoint(p1) || !isFinitePoint(centre)) return
  const [lon, lat] = pannedCentre(centre, p0, p1)
  const { az, alt } = equatorialToHorizon(((lon % 360) + 360) % 360, lat, f.time, f.lat, f.lon)
  const look = clampLook(viewAz, az, alt)
  viewAz = look.az
  viewAlt = look.alt
  pointCamera()
}

/** Mouse input for the view: left-drag pans (panBy), wheel zooms about the
 *  centre. Pointer capture keeps a drag alive once the cursor leaves the
 *  canvas. */
function bindPointerInput(canvas: HTMLCanvasElement, signal: AbortSignal): void {
  let last: [number, number] | null = null
  const at = (e: PointerEvent): [number, number] => {
    const r = canvas.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    last = at(e)
    try { canvas.setPointerCapture(e.pointerId) } catch { /* ignore */ }
  }, { signal })
  canvas.addEventListener('pointermove', (e) => {
    if (!last) return
    if (!(e.buttons & 1)) { last = null; return }
    const now = at(e)
    panBy(last, now)
    last = now
  }, { signal })
  const end = () => { last = null }
  canvas.addEventListener('pointerup', end, { signal })
  canvas.addEventListener('pointercancel', end, { signal })
  // Same factor per wheel notch as d3.behavior.zoom used (2^(-deltaY/500)),
  // with line-mode deltas scaled the way it scaled them.
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault()
    const delta = -e.deltaY * (e.deltaMode ? 120 : 1)
    try { Celestial.zoomBy(Math.pow(2, delta * 0.002)) } catch { /* ignore */ }
  }, { signal, passive: false })
}

function drawSkyTint(
  ctx: CanvasRenderingContext2D, f: FrameData, proj: CelestialProjection,
  viewW: number, viewH: number,
): void {
  const { day, twilight } = skyTintLevels(f.sun.alt)
  if (day > 0) {
    ctx.fillStyle = `rgba(110, 160, 225, ${(0.6 * day).toFixed(3)})`
    ctx.fillRect(0, 0, viewW, viewH)
  }
  if (twilight > 0) {
    ctx.fillStyle = `rgba(45, 70, 140, ${(0.35 * twilight).toFixed(3)})`
    ctx.fillRect(0, 0, viewW, viewH)
    // Warm glow low in the sky, anchored where the sun sits below the horizon
    const p = proj([raToCelestial(f.sunHorizon[0]), f.sunHorizon[1]]) as [number, number] | null
    if (isFinitePoint(p)) {
      const radius = Math.max(viewW, viewH) * 0.7
      const g = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], radius)
      g.addColorStop(0, `rgba(255, 150, 70, ${(0.4 * twilight).toFixed(3)})`)
      g.addColorStop(1, 'rgba(255, 150, 70, 0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(p[0], p[1], radius, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

function drawMoonGlow(
  ctx: CanvasRenderingContext2D, x: number, y: number, viewSize: number, illumination: number,
): void {
  const radius = viewSize * (0.18 + 0.22 * illumination)
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius)
  g.addColorStop(0, `rgba(190, 205, 255, ${(0.28 * illumination).toFixed(3)})`)
  g.addColorStop(1, 'rgba(190, 205, 255, 0)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.fill()
}

function drawSun(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, 40)
  g.addColorStop(0, 'rgba(255, 240, 200, 0.9)')
  g.addColorStop(0.25, 'rgba(255, 220, 140, 0.45)')
  g.addColorStop(1, 'rgba(255, 200, 100, 0)')
  ctx.fillStyle = g
  ctx.beginPath(); ctx.arc(x, y, 40, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#fff3d6'
  ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill()
}

/** Moon disc with a two-arc phase terminator. `sunAngle` is the screen-space
 *  direction from the moon toward the sun; the lit side faces it. */
function drawMoon(
  ctx: CanvasRenderingContext2D, x: number, y: number, r: number,
  illumination: number, sunAngle: number,
): void {
  const k = 2 * illumination - 1 // -1 new .. 0 quarter .. +1 full
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(sunAngle)
  ctx.fillStyle = '#4a4c52'
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#e8e4d8'
  ctx.beginPath()
  ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2) // lit semicircle toward the sun (+x)
  ctx.ellipse(0, 0, r * Math.abs(k), r, 0, Math.PI / 2, (3 * Math.PI) / 2, k < 0)
  ctx.fill()
  ctx.restore()
}

/** Altitude gate for Sun/Moon disc draws: below this, the body reads as
 *  "behind the ground" and should not be drawn (avoids bleeding through
 *  GROUND_FILL's partial opacity). Profile-aware: under a custom horizon,
 *  the ground line sits at the profile's elevation at that azimuth, not the
 *  flat 0° line, so the gate must track it — a flat threshold would let a
 *  body behind a tall obstruction paint through the ground for a much wider
 *  window than the flat-horizon case's accepted 5°. */
function isAboveGroundFill(profile: HorizonProfile | null, alt: number, az: number): boolean {
  const groundAlt = profile ? horizonAltAt(profile, az) : 0
  return alt > groundAlt - 5
}

function drawOverlay(): void {
  const f = frame
  const ctx = Celestial.context
  const proj = Celestial.map?.projection?.()
  if (!f || !ctx || !proj) return
  const [cx, cy] = proj.translate()
  const viewW = cx * 2, viewH = cy * 2
  const viewSize = Math.max(viewW, viewH)
  const maxDist = viewSize * 6

  // Sky brightness + Sun/Moon (under the grid; the ground fill later covers
  // whatever sits below the horizon)
  drawSkyTint(ctx, f, proj, viewW, viewH)
  const sunPt = proj([raToCelestial(f.sun.raDeg), f.sun.decDeg]) as [number, number] | null
  const moonPt = proj([raToCelestial(f.moon.raDeg), f.moon.decDeg]) as [number, number] | null
  if (isFinitePoint(moonPt) && isAboveGroundFill(f.profile, f.moon.alt, f.moon.az)) {
    drawMoonGlow(ctx, moonPt[0], moonPt[1], viewSize, f.moon.illumination)
  }
  if (
    isFinitePoint(sunPt) && isAboveGroundFill(f.profile, f.sun.alt, f.sun.az) &&
    Math.hypot(sunPt[0] - cx, sunPt[1] - cy) < maxDist
  ) {
    drawSun(ctx, sunPt[0], sunPt[1])
  }
  if (
    isFinitePoint(moonPt) && isAboveGroundFill(f.profile, f.moon.alt, f.moon.az) &&
    Math.hypot(moonPt[0] - cx, moonPt[1] - cy) < maxDist
  ) {
    const sunAngle = isFinitePoint(sunPt)
      ? Math.atan2(sunPt[1] - moonPt[1], sunPt[0] - moonPt[0])
      : 0
    drawMoon(ctx, moonPt[0], moonPt[1], 11, f.moon.illumination, sunAngle)
  }

  // Alt-az mount grid (under everything else we draw)
  if (f.altAzGridVisible) {
    ctx.strokeStyle = 'rgba(120, 160, 200, 0.35)'
    ctx.lineWidth = 0.8
    ctx.setLineDash([2, 4])
    for (const ring of [...f.altRings, ...f.azLines]) {
      const shape = fitShape(projectPoints(ring, proj, cx, cy, maxDist), viewSize, cx, cy)
      strokePolyline(ctx, visiblePolyline(shape, cx, cy, viewW, viewH))
    }
    ctx.setLineDash([])
  }

  // Ground + horizon + compass labels
  const horizonPts = projectPoints(f.horizonPts, proj, cx, cy, maxDist)
  const horizonPoly = f.profile
    ? longestRunPolyline(horizonPts)
    : visiblePolyline(fitShape(horizonPts, viewSize, cx, cy), cx, cy, viewW, viewH)
  const zenithPt = proj([raToCelestial(f.zenith[0]), f.zenith[1]]) as [number, number] | null
  if (horizonPoly && isFinitePoint(zenithPt)) {
    fillGround(ctx, horizonPoly, zenithPt, viewW, viewH)
    ctx.strokeStyle = HORIZON_STROKE
    ctx.lineWidth = 1.5
    ctx.setLineDash([6, 4])
    strokePolyline(ctx, horizonPoly)
    ctx.setLineDash([])

    ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const { az, label } of COMPASS_MARKS) {
      const pt = horizonPts[az / f.horizonStepDeg]
      if (!pt) continue
      const dx = pt[0] - cx, dy = pt[1] - cy
      const dist = Math.hypot(dx, dy) || 1
      ctx.fillStyle = label.length === 1 ? '#ffcc88' : 'rgba(255, 204, 136, 0.75)'
      ctx.fillText(label, pt[0] + (dx / dist) * 12, pt[1] + (dy / dist) * 12)
    }
  }

  // Selected target's night trajectory: dashed arc with hour ticks; the
  // below-skyline part is skipped so the arc visibly dives behind terrain.
  const traj = trajectory
  if (traj) {
    const projected = traj.map((p) => {
      const pt = proj([raToCelestial(p.ra), p.dec]) as [number, number] | null
      return isFinitePoint(pt) && Math.hypot(pt[0] - cx, pt[1] - cy) <= maxDist ? pt : null
    })
    const aboveSkyline = (p: TrajectoryPoint) =>
      p.alt > (f.profile ? Math.max(0, horizonAltAt(f.profile, p.az)) : 0)
    ctx.strokeStyle = 'rgba(91, 155, 213, 0.85)'
    ctx.lineWidth = 1.4
    ctx.setLineDash([5, 4])
    ctx.beginPath()
    let penDown = false
    for (let i = 0; i < traj.length; i++) {
      const pt = projected[i]
      if (!pt || !aboveSkyline(traj[i])) { penDown = false; continue }
      if (penDown) ctx.lineTo(pt[0], pt[1])
      else ctx.moveTo(pt[0], pt[1])
      penDown = true
    }
    ctx.stroke()
    ctx.setLineDash([])
    // Hour ticks (every 6th sample at the 10-min step) + HH:MM every 3 hours
    ctx.fillStyle = 'rgba(91, 155, 213, 0.9)'
    ctx.font = '9px -apple-system, BlinkMacSystemFont, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    for (let i = 0; i < traj.length; i += 6) {
      const pt = projected[i]
      if (!pt || !aboveSkyline(traj[i])) continue
      ctx.beginPath()
      ctx.arc(pt[0], pt[1], 2, 0, Math.PI * 2)
      ctx.fill()
      if (i % 18 === 0) ctx.fillText(formatTimeInZone(traj[i].time, f.timeZone), pt[0], pt[1] - 4)
    }
  }

  // Target markers
  ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  for (const m of markers) {
    const pt = proj([raToCelestial(m.ra), m.dec]) as [number, number] | null
    if (!isFinitePoint(pt) || Math.hypot(pt[0] - cx, pt[1] - cy) > maxDist) continue
    ctx.strokeStyle = m.selected ? '#ff8844' : 'rgba(91, 155, 213, 0.9)'
    ctx.lineWidth = m.selected ? 1.8 : 1.2
    ctx.beginPath()
    ctx.arc(pt[0], pt[1], 6, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = m.selected ? '#ff8844' : 'rgba(170, 190, 220, 0.85)'
    ctx.fillText(m.name, pt[0] + 9, pt[1])
  }
}

export function PlannerSkyView({ focusTargetId = null }: { focusTargetId?: string | null }) {
  const { lat, lon, locationSet, timeZone, targets } = usePlannerData()
  const horizon = useEffectiveHorizonProfile()
  const flatHorizonPreview = useAppStore((s) => s.flatHorizonPreview)
  const setFlatHorizonPreview = useAppStore((s) => s.setFlatHorizonPreview)
  const containerRef = useRef<HTMLDivElement>(null)
  const initRef = useRef(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [altAzGridVisible, setAltAzGridVisible] = useState(true)
  const [raDecGridVisible, setRaDecGridVisible] = useState(false)
  // The re-center interval is created inside the async ensureCelestialLoaded()
  // continuation below, which runs after this effect's synchronous body
  // (including its cleanup registration) has already executed — so cleanup
  // must reach it through a ref rather than a plain closed-over variable.
  const recenterIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Detaches the pointer/wheel listeners bindPointerInput installs on the
  // canvas; created in the same async continuation, hence also a ref.
  const inputRef = useRef<AbortController | null>(null)

  const sim = useSimTime()
  const time = sim.time

  const frameData: FrameData = useMemo(() => {
    const horizonStepDeg = horizon ? PROFILE_HORIZON_STEP_DEG : FLAT_HORIZON_STEP_DEG
    const sun = sunInfo(time, lat, lon)
    return {
      time, lat, lon, timeZone,
      profile: horizon,
      horizonStepDeg,
      horizonPts: horizon
        ? horizonPathJ2000(time, lat, lon, horizonStepDeg, (az) => horizonAltAt(horizon, az))
        : horizonPathJ2000(time, lat, lon, horizonStepDeg),
      altRings: ALT_RINGS.map((alt) => altitudeCircleJ2000(alt, time, lat, lon, RING_STEP_DEG)),
      azLines: COMPASS_MARKS.map(({ az }) => azimuthLineJ2000(az, time, lat, lon, AZ_LINE_STEP_DEG)),
      zenith: zenithEquatorial(time, lat, lon),
      sun,
      moon: moonInfo(time, lat, lon),
      sunHorizon: horizonToEquatorial(sun.az, 0, time, lat, lon),
      altAzGridVisible,
    }
  }, [time, lat, lon, timeZone, horizon, altAzGridVisible])

  // Publish to the redraw callback and re-aim the camera for this frame.
  useEffect(() => {
    frame = frameData
    if (initRef.current) pointCamera()
  }, [frameData])

  const rows: TargetRow[] = useMemo(
    () => targets.map((t) => ({ target: t, ...altAzAt(t.ra, t.dec, time, lat, lon) })),
    [targets, time, lat, lon],
  )

  const selected = useMemo(
    () => targets.find((t) => t.id === selectedId) ?? null,
    [targets, selectedId],
  )

  const trajectoryPts = useMemo(
    () => selected
      ? trajectoryPathJ2000(
          selected.ra, selected.dec, nightWindowStart(time, timeZone), time, lat, lon)
      : null,
    [selected, time, timeZone, lat, lon],
  )

  // Publish markers/trajectory to the redraw callback alongside the frame
  useEffect(() => {
    markers = rows.map(({ target }) => ({
      ra: target.ra, dec: target.dec, name: target.name, selected: target.id === selectedId,
    }))
    trajectory = trajectoryPts
    if (initRef.current) {
      try { Celestial.redraw() } catch { /* ignore */ }
    }
  }, [rows, selectedId, trajectoryPts])

  // Hydrate saved grid-visibility settings once at mount.
  useEffect(() => {
    invoke<Record<string, unknown>>('get_all_settings')
      .then((s) => {
        if (typeof s.plannerAltAzGrid === 'boolean') setAltAzGridVisible(s.plannerAltAzGrid)
        if (typeof s.plannerRaDecGrid === 'boolean') setRaDecGridVisible(s.plannerRaDecGrid)
      })
      .catch(() => { /* defaults stay as-is */ })
  }, [])

  const pickAltAzGrid = (visible: boolean) => {
    setAltAzGridVisible(visible)
    invoke('set_setting', { key: 'plannerAltAzGrid', value: visible }).catch(() => {})
  }
  const pickRaDecGrid = (visible: boolean) => {
    setRaDecGridVisible(visible)
    invoke('set_setting', { key: 'plannerRaDecGrid', value: visible }).catch(() => {})
  }

  // Mirrors raDecGridVisible into a ref so the mount effect below — whose
  // closure only ever runs once — can read the latest value (possibly
  // updated by the settings-hydration effect after mount, before init
  // finishes) rather than the stale `false` it was defined with.
  const raDecGridVisibleRef = useRef(raDecGridVisible)
  useEffect(() => { raDecGridVisibleRef.current = raDecGridVisible }, [raDecGridVisible])

  // Toggle d3-celestial's own RA/Dec graticule + equatorial-plane lines. Not
  // gated on initRef: before init this simply no-ops against an undefined
  // Celestial (caught below), and the initial Celestial.display() call
  // already seeds the correct value from raDecGridVisibleRef once it runs.
  useEffect(() => {
    try {
      Celestial.apply({
        lines: {
          graticule: { show: raDecGridVisible },
          equatorial: { show: raDecGridVisible },
        },
      })
    } catch { /* ignore */ }
  }, [raDecGridVisible])

  const focusTarget = (t: PlannerTarget) => {
    setSelectedId(t.id)
    const { alt, az } = altAzAt(t.ra, t.dec, time, lat, lon)
    viewAz = az
    viewAlt = Math.max(alt, 15) // below the horizon: aim at its azimuth instead
    pointCamera()
  }

  // Deep-link focus: targets hydrate asynchronously, so this effect re-runs
  // as they arrive — the ref (not a mount-only run) guards against
  // re-focusing after the user has since panned elsewhere.
  const focusedOnceRef = useRef(false)
  useEffect(() => {
    if (focusedOnceRef.current || !focusTargetId) return
    const t = targets.find((x) => x.id === focusTargetId)
    if (!t) return // unknown id: planner mode simply opens unselected
    focusedOnceRef.current = true
    focusTarget(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- focusTarget is a stable per-render closure over time/lat/lon; including it would refire every frame tick
  }, [focusTargetId, targets])

  useEffect(() => {
    if (!containerRef.current || initRef.current) return
    let cancelled = false

    ensureCelestialLoaded().then(() => {
      if (cancelled || initRef.current || !containerRef.current) return
      if (typeof Celestial === 'undefined') {
        console.error('d3-celestial failed to load')
        return
      }
      initRef.current = true
      const rect = containerRef.current.getBoundingClientRect()
      const f = frame
      const [ra0, dec0] = f ? horizonToEquatorial(viewAz, viewAlt, f.time, f.lat, f.lon) : [0, 0]
      const roll0 = f ? parallacticAngleDeg(ra0, dec0, f.time, f.lat, f.lon) : 0

      // Stale-container workaround shared with the other Celestial views.
      Celestial.container = null

      Celestial.display({
        width: Math.floor(rect.width),
        projectionRatio: rect.width / rect.height,
        container: 'planner-sky-view',
        datapath: '/d3-celestial-data/',
        projection: 'stereographic',
        transform: 'equatorial',
        center: [raToCelestial(ra0), dec0, roll0],
        follow: 'center',
        interactive: true,
        disableAnimations: true,
        form: false,
        controls: false,
        zoomlevel: 3,
        zoomextend: 12,
        stars: {
          show: true, limit: 6, colors: true, size: 5, exponent: -0.28,
          names: true, proper: true, desig: false, namelimit: 2,
          namestyle: {
            fill: '#ddddbb', font: '11px -apple-system, BlinkMacSystemFont, sans-serif',
            align: 'left', baseline: 'top',
          },
          propernamestyle: {
            fill: '#ddddbb', font: '11px -apple-system, BlinkMacSystemFont, sans-serif',
            align: 'right', baseline: 'bottom',
          },
          propernamelimit: 1.5,
          style: { fill: '#ffffff', opacity: 0.85 },
        },
        dsos: {
          show: true, limit: 8, colors: true, size: 6, names: true, desig: true, namelimit: 6,
          namestyle: {
            fill: '#aaaacc', font: '10px -apple-system, BlinkMacSystemFont, sans-serif',
            align: 'left', baseline: 'top',
          },
        },
        constellations: {
          names: true, lines: true, bounds: false, desig: false,
          namestyle: {
            fill: '#3d4260', font: '13px -apple-system, BlinkMacSystemFont, sans-serif',
            align: 'center', baseline: 'middle',
          },
          linestyle: { stroke: '#1e2236', width: 1.2, opacity: 0.7 },
        },
        mw: { show: true, style: { fill: '#0d1525', opacity: 0.18 } },
        lines: {
          // Off by default: the equatorial graticule reads as a star atlas,
          // not a from-the-ground view. User-toggleable via the RA/Dec grid
          // checkbox; seeded from the ref so a settings-hydration update
          // that lands before this async init resolves isn't lost to a
          // stale closure.
          graticule: { show: raDecGridVisibleRef.current },
          equatorial: { show: raDecGridVisibleRef.current },
          ecliptic: { show: false },
          galactic: { show: false },
        },
        background: { fill: '#070b14', stroke: '#1a1d27', opacity: 1, width: 1.5 },
      })

      // Remove d3-celestial's own window resize handler (same as classic view)
      // and detach its d3.behavior.zoom from the canvas: mouse input is ours
      // from here (bindPointerInput). Its dblclick handler on the container
      // stays — that is a pure zoomBy about the centre.
      const canvas = containerRef.current.querySelector('canvas')
      try {
        const d3ref = (globalThis as Record<string, unknown>)['d3'] as
          { select: (t: EventTarget) => { on: (e: string, h: null) => void } } | undefined
        d3ref?.select(globalThis).on('resize', null)
        if (canvas) d3ref?.select(canvas).on('.zoom', null)
      } catch { /* ignore */ }
      if (canvas) {
        const ac = new AbortController()
        inputRef.current = ac
        bindPointerInput(canvas, ac.signal)
      }

      // Layers registered by other views persist on the singleton — drop them.
      Celestial.clear()
      Celestial.add({
        type: 'raw',
        callback: () => { /* data flows via module state, nothing to fetch */ },
        redraw: drawOverlay,
      })

      // Async catalog loads can reset the centre; re-apply a few times.
      let count = 0
      const interval = setInterval(() => {
        // Belt and suspenders: cleanup below both clears this interval and
        // sets `cancelled`, but a tick already queued in the same
        // macrotask batch as the clear could still fire once more.
        if (cancelled) return
        pointCamera()
        if (++count >= 5) clearInterval(interval)
      }, 300)
      recenterIntervalRef.current = interval
    })

    return () => {
      cancelled = true
      inputRef.current?.abort()
      inputRef.current = null
      if (recenterIntervalRef.current !== null) {
        clearInterval(recenterIntervalRef.current)
        recenterIntervalRef.current = null
      }
    }
  }, [])

  // Resize: same debounced pattern as ClassicSkyView, preserving zoom.
  useEffect(() => {
    if (!containerRef.current) return
    let prevWidth = containerRef.current.getBoundingClientRect().width
    let resizeTimer: ReturnType<typeof setTimeout>
    let firstFire = true
    const observer = new ResizeObserver(() => {
      if (!initRef.current) return
      if (firstFire) { firstFire = false; return }
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        const el = containerRef.current
        if (!el) return
        const rect = el.getBoundingClientRect()
        const newWidth = Math.floor(rect.width)
        if (newWidth <= 0 || Math.abs(newWidth - Math.floor(prevWidth)) < 2) return
        const currentScale = Celestial.mapProjection?.scale?.() ?? null
        try {
          Celestial.resize({ width: newWidth, projectionRatio: rect.width / rect.height })
        } catch { /* ignore */ }
        if (currentScale !== null && prevWidth > 0) {
          const freshScale = Celestial.mapProjection?.scale?.() ?? 1
          const factor = (currentScale * (newWidth / prevWidth)) / freshScale
          if (Math.abs(factor - 1) > 0.001) {
            try { Celestial.zoomBy(factor) } catch { /* ignore */ }
          }
        }
        prevWidth = rect.width
        pointCamera()
      }, 250)
    })
    observer.observe(containerRef.current)
    return () => { observer.disconnect(); clearTimeout(resizeTimer) }
  }, [])

  return (
    <div className="skymap-page">
      <div ref={containerRef} id="planner-sky-view" className="skymap-container" />
      {!locationSet && (
        <div className="planner-sky-banner">
          <MapPin size={14} />
          <span>
            No observing location set — using 50°N 20°E.{' '}
            <Link to="/astroweather">Set your location</Link>
          </span>
        </div>
      )}
      <div className="skymap-header">
        <div className="skymap-title">Planner mode</div>
        <div className="skymap-controls">
          <label className="skymap-grid-toggle">
            <input
              type="checkbox"
              checked={altAzGridVisible}
              onChange={(e) => pickAltAzGrid(e.target.checked)}
            />
            Alt/Az grid
          </label>
          <label className="skymap-grid-toggle">
            <input
              type="checkbox"
              checked={raDecGridVisible}
              onChange={(e) => pickRaDecGrid(e.target.checked)}
            />
            RA/Dec grid
          </label>
          <label
            className="skymap-grid-toggle"
            title="Preview as if no custom horizon were set, without changing your saved skyline"
          >
            <input
              type="checkbox"
              checked={flatHorizonPreview}
              onChange={(e) => setFlatHorizonPreview(e.target.checked)}
            />
            Flat horizon
          </label>
          <div className="skymap-controls-separator" />
          <button
            className="skymap-btn"
            onClick={() => { try { Celestial.zoomBy(1.4) } catch { /* ignore */ } }}
            title="Zoom in"
          >
            <ZoomIn size={15} />
          </button>
          <button
            className="skymap-btn"
            onClick={() => { try { Celestial.zoomBy(0.7) } catch { /* ignore */ } }}
            title="Zoom out"
          >
            <ZoomOut size={15} />
          </button>
        </div>
      </div>
      <PlannerTimeToolbar sim={sim} timeZone={timeZone} />
      <PlannerTargetPanel rows={rows} selectedId={selectedId} onPick={focusTarget} />
    </div>
  )
}
