import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, MapPin, Telescope } from 'lucide-react'
import { usePlannerData } from '../hooks/usePlanner'
import { AltitudeChart } from '../components/planner/AltitudeChart'
import { useEffectiveHorizonProfile } from '../hooks/useHorizon'
import { moonInfo, separationDeg } from '../lib/ephemeris'
import { addDays, addMinutes, formatDateTimeInZone, nightWindowStart } from '../lib/localTime'
import { formatDec, formatRA } from '../lib/formatters'
import { useElementWidth } from '../hooks/useElementWidth'
import '../styles/planner.css'

function Stepper({ label, onMinus, onPlus }: {
  label: string
  onMinus: () => void
  onPlus: () => void
}) {
  return (
    <div className="planner-stepper">
      <button onClick={onMinus} title={`-1 ${label.toLowerCase()}`}>
        <ChevronLeft size={14} />
      </button>
      <span>{label}</span>
      <button onClick={onPlus} title={`+1 ${label.toLowerCase()}`}>
        <ChevronRight size={14} />
      </button>
    </div>
  )
}

export function PlannerDetail() {
  const { targetId } = useParams()
  const { targets, hydrated, locationSet, lat, lon, timeZone } = usePlannerData()
  const [picked, setPicked] = useState(() => new Date())
  const horizon = useEffectiveHorizonProfile()
  const [chartRef, chartWidth] = useElementWidth<HTMLDivElement>()

  const id = targetId !== undefined ? decodeURIComponent(targetId) : ''
  const target = targets.find((t) => t.id === id) ?? null

  if (!hydrated) {
    return <div className="planner-page"><div className="planner-empty">Loading…</div></div>
  }
  if (!target) return <Navigate to="/planner" replace />

  const chartWindowStart = nightWindowStart(picked, timeZone)
  const moon = moonInfo(picked, lat, lon)
  const moonSep = separationDeg(target.ra, target.dec, moon.raDeg, moon.decDeg)

  return (
    <div className="planner-page">
      <div className="planner-detail-header">
        <Link to="/planner" className="planner-back"><ArrowLeft size={16} /> Planner</Link>
        <h2>{target.name}</h2>
        <span className="planner-detail-designation">
          {target.designation}{target.messier !== null ? ` · M${target.messier}` : ''}
        </span>
        <Link to={`/skymap?target=${encodeURIComponent(target.id)}`} className="planner-skymap-link">
          <Telescope size={14} /> Open in Sky Map
        </Link>
      </div>

      {!locationSet && (
        <div className="planner-banner">
          <MapPin size={14} />
          <span>
            No observing location set — using 50°N 20°E.{' '}
            <Link to="/astroweather">Set your location</Link>
          </span>
        </div>
      )}

      <div className="planner-time-toolbar">
        <Stepper
          label="Day"
          onMinus={() => setPicked((p) => addDays(p, -1))}
          onPlus={() => setPicked((p) => addDays(p, 1))}
        />
        <Stepper
          label="Hour"
          onMinus={() => setPicked((p) => addMinutes(p, -60))}
          onPlus={() => setPicked((p) => addMinutes(p, 60))}
        />
        <Stepper
          label="Min"
          onMinus={() => setPicked((p) => addMinutes(p, -1))}
          onPlus={() => setPicked((p) => addMinutes(p, 1))}
        />
        <div className="planner-picked">{formatDateTimeInZone(picked, timeZone)}</div>
        <button className="planner-now" onClick={() => setPicked(new Date())}>Now</button>
      </div>

      <div className="planner-detail-grid">
        <div className="planner-card">
          <h3>Object</h3>
          <dl className="planner-dl">
            <dt>Type</dt><dd>{target.type}</dd>
            <dt>Magnitude</dt><dd>{target.mag !== null ? target.mag.toFixed(1) : '—'}</dd>
            <dt>Size</dt>
            <dd>{target.sizeArcmin ? `${target.sizeArcmin[0]}′ × ${target.sizeArcmin[1]}′` : '—'}</dd>
            <dt>RA / Dec</dt><dd>{formatRA(target.ra)} / {formatDec(target.dec)}</dd>
          </dl>
        </div>

        <div className="planner-card">
          <h3>Moon</h3>
          <dl className="planner-dl">
            <dt>Phase</dt>
            <dd>{moon.phaseName} · {(moon.illumination * 100).toFixed(0)}%</dd>
            <dt>Altitude</dt>
            <dd>{moon.alt.toFixed(1)}°{moon.alt > 0 ? '' : ' (below horizon)'}</dd>
            <dt>Separation</dt><dd>{moonSep.toFixed(1)}° from {target.name}</dd>
          </dl>
        </div>

        <div className="planner-card planner-card--chart" ref={chartRef}>
          <h3>Altitude — hover to inspect, click to set time</h3>
          <AltitudeChart
            raDeg={target.ra}
            decDeg={target.dec}
            lat={lat}
            lon={lon}
            dayStart={chartWindowStart}
            markerTime={picked}
            horizon={horizon}
            width={chartWidth ?? 680}
            height={264}
            showAzimuth
            onPickTime={setPicked}
          />
        </div>
      </div>
    </div>
  )
}
