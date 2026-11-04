import { useLayoutEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { placeCard } from '../../lib/skyHit'
import type { PlannerTarget } from '../../types/planner'

/** What a click on the Planner sky picked. */
export interface SkyObject {
  name: string
  type: string
  mag: number | null
  /** What "Add to Planner" adds; null for the Sun, which is info-only. */
  target: PlannerTarget | null
  /** Id of the Planner target that was hit, when it already is one. */
  existingId: string | null
}

/** Small info card next to a clicked sky object: name, type, magnitude, the
 *  current altitude and an "Add to Planner" button. `at` is the clicked point
 *  relative to `.skymap-page`; the card sits below-right of it, flipped and
 *  clamped to stay inside the page. */
export function SkyObjectCard({ object, alt, at, inPlanner, onAdd, onClose }: {
  object: SkyObject
  alt: number
  at: [number, number]
  inPlanner: boolean
  onAdd: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  // Placed after layout (its size depends on the name), before paint.
  useLayoutEffect(() => {
    const el = ref.current
    const page = el?.offsetParent
    if (!el || !(page instanceof HTMLElement)) return
    const [left, top] = placeCard(
      at, [el.offsetWidth, el.offsetHeight], [page.clientWidth, page.clientHeight])
    el.style.left = `${left}px`
    el.style.top = `${top}px`
  })

  return (
    <div ref={ref} className="sky-object-card" style={{ left: at[0] + 12, top: at[1] + 12 }}>
      <div className="soc-head">
        <span className="soc-name">{object.name}</span>
        <button className="soc-close" onClick={onClose} title="Close (Esc)" aria-label="Close">
          <X size={13} />
        </button>
      </div>
      <div className="soc-meta">
        {object.type}{object.mag !== null && ` · mag ${object.mag.toFixed(1)}`}
      </div>
      <div className="soc-meta">Alt {Math.round(alt)}°</div>
      {object.target && (
        <button className="btn btn-sm soc-add" onClick={onAdd} disabled={inPlanner}>
          {inPlanner ? 'In Planner' : 'Add to Planner'}
        </button>
      )}
    </div>
  )
}
