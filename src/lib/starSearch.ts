// Pure in-memory search over the bundled star catalog (HYG-derived,
// public/catalogs/stars.json). No I/O here — loading lives in catalog.ts so
// this file is unit-testable (tests/web/star-search.test.mjs).

export interface StarObject {
  hip: number | null
  hd: number | null
  hr: number | null      // Harvard Revised = Yale Bright Star number
  bayer: string | null   // HYG form: "Alp", "Kap-1" (superscript after the dash)
  flam: number | null    // Flamsteed number
  proper: string | null  // IAU proper name
  variable: string | null // variable-star designation without constellation: "RR"
  ra: number             // J2000 degrees
  dec: number
  mag: number
  con: string            // constellation abbreviation, "Lyr"
}

/** Row layout written by scripts/generate-star-catalog.mjs: 0 / "" mean absent. */
export type StarRow = [
  hip: number, hd: number, hr: number, bayer: string, flam: number, proper: string,
  variable: string, ra: number, dec: number, mag: number, con: string,
]

export function decodeStarRows(rows: StarRow[]): StarObject[] {
  return rows.map(([hip, hd, hr, bayer, flam, proper, variable, ra, dec, mag, con]) => ({
    hip: hip || null,
    hd: hd || null,
    hr: hr || null,
    bayer: bayer || null,
    flam: flam || null,
    proper: proper || null,
    variable: variable || null,
    ra,
    dec,
    mag,
    con,
  }))
}

// HYG's three-letter Bayer abbreviations with their full names and letters.
const GREEK: [abbr: string, full: string, letter: string][] = [
  ['alp', 'alpha', 'α'], ['bet', 'beta', 'β'], ['gam', 'gamma', 'γ'], ['del', 'delta', 'δ'],
  ['eps', 'epsilon', 'ε'], ['zet', 'zeta', 'ζ'], ['eta', 'eta', 'η'], ['the', 'theta', 'θ'],
  ['iot', 'iota', 'ι'], ['kap', 'kappa', 'κ'], ['lam', 'lambda', 'λ'], ['mu', 'mu', 'μ'],
  ['nu', 'nu', 'ν'], ['xi', 'xi', 'ξ'], ['omi', 'omicron', 'ο'], ['pi', 'pi', 'π'],
  ['rho', 'rho', 'ρ'], ['sig', 'sigma', 'σ'], ['tau', 'tau', 'τ'], ['ups', 'upsilon', 'υ'],
  ['phi', 'phi', 'φ'], ['chi', 'chi', 'χ'], ['psi', 'psi', 'ψ'], ['ome', 'omega', 'ω'],
]
const ABBR_TO_LETTER = new Map(GREEK.map(([abbr, , letter]) => [abbr, letter]))
const LETTER_TO_ABBR = new Map(GREEK.map(([abbr, , letter]) => [letter, abbr]))
const FULL_TO_ABBR = new Map(GREEK.map(([abbr, full]) => [full, abbr]))
// Full names sorted longest-first so "omicron" wins over "omi"-prefixed nothing;
// bounded so "beta" is never read as "b" + "eta".
const FULL_NAME_RE = new RegExp(
  `(^|[^a-z])(${[...FULL_TO_ABBR.keys()].sort((a, b) => b.length - a.length).join('|')})(?![a-z])`,
  'g',
)
const SUPERSCRIPT: Record<string, string> = { '1': '¹', '2': '²', '3': '³' }
const SUPERSCRIPT_RE = /[¹²³]/g
const FROM_SUPERSCRIPT: Record<string, string> = { '¹': '1', '²': '2', '³': '3' }

/** "Kap-1" → "κ¹", "Alp" → "α". Unknown abbreviations pass through. */
function bayerLabel(bayer: string): string {
  const [abbr, sup] = bayer.toLowerCase().split('-')
  return (ABBR_TO_LETTER.get(abbr) ?? abbr) + (sup ? SUPERSCRIPT[sup] ?? sup : '')
}

/** Catalog designation used as the target id: HD first, then HIP, then HR. */
export function starDesignation(s: StarObject): string {
  if (s.hd !== null) return `HD ${s.hd}`
  if (s.hip !== null) return `HIP ${s.hip}`
  if (s.hr !== null) return `HR ${s.hr}`
  return '' // unreachable for catalog rows: the generator drops stars without any id
}

