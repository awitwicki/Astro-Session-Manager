// Relative integration-time factors per Bortle class, normalized to Bortle 2
// (broadband = 1.0). Broadband suffers most from light pollution; 3 nm
// narrowband is far more resilient. `sqm` is the representative sky
// brightness (mag/arcsec²) for the class, used as interpolation anchors for
// SQM-mode conversions.

export interface BortleFactors {
  broadband: number
  ha: number
  oiii: number
}

export interface BortleRow extends BortleFactors {
  bortle: number
  sqm: number
}

export const BORTLE_ROWS: BortleRow[] = [
  { bortle: 1, sqm: 22.0, broadband: 0.8, ha: 1.0, oiii: 1.0 },
  { bortle: 2, sqm: 21.94, broadband: 1.0, ha: 1.0, oiii: 1.0 },
  { bortle: 3, sqm: 21.79, broadband: 1.5, ha: 1.0, oiii: 1.1 },
  { bortle: 4, sqm: 21.09, broadband: 2.3, ha: 1.1, oiii: 1.3 },
  { bortle: 5, sqm: 20.0, broadband: 4.8, ha: 1.2, oiii: 1.8 },
  { bortle: 6, sqm: 19.22, broadband: 11, ha: 1.6, oiii: 3.0 },
  { bortle: 7, sqm: 18.66, broadband: 17, ha: 1.9, oiii: 4.3 },
  { bortle: 8, sqm: 18.0, broadband: 30, ha: 2.6, oiii: 6.8 },
]

export function factorsAtBortle(bortle: number): BortleFactors | null {
  const row = BORTLE_ROWS.find((r) => r.bortle === bortle)
  if (!row) return null
  return { broadband: row.broadband, ha: row.ha, oiii: row.oiii }
}

// Factors span roughly an exponential range (0.8 → 30), so interpolate
// log-linearly between the class anchors; clamped outside [B8, B1].
export function factorsAtSqm(sqm: number): BortleFactors {
  const first = BORTLE_ROWS[0]
  const last = BORTLE_ROWS[BORTLE_ROWS.length - 1]
  if (sqm >= first.sqm) return factorsAtBortle(first.bortle)!
  if (sqm <= last.sqm) return factorsAtBortle(last.bortle)!
  let hi = first
  for (const lo of BORTLE_ROWS.slice(1)) {
    if (sqm >= lo.sqm) {
      const t = (hi.sqm - sqm) / (hi.sqm - lo.sqm)
      const interp = (a: number, b: number) => Math.exp(Math.log(a) + t * (Math.log(b) - Math.log(a)))
      return {
        broadband: interp(hi.broadband, lo.broadband),
        ha: interp(hi.ha, lo.ha),
        oiii: interp(hi.oiii, lo.oiii),
      }
    }
    hi = lo
  }
  return factorsAtBortle(last.bortle)!
}

export function nearestBortleForSqm(sqm: number): number {
  let best = BORTLE_ROWS[0]
  for (const row of BORTLE_ROWS) {
    if (Math.abs(row.sqm - sqm) < Math.abs(best.sqm - sqm)) best = row
  }
  return best.bortle
}

// Multiply a base integration time by these per-channel ratios to get the
// equivalent time under the target sky.
export function timeRatio(from: BortleFactors, to: BortleFactors): BortleFactors {
  return {
    broadband: to.broadband / from.broadband,
    ha: to.ha / from.ha,
    oiii: to.oiii / from.oiii,
  }
}
