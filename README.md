# Appendix H Generator

A browser-based tool that turns **SMS cross-section output** into clean
**Appendix H charts** and a ready-to-use **Word document** — replacing the old
Excel/VBA macro workflow.

Everything runs **client-side**: paste your data, get charts, download a `.docx`.
No install, no upload, no macros. The data never leaves your browser.

> **Developers / testers:** see [`DOCUMENTATION.md`](DOCUMENTATION.md) for the
> full design rationale, architecture, data formats, algorithms, and a testing
> guide (including real browser integration/UI tests).

## What it does

1. **Paste the SMS Summary Table** (Station + thalweg `Z Min`) and the
   **Plot Wizard → Observation Profile → View Values** output.
2. The app:
   - chunks the values into cross sections,
   - identifies which dataset is the ground vs each flood surface **by elevation**
     (independent of modeler naming or SMS column order),
   - matches each section to its station by **stationing order** — sections
     ranked by thalweg pair with stations sorted by stationing (the reference
     Excel's logic; the Summary `Z Min` is only a soft cross-check),
   - renders a styled chart per cross section.
3. **Review** the charts (confirm/adjust station labels, axis extents, add a
   culvert/bridge), then **Download Word document**.

### Why it's more robust than the spreadsheet

The Excel version infers dataset identity by ranking minimum elevations and
station identity by pairing cross-sections (ranked by elevation) with the
station list in stationing order. This tool keeps both of those (they're sound),
adds the elevation-based **ground vs water-surface** classification so column
order and arc names don't matter, validates the section count against the
Summary Table, cross-checks each thalweg against the Summary `Z Min`, and lets
you visually confirm every chart before export — so a wrong assignment can't
ship silently.

## Flow events are fully configurable

List as many or as few flood events as your export contains, in increasing
order of discharge (Ground is automatic). Presets are provided for the common
Existing (`2/100/500`) and Proposed (`+ 2080 100-year`) cases.

## Run locally

It's a static site — just serve the folder:

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

## Deploy (GitHub Pages)

Push to GitHub and enable **Settings → Pages → Deploy from branch** (root).
No build step.

## Project layout

```
index.html        UI
css/styles.css    styling
js/parse.js       parse Summary Table + profile paste
js/model.js       elevation classification + Z-min station matching
js/chart.js       Canvas2D cross-section renderer
js/zip.js         dependency-free ZIP writer
js/docx.js        assembles the .docx
js/app.js         UI wiring
test/             Node tests (run.mjs unit, e2e.mjs full pipeline)
test/ui/          Playwright real-browser UI tests
```

## Tests

```bash
npm install               # dev-only: @playwright/test + canvas (app ships zero deps)

npm run test:node         # parsing, classification, station match, history, report, .docx
npm run test:ui           # Playwright (Chromium) real-browser UI coverage
npm test                  # both

# first time only, fetch the browser binary:
npx playwright install chromium
```

The UI tests (`test/ui/`) cover the things only a real browser exercises:
chart-canvas rendering, the station chips + horizontal slider, the culvert box,
the Word download (unzipped and asserted), history save/load, restart, and the
auto-count validation hint. Playwright boots the static server itself.
