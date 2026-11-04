import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { invoke } from '@tauri-apps/api/core'
import { Compass, Grid3x3, Layers, MapPin, Mountain, Orbit, Sparkles, ZoomIn, ZoomOut } from 'lucide-react'
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
import { persistPlannerTargets, usePlannerData } from '../../hooks/usePlanner'
import { useSimTime } from '../../hooks/useSimTime'
import {
  GROUND_FILL, HORIZON_STROKE, cutAtInfinity, fillGround, fitShape, isFinitePoint,
  longestRunPolyline, projectPoints, raToCelestial, sideOf, skySideFromPoint, strokePolyline,
  visiblePolyline,
} from '../../lib/altAzView'
import { grabbedCentre } from '../../lib/skyPan'
import { takeOverSkyInput, type SkyDrag } from '../../lib/skyPointer'
import {
  PLANET_BODIES, brightMinorBodies, planetPosition, targetMagnitude, targetPosition,
} from '../../lib/movingTargets'
import { HIPS_SURVEYS, NSNS_RGB, renderHiPSTiles, setHiPSRedrawCallback, type HiPSConfig } from '../../lib/hips'
import type { SearchHit } from '../../lib/objectSearch'
import {
  targetFromDso, targetFromHit, targetFromMinorBody, targetFromPlanet, targetFromStar,
} from '../../lib/plannerTargets'
import { loadCatalog, loadStarCatalog } from '../../lib/catalog'
import type { CatalogObject } from '../../lib/catalogSearch'
import type { StarObject } from '../../lib/starSearch'
import { nearestHit, type HitCandidate } from '../../lib/skyHit'
import { useMinorBodies } from '../../hooks/useMinorBodies'
import { ObjectSearch } from '../planner/ObjectSearch'
import { trajectoryPathOf, type TrajectoryPoint } from '../../lib/trajectory'
import { nightWindowStart, formatTimeInZone } from '../../lib/localTime'
import { PlannerTargetPanel, type TargetRow } from './PlannerTargetPanel'
import { SkyObjectCard, type SkyObject } from './SkyObjectCard'
import type { PlanetBody, PlannerTarget } from '../../types/planner'
import { PlannerLayerRail } from './PlannerLayerRail'
import { PlannerTimeToolbar } from './PlannerTimeToolbar'
import { TopBarActions } from '../layout/TopBarSlot'

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

interface SkyMarker { ra: number; dec: number; name: string; selected: boolean; comet?: boolean }

/** Asteroids drawn only up to this estimated magnitude: the MPC list is
 *  "bright this year", not "bright tonight". */
const ASTEROID_MAG_LIMIT = 12
/** The comet file lists every observable comet, most far too faint to image;
 *  this keeps the handful an amateur telescope can reach. */
const COMET_MAG_LIMIT = 15
/** Minor-body positions are recomputed per 10-minute bucket of the sim time,
 *  not per frame (over a thousand propagations at 25 fps while fast-forwarding). */
const MINOR_BODY_BUCKET_MS = 600_000
const PLANETS = PLANET_BODIES.filter((b) => b !== 'Moon') // the Moon has its own disc

// Module-level: the persistent d3-celestial redraw callback must always read
// current values across React renders and remounts (same pattern as
// ClassicSkyView's activeTargets).
let frame: FrameData | null = null
let markers: SkyMarker[] = []
let trajectory: TrajectoryPoint[] | null = null
// Survey overlay, planets and minor bodies. Empty marker lists when their
// toggle is off.
let hipsOverlay: HiPSConfig | null = null
let planetMarkers: SkyMarker[] = []
let minorBodyMarkers: SkyMarker[] = []
// The look direction IS the view state — az/alt, not RA/Dec, so the ground
// stays down as time flows. Only this module ever moves it: the mouse drag
// (skyDrag), focusTarget aims at a target, and every change
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

