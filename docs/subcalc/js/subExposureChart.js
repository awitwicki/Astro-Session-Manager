// Generated from src/lib/subExposureChart.ts by scripts/sync-subcalc.mjs. Do not edit.
// Geometry of the sub-exposure calculator's "sub length by focal ratio"
// chart, in SVG pixel units. Pure, following the pattern of
// `fbscCharts.ts`: the React view only turns this model into markup.
// Drawn at the width of a full calculator card (like fbscCharts' band chart)
// so the 10 px SVG text isn't scaled up; `top` leaves room for a series label
// above a line that runs along the top of the plot.
const DEFAULT_SIZE = { width: 720, height: 260 };
const MARGIN = { left: 50, top: 24, right: 14, bottom: 32 };
const N_MIN = 2;
const N_MAX = 12;
const X_TICK_VALUES = [2, 2.8, 4, 5.6, 8, 11];
const Y_MIN = 1; // 1 s
const Y_MAX = 14400; // 4 h
const Y_TICK_CANDIDATES = [
    { t: 1, label: '1 s' },
    { t: 10, label: '10 s' },
    { t: 60, label: '1 min' },
    { t: 300, label: '5 min' },
    { t: 1800, label: '30 min' },
    { t: 7200, label: '2 h' },
];
function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
}
/** The data range padded outward to the enclosing candidate ticks, clamped
 *  to [Y_MIN, Y_MAX]. With no data at all, a reasonable default domain. */
function yDomain(allT) {
    if (allT.length === 0)
        return [Y_MIN, Y_TICK_CANDIDATES[4].t];
    const dataMin = clamp(Math.min(...allT), Y_MIN, Y_MAX);
    const dataMax = clamp(Math.max(...allT), Y_MIN, Y_MAX);
    let lo = Y_MIN;
    for (const { t } of Y_TICK_CANDIDATES)
        if (t <= dataMin)
            lo = t;
    let hi = Y_MAX;
    for (let i = Y_TICK_CANDIDATES.length - 1; i >= 0; i--) {
        if (Y_TICK_CANDIDATES[i].t >= dataMax)
            hi = Y_TICK_CANDIDATES[i].t;
    }
    if (hi <= lo)
        hi = Y_MAX;
    return [lo, hi];
}
function linePath(pts) {
    if (pts.length === 0)
        return '';
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}
/** Linear interpolation of `t` at `n` over a series' (sorted) points,
 *  clamped to the series' own range. */
function interpolateT(points, n) {
    if (points.length === 0)
        return null;
    if (n <= points[0].n)
        return points[0].t;
    const last = points[points.length - 1];
    if (n >= last.n)
        return last.t;
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1];
        const b = points[i];
        if (n <= b.n) {
            const frac = (n - a.n) / (b.n - a.n);
            return a.t + frac * (b.t - a.t);
        }
    }
    return last.t;
}
export function subChart(input, currentN, size = DEFAULT_SIZE) {
    const { width, height } = size;
    const plot = {
        x: MARGIN.left,
        y: MARGIN.top,
        w: width - MARGIN.left - MARGIN.right,
        h: height - MARGIN.top - MARGIN.bottom,
    };
    const allT = input.flatMap((s) => s.points.map((p) => p.t));
    const [yMin, yMax] = yDomain(allT);
    const logMin = Math.log10(yMin);
    const logMax = Math.log10(yMax);
    const logSpan = logMax - logMin;
    const sx = (n) => plot.x + ((n - N_MIN) / (N_MAX - N_MIN)) * plot.w;
    const sy = (t) => {
        const clamped = clamp(t, yMin, yMax);
        const frac = logSpan === 0 ? 0 : (Math.log10(clamped) - logMin) / logSpan;
        return plot.y + plot.h - frac * plot.h;
    };
    const markerN = currentN !== null && Number.isFinite(currentN) && currentN >= N_MIN && currentN <= N_MAX
        ? currentN
        : null;
    const series = input.map((s) => {
        const sorted = [...s.points].sort((a, b) => a.n - b.n);
        const path = linePath(sorted.map((p) => ({ x: sx(p.n), y: sy(p.t) })));
        const markerT = markerN !== null ? interpolateT(sorted, markerN) : null;
        const marker = markerT !== null ? { x: sx(markerN), y: sy(markerT) } : null;
        return { id: s.id, label: s.label, path, marker };
    });
    const xTicks = X_TICK_VALUES
        .filter((n) => n >= N_MIN && n <= N_MAX)
        .map((n) => ({ x: sx(n), label: `f/${n}` }));
    const yTicks = Y_TICK_CANDIDATES
        .filter(({ t }) => t >= yMin && t <= yMax)
        .map(({ t, label }) => ({ y: sy(t), label }));
    return { width, height, plot, xTicks, yTicks, series };
}