/** Display name: proper name → Greek Bayer → Flamsteed → variable → designation. */
export function starDisplayName(s: StarObject): string {
  if (s.proper) return s.proper
  if (s.bayer) return `${bayerLabel(s.bayer)} ${s.con}`
  if (s.flam !== null) return `${s.flam} ${s.con}`
  if (s.variable) return `${s.variable} ${s.con}`
  return starDesignation(s)
}

interface StarEntry {
  star: StarObject
  keys: string[]          // designation keys: "alplyr", "kap1scl", "61cyg", "rrlyr"
  name: string | null     // lower-cased proper name
  nameKey: string | null  // proper name without spaces/apostrophes
}

/** Entries are ordered brightest-first (ties by HD, then HIP number), so a
 *  scan in index order yields each score bucket already in display order. */
export interface StarIndex {
  entries: StarEntry[]
}

const KEY_STRIP_RE = /[\s\-'’]+/g

const byBrightness = (a: StarObject, b: StarObject) =>
  a.mag - b.mag
  || (a.hd ?? Infinity) - (b.hd ?? Infinity)
  || (a.hip ?? Infinity) - (b.hip ?? Infinity)

export function buildStarIndex(stars: StarObject[]): StarIndex {
  const entries = [...stars].sort(byBrightness).map((star): StarEntry => {
    const con = star.con.toLowerCase()
    const keys: string[] = []
    if (star.bayer) keys.push(star.bayer.toLowerCase().replace(/-/g, '') + con)
    if (star.flam !== null) keys.push(`${star.flam}${con}`)
    if (star.variable) keys.push(star.variable.toLowerCase() + con)
    const name = star.proper ? star.proper.toLowerCase() : null
    return { star, keys, name, nameKey: name ? name.replace(KEY_STRIP_RE, '') : null }
  })
  return { entries }
}

/** "α Lyr", "alpha Lyr", "Kappa-1 Scl", "κ¹ Scl", "HD 172167" → "alplyr",
 *  "kap1scl", "hd172167": Greek letters and full names collapse to HYG's
 *  abbreviations, superscripts to digits, spaces and hyphens disappear. */
function normalizeKey(q: string): string {
  return q
    .replace(SUPERSCRIPT_RE, (d) => FROM_SUPERSCRIPT[d])
    .replace(/[α-ω]/g, (ch) => LETTER_TO_ABBR.get(ch) ?? ch)
    .replace(FULL_NAME_RE, (_m, pre: string, full: string) => pre + FULL_TO_ABBR.get(full))
    .replace(KEY_STRIP_RE, '')
}

const NUMERIC_RE = /^(hd|hip|hr)(\d*)$/

export interface ScoredStar { star: StarObject; score: number }

/** Matching stars, best first: score 0 exact designation, 1 designation prefix
 *  (numeric prefix for HD/HIP/HR), 2 proper-name prefix, 3 substring; brighter
 *  first within a score. Each prefix/name bucket keeps only its `limit`
 *  brightest stars — enough to fill any merged list of `limit` results
 *  without sorting thousands of hits per keystroke. */
export function scoreStars(index: StarIndex, query: string, limit = 20): ScoredStar[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const qKey = normalizeKey(q)
  if (!qKey) return []
  const numeric = NUMERIC_RE.exec(qKey)
  const buckets: ScoredStar[][] = [[], [], [], []]
  for (const e of index.entries) {
    let score: number | null = null
    if (numeric) {
      const n = e.star[numeric[1] as 'hd' | 'hip' | 'hr']
      if (n !== null) {
        const digits = String(n)
        if (digits === numeric[2]) score = 0
        else if (digits.startsWith(numeric[2])) score = 1
      }
    } else {
      for (const k of e.keys) {
        if (k === qKey) { score = 0; break }
        if (k.startsWith(qKey)) score = 1
      }
      if (score === null && e.name !== null && e.nameKey !== null) {
        if (e.name.startsWith(q) || e.nameKey.startsWith(qKey)) score = 2
        else if (e.name.includes(q)) score = 3
      }
    }
    if (score !== null && (score === 0 || buckets[score].length < limit)) {
      buckets[score].push({ star: e.star, score })
    }
  }
  return buckets.flat()
}

export function searchStars(index: StarIndex, query: string, limit = 20): StarObject[] {
  return scoreStars(index, query, limit).slice(0, limit).map((r) => r.star)
}
