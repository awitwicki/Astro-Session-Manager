# Design: Use Median FWHM in Heatmap & Tilt Diagram

**Date:** 2026-03-07
**Branch:** Frame-tilt

## Problem

The FWHM heatmap and tilt diagram in `FitsDetailView.tsx` use simple mean (`sum / count`) to compute average FWHM per grid cell / tilt region. Mean is sensitive to outlier stars (hot pixels, noise artifacts, saturated stars), which can skew the displayed values and produce misleading color gradients.

## Decision

Use **median** instead of mean for all per-region FWHM calculations. Compute median entirely in the frontend — no backend changes needed.

### Approach: Frontend-only median

The star data (max 200 stars with x, y, fwhm, eccentricity) is already sent to the frontend via `analyze_stars_detail`. Instead of accumulating `{ sum, count }` per grid cell / tilt region, collect FWHM values into arrays and compute the median.

**Alternatives considered:**
- **Backend-computed medians** — ties grid/region logic to Rust, more IPC surface, less flexible. Rejected as over-engineered for 200 stars.
- **Backend outlier filtering + frontend median** — most robust but most complex, changes backend API. Rejected as unnecessary given small star count.

## Changes

### New utility function

`computeMedian(values: number[]): number` — sorts a copy of the input array and returns the middle value (or average of two middle values for even-length arrays).

### Heatmap (lines ~479-525 of FitsDetailView.tsx)

- Grid data structure changes from `{ sum: number; count: number }[][]` to `number[][]` (array of FWHM values per cell)
- Replace `cell.sum / cell.count` with `computeMedian(cell)`
- Skip cells where array is empty (replaces `cell.count === 0` check)

### Tilt diagram (lines ~562-582 of FitsDetailView.tsx)

- Region data structure changes from `Record<string, { sum, count }>` to `Record<string, number[]>`
- Replace `r.sum / r.count` with `computeMedian(regionValues)`

### No changes to

- Backend `analyze_stars_detail` or `SubAnalysis` types
- Star data structure (`StarDetail`)
- Grid size (20x20), region sizes (25% corners, 50% center)
- Color mapping logic (deviation-based green-yellow-red)
- Canvas rendering approach

## Scope

~30 lines changed in `FitsDetailView.tsx` plus one small utility function.
