import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Crosshair, MapPin, Mountain, Pencil, X } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { persistPlannerTargets, usePlannerData } from '../hooks/usePlanner'
import { ObjectSearch } from '../components/planner/ObjectSearch'
import { CoordinateForm } from '../components/planner/CoordinateForm'
import { AltitudeChart } from '../components/planner/AltitudeChart'
import { HorizonEditor } from '../components/planner/HorizonEditor'
import { useEffectiveHorizonProfile } from '../hooks/useHorizon'
import { altAzAt, altAzCurve, sunAltitudes } from '../lib/ephemeris'
import { clearsHorizonAtNight } from '../lib/horizon'
import { nightWindowStart } from '../lib/localTime'
import { azToCompass } from '../lib/formatters'
import type { SearchHit } from '../lib/objectSearch'
import { targetFromCoords, targetFromDso, targetFromStar } from '../lib/plannerTargets'
import type { PlannerTarget } from '../types/planner'
import '../styles/planner.css'

export function Planner() {
  const navigate = useNavigate()
  const { targets, hydrated, locationSet, lat, lon, timeZone } = usePlannerData()
  const addPlannerTarget = useAppStore((s) => s.addPlannerTarget)
  const removePlannerTarget = useAppStore((s) => s.removePlannerTarget)
  const updatePlannerTarget = useAppStore((s) => s.updatePlannerTarget)
  const flatHorizonPreview = useAppStore((s) => s.flatHorizonPreview)
  const setFlatHorizonPreview = useAppStore((s) => s.setFlatHorizonPreview)
  const [now, setNow] = useState(() => new Date())
  const [flashId, setFlashId] = useState<string | null>(null)
  const [horizonOpen, setHorizonOpen] = useState(false)
  const [coordsOpen, setCoordsOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const horizon = useEffectiveHorizonProfile()

  // Refresh the "now" marker and alt/az readouts every minute
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  const dayStart = nightWindowStart(now, timeZone)
  // One sun curve for every row: it depends only on the window and location.
  const sunSamples = sunAltitudes(dayStart, lat, lon)

  const addTarget = (target: PlannerTarget) => {
    if (targets.some((t) => t.id === target.id)) {
      setFlashId(target.id)
      setTimeout(() => setFlashId(null), 1200)
      return
    }
    addPlannerTarget(target)
    persistPlannerTargets([...targets, target])
  }

  const handleAdd = (hit: SearchHit) => {
    addTarget(hit.kind === 'dso' ? targetFromDso(hit.obj) : targetFromStar(hit.star))
  }

  const handleAddCoords = (name: string, raDeg: number, decDeg: number) => {
    addTarget(targetFromCoords(name, raDeg, decDeg))
  }

  const handleRemove = (id: string) => {
    removePlannerTarget(id)
    persistPlannerTargets(targets.filter((t) => t.id !== id))
  }

  const startRename = (t: PlannerTarget) => {
    setEditingId(t.id)
    setDraftName(t.name)
  }

  const commitRename = (t: PlannerTarget) => {
    const name = draftName.trim()
    if (name && name !== t.name) {
      updatePlannerTarget(t.id, { name })
      persistPlannerTargets(targets.map((x) => (x.id === t.id ? { ...x, name } : x)))
    }
    setEditingId(null)
  }

  return (
    <div className="planner-page">
      <div className="planner-header">
        <h2>Planner</h2>
        <ObjectSearch onSelect={handleAdd} />
        <button
          className={`planner-toggle${coordsOpen ? ' planner-toggle--active' : ''}`}
          title="Add a target from RA/Dec"
          onClick={() => setCoordsOpen((o) => !o)}
        >
          <Crosshair size={14} /> Coordinates
        </button>
        <button
          className={`planner-toggle${horizonOpen ? ' planner-toggle--active' : ''}`}
          onClick={() => setHorizonOpen((o) => !o)}
        >
          <Mountain size={14} /> Horizon
        </button>
        <label className="planner-flat-horizon-toggle" title="Preview as if no custom horizon were set, without changing your saved skyline">
          <input
            type="checkbox"
            checked={flatHorizonPreview}
            onChange={(e) => setFlatHorizonPreview(e.target.checked)}
          />
          Flat horizon
        </label>
      </div>

      {coordsOpen && <CoordinateForm onAdd={handleAddCoords} />}

      {horizonOpen && (
        <div className="planner-horizon-section">
          <HorizonEditor />
        </div>
      )}

      {!locationSet && (
        <div className="planner-banner">
          <MapPin size={14} />
          <span>
            No observing location set — using 50°N 20°E.{' '}
            <Link to="/astroweather">Set your location</Link>
          </span>
        </div>
      )}

      {hydrated && targets.length === 0 && (
        <div className="planner-empty">
          Search for an object (M31, NGC 7000, HD 172167, Vega…) or add coordinates to start planning.
        </div>
      )}

      <div className="planner-list">
        {targets.map((t) => {
          const { alt, az } = altAzAt(t.ra, t.dec, now, lat, lon)
          const blocked = horizon !== null
            && !clearsHorizonAtNight(altAzCurve(t.ra, t.dec, dayStart, lat, lon), sunSamples, horizon)
          const editing = editingId === t.id
          return (
            <div
              key={t.id}
              className={`planner-row${flashId === t.id ? ' planner-row--flash' : ''}`}
              onClick={() => { if (!editing) navigate(`/planner/${encodeURIComponent(t.id)}`) }}
            >
              <div className="planner-row-info">
                {editing ? (
                  <input
                    className="planner-row-name-input"
                    value={draftName}
                    autoFocus
                    onChange={(e) => setDraftName(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={() => commitRename(t)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(t)
                      else if (e.key === 'Escape') setEditingId(null)
                    }}
                  />
                ) : (
                  <div className="planner-row-name">
                    {t.name}
                    <button
                      className="planner-row-rename"
                      title="Rename"
                      onClick={(e) => {
                        e.stopPropagation()
                        startRename(t)
                      }}
                    >
                      <Pencil size={12} />
                    </button>
                  </div>
                )}
                <div className="planner-row-designation">
                  {t.designation}
                  {t.messier !== null ? ` · M${t.messier}` : ''}
                </div>
                <div className="planner-row-meta">
                  {t.type}
                  {t.mag !== null ? ` · mag ${t.mag.toFixed(1)}` : ''}
                  {t.constellation ? ` · ${t.constellation}` : ''}
                </div>
                <div className={`planner-row-altaz${alt > 0 ? '' : ' planner-row-altaz--below'}`}>
                  Alt {Math.round(alt)}° · Az {Math.round(az)}° {azToCompass(az)}
                </div>
                {blocked && (
                  <div className="planner-row-blocked">Below your horizon tonight</div>
                )}
              </div>
              <AltitudeChart
                raDeg={t.ra}
                decDeg={t.dec}
                lat={lat}
                lon={lon}
                dayStart={dayStart}
                markerTime={now}
                horizon={horizon}
              />
              <button
                className="planner-row-remove"
                title="Remove"
                onClick={(e) => {
                  e.stopPropagation()
                  handleRemove(t.id)
                }}
              >
                <X size={14} />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
