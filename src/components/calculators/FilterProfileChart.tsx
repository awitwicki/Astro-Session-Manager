import type { ProfilePoint } from '../../lib/fbsc'

export interface FilterProfileChartProps {
  onAxis: ProfilePoint[]
  shiftedMin: ProfilePoint[]
  shiftedMax: ProfilePoint[]
  targetNm: number
  domainMinNm: number
  domainMaxNm: number
  peak: number
}

const W = 560
const H = 220
const PAD_L = 36
const PAD_R = 12
const PAD_T = 12
const PAD_B = 28

export function FilterProfileChart({
  onAxis, shiftedMin, shiftedMax, targetNm, domainMinNm, domainMaxNm, peak,
}: FilterProfileChartProps) {
  const yMax = Math.max(peak, 0.0001)
  const xSpan = domainMaxNm - domainMinNm || 1

  const sx = (nm: number) => PAD_L + ((nm - domainMinNm) / xSpan) * (W - PAD_L - PAD_R)
  const sy = (t: number) => PAD_T + (1 - t / yMax) * (H - PAD_T - PAD_B)

  const toPath = (pts: ProfilePoint[]) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.wavelengthNm).toFixed(2)},${sy(p.transmission).toFixed(2)}`).join(' ')

  // Line segments (no leading move) along a reversed point list — used to close
  // the shift envelope back along the lower curve so it forms a filled band.
  const toLineReversed = (pts: ProfilePoint[]) =>
    [...pts].reverse().map((p) => `L${sx(p.wavelengthNm).toFixed(2)},${sy(p.transmission).toFixed(2)}`).join(' ')

  // X axis ticks: domain min, target, domain max.
  const ticks = [domainMinNm, targetNm, domainMaxNm]

  return (
    <div className="calc-chart">
      <svg viewBox={`0 0 ${W} ${H}`} className="calc-chart-svg" role="img"
        aria-label="Filter transmission profile vs wavelength">
        {/* axes */}
        <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} stroke="var(--color-border)" />
        <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={H - PAD_B} stroke="var(--color-border)" />

        {/* envelope between min/max shift: forward along the upper curve,
            back along the lower curve, then close */}
        <path d={`${toPath(shiftedMax)} ${toLineReversed(shiftedMin)} Z`}
          fill="var(--color-accent)" opacity={0.12} stroke="none" />

        {/* curves */}
        <path d={toPath(onAxis)} fill="none" stroke="var(--color-text-muted)" strokeWidth={1.25} strokeDasharray="4 3" />
        <path d={toPath(shiftedMin)} fill="none" stroke="var(--color-accent)" strokeWidth={1.5} opacity={0.7} />
        <path d={toPath(shiftedMax)} fill="none" stroke="var(--color-accent)" strokeWidth={1.5} />

        {/* target marker */}
        <line x1={sx(targetNm)} y1={PAD_T} x2={sx(targetNm)} y2={H - PAD_B}
          stroke="var(--color-error)" strokeWidth={1} strokeDasharray="2 2" />

        {/* x tick labels */}
        {ticks.map((nm, i) => (
          <text key={i} x={sx(nm)} y={H - 8} textAnchor="middle"
            fontSize={10} fill="var(--color-text-muted)">
            {nm.toFixed(1)}
          </text>
        ))}
      </svg>
      <div className="calc-chart-legend">
        <span><i className="calc-swatch calc-swatch-dash" /> On-axis</span>
        <span><i className="calc-swatch calc-swatch-accent" /> Shifted (aperture edge)</span>
        <span><i className="calc-swatch calc-swatch-target" /> Target line</span>
      </div>
    </div>
  )
}
