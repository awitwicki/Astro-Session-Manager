// Pure math for panning the Planner sky view by mouse: the sky point under
// the cursor follows it, and the look direction is kept on the near side of
// the zenith/nadir so an alt-az mount never flips over the pole.

type Vec3 = [number, number, number]
const DEG = Math.PI / 180

/** Altitude the look direction may not exceed in either direction — same
 *  idea as Stellarium's alt-az mount, which stops just short of the zenith
 *  instead of flipping the view by 180° when the centre crosses it. */
export const LOOK_ALT_LIMIT = 89

function unitVector([lon, lat]: [number, number]): Vec3 {
  const cl = Math.cos(lat * DEG)
  return [cl * Math.cos(lon * DEG), cl * Math.sin(lon * DEG), Math.sin(lat * DEG)]
}

function spherical([x, y, z]: Vec3): [number, number] {
  return [Math.atan2(y, x) / DEG, Math.asin(Math.max(-1, Math.min(1, z))) / DEG]
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/** Rodrigues rotation of v about the unit axis k by angle theta (radians). */
function rotateAbout(v: Vec3, k: Vec3, theta: number): Vec3 {
  const c = Math.cos(theta), s = Math.sin(theta)
  const kv = cross(k, v), kd = dot(k, v) * (1 - c)
  return [
    v[0] * c + kv[0] * s + k[0] * kd,
    v[1] * c + kv[1] * s + k[1] * kd,
    v[2] * c + kv[2] * s + k[2] * kd,
  ]
}

/** Where the view centre ends up after a drag that carries the sky point
 *  `from` onto `to` (all three are [lon, lat] degrees in the projection's own
 *  spherical frame): the sky rotates by the shortest rotation taking `from`
 *  to `to`, so the new centre is the old one rotated the opposite way. */
export function pannedCentre(
  centre: [number, number], from: [number, number], to: [number, number],
): [number, number] {
  const a = unitVector(from), b = unitVector(to)
  const axis = cross(a, b)
  const norm = Math.hypot(axis[0], axis[1], axis[2])
  if (norm < 1e-12) return [centre[0], centre[1]]
  const k: Vec3 = [axis[0] / norm, axis[1] / norm, axis[2] / norm]
  return spherical(rotateAbout(unitVector(centre), k, -Math.atan2(norm, dot(a, b))))
}

/** Clamps a new look direction against LOOK_ALT_LIMIT. A drag step that
 *  carried the centre over the pole shows up as a ~180° azimuth swing next
 *  to it; that step keeps the previous azimuth and sits at the limit. */
export function clampLook(prevAz: number, az: number, alt: number): { az: number; alt: number } {
  const swing = Math.abs(((az - prevAz + 540) % 360) - 180)
  if (swing > 90 && Math.abs(alt) > LOOK_ALT_LIMIT - 10) {
    return { az: prevAz, alt: alt > 0 ? LOOK_ALT_LIMIT : -LOOK_ALT_LIMIT }
  }
  return { az, alt: Math.max(-LOOK_ALT_LIMIT, Math.min(LOOK_ALT_LIMIT, alt)) }
}
