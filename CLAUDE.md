# Astro Session Manager

Desktop application for managing astrophotography imaging sessions and master calibration libraries. Built with Tauri (Rust backend + React frontend).

## Agent Rules

- **Do not make git commits** unless the user explicitly asks for one. Edit files, run tests/builds, report results — but leave commits, branches, tags, and pushes to the user. This applies to every session regardless of task size.
- **Do not create git branches or worktrees** on your own. Work on whatever branch is currently checked out.
- **Never use destructive git operations** (`reset --hard`, `push --force`, `branch -D`, `stash drop`, etc.) without an explicit request for that exact operation.
- **Do not add compatibility shims or dead code** "for later removal." If a refactor leaves the tree temporarily broken mid-task, keep going to finish it — don't patch around partial state with stubs.

## Tech Stack

**Frontend:** React 19.2, TypeScript 6.0 (typescript-eslint does not support 7.x yet), Vite 8 (rolldown), Zustand 5 (state), React Router DOM 7 (hash routing), Lucide React 1.x (icons), `d3-celestial` (SkyMap), `leaflet` (Weather map), `astronomy-engine` (Planner ephemerides), React Compiler via `@rolldown/plugin-babel` + `babel-plugin-react-compiler` (`reactCompilerPreset` in `vite.config.ts`), custom CSS with CSS variables (dark/light themes via `data-theme` attribute).

**Backend:** Tauri 2.11, Rust edition 2021 (MSRV 1.89.0 — informational, tracks the highest dep requirement; CI builds on stable). Key crates:
- `rustafits` 1.1 — FITS/XISF reading, preview pipeline, star analysis and JPEG encoding (`encode_jpeg`, pure-Rust libjpeg-turbo — no cmake/nasm needed). Imported as `astroimage` — this is the crate's `[lib] name`, not a separate dep. `image` is only a dev-dependency (JPEG decoding in tests).
- `lru` 0.18 — bounded preview cache
- `rawler` 0.8 + `nom-exif` 3 — DSLR raw decoding (CR2/CR3/ARW) and EXIF
- `tokio` 1 (sync + time features), `rayon` 1 — async + parallel
- `walkdir`, `regex`, `chrono`, `base64`, `trash`
- `serde` / `serde_json`
- `tauri-plugin-log`, `tauri-plugin-dialog`, `tauri-plugin-opener`

**Build:** Vite dev server on port 5173, ESLint 10 flat config, TypeScript strict mode, React compiler enabled.

**CI/CD:** GitHub Actions — auto-tag + cross-platform release builds (macOS ARM64/Intel, Windows NSIS, Linux DEB/AppImage).

## Project Structure

```
src/                          # Frontend (React + TypeScript)
  routes/                     # Dashboard, ProjectView, FitsDetailView,
                              # MastersLibrary, Settings, SkyMap, Weather,
                              # Converter, Planner, PlannerDetail
  components/layout/          # AppShell, TopBar, Sidebar, StatusBar
  components/astroweather/    # WeatherForecast, SeasonalDaylightChart,
                              # LightPollutionMap, HorizonEditor, SatelliteCheck
  components/skymap/          # ClassicSkyView, PlannerSkyView,
                              # PlannerTimeToolbar, PlannerTargetPanel
  store/appStore.ts           # Zustand store (scan state, analysis, queues,
                              # previewQueue slice mirrored from backend)
  context/ThemeContext.tsx    # Theme provider
  types/                      # TypeScript interfaces
  hooks/                      # Custom hooks (useProjects, useImportQueue, etc.)
  lib/                        # Utilities (constants, formatters, previewQueue listener, hips)
  styles/                     # Global CSS + variables

src-tauri/src/                # Backend (Rust)
  commands.rs                 # Tauri command handlers (~30 commands)
  scanner.rs                  # Directory scanning (Project → Filter → Session → Lights/Flats)
  analyzer.rs                 # Sub-frame analysis (FWHM, stars, eccentricity) via rustafits
  fits_parser.rs              # FITS header parsing with keyword aliases
  fits_writer.rs              # FITS file writing (used by DSLR converter)
  xisf_parser.rs              # XISF format parsing
  fits_preview.rs             # FITS → JPEG preview generation + bounded LRU cache
  preview_queue.rs            # Persistent priority queue + worker loop for previews
  masters.rs                  # Master frames library (darks/biases/flats matching)
  dslr_parser.rs              # DSLR raw (.cr2/.cr3/.arw) header + EXIF parsing
  converter.rs                # DSLR raw → FITS conversion command
  settings.rs                 # Persistent key-value settings
  cache.rs                    # Filesystem-based header cache
  cancellation.rs             # Global atomic cancel flags (scan/analyze/import/convert)
  types.rs                    # Shared Rust types (crossed the IPC boundary)
  lib.rs                      # Tauri builder, plugin registration, background sweeper
  main.rs                     # Entry point
```

## Build & Run