/** Mouse drag: the alt-az point grabbed at mouse-down stays under the
 *  cursor and the horizon stays level — one rotate(), hence one full redraw,
 *  per mouse move. d3-celestial's own drag rotated the sphere freely and
 *  left the roll to a second full redraw queued from drawOverlay, which
 *  halved the frame rate and made the whole view twist visibly at every
 *  step. The grab is held in alt-az, so it stays put on the ground while
 *  the sky turns under it. */
let grabbed: [number, number] | null = null
const skyDrag: SkyDrag = {
  grab(at) {
    const f = frame
    const p = Celestial.map?.projection?.()?.invert(at) ?? null
    if (!f || !isFinitePoint(p)) { grabbed = null; return }
    const { az, alt } = equatorialToHorizon(((p[0] % 360) + 360) % 360, p[1], f.time, f.lat, f.lon)
    grabbed = [az, alt]
  },
  drag(at) {
    const proj = Celestial.map?.projection?.()
    if (!proj || !grabbed) return
    const [cx, cy] = proj.translate()
    const k = proj.scale()
    // Azimuth grows to the right on screen (facing south, west is on the
    // right) where grabbedCentre's longitude grows to the left, as RA does
    // — so it works on negated azimuths.
    const [negAz, alt] = grabbedCentre(
      [-grabbed[0], grabbed[1]], (at[0] - cx) / k, (at[1] - cy) / k, [-viewAz, viewAlt])
    viewAz = ((-negAz % 360) + 360) % 360
    viewAlt = alt
    pointCamera()
  },
}

// Catalog objects a click can pick, magnitude-filtered once when the
// catalogs arrive. Loading starts on the first press on the sky. Roughly
// what d3-celestial draws: its stars stop at 6, its DSOs at 8 on this zoom.
const CLICK_STAR_MAG_LIMIT = 6.5
const CLICK_DSO_MAG_LIMIT = 10
const CLICK_RADIUS_PX = 10
let clickDsos: CatalogObject[] | null = null
let clickStars: StarObject[] | null = null

function loadClickCatalogs(): void {
  if (!clickDsos) {
    loadCatalog().then((c) => {
      clickDsos ??= c.objects.filter((o) => o.mag !== null && o.mag <= CLICK_DSO_MAG_LIMIT)
    }).catch(() => { /* retried on the next click */ })
  }
  if (!clickStars) {
    loadStarCatalog().then((idx) => {
      if (clickStars) return
      const out: StarObject[] = []
      for (const { star } of idx.entries) { // brightest first
        if (star.mag > CLICK_STAR_MAG_LIMIT) break
        out.push(star)
      }
      clickStars = out
    }).catch(() => { /* retried on the next click */ })
  }
}

const SUN_MAG = -26.7

