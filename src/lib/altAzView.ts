// Screen-space geometry for alt-az sky views drawn over d3-celestial's
// stereographic projection. Extracted verbatim from the former
// DetailSkyChart component: every curve we draw is a circle on the sphere,
// which stereographic projection maps to a circle or (edge-on) a line.

// d3-celestial expects RA in -180..180
export function raToCelestial(raDeg: number): number {
  return raDeg > 180 ? raDeg - 360 : raDeg
}

export function isFinitePoint(p: [number, number] | null): p is [number, number] {
  return !!p && isFinite(p[0]) && isFinite(p[1])
}

export const GROUND_FILL = 'rgba(18, 14, 10, 0.88)'
export const HORIZON_STROKE = 'rgba(255, 160, 80, 0.8)'

// Any great circle seen edge-on — an azimuth line through the view centre, or
// the horizon when the target sits on it — fits a circle of near-infinite
// radius, where the circumcircle solve loses all precision. Past this many
// view-sizes we switch to a tangent line instead; at that radius the true
// curve departs from its tangent by well under a pixel across the whole
// viewport, so the swap is invisible. (Rasterisation cost is handled
// separately, by clipping every curve to its visible arc before drawing.)
export const MAX_CIRCLE_RADIUS_FACTOR = 200

export interface CircleShape { kind: 'circle'; cx: number; cy: number; r: number }
export interface LineShape { kind: 'line'; px: number; py: number; ux: number; uy: number }
export type Shape = CircleShape | LineShape | null

// Exact circumcircle through 3 points; null if they're exactly collinear.
export function circleFrom3(p1: [number, number], p2: [number, number], p3: [number, number]) {
  const [ax, ay] = p1, [bx, by] = p2, [cx, cy] = p3
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
  if (d === 0 || !isFinite(d)) return null
  const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy
  const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d
  const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d
  return { cx: ux, cy: uy, r: Math.hypot(ux - ax, uy - ay) }
}

// Projects a loop of RA/Dec points. proj() never returns null for far points
// (clipAngle only affects d3.geo.path's stream-based rendering, not direct
// projection calls) — it just returns ever-larger coordinates — so the
// usable neighbourhood is enforced as an explicit distance bound.
export function projectPoints(
  raDecPts: [number, number][], proj: CelestialProjection,
  cx: number, cy: number, maxDist: number,
): ([number, number] | null)[] {
  return raDecPts.map(([ra, dec]) => {
    const pt = proj([raToCelestial(ra), dec]) as [number, number] | null
    if (!isFinitePoint(pt)) return null
    return Math.hypot(pt[0] - cx, pt[1] - cy) <= maxDist ? pt : null
  })
}

/** Breaks a projected loop wherever it runs out through the projection's
 *  point at infinity between two samples — the antipode of the view centre,
 *  which a custom skyline can pass close to. Both samples may still sit
 *  within reach, on opposite sides of the screen, and the straight segment
 *  joining them would then cut across the view (and flip the ground fill
 *  along it). Such a pair is caught by projecting the midpoint of the two
 *  samples on the sphere: on a real arc it lands near the chord's midpoint,
 *  but here it lands far out beyond one end. The farther sample of the pair
 *  is dropped, leaving an open run for longestRunPolyline. */
export function cutAtInfinity(
  raDecPts: [number, number][], pts: ([number, number] | null)[], proj: CelestialProjection,
  cx: number, cy: number,
): ([number, number] | null)[] {
  const out = pts.slice()
  const n = pts.length
  const DEG = Math.PI / 180
  const unit = ([ra, dec]: [number, number]) => [
    Math.cos(dec * DEG) * Math.cos(ra * DEG), Math.cos(dec * DEG) * Math.sin(ra * DEG), Math.sin(dec * DEG),
  ]
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const a = pts[i], b = pts[j]
    if (!a || !b) continue
    const u = unit(raDecPts[i]), v = unit(raDecPts[j])
    const x = u[0] + v[0], y = u[1] + v[1], z = u[2] + v[2]
    const r = Math.hypot(x, y, z)
    let broken = r < 1e-12
    if (!broken) {
      const mid = proj([raToCelestial(((Math.atan2(y, x) / DEG) + 360) % 360), Math.asin(z / r) / DEG]) as
        [number, number] | null
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      broken = !isFinitePoint(mid)
        || Math.hypot(mid[0] - (a[0] + b[0]) / 2, mid[1] - (a[1] + b[1]) / 2) > Math.max(len, 1)
    }
    if (broken) {
      const far = Math.hypot(a[0] - cx, a[1] - cy) > Math.hypot(b[0] - cx, b[1] - cy) ? i : j
      out[far] = null
    }
  }
  return out
}

