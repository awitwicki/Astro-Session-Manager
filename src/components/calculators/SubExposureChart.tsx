import type { SubChart } from '../../lib/subExposureChart'

const SERIES_COLORS = [
  'var(--color-accent)',
  'var(--color-success)',
  'var(--color-warning)',
  'var(--color-error)',
  'var(--color-text-secondary)',
  'var(--color-text-muted)',
]

export function SubExposureChartView({ chart }: { chart: SubChart }) {
  const { plot } = chart
  return (
    <figure className="fc-figure">
      <svg viewBox={`0 0 ${chart.width} ${chart.height}`} className="fc-svg" role="img"
        aria-label="Recommended sub length against focal ratio, one line per camera">
        {chart.yTicks.map((t) => (
          <g key={t.label}>
            <line x1={plot.x} y1={t.y} x2={plot.x + plot.w} y2={t.y} className="fc-gridline" />
            <text x={plot.x - 8} y={t.y + 3.5} textAnchor="end">{t.label}</text>
          </g>
        ))}
        {chart.xTicks.map((t) => (
          <g key={t.label}>
            <line x1={t.x} y1={plot.y + plot.h} x2={t.x} y2={plot.y + plot.h + 4} className="fc-tick" />
            <text x={t.x} y={plot.y + plot.h + 17} textAnchor="middle">{t.label}</text>
          </g>
        ))}
        <line x1={plot.x} y1={plot.y + plot.h} x2={plot.x + plot.w} y2={plot.y + plot.h} className="fc-axis" />
        <text x={(plot.x + plot.x + plot.w) / 2} y={chart.height - 4} textAnchor="middle" className="fc-axis-title">
          Focal ratio
        </text>

        {chart.series.map((s, i) => {
          const color = SERIES_COLORS[i % SERIES_COLORS.length]
          return (
            <g key={s.id}>
              <path d={s.path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
              {s.marker && <circle cx={s.marker.x} cy={s.marker.y} r={4.5} fill={color} className="se-chart-marker" />}
              {s.path && (
                <text x={plot.x + plot.w - 4} y={(s.marker ? s.marker.y : plot.y + plot.h) - 6} textAnchor="end"
                  style={{ fill: color }} className="fc-line-label">
                  {s.label}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </figure>
  )
}
