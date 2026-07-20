// Loads d3-celestial via script tags (not ES modules).
// d3 v3 uses `this.d3 = d3` which needs `this === window` (non-strict mode).
// Vite's ESM pre-bundling runs code in strict mode, breaking this.
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve()
      return
    }
    const s = document.createElement('script')
    s.src = src
    s.onload = () => resolve()
    s.onerror = reject
    document.head.appendChild(s)
  })
}

let celestialLoadPromise: Promise<void> | null = null

export function ensureCelestialLoaded(): Promise<void> {
  if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).Celestial) {
    return Promise.resolve()
  }
  if (!celestialLoadPromise) {
    celestialLoadPromise = loadScript('/d3-celestial-data/d3.min.js')
      .then(() => loadScript('/d3-celestial-data/d3.geo.projection.min.js'))
      .then(() => loadScript('/d3-celestial-data/celestial.js'))
  }
  return celestialLoadPromise
}
