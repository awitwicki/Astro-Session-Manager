import type { FitsHeader, MasterFileEntry, MastersLibrary } from '../types'

/** A master flat stacked into a session's flats folder, e.g. `masterFlat_Ha.xisf`. */
export function isMasterFlat(filename: string): boolean {
  return filename.toLowerCase().startsWith('masterflat')
}

export interface MasterMatchResult {
  /** Matching master darks, closest temperature first. */
  darks: MasterFileEntry[]
  /** Matching master biases, closest temperature first. */
  biases: MasterFileEntry[]
}

/** Masters Library entries that calibrate lights with this header: darks by
 *  exposure (±0.5 s), temperature and resolution; biases by temperature. */
export function matchMasters(
  header: FitsHeader | null | undefined,
  library: MastersLibrary | null,
  tempTolerance: number,
): MasterMatchResult | null {
  if (!header || !library) return null
  const exptime = header.exptime ?? 0
  const ccdTemp = header.ccdTemp ?? null
  if (exptime === 0 || ccdTemp === null) return null
  const resolution = header.naxis1 && header.naxis2 ? `${header.naxis1}x${header.naxis2}` : null

  const tempOk = (m: MasterFileEntry) => m.ccdTemp !== null && Math.abs(m.ccdTemp - ccdTemp) <= tempTolerance
  const byTemp = (a: MasterFileEntry, b: MasterFileEntry) =>
    Math.abs(a.ccdTemp! - ccdTemp) - Math.abs(b.ccdTemp! - ccdTemp)

  const darks = library.darks
    .filter(
      (d) =>
        Math.abs(d.exposureTime - exptime) < 0.5 &&
        tempOk(d) &&
        (resolution === null || d.resolution === null || d.resolution === resolution),
    )
    .sort(byTemp)
  const biases = library.biases.filter(tempOk).sort(byTemp)
  return { darks, biases }
}
