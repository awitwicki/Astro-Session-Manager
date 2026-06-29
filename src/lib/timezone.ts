// Browser-Intl timezone helpers. Kept separate from sun.ts so the astronomy stays pure.

const FALLBACK_ZONES = [
  'UTC', 'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York',
  'America/Sao_Paulo', 'Europe/London', 'Europe/Berlin', 'Europe/Moscow', 'Africa/Johannesburg',
  'Asia/Dubai', 'Asia/Kolkata', 'Asia/Shanghai', 'Asia/Tokyo', 'Australia/Sydney', 'Pacific/Auckland',
]

/** All IANA time zones, or a small fallback list if the runtime lacks supportedValuesOf. */
export function listTimeZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
  if (typeof intl.supportedValuesOf === 'function') {
    try {
      const zones = intl.supportedValuesOf('timeZone')
      if (Array.isArray(zones) && zones.length > 0) return zones
    } catch {
      /* fall through to the fallback list */
    }
  }
  return FALLBACK_ZONES
}

/** The runtime's detected IANA time zone (e.g. "Europe/Berlin"), or "UTC". */
export function detectTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    /* return UTC fallback */
  }
  return 'UTC'
}

/** DST-aware offset in hours (east-positive) of `timeZone` at the instant `date`. */
export function tzOffsetHours(timeZone: string, date: Date): number {
  let zone = timeZone
  try {
    // Throws for an unknown zone; fall back to the detected one.
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
  } catch {
    zone = detectTimeZone()
  }
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const parts: Record<string, string> = {}
  for (const p of dtf.formatToParts(date)) parts[p.type] = p.value
  const hour = parts.hour === '24' ? 0 : Number(parts.hour)
  const asUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    hour, Number(parts.minute), Number(parts.second),
  )
  return (asUTC - date.getTime()) / 3_600_000
}
