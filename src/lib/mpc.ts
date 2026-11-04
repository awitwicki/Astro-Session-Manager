// Parsers for Minor Planet Center orbit files: the comet elements file
// (Soft00Cmt.txt) and the MPCORB-format asteroid list (Soft00Bright.txt).
// Fixed-width columns; malformed lines are skipped, never thrown on.
import type { OrbitalElements } from './orbits'

export interface MinorBody {
  kind: 'comet' | 'asteroid'
  designation: string
  name: string
  elements: OrbitalElements
}

export const COMETS_URL = 'https://www.minorplanetcenter.net/iau/Ephemerides/Comets/Soft00Cmt.txt'

export function asteroidsUrl(year: number): string {
  return `https://www.minorplanetcenter.net/iau/Ephemerides/Bright/${year}/Soft00Bright.txt`
}

/** JD (UT midnight based) of a calendar date with a possibly fractional day. */
function jdFromYmd(year: number, month: number, day: number): number {
  const d = new Date(0)
  d.setUTCFullYear(year, month - 1, 1)
  d.setUTCHours(0, 0, 0, 0)
  return d.getTime() / 86400000 + 2440587.5 + (day - 1)
}

function packedDigit(c: string): number {
  if (c >= '0' && c <= '9') return Number(c)
  const code = c.charCodeAt(0)
  if (code >= 65 && code <= 86) return code - 55   // A-V → 10-31
  return NaN
}

/** Unpack an MPC packed epoch ('K25BL' → JD 2461000.5, 2025-11-21 0h). */
export function unpackEpoch(packed: string): number {
  if (packed.length !== 5) return NaN
  const century = { I: 1800, J: 1900, K: 2000 }[packed[0] as 'I' | 'J' | 'K']
  const yy = Number(packed.slice(1, 3))
  const month = packedDigit(packed[3])
  const day = packedDigit(packed[4])
  if (century === undefined || !Number.isInteger(yy) || !(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return NaN
  return jdFromYmd(century + yy, month, day)
}

const num = (line: string, from: number, to: number): number => {
  const s = line.slice(from - 1, to).trim()
  return s === '' ? NaN : Number(s)
}

const finite = (...v: number[]) => v.every(Number.isFinite)

function splitCometName(raw: string): { designation: string; name: string } | null {
  if (!raw) return null
  const paren = /^(.+?) \((.+)\)$/.exec(raw)
  if (paren) return { designation: paren[1], name: paren[2] }
  const numbered = /^(\d+[A-Z][^/\s]*)\/(.+)$/.exec(raw)
  if (numbered) return { designation: numbered[1], name: numbered[2] }
  return { designation: raw, name: raw }
}

export function parseCometLines(text: string): MinorBody[] {
  const out: MinorBody[] = []
  for (const line of text.split(/\r?\n/)) {
    if (line.length < 103) continue
    const year = num(line, 15, 18), month = num(line, 20, 21), day = num(line, 23, 29)
    const q = num(line, 31, 39), e = num(line, 41, 49)
    const peri = num(line, 51, 59), node = num(line, 61, 69), i = num(line, 71, 79)
    const H = num(line, 92, 95), G = num(line, 97, 100)
    if (!finite(year, month, day, q, e, peri, node, i, H, G)) continue
    if (month < 1 || month > 12) continue
    const split = splitCometName(line.slice(102, 158).trim())
    if (!split) continue
    out.push({
      kind: 'comet',
      ...split,
      elements: { epochJd: jdFromYmd(year, month, day), q, e, i, node, peri, H, G },
    })
  }
  return out
}

export function parseAsteroidLines(text: string): MinorBody[] {
  const out: MinorBody[] = []
  for (const line of text.split(/\r?\n/)) {
    if (line.length < 103) continue
    const H = num(line, 9, 13), G = num(line, 15, 19)
    const epochJd = unpackEpoch(line.slice(20, 25))
    const M = num(line, 27, 35), peri = num(line, 38, 46), node = num(line, 49, 57)
    const i = num(line, 60, 68), e = num(line, 71, 79), a = num(line, 93, 103)
    if (!finite(H, G, epochJd, M, peri, node, i, e, a)) continue
    const designation = line.slice(166).trim() || line.slice(0, 7).trim()
    if (!designation) continue
    const name = /^\(\d+\)\s+(.+)$/.exec(designation)?.[1] ?? designation
    out.push({
      kind: 'asteroid',
      designation,
      name,
      elements: { epochJd, q: a * (1 - e), e, i, node, peri, meanAnomalyDeg: M, H, G },
    })
  }
  return out
}
