import { useEffect } from 'react'
import { X } from 'lucide-react'

// Light cones drawn to scale: the cone's half-width at the aperture is
// height / (2 · focal ratio).
function Cone({ x, fRatio, label, note }: { x: number; fRatio: number; label: string; note: string }) {
  const top = 26
  const focus = 150
  const half = (focus - top) / (2 * fRatio)
  const filterY = 122
  const filterHalf = ((focus - filterY) / (focus - top)) * half + 9
  return (
    <g>
      <text x={x} y={14} textAnchor="middle" className="fc-cone-label">{label}</text>
      <polygon points={`${x - half},${top} ${x + half},${top} ${x},${focus}`} className="fc-cone" />
      <line x1={x - half} y1={top} x2={x + half} y2={top} className="fc-cone-aperture" />
      <line x1={x - filterHalf} y1={filterY} x2={x + filterHalf} y2={filterY} className="fc-cone-filter" />
      <circle cx={x} cy={focus} r={2.5} className="fc-cone-focus" />
      <text x={x} y={170} textAnchor="middle" className="fc-cone-note">{note}</text>
    </g>
  )
}

export function FilterExplainer({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal fc-explainer" role="dialog" aria-modal="true" aria-label="Why this calculator exists"
        onClick={(e) => e.stopPropagation()}>
        <div className="fc-explainer-head">
          <h3 className="modal-title">Why do I need this?</h3>
          <button className="btn btn-sm" onClick={onClose} title="Close" aria-label="Close"><X size={14} /></button>
        </div>

        <p>
          A narrowband filter is a very picky gate. It lets through one exact colour of light, for
          example the red glow of hydrogen in a nebula, and blocks almost everything else,
          including street lights and moonlight.
        </p>
        <p>
          The gate only sits in the right place for light that hits the filter <b>straight on</b>.
          Light that arrives at an angle finds the gate moved a little towards blue.
        </p>

        <svg viewBox="0 0 420 178" className="fc-explainer-art" role="img"
          aria-label="A slow telescope has a narrow light cone, a fast telescope a wide one">
          <Cone x={105} fRatio={7} label="Slow telescope, f/7" note="light arrives almost straight" />
          <Cone x={315} fRatio={2} label="Fast telescope, f/2" note="light arrives at steep angles" />
        </svg>

        <p>
          A fast telescope (a small f-number, like f/2) squeezes light into a wide, steep cone. Much
          of that light crosses the filter at an angle, the gate slides off the nebula's colour, and
          part of the signal you spent the night collecting is thrown away. The narrower the filter,
          the sooner this hurts. A mirror telescope with a secondary mirror in the middle loses the
          straight-on light first, which makes it worse.
        </p>

        <h4>What the calculator tells you</h4>
        <ul>
          <li>How much of the nebula's light really gets through with <b>your</b> telescope and filter.</li>
          <li>Whether a filter you want to buy fits your telescope before you pay for it.</li>
          <li>
            Whether you need a "high-speed" filter, one made with its gate moved towards red on
            purpose so a fast telescope moves it back to the right place, and by how much.
          </li>
        </ul>
        <p className="fc-explainer-rule">
          Rule of thumb: slower than f/4, nearly any filter works. At f/3.4 and faster, check first.
        </p>
      </div>
    </div>
  )
}
