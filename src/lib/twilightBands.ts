// Day/twilight/night shading bands for the altitude chart, derived by
// classifying sun-altitude samples. Sample-based (rather than stitching
// dawn/dusk crossing times) so polar edge cases fall out naturally.
import type { AltitudePoint } from './ephemeris'

export type BandKind = 'day' | 'civil' | 'nautical' | 'astro' | 'night'

export interface TwilightBand { startFrac: number; endFrac: number; kind: BandKind }

export function classifyTwilight(sunAlt: number): BandKind {
  if (sunAlt > 0) return 'day'
  if (sunAlt > -6) return 'civil'
  if (sunAlt > -12) return 'nautical'
  if (sunAlt > -18) return 'astro'
  return 'night'
}

/** Collapse sun-altitude samples into contiguous bands (x as 0..1 fractions). */
export function twilightBands(sunSamples: AltitudePoint[]): TwilightBand[] {
  if (sunSamples.length < 2) return []
  const n = sunSamples.length - 1
  const bands: TwilightBand[] = []
  let runStart = 0
  let runKind = classifyTwilight(sunSamples[0].alt)
  for (let i = 1; i < sunSamples.length; i++) {
    const kind = classifyTwilight(sunSamples[i].alt)
    if (kind !== runKind) {
      bands.push({ startFrac: runStart / n, endFrac: i / n, kind: runKind })
      runStart = i
      runKind = kind
    }
  }
  bands.push({ startFrac: runStart / n, endFrac: 1, kind: runKind })
  return bands
}
