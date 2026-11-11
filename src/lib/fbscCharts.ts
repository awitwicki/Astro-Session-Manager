// Geometry of the filter calculator's three pictures, in SVG pixel units.
// Pure: the React view and the website (docs/filtercalc) only turn these
// models into markup, so both draw exactly the same thing.
//
// Mirrored for the website by `yarn sync:filtercalc`.

import {
  bandpass, parallelCurve, sweepFocalRatio,
  type CurvePoint, type FbscResult, type FilterDef, type Optics, type Ring,
} from './fbsc'

export interface Tick {
  pos: number
  label: string
}

/** Outer size and the edges of the plot area. */
export interface Box {
  w: number
  h: number
  left: number
  top: number
  right: number
  bottom: number
}

function niceStep(span: number, maxTicks: number): number {
  const raw = span / maxTicks
  const pow = Math.pow(10, Math.floor(Math.log10(raw)))
  for (const m of [1, 2, 5, 10]) if (m * pow >= raw) return m * pow
  return 10 * pow
}

function linePath(pts: [number, number][]): string {
  return pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
}

const PERCENT_TICKS = [0, 0.2, 0.4, 0.6, 0.8, 1]

// ─── Band chart: transmission against wavelength ────────────────────────────

export interface BandChart {
  box: Box
  xTicks: Tick[]
  yTicks: Tick[]
  /** The filter as sold: parallel beam. */
  parallel: string
  /** What the camera gets through the whole aperture. */
  effective: string
  effectiveArea: string
  /** Running sum of the aperture from the centre outwards, without the last
   *  step (that one is `effective`). */
  contributions: string[]
  targetX: number
}

const BAND_BOX: Box = { w: 720, h: 310, left: 46, top: 24, right: 706, bottom: 272 }
const BAND_SAMPLES = 240
const CONTRIBUTION_STEPS = 8

export function bandChart(f: FilterDef, r: FbscResult, targetNm: number): BandChart {
  const box = BAND_BOX
  const pad = Math.max(1.3 * f.fwhmNm, 3)
  const minNm = Math.floor(Math.min(f.centerNm - r.shiftMaxNm, targetNm) - pad)
  const maxNm = Math.ceil(Math.max(f.centerNm, targetNm) + pad)
  const sx = (nm: number) => box.left + ((nm - minNm) / (maxNm - minNm)) * (box.right - box.left)
  const sy = (t: number) => box.bottom - t * (box.bottom - box.top)
  const toPath = (pts: CurvePoint[]) => linePath(pts.map((p) => [sx(p.nm), sy(p.t)]))

  // One pass over the rings gives every running sum.
  const perStep = r.rings.length / CONTRIBUTION_STEPS
  const sums: CurvePoint[][] = Array.from({ length: CONTRIBUTION_STEPS }, () => [])
  for (let i = 0; i < BAND_SAMPLES; i++) {
    const nm = minNm + ((maxNm - minNm) * i) / (BAND_SAMPLES - 1)
    let acc = 0
    r.rings.forEach((ring: Ring, k: number) => {
      acc += ring.weight * bandpass(nm, f.centerNm * ring.factor, f)
      if ((k + 1) % perStep === 0) sums[(k + 1) / perStep - 1].push({ nm, t: acc })
    })
  }
  const effective = toPath(sums[CONTRIBUTION_STEPS - 1])

  const step = niceStep(maxNm - minNm, 10)
  const xTicks: Tick[] = []
  for (let nm = Math.ceil(minNm / step) * step; nm <= maxNm + 1e-9; nm += step) {
    xTicks.push({ pos: sx(nm), label: String(Math.round(nm * 10) / 10) })
  }

  return {
    box,
    xTicks,
    yTicks: PERCENT_TICKS.map((t) => ({ pos: sy(t), label: String(Math.round(t * 100)) })),
    parallel: toPath(parallelCurve(f, minNm, maxNm, BAND_SAMPLES)),
    effective,
    effectiveArea: `${effective} L${box.right.toFixed(1)},${box.bottom} L${box.left},${box.bottom} Z`,
    contributions: sums.slice(0, -1).map(toPath),
    targetX: sx(targetNm),
  }
}

