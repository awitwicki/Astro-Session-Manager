// Pure math for dragging the sky views: the sky point grabbed at mouse-down
// stays under the cursor, while the view stays level — north up in the
// equatorial view, zenith up (ground level) in the Planner's alt-az view.

const DEG = Math.PI / 180

/** Latitude the view centre may not exceed in either direction — same idea
 *  as Stellarium, which stops just short of the pole (zenith, celestial pole)
 *  instead of flipping the view by 180° when the centre crosses it. */
export const LOOK_ALT_LIMIT = 89

/** Where to centre a level stereographic view so that the grabbed point
 *  [lon, lat] (degrees, in the view's own frame: RA/Dec or az/alt) lands at
 *  screen offset (dx, dy) from the centre, in units of the projection scale
 *  with y pointing down. Level means the pole of the frame is straight up;
 *  longitude grows to the left, as on any view of the sky from inside.
 *
 *  Solving for the centre directly from the grabbed point, instead of
 *  panning step by step and re-levelling after each step, is what keeps
 *  the point pinned: the re-level turns the view about its centre, and over
 *  a drag those small turns add up to tens of degrees of slip near a pole.
 *
 *  Of the two centres that satisfy the offset, the one nearer `prev` wins;
 *  when the offset is out of reach (the point would have to cross the pole)
 *  the centre latitude is clamped and the point trails the cursor. */
export function grabbedCentre(
  grab: [number, number], dx: number, dy: number, prev: [number, number],
): [number, number] {
  const c = 2 * Math.atan(Math.hypot(dx, dy)) // stereographic: ρ = tan(c/2)
  const bearing = Math.atan2(-dx, -dy) // from up (the pole), toward the left
  const lat = grab[1] * DEG
  // sin(lat) = sin(φ)·cos(c) + cos(φ)·sin(c)·cos(bearing) = R·sin(φ + ψ)
  const A = Math.cos(c), B = Math.sin(c) * Math.cos(bearing)
  const R = Math.hypot(A, B), psi = Math.atan2(B, A)
  const s = Math.asin(Math.max(-1, Math.min(1, Math.sin(lat) / R)))
  const wrap = (x: number) => Math.atan2(Math.sin(x), Math.cos(x))
  const limit = LOOK_ALT_LIMIT * DEG
  let phi = prev[1] * DEG
  let best = Infinity
  for (const cand of [wrap(s - psi), wrap(Math.PI - s - psi)]) {
    if (Math.abs(cand) > Math.PI / 2) continue
    const d = Math.abs(cand - prev[1] * DEG)
    if (d < best) { best = d; phi = cand }
  }
  phi = Math.max(-limit, Math.min(limit, phi))
  // Longitude offset of the grabbed point from the centre along that bearing
  const latAt = Math.asin(Math.sin(phi) * Math.cos(c) + Math.cos(phi) * Math.sin(c) * Math.cos(bearing))
  const dLon = Math.atan2(
    Math.sin(bearing) * Math.sin(c) * Math.cos(phi),
    Math.cos(c) - Math.sin(phi) * Math.sin(latAt),
  )
  const lon = wrap(grab[0] * DEG - dLon) / DEG
  return [lon, phi / DEG]
}
