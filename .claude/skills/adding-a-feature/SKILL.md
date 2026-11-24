---
name: adding-a-feature
description: Use when adding a new user-visible feature, page, tab, calculator, dialog or panel to Astro Session Manager, or reshaping an existing screen. Covers the order of work, the interface vocabulary and the visual-quietness rules of this app.
---

# Adding a feature to Astro Session Manager

The app is a working tool used at night, next to a telescope. Its screens are
quiet: one clear answer, few controls, nothing decorative. A feature that
works but makes a screen busier is not finished.

## Order of work

1. **Spec, then plan, then code.** `docs/plans/YYYY-MM-DD-<topic>-design.md`,
   then `…-plan.md`. The user approves the spec before the plan and the plan
   before code. Read two recent specs there first for the expected depth.
2. **Stay on the checked-out branch** unless the user asks for a new one.
3. **Logic first, as a pure module.** Math, parsing, grouping and matching go
   in `src/lib/<name>.ts` with no React, no Tauri and no DOM, and get
   `tests/web/<name>.test.mjs` (node:test, run with `yarn test:web`). When
   the logic follows a paper or a published tool, pin one of its published
   numbers in a test and name the source in a comment.
4. **Rust only when the filesystem or heavy CPU work needs it.** A new
   command goes in `commands.rs`, is registered in `lib.rs`, returns
   `Result<T, String>`. Frontend-only settings need no Rust field: any key
   persists through `set_setting` (`AppSettings.extra`).
5. **Interface last**, from the existing vocabulary below.
6. **Close out**: `yarn tsc -b` (never `tsc --noEmit`), `yarn lint`,
   `yarn test:web`, `cargo test --lib` if Rust changed; look at the result in
   the running app in both themes (the `run` skill; stop the dev server
   afterwards); bump `package.json` (minor for a feature, patch for a fix);
   update `CLAUDE.md` (structure list and a Key Patterns paragraph) and the
   README feature list; squash into one commit; never push.

## Interface vocabulary

Reuse before adding. Look at the nearest existing screen and copy its
structure, not just its colours.

- **Colours, radii, fonts, shadows**: only the tokens in
  `src/styles/variables.css` (`--color-*`, `--radius-*`, `--font-*`). No hex
  values in component CSS, no new fonts, no gradients or glows. Meaning uses
  `--color-success / -warning / -error`; emphasis uses `--color-accent`.
- **Both themes**: every screen is checked under `data-theme='light'` too.
- **Page header**: pages have no in-page title. Add the route to
  `buildBreadcrumbs` in `TopBar.tsx`; put header controls in
  `<TopBarActions>` inside `.topbar-group`, button text in `.btn-label` and a
  `title` on the button.
- **Panels and forms**: `calc-panel`, `calc-fields`, `calc-field`,
  `calc-field-label`, `calc-input`, `calc-select`, `calc-seg` (two-to-four way
  switch), `fc-chips` (quick presets), `calc-hint`.
- **Results**: one hero value (`fc-hero`) with a one-sentence verdict, then at
  most four `calc-result-card` stats.
- **Tables**: `.calc-table` for small read-only tables, `.data-grid` for
  selectable trees with group rows. Checkboxes are styled globally; use
  `components/ui/Checkbox.tsx` only for tri-state.
- **Charts**: plain SVG drawn from a pixel-space model built in `src/lib`
  (`fbscCharts.ts` + `FilterCharts.tsx` is the pattern). No chart library.
- **Icons**: `lucide-react`, one size per row, never as decoration.
- **New CSS** goes in the page's existing stylesheet under `src/styles/` with
  a short feature prefix (`fc-`, `se-`).
- **Text**: English, sentence case, plain words, units on every number.
  Empty or invalid input shows "—" in the result, not an error banner.
- **Long work** reports through the status bar operations
  (`src/lib/operations.ts`), not a private spinner.

## Visual quietness checklist

Go through this before calling the interface done.

- [ ] The screen answers one question, and that answer is the largest thing
      on it.
- [ ] The default view fits a 13" window without scrolling.
- [ ] Every control has a sensible default; nothing must be filled in before
      a result appears, unless no honest default exists.
- [ ] Defaults come from the user's own data where the library has it
      (camera, filter, focal length, site) rather than from a generic preset.
- [ ] Detail that most visits do not need is collapsed or opt-in (advanced
      values, comparisons, method notes), and stays out of the way until used.
- [ ] No slider where a number field or three chips would do. No legend
      where a direct label fits. No colour that carries no meaning.
- [ ] At most two panels side by side; one hero; no more than four stat cards.
- [ ] Nothing repeats: a value is shown once, in the place it is used.
- [ ] Removing any element would lose something a user needs. If not, remove it.

## Credit

When a feature builds on someone's method, data or tool, name them in a
"Method and sources" card at the bottom of the screen (see
`FilterCalculator.tsx`), with a link opened through `openUrl`, and in the
README. Take the function and the data they allowed; never their code,
markup, styling or wording.

## Mirrors

Some code exists twice and must change together: weather logic
(`src/lib/weather.ts` and `docs/astroweather/js/weather.js`), and the filter
calculator's website copy (`yarn sync:filtercalc`). Check `CLAUDE.md` for the
current list before touching either.
