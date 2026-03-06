// Minimal HEALPix utilities for HiPS tile rendering (NESTED scheme only)

const JRLL = [2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4]
const JPLL = [1, 3, 5, 7, 0, 2, 4, 6, 1, 3, 5, 7]

function deinterleave(v: number): [number, number] {
  let x = 0, y = 0
  for (let i = 0; i < 16; i++) {
    x |= ((v >> (2 * i)) & 1) << i
    y |= ((v >> (2 * i + 1)) & 1) << i
  }
  return [x, y]
}

export function nside2npix(nside: number): number {
  return 12 * nside * nside
}

/**
 * Convert NESTED pixel index to (RA, DEC) in degrees.
 * RA in [0, 360), DEC in [-90, 90].
 */
export function pix2ang_nest(nside: number, ipix: number): [number, number] {
  const npface = nside * nside
  const face = Math.floor(ipix / npface)
  const [ix, iy] = deinterleave(ipix % npface)

  const jr = JRLL[face] * nside - ix - iy - 1
  let z: number
  let nr: number
  let kshift: number

  if (jr < nside) {
    // North polar cap
    nr = jr
    z = 1 - (nr * nr) / (3 * npface)
    kshift = 0
  } else if (jr <= 3 * nside) {
    // Equatorial belt
    nr = nside
    z = ((2 * nside - jr) * 2) / (3 * nside)
    kshift = (jr - nside) & 1
  } else {
    // South polar cap
    nr = 4 * nside - jr
    z = (nr * nr) / (3 * npface) - 1
    kshift = 0
  }

  const jp_num = JPLL[face] * nr + ix - iy + 1 + kshift
  let jp = Math.floor(jp_num / 2)
  const fourNr = 4 * nr
  if (jp > fourNr) jp -= fourNr
  if (jp < 1) jp += fourNr

  const phi = ((jp - (kshift + 1) * 0.5) * Math.PI) / (2 * nr)
  const theta = Math.acos(Math.max(-1, Math.min(1, z)))

  const ra = ((phi * 180) / Math.PI + 360) % 360
  const dec = 90 - (theta * 180) / Math.PI

  return [ra, dec]
}

/**
 * Convert continuous face coordinates to (RA, Dec) in degrees.
 * Uses the exact HEALPix projection (matching healpy's xyf2loc).
 * x, y are normalized face coordinates in [0, 1].
 */
function xyf2ang(face: number, x: number, y: number): [number, number] {
  const jr = JRLL[face] - x - y // ring index in [0, 4]

  let z: number
  let nr: number

  if (jr < 1) {
    // North polar cap
    nr = jr
    z = 1 - (nr * nr) / 3
  } else if (jr <= 3) {
    // Equatorial belt
    nr = 1
    z = (2 - jr) * 2 / 3
  } else {
    // South polar cap
    nr = 4 - jr
    z = (nr * nr) / 3 - 1
  }

  if (nr < 1e-15) {
    // At the pole
    return [0, z > 0 ? 90 : -90]
  }

  let tmp = JPLL[face] * nr + x - y
  if (tmp < 0) tmp += 8
  if (tmp >= 8) tmp -= 8

  const phi = (Math.PI / 4) * tmp / nr
  const theta = Math.acos(Math.max(-1, Math.min(1, z)))

  const ra = ((phi * 180) / Math.PI + 360) % 360
  const dec = 90 - (theta * 180) / Math.PI

  return [ra, dec]
}

/**
 * Get exact 4 diamond vertices of a NESTED pixel.
 * Computes corners directly from HEALPix face coordinates.
 * Returns [S, E, N, W] — diamond vertex order.
 */
export function pix2vertices_nest(nside: number, ipix: number): [number, number][] {
  const npface = nside * nside
  const face = Math.floor(ipix / npface)
  const [ix, iy] = deinterleave(ipix % npface)

  // Corners of pixel (ix, iy) in normalized face coordinates [0, 1]
  const invNs = 1 / nside
  return [
    xyf2ang(face, ix * invNs, iy * invNs),             // S corner
    xyf2ang(face, (ix + 1) * invNs, iy * invNs),       // E corner
    xyf2ang(face, (ix + 1) * invNs, (iy + 1) * invNs), // N corner
    xyf2ang(face, ix * invNs, (iy + 1) * invNs),       // W corner
  ]
}
