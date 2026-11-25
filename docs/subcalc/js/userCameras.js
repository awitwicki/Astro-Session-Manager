// Generated from src/lib/userCameras.ts by scripts/sync-subcalc.mjs. Do not edit.
import { matchInstrume } from './cameraCatalog.js';
function parsePositive(v) {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
}
/** FITS writers often store floats as float32, so -20.1 arrives as
 *  -20.1000003814697; `digits` decimals is all these values ever carry. */
function round(n, digits) {
    return n === null ? null : Number(n.toFixed(digits));
}
/** Collects, per distinct INSTRUME of light frames across the whole
 *  library, the number of subs and the values from the latest session that
 *  has a header. A session whose lights all lack a header (so its camera
 *  can't be determined), or whose first headered light has an empty
 *  INSTRUME, is skipped entirely; otherwise every light in the session
 *  counts toward that camera's subs, even ones without their own header. */
export function collectUserCameras(projects, catalog) {
    const byInstrume = new Map();
    for (const project of projects) {
        for (const filterGroup of project.filters) {
            for (const session of filterGroup.sessions) {
                const firstWithHeader = session.lights.find((l) => l.header);
                const header = firstWithHeader?.header;
                const instrume = typeof header?.instrume === 'string' ? header.instrume.trim() : '';
                if (!header || !instrume)
                    continue;
                let acc = byInstrume.get(instrume);
                if (!acc) {
                    acc = {
                        subs: 0, latestDate: null, gain: null, sensorTemp: null,
                        focalRatio: null, focalLength: null, pixelSize: null, filter: null,
                    };
                    byInstrume.set(instrume, acc);
                }
                acc.subs += session.lights.length;
                if (acc.latestDate === null || session.date > acc.latestDate) {
                    acc.latestDate = session.date;
                    acc.gain = typeof header.gain === 'number' && Number.isFinite(header.gain) ? header.gain : null;
                    acc.sensorTemp = typeof header.ccdTemp === 'number' && Number.isFinite(header.ccdTemp) ? round(header.ccdTemp, 1) : null;
                    acc.filter = typeof header.filter === 'string' && header.filter.trim() !== '' ? header.filter : null;
                    acc.focalRatio = round(parsePositive(header.raw?.FOCRATIO), 2);
                    acc.focalLength = round(parsePositive(header.raw?.FOCALLEN), 0);
                    acc.pixelSize = round(parsePositive(header.raw?.XPIXSZ), 2);
                }
            }
        }
    }
    const result = [...byInstrume.entries()].map(([instrume, acc]) => ({
        instrume,
        subs: acc.subs,
        camera: matchInstrume(catalog, instrume),
        gain: acc.gain,
        sensorTemp: acc.sensorTemp,
        focalRatio: acc.focalRatio,
        focalLength: acc.focalLength,
        pixelSize: acc.pixelSize,
        filter: acc.filter,
    }));
    result.sort((a, b) => b.subs - a.subs);
    return result;
}
export const DEFAULT_STATE = {
    cameraId: null,
    modeId: null,
    overridesByCamera: {},
    skyMode: 'bortle',
    bortle: 5,
    sqm: '20.0',
    filterId: 'none',
    customFilterPct: '',
    focalRatio: '',
    sensorTemp: '',
    extraNoise: 0.05,
    compare: [],
    focalRatioByCamera: {},
};
const MAX_COMPARE = 5;
function isPlainObject(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}
/** A 'custom' camera or an unmatched user camera ('user:<instrume>') has no
 *  catalog entry to validate against, so it's always kept as saved. */
function isUnvalidatedCameraId(id) {
    return id === 'custom' || id.startsWith('user:');
}
/** Restores the calculator's saved state, discarding anything that no
 *  longer resolves against the current catalog (a removed camera id, a mode
 *  id that camera no longer has) instead of failing. Any value with the
 *  wrong shape falls back to `DEFAULT_STATE`'s own value, field by field. */
export function restoreState(saved, catalog) {
    if (!isPlainObject(saved))
        return { ...DEFAULT_STATE };
    const str = (v, fallback) => (typeof v === 'string' ? v : fallback);
    const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
    const skyMode = saved.skyMode === 'sqm' ? 'sqm' : 'bortle';
    let cameraId = typeof saved.cameraId === 'string' ? saved.cameraId : null;
    let modeId = typeof saved.modeId === 'string' ? saved.modeId : null;
    if (cameraId !== null && !isUnvalidatedCameraId(cameraId)) {
        const camera = catalog.find((c) => c.id === cameraId);
        if (!camera) {
            cameraId = null;
            modeId = null;
        }
        else if (modeId !== null && !camera.modes.some((m) => m.id === modeId)) {
            modeId = null;
        }
    }
    const rawCompare = Array.isArray(saved.compare) ? saved.compare : [];
    const compare = rawCompare
        .filter((entry) => {
        if (!isPlainObject(entry) || typeof entry.cameraId !== 'string' || typeof entry.modeId !== 'string')
            return false;
        const camera = catalog.find((c) => c.id === entry.cameraId);
        return !!camera && camera.modes.some((m) => m.id === entry.modeId);
    })
        .slice(0, MAX_COMPARE);
    const focalRatioByCamera = isPlainObject(saved.focalRatioByCamera)
        ? Object.fromEntries(Object.entries(saved.focalRatioByCamera).filter((entry) => typeof entry[1] === 'string'))
        : {};
    const overridesByCamera = isPlainObject(saved.overridesByCamera)
        ? Object.fromEntries(Object.entries(saved.overridesByCamera).filter((entry) => isPlainObject(entry[1])))
        : {};
    return {
        cameraId,
        modeId,
        overridesByCamera,
        skyMode,
        bortle: num(saved.bortle, DEFAULT_STATE.bortle),
        sqm: str(saved.sqm, DEFAULT_STATE.sqm),
        filterId: str(saved.filterId, DEFAULT_STATE.filterId),
        customFilterPct: str(saved.customFilterPct, DEFAULT_STATE.customFilterPct),
        focalRatio: str(saved.focalRatio, DEFAULT_STATE.focalRatio),
        sensorTemp: str(saved.sensorTemp, DEFAULT_STATE.sensorTemp),
        extraNoise: num(saved.extraNoise, DEFAULT_STATE.extraNoise),
        compare,
        focalRatioByCamera,
    };
}
