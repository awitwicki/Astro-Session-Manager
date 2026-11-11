import type { ApertureView, BandChart, SweepChart, Tick, Box } from '../../lib/fbscCharts'

function Axes({ box, xTicks, yTicks }: { box: Box; xTicks: Tick[]; yTicks: Tick[] }) {
  return (
    <g className="fc-axes">
      {yTicks.map((t) => (
        <g key={t.label}>
          <line x1={box.left} y1={t.pos} x2={box.right} y2={t.pos} className="fc-gridline" />
          <text x={box.left - 8} y={t.pos + 3.5} textAnchor="end">{t.label}</text>
        </g>
      ))}
      {xTicks.map((t) => (
        <g key={t.label}>
          <line x1={t.pos} y1={box.bottom} x2={t.pos} y2={box.bottom + 4} className="fc-tick" />
          <text x={t.pos} y={box.bottom + 17} textAnchor="middle">{t.label}</text>
        </g>
      ))}
      <line x1={box.left} y1={box.bottom} x2={box.right} y2={box.bottom} className="fc-axis" />
    </g>
  )
}

export function BandChartView({ chart, lineLabel, lineColor }: {
  chart: BandChart
  lineLabel: string
  lineColor: string
}) {
  const { box } = chart
  // Keep the label inside the plot when the line sits near an edge.
  const labelRight = chart.targetX < (box.left + box.right) / 2
  return (
    <figure className="fc-figure">
      <svg viewBox={`0 0 ${box.w} ${box.h}`} className="fc-svg" role="img"
        aria-label="Filter transmission against wavelength, in a parallel beam and through the telescope">
        <Axes box={box} xTicks={chart.xTicks} yTicks={chart.yTicks} />
        <text x={(box.left + box.right) / 2} y={box.h - 4} textAnchor="middle" className="fc-axis-title">Wavelength, nm</text>
        <text x={12} y={(box.top + box.bottom) / 2} textAnchor="middle" className="fc-axis-title"
          transform={`rotate(-90 12 ${(box.top + box.bottom) / 2})`}>Transmission, %</text>

        {chart.contributions.map((d, i) => (
          <path key={i} d={d} className="fc-contribution"
            opacity={0.25 + (0.6 * i) / (chart.contributions.length - 1)} />
        ))}
        <path d={chart.effectiveArea} className="fc-effective-area" />
        <path d={chart.parallel} className="fc-parallel" />
        <path d={chart.effective} className="fc-effective" />

        <line x1={chart.targetX} y1={box.top} x2={chart.targetX} y2={box.bottom}
          stroke={lineColor} strokeWidth={2} />
        <text x={chart.targetX + (labelRight ? -4 : 4)} y={box.top - 8}
          textAnchor={labelRight ? 'start' : 'end'} style={{ fill: lineColor }} className="fc-line-label">
          {lineLabel}
        </text>
      </svg>
      <figcaption className="fc-legend">
        <span><i className="fc-swatch fc-swatch-parallel" /> Filter as sold (straight light)</span>
        <span><i className="fc-swatch fc-swatch-effective" /> Filter on this telescope</span>
        <span><i className="fc-swatch fc-swatch-contribution" /> Built up from the centre of the aperture outwards</span>
        <span><i className="fc-swatch" style={{ borderTopColor: lineColor }} /> Emission line</span>
      </figcaption>
    </figure>
  )
}

export function ApertureViewSvg({ view, centerDeg, edgeDeg }: {
  view: ApertureView
  centerDeg: string
  edgeDeg: string
}) {
  const c = view.center
  return (
    <figure className="fc-figure fc-figure-aperture">
      <svg viewBox={`0 0 ${view.size} ${view.size}`} className="fc-svg fc-svg-aperture" role="img"
        aria-label="Front view of the aperture: zones coloured by how much of the line they pass">
        {view.rings.map((ring, i) => (
          <circle key={i} cx={c} cy={c} r={ring.r} fill="none" stroke={ring.color} strokeWidth={ring.width} />
        ))}
        {view.obstructionR > 0 && <circle cx={c} cy={c} r={view.obstructionR} className="fc-obstruction" />}
        <circle cx={c} cy={c} r={view.outerR} className="fc-aperture-rim" />
      </svg>
      <figcaption>
        <div className="fc-scale">
          <span>blocked</span>
          <i className="fc-scale-bar" />
          <span>passes</span>
        </div>
        <div className="fc-note">Rays hit the filter at {centerDeg}° (inner) to {edgeDeg}° (edge)</div>
      </figcaption>
    </figure>
  )
}

export function SweepChartView({ chart, markerColor }: { chart: SweepChart; markerColor: string }) {
  const { box } = chart
  return (
    <figure className="fc-figure">
      <svg viewBox={`0 0 ${box.w} ${box.h}`} className="fc-svg" role="img"
        aria-label="Transmission at the emission line against the telescope's focal ratio">
        <Axes box={box} xTicks={chart.xTicks} yTicks={chart.yTicks} />
        <text x={(box.left + box.right) / 2} y={box.h - 4} textAnchor="middle" className="fc-axis-title">Focal ratio</text>
        <text x={12} y={(box.top + box.bottom) / 2} textAnchor="middle" className="fc-axis-title"
          transform={`rotate(-90 12 ${(box.top + box.bottom) / 2})`}>At the line, %</text>
        <path d={chart.area} className="fc-effective-area" />
        <path d={chart.line} className="fc-effective" />
        <line x1={chart.marker.x} y1={chart.marker.y} x2={chart.marker.x} y2={box.bottom} className="fc-marker-drop" />
        <circle cx={chart.marker.x} cy={chart.marker.y} r={5} fill={markerColor} className="fc-marker" />
      </svg>
    </figure>
  )
}
