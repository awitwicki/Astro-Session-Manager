// Parsers for hand-typed equatorial coordinates (the Planner's "Coordinates"
// form). Pure functions; unit-tested in tests/web/coords.test.mjs.

/** Splits "12 34 56.7" / "12:34:56.7" into up to three components. All but the
 *  last must be integers; minutes and seconds must be below 60. */
function sexagesimal(body: string): number[] | null {
  const parts = body.trim().split(/[\s:]+/)
  if (parts.length === 0 || parts.length > 3) return null
  const nums: number[] = []
  for (let i = 0; i < parts.length; i++) {
    const last = i === parts.length - 1
    if (!(last ? /^\d+(?:\.\d+)?$/ : /^\d+$/).test(parts[i])) return null
    const v = Number(parts[i])
    if (i > 0 && v >= 60) return null
    nums.push(v)
  }
  return nums
}

/** Right ascension → J2000 degrees in [0, 360). Sexagesimal input is hours
 *  ("12 34 56.7", "12:34:56", "12h34m56s", "12h 30m"); a single number is
 *  degrees ("187.5", "187.5°", "187.5d") unless suffixed with "h" ("12.5h"). */
export function parseRA(input: string): number | null {
  const s = input.trim().toLowerCase()
  if (!s) return null
  const single = /^(\d+(?:\.\d+)?)\s*(h|d|°)?$/.exec(s)
  let deg: number
  if (single) {
    const v = Number(single[1])
    deg = single[2] === 'h' ? v * 15 : v
  } else {
    const parts = sexagesimal(s.replace(/[hms]/g, ' '))
    if (!parts) return null
    const [h, m = 0, sec = 0] = parts
    deg = (h + m / 60 + sec / 3600) * 15
  }
  return deg >= 0 && deg < 360 ? deg : null
}

/** Declination → degrees in [-90, 90]. Accepts "+41 16 08.6", "41:16:08.6",
 *  "41d16m08.6s", "41°16′08.6″", "41 30", "41.27", with an optional leading
 *  sign (+, -, or the Unicode minus). */
export function parseDec(input: string): number | null {
  let s = input.trim().toLowerCase()
  if (!s) return null
  let sign = 1
  if (/^[+\-−]/.test(s)) {
    if (s[0] !== '+') sign = -1
    s = s.slice(1).trim()
  }
  const single = /^(\d+(?:\.\d+)?)\s*(d|°)?$/.exec(s)
  let deg: number
  if (single) {
    deg = Number(single[1])
  } else {
    const parts = sexagesimal(s.replace(/[dms°′″'"]/g, ' '))
    if (!parts) return null
    const [d, m = 0, sec = 0] = parts
    deg = d + m / 60 + sec / 3600
  }
  if (deg > 90) return null
  return sign * deg || 0 // no negative zero
}