/** Fits projected points to the circle (or line) they lie on. Every curve we
 *  draw is a circle on the sphere, and stereographic projection maps those to
 *  circles — or to straight lines in the edge-on case. A fitted line is
 *  anchored at its closest point to (cx, cy) so that drawing a fixed length
 *  either side of the anchor always covers the visible area — the sample
 *  points themselves can sit several view-sizes off-screen. */
export function fitShape(
  pts: ([number, number] | null)[], viewSize: number, cx: number, cy: number,
): Shape {
  const n = pts.length
  // Valid points form one contiguous run, which can wrap across the seam at
  // index 0 — find its true span so fit points are genuinely spread out.
  let runStart = -1, runLen = 0
  for (let i = 0; i < n; i++) {
    if (pts[i] && !pts[(i - 1 + n) % n]) {
      let len = 0
      while (len < n && pts[(i + len) % n]) len++
      if (len > runLen) { runLen = len; runStart = i }
    }
  }
  if (runLen === 0 && pts[0]) { runStart = 0; runLen = n } // no seam: all valid
  if (runLen < 2) return null

  const at = (k: number) => pts[(runStart + k) % n]!
  const p1 = at(0), p2 = at(Math.floor(runLen / 2)), p3 = at(runLen - 1)

  if (runLen >= 3) {
    const c = circleFrom3(p1, p2, p3)
    if (c && isFinite(c.r) && c.r < viewSize * MAX_CIRCLE_RADIUS_FACTOR) {
      return { kind: 'circle', cx: c.cx, cy: c.cy, r: c.r }
    }
  }
  // Tangent at the sample nearest the view centre. A chord between the two
  // extreme samples would be wrong here: they can sit thousands of pixels
  // apart, and even a very large circle sags away from such a long chord by
  // tens of pixels near the middle — which is precisely the region on screen.
  let mi = 0, best = Infinity
  for (let k = 0; k < runLen; k++) {
    const p = at(k)
    const d = Math.hypot(p[0] - cx, p[1] - cy)
    if (d < best) { best = d; mi = k }
  }
  const a = at(Math.max(0, mi - 1)), b = at(Math.min(runLen - 1, mi + 1))
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  if (len < 1e-9) return null
  const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len
  const m = at(mi)
  const foot = (cx - m[0]) * ux + (cy - m[1]) * uy
  return { kind: 'line', px: m[0] + ux * foot, py: m[1] + uy * foot, ux, uy }
}

/** The longest run of consecutive on-screen points, as a polyline. Used for a
 *  custom skyline, which is not a circle and so cannot be fitted as one. */
export function longestRunPolyline(pts: ([number, number] | null)[]): Polyline | null {
  const n = pts.length
  let runStart = -1
  let runLen = 0
  for (let i = 0; i < n; i++) {
    if (pts[i] && !pts[(i - 1 + n) % n]) {
      let len = 0
      while (len < n && pts[(i + len) % n]) len++
      if (len > runLen) { runLen = len; runStart = i }
    }
  }
  if (runLen === 0 && pts[0]) { runStart = 0; runLen = n }
  if (runLen < 2) return null
  const out: [number, number][] = []
  for (let k = 0; k < runLen; k++) out.push(pts[(runStart + k) % n]!)
  return { pts: out, closed: runLen === n }
}

export interface Polyline { pts: [number, number][]; closed: boolean }

export const ARC_SEGMENTS = 64

