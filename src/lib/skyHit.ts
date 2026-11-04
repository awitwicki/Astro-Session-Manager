// Pure hit testing for clicks on the Planner sky view: which drawn object
// (already projected to screen pixels) a click lands on.

export interface HitCandidate<T> { x: number; y: number; mag: number | null; item: T }

/** Distances closer than this count as a tie, broken by brightness. */
const TIE_PX = 0.5

/** Lower magnitude is brighter; an unknown magnitude is dimmer than any. */
function brighter(a: number | null, b: number | null): boolean {
  if (a === null) return false
  return b === null || a < b
}

/** The candidate nearest to `at` within `radiusPx`, or null. Candidates
 *  within half a pixel of each other's distance tie, and the brighter one
 *  (lower mag, null last) wins; a full tie keeps the earlier candidate, so
 *  callers list higher-priority sources first. */
export function nearestHit<T>(
  at: [number, number], cands: HitCandidate<T>[], radiusPx = 10,
): T | null {
  let best: HitCandidate<T> | null = null
  let bestD = Infinity
  for (const c of cands) {
    const d = Math.hypot(c.x - at[0], c.y - at[1])
    if (!(d <= radiusPx)) continue
    const better = best === null
      || d < bestD - TIE_PX
      || (d < bestD + TIE_PX
        && (brighter(c.mag, best.mag) || (c.mag === best.mag && d < bestD)))
    if (better) { best = c; bestD = d }
  }
  return best ? best.item : null
}

/** Pointer travel (px) from down to up at which a press becomes a drag. */
export const CLICK_SLOP_PX = 4

/** A press released less than `thresholdPx` (Euclidean) from where it went
 *  down is a click; anything further was a drag. */
export function isClick(
  down: [number, number], up: [number, number], thresholdPx = CLICK_SLOP_PX,
): boolean {
  return Math.hypot(up[0] - down[0], up[1] - down[1]) < thresholdPx
}

/** Top-left corner for a `size` [w, h] card about a clicked point `at`,
 *  inside a `page` [W, H]: `gap` px below-right of the point, flipped to the
 *  left / above when it would cross the right / bottom edge (less `margin`),
 *  then clamped so it stays inside. */
export function placeCard(
  at: [number, number], size: [number, number], page: [number, number], gap = 12, margin = 8,
): [number, number] {
  const axis = (p: number, s: number, max: number) => {
    const v = p + gap + s > max - margin ? p - gap - s : p + gap
    return Math.max(margin, Math.min(v, max - margin - s))
  }
  return [axis(at[0], size[0], page[0]), axis(at[1], size[1], page[1])]
}
