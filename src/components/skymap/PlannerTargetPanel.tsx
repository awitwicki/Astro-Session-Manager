import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { PlannerTarget } from '../../types/planner'

export interface TargetRow { target: PlannerTarget; alt: number; az: number }

export function PlannerTargetPanel({ rows, selectedId, onPick }: {
  rows: TargetRow[]
  selectedId: string | null
  onPick: (t: PlannerTarget) => void
}) {
  const [open, setOpen] = useState(true)
  return (
    <div className="planner-target-panel">
      <button className="ptp-head" onClick={() => setOpen((o) => !o)}>
        Targets ({rows.length}) {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>
      {open && (
        <ul className="ptp-list">
          {rows.length === 0 && <li className="ptp-empty">No planner targets yet</li>}
          {rows.map(({ target, alt }) => (
            <li key={target.id}>
              <button
                className={
                  `ptp-row${target.id === selectedId ? ' ptp-row--sel' : ''}`
                  + `${alt <= 0 ? ' ptp-row--down' : ''}`
                }
                onClick={() => onPick(target)}
              >
                <span className="ptp-name">{target.name}</span>
                <span className="ptp-alt">{alt > 0 ? `↑ ${Math.round(alt)}°` : '↓'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