/** Converts a fitted shape into just the piece of it that can actually be
 *  seen, as a short polyline. Canvas cannot be handed these curves directly:
 *  ctx.arc() with a radius in the hundreds of thousands of pixels hangs the
 *  renderer even though almost all of it is off-screen, because the whole
 *  circle still gets flattened. Clipping to the visible arc first bounds the
 *  work to a fixed number of segments no matter how extreme the geometry. */
export function visiblePolyline(
  shape: Shape, cx: number, cy: number, viewW: number, viewH: number,
): Polyline | null {
  if (!shape) return null
  const viewR = Math.hypot(viewW, viewH) / 2 * 1.05 // circle covering the canvas
  if (shape.kind === 'line') {
    const L = viewR * 1.2
    return {
      pts: [
        [shape.px - shape.ux * L, shape.py - shape.uy * L],
        [shape.px + shape.ux * L, shape.py + shape.uy * L],
      ],
      closed: false,
    }
  }
  const { cx: Cx, cy: Cy, r } = shape
  const d = Math.hypot(cx - Cx, cy - Cy)
  const pts: [number, number][] = []
  if (d + r <= viewR) { // whole circle on screen
    for (let i = 0; i < ARC_SEGMENTS; i++) {
      const th = (i / ARC_SEGMENTS) * Math.PI * 2
      pts.push([Cx + r * Math.cos(th), Cy + r * Math.sin(th)])
    }
    return { pts, closed: true }
  }
  if (d === 0 || Math.abs(d - r) > viewR) return null // nothing visible
  const cosA = (d * d + r * r - viewR * viewR) / (2 * d * r)
  if (cosA >= 1) return null
  const alpha = cosA <= -1 ? Math.PI : Math.acos(cosA)
  const th0 = Math.atan2(cy - Cy, cx - Cx)
  for (let i = 0; i <= ARC_SEGMENTS; i++) {
    const th = th0 - alpha + (2 * alpha * i) / ARC_SEGMENTS
    pts.push([Cx + r * Math.cos(th), Cy + r * Math.sin(th)])
  }
  return { pts, closed: false }
}

export function tracePolyline(ctx: CanvasRenderingContext2D, poly: Polyline): void {
  poly.pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1])))
  if (poly.closed) ctx.closePath()
}

export function strokePolyline(ctx: CanvasRenderingContext2D, poly: Polyline | null): void {
  if (!poly) return
  ctx.beginPath()
  tracePolyline(ctx, poly)
  ctx.stroke()
}

// Standard ray-casting point-in-polygon test.
export function pointInPolygon(pt: [number, number], poly: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > pt[1] !== yj > pt[1]
      && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Which side of the directed segment a→b the point p lies on: +1 or -1
 *  (0 when collinear). On a canvas (y down), +1 is to the right of a→b. */
export function sideOf(a: [number, number], b: [number, number], p: [number, number]): number {
  return Math.sign((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]))
}

/** A point just off the polyline, on the given sideOf() side of its segment
 *  nearest (cx, cy) — the part of the line the user is looking at. Deciding
 *  a fill by containment of this point stays right where it matters even
 *  when the closed-up loop crosses itself somewhere far off-screen, which
 *  makes any whole-loop measure such as its winding unreliable. */
export function sideProbe(
  poly: Polyline, cx: number, cy: number, side: 1 | -1,
): [number, number] | null {
  const { pts } = poly
  const n = poly.closed ? pts.length : pts.length - 1
  let best: [number, number] | null = null, bestD = Infinity
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (len < 1e-9) continue
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2
    const d = Math.hypot(mx - cx, my - cy)
    if (d >= bestD) continue
    // (-uy, ux) is on the sideOf() = +1 side of a→b.
    const eps = Math.min(0.5, len / 4)
    bestD = d
    best = [mx - side * eps * (b[1] - a[1]) / len, my + side * eps * (b[0] - a[0]) / len]
  }
  return best
}

