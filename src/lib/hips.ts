// HiPS (Hierarchical Progressive Surveys) tile loader and canvas renderer

import { nside2npix, pix2vertices_nest } from './healpix'

export interface HiPSConfig {
  id: string
  label: string
  baseUrl: string
  maxOrder: number
  tileFormat: 'png' | 'jpg'
}

export const NSNS_RGB: HiPSConfig = {
  id: 'nsns-dr02-rgb',
  label: 'NSNS DR0.2 RGB',
  baseUrl: 'https://www.simg.de/nebulae3/dr0_2/rgb8',
  maxOrder: 5,
  tileFormat: 'png',
}

export const NSNS_OHS: HiPSConfig = {
  id: 'nsns-dr02-ohs',
  label: 'NSNS DR0.2 OHS',
  baseUrl: 'https://www.simg.de/nebulae3/dr0_2/ohs8',
  maxOrder: 6,
  tileFormat: 'png',
}

export const NSNS_HA: HiPSConfig = {
  id: 'nsns-dr02-ha',
  label: 'NSNS DR0.2 H-alpha',
  baseUrl: 'https://www.simg.de/nebulae3/dr0_2/halpha8',
  maxOrder: 6,
  tileFormat: 'png',
}

const tileCache = new Map<string, HTMLImageElement>()
const failedTiles = new Set<string>()
const loadingTiles = new Set<string>()
let redrawCallback: (() => void) | null = null

export function setHiPSRedrawCallback(cb: () => void) {
  redrawCallback = cb
}

export function getHiPSCacheInfo(surveyId?: string): { count: number; loading: number; failed: number } {
  if (!surveyId) {
    return { count: tileCache.size, loading: loadingTiles.size, failed: failedTiles.size }
  }
  const prefix = `${surveyId}:`
  let count = 0, loading = 0, failed = 0
  for (const key of tileCache.keys()) if (key.startsWith(prefix)) count++
  for (const key of loadingTiles) if (key.startsWith(prefix)) loading++
  for (const key of failedTiles) if (key.startsWith(prefix)) failed++
  return { count, loading, failed }
}

function deleteByPrefix(map: Map<string, unknown> | Set<string>, prefix: string) {
  for (const key of map.keys()) {
    if (key.startsWith(prefix)) map.delete(key)
  }
}

export function clearHiPSCache(surveyId?: string) {
  if (surveyId) {
    const prefix = `${surveyId}:`
    deleteByPrefix(tileCache, prefix)
    deleteByPrefix(failedTiles, prefix)
    deleteByPrefix(loadingTiles, prefix)
  } else {
    tileCache.clear()
    failedTiles.clear()
    loadingTiles.clear()
  }
}

function tileUrl(config: HiPSConfig, order: number, ipix: number): string {
  const dir = Math.floor(ipix / 10000) * 10000
  return `${config.baseUrl}/Norder${order}/Dir${dir}/Npix${ipix}.${config.tileFormat}`
}

function loadTile(config: HiPSConfig, order: number, ipix: number): HTMLImageElement | null {
  const key = `${config.id}:${order}/${ipix}`

  if (tileCache.has(key)) return tileCache.get(key)!
  if (failedTiles.has(key) || loadingTiles.has(key)) return null

  loadingTiles.add(key)
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => {
    tileCache.set(key, img)
    loadingTiles.delete(key)
    redrawCallback?.()
  }
  img.onerror = () => {
    failedTiles.add(key)
    loadingTiles.delete(key)
  }
  img.src = tileUrl(config, order, ipix)
  return null
}

// Convert RA (0-360) to d3-celestial longitude (-180 to +180)
function raToCelestial(ra: number): number {
  return ra > 180 ? ra - 360 : ra
}

// Compute signed area of a projected quad to detect back-facing tiles
function signedArea(verts: [number, number][]): number {
  const [S, E, N, W] = verts
  return 0.5 * (
    (S[0] * E[1] - E[0] * S[1]) +
    (E[0] * N[1] - N[0] * E[1]) +
    (N[0] * W[1] - W[0] * N[1]) +
    (W[0] * S[1] - S[0] * W[1])
  )
}

// Choose HEALPix order based on zoom: estimate degrees-per-pixel from projection
function chooseOrder(
  proj: (coords: [number, number]) => [number, number] | null,
  maxOrder: number
): number {
  // Project two points 1° apart near the center to estimate scale
  const p0 = proj([0, 0])
  const p1 = proj([1, 0])
  if (!p0 || !p1) return 1
  const pxPerDeg = Math.hypot(p1[0] - p0[0], p1[1] - p0[1])
  // Tile angular size ≈ 58° / 2^order (from HEALPix geometry)
  // We want each tile to be roughly 128-256 px on screen
  // tilePx ≈ (58 / 2^order) * pxPerDeg → order ≈ log2(58 * pxPerDeg / targetPx)
  const targetPx = 200
  const order = Math.floor(Math.log2(58 * pxPerDeg / targetPx))
  return Math.max(1, Math.min(order, maxOrder, 4))
}

