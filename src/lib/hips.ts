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
const loadingTiles = new Map<string, HTMLImageElement>() // key → Image (for abort)
let redrawCallback: (() => void) | null = null
let redrawScheduled = false

// Concurrency control
const MAX_CONCURRENT = 6
let activeRequests = 0
const requestQueue: Array<{ config: HiPSConfig; order: number; ipix: number; key: string }> = []

// Track current render generation to cancel stale requests
let renderGeneration = 0

export function setHiPSRedrawCallback(cb: () => void) {
  redrawCallback = cb
}

function scheduleRedraw() {
  if (redrawScheduled) return
  redrawScheduled = true
  requestAnimationFrame(() => {
    redrawScheduled = false
    redrawCallback?.()
  })
}

export function getHiPSCacheInfo(surveyId?: string): { count: number; loading: number; failed: number } {
  if (!surveyId) {
    return { count: tileCache.size, loading: loadingTiles.size, failed: failedTiles.size }
  }
  const prefix = `${surveyId}:`
  let count = 0, loading = 0, failed = 0
  for (const key of tileCache.keys()) if (key.startsWith(prefix)) count++
  for (const key of loadingTiles.keys()) if (key.startsWith(prefix)) loading++
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
    abortByPrefix(prefix)
  } else {
    tileCache.clear()
    failedTiles.clear()
    abortAll()
  }
}

function abortByPrefix(prefix: string) {
  for (const [key, img] of loadingTiles) {
    if (key.startsWith(prefix)) {
      img.src = '' // abort the request
      loadingTiles.delete(key)
      activeRequests = Math.max(0, activeRequests - 1)
    }
  }
}

function abortAll() {
  for (const img of loadingTiles.values()) {
    img.src = '' // abort the request
  }
  loadingTiles.clear()
  activeRequests = 0
  requestQueue.length = 0
}

function tileUrl(config: HiPSConfig, order: number, ipix: number): string {
  const dir = Math.floor(ipix / 10000) * 10000
  return `${config.baseUrl}/Norder${order}/Dir${dir}/Npix${ipix}.${config.tileFormat}`
}

function processQueue() {
  while (activeRequests < MAX_CONCURRENT && requestQueue.length > 0) {
    const req = requestQueue.shift()!
    // Skip if already resolved while queued
    if (tileCache.has(req.key) || failedTiles.has(req.key) || loadingTiles.has(req.key)) continue
    startTileLoad(req.config, req.order, req.ipix, req.key)
  }
}

function startTileLoad(config: HiPSConfig, order: number, ipix: number, key: string) {
  const gen = renderGeneration
  activeRequests++
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => {
    tileCache.set(key, img)
    loadingTiles.delete(key)
    activeRequests = Math.max(0, activeRequests - 1)
    if (gen === renderGeneration) scheduleRedraw()
    processQueue()
  }
  img.onerror = () => {
    failedTiles.add(key)
    loadingTiles.delete(key)
    activeRequests = Math.max(0, activeRequests - 1)
    processQueue()
  }
  loadingTiles.set(key, img)
  img.src = tileUrl(config, order, ipix)
}

function loadTile(config: HiPSConfig, order: number, ipix: number): HTMLImageElement | null {
  const key = `${config.id}:${order}/${ipix}`

  if (tileCache.has(key)) return tileCache.get(key)!
  if (failedTiles.has(key) || loadingTiles.has(key)) return null

  // Queue the request instead of firing immediately
  requestQueue.push({ config, order, ipix, key })
  return null
}

// Find the best cached lower order that has visible tiles to use as background
function findBestCachedOrder(config: HiPSConfig, targetOrder: number): number | null {
  for (let o = targetOrder - 1; o >= 1; o--) {
    const prefix = `${config.id}:${o}/`
    for (const key of tileCache.keys()) {
      if (key.startsWith(prefix)) return o
    }
  }
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

function isQuadOnScreen(verts: [number, number][], w: number, h: number): boolean {
  for (const [px, py] of verts) {
    if (px >= 0 && px <= w && py >= 0 && py <= h) return true
  }
  // No vertex on screen — check bounding box overlap
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const [px, py] of verts) {
    if (px < minX) minX = px
    if (px > maxX) maxX = px
    if (py < minY) minY = py
    if (py > maxY) maxY = py
  }
  return maxX >= 0 && minX <= w && maxY >= 0 && minY <= h
}

// Project tile vertices and return them if the tile is visible on screen, or null to skip
function projectTile(
  nside: number,
  ipix: number,
  proj: (coords: [number, number]) => [number, number] | null,
  canvasWidth: number,
  canvasHeight: number,
  maxTileDiag: number,
): [number, number][] | null {
  const verts = pix2vertices_nest(nside, ipix)
  const projVerts: [number, number][] = []
  for (const [vra, vdec] of verts) {
    const p = proj([raToCelestial(vra), vdec])
    if (!p) return null
    projVerts.push(p)
  }
  if (projVerts.length < 4) return null

  const diag = Math.hypot(projVerts[2][0] - projVerts[0][0], projVerts[2][1] - projVerts[0][1])
  if (diag < 2 || diag > maxTileDiag) return null
  if (signedArea(projVerts) < 0) return null
  if (!isQuadOnScreen(projVerts, canvasWidth, canvasHeight)) return null

  return projVerts
}

// Render a single order's cached tiles
function renderOrder(
  ctx: CanvasRenderingContext2D,
  proj: (coords: [number, number]) => [number, number] | null,
  config: HiPSConfig,
  order: number,
  viewport: { w: number; h: number; maxDiag: number },
  queueMissing: boolean,
) {
  const nside = 1 << order
  const npix = nside2npix(nside)

  for (let ipix = 0; ipix < npix; ipix++) {
    const projVerts = projectTile(nside, ipix, proj, viewport.w, viewport.h, viewport.maxDiag)
    if (!projVerts) continue

    const img = queueMissing
      ? loadTile(config, order, ipix) // queues fetch if missing
      : getCachedTile(config, order, ipix) // cache-only, no fetch
    if (img) {
      drawTile(ctx, img, projVerts)
    }
  }
}

function getCachedTile(config: HiPSConfig, order: number, ipix: number): HTMLImageElement | null {
  const key = `${config.id}:${order}/${ipix}`
  return tileCache.get(key) ?? null
}

export function renderHiPSTiles(
  ctx: CanvasRenderingContext2D,
  proj: (coords: [number, number]) => [number, number] | null,
  config: HiPSConfig,
  canvasWidth: number,
  canvasHeight: number,
  alpha: number
) {
  // Bump generation — stale tile loads won't trigger redraws
  renderGeneration++

  // Cancel queued (not yet started) requests from previous render
  requestQueue.length = 0

  const order = chooseOrder(proj, config.maxOrder)
  const viewport = { w: canvasWidth, h: canvasHeight, maxDiag: Math.max(canvasWidth, canvasHeight) * 0.8 }

  ctx.save()
  ctx.globalAlpha = alpha

  // Pass 1: render cached lower-order tiles as low-res background (no fetching)
  const fallbackOrder = findBestCachedOrder(config, order)
  if (fallbackOrder !== null) {
    renderOrder(ctx, proj, config, fallbackOrder, viewport, false)
  }

  // Pass 2: render target-order tiles on top (fetches missing tiles)
  renderOrder(ctx, proj, config, order, viewport, true)

  // Flush queued tile requests
  processQueue()

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
