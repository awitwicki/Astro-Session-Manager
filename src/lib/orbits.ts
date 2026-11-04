// Comet and asteroid positions from osculating orbital elements.
//
// Accuracy limits: pure two-body Keplerian motion about the Sun — no
// planetary perturbations and no light-time correction, so positions drift
// as the elements age (typically arcminutes within a year or two of the
// epoch, worse for bodies passing close to Jupiter or Earth). Times are
// treated as TT ≈ UTC (the ~70 s difference is negligible here).
import { Body, HelioVector } from 'astronomy-engine'

// Orbital elements of a comet or asteroid. Angles in degrees, J2000
// ecliptic; distances in AU.
export interface OrbitalElements {
  epochJd: number          // epoch of the elements (asteroids) / of perihelion T (comets)
  q: number                // perihelion distance, AU
  e: number
  i: number; node: number; peri: number   // degrees, J2000 ecliptic
  meanAnomalyDeg?: number  // asteroids only, at epochJd
  H: number; G: number     // absolute magnitude + slope (asteroid) / H10-style (comet)
}

const K = 0.01720209895            // Gaussian gravitational constant, rad/day (√μ, AU³/day²)
const OBLIQUITY = 23.4392911 * Math.PI / 180
const DEG = Math.PI / 180
const TWO_PI = 2 * Math.PI

export function jdFromDate(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5
}

/** Eccentric anomaly E (rad) solving M = E − e sin E, for 0 ≤ e < 1. */
export function solveKepler(e: number, meanAnomaly: number): number {
  const M = meanAnomaly - TWO_PI * Math.floor(meanAnomaly / TWO_PI)
  let E = e < 0.8 ? M : Math.PI
  for (let k = 0; k < 100; k++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E))
    E -= dE
    if (Math.abs(dE) < 1e-14) break
  }
  return E
}

// Stumpff functions C(z), S(z), with series near z = 0 to avoid cancellation.
function stumpffC(z: number): number {
  if (Math.abs(z) < 1e-3) return 1 / 2 - z / 24 + z * z / 720 - z * z * z / 40320
  if (z > 0) return (1 - Math.cos(Math.sqrt(z))) / z
  return (Math.cosh(Math.sqrt(-z)) - 1) / -z
}
function stumpffS(z: number): number {
  if (Math.abs(z) < 1e-3) return 1 / 6 - z / 120 + z * z / 5040 - z * z * z / 362880
  if (z > 0) { const s = Math.sqrt(z); return (s - Math.sin(s)) / (s * s * s) }
  const s = Math.sqrt(-z); return (Math.sinh(s) - s) / (s * s * s)
}

/** Orbit-plane position dt days after perihelion, by the universal-variable
 *  Kepler equation √μ·dt = e χ³ S(αχ²) + q χ (α = 1/a = (1−e)/q). One
 *  formula for ellipse, parabola (where it reduces to Barker's equation) and
 *  hyperbola, with no loss of precision as e → 1. */
function fromPerihelion(q: number, e: number, dt: number): { nu: number; r: number } {
  const alpha = (1 - e) / q
  if (alpha > 0) {
    // Ellipse: fold dt into one period so χ stays bounded.
    const period = TWO_PI / (K * alpha ** 1.5)
    dt -= period * Math.round(dt / period)
  }
  const target = K * Math.abs(dt)
  const F = (x: number) => { const z = alpha * x * x; return e * x * x * x * stumpffS(z) + q * x - target }
  const dF = (x: number) => { const z = alpha * x * x; return x * x * stumpffC(z) + q * (1 - z * stumpffC(z)) }
  // F is increasing (F' = r > 0) with F(0) ≤ 0 and F(target/q) ≥ 0: bracketed Newton.
  let lo = 0, hi = target / q
  let x = Math.min(hi, Math.cbrt(6 * target / Math.max(e, 1e-12)))
  for (let k = 0; k < 200; k++) {
    const f = F(x)
    if (f > 0) hi = x; else lo = x
    let next = x - f / dF(x)
    if (!(next > lo && next < hi)) next = (lo + hi) / 2
    if (Math.abs(next - x) <= 1e-15 * Math.max(1, Math.abs(x))) { x = next; break }
    x = next
  }
  const z = alpha * x * x
  const f = 1 - x * x * stumpffC(z) / q
  const g = Math.abs(dt) - x * x * x * stumpffS(z) / K
  const v0 = K * Math.sqrt((1 + e) / q)      // speed at perihelion
  const px = f * q, py = g * v0 * Math.sign(dt || 1)
  return { nu: Math.atan2(py, px), r: Math.hypot(px, py) }
}

