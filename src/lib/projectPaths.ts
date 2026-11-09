const trimSeparators = (p: string) => p.replace(/[\\/]+$/, '')

/** True when `path` is `dir` or lies under it. Matches only at a separator,
 *  so `/lib/M31` does not contain `/lib/M31 Andromeda/…`. */
export function isWithin(path: string, dir: string): boolean {
  const d = trimSeparators(dir)
  if (path === d || trimSeparators(path) === d) return true
  return path.startsWith(d) && (path[d.length] === '/' || path[d.length] === '\\')
}

/** The project whose folder holds `path` — the deepest one, should project
 *  folders ever nest. */
export function projectForPath<T extends { path: string }>(projects: T[], path: string): T | undefined {
  let best: T | undefined
  for (const p of projects) {
    if (isWithin(path, p.path) && (!best || p.path.length > best.path.length)) best = p
  }
  return best
}
