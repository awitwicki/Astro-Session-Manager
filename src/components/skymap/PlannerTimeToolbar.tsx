import { useRef, useState } from 'react'
import { FastForward, Pause, Play, Rewind } from 'lucide-react'
import type { SimTime } from '../../hooks/useSimTime'
import { formatDateTimeInZone, formatForDateTimeInput, parseLocalDateTime } from '../../lib/localTime'
import { tonightStart } from '../../lib/ephemeris'

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

export function PlannerTimeToolbar({ sim, timeZone, lat, lon }: {
  sim: SimTime; timeZone: string; lat: number; lon: number
}) {
  const { time, rate } = sim
  // null = showing the label; a string = editing the datetime-local value.
  const [draft, setDraft] = useState<string | null>(null)
  const cancelled = useRef(false)
  const commit = () => {
    if (cancelled.current || draft === null) return
    const parsed = parseLocalDateTime(draft, timeZone)
    setDraft(null)
    if (parsed) sim.setTime(parsed)
  }
  return (
    <div className="planner-time-bar">
      <button className="ptb-btn" onClick={() => sim.ladder(-1)} title="Slower / reverse">
        <Rewind size={15} />
      </button>
      <button className="ptb-btn" onClick={sim.togglePause} title={rate === 0 ? 'Resume' : 'Pause'}>
        {rate === 0 ? <Play size={15} /> : <Pause size={15} />}
      </button>
      <button className="ptb-btn" onClick={() => sim.ladder(1)} title="Faster">
        <FastForward size={15} />
      </button>
      <span className={`ptb-rate${rate < 0 ? ' ptb-rate--rev' : ''}`}>
        {rate === 0 ? 'paused' : `${rate < 0 ? '◀ ' : ''}×${Math.abs(rate)}`}
      </span>
      <div className="ptb-sep" />
      <button className="ptb-btn ptb-btn--text" onClick={() => sim.stepBy(-DAY_MS)}>−1d</button>
      <button className="ptb-btn ptb-btn--text" onClick={() => sim.stepBy(-HOUR_MS)}>−1h</button>
      {draft === null ? (
        <button
          className="ptb-time"
          onClick={() => { cancelled.current = false; setDraft(formatForDateTimeInput(time, timeZone)) }}
          title="Set date and time"
        >
          {formatDateTimeInZone(time, timeZone)}
        </button>
      ) : (
        <input
          type="datetime-local"
          className="ptb-time-input"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            else if (e.key === 'Escape') { cancelled.current = true; setDraft(null) }
          }}
        />
      )}
      <button className="ptb-btn ptb-btn--text" onClick={() => sim.stepBy(HOUR_MS)}>+1h</button>
      <button className="ptb-btn ptb-btn--text" onClick={() => sim.stepBy(DAY_MS)}>+1d</button>
      <div className="ptb-sep" />
      <button
        className="ptb-btn ptb-btn--text"
        onClick={() => sim.setTime(tonightStart(time, timeZone, lat, lon))}
        title="Jump to tonight's astronomical dusk"
      >
        Tonight
      </button>
      <button className="ptb-btn ptb-btn--text ptb-now" onClick={sim.resetToNow}>Now</button>
    </div>
  )
}
