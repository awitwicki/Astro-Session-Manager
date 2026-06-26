// Filter Bandpass Shift Calculator (FBSC).
//
// Narrowband interference filters blue-shift their passband as the angle of
// incidence grows. A fast telescope's steep light cone strikes the filter at
// larger angles, pushing the passband off the target emission line and lowering
// the effective transmission. This module integrates transmission across the
// aperture (weighted by annular area) to a single overall transmission, and
// exposes the data needed to draw a transmission-profile chart.
//
// Math verified against the public FBSC spreadsheet:
//   sigma = (FWHM - flatTop) / (2*sqrt(2*ln2))
//   per ray of angle θ:  shiftedCenter = center * sqrt(1 - (sinθ/n)^2)
//   flat-top Gaussian:   T = peak                              if |λ-c| <= flat/2
//                          = peak*exp(-(|λ-c|-flat/2)^2/(2σ^2))  otherwise
//   overall = Σ(area*T) / Σ(area)

export interface FilterDef {
  centerNm: number
  fwhmNm: number
  refractiveIndex: number
  flatTopNm: number
  peakTransmittance: number
}

export interface TelescopeDef {
  apertureMm: number
  focalLengthMm: number
  obstructionMm: number
}

export interface Slice {
  outerR: number
  innerR: number
  area: number
  angleRad: number
  shiftedCenterNm: number
  transmission: number
  weightedArea: number
}

export interface FbscResult {
  overall: number
  slices: Slice[]
  sigma: number
  shiftMinNm: number
  shiftMaxNm: number
}

export interface ProfilePoint {
  wavelengthNm: number
  transmission: number
}

const FWHM_TO_SIGMA = 2 * Math.sqrt(2 * Math.LN2) // ≈ 2.354820045

// σ uses (FWHM − flatTop): the flat top widens the passband above a pure
// Gaussian, so the Gaussian shoulders are derived from the remaining width.
export function gaussianSigma(fwhmNm: number, flatTopNm: number): number {
  return (fwhmNm - flatTopNm) / FWHM_TO_SIGMA
}

// Flat-top Gaussian transmission of a filter centered at `centerNm`,
// evaluated at wavelength `lambdaNm`.
export function transmissionAt(
  lambdaNm: number,
  centerNm: number,
  flatTopNm: number,
  peak: number,
  sigma: number,
): number {
  const d = Math.abs(lambdaNm - centerNm)
  const halfFlat = flatTopNm / 2
  if (d <= halfFlat) return peak
  if (sigma <= 0) return 0
  const x = d - halfFlat
  return peak * Math.exp(-(x * x) / (2 * sigma * sigma))
}

// Blue-shifted bandpass center for a ray at angle θ (radians).
export function shiftedCenter(centerNm: number, angleRad: number, n: number): number {
  const s = Math.sin(angleRad) / n
  return centerNm * Math.sqrt(Math.max(0, 1 - s * s))
}

export function computeFbsc(
  filter: FilterDef,
  scope: TelescopeDef,
  targetNm: number,
): FbscResult | null {
  const { centerNm, fwhmNm, refractiveIndex: n, flatTopNm, peakTransmittance: peak } = filter
  const { apertureMm, focalLengthMm, obstructionMm } = scope

  const values = [centerNm, fwhmNm, n, flatTopNm, peak, apertureMm, focalLengthMm, obstructionMm, targetNm]
  if (values.some((v) => !Number.isFinite(v))) return null
  if (apertureMm <= 0 || focalLengthMm <= 0 || n <= 0 || peak <= 0) return null
  if (obstructionMm < 0 || obstructionMm >= apertureMm) return null
  if (fwhmNm <= 0 || flatTopNm < 0 || flatTopNm >= fwhmNm) return null

  const sigma = gaussianSigma(fwhmNm, flatTopNm)
  const apertureR = apertureMm / 2
  const obstructionR = obstructionMm / 2

  const slices: Slice[] = []
  // 1 mm radius steps from the aperture edge inward to the obstruction edge.
  // A non-integer aperture leaves a final clamped partial slice ending at r0.
  let outerR = apertureR
  while (outerR > obstructionR + 1e-9) {
    const innerR = Math.max(obstructionR, outerR - 1)
    const rAvg = (outerR + innerR) / 2
    const area = Math.PI * (outerR * outerR - innerR * innerR)
    const angleRad = Math.atan(rAvg / focalLengthMm)
    const sc = shiftedCenter(centerNm, angleRad, n)
    const transmission = transmissionAt(targetNm, sc, flatTopNm, peak, sigma)
    slices.push({ outerR, innerR, area, angleRad, shiftedCenterNm: sc, transmission, weightedArea: area * transmission })
    outerR = innerR
  }
  if (slices.length === 0) return null

  const totalArea = slices.reduce((sum, s) => sum + s.area, 0)
  const totalWeighted = slices.reduce((sum, s) => sum + s.weightedArea, 0)
  const overall = totalArea > 0 ? totalWeighted / totalArea : 0

  // Least shift = innermost ray (obstruction edge); most shift = aperture edge.
  const shiftMinNm = shiftedCenter(centerNm, Math.atan(obstructionR / focalLengthMm), n)
  const shiftMaxNm = shiftedCenter(centerNm, Math.atan(apertureR / focalLengthMm), n)

  return { overall, slices, sigma, shiftMinNm, shiftMaxNm }
}

// Sample a filter profile across ±halfRangeNm around centerNm.
export function filterProfile(
  centerNm: number,
  flatTopNm: number,
  peak: number,
  sigma: number,
  halfRangeNm: number,
  samples: number,
): ProfilePoint[] {
  const pts: ProfilePoint[] = []
  const n = Math.max(2, samples)
  for (let i = 0; i < n; i++) {
    const wavelengthNm = centerNm - halfRangeNm + (2 * halfRangeNm * i) / (n - 1)
    pts.push({ wavelengthNm, transmission: transmissionAt(wavelengthNm, centerNm, flatTopNm, peak, sigma) })
  }
  return pts
}
