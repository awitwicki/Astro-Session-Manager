export function parseNum(s: string): number | null {
  if (s.trim() === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

// Up to 2 decimals, trailing zeros stripped, with thousands separators
// (e.g. 4.80 → "4.8", 4.00 → "4", 29970 → "29,970").
export function formatNumber(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}