// ─── Aperture view: which part of the mirror or lens still delivers ─────────

export interface ApertureRing {
  /** Mid radius and stroke width of the ring, px. */
  r: number
  width: number
  /** Transmission of this zone at the target line, 0..1. */
  t: number
  color: string
}

export interface ApertureView {
  size: number
  center: number
  outerR: number
  obstructionR: number
  rings: ApertureRing[]
}

const APERTURE_SIZE = 220
const APERTURE_R = 100
const APERTURE_ZONES = 24

/** Red (blocked) through amber to green (full transmission); `frac` is 0..1. */
export function transmissionColor(frac: number): string {
  const stops = [[196, 64, 64], [217, 164, 65], [45, 138, 78]]
  const x = Math.min(1, Math.max(0, frac)) * 2
  const i = x >= 1 ? 1 : 0
  const k = x - i
  const c = stops[i].map((v, j) => Math.round(v + (stops[i + 1][j] - v) * k))
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`
}

export function apertureView(f: FilterDef, r: FbscResult, targetNm: number): ApertureView {
  const perZone = r.rings.length / APERTURE_ZONES
  const rings: ApertureRing[] = []
  for (let z = 0; z < APERTURE_ZONES; z++) {
    const part = r.rings.slice(z * perZone, (z + 1) * perZone)
    const weight = part.reduce((s, ring) => s + ring.weight, 0)
    const t = part.reduce((s, ring) => s + ring.weight * bandpass(targetNm, f.centerNm * ring.factor, f), 0) / weight
    const rhoIn = part[0].rhoIn
    const rhoOut = part[part.length - 1].rhoOut
    rings.push({
      r: ((rhoIn + rhoOut) / 2) * APERTURE_R,
      // A hair of overlap hides the seams between neighbouring strokes.
      width: (rhoOut - rhoIn) * APERTURE_R + 0.6,
      t,
      color: transmissionColor(t / f.peak),
    })
  }
  return {
    size: APERTURE_SIZE,
    center: APERTURE_SIZE / 2,
    outerR: APERTURE_R,
    obstructionR: r.rings[0].rhoIn * APERTURE_R,
    rings,
  }
}

// ─── Sweep chart: the same filter on faster and slower telescopes ───────────

export interface SweepChart {
  box: Box
  xTicks: Tick[]
  yTicks: Tick[]
  line: string
  area: string
  marker: { x: number; y: number }
}

const SWEEP_BOX: Box = { w: 460, h: 220, left: 46, top: 14, right: 446, bottom: 182 }
const SWEEP_STEPS = 80
const SWEEP_MIN = 1.6

export function sweepChart(
  f: FilterDef, optics: Optics, targetNm: number, atTarget: number,
): SweepChart {
  const { fRatio, obstruction } = optics
  const box = SWEEP_BOX
  const fMax = Math.min(20, Math.max(7, Math.ceil(fRatio) + 1))
  const fMin = Math.min(SWEEP_MIN, Math.max(0.8, Math.floor(fRatio * 5) / 5 - 0.2))
  const sx = (v: number) => box.left + ((v - fMin) / (fMax - fMin)) * (box.right - box.left)
  const sy = (t: number) => box.bottom - t * (box.bottom - box.top)

  const pts = sweepFocalRatio(f, obstruction, targetNm, fMin, fMax, SWEEP_STEPS)
  const line = linePath(pts.map((p) => [sx(p.fRatio), sy(p.t)]))

  const step = niceStep(fMax - fMin, 8)
  const xTicks: Tick[] = []
  for (let v = Math.ceil(fMin / step) * step; v <= fMax + 1e-9; v += step) {
    xTicks.push({ pos: sx(v), label: `f/${Math.round(v * 10) / 10}` })
  }

  return {
    box,
    xTicks,
    yTicks: PERCENT_TICKS.map((t) => ({ pos: sy(t), label: String(Math.round(t * 100)) })),
    line,
    area: `${line} L${box.right.toFixed(1)},${box.bottom} L${box.left},${box.bottom} Z`,
    marker: { x: sx(fRatio), y: sy(atTarget) },
  }
}
