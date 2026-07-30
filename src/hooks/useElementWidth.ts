import { useCallback, useRef, useState } from 'react'

/** Callback ref + live content-box width of the referenced element,
 *  re-measured whenever it resizes. Width is null until the element mounts
 *  and is first measured.
 *
 *  A callback ref (not an effect) so the observer attaches whenever the
 *  element actually appears: on PlannerDetail the chart card is behind an
 *  async `hydrated` gate, so a mount-once effect would run while the page
 *  still renders the loading branch, see a null ref, and never observe. */
export function useElementWidth<T extends HTMLElement>(): [(el: T | null) => void, number | null] {
  const observerRef = useRef<ResizeObserver | null>(null)
  const [width, setWidth] = useState<number | null>(null)
  const ref = useCallback((el: T | null) => {
    observerRef.current?.disconnect()
    observerRef.current = null
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0
      if (w > 0) setWidth(Math.floor(w))
    })
    observer.observe(el)
    observerRef.current = observer
  }, [])
  return [ref, width]
}
