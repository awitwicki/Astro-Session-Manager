// Generated from src/lib/fbscCharts.ts by scripts/sync-filtercalc.mjs. Do not edit.
// Geometry of the filter calculator's three pictures, in SVG pixel units.
// Pure: the React view and the website (docs/filtercalc) only turn these
// models into markup, so both draw exactly the same thing.
//
// Mirrored for the website by `yarn sync:filtercalc`.
import { bandpass, parallelCurve, sweepFocalRatio, } from './fbsc.js';
function niceStep(span, maxTicks) {
    const raw = span / maxTicks;
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [1, 2, 5, 10])
        if (m * pow >= raw)
            return m * pow;
    return 10 * pow;
}
function linePath(pts) {
    return pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
}
const PERCENT_TICKS = [0, 0.2, 0.4, 0.6, 0.8, 1];
const BAND_BOX = { w: 720, h: 310, left: 46, top: 24, right: 706, bottom: 272 };
const BAND_SAMPLES = 240;
const CONTRIBUTION_STEPS = 8;
export function bandChart(f, r, targetNm) {
    const box = BAND_BOX;
    const pad = Math.max(1.3 * f.fwhmNm, 3);
    const minNm = Math.floor(Math.min(f.centerNm - r.shiftMaxNm, targetNm) - pad);
    const maxNm = Math.ceil(Math.max(f.centerNm, targetNm) + pad);
    const sx = (nm) => box.left + ((nm - minNm) / (maxNm - minNm)) * (box.right - box.left);
    const sy = (t) => box.bottom - t * (box.bottom - box.top);
    const toPath = (pts) => linePath(pts.map((p) => [sx(p.nm), sy(p.t)]));
    // One pass over the rings gives every running sum.
    const perStep = r.rings.length / CONTRIBUTION_STEPS;
    const sums = Array.from({ length: CONTRIBUTION_STEPS }, () => []);
    for (let i = 0; i < BAND_SAMPLES; i++) {
        const nm = minNm + ((maxNm - minNm) * i) / (BAND_SAMPLES - 1);
        let acc = 0;
        r.rings.forEach((ring, k) => {
            acc += ring.weight * bandpass(nm, f.centerNm * ring.factor, f);
            if ((k + 1) % perStep === 0)
                sums[(k + 1) / perStep - 1].push({ nm, t: acc });
        });
    }
    const effective = toPath(sums[CONTRIBUTION_STEPS - 1]);
    const step = niceStep(maxNm - minNm, 10);
    const xTicks = [];
    for (let nm = Math.ceil(minNm / step) * step; nm <= maxNm + 1e-9; nm += step) {
        xTicks.push({ pos: sx(nm), label: String(Math.round(nm * 10) / 10) });
    }
    return {
        box,
        xTicks,
        yTicks: PERCENT_TICKS.map((t) => ({ pos: sy(t), label: String(Math.round(t * 100)) })),
        parallel: toPath(parallelCurve(f, minNm, maxNm, BAND_SAMPLES)),
        effective,
        effectiveArea: `${effective} L${box.right.toFixed(1)},${box.bottom} L${box.left},${box.bottom} Z`,
        contributions: sums.slice(0, -1).map(toPath),
        targetX: sx(targetNm),
    };
}
const APERTURE_SIZE = 220;
const APERTURE_R = 100;
const APERTURE_ZONES = 24;
/** Red (blocked) through amber to green (full transmission); `frac` is 0..1. */
export function transmissionColor(frac) {
    const stops = [[196, 64, 64], [217, 164, 65], [45, 138, 78]];
    const x = Math.min(1, Math.max(0, frac)) * 2;
    const i = x >= 1 ? 1 : 0;
    const k = x - i;
    const c = stops[i].map((v, j) => Math.round(v + (stops[i + 1][j] - v) * k));
    return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}
export function apertureView(f, r, targetNm) {
    const perZone = r.rings.length / APERTURE_ZONES;
    const rings = [];
    for (let z = 0; z < APERTURE_ZONES; z++) {
        const part = r.rings.slice(z * perZone, (z + 1) * perZone);
        const weight = part.reduce((s, ring) => s + ring.weight, 0);
        const t = part.reduce((s, ring) => s + ring.weight * bandpass(targetNm, f.centerNm * ring.factor, f), 0) / weight;
        const rhoIn = part[0].rhoIn;
        const rhoOut = part[part.length - 1].rhoOut;
        rings.push({
            r: ((rhoIn + rhoOut) / 2) * APERTURE_R,
            // A hair of overlap hides the seams between neighbouring strokes.
            width: (rhoOut - rhoIn) * APERTURE_R + 0.6,
            t,
            color: transmissionColor(t / f.peak),
        });
    }
    return {
        size: APERTURE_SIZE,
        center: APERTURE_SIZE / 2,
        outerR: APERTURE_R,
        obstructionR: r.rings[0].rhoIn * APERTURE_R,
        rings,
    };
}
const SWEEP_BOX = { w: 460, h: 220, left: 46, top: 14, right: 446, bottom: 182 };
const SWEEP_STEPS = 80;
const SWEEP_MIN = 1.6;
export function sweepChart(f, optics, targetNm, atTarget) {
    const { fRatio, obstruction } = optics;
    const box = SWEEP_BOX;
    const fMax = Math.min(20, Math.max(7, Math.ceil(fRatio) + 1));
    const fMin = Math.min(SWEEP_MIN, Math.max(0.8, Math.floor(fRatio * 5) / 5 - 0.2));
    const sx = (v) => box.left + ((v - fMin) / (fMax - fMin)) * (box.right - box.left);
    const sy = (t) => box.bottom - t * (box.bottom - box.top);
    const pts = sweepFocalRatio(f, obstruction, targetNm, fMin, fMax, SWEEP_STEPS);
    const line = linePath(pts.map((p) => [sx(p.fRatio), sy(p.t)]));
    const step = niceStep(fMax - fMin, 8);
    const xTicks = [];
    for (let v = Math.ceil(fMin / step) * step; v <= fMax + 1e-9; v += step) {
        xTicks.push({ pos: sx(v), label: `f/${Math.round(v * 10) / 10}` });
    }
    return {
        box,
        xTicks,
        yTicks: PERCENT_TICKS.map((t) => ({ pos: sy(t), label: String(Math.round(t * 100)) })),
        line,
        area: `${line} L${box.right.toFixed(1)},${box.bottom} L${box.left},${box.bottom} Z`,
        marker: { x: sx(fRatio), y: sy(atTarget) },
    };
}