/** True anomaly (rad) and heliocentric distance (AU) at jd. Asteroids
 *  (with meanAnomalyDeg) use the classical Kepler equation; comets propagate
 *  from perihelion time with the universal variable, valid for any e. */
export function trueAnomalyAt(el: OrbitalElements, jd: number): { nu: number; r: number } {
  if (el.meanAnomalyDeg !== undefined && el.e < 1) {
    const a = el.q / (1 - el.e)
    const n = K / a ** 1.5
    const E = solveKepler(el.e, el.meanAnomalyDeg * DEG + n * (jd - el.epochJd))
    const nu = 2 * Math.atan2(Math.sqrt(1 + el.e) * Math.sin(E / 2), Math.sqrt(1 - el.e) * Math.cos(E / 2))
    return { nu, r: a * (1 - el.e * Math.cos(E)) }
  }
  return fromPerihelion(el.q, el.e, jd - el.epochJd)
}

/** Heliocentric position, J2000 ecliptic, AU. */
export function heliocentricEcliptic(el: OrbitalElements, jd: number): [number, number, number] {
  const { nu, r } = trueAnomalyAt(el, jd)
  const u = el.peri * DEG + nu
  const O = el.node * DEG, i = el.i * DEG
  const cu = Math.cos(u), su = Math.sin(u), cO = Math.cos(O), sO = Math.sin(O)
  return [
    r * (cO * cu - sO * su * Math.cos(i)),
    r * (sO * cu + cO * su * Math.cos(i)),
    r * su * Math.sin(i),
  ]
}

/** Geocentric J2000 RA/Dec (degrees), distances (AU) and Sun–body–Earth
 *  phase angle (degrees). Geometric: no light-time or aberration. */
export function geocentricEquatorial(
  el: OrbitalElements, date: Date,
): { ra: number; dec: number; deltaAu: number; rAu: number; phaseDeg: number } {
  const [x, ye, ze] = heliocentricEcliptic(el, jdFromDate(date))
  const ce = Math.cos(OBLIQUITY), se = Math.sin(OBLIQUITY)
  const y = ye * ce - ze * se, z = ye * se + ze * ce
  const earth = HelioVector(Body.Earth, date)   // J2000 equatorial (EQJ)
  const gx = x - earth.x, gy = y - earth.y, gz = z - earth.z
  const rAu = Math.hypot(x, y, z)
  const deltaAu = Math.hypot(gx, gy, gz)
  const R = Math.hypot(earth.x, earth.y, earth.z)
  const cosPhase = (rAu * rAu + deltaAu * deltaAu - R * R) / (2 * rAu * deltaAu)
  let ra = Math.atan2(gy, gx) / DEG
  if (ra < 0) ra += 360
  return {
    ra,
    dec: Math.asin(gz / deltaAu) / DEG,
    deltaAu,
    rAu,
    phaseDeg: Math.acos(Math.max(-1, Math.min(1, cosPhase))) / DEG,
  }
}

/** IAU H-G magnitude system. */
export function asteroidMagnitude(H: number, G: number, rAu: number, deltaAu: number, phaseDeg: number): number {
  const t = Math.tan(phaseDeg * DEG / 2)
  const phi1 = Math.exp(-3.33 * t ** 0.63)
  const phi2 = Math.exp(-1.87 * t ** 1.22)
  return H + 5 * Math.log10(rAu * deltaAu) - 2.5 * Math.log10((1 - G) * phi1 + G * phi2)
}

/** Total comet magnitude m = H + 5 log Δ + 2.5 G log r (MPC M1/K1 with K1 = 2.5 G). */
export function cometMagnitude(H: number, G: number, rAu: number, deltaAu: number): number {
  return H + 5 * Math.log10(deltaAu) + 2.5 * G * Math.log10(rAu)
}
