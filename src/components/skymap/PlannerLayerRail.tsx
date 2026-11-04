import type { LucideIcon } from 'lucide-react'

export interface LayerToggle {
  id: string
  icon: LucideIcon
  label: string
  active: boolean
  onToggle: () => void
}

/** The Planner sky's display toggles: an icon column floating in the render
 *  window, each with its name beside it on hover. */
export function PlannerLayerRail({ toggles }: { toggles: LayerToggle[] }) {
  return (
    <div className="planner-layer-rail" role="toolbar" aria-label="Sky layers">
      {toggles.map(({ id, icon: Icon, label, active, onToggle }) => (
        <button
          key={id}
          className={`plr-btn${active ? ' plr-btn--on' : ''}`}
          aria-pressed={active}
          aria-label={label}
          data-label={label}
          onClick={onToggle}
        >
          <Icon size={22} />
        </button>
      ))}
    </div>
  )
}
