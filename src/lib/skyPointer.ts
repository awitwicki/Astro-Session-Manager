// Mouse input for the d3-celestial sky views. d3-celestial's own drag
// (d3.geo.zoom) keeps a private rotation that includes a roll; both views pin
// the roll (north up / ground level), so on every move the two disagree and
// the view jumps — the grabbed star drifts off the cursor and the pan
// reverses direction near the poles. Each view therefore takes the input
// over and re-centres with grabbedCentre (skyPan.ts) through a single
// rotate() per move.

export interface SkyDrag {
  /** Mouse-down at a canvas-pixel position: remember what is under it. */
  grab: (at: [number, number]) => void
  /** Each move while the button is held: bring the grabbed point here. */
  drag: (at: [number, number]) => void
}

type D3Select = (t: EventTarget) => { on: (e: string, h: null) => void }

/** Detaches d3-celestial's window resize handler and its drag/wheel zoom from
 *  the view's canvas, then installs ours: left-drag drives `input`, wheel
 *  zooms about the centre. d3-celestial's
 *  dblclick handler on the container stays — that is a pure zoomBy. Abort the
 *  returned controller to remove the listeners; null if there is no canvas. */
export function takeOverSkyInput(
  container: HTMLElement,
  input: SkyDrag,
): AbortController | null {
  const canvas = container.querySelector('canvas')
  try {
    const d3select = ((globalThis as Record<string, unknown>)['d3'] as { select: D3Select } | undefined)?.select
    d3select?.(globalThis).on('resize', null)
    if (canvas) d3select?.(canvas).on('.zoom', null)
  } catch { /* ignore */ }
  if (!canvas) return null

  const ac = new AbortController()
  const { signal } = ac
  let dragging = false
  const at = (e: PointerEvent): [number, number] => {
    const r = canvas.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }
  // Pointer capture keeps a drag alive once the cursor leaves the canvas.
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    dragging = true
    input.grab(at(e))
    try { canvas.setPointerCapture(e.pointerId) } catch { /* ignore */ }
  }, { signal })
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return
    if (!(e.buttons & 1)) { dragging = false; return }
    input.drag(at(e))
  }, { signal })
  const end = () => { dragging = false }
  canvas.addEventListener('pointerup', end, { signal })
  canvas.addEventListener('pointercancel', end, { signal })
  // Same factor per wheel notch as d3.behavior.zoom used (2^(-deltaY/500)),
  // with line-mode deltas scaled the way it scaled them.
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault()
    const delta = -e.deltaY * (e.deltaMode ? 120 : 1)
    try { Celestial.zoomBy(Math.pow(2, delta * 0.002)) } catch { /* ignore */ }
  }, { signal, passive: false })
  return ac
}
