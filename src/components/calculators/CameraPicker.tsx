import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { searchCameras, type Camera } from '../../lib/cameraCatalog'
import type { UserCamera } from '../../lib/userCameras'

interface Option {
  id: string
  group: string
  label: string
  secondary?: string
}

function userCameraLabel(uc: UserCamera): string {
  return uc.camera?.model ?? uc.instrume
}

function userCameraId(uc: UserCamera): string {
  return uc.camera ? uc.camera.id : `user:${uc.instrume}`
}

function matchesQuery(haystack: string, words: string[]): boolean {
  if (words.length === 0) return true
  const h = haystack.toLowerCase()
  return words.every((w) => h.includes(w))
}

export function labelForCameraId(id: string | null, catalog: Camera[], userCameras: UserCamera[]): string {
  if (id === null) return ''
  if (id === 'custom') return 'Custom camera'
  if (id.startsWith('user:')) {
    const instrume = id.slice('user:'.length)
    return userCameras.find((u) => u.instrume === instrume)?.instrume ?? instrume
  }
  return catalog.find((c) => c.id === id)?.model ?? ''
}

export function CameraPicker({ catalog, userCameras, value, onChange }: {
  catalog: Camera[]
  userCameras: UserCamera[]
  value: string | null
  onChange: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const listboxId = `camera-picker-${useId()}`

  useEffect(() => {
    if (!open) return
    const onDocPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDocPointerDown)
    return () => document.removeEventListener('pointerdown', onDocPointerDown)
  }, [open])

  const options = useMemo((): Option[] => {
    const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean)

    const yours: Option[] = userCameras
      .filter((u) => matchesQuery(`${userCameraLabel(u)} ${u.instrume}`, words))
      .map((u) => ({
        id: userCameraId(u),
        group: 'Your cameras',
        label: userCameraLabel(u),
        secondary: `${u.subs} subs`,
      }))

    // A matched user camera already carries the catalog id (userCameraId
    // above), so it already appears in "Your cameras" — don't list it again
    // under its vendor group too.
    const alreadyShown = new Set(yours.map((o) => o.id))
    const matched = searchCameras(catalog, query, 50).filter((c) => !alreadyShown.has(c.id))
    const catalogOptions: Option[] = matched.map((c) => ({ id: c.id, group: c.vendor, label: c.model }))

    const custom: Option[] = matchesQuery('custom camera', words)
      ? [{ id: 'custom', group: '', label: 'Custom camera' }]
      : []

    return [...yours, ...catalogOptions, ...custom]
  }, [catalog, userCameras, query])

  useEffect(() => { setHighlight(0) }, [query, open])

  const select = (id: string) => {
    onChange(id)
    setQuery('')
    setOpen(false)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') { setOpen(true); e.preventDefault() }
      return
    }
    if (e.key === 'ArrowDown') {
      setHighlight((h) => Math.min(options.length - 1, h + 1))
      e.preventDefault()
    } else if (e.key === 'ArrowUp') {
      setHighlight((h) => Math.max(0, h - 1))
      e.preventDefault()
    } else if (e.key === 'Enter') {
      if (options[highlight]) select(options[highlight].id)
      e.preventDefault()
    } else if (e.key === 'Escape') {
      setOpen(false)
      setQuery('')
      e.preventDefault()
    }
  }

  let lastGroup: string | null = null

  return (
    <div className="se-picker" ref={rootRef}>
      <input
        className="calc-input se-picker-input"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        value={open ? query : labelForCameraId(value, catalog, userCameras)}
        placeholder="Search camera or sensor…"
        onFocus={() => { setOpen(true); setQuery('') }}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul className="se-picker-list" role="listbox" id={listboxId}>
          {options.length === 0 && <li className="se-picker-empty">No matches</li>}
          {options.map((opt, i) => {
            const showGroup = opt.group !== lastGroup && opt.group !== ''
            lastGroup = opt.group
            return (
              // Two different INSTRUME spellings can resolve to the same
              // catalog id, so the index guards against a duplicate key.
              <li key={`${opt.group}:${opt.id}:${i}`}>
                {showGroup && <div className="se-picker-group">{opt.group}</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === highlight}
                  className={`se-picker-option ${i === highlight ? 'active' : ''}`}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => select(opt.id)}
                >
                  <span>{opt.label}</span>
                  {opt.secondary && <span className="se-picker-secondary">{opt.secondary}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
