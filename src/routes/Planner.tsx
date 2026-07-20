import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { MapPin, Mountain, X } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { persistPlannerTargets, usePlannerData } from '../hooks/usePlanner'
import { ObjectSearch } from '../components/planner/ObjectSearch'
import { AltitudeChart } from '../components/planner/AltitudeChart'
import { HorizonEditor } from '../components/planner/HorizonEditor'
import { useEffectiveHorizonProfile } from '../hooks/useHorizon'
import { altAzAt, altAzCurve, sunAltitudes } from '../lib/ephemeris'
import { clearsHorizonAtNight } from '../lib/horizon'
import { nightWindowStart } from '../lib/localTime'
import { azToCompass } from '../lib/formatters'
import type { CatalogObject } from '../lib/catalogSearch'
import type { PlannerTarget } from '../types/planner'
import '../styles/planner.css'

export function Planner() {
  const navigate = useNavigate()
  const { targets, hydrated, locationSet, lat, lon, timeZone } = usePlannerData()
  const addPlannerTarget = useAppStore((s) => s.addPlannerTarget)
  const removePlannerTarget = useAppStore((s) => s.removePlannerTarget)
  const flatHorizonPreview = useAppStore((s) => s.flatHorizonPreview)
  const setFlatHorizonPreview = useAppStore((s) => s.setFlatHorizonPreview)
  const [now, setNow] = useState(() => new Date())
  const [flashId, setFlashId] = useState<string | null>(null)
  const [horizonOpen, setHorizonOpen] = useState(false)
  const horizon = useEffectiveHorizonProfile()

  // Refresh the "now" marker and alt/az readouts every minute
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  const dayStart = nightWindowStart(now, timeZone)
  // One sun curve for every row: it depends only on the window and location.
  const sunSamples = sunAltitudes(dayStart, lat, lon)

  const handleAdd = (obj: CatalogObject) => {
    if (targets.some((t) => t.id === obj.id)) {
      setFlashId(obj.id)
      setTimeout(() => setFlashId(null), 1200)
      return
    }
    const target: PlannerTarget = {
      id: obj.id,
      name: obj.names[0] ?? obj.id,
      designation: obj.id,
      messier: obj.m,
      ra: obj.ra,
      dec: obj.dec,
      type: obj.type,
      mag: obj.mag,
      sizeArcmin: obj.size,
      constellation: obj.con,
      addedAt: new Date().toISOString(),
    }
    addPlannerTarget(target)
    persistPlannerTargets([...targets, target])
  }

  const handleRemove = (id: string) => {
    removePlannerTarget(id)
    persistPlannerTargets(targets.filter((t) => t.id !== id))
  }

  return (
    <div className="planner-page">
      <div className="planner-header">
        <h2>Planner</h2>
        <ObjectSearch onSelect={handleAdd} />
        <button
          className={`planner-horizon-toggle${horizonOpen ? ' planner-horizon-toggle--active' : ''}`}
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
          Search for an object (M31, NGC 7000…) to start planning.
        </div>
      )}

      <div className="planner-list">
        {targets.map((t) => {
          const { alt, az } = altAzAt(t.ra, t.dec, now, lat, lon)
          const blocked = horizon !== null
            && !clearsHorizonAtNight(altAzCurve(t.ra, t.dec, dayStart, lat, lon), sunSamples, horizon)
          return (
            <div
              key={t.id}
              className={`planner-row${flashId === t.id ? ' planner-row--flash' : ''}`}
              onClick={() => navigate(`/planner/${encodeURIComponent(t.id)}`)}
            >
              <div className="planner-row-info">
                <div className="planner-row-name">{t.name}</div>
                <div className="planner-row-designation">
                  {t.designation}
                  {t.messier !== null ? ` · M${t.messier}` : ''}
                </div>
                <div className="planner-row-meta">
                  {t.type}{t.mag !== null ? ` · mag ${t.mag.toFixed(1)}` : ''} · {t.constellation}
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
