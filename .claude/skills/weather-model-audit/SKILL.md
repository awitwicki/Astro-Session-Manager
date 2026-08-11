---
name: weather-model-audit
description: Re-run or consult the Open-Meteo cloud-forecast accuracy audit for the primary observing site (Bieszczady). Use when changing the weather model, doubting forecast accuracy, or re-verifying in a new season.
---

# Weather Model Accuracy Audit

Reference results and reproducible methodology for choosing the Open-Meteo model
behind the Weather page. Last run: **2026-08-08** (summer window). Re-run in
stratus season (Oct–Feb) before trusting the ranking year-round.

## Site & code facts

- Primary observing site: **lat 49.2645810, lon 22.6850088** (Bieszczady, SE Poland,
  ~716 m, timezone Europe/Warsaw).
- The forecast fetch lives in **two files that must stay in sync**:
  `src/lib/weather.ts` (desktop app) and `docs/astroweather/js/weather.js` (gh-pages,
  the version the user actually checks).
- Current setup (since 2026-08-08): the app requests
  `models=chmi_aladin_seamless,ecmwf_ifs025,icon_eu` and shows an
  accuracy-weighted cloud blend — **ALADIN 0.32, ECMWF 0.44, ICON-EU 0.24**
  (∝ 1/night-MAE from this audit), renormalized per hour over non-null models.
  Non-cloud variables come from ALADIN (the only blend model with all 13
  variables). A re-audit should update the weight constants `CLOUD_MODELS` in
  BOTH `src/lib/weather.ts` and `docs/astroweather/js/weather.js`.
- Default `best_match` at this site resolves to **DMI HARMONIE AROME**
  (byte-identical to `dmi_seamless`), NOT ICON — ICON-D2's domain ends at 20.34°E.
  Composition may change as Open-Meteo adds models; re-verify by diffing arrays.
- Windy's ALADIN layer = the same CHMI model. ClearOutside = Meteosource ML blend
  (no single named model). ECMWF `ecmwf_ifs025` has **no visibility** variable.

## Baseline results (2026-08-08 audit)

Window 2026-07-24..2026-08-07 (14 complete nights, 10 clear), truth = ERA5
reanalysis, lead = 24 h (`cloud_cover_previous_day1`), night = 21:00–03:59 local,
night mean over 7 hours, "clear" = night mean < 20%.

| Model | Night MAE vs ERA5 (pp) | r (night means) | Clear nights: hits/10, false alarms |
|---|---|---|---|
| ecmwf_ifs025 | **10.9** | 0.74 | 9, 2 FA |
| chmi_aladin_seamless | 15.0 | **0.88** | **9, 0 FA** |
| meteofrance_seamless | 16.9 | 0.73 | 7, 1 FA |
| ukmo_seamless | 17.3 | 0.31 | 8, 3 FA |
| best_match (=dmi_seamless) | 19.3 | 0.41 | 9, 2 FA |
| icon_seamless (=icon_eu here) | 20.5 | 0.70 | 7, 0 FA |
| knmi_seamless | 21.8 | 0.44 | 8, 2 FA |
| gfs_seamless | 22.8 | 0.61 | 7, 0 FA |

At 48 h lead ALADIN stays strong (night MAE 16.0, 8 hits/1 FA); GFS degrades hardest
(25.0, 4 hits/6 misses). Error character: ICON/GFS pessimistic-cloudy at this site
(lose clear nights), DMI/ECMWF slightly optimistic (occasional wasted trip).

Decision: **chmi_aladin_seamless** — best go/no-go skill and highest correlation,
2.3 km resolution fits mountain terrain, matches the Windy layer the user
cross-checks, and carries every variable the UI needs. ECMWF ifs025 is the
runner-up (best hourly MAE) but lacks visibility and uses a ~25 km grid.

Caveats: single summer fortnight (Previous Runs API only archives ~15 days);
ERA5 is ~25 km and smooths orographic cloud; ECMWF has documented winter
low-stratus underestimation over central Europe.

## Practical heuristic (community advice the user trusts)

Season-dependent model pair + satellite nowcast check: keep two candidate models
(winter: ECMWF vs ICON-EU; summer per the audit: ECMWF vs ALADIN), then before an
imaging night compare a **current satellite image** against each model's forecast
for the current hour — whichever model matches the real sky *now* is the one to
trust for tonight. Rationale: a model that already misses the current state started
from wrong initial conditions. The user reports this gives "0 fails". A future
Weather-page feature could support this workflow (satellite layer + hour-0 cloud
values from 2–3 models side by side); satellite imagery sources to evaluate:
EUMETSAT Meteosat real-time products (EUMETView WMS), sat24-style tiles.

## How to re-run

1. **Truth series** (ERA5/ERA5T, ~5-day publication lag):
   `https://archive-api.open-meteo.com/v1/archive?latitude=49.2645810&longitude=22.6850088&start_date=<START>&end_date=<END>&hourly=cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high&timezone=Europe/Warsaw`
2. **Per-model archived forecasts at fixed lead** (Previous Runs API, retains ~15 days):
   `https://previous-runs-api.open-meteo.com/v1/forecast?latitude=...&longitude=...&start_date=<START>&end_date=<END>&hourly=cloud_cover,cloud_cover_previous_day1,cloud_cover_previous_day2&models=<MODEL>&timezone=Europe/Warsaw`
   — `cloud_cover` is the freshest (day-0) run, `..._previous_day1` is the 24 h-lead
   forecast for the same timestamp.
3. **Metrics** (per model, day1 and day2): MAE and bias vs ERA5 over all hours and
   night hours; Pearson r of per-night means; clear-night confusion matrix at the
   20% threshold (report 30% as sensitivity check). Use only complete nights
   (all 7 hours present); a night belongs to its starting date.
4. **best_match identity check**: fetch `models=best_match,dmi_seamless,...`
   candidates in one call and diff the cloud arrays for byte-identity.
5. Models worth scoring: best_match, chmi_aladin_seamless, ecmwf_ifs025,
   icon_seamless, gfs_seamless, ukmo_seamless, meteofrance_seamless, knmi_seamless,
   dmi_seamless. (icon_d2 does not cover the site — HTTP 400.)

Pitfall from the 2026-08-08 run: when several agents write per-model CSVs in
parallel, verify the files differ (MD5) — one run produced three byte-identical
CSVs that silently held the same model's data.
