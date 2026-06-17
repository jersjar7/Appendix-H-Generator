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
   - matches each section to its station by **thalweg ↔ `Z Min`** (exact, not guessed),
   - renders a styled chart per cross section.
3. **Review** the charts (confirm/adjust station labels, axis extents, add a
   culvert/bridge), then **Download Word document**.

### Why it's more robust than the spreadsheet

The Excel version inferred dataset identity by ranking minimum elevations and
guessed station identity by assuming water-surface elevation rises with
stationing. This tool keeps the reliable elevation logic but replaces the
fragile station guess with a direct **thalweg-to-`Z Min` match**, validates the
section count against the Summary Table, and lets you visually confirm every
chart before export — so a wrong assignment can't ship silently.

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
```

## Tests

```bash
npm install canvas        # only needed for the headless render test
node test/run.mjs         # parsing, classification, station format, docx
node test/e2e.mjs         # full pipeline -> renders charts -> builds a .docx
```
