import { useState, type FormEvent } from 'react'
import { parseDec, parseRA } from '../../lib/coords'
import { formatDec, formatRA } from '../../lib/formatters'

interface CoordinateFormProps {
  onAdd: (name: string, raDeg: number, decDeg: number) => void
}

/** Adds a Planner target from typed J2000 coordinates. Each field echoes its
 *  parsed value so the user sees how the input was understood before adding. */
export function CoordinateForm({ onAdd }: CoordinateFormProps) {
  const [name, setName] = useState('')
  const [ra, setRa] = useState('')
  const [dec, setDec] = useState('')
  const raDeg = parseRA(ra)
  const decDeg = parseDec(dec)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (raDeg === null || decDeg === null) return
    onAdd(name, raDeg, decDeg)
    setName('')
    setRa('')
    setDec('')
  }

  return (
    <form className="planner-coords-form" onSubmit={submit}>
      <label>
        Name
        <input value={name} placeholder="Optional" onChange={(e) => setName(e.target.value)} />
        <span className="planner-coords-parsed" />
      </label>
      <label className={ra.trim() && raDeg === null ? 'planner-coords-field--invalid' : ''}>
        RA
        <input value={ra} placeholder="20 59 17 or 314.82" onChange={(e) => setRa(e.target.value)} />
        <span className="planner-coords-parsed">
          {raDeg !== null ? formatRA(raDeg) : ra.trim() ? 'Unrecognized' : ''}
        </span>
      </label>
      <label className={dec.trim() && decDeg === null ? 'planner-coords-field--invalid' : ''}>
        Dec
        <input value={dec} placeholder="+44 31 44 or 44.53" onChange={(e) => setDec(e.target.value)} />
        <span className="planner-coords-parsed">
          {decDeg !== null ? formatDec(decDeg) : dec.trim() ? 'Unrecognized' : ''}
        </span>
      </label>
      <button type="submit" disabled={raDeg === null || decDeg === null}>Add</button>
      <span className="planner-coords-hint">
        J2000. RA as h m s (12 30 00, 12h30m) or degrees (187.5); 12.5h for decimal hours.
        Dec as ±d m s (+41 16 08) or degrees (41.27).
      </span>
    </form>
  )
}