```sh
yarn              # install frontend deps
yarn tauri dev    # dev mode (Vite + Rust)
yarn tauri build  # production build
cargo test --lib  # Rust unit tests (from src-tauri/)
yarn tsc -b       # frontend typecheck (root tsconfig.json is references-only;
                  # `tsc --noEmit` against it silently checks 0 files — always use -b)
yarn lint         # frontend lint
yarn test:web     # frontend unit tests (node:test via tsx)
```

## Versioning

- The app version lives **only** in `package.json` — `tauri.conf.json` points at
  it, and `src-tauri/Cargo.toml`'s `version` is unused. Never edit those two.
- When finishing a user-visible change, bump `package.json`: **minor** for new
  features or behavior changes, **patch** for bug fixes. Skip the bump for
  refactors, docs, or CI-only changes.
- On push to `main`, CI reads the version, and if tag `v<version>` doesn't exist
  yet, creates it and builds a cross-platform release — so a merged bump ships.

## Key Patterns

- Frontend calls Rust via Tauri IPC commands (defined in `commands.rs`, registered in `lib.rs`).
- Long operations emit progress events via Tauri window events; the preview queue emits state snapshots (`preview:queue_state`) while holding its mutex so events are ordered.
- FITS parsing handles keyword aliases for N.I.N.A., ASIAIR, SGPro, SharpCap.
- Preview generation (`fits_preview.rs`): rustafits `ImageConverter::read_raw` → `process_data` → `encode_jpeg` (max 1920×1080, quality 90). For FITS the metadata's `flip_vertical` is cleared before processing so previews stay in raw pixel space (rustafits ≥ 1.0 would flip files without `ROWORDER` bottom-up) and line up with the star overlay from `analyzer.rs`, which never flips; XISF is left as rustafits reads it. A unit test pins this. Results are cached by file path in a bounded LRU (default 500 MB, 30 min TTL, runtime-adjustable concurrency). rustafits' full-resolution VNG debayer is deliberately not used here — previews are downscaled anyway and the super-pixel path inside `process_data` is the cheaper fit.
- Preview/star-analysis prefetch uses a persistent global queue (`preview_queue.rs`): navigating frames calls `enqueue_prefetch_window`, which replaces pending work with the selected frame ±3 (preview job per path, plus star-detail job when heatmap/tilt overlays are on). Direct `get_fits_preview` / `analyze_stars_detail` commands hold a foreground guard that pauses new queue admissions so the visible frame renders first; per-path single-flight (`single_flight.rs`) prevents duplicate concurrent generation.
- Masters matching: by exposure (±0.5 s), temperature (configurable tolerance), resolution.
- Supported formats: FITS (`.fits`, `.fit`, `.fts`), XISF (`.xisf`), DSLR RAW (`.cr2`, `.cr3`, `.arw`).
- Error handling: `Result<T, String>` across the IPC boundary — Rust errors become plain strings for the frontend.
- Async: `tauri::async_runtime::spawn_blocking` for CPU-intensive work; `tokio::spawn` for I/O-bound or long-running tasks (e.g. preview worker, background cache sweeper).
- Cancellation: `cancellation::request_cancel("scan" | "analyze" | "import" | "convert")` — global atomic booleans polled by cooperating jobs.
- Custom horizon: the observing site's skyline is stored as an azimuth/altitude
  profile (`src/lib/horizon.ts`), imported from and exported to N.I.N.A.'s
  `.hrz` format, and applied to the Planner's altitude charts (terrain fill),
  list flags, and the Sky Map planner mode's ground. Persisted via the
  `horizonProfile` setting.
- Sky Map modes: the SkyMap route hosts two exclusive views — the classic
  equatorial map and a Stellarium-like Planner mode (`skymapMode` setting)
  with a ground-fixed alt-az view (`src/lib/altAzView.ts`), a simulated
  clock (`useSimTime`), Sun/Moon + sky-brightness overlays, and Planner
  targets with night trajectories (`src/lib/trajectory.ts`). PlannerDetail
  deep-links into it via `/skymap?target=<id>`.
- Weather forecast: Open-Meteo with `models=chmi_aladin_seamless,ecmwf_ifs025,icon_eu`.
  The four cloud rows show an accuracy-weighted blend (ALADIN 0.32 / ECMWF 0.44 /
  ICON-EU 0.24, per-hour renormalization over non-null models — weights from the
  2026-08-08 audit, see the `weather-model-audit` skill); all other variables come
  from ALADIN. Cloud cells open a per-model breakdown popover; a collapsible
  "Satellite check" card (EUMETSAT `msg_fes:ir108` WMS + current-hour model values)
  sits above the table. The logic is duplicated in `src/lib/weather.ts` (app) and
  `docs/astroweather/js/weather.js` (gh-pages); every weather change goes in both
  files, and `tests/web/weather.test.mjs` covers the gh-pages module.

## Documentation Conventions

- Design specs and implementation plans live in `docs/plans/` as `YYYY-MM-DD-<topic>-design.md` and `YYYY-MM-DD-<topic>-plan.md`.
- Superpowers-style brainstorming / writing-plans flow is the default for non-trivial changes. When unsure, brainstorm first.
