// Generated from src/lib/fbsc.ts by scripts/sync-filtercalc.mjs. Do not edit.
// Filter bandpass shift calculator.
//
// An interference filter passes a narrow band only for light that hits it
// head-on. Tilt the ray and the band slides towards the blue:
//
//   λ(θ) = λ0 · sqrt(1 − (sin θ / n_eff)²)            (n of air taken as 1)
//
// In a telescope every zone of the aperture sends its light through the
// filter at its own angle, tan θ = r / f. The band the camera actually sees is
// therefore the sum of many slightly shifted copies of the filter's band, each
// weighted by the area of the aperture ring it comes from:
//
//   T_eff(λ) = Σ area_i · T(λ, θ_i) / Σ area_i
//
// A central obstruction removes the small-angle rings, so the remaining light
// is shifted more. Model and notation follow Baader Planetarium, "Narrowband
// Filters on Astronomical Telescopes" (2022); the flat-top Gaussian band shape
// is the one from Cuiv's spreadsheet and Orphi's online calculator.
//
// Only the focal ratio and the obstruction as a fraction of the aperture
// diameter matter, so the geometry is kept in units of the aperture radius.
//
// Mirrored for the website by `yarn sync:filtercalc`.
export const DEFAULT_RING_COUNT = 120;
const FWHM_TO_SIGMA = 2 * Math.sqrt(2 * Math.LN2);
export function opticsFromScope(apertureMm, focalLengthMm, obstructionMm) {
    if (![apertureMm, focalLengthMm, obstructionMm].every(Number.isFinite))
        return null;
    if (apertureMm <= 0 || focalLengthMm <= 0)
        return null;
    return { fRatio: focalLengthMm / apertureMm, obstruction: obstructionMm / apertureMm };
}
function validFilter(f) {
    const { centerNm, fwhmNm, flatTopNm, peak, nEff } = f;
    if (![centerNm, fwhmNm, flatTopNm, peak, nEff].every(Number.isFinite))
        return false;
    return centerNm > 0 && fwhmNm > 0 && flatTopNm >= 0 && flatTopNm < fwhmNm
        && peak > 0 && peak <= 1 && nEff >= 1;
}
function validOptics(o) {
    if (!Number.isFinite(o.fRatio) || !Number.isFinite(o.obstruction))
        return false;
    return o.fRatio > 0 && o.obstruction >= 0 && o.obstruction < 1;
}
/** Transmission at `lambdaNm` of the filter's band moved to `centerNm`. */
export function bandpass(lambdaNm, centerNm, f) {
    const beyondFlat = Math.abs(lambdaNm - centerNm) - f.flatTopNm / 2;
    if (beyondFlat <= 0)
        return f.peak;
    const sigma = (f.fwhmNm - f.flatTopNm) / FWHM_TO_SIGMA;
    return f.peak * Math.exp(-(beyondFlat * beyondFlat) / (2 * sigma * sigma));
}
/** λ(θ) / λ0. */
export function shiftFactor(angleRad, nEff) {
    const s = Math.sin(angleRad) / nEff;
    return Math.sqrt(1 - s * s);
}
/** Equal-width rings from the obstruction edge to the aperture edge. */
export function buildRings(optics, nEff, count = DEFAULT_RING_COUNT) {
    const { fRatio, obstruction } = optics;
    const width = (1 - obstruction) / count;
    const clearArea = 1 - obstruction * obstruction;
    const rings = [];
    for (let i = 0; i < count; i++) {
        const rhoIn = obstruction + i * width;
        const rhoOut = rhoIn + width;
        const angleRad = Math.atan((rhoIn + rhoOut) / 2 / (2 * fRatio));
        rings.push({
            rhoIn,
            rhoOut,
            angleRad,
            weight: (rhoOut * rhoOut - rhoIn * rhoIn) / clearArea,
            factor: shiftFactor(angleRad, nEff),
        });
    }
    return rings;
}
/** Whole-aperture transmission at `lambdaNm` for a filter centred at `centerNm`. */
export function effectiveAt(lambdaNm, centerNm, f, rings) {
    let sum = 0;
    for (const r of rings)
        sum += r.weight * bandpass(lambdaNm, centerNm * r.factor, f);
    return sum;
}
export function effectiveCurve(f, rings, minNm, maxNm, samples) {
    const pts = [];
    for (let i = 0; i < samples; i++) {
        const nm = minNm + ((maxNm - minNm) * i) / (samples - 1);
        pts.push({ nm, t: effectiveAt(nm, f.centerNm, f, rings) });
    }
    return pts;
}
export function parallelCurve(f, minNm, maxNm, samples) {
    const pts = [];
    for (let i = 0; i < samples; i++) {
        const nm = minNm + ((maxNm - minNm) * i) / (samples - 1);
        pts.push({ nm, t: bandpass(nm, f.centerNm, f) });
    }
    return pts;
}
const SCAN_STEP_NM = 0.02;
export function analyze(f, optics, targetNm) {
    if (!validFilter(f) || !validOptics(optics))
        return null;
    if (!Number.isFinite(targetNm) || targetNm <= 0)
        return null;
    const rings = buildRings(optics, f.nEff);
    const thetaMinRad = Math.atan(optics.obstruction / (2 * optics.fRatio));
    const thetaMaxRad = Math.atan(1 / (2 * optics.fRatio));
    const kEdge = shiftFactor(thetaMaxRad, f.nEff);
    const meanFactor = rings.reduce((s, r) => s + r.weight * r.factor, 0);
    // Shape of the effective band: peak, then the two half-peak crossings.
    const lo = f.centerNm * kEdge - 2 * f.fwhmNm;
    const hi = f.centerNm + 2 * f.fwhmNm;
    const n = Math.ceil((hi - lo) / SCAN_STEP_NM) + 1;
    const curve = effectiveCurve(f, rings, lo, hi, n);
    let peakIdx = 0;
    for (let i = 1; i < n; i++)
        if (curve[i].t > curve[peakIdx].t)
            peakIdx = i;
    const peakT = curve[peakIdx].t;
    // A flat top gives a run of equal maxima; report its middle.
    let peakEnd = peakIdx;
    while (peakEnd + 1 < n && curve[peakEnd + 1].t >= peakT - 1e-9)
        peakEnd++;
    const peakNm = (curve[peakIdx].nm + curve[peakEnd].nm) / 2;
    const half = peakT / 2;
    const crossing = (a, b) => a.nm + ((half - a.t) / (b.t - a.t)) * (b.nm - a.nm);
    let left = curve[0].nm;
    for (let i = peakIdx; i > 0; i--) {
        if (curve[i - 1].t < half) {
            left = crossing(curve[i - 1], curve[i]);
            break;
        }
    }
    let right = curve[n - 1].nm;
    for (let i = peakEnd; i < n - 1; i++) {
        if (curve[i + 1].t < half) {
            right = crossing(curve[i + 1], curve[i]);
            break;
        }
    }
    // Which parallel-beam centre lands the most light on the target line.
    let bestAtTarget = -1;
    let bestSum = 0;
    let bestCount = 0;
    const cLo = targetNm - f.fwhmNm;
    const cHi = targetNm / kEdge + f.fwhmNm;
    for (let c = cLo; c <= cHi; c += SCAN_STEP_NM) {
        const t = effectiveAt(targetNm, c, f, rings);
        if (t > bestAtTarget + 1e-9) {
            bestAtTarget = t;
            bestSum = c;
            bestCount = 1;
        }
        else if (t >= bestAtTarget - 1e-9) {
            bestSum += c;
            bestCount++;
        }
    }
    return {
        atTarget: effectiveAt(targetNm, f.centerNm, f, rings),
        parallelAtTarget: bandpass(targetNm, f.centerNm, f),
        thetaMinRad,
        thetaMaxRad,
        shiftMinNm: f.centerNm * (1 - shiftFactor(thetaMinRad, f.nEff)),
        shiftMaxNm: f.centerNm * (1 - kEdge),
        meanShiftNm: f.centerNm * (1 - meanFactor),
        peakNm,
        peakT,
        effCenterNm: (left + right) / 2,
        effFwhmNm: right - left,
        bestCenterNm: bestSum / bestCount,
        bestAtTarget,
        rings,
    };
}
/** Transmission at the target line as the telescope gets faster or slower. */
export function sweepFocalRatio(f, obstruction, targetNm, fMin, fMax, steps) {
    const out = [];
    for (let i = 0; i < steps; i++) {
        const fRatio = fMin + ((fMax - fMin) * i) / (steps - 1);
        const rings = buildRings({ fRatio, obstruction }, f.nEff, 60);
        out.push({ fRatio, t: effectiveAt(targetNm, f.centerNm, f, rings) });
    }
    return out;
}
// Baader's own line-up, tables 1 and 2 of the paper: which pre-shift class
// they sell for a focal ratio. Sorted by focal ratio alone; their selection
// charts additionally move the borders with obstruction and temperature.
export function baaderCategory(fwhmNm, fRatio) {
    if (fwhmNm > 4.5) {
        return fRatio > 3.4
            ? { family: 'Narrowband', name: 'Narrowband', range: 'slower than f/3.4' }
            : { family: 'Narrowband', name: 'Highspeed f/2', range: 'f/3.4 and faster' };
    }
    if (fRatio > 3.4)
        return { family: 'Ultra-Narrowband', name: 'Ultra-Narrowband', range: 'slower than f/3.4' };
    if (fRatio >= 2.3)
        return { family: 'Ultra-Narrowband', name: 'Ultra-Highspeed f/3', range: 'f/2.3 to f/3.4' };
    return { family: 'Ultra-Narrowband', name: 'Ultra-Highspeed f/2', range: 'faster than f/2.3' };
}
/** Display colour of a wavelength, for the emission-line marker. */
export function lineColor(nm) {
    let r = 0, g = 0, b = 0;
    if (nm < 440) {
        r = (440 - nm) / 60;
        b = 1;
    }
    else if (nm < 490) {
        g = (nm - 440) / 50;
        b = 1;
    }
    else if (nm < 510) {
        g = 1;
        b = (510 - nm) / 20;
    }
    else if (nm < 580) {
        r = (nm - 510) / 70;
        g = 1;
    }
    else if (nm < 645) {
        r = 1;
        g = (645 - nm) / 65;
    }
    else {
        r = 1;
    }
    // Keep deep red and violet visible on a dark chart.
    const lift = 0.25;
    const ch = (v) => Math.round(255 * (lift + (1 - lift) * Math.min(1, Math.max(0, v))));
    return `rgb(${ch(r)}, ${ch(g)}, ${ch(b)})`;
}
