// Generated from src/lib/subExposure.ts by scripts/sync-subcalc.mjs. Do not edit.
export const SUB_LADDER = [
    1, 2, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 300, 450, 600, 900, 1200, 1800,
];
export const NOISE_OPTIONS = [0.02, 0.05, 0.10];
export const FILTER_PRESETS = [
    { id: 'none', label: 'None / L / UV-IR cut', share: 1.0 },
    { id: 'rgb', label: 'R, G or B (mono)', share: 0.33 },
    { id: 'lp', label: 'Light-pollution (L-Pro, CLS)', share: 0.40 },
    { id: 'dualWide', label: 'Dual-band, wide (L-eNhance)', share: 0.12 },
    { id: 'dual7', label: 'Dual-band 7 nm (L-eXtreme)', share: 0.06 },
    { id: 'nb7', label: 'Narrowband 7 nm', share: 0.023 },
    { id: 'nb3', label: 'Narrowband 3 nm', share: 0.01 },
];
// Derivation: a magnitude-0 source in V gives about 9950 photons/s/cm^2/nm
// (standard photometric zero point). Integrated over a 300 nm visual band
// (400-700 nm) and converted from "per arcsec^2, per cm^2 of aperture" to
// "per um^2 of pixel at focal ratio N" (factor pi/4 * 206265^2 * 1e-8 = 334,
// folding arcsec^2-to-steradian, cm^2-to-um^2 and the f/N aperture-to-pixel
// relation into one constant) gives roughly 9950 * 300 * 334 = 9.97e8.
//
// Checked against an independent reference: Robin Glover (SharpCap's
// author), SharpCap forum, 20 Apr 2022
// (https://forums.sharpcap.co.uk/viewtopic.php?p=29102): "I estimate a sky
// background brightness of 1.75e/pix/s for your setup" for an ASI533MC
// (3.76 micron pixels, 80% QE, no filter) at Bortle 5 (SQM 20.0 in our
// BORTLE_ROWS), f/4.8. With K = 1.0e9 this model gives 1.717 e-/px/s for
// that rig — within 2% of Glover's own estimate — so the derived value
// ships rather than a value fitted to any one source. Results will still
// run several to ten times shorter than AstroSubCalc's own calculator for
// broadband skies; see the design doc's Calibration section.
export const SKY_FLUX_K = 1.0e9;
const COLOR_FACTOR = 0.35;
const SKY_FILL_LIMIT = 0.25;
const VERY_LONG_SECONDS = 600;
function isPositiveFinite(v) {
    return Number.isFinite(v) && v > 0;
}
/** The Glover constant: 1 / ((1 + extraNoise)^2 - 1). */
export function gloverC(extraNoise) {
    return 1 / ((1 + extraNoise) ** 2 - 1);
}
/** Sky background rate in e-/px/s. */
export function skyRate(s, c) {
    const colorFactor = s.mono ? 1.0 : COLOR_FACTOR;
    const qeFraction = s.qe / 100;
    return SKY_FLUX_K * 10 ** (-0.4 * c.sqm) * s.pixelSize ** 2 / c.focalRatio ** 2
        * qeFraction * colorFactor * c.filterShare;
}
/** Dark current rate in e-/px/s, doubling every `darkDoubling` °C. */
export function darkRate(s, sensorTemp) {
    return s.darkRef * 2 ** ((sensorTemp - s.darkRefTemp) / s.darkDoubling);
}
function nextLadderStep(seconds) {
    for (const step of SUB_LADDER)
        if (step >= seconds)
            return step;
    return SUB_LADDER[SUB_LADDER.length - 1];
}
export function subExposure(s, c) {
    if (!isPositiveFinite(s.pixelSize) || !isPositiveFinite(s.qe) || !isPositiveFinite(s.readNoise)
        || !isPositiveFinite(s.fullWell) || !isPositiveFinite(s.bitDepth) || !isPositiveFinite(s.darkDoubling)
        || !Number.isFinite(s.darkRef) || s.darkRef < 0 || !Number.isFinite(s.darkRefTemp)) {
        return null;
    }
    if (!Number.isFinite(c.sqm) || !isPositiveFinite(c.focalRatio) || !isPositiveFinite(c.filterShare)
        || !Number.isFinite(c.sensorTemp) || !isPositiveFinite(c.extraNoise)) {
        return null;
    }
    const sky = skyRate(s, c);
    const dark = darkRate(s, c.sensorTemp);
    const aduGain = s.fullWell / 2 ** s.bitDepth;
    const readNoiseEff = Math.sqrt(s.readNoise ** 2 + (aduGain ** 2) / 12);
    const denom = sky + dark;
    if (denom <= 0)
        return null;
    const minSub = gloverC(c.extraNoise) * readNoiseEff ** 2 / denom;
    const suggested = nextLadderStep(minSub);
    const skyFill = (denom * suggested) / s.fullWell;
    const clipTime = s.fullWell / denom;
    let verdict;
    if (dark > sky)
        verdict = 'darkLimited';
    else if (skyFill > SKY_FILL_LIMIT)
        verdict = 'clipping';
    else if (minSub > VERY_LONG_SECONDS)
        verdict = 'veryLong';
    else
        verdict = 'ok';
    return { skyRate: sky, darkRate: dark, readNoiseEff, minSub, suggested, skyFill, clipTime, verdict };
}
export function sweepByFocalRatio(s, c, from = 2, to = 12, steps = 41) {
    const points = [];
    for (let i = 0; i < steps; i++) {
        const n = from + ((to - from) * i) / (steps - 1);
        const result = subExposure(s, { ...c, focalRatio: n });
        if (result)
            points.push({ n, t: result.minSub });
    }
    return points;
}
export function sensorParams(camera, mode) {
    return {
        mono: camera.mono,
        pixelSize: camera.pixelSize,
        qe: camera.qe,
        readNoise: mode.readNoise,
        fullWell: mode.fullWell,
        bitDepth: camera.bitDepth,
        darkRef: camera.darkRef,
        darkRefTemp: camera.darkRefTemp,
        darkDoubling: camera.darkDoubling,
    };
}
const DEFAULT_AIR_TEMP = 15;
const MIN_COOLED_TEMP = -10;
/** Cooled: the colder of the set point and max(-10 °C, air - maxCooling).
 *  Uncooled: the air temperature. */
export function defaultSensorTemp(camera, airTemp = DEFAULT_AIR_TEMP) {
    if (camera.maxCooling === null)
        return airTemp;
    return Math.max(MIN_COOLED_TEMP, airTemp - camera.maxCooling);
}
export function formatSub(seconds) {
    const total = Math.round(seconds);
    if (total < 60)
        return `${total} s`;
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const sec = total % 60;
    if (h > 0) {
        const parts = [`${h} h`];
        if (m > 0)
            parts.push(`${m} min`);
        return parts.join(' ');
    }
    const parts = [`${m} min`];
    if (sec > 0)
        parts.push(`${sec} s`);
    return parts.join(' ');
}
