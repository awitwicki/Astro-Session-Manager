# Astro Session Manager

Desktop application for managing astrophotography imaging sessions and master calibration libraries. Built with Tauri (Rust backend + React frontend).

## Tech Stack

**Frontend:** React 19, TypeScript 5.9, Vite 7, Zustand (state), React Router DOM (hash routing), Lucide React (icons), custom CSS with CSS variables (dark/light themes via `data-theme` attribute)

**Backend:** Tauri 2, Rust (edition 2021), rustafits (FITS parsing), image crate (preview generation), serde/serde_json, walkdir, regex, chrono, sha2

**Build:** Vite dev server on port 5173, ESLint (flat config), TypeScript strict mode, React compiler plugin enabled

**CI/CD:** GitHub Actions — auto-tag + cross-platform release builds (macOS ARM64/Intel, Windows NSIS, Linux DEB/AppImage)

## Project Structure

```
src/                          # Frontend (React + TypeScript)
  routes/                     # Page components (Dashboard, ProjectView, SessionView, FitsDetailView, MastersLibrary, Settings)
  components/layout/          # AppShell, TopBar, Sidebar, StatusBar
  store/appStore.ts           # Zustand store
  context/ThemeContext.tsx     # Theme context
  types/                      # TypeScript interfaces
  hooks/                      # Custom hooks
  lib/                        # Utilities (constants, formatters)
  styles/                     # Global CSS + variables

src-tauri/src/                # Backend (Rust)
  commands.rs                 # Tauri command handlers (~27 commands)
  scanner.rs                  # Directory scanning (Project → Filter → Session → Lights/Flats)
  fits_parser.rs              # FITS header parsing with keyword aliases for different capture software
  xisf_parser.rs              # XISF format parsing
  fits_preview.rs             # FITS → JPEG preview generation with disk + memory cache
  masters.rs                  # Master frames library (darks/biases/flats matching)
  settings.rs                 # Persistent key-value settings
  cache.rs                    # Filesystem-based header cache
  types.rs                    # Shared Rust types
```

## Build & Run

```sh
yarn          # Install frontend dependencies
yarn tauri dev    # Dev mode (frontend + Rust backend)
yarn tauri build  # Production build
```

## Key Patterns

- Frontend calls Rust via Tauri IPC commands (defined in `commands.rs`)
- Long operations emit progress events via Tauri window events
- FITS parsing handles keyword aliases for N.I.N.A., ASIAIR, SGPro, SharpCap
- Preview generation: FITS → JPEG (max 1920x1080), SHA256-based cache keys
- Masters matching: by exposure (±0.5s), temperature (configurable tolerance), resolution
- Supported formats: FITS (.fits, .fit, .fts), XISF (.xisf)
- Error handling: String-based errors from Rust to frontend
- Async: `tauri::async_runtime::spawn_blocking` for CPU-intensive tasks
- rustafits fast library: https://crates.io/crates/rustafits
