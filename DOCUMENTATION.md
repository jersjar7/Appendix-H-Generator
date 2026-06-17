# Appendix H Generator — Developer & Design Documentation

> A single source of truth for **why** this web app exists, **how** it works,
> and **how to test, extend, or rebuild it**. Written so that another developer
> — or another Claude session — can pick up the work cold.

---

## Table of contents

1. [What this is, in one paragraph](#1-what-this-is-in-one-paragraph)
2. [Background & motivation](#2-background--motivation)
3. [Goals and non-goals](#3-goals-and-non-goals)
4. [Domain primer (read this if you're new to the hydraulics)](#4-domain-primer)
5. [The two hard problems and how we solve them](#5-the-two-hard-problems-and-how-we-solve-them)
6. [End-to-end workflow (SMS → app → Word)](#6-end-to-end-workflow)
7. [Input data formats & parsing rules](#7-input-data-formats--parsing-rules)
8. [Architecture overview](#8-architecture-overview)
9. [Module reference](#9-module-reference)
10. [Core data model](#10-core-data-model)
11. [Chart rendering specification](#11-chart-rendering-specification)
12. [Culvert box geometry](#12-culvert-box-geometry)
13. [Word document generation](#13-word-document-generation)
14. [Run history (localStorage)](#14-run-history-localstorage)
15. [UI reference](#15-ui-reference)
16. [Build, run, deploy](#16-build-run-deploy)
17. [Testing — unit and headless](#17-testing--unit-and-headless)
18. [Testing — real browser integration / UI tests](#18-testing--real-browser-integration--ui-tests)
19. [Known limitations & open questions](#19-known-limitations--open-questions)
20. [Glossary](#20-glossary)

---

## 1. What this is, in one paragraph

The **Appendix H Generator** is a static, browser-only web app that turns raw
**SMS (Surface-water Modeling System)** cross-section output into clean
**Appendix H charts** and a ready-to-paste **Word document**. The engineer
pastes two blocks of text copied out of SMS, the app figures out which data
belongs to which cross section and labels each one with its correct stationing,
draws a styled cross-section chart per station (ground profile + flood
water-surface lines, optional culvert box), and exports a `.docx` with every
chart captioned. It replaces a fragile Excel/VBA macro workbook. **Everything
runs client-side** — no server, no upload, no install — so it can live on GitHub
Pages and the model data never leaves the user's browser.

---

## 2. Background & motivation

### The thing it replaces
A hydraulics engineer (Stephen) built an Excel workbook (`.xlsm`) with VBA
macros that took SMS profile values pasted into a `PASTE` sheet, cloned a
`TEMPLATE` chart per cross section, and pasted the charts into a Word document.
It worked but was fragile:

- **Macro-security / ActiveX prompts** every time, and "save and reopen" dances.
- A **shared TEMPLATE chart** that, if its series got deleted, silently produced
  blank charts.
- **Stray clipboard data** producing phantom series.
- **Auto axis-scaling overshoot** (e.g., y-axis shooting to 96 for no reason),
  fixed by hand per chart.
- **Workbook bloat** ("81% of your workbook is unused formatting") from cloning
  sheets repeatedly.
- Two **fragile heuristics** (see §5) that could silently mislabel cross
  sections — the engineer would not notice until review.

### Why a web app (not a compiled GUI)
A compiled `.exe` triggers Windows SmartScreen / corporate antivirus and is
often blocked on locked-down work machines. A **static client-side web app**:
- needs no install — it's a URL;
- keeps all data **in the browser** (relevant: this is confidential project
  data);
- deploys free on GitHub Pages and can later be moved behind a corporate host
  with zero code change.

### Why the data comes from two SMS places
SMS exports profile values in an **arbitrary order** with **modeler-specific
arc names** that cannot be trusted. The **Summary Table** (a second SMS export)
provides the authoritative station list and the **thalweg elevation (`Z Min`)**
of each cross section, which is what lets us bind each profile to its true
station. See §4 and §5.

---

## 3. Goals and non-goals

### Goals
- Reproduce the Appendix H chart **look** the reviewers expect (line weights,
  colors, axis titles, legend, "looking downstream" note), with improvements.
- **Bulletproof** the two heuristics that the Excel got wrong (dataset identity,
  station identity) and make any residual uncertainty **visible** for human
  confirmation.
- Support **any number of flood events** (not a fixed 4/5).
- Output a **Word document** with one captioned chart per cross section.
- Run with **zero runtime dependencies** so it works offline and on GitHub Pages.

### Non-goals (current)
- Multi-barrel culverts (single barrel only — deliberately scoped out).
- Reading SMS native project files — input is **pasted text** only.
- Cross-device sync of history (it's per-browser `localStorage`).
- Server-side anything.

---

## 4. Domain primer

If you are not a water-resources engineer, read this. It is enough to work on
the code confidently.

- **Cross section**: a vertical slice across a stream/channel at a given
  location. Plotted as **elevation (y)** vs **distance across the section (x)**.
- **Station / stationing**: the location of a cross section along the stream
  centerline, in feet, written `SS+FF` (e.g., `1047.09 ft` → `10+47`). Always
  **rounded to the nearest foot** in this app.
- **Ground / terrain (Z)**: the bed/bank profile — the bottom curve of the
  chart. The **thalweg** is its lowest point (the channel bottom).
- **Water-surface elevation (WSE)**: the height water reaches for a given flood.
  Higher discharge ⇒ higher WSE. Events are named by recurrence interval:
  `2-year`, `100-year`, `500-year`, plus project-specific ones like
  `2080 100-year` (a climate-adjusted event).
- **Flood event / "dataset"**: one water-surface profile. Each cross section has
  one **ground** dataset plus one dataset per flood event.
- **Existing vs Proposed**: two model conditions. Existing typically has fewer
  events than Proposed. The condition is a label used in the chart caption and
  the ground legend ("Existing Ground" / "Proposed Ground").
- **`Z Min`**: in the SMS **Summary Table**, the minimum ground elevation
  (thalweg) of each cross section. This is the join key (§5).
- **Culvert / box**: a designed structure (a box culvert) drawn on top of the
  cross section as a rectangle — the **minimum hydraulic opening (MHO)**.
- **Scour**: the depth to which the streambed could erode over time (from the
  designer's scour calculation). The culvert is embedded below it.
- **Bed material allowance**: an extra depth (standard 2 ft) added **below** the
  scour, so material remains if scour occurs.

---

## 5. The two hard problems and how we solve them

SMS gives us, per cross section, a set of `(distance, value)` columns — but
**not** reliably which column is which dataset, nor which group of columns is
which station. The arc **names** can't be trusted (each modeler names them
differently) and the **column order is arbitrary**. Two problems result.

### Problem A — Which dataset is the ground, and which water surface is which?
**Solution: classify by elevation.** Within each cross section:
- The **ground** is the dataset with the **lowest minimum value** (the thalweg
  sits below every water surface).
- The remaining datasets are water surfaces; sort them **ascending by mean
  elevation** and map onto the user's event list, which is given in **increasing
  order of discharge** (`2-year` < `100-year` < `500-year` …).

This is modeler-naming-independent and column-order-independent. It is the one
heuristic from the Excel that was actually sound, and we keep it.

### Problem B — Which group of columns belongs to which station?
This is the one the Excel got wrong and the web app originally got wrong too.

- The **authoritative** station list + each station's **thalweg (`Z Min`)** come
  from the SMS **Summary Table**.
- Each detected cross section has a computed **ground minimum** (its thalweg).
- **Match each section to a station by thalweg ↔ `Z Min`.**

**The bug we fixed:** the first implementation used *greedy nearest-available*
matching (walk sections in paste order, each grabs the closest unused `Z Min`).
Greedy 1-D matching is **not** globally optimal — an early section can steal a
`Z Min` meant for another, cascading until the last section gets a wildly wrong
leftover (we saw a 37.76 ft error and a deep cross section mislabeled `16+60`).

**The fix (current):** the optimal 1-D assignment that minimizes total
mismatch is **sort both lists and pair rank-to-rank** — sort sections by
thalweg ascending, sort stations by `Z Min` ascending, pair index `i` to index
`i`. Since each thalweg equals exactly one `Z Min`, every section snaps to its
correct station. Implemented in `js/model.js → assignStations()`. Regression
test: `test/matching.mjs`.

**Residual safety:** if a paired section's thalweg still differs from its
`Z Min` by **> 1.0 ft**, the app emits a warning (`"Station X: thalweg differs
from Summary Z-min by N ft — verify the match."`). After the fix these should
only appear for genuinely odd data (e.g., the "weird extra areas" SMS sometimes
emits, see §19).

---

## 6. End-to-end workflow

### In SMS — get the Summary Table (Step 2 input)
1. Right-click the **1D FHD reporting coverage** → **Summary Table**.
2. Click **Generate Table**.
3. Click **Copy to Clipboard**.

This yields rows of `Reach | Station | Z Min` (and possibly more columns).

### In SMS — get the profile values (Step 3 input)
1. Activate the **observation cross-sections coverage** (Existing or Proposed).
2. Top menu **Display → Plot Wizard**.
3. Plot type **Observation Profile** → **Next**.
4. Confirm the coverage and that **all arcs are selected/active**.
5. **Data sets**: switch from *Active* to **Specified**, pick the **mesh**, and
   check the **terrain Z (ground)** plus each flood **water-surface elevation**
   you need.
6. **Time steps**: choose **Specified** and check **only the last time step**.
7. **Finish** → the profile plot appears.
8. Right-click the plot → **View Values** → **Ctrl+A**, **Ctrl+C**.

### In the app
1. **Step 1** — set the condition label and the **flow-event list** in
   increasing-discharge order (Ground is implicit). Presets exist for Existing
   (`2/100/500`) and Proposed (`+ 2080 100-year`).
2. **Step 2** — paste the Summary Table.
3. **Step 3** — paste the profile values.
4. **Step 4 (Options)** — toggles + **Generate charts**.
5. Review the **horizontal slider** of charts (station-button nav), confirm/edit
   station labels, axis extents, add culvert boxes.
6. **Download Word document.**

---

## 7. Input data formats & parsing rules

### 7.1 Profile values (Step 3) — `parseProfile(text)`
Real SMS clipboard data is **tab-delimited**, one row per profile point. Shape:

```
<index>\t<dist1>\t<val1>\t<dist2>\t<val2>\t...   ← optional header row of "Distance/Value"
1\t0.0\t74.60\t10.87\t67.78\t...
2\t0.43\t74.35\t12.65\t67.77\t...
```

Parsing rules (`js/parse.js`):
- **Delimiter**: tab if present (preserves empty cells); otherwise runs of
  whitespace (fallback for hand-pasted data — loses empty-cell fidelity).
- **Header row**: if the first row has no numeric cells (e.g., `Distance Value
  Distance Value …`), it is dropped.
- **Leading index column**: detected and dropped when the first column counts
  `1,2,3,…` and `(cols − 1)` is even.
- Columns are read as **alternating `(distance, value)` pairs** → an ordered
  list of dataset "pairs", each `{ dist: number[], val: number[] }`.
- **`-9999`** is SMS's no-data sentinel → skipped.
- **Blank cells** → skipped (columns are *ragged*: different lengths per
  dataset/section are normal).
- Trailing empty pairs are trimmed.
- Returns `{ pairs, warnings }`.

> Important: each dataset has its **own** distance column — the ground is sampled
> at different x-points than the 2-year, etc. They are **not** on a shared x
> grid. This is why charts are XY (each series carries its own x's).

### 7.2 Summary Table (Step 2) — `parseSummary(text)`
Tab-delimited rows; the app auto-detects the **Station** and **`Z Min`**
columns:
- Keep rows that contain at least one number.
- **Station column** = the numeric column with the largest average magnitude
  (stationing is in the hundreds/thousands).
- **`Z Min` column** = the next numeric column to the right of Station (else the
  next-largest-magnitude column).
- Returns `{ rows: [{ station, zmin }], warnings, stationCol, zCol }`.

### 7.3 Station formatting — `formatStation(value, mode = "nearest")`
`1047.09 → "10+47"`, `1549.86 → "15+50"`, `47.2 → "0+47"`. The app always calls
it with `"nearest"` (the only mode exposed in the UI). `"up"`/`"down"` exist in
code but are not surfaced.

---

## 8. Architecture overview

- **Type**: static client-side single-page app. No build step, no framework, no
  runtime dependencies. Pure ES modules + Canvas2D.
- **Hosting**: GitHub Pages (deploy from `main`, root). Works from any static
  host or `python3 -m http.server`.
- **Data flow**:

```
 Step 2 paste ─► parseSummary ─┐
                               ├─► buildSections ─► [section objects]
 Step 3 paste ─► parseProfile ─┘        │
                                        ▼
                              renderChart(canvas)  ──► per-chart <canvas>
                                        │
                                        ▼
                              pngBytes(canvas) ─► buildDocx ─► .docx download
```

- **File map**:

```
index.html        UI markup (steps, options, history panel, results container)
css/styles.css    styling
js/parse.js       parse Summary Table + profile paste; formatStation
js/model.js       elevation classification + optimal Z-min station matching
js/chart.js       Canvas2D cross-section renderer (exports DEFAULTS, renderChart)
js/zip.js         dependency-free ZIP writer (STORE method + CRC32)
js/docx.js        assembles a .docx from chart PNGs + captions
js/history.js     localStorage-backed run history
js/app.js         UI controller: wires inputs → model → chart → docx
test/*.mjs        Node test suites (see §17)
```

---

## 9. Module reference

### `js/parse.js`
- `parseProfile(text) → { pairs, warnings }` — see §7.1.
- `parseSummary(text) → { rows, warnings, stationCol, zCol }` — see §7.2.
- `formatStation(value, mode="nearest") → "SS+FF"` — see §7.3.

### `js/model.js`
- `buildSections(pairs, summaryRows, opts) → { sections, warnings, datasetsPerSection, eventNames }`
  - `opts = { events: string[], conditionLabel: string, roundingMode: "nearest", stationLabels?: string[] }`
  - **Datasets per section** = `events.length + 1` if events given, else
    `round(pairs.length / summaryRows.length)`.
  - Chunks pairs into sections, runs Problem-A classification, then
    `assignStations` (Problem-B optimal matching).
  - Emits warnings for non-divisible counts, count mismatches between Summary
    and profile, and >1 ft thalweg/`Z Min` residuals.
- `assignStations(sections, summaryRows, opts, warnings)` — optimal 1-D
  sort-and-pair matching; fallback to thalweg-ordered labels when no `Z Min`.

### `js/chart.js`
- `export const DEFAULTS` — colors, fills, gridlines, axis titles, the note text,
  `minorDivisions` (default 5). Merged with per-call options.
- `renderChart(ctx, W, H, section, optsIn = {})` — draws one cross section onto a
  Canvas2D context. Pure (no DOM beyond the passed context) so it runs headless
  under `node-canvas`.
- `surfaceColor(name, i, n)` — blue→green ramp; dashed amber for any name
  containing `2080`.

### `js/zip.js`
- `makeZip(entries) → Uint8Array` where `entries = [{ name, data }]` (`data` is a
  `Uint8Array` or string). STORE (no compression) + CRC32. Self-contained.
- `crc32(bytes)`, `toBytes(input)` helpers.

### `js/docx.js`
- `buildDocx(charts) → Uint8Array` where
  `charts = [{ png: Uint8Array, caption: string, widthIn, heightIn }]`.
  Produces a valid minimal `.docx` (Content_Types, rels, document.xml,
  media/imageN.png). See §13.

### `js/history.js`
- `isAvailable()`, `listRuns()`, `saveRun(run)`, `deleteRun(id)`, `clearRuns()`.
  localStorage key `appendixH.history.v1`, capped at **20** entries, de-duped by
  `condition + summary + profile`. See §14.

### `js/app.js`
- Constants: `CANVAS_W=1300`, `CANVAS_H=772`, `IN_W=6.5`,
  `IN_H = 6.5 × 772/1300 ≈ 3.86`, `PRESETS`.
- `state = { sections, canvases, order }`.
- Key functions: `generate()`, `renderResults()`, `renderChart` wiring per card,
  `download()`, `saveInputs()`, `loadRun()`, `renderHistory()`, `restart()`,
  `orderedSections()` / `stationKey()` (asc/desc ordering).

---

## 10. Core data model

### Section object (produced by `buildSections`)
```js
{
  index: 0,                       // original paste order
  ground: { name: "Existing Ground", dist: number[], val: number[] },
  groundMin: 65.25,               // thalweg elevation
  surfaces: [                     // labelled, ascending by mean elevation
    { name: "2-year",   dist: number[], val: number[] },
    { name: "100-year", dist: number[], val: number[] },
    { name: "500-year", dist: number[], val: number[] },
  ],
  station: 1272.11,               // numeric station from Summary (may be null)
  stationLabel: "12+72",          // formatted, editable in UI
  matchDiff: 0.03,                // |thalweg − Z Min| from matching
  structure: null,                // or a culvert object (see §12)
  yOverride: null,                // or { min, max } manual axis extents
}
```

### Culvert (structure) object
```js
{
  type: "Culvert",
  scour: 4.0, height: 15.2, width: 12.0, bed: 2.0,
  center: 26.0,    // user-set center X, or null = thalweg x
  x: 26.0,         // resolved center X
  bottom: 59.25,   // = groundMin − scour − bed
  top: 74.45,      // = bottom + height
}
```

### History "run" object
```js
{
  id, savedAt,                    // assigned by saveRun
  condition: "Existing Conditions",
  events: ["2-year","100-year","500-year"],
  summary: "<step 2 paste>",
  profile: "<step 3 paste>",
  options: { optEarth, optWater, optThalweg, optLegend },
  count: 6,                       // optional (set when saved on Generate)
}
```

---

## 11. Chart rendering specification

`renderChart(ctx, W, H, section, opts)` draws (in order): white background →
minor gridlines (light) → major gridlines → earth fill → inundation shading →
series lines → culvert box → thalweg marker → axis frame + ticks + titles →
"looking downstream" note → legend.

- **Canvas size**: rendered at `1300 × 772` px (≈ 200 dpi for a 6.5 × 3.86 in
  image). Fonts scale from `fontPx = round(W/60)`.
- **Ground**: warm brown `#7a5c3e`, ~2.6 px line, with a light **earth fill**
  (`#ece0cf`) below.
- **Water surfaces**: blue→green ramp (`#1f6fb4 → #56a0d3 → #3a9d4a`); any event
  named with `2080` is **dashed amber** `#e8a93b`.
- **Inundation shading**: light blue (`#bcd6ef`, 60% alpha) between the ground
  and the highest surface.
- **Culvert**: black `#000000`, 4-sided rectangle (§12).
- **Thalweg marker**: white-filled dot at the ground minimum + `"Thalweg NN.NN"`.
- **Gridlines**: major `#dcdcdc`, **minor** `#efefef` subdivided `minorDivisions`
  (5) between majors; labels only on majors.
- **Axis titles**: `"Distance (feet)"` / `"Elevation (feet, NAVD88)"`. No chart
  title.
- **Legend**: "smart" placement — when `legendInside` is true, the box is placed
  in whichever candidate position (4 corners + top-center) overlaps the fewest
  data points. Includes a "Culvert" row when a box is present.
- **Note**: boxed `"Cross Section is looking downstream"`, bottom-left.
- **Axis extents**: auto from data (+ structure), with padding; overridden by
  `section.yOverride` when set.
- **Per-call options** (from the UI checkboxes, merged over `DEFAULTS`):
  `showEarthFill`, `showInundation`, `showThalweg`, `legendInside`.

---

## 12. Culvert box geometry

A **single-barrel** box culvert, drawn as a plain 4-sided outline (no fillets).
Inputs and derivation (all in feet):

| Input | Meaning | Default |
|---|---|---|
| **Scour** | depth bed could erode (designer's calc) | — |
| **Box height** | culvert opening height | — |
| **Width** | culvert opening width | — |
| **Center X** | horizontal position of box center | thalweg x |
| **Bed** | material allowance below scour | 2 ft (editable) |

Derived geometry:
```
box bottom = thalweg − scour − bed
box top    = box bottom + height
box spans  = centerX − width/2  …  centerX + width/2
```
- **Vertical** is anchored to the **thalweg elevation** (scour is defined as
  measured down from the thalweg), so a meandering thalweg does not break it.
- **Horizontal** defaults to the thalweg's x-location but is overridable via
  Center X, because the culvert is not always at the section's low point.
- The box is added to the **legend** ("Culvert") and to the **axis extents** so
  it never clips, even when `box bottom` is well below grade.

Implementation: input handling in `js/app.js` (`applyStruct` inside
`renderResults`); drawing + extents in `js/chart.js`.

---

## 13. Word document generation

`buildDocx(charts)` assembles a minimal valid `.docx` with **no dependencies**
(our own `makeZip`):

- One **centered chart image** per section, sized **6.5 in × 3.86 in**
  (`IN_W`/`IN_H`), followed by a **centered italic caption**:
  `"<Condition>, Cross Section at Station <SS+FF>"` (e.g.,
  `"Existing Conditions, Cross Section at Station 10+47"`).
- Charts are emitted in the **currently displayed order** (asc/desc), because
  `download()` iterates `state.canvases`, which is built in display order.
- Each canvas is converted to PNG via `canvas.toDataURL("image/png")` →
  `Uint8Array` (`pngBytes`).
- The `.docx` is delivered as a `Blob` download named
  `<Condition>_Cross_Sections.docx`.

The generated package layout: `[Content_Types].xml`, `_rels/.rels`,
`word/document.xml`, `word/_rels/document.xml.rels`, `word/media/imageN.png`.

---

## 14. Run history (localStorage)

- Stores the **inputs** of previous runs (condition, events, the two pastes,
  options) — **never the rendered charts**. Charts are regenerated on load.
- Key `appendixH.history.v1`, capped at **20**, newest first, de-duped by
  `condition + summary + profile` (a repeat bumps the timestamp instead of
  adding a duplicate).
- UI: a collapsible **"Saved inputs"** panel. **Save inputs** stores without
  generating; **Load** refills steps 1–3 only (no auto-generate) and scrolls to
  the paste area; **Delete** / **Clear all** prompt for confirmation.
- **Caveat (document this to users):** history is **per browser/device**. It does
  not sync across devices and is wiped if the user clears site data. This is the
  honest trade-off of an account-free tool. The panel hides itself if
  localStorage is unavailable (e.g., strict private mode).

---

## 15. UI reference

- **Header**: title + **↺ Restart** button (clears all inputs to defaults;
  confirms only when there is data to lose).
- **Saved inputs** panel (collapsible) — see §14.
- **Step 1 — Condition & flow events**: condition text; **Existing/Proposed**
  presets; an ordered, add/remove/reorder **event list** (increasing discharge).
- **Step 2 — Summary Table** paste box.
- **Step 3 — Profile values** paste box.
- **Auto-count hint**: as you paste, shows `Detected N cross sections × M
  datasets …` or a warning if `pairs ÷ sections` isn't a whole number.
- **Step 4 — Options**: checkboxes **Earth fill**, **Inundation shading**,
  **Thalweg marker**, **Smart legend placement**; **Generate charts**,
  **Save inputs**, **Download Word document**.
- **Messages**: ok/warn/error banners (e.g., generation summary, mismatch
  warnings).
- **Results**: a **station-button nav** (chips) + asc/desc **order toggle**,
  above a **horizontal slider** of chart cards. Clicking a chip smooth-scrolls
  to that chart; the active chip highlights as you scroll
  (IntersectionObserver). Each card has per-chart controls: **Station label**,
  **Y min/Y max**, and **Culvert** (None / Add box → scour, box height, width,
  center X, bed). Edits persist across reorder/redraw and feed the Word export.

---

## 16. Build, run, deploy

No build step. It is plain static files.

```bash
# Run locally
python3 -m http.server 8000      # then open http://localhost:8000

# (optional) install the dev-only headless-canvas dependency for render tests
npm install canvas
```

**Deploy (GitHub Pages):** push to `main`, then in the repo
**Settings → Pages → Deploy from a branch → `main` / root**. Live at
`https://<user>.github.io/Appendix-H-Generator/`. Pages on a **private** repo
requires GitHub Pro; otherwise make the repo public.

> `package.json` / `package-lock.json` are now **committed** (they pin the
> dev-only test toolchain: `@playwright/test` for UI tests, `canvas` for headless
> render tests). Only `node_modules/` is git-ignored. The app **itself** still
> ships zero runtime dependencies — nothing in `js/` imports either package, and
> GitHub Pages serves only the static files.

---

## 17. Testing — unit and headless

All tests are plain Node ESM scripts (Node 18+). Run them directly:

```bash
node test/run.mjs        # parsing, elevation classification, station format, .docx assembly
node test/matching.mjs   # regression: optimal Z-min station matching (the greedy-bug fix)
node test/history.mjs    # localStorage history: save/order/de-dupe/delete/clear/cap
node test/e2e.mjs        # full pipeline: parse → build → render charts → build a .docx
# Visual/manual render helpers (need: npm install canvas):
node test/render_test.mjs    # writes /tmp/chart_A.png, /tmp/chart_B.png
node test/culvert_render.mjs # writes /tmp/culvert_chart.png
```

What they cover:
- **`run.mjs`** — `formatStation`; `parseProfile` (header/index-column/`-9999`);
  `parseSummary`; `buildSections` classification + station match; a `.docx` is
  written to `/tmp/test_out.docx` and asserted to start with the `PK` zip
  signature.
- **`matching.mjs`** — constructs the exact case greedy matching gets wrong
  (paste-order thalwegs 55/65/50 vs `Z Min` 50/60/70) and asserts sort-and-pair
  yields the correct labels with no cascade blow-up.
- **`history.mjs`** — uses a `localStorage` shim; checks ordering, de-dupe, cap
  at 20, delete, clear.
- **`e2e.mjs`** — synthetic tab-delimited profile + summary through the whole
  pipeline, renders real charts via `node-canvas`, builds a multi-image `.docx`,
  asserts correct station labels.

To verify a generated `.docx` opens as real Word XML (optional):
```bash
pip install python-docx
python3 -c "from docx import Document; d=Document('/tmp/test_out.docx'); \
print(len(d.paragraphs),'paras',len(d.inline_shapes),'images')"
```

---

## 18. Testing — real browser integration / UI tests

The Node suites cover logic and headless rendering, but **chart canvas
rendering, the slider, the history panel, the download, and the per-chart
culvert controls only run in a real browser**. Recommended approach:
**Playwright** (Chromium) against the static site.

### Setup
The Playwright toolchain is committed (`package.json`, `playwright.config.js`,
`test/ui/`). From a fresh clone:
```bash
npm install                       # installs @playwright/test + canvas (dev-only)
npx playwright install chromium   # one-time browser download
npm run test:ui                   # boots the static server itself, runs the suite
```
`playwright.config.js` starts `python3 -m http.server 8000` automatically via its
`webServer` block, so you don't serve the app by hand. The shared fixtures and
helpers live in `test/ui/fixtures.js` and `test/ui/helpers.js`; one `*.spec.js`
file per scenario group below.

### Test fixtures (known-good inputs and expected outputs)
Paste these into the app to get a deterministic result.

**Summary Table (Step 2):**
```
Reach	Station	Min
Hood Canal	1047.09	54.78
Hood Canal	1272.11	65.25
```

**Profile values (Step 3)** — 2 sections × (ground + 3 surfaces), tab-delimited,
with a header row, a leading index column, and intentionally scrambled dataset
order (surface, ground order) so the elevation classification is exercised.
Ground minima are `54.78` and `65.25` to match the Summary `Z Min`s:
```
Distance	Value	Distance	Value	Distance	Value	Distance	Value	Distance	Value	Distance	Value	Distance	Value	Distance	Value
1	4	56.72	0	60.78	4	56.40	2	58.0	4	86.10	0	71.25	4	80.80	2	83.20
2	6	56.74	2	56.78	6	56.42	6	58.1	6	86.10	2	65.25	6	80.80	6	83.20
3	8	56.72	4	54.78	8	56.40	8	58.0	8	86.10	4	72.25	8	80.80	8	83.20
```
> Note: this is illustrative. For a faithful test, prefer a **real** SMS export
> with its ragged columns and `-9999` sentinels; the parser is built for that.

**Expected result for the fixture above:**
- Generation banner: *"Generated 2 cross sections · 4 datasets each (1 ground + 3 surfaces)."*
- Two charts, station labels **`10+47`** and **`12+72`** (matched by `Z Min`).
- No "differs by" warnings (thalwegs equal the `Z Min`s).

### Concrete UI scenarios to automate
1. **Happy path**: paste both fixtures → click *Generate charts* →
   - assert the ok-banner text and that exactly **2** chart `<canvas>` elements
     and **2** station chips render;
   - assert chip text equals `10+47`, `12+72`.
2. **Station matching correctness**: assert no element with text matching
   `/differs from Summary Z-min/` appears.
3. **Order toggle**: click *Switch to descending* → assert chip order reverses
   and the first chart's caption is now `12+72`.
4. **Chip navigation**: click the `12+72` chip → assert that card is scrolled
   into view within the slider (`.chart-strip`) and the chip gets `.active`.
5. **Culvert box**: on a card, set **Culvert → Add box**, enter scour/height/
   width → assert the canvas pixel content changes (e.g., compare
   `canvas.toDataURL()` before/after) and the caption is unchanged.
6. **Word download**: click *Download Word document*, capture the download, unzip
   it, and assert `word/media/image1.png` exists and `word/document.xml`
   contains the caption strings. Example assertion sketch:
   ```js
   const [ download ] = await Promise.all([
     page.waitForEvent("download"),
     page.click("#download"),
   ]);
   const path = await download.path();          // unzip with a zip lib
   // assert entries: word/document.xml contains "Cross Section at Station 10+47"
   ```
7. **History**: click *Save inputs* → reload the page → open *Saved inputs* →
   assert one entry exists → click *Load* → assert the Step 2/3 textareas refill
   and **no** charts are auto-generated.
8. **Restart**: with inputs present, click *Restart* → accept the confirm →
   assert textareas are empty and results cleared.
9. **Validation**: paste a profile whose dataset count is not divisible by the
   section count → assert the auto-count hint shows the `⚠ … isn't whole`
   message.

### Visual regression (optional)
Use Playwright's `toHaveScreenshot()` on individual chart cards, or compare a
generated chart canvas PNG to a committed baseline. Keep tolerances generous —
font rasterization differs across platforms.

### What "working as designed" means (acceptance checklist)
- [ ] Pasting real Existing/Proposed exports yields the right **section count**
      and **dataset count**.
- [ ] Every chart is labeled with the **correct station** (cross-check against
      the SMS Summary Table / Excel output); no large `differs by` warnings.
- [ ] Dataset identity is correct: ground is the channel; surfaces stack in
      discharge order.
- [ ] Culvert box lands at the right **elevation** (`thalweg − scour − bed`) and
      **position** (center X), matching the designer's plans.
- [ ] The Word document opens in Microsoft Word with one captioned chart per
      section, in the displayed order.
- [ ] History saves/loads inputs; Restart clears; confirmations fire on
      destructive actions.

---

## 19. Known limitations & open questions

- **Terrain-with-culvert vs natural channel**: the culvert math assumes the
  proposed **terrain is the natural/graded ground** and the box is an overlay.
  If a proposed mesh has the culvert carved into the terrain, the ground line
  dips at the structure and the anchoring thalweg would need rethinking.
  *Confirm per project.*
- **"Weird extra areas"**: SMS sometimes emits stray/disconnected profile
  segments that engineers delete by hand in the Excel workflow. The current
  parser includes all non-`-9999` points. If small residual thalweg/`Z Min`
  diffs persist after the matching fix, this is the likely cause; a future
  enhancement could auto-trim disconnected segments. Needs a real
  still-misbehaving paste to design against.
- **Single barrel only**: multi-barrel (twin/triple box) culverts are out of
  scope by decision. Adding them means allowing multiple structure objects per
  section.
- **Width model**: we draw the box with an **explicit width centered on the
  thalweg x** (overridable). Stephen's Excel instead stretched the box to the
  full profile min→max width. The explicit-width model was chosen deliberately;
  worth confirming with Stephen if reviewers expect the full-width look.
- **Header names are untrusted by design** — do not "improve" the app by parsing
  station/event identity from SMS arc names; they vary per modeler.
- **History is per-device** (localStorage), not synced.

---

## 20. Glossary

| Term | Meaning |
|---|---|
| **SMS** | Surface-water Modeling System — the hydraulics software the data comes from. |
| **Cross section** | A vertical slice across the channel; the thing each chart depicts. |
| **Station / `SS+FF`** | Location along the stream in feet; `1047 ft → 10+47`. |
| **Thalweg** | Lowest point of the ground profile (channel bottom). |
| **`Z Min`** | Thalweg elevation as reported in the SMS Summary Table; the station join key. |
| **WSE** | Water-surface elevation for a given flood event. |
| **Flood event / dataset** | One water-surface profile (e.g., 100-year). |
| **Existing / Proposed** | The two model conditions (before/after design). |
| **Culvert / box / MHO** | The designed box structure drawn on the section (minimum hydraulic opening). |
| **Scour** | Depth the bed could erode; sets how far below the thalweg the box sits. |
| **Bed allowance** | Extra depth (default 2 ft) below scour for streambed material. |
| **Appendix H** | The report appendix these cross-section charts populate. |
