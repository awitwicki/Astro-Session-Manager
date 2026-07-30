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

/** Fills whichever side of the horizon does NOT contain the sky point — the
 *  sky point is always above the horizon, so the other side is the ground. */
export function fillGround(
  ctx: CanvasRenderingContext2D, poly: Polyline,
  skyPt: [number, number], viewW: number, viewH: number,
): void {
  const L = Math.max(viewW, viewH) * 3
  ctx.fillStyle = GROUND_FILL
  ctx.beginPath()
  if (poly.closed) {
    tracePolyline(ctx, poly)
    const inside = pointInPolygon(skyPt, poly.pts)
    // Even-odd against a rect covering the canvas inverts the filled region.
    if (inside) ctx.rect(-viewW, -viewH, viewW * 3, viewH * 3)
    ctx.fill(inside ? 'evenodd' : 'nonzero')
    return
  }
  // Open arc: close it into a polygon by extending both ends off-screen,
  // perpendicular to the arc, on whichever side the sky point is not.
  const a = poly.pts[0], b = poly.pts[poly.pts.length - 1]
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  if (len < 1e-9) return
  const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len
  let nx = -uy, ny = ux
  if ((skyPt[0] - a[0]) * nx + (skyPt[1] - a[1]) * ny > 0) { nx = -nx; ny = -ny }
  tracePolyline(ctx, poly)
  ctx.lineTo(b[0] + nx * L, b[1] + ny * L)
  ctx.lineTo(a[0] + nx * L, a[1] + ny * L)
  ctx.closePath()
  ctx.fill()
}
