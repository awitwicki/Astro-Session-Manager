# Astro Session Manager

Desktop application for managing astrophotography imaging sessions and master calibration libraries. Built with Tauri (Rust backend + React frontend).

## Agent Rules

- **Do not make git commits** unless the user explicitly asks for one. Edit files, run tests/builds, report results — but leave commits, branches, tags, and pushes to the user. This applies to every session regardless of task size.
- **Do not create git branches or worktrees** on your own. Work on whatever branch is currently checked out.
- **Never use destructive git operations** (`reset --hard`, `push --force`, `branch -D`, `stash drop`, etc.) without an explicit request for that exact operation.
- **Do not add compatibility shims or dead code** "for later removal." If a refactor leaves the tree temporarily broken mid-task, keep going to finish it — don't patch around partial state with stubs.

## Tech Stack

**Frontend:** React 19.2, TypeScript 5.9, Vite 7, Zustand 5 (state), React Router DOM 7 (hash routing), Lucide React (icons), `d3-celestial` (SkyMap), `leaflet` (Weather map), Babel React Compiler plugin, custom CSS with CSS variables (dark/light themes via `data-theme` attribute).

**Backend:** Tauri 2.10, Rust edition 2021 (MSRV 1.77.2). Key crates:
- `rustafits` 0.9 — FITS parsing (imported as `astroimage` — this is the crate's `[lib] name`, not a separate dep)
- `image` 0.25 — preview encoding
- `lru` 0.12 — bounded preview cache
- `rawler` 0.7 + `nom-exif` 2 — DSLR raw decoding (CR2/CR3/ARW) and EXIF
- `tokio` 1 (sync + time features), `rayon` 1 — async + parallel
- `walkdir`, `regex`, `chrono`, `sha2`, `hex`, `base64`, `dirs`, `trash`
- `serde` / `serde_json`
- `tauri-plugin-log`, `tauri-plugin-dialog`, `tauri-plugin-opener`

**Build:** Vite dev server on port 5173, ESLint flat config, TypeScript strict mode, React compiler plugin enabled.

**CI/CD:** GitHub Actions — auto-tag + cross-platform release builds (macOS ARM64/Intel, Windows NSIS, Linux DEB/AppImage).

## Project Structure

```
src/                          # Frontend (React + TypeScript)
  routes/                     # Dashboard, ProjectView, FitsDetailView,
                              # MastersLibrary, Settings, SkyMap, Weather, Converter
  components/layout/          # AppShell, TopBar, Sidebar, StatusBar
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
yarn tsc --noEmit # frontend typecheck
yarn lint         # frontend lint
```

## Key Patterns

- Frontend calls Rust via Tauri IPC commands (defined in `commands.rs`, registered in `lib.rs`).
- Long operations emit progress events via Tauri window events; the preview queue emits state snapshots (`preview:queue_state`) while holding its mutex so events are ordered.
- FITS parsing handles keyword aliases for N.I.N.A., ASIAIR, SGPro, SharpCap.
- Preview generation: FITS → JPEG (max 1920×1080, quality 90), SHA256-based cache keys, bounded LRU (default 500 MB, 30 min TTL, runtime-adjustable concurrency).
- Preview generation scheduling uses a persistent global priority queue (`preview_queue.rs`): `enqueue_previews` prepends paths to the front with dedup; clicking a new filter preempts previous work without cancelling it.
- Masters matching: by exposure (±0.5 s), temperature (configurable tolerance), resolution.
- Supported formats: FITS (`.fits`, `.fit`, `.fts`), XISF (`.xisf`), DSLR RAW (`.cr2`, `.cr3`, `.arw`).
- Error handling: `Result<T, String>` across the IPC boundary — Rust errors become plain strings for the frontend.
- Async: `tauri::async_runtime::spawn_blocking` for CPU-intensive work; `tokio::spawn` for I/O-bound or long-running tasks (e.g. preview worker, background cache sweeper).
- Cancellation: `cancellation::request_cancel("scan" | "analyze" | "import" | "convert")` — global atomic booleans polled by cooperating jobs.

## Documentation Conventions

- Design specs and implementation plans live in `docs/plans/` as `YYYY-MM-DD-<topic>-design.md` and `YYYY-MM-DD-<topic>-plan.md`.
- Superpowers-style brainstorming / writing-plans flow is the default for non-trivial changes. When unsure, brainstorm first.