/** Closes an open horizon polyline into a loop: both ends are pushed
 *  radially out from the view centre onto a circle enclosing every point of
 *  the line, and joined along that circle — round in the direction of
 *  increasing screen angle for dir = +1, decreasing for -1. The two choices
 *  split the disc into the regions on either side of the line. (Joining the
 *  ends by their chord instead goes wrong once the visible part of the
 *  horizon curls through more than a half-turn: the stretch between curve
 *  and chord then lands on the wrong side.) */
export function closeAround(
  poly: Polyline, cx: number, cy: number, viewSize: number, dir: 1 | -1,
): [number, number][] {
  let reach = viewSize
  for (const [x, y] of poly.pts) reach = Math.max(reach, Math.hypot(x - cx, y - cy))
  const R = reach * 1.25
  const a = poly.pts[0], b = poly.pts[poly.pts.length - 1]
  const angA = Math.atan2(a[1] - cy, a[0] - cx), angB = Math.atan2(b[1] - cy, b[0] - cx)
  const on = (th: number): [number, number] => [cx + R * Math.cos(th), cy + R * Math.sin(th)]
  const span = (((angA - angB) * dir) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI)
  const steps = Math.max(1, Math.ceil(span / (Math.PI / 32)))
  const loop: [number, number][] = [on(angA), ...poly.pts]
  for (let i = 0; i <= steps; i++) loop.push(on(angB + dir * span * (i / steps)))
  return loop
}

/** Sky side (see fillGround) of a horizon polyline, from a point known to be
 *  in the sky. Only sound when that point is well clear of the line — true
 *  of the zenith for the flat 0° horizon, not for a custom skyline, which
 *  can climb to the zenith and put it on (or across) the line. A point
 *  beyond the closing circle (the zenith, when looking near the nadir) is
 *  pulled in along its direction, where it still lands on the sky's side. */
export function skySideFromPoint(
  poly: Polyline, skyPt: [number, number], viewW: number, viewH: number,
): 1 | -1 | null {
  const cx = viewW / 2, cy = viewH / 2
  let loop = poly.pts
  let pt = skyPt
  if (!poly.closed) {
    loop = closeAround(poly, cx, cy, Math.max(viewW, viewH), 1)
    let reach = 0
    for (const [x, y] of loop) reach = Math.max(reach, Math.hypot(x - cx, y - cy))
    const d = Math.hypot(skyPt[0] - cx, skyPt[1] - cy)
    if (d > reach * 0.99) {
      const k = (reach * 0.99) / d
      pt = [cx + (skyPt[0] - cx) * k, cy + (skyPt[1] - cy) * k]
    }
  }
  const plus = sideProbe(poly, cx, cy, 1)
  if (!plus) return null
  // The sky point and the +1 side are in the same region iff the sky is +1.
  return pointInPolygon(pt, loop) === pointInPolygon(plus, loop) ? 1 : -1
}

/** Fills the ground side of a horizon polyline. `skySide` is the sideOf()
 *  sign of the sky relative to the line in its traversal order. A closed
 *  line fills its interior or exterior; an open one is closed round the
 *  view (closeAround) in whichever direction takes in the ground. */
export function fillGround(
  ctx: CanvasRenderingContext2D, poly: Polyline,
  skySide: 1 | -1, viewW: number, viewH: number,
): void {
  const cx = viewW / 2, cy = viewH / 2
  const ground = sideProbe(poly, cx, cy, skySide === 1 ? -1 : 1)
  if (!ground) return
  ctx.fillStyle = GROUND_FILL
  ctx.beginPath()
  if (poly.closed) {
    tracePolyline(ctx, poly)
    // Even-odd against a rect covering the canvas inverts the filled region.
    if (!pointInPolygon(ground, poly.pts)) ctx.rect(-viewW, -viewH, viewW * 3, viewH * 3)
    ctx.fill('evenodd')
    return
  }
  const viewSize = Math.max(viewW, viewH)
  let loop = closeAround(poly, cx, cy, viewSize, 1)
  if (!pointInPolygon(ground, loop)) loop = closeAround(poly, cx, cy, viewSize, -1)
  tracePolyline(ctx, { pts: loop, closed: true })
  // Even-odd is what pointInPolygon's ray casting tests.
  ctx.fill('evenodd')
}
