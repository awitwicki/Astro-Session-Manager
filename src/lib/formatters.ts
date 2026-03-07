export function formatIntegrationTime(totalSeconds: number): string {
  if (totalSeconds <= 0) return '0s'

  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = Math.round(totalSeconds % 60)

  const parts: string[] = []
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0) parts.push(`${minutes}m`)
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`)

  return parts.join(' ')
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const k = 1024
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${units[i]}`
}

export function formatTemperature(celsius: number): string {
  return `${celsius > 0 ? '+' : ''}${celsius}\u00B0C`
}

export function formatDate(isoDate: string): string {
  try {
    const date = new Date(isoDate)
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  } catch {
    return isoDate
  }
}

export function formatExposure(seconds: number): string {
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`
  if (seconds < 60) return `${seconds}s`
  return `${Math.round(seconds / 60)}m`
}

export function computeMedian(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function getPixelScale(raw?: Record<string, unknown>): number | null {
  if (!raw) return null

  const num = (key: string): number | null => {
    const v = raw[key]
    if (v == null) return null
    const n = Number(v)
    return Number.isFinite(n) && n !== 0 ? n : null
  }

  const scale = num('SCALE') ?? num('PIXSCALE') ?? num('SECPIX') ?? num('SECPIX1')
  if (scale != null) return Math.abs(scale)

  const cdelt = num('CDELT1') ?? num('CDELT2')
  if (cdelt != null) return Math.abs(cdelt) * 3600

  const focal = num('FOCALLEN') ?? num('FOCAL') ?? num('FOCUSLEN')
  const pixSize = num('XPIXSZ') ?? num('PIXSIZE1') ?? num('PIXSIZE')
  if (focal != null && pixSize != null) return 206.265 * pixSize / focal

  return null
}