function skyObjectOf(t: PlannerTarget, existing: boolean, date: Date): SkyObject {
  return { name: t.name, type: t.type, mag: targetMagnitude(t, date), target: t, existingId: existing ? t.id : null }
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

/** Sky side (see fillGround) of a custom skyline, which is traced in
 *  increasing azimuth. The projection is conformal, so "up" lies on the same
 *  side of a step in increasing azimuth everywhere on screen — measured here
 *  on a tiny az/alt triangle at the view centre, where it is always
 *  well-defined. A
 *  test point like the zenith cannot be used: a skyline that climbs to 90°
 *  passes through it, and the fill would flip as the view turns. */
function skylineSkySide(f: FrameData, proj: CelestialProjection): 1 | -1 | null {
  const alt = Math.max(-80, Math.min(80, viewAlt))
  const at = (az: number, a: number) => {
    const [ra, dec] = horizonToEquatorial(az, a, f.time, f.lat, f.lon)
    return proj([raToCelestial(ra), dec]) as [number, number] | null
  }
  const base = at(viewAz, alt), next = at(viewAz + 1, alt), up = at(viewAz, alt + 1)
  if (!isFinitePoint(base) || !isFinitePoint(next) || !isFinitePoint(up)) return null
  const side = sideOf(base, next, up)
  return side === 0 ? null : side > 0 ? 1 : -1
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

  // Survey tiles first: the sky tint dims them by day and the ground fill
  // covers the part below the horizon.
  const overlay = hipsOverlay
  if (overlay) renderHiPSTiles(ctx, proj, overlay, ctx.canvas.width, ctx.canvas.height, 0.7)

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
    ? longestRunPolyline(cutAtInfinity(f.horizonPts, horizonPts, proj, cx, cy))
    : visiblePolyline(fitShape(horizonPts, viewSize, cx, cy), cx, cy, viewW, viewH)
  const zenithPt = proj([raToCelestial(f.zenith[0]), f.zenith[1]]) as [number, number] | null
  const skySide = !horizonPoly ? null
    : f.profile ? skylineSkySide(f, proj)
    : isFinitePoint(zenithPt) ? skySideFromPoint(horizonPoly, zenithPt, viewW, viewH)
    : null
  if (horizonPoly && skySide) {
    fillGround(ctx, horizonPoly, skySide, viewW, viewH)
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
  } else if (!horizonPoly) {
    // No horizon anywhere near the view: if the centre is below it, so is
    // everything on screen.
    const c = proj.invert([cx, cy])
    if (isFinitePoint(c)) {
      const { az, alt } = equatorialToHorizon((c[0] + 360) % 360, c[1], f.time, f.lat, f.lon)
      if (alt < (f.profile ? horizonAltAt(f.profile, az) : 0)) {
        ctx.fillStyle = GROUND_FILL
        ctx.fillRect(0, 0, viewW, viewH)
      }
    }
  }

  // Planets and minor bodies: above the ground only, under the target markers.
  const onScreen = (m: SkyMarker): [number, number] | null => {
    const pt = proj([raToCelestial(m.ra), m.dec]) as [number, number] | null
    if (!isFinitePoint(pt) || Math.hypot(pt[0] - cx, pt[1] - cy) > maxDist) return null
    const { alt, az } = equatorialToHorizon(m.ra, m.dec, f.time, f.lat, f.lon)
    return isAboveGroundFill(f.profile, alt, az) ? pt : null
  }
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif'
  for (const m of minorBodyMarkers) {
    const pt = onScreen(m)
    if (!pt) continue
    const color = m.comet ? '#7fe8d6' : '#e6d9ff'
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(pt[0], pt[1], m.comet ? 4 : 3, 0, Math.PI * 2)
    ctx.fill()
    if (m.comet && isFinitePoint(sunPt)) {
      const away = Math.atan2(pt[1] - sunPt[1], pt[0] - sunPt[0])
      ctx.strokeStyle = color
      ctx.lineWidth = 1.6
      ctx.beginPath()
      ctx.moveTo(pt[0], pt[1])
      ctx.lineTo(pt[0] + Math.cos(away) * 16, pt[1] + Math.sin(away) * 16)
      ctx.stroke()
    }
    ctx.fillText(m.name, pt[0] + 7, pt[1])
  }
  ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif'
  for (const m of planetMarkers) {
    const pt = onScreen(m)
    if (!pt) continue
    ctx.fillStyle = '#f3e2a0'
    ctx.beginPath()
    ctx.arc(pt[0], pt[1], 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillText(m.name, pt[0] + 7, pt[1])
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
    if (m.comet && isFinitePoint(sunPt)) {
      // Comet: a tail pointing away from the Sun
      const away = Math.atan2(pt[1] - sunPt[1], pt[0] - sunPt[0])
      ctx.moveTo(pt[0] + Math.cos(away) * 6, pt[1] + Math.sin(away) * 6)
      ctx.lineTo(pt[0] + Math.cos(away) * 20, pt[1] + Math.sin(away) * 20)
    }
    ctx.stroke()
    ctx.fillStyle = m.selected ? '#ff8844' : 'rgba(170, 190, 220, 0.85)'
    ctx.fillText(m.name, pt[0] + 9, pt[1])
  }
}

export function PlannerSkyView({ modeSwitch, focusTargetId = null }: { modeSwitch: ReactNode; focusTargetId?: string | null }) {
  const { lat, lon, locationSet, timeZone, targets, hydrated } = usePlannerData()
  const horizon = useEffectiveHorizonProfile()
  const flatHorizonPreview = useAppStore((s) => s.flatHorizonPreview)
  const setFlatHorizonPreview = useAppStore((s) => s.setFlatHorizonPreview)
  const containerRef = useRef<HTMLDivElement>(null)
  const initRef = useRef(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [altAzGridVisible, setAltAzGridVisible] = useState(true)
  const [raDecGridVisible, setRaDecGridVisible] = useState(false)
  const [hips, setHips] = useState<HiPSConfig | null>(null)
  const [showPlanets, setShowPlanets] = useState(true)
  const [showMinorBodies, setShowMinorBodies] = useState(false)
  // The clicked (or searched) object's card; `at` is relative to .skymap-page.
  const [card, setCard] = useState<{ object: SkyObject; at: [number, number] } | null>(null)
  const addPlannerTarget = useAppStore((s) => s.addPlannerTarget)
  const minorBodies = useMinorBodies()
  const { asteroids, comets } = minorBodies
  // The re-center interval is created inside the async ensureCelestialLoaded()
  // continuation below, which runs after this effect's synchronous body
  // (including its cleanup registration) has already executed — so cleanup
  // must reach it through a ref rather than a plain closed-over variable.
  const recenterIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Detaches the pointer/wheel listeners takeOverSkyInput installs on the
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
    () => targets.map((t) => {
      const { ra, dec } = targetPosition(t, time)
      return { target: t, ra, dec, ...altAzAt(ra, dec, time, lat, lon) }
    }),
    [targets, time, lat, lon],
  )

  const selected = useMemo(
    () => targets.find((t) => t.id === selectedId) ?? null,
    [targets, selectedId],
  )

  const trajectoryPts = useMemo(
    () => selected
      ? trajectoryPathOf(
          (d) => targetPosition(selected, d), nightWindowStart(time, timeZone), time, lat, lon)
      : null,
    [selected, time, timeZone, lat, lon],
  )

  const planets: SkyMarker[] = useMemo(
    () => showPlanets
      ? PLANETS.map((body) => ({ ...planetPosition(body, time), name: body, selected: false }))
      : [],
    [showPlanets, time],
  )

  const minorBucket = Math.floor(time.getTime() / MINOR_BODY_BUCKET_MS)
  const brightMinors = useMemo(() => {
    if (!showMinorBodies) return []
    const at = new Date(minorBucket * MINOR_BODY_BUCKET_MS)
    return [
      ...brightMinorBodies(asteroids, at, ASTEROID_MAG_LIMIT),
      ...brightMinorBodies(comets, at, COMET_MAG_LIMIT),
    ]
  }, [showMinorBodies, asteroids, comets, minorBucket])

  // Publish markers/trajectory to the redraw callback alongside the frame
  useEffect(() => {
    markers = rows.map(({ target, ra, dec }) => ({
      ra, dec, name: target.name, selected: target.id === selectedId,
      comet: target.mover?.kind === 'comet',
    }))
    planetMarkers = planets
    // One already in the Planner is drawn as its target marker instead.
    minorBodyMarkers = brightMinors
      .filter(({ body }) => !rows.some(({ target }) => target.id === body.designation))
      .map(({ body, ra, dec }) => ({
        ra, dec, name: body.designation, selected: false, comet: body.kind === 'comet',
      }))
    trajectory = trajectoryPts
    if (initRef.current) {
      try { Celestial.redraw() } catch { /* ignore */ }
    }
  }, [rows, selectedId, trajectoryPts, planets, brightMinors])

  useEffect(() => {
    hipsOverlay = hips
    if (initRef.current) {
      try { Celestial.redraw() } catch { /* ignore */ }
    }
  }, [hips])

  // Hydrate saved grid-visibility settings once at mount.
  useEffect(() => {
    invoke<Record<string, unknown>>('get_all_settings')
      .then((s) => {
        if (typeof s.plannerAltAzGrid === 'boolean') setAltAzGridVisible(s.plannerAltAzGrid)
        if (typeof s.plannerRaDecGrid === 'boolean') setRaDecGridVisible(s.plannerRaDecGrid)
        if (typeof s.plannerHips === 'string') setHips(HIPS_SURVEYS.find((h) => h.id === s.plannerHips) ?? null)
        if (typeof s.plannerPlanets === 'boolean') setShowPlanets(s.plannerPlanets)
        if (typeof s.plannerMinorBodies === 'boolean') setShowMinorBodies(s.plannerMinorBodies)
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

  const pickHips = (survey: HiPSConfig | null) => {
    setHips(survey)
    invoke('set_setting', { key: 'plannerHips', value: survey ? survey.id : null }).catch(() => {})
  }
  const pickPlanets = (visible: boolean) => {
    setShowPlanets(visible)
    invoke('set_setting', { key: 'plannerPlanets', value: visible }).catch(() => {})
  }
  const pickMinorBodies = (visible: boolean) => {
    setShowMinorBodies(visible)
    invoke('set_setting', { key: 'plannerMinorBodies', value: visible }).catch(() => {})
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

  /** Turns the view toward a target at the sim time. */
  const aimAt = (t: PlannerTarget) => {
    const pos = targetPosition(t, time)
    const { alt, az } = altAzAt(pos.ra, pos.dec, time, lat, lon)
    viewAz = az
    viewAlt = Math.max(alt, 15) // below the horizon: aim at its azimuth instead
    pointCamera()
  }

  const focusTarget = (t: PlannerTarget) => {
    setSelectedId(t.id)
    aimAt(t)
  }

  /** Canvas pixels → pixels relative to .skymap-page (the card's parent). */
  const toPage = (at: [number, number]): [number, number] => {
    const canvas = containerRef.current?.querySelector('canvas')
    const page = containerRef.current?.parentElement
    if (!canvas || !page) return at
    const c = canvas.getBoundingClientRect(), p = page.getBoundingClientRect()
    return [at[0] + c.left - p.left, at[1] + c.top - p.top]
  }

  /** Opens the card for `t`, showing the Planner's own copy (and selecting
   *  it) when the object already is a Planner target. */
  const openCardFor = (t: PlannerTarget, at: [number, number]) => {
    const existing = targets.find((x) => x.id === t.id)
    if (existing) setSelectedId(existing.id)
    setCard({ object: skyObjectOf(existing ?? t, !!existing, time), at })
  }

  /** A search pick: aims the view at the object, without adding it, and
   *  opens its card at the view centre. */
  const showSearchHit = (hit: SearchHit) => {
    const t = targetFromHit(hit, time)
    aimAt(t)
    const proj = Celestial.map?.projection?.()
    const centre = proj ? proj.translate() : [0, 0]
    openCardFor(t, toPage([centre[0], centre[1]]))
  }

  /** A click on the sky: the drawn object nearest the click within
   *  CLICK_RADIUS_PX gets the card; empty sky closes it. Candidates are
   *  listed Planner targets first, then Sun/Moon/planets, minor bodies, DSOs and
   *  stars, so on an exact tie of distance and magnitude the earlier wins;
   *  a catalog DSO or star that already is a Planner target is skipped in
   *  favour of the target itself (dedupe by id). The Moon and planets are
   *  not deduped: the Planner marker is geocentric J2000 while the disc is
   *  drawn topocentric of-date (~1 degree apart for the Moon), so both compete
   *  by distance and a click on the disc still finds it. */
  const pickAt = (at: [number, number]) => {
    const f = frame
    const proj = Celestial.map?.projection?.()
    if (!f || !proj) return
    loadClickCatalogs()
    const planned = new Set(targets.map((t) => t.id))
    const cands: HitCandidate<SkyObject>[] = []
    // Only objects projected within the click radius are built (and tested
    // against the ground), so the catalog scans stay cheap.
    const consider = (ra: number, dec: number, build: () => SkyObject | null, groundCheck = true) => {
      const pt = proj([raToCelestial(ra), dec]) as [number, number] | null
      if (!isFinitePoint(pt) || Math.hypot(pt[0] - at[0], pt[1] - at[1]) > CLICK_RADIUS_PX) return
      if (groundCheck) {
        const { alt, az } = equatorialToHorizon(ra, dec, f.time, f.lat, f.lon)
        if (!isAboveGroundFill(f.profile, alt, az)) return
      }
      const obj = build()
      if (obj) cands.push({ x: pt[0], y: pt[1], mag: obj.mag, item: obj })
    }
    const unplanned = (t: PlannerTarget) => planned.has(t.id) ? null : skyObjectOf(t, false, time)
    // A solar-system disc: its card shows the Planner's own copy when added.
    const disc = (t: PlannerTarget) => {
      const existing = targets.find((x) => x.id === t.id)
      return skyObjectOf(existing ?? t, !!existing, time)
    }

    // Planner target markers are drawn at any altitude.
    for (const { target, ra, dec } of rows) consider(ra, dec, () => skyObjectOf(target, true, time), false)
    consider(f.sun.raDeg, f.sun.decDeg, () => (
      { name: 'Sun', type: 'Star', mag: SUN_MAG, target: null, existingId: null }))
    consider(f.moon.raDeg, f.moon.decDeg, () => disc(targetFromPlanet('Moon', time)))
    for (const m of planets) {
      consider(m.ra, m.dec, () => disc(targetFromPlanet(m.name as PlanetBody, time)))
    }
    for (const { body, ra, dec } of brightMinors) {
      consider(ra, dec, () => unplanned(targetFromMinorBody(body, time)))
    }
    for (const o of clickDsos ?? []) consider(o.ra, o.dec, () => unplanned(targetFromDso(o, time)))
    for (const s of clickStars ?? []) consider(s.ra, s.dec, () => unplanned(targetFromStar(s, time)))

    const hit = nearestHit(at, cands, CLICK_RADIUS_PX)
    if (!hit) { setCard(null); return }
    if (hit.existingId) setSelectedId(hit.existingId)
    setCard({ object: hit, at: toPage(at) })
  }

  // The canvas listeners are installed once at init; they reach the current
  // render's pickAt through this ref.
  const pickRef = useRef<(at: [number, number]) => void>(() => {})
  useEffect(() => { pickRef.current = pickAt })

  // Esc closes the card.
  const cardOpen = card !== null
  useEffect(() => {
    if (!cardOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCard(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cardOpen])

  /** "Add to Planner" on the card: same as the Planner page's add, stamped
   *  with the real time rather than the sim time the card was built at. */
  const addFromCard = (t: PlannerTarget) => {
    if (!hydrated || targets.some((x) => x.id === t.id)) return
    const added = { ...t, addedAt: new Date().toISOString() }
    addPlannerTarget(added)
    persistPlannerTargets([...targets, added])
  }

  // The card's altitude follows the sim clock.
  const cardTarget = card?.object.target ?? null
  let cardAlt = frameData.sun.alt // the Sun: no target
  if (cardTarget) {
    const p = targetPosition(cardTarget, time)
    cardAlt = altAzAt(p.ra, p.dec, time, lat, lon).alt
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
          // toggle; seeded from the ref so a settings-hydration update
          // that lands before this async init resolves isn't lost to a
          // stale closure.
          graticule: { show: raDecGridVisibleRef.current },
          equatorial: { show: raDecGridVisibleRef.current },
          ecliptic: { show: false },
          galactic: { show: false },
        },
        background: { fill: '#070b14', stroke: '#1a1d27', opacity: 1, width: 1.5 },
      })

      // Mouse input is ours from here (skyPointer.ts): skyDrag keeps the
      // horizon level through a single rotate() per move. Any press closes
      // the object card; a click (no drag) may open a new one.
      inputRef.current = takeOverSkyInput(containerRef.current, {
        // Loading at the press lets a first click find catalog objects once
        // the catalogs are cached (the search box loads them too).
        grab: (at) => { setCard(null); loadClickCatalogs(); skyDrag.grab(at) },
        drag: skyDrag.drag,
        click: (at) => pickRef.current(at),
      })

      // Survey tiles arriving asynchronously repaint the map.
      setHiPSRedrawCallback(() => {
        try { Celestial.redraw() } catch { /* ignore */ }
      })

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
      setHiPSRedrawCallback(null)
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
      <div className="planner-sky-banners">
        {!locationSet && (
          <div className="planner-sky-banner">
            <MapPin size={14} />
            <span>
              No observing location set — using 50°N 20°E.{' '}
              <Link to="/astroweather">Set your location</Link>
            </span>
          </div>
        )}
        {showMinorBodies && minorBodies.hydrated && (asteroids.length === 0 || comets.length === 0) && (
          <div className="planner-sky-banner">
            <span>
              Comet or asteroid data missing — <Link to="/settings">download it in Settings</Link>
            </span>
          </div>
        )}
      </div>
      <TopBarActions>
        <div className="planner-sky-search">
          <ObjectSearch onSelect={showSearchHit} placeholder="Find — M31, Vega, Mars, Vesta…" />
        </div>
        {modeSwitch}
        <div className="topbar-group">
          <button
            className={`btn btn-sm ${hips ? 'btn-primary' : ''}`}
            onClick={() => pickHips(hips ? null : NSNS_RGB)}
            title="Toggle survey overlay"
          >
            <Layers size={14} />
          </button>
          {hips && (
            <select
              className="settings-input"
              style={{ width: 'auto', padding: '4px 8px', fontSize: 12 }}
              value={hips.id}
              onChange={(e) => {
                const survey = HIPS_SURVEYS.find((h) => h.id === e.target.value)
                if (survey) pickHips(survey)
              }}
            >
              {HIPS_SURVEYS.map((h) => (
                <option key={h.id} value={h.id}>{h.label}</option>
              ))}
            </select>
          )}
        </div>
        <div className="topbar-group">
          <button
            className="btn btn-sm"
            onClick={() => { try { Celestial.zoomBy(1.4) } catch { /* ignore */ } }}
            title="Zoom in"
          >
            <ZoomIn size={14} />
          </button>
          <button
            className="btn btn-sm"
            onClick={() => { try { Celestial.zoomBy(0.7) } catch { /* ignore */ } }}
            title="Zoom out"
          >
            <ZoomOut size={14} />
          </button>
        </div>
      </TopBarActions>
      <PlannerLayerRail toggles={[
        {
          id: 'altaz', icon: Compass, label: 'Alt/Az grid',
          active: altAzGridVisible, onToggle: () => pickAltAzGrid(!altAzGridVisible),
        },
        {
          id: 'radec', icon: Grid3x3, label: 'RA/Dec grid',
          active: raDecGridVisible, onToggle: () => pickRaDecGrid(!raDecGridVisible),
        },
        {
          id: 'flat', icon: Mountain, label: 'Flat horizon (preview without your saved skyline)',
          active: flatHorizonPreview, onToggle: () => setFlatHorizonPreview(!flatHorizonPreview),
        },
        {
          id: 'planets', icon: Orbit, label: 'Planets',
          active: showPlanets, onToggle: () => pickPlanets(!showPlanets),
        },
        {
          id: 'minor', icon: Sparkles,
          label: `Comets (to mag ${COMET_MAG_LIMIT}) & asteroids (to mag ${ASTEROID_MAG_LIMIT})`,
          active: showMinorBodies, onToggle: () => pickMinorBodies(!showMinorBodies),
        },
      ]} />
      <PlannerTimeToolbar sim={sim} timeZone={timeZone} lat={lat} lon={lon} />
      <PlannerTargetPanel rows={rows} selectedId={selectedId} onPick={focusTarget} />
      {card && (
        <SkyObjectCard
          object={card.object}
          alt={cardAlt}
          at={card.at}
          inPlanner={!!cardTarget && targets.some((t) => t.id === cardTarget.id)}
          onAdd={() => { if (cardTarget) addFromCard(cardTarget) }}
          onClose={() => setCard(null)}
        />
      )}
    </div>
  )
}
