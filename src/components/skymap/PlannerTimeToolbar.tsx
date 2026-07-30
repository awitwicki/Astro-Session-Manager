import { FastForward, Pause, Play, Rewind } from 'lucide-react'
import type { SimTime } from '../../hooks/useSimTime'
import { formatDateTimeInZone } from '../../lib/localTime'

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

export function PlannerTimeToolbar({ sim, timeZone }: { sim: SimTime; timeZone: string }) {
  const { time, rate } = sim
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
      <span className="ptb-time">{formatDateTimeInZone(time, timeZone)}</span>
      <button className="ptb-btn ptb-btn--text" onClick={() => sim.stepBy(HOUR_MS)}>+1h</button>
      <button className="ptb-btn ptb-btn--text" onClick={() => sim.stepBy(DAY_MS)}>+1d</button>
      <div className="ptb-sep" />
      <button className="ptb-btn ptb-btn--text ptb-now" onClick={sim.resetToNow}>Now</button>
    </div>
  )
}
