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
  const resolution = resolutionOf(header)

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

const resolutionOf = (h: FitsHeader | null | undefined): string | null =>
  h?.naxis1 && h?.naxis2 ? `${h.naxis1}x${h.naxis2}` : null

/** Master darkflats for a session's flats: exposure ±0.5 s when the flat's
 *  exposure is known, resolution, and temperature within tolerance of the
 *  flat's *or* the lights' — flats are often shot before the cooler settles,
 *  and a darkflat at the lights' set point is fine for such short exposures.
 *  Closest exposure first, then closest temperature (the flat's own wins a
 *  tie). Null when the flat's header is unknown — a darkflat can't be
 *  vouched for then. */
export function matchDarkFlats(
  flatHeader: FitsHeader | null | undefined,
  lightHeader: FitsHeader | null | undefined,
  library: MastersLibrary | null,
  tempTolerance: number,
): MasterFileEntry[] | null {
  if (!library || !flatHeader) return null
  const temps = [flatHeader.ccdTemp, lightHeader?.ccdTemp].filter((t): t is number => t != null)
  if (temps.length === 0) return null
  const exptime = flatHeader.exptime ?? null
  const resolution = resolutionOf(flatHeader) ?? resolutionOf(lightHeader)
  const expDiff = (d: MasterFileEntry) => (exptime === null ? 0 : Math.abs(d.exposureTime - exptime))
  const tempDiff = (d: MasterFileEntry) => Math.min(...temps.map((t) => Math.abs(d.ccdTemp! - t)))
  return library.darkFlats
    .filter(
      (d) =>
        expDiff(d) < 0.5 &&
        d.ccdTemp !== null &&
        tempDiff(d) <= tempTolerance &&
        (resolution === null || d.resolution === null || d.resolution === resolution),
    )
    .sort(
      (a, b) =>
        expDiff(a) - expDiff(b) ||
        tempDiff(a) - tempDiff(b) ||
        Math.abs(a.ccdTemp! - temps[0]) - Math.abs(b.ccdTemp! - temps[0]),
    )
}
