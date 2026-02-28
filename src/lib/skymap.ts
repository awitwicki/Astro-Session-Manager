import type { Project } from '../types'

export interface TargetCoordinates {
  ra: number       // Right Ascension in degrees (0-360)
  dec: number      // Declination in degrees (-90 to +90)
  fovWidth: number   // Field of view width in degrees
  fovHeight: number  // Field of view height in degrees
  rotation: number   // Rotation angle in degrees
}

export interface SkyMapTarget {
  projectName: string
  objectName: string
  coordinates: TargetCoordinates
  filters: string[]
  totalFrames: number
  totalIntegration: number
}

// Parse "HH MM SS.ss" or "HH:MM:SS.ss" to degrees
function parseHMS(hms: string): number | null {
  const cleaned = hms.trim().replace(/[hms°'"]/g, ' ')
  const parts = cleaned.split(/[\s:]+/).map(Number)
  if (parts.length < 1 || parts.some(isNaN)) return null
  const hours = (parts[0] || 0) + (parts[1] || 0) / 60 + (parts[2] || 0) / 3600
  return hours * 15 // hours to degrees
}

// Parse "±DD MM SS.s" or "±DD:MM:SS.s" to degrees
function parseDMS(dms: string): number | null {
  const trimmed = dms.trim()
  const sign = trimmed.startsWith('-') ? -1 : 1
  const cleaned = trimmed.replace(/^[+-]/, '').replace(/[°'"]/g, ' ')
  const parts = cleaned.split(/[\s:]+/).map(Number)
  if (parts.length < 1 || parts.some(isNaN)) return null
  return sign * ((parts[0] || 0) + (parts[1] || 0) / 60 + (parts[2] || 0) / 3600)
}

function getRawNum(raw: Record<string, string | number | boolean>, ...keys: string[]): number | null {
  for (const key of keys) {
    const val = raw[key]
    if (val !== undefined && val !== null) {
      const num = typeof val === 'number' ? val : Number(val)
      if (!isNaN(num)) return num
    }
  }
  return null
}

function getRawStr(raw: Record<string, string | number | boolean>, ...keys: string[]): string | null {
  for (const key of keys) {
    const val = raw[key]
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      return String(val).trim()
    }
  }
  return null
}

const DEG_PER_RAD = 180 / Math.PI
const DEFAULT_FOV = 1.5 // degrees, fallback when we can't compute FOV

function extractCoordinates(
  raw: Record<string, string | number | boolean>,
  naxis1: number,
  naxis2: number
): TargetCoordinates | null {
  let ra: number | null = null
  let dec: number | null = null
  let fovWidth = DEFAULT_FOV
  let fovHeight = DEFAULT_FOV
  let rotation = 0

  // Strategy 1: WCS keywords (most accurate)
  const crval1 = getRawNum(raw, 'CRVAL1')
  const crval2 = getRawNum(raw, 'CRVAL2')
  const cdelt1 = getRawNum(raw, 'CDELT1')
  const cdelt2 = getRawNum(raw, 'CDELT2')

  if (crval1 !== null && crval2 !== null) {
    ra = crval1
    dec = crval2
    if (cdelt1 !== null && cdelt2 !== null) {
      fovWidth = Math.abs(cdelt1) * naxis1
      fovHeight = Math.abs(cdelt2) * naxis2
    }
    rotation = getRawNum(raw, 'CROTA2', 'CROTA1') ?? 0
  }

  // Strategy 2: OBJCTRA/OBJCTDEC (sexagesimal strings from capture software)
  if (ra === null) {
    const objRaStr = getRawStr(raw, 'OBJCTRA')
    const objDecStr = getRawStr(raw, 'OBJCTDEC')
    if (objRaStr && objDecStr) {
      ra = parseHMS(objRaStr)
      dec = parseDMS(objDecStr)
    }
  }

  // Strategy 3: RA/DEC as numeric degrees
  if (ra === null) {
    ra = getRawNum(raw, 'RA', 'RA_DEG', 'TELRA')
    dec = getRawNum(raw, 'DEC', 'DEC_DEG', 'TELDEC')
  }

  if (ra === null || dec === null) return null

  // Normalize RA to 0-360
  ra = ((ra % 360) + 360) % 360

  // Compute FOV from focal length + pixel size if we don't have CDELT
  if (fovWidth === DEFAULT_FOV) {
    const focalLen = getRawNum(raw, 'FOCALLEN', 'FOCAL', 'FOCALLENGTH')
    const pixSizeX = getRawNum(raw, 'XPIXSZ', 'PIXSIZE1', 'PIXSCALE')
    const pixSizeY = getRawNum(raw, 'YPIXSZ', 'PIXSIZE2')

    if (focalLen && focalLen > 0 && pixSizeX && pixSizeX > 0) {
      // pixel size in microns, focal length in mm
      fovWidth = (naxis1 * pixSizeX) / (focalLen * 1000) * DEG_PER_RAD
      fovHeight = (naxis2 * (pixSizeY ?? pixSizeX)) / (focalLen * 1000) * DEG_PER_RAD
    }
  }

  return { ra, dec, fovWidth, fovHeight, rotation }
}

export function extractSkyMapTargets(projects: Project[]): SkyMapTarget[] {
  const groups = new Map<string, {
    projectName: string
    objectName: string
    coords: TargetCoordinates
    filters: Set<string>
    totalFrames: number
    totalIntegration: number
  }>()

  for (const project of projects) {
    for (const filter of project.filters) {
      for (const session of filter.sessions) {
        // Find first light with valid coordinates
        let coords: TargetCoordinates | null = null
        let objectName = ''

        for (const light of session.lights) {
          if (!light.header) continue

          // Skip calibration frames (darks, flats, biases)
          const imgType = (light.header.imagetyp ?? '').toUpperCase()
          if (imgType.includes('DARK') || imgType.includes('FLAT') || imgType.includes('BIAS') || imgType.includes('OFFSET')) continue

          const raw = light.header.raw
          if (!raw) continue

          coords = extractCoordinates(raw, light.header.naxis1, light.header.naxis2)
          objectName = light.header.object ?? ''
          if (coords) break
        }

        if (!coords) continue

        const key = `${project.name}::${objectName || project.name}`

        const existing = groups.get(key)
        if (existing) {
          if (filter.name) existing.filters.add(filter.name)
          existing.totalFrames += session.lights.length
          existing.totalIntegration += session.integrationSeconds
        } else {
          const filters = new Set<string>()
          if (filter.name) filters.add(filter.name)
          groups.set(key, {
            projectName: project.name,
            objectName: objectName || project.name,
            coords,
            filters,
            totalFrames: session.lights.length,
            totalIntegration: session.integrationSeconds,
          })
        }
      }
    }
  }

  return Array.from(groups.values()).map((g) => ({
    projectName: g.projectName,
    objectName: g.objectName,
    coordinates: g.coords,
    filters: Array.from(g.filters),
    totalFrames: g.totalFrames,
    totalIntegration: g.totalIntegration,
  }))
}

// Convert RA from 0-360 to d3-celestial's -180 to +180 range
function raToCelestial(raDeg: number): number {
  return raDeg > 180 ? raDeg - 360 : raDeg
}

/** Inverse gnomonic: tangent-plane (xi, eta) in radians -> [RA, Dec] in degrees.
 *  Handles poles correctly unlike flat-sky dRA/cos(Dec) approximation. */
function inverseGnomonic(
  xiRad: number, etaRad: number,
  ra0Deg: number, dec0Deg: number
): [number, number] {
  const ra0Rad = (ra0Deg * Math.PI) / 180
  const dec0Rad = (dec0Deg * Math.PI) / 180
  const sinDec0 = Math.sin(dec0Rad)
  const cosDec0 = Math.cos(dec0Rad)
  const rho = Math.sqrt(xiRad * xiRad + etaRad * etaRad)
  if (rho < 1e-10) return [ra0Deg, dec0Deg]
  const c = Math.atan(rho)
  const sinC = Math.sin(c)
  const cosC = Math.cos(c)
  const dec = Math.asin(cosC * sinDec0 + etaRad * sinC * cosDec0 / rho) * (180 / Math.PI)
  const ra = (ra0Rad + Math.atan2(xiRad * sinC, rho * cosDec0 * cosC - etaRad * sinDec0 * sinC)) * (180 / Math.PI)
  return [ra, dec]
}

export function fovToPolygonCoords(target: SkyMapTarget): [number, number][] {
  const { ra, dec, fovWidth, fovHeight, rotation } = target.coordinates

  // Convert half-FOV to gnomonic tangent-plane offsets (degrees).
  // tan(angle) is the correct offset on the tangent plane.
  const halfW = Math.tan((fovWidth / 2) * Math.PI / 180) * (180 / Math.PI)
  const halfH = Math.tan((fovHeight / 2) * Math.PI / 180) * (180 / Math.PI)

  const paRad = (rotation ?? 0) * Math.PI / 180
  const offsets: [number, number][] = [
    [-halfW, -halfH],
    [halfW, -halfH],
    [halfW, halfH],
    [-halfW, halfH],
  ]

  // Apply rotation on the tangent plane, then inverse-gnomonic to sphere
  const corners: [number, number][] = offsets.map(([dxi, deta]) => {
    const xi  =  dxi * Math.cos(paRad) + deta * Math.sin(paRad)
    const eta = -dxi * Math.sin(paRad) + deta * Math.cos(paRad)
    const xiRad = (xi * Math.PI) / 180
    const etaRad = (eta * Math.PI) / 180
    const [cornerRA, cornerDec] = inverseGnomonic(xiRad, etaRad, ra, dec)
    return [raToCelestial(cornerRA), cornerDec] as [number, number]
  })

  corners.push(corners[0]) // close polygon
  return corners
}

export function computeInitialCenter(targets: SkyMapTarget[]): [number, number, number] {
  if (targets.length === 0) return [0, 0, 0]

  // Use circular mean for RA to handle wrapping around 0/360
  let sinSum = 0, cosSum = 0, decSum = 0
  for (const t of targets) {
    const raRad = t.coordinates.ra * Math.PI / 180
    sinSum += Math.sin(raRad)
    cosSum += Math.cos(raRad)
    decSum += t.coordinates.dec
  }
  let avgRaRad = Math.atan2(sinSum, cosSum)
  if (avgRaRad < 0) avgRaRad += 2 * Math.PI
  const avgRa = avgRaRad * 180 / Math.PI
  const avgDec = decSum / targets.length

  return [raToCelestial(avgRa), avgDec, 0]
}

const FILTER_COLORS: Record<string, string> = {
  'HA': '#ff4444',
  'H-ALPHA': '#ff4444',
  'HALPHA': '#ff4444',
  'OIII': '#44ddaa',
  'O3': '#44ddaa',
  'SII': '#ff8844',
  'S2': '#ff8844',
  'L': '#8888cc',
  'LUM': '#8888cc',
  'LUMINANCE': '#8888cc',
  'R': '#ff6666',
  'RED': '#ff6666',
  'G': '#66cc66',
  'GREEN': '#66cc66',
  'B': '#6688ff',
  'BLUE': '#6688ff',
}
const DEFAULT_COLOR = '#5b9bd5'

export function getTargetColor(filters: string[]): string {
  for (const f of filters) {
    const upper = f.toUpperCase().trim()
    if (FILTER_COLORS[upper]) return FILTER_COLORS[upper]
  }
  return DEFAULT_COLOR
}

export function getTargetFillColor(filters: string[]): string {
  const hex = getTargetColor(filters)
  // Convert hex to rgba with low opacity
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, 0.12)`
}

export function formatIntegration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}