export function renderHiPSTiles(
  ctx: CanvasRenderingContext2D,
  proj: (coords: [number, number]) => [number, number] | null,
  config: HiPSConfig,
  canvasWidth: number,
  canvasHeight: number,
  alpha: number
) {
  const order = chooseOrder(proj, config.maxOrder)
  const nside = 1 << order
  const npix = nside2npix(nside)
  // Max plausible tile diagonal — tiles larger than this are wrap-around artifacts
  const maxTileDiag = Math.max(canvasWidth, canvasHeight) * 0.8

  ctx.save()
  ctx.globalAlpha = alpha

  for (let ipix = 0; ipix < npix; ipix++) {

    // Get diamond vertices [S, E, N, W] and project them
    const verts = pix2vertices_nest(nside, ipix)
    const projVerts: [number, number][] = []
    let allValid = true
    for (const [vra, vdec] of verts) {
      const p = proj([raToCelestial(vra), vdec])
      if (!p) { allValid = false; break }
      projVerts.push(p)
    }
    if (!allValid || projVerts.length < 4) continue

    // Skip degenerate diamonds
    const dx = projVerts[2][0] - projVerts[0][0]
    const dy = projVerts[2][1] - projVerts[0][1]
    const diag = Math.sqrt(dx * dx + dy * dy)
    if (diag < 2) continue

    // Back-face culling: skip tiles on the far side of the sphere
    // Front-facing tiles have positive signed area in screen coords (y-down)
    if (signedArea(projVerts) < 0) continue

    // Skip tiles that are too large (wrap-around artifacts on back side)
    if (diag > maxTileDiag) continue

    // Skip tiles fully outside the canvas (check if any vertex is on screen)
    let anyOnScreen = false
    for (const [px, py] of projVerts) {
      if (px >= 0 && px <= canvasWidth && py >= 0 && py <= canvasHeight) {
        anyOnScreen = true
        break
      }
    }
    // Also check if the tile's bounding box overlaps the canvas
    if (!anyOnScreen) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
      for (const [px, py] of projVerts) {
        if (px < minX) minX = px
        if (px > maxX) maxX = px
        if (py < minY) minY = py
        if (py > maxY) maxY = py
      }
      if (maxX < 0 || minX > canvasWidth || maxY < 0 || minY > canvasHeight) continue
    }

    const img = loadTile(config, order, ipix)
    if (!img) continue

    drawTile(ctx, img, projVerts)
  }

  ctx.restore()
}

/**
 * Draw a HiPS tile onto the canvas.
 * verts = [S, E, N, W] — the 4 diamond vertices projected to canvas coords.
 *
 * Image mapping (mirrored): (0,0)→S, (w,0)→W, (0,h)→E, (w,h)→N
 *
 * A single affine transform can only map 3 corners exactly. On a curved
 * projection the 4th corner diverges, producing triangular gaps.
 * Fix: split the diamond into two triangles, each with its own affine.
 */
function drawTile(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  verts: [number, number][] // [S, E, N, W]
) {
  const w = img.width
  const h = img.height
  if (w === 0 || h === 0) return

  const [S, E, N, W] = verts

  // Expand vertices slightly outward from center to hide sub-pixel seams
  const mx = (S[0] + E[0] + N[0] + W[0]) / 4
  const my = (S[1] + E[1] + N[1] + W[1]) / 4
  const PAD = 1.5
  function expand(v: [number, number]): [number, number] {
    const dx = v[0] - mx, dy = v[1] - my
    const len = Math.hypot(dx, dy)
    if (len < 0.01) return v
    return [v[0] + (dx / len) * PAD, v[1] + (dy / len) * PAD]
  }
  const Se = expand(S), Ee = expand(E), Ne = expand(N), We = expand(W)

  // Triangle 1: S-E-N  (lower-left image triangle)
  // Affine: (0,0)→S, (0,h)→E, (w,h)→N
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(Se[0], Se[1])
  ctx.lineTo(Ee[0], Ee[1])
  ctx.lineTo(Ne[0], Ne[1])
  ctx.closePath()
  ctx.clip()
  ctx.transform(
    (N[0] - E[0]) / w, (N[1] - E[1]) / w,
    (E[0] - S[0]) / h, (E[1] - S[1]) / h,
    S[0], S[1],
  )
  ctx.drawImage(img, 0, 0)
  ctx.restore()

  // Triangle 2: S-N-W  (upper-right image triangle)
  // Affine: (0,0)→S, (w,0)→W, (w,h)→N
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(Se[0], Se[1])
  ctx.lineTo(Ne[0], Ne[1])
  ctx.lineTo(We[0], We[1])
  ctx.closePath()
  ctx.clip()
  ctx.transform(
    (W[0] - S[0]) / w, (W[1] - S[1]) / w,
    (N[0] - W[0]) / h, (N[1] - W[1]) / h,
    S[0], S[1],
  )
  ctx.drawImage(img, 0, 0)
  ctx.restore()
}
