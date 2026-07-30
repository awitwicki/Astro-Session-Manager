import { useEffect, useRef, useState } from 'react'

const TICK_MS = 40
// Publish threshold for realtime (|rate| <= 1): ~3.8 arcmin of sky motion —
// imperceptible at whole-constellation zoom, so realtime does not re-render
// pointlessly. Any faster rate bypasses this and publishes every tick (see
// below) so scrubbing/fast-forward reads as smooth motion instead.
const PUBLISH_SIM_MS = 15_000

export const RATE_LADDER = [-3600, -600, -60, -1, 1, 60, 600, 3600]

/** Next rate on the Stellarium ladder. dir +1 moves toward fast-forward,
 *  -1 toward fast-reverse; the ladder has no zero — crossing between -1 and
 *  1 is direct, and from pause (0) or an off-ladder value it snaps to ±1. */
export function nextRate(rate: number, dir: 1 | -1): number {
  if (rate === 0) return dir
  const i = RATE_LADDER.indexOf(rate)
  if (i === -1) return dir
  const j = Math.min(RATE_LADDER.length - 1, Math.max(0, i + dir))
  return RATE_LADDER[j]
}

export interface SimTime {
  time: Date
  rate: number
  ladder: (dir: 1 | -1) => void
  togglePause: () => void
  stepBy: (ms: number) => void
  resetToNow: () => void
}

/** Simulated clock: rate 0 = paused, 1 = realtime, negative = reverse.
 *  Advances on a wall-clock interval and publishes a new `time` only when
 *  the accumulated sim delta reaches PUBLISH_SIM_MS; discrete jumps
 *  (stepBy, resetToNow) publish immediately. */
export function useSimTime(): SimTime {
  const [time, setTime] = useState(() => new Date())
  const [rate, setRateState] = useState(1)
  // eslint-disable-next-line react-hooks/purity
  const simRef = useRef(Date.now())
  // eslint-disable-next-line react-hooks/purity
  const lastWallRef = useRef(Date.now())
  const pendingRef = useRef(0)
  const rateRef = useRef(1)
  const lastRunningRef = useRef(1)

  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now()
      const wallDt = now - lastWallRef.current
      lastWallRef.current = now
      if (rateRef.current === 0) return
      const simDt = wallDt * rateRef.current
      simRef.current += simDt
      if (Math.abs(rateRef.current) > 1) {
        // Fast-forward/rewind: publish every tick (~25 fps) for smooth motion.
        pendingRef.current = 0
        setTime(new Date(simRef.current))
        return
      }
      pendingRef.current += Math.abs(simDt)
      if (pendingRef.current >= PUBLISH_SIM_MS) {
        pendingRef.current = 0
        setTime(new Date(simRef.current))
      }
    }, TICK_MS)
    return () => clearInterval(id)
  }, [])

  const setRate = (r: number) => {
    rateRef.current = r
    if (r !== 0) lastRunningRef.current = r
    setRateState(r)
  }
  const publish = () => {
    pendingRef.current = 0
    setTime(new Date(simRef.current))
  }

  return {
    time,
    rate,
    ladder: (dir) => setRate(nextRate(rateRef.current, dir)),
    togglePause: () => setRate(rateRef.current === 0 ? lastRunningRef.current : 0),
    stepBy: (ms) => { simRef.current += ms; publish() },
    resetToNow: () => { simRef.current = Date.now(); lastWallRef.current = Date.now(); setRate(1); publish() },
  }
}
