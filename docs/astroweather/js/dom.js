// Tiny DOM helpers shared by the tab renderers. Browser-only calls stay inside
// the functions so Node can import modules that import this one.

export function el(tag, className, text) {
  const n = document.createElement(tag)
  if (className) n.className = className
  if (text !== undefined) n.textContent = text
  return n
}

export function svgEl(name, attrs = {}) {
  const n = document.createElementNS('http://www.w3.org/2000/svg', name)
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v))
  return n
}

export function emptyState(title, text) {
  const box = el('div', 'empty-state')
  box.append(el('h3', null, title), el('p', null, text))
  return box
}
