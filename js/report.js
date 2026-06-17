// Diagnostic text report for a SAVED run.
//
// Re-runs the exact parse → build → match pipeline on a saved run's stored
// inputs and dumps everything needed to debug station mis-assignment offline:
// the raw step-1/2/3 inputs, the parsed Summary rows + which columns were
// detected as Station / Z-min, per-dataset profile stats (so ragged / no-data
// columns are visible), and the rank-to-rank thalweg ↔ Z-min pairing the
// matcher actually used, with every parse/build warning.
//
// Pure (no DOM): imports only the parse + model logic, so it is unit-testable.

import { parseProfile, parseSummary, formatStation } from "./parse.js";
import { buildSections } from "./model.js";

const f2 = (x) => (typeof x === "number" && isFinite(x) ? x.toFixed(2) : "—");
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

function statsOf(vals) {
  if (!vals.length) return { n: 0, min: NaN, max: NaN, mean: NaN };
  let mn = Infinity, mx = -Infinity, sum = 0;
  for (const v of vals) { if (v < mn) mn = v; if (v > mx) mx = v; sum += v; }
  return { n: vals.length, min: mn, max: mx, mean: sum / vals.length };
}

function section(title) {
  return `\n${"=".repeat(64)}\n${title}\n${"=".repeat(64)}\n`;
}

/**
 * @param run a saved history run: { condition, events, summary, profile,
 *            options, count, savedAt, id }
 * @param opts { now } optional ISO timestamp string (kept injectable for tests)
 * @returns {string} the report text
 */
export function buildRunReport(run, opts = {}) {
  const L = [];
  const now = opts.now || "(unstamped)";
  L.push("APPENDIX H GENERATOR — RUN DIAGNOSTIC REPORT");
  L.push(`Generated:  ${now}`);
  if (run.savedAt) L.push(`Saved run:  ${new Date(run.savedAt).toISOString?.() || run.savedAt}`);
  if (run.id) L.push(`Run id:     ${run.id}`);

  // ---- Step 1 ----
  const events = Array.isArray(run.events) ? run.events : [];
  L.push(section("STEP 1 — CONDITION & FLOW EVENTS"));
  L.push(`Condition label: ${run.condition || "(none)"}`);
  L.push("Flow events (increasing discharge order):");
  if (events.length) events.forEach((e, i) => L.push(`  ${i + 1}. ${e}`));
  else L.push("  (none given — section size inferred from the Summary Table)");
  L.push(`Datasets per section (ground + events): ${events.length ? events.length + 1 : "?"}`);

  // ---- Step 2: Summary ----
  const sum = parseSummary(run.summary || "");
  L.push(section("STEP 2 — SUMMARY TABLE"));
  L.push("--- Raw paste ---");
  L.push(run.summary && run.summary.trim() ? run.summary.replace(/\s+$/, "") : "(empty)");
  L.push("");
  L.push(`--- Parsed rows  (detected Station col #${sum.stationCol ?? "?"}, Z-min col #${sum.zCol ?? "?"}, 0-based) ---`);
  L.push(`  ${pad("#", 4)}${pad("Station", 14)}Z-min`);
  sum.rows.forEach((r, i) => L.push(`  ${pad(i + 1, 4)}${pad(f2(r.station), 14)}${f2(r.zmin)}`));
  L.push(`Parse warnings: ${sum.warnings.length ? "" : "none"}`);
  sum.warnings.forEach((w) => L.push(`  ! ${w}`));

  // ---- Step 3: Profile ----
  const prof = parseProfile(run.profile || "");
  L.push(section("STEP 3 — PROFILE VALUES"));
  L.push("--- Raw paste ---");
  L.push(run.profile && run.profile.trim() ? run.profile.replace(/\s+$/, "") : "(empty)");
  L.push("");
  L.push(`--- Parsed datasets (paste order): ${prof.pairs.length} ---`);
  L.push(`  ${pad("#", 4)}${pad("points", 9)}${pad("minVal", 11)}${pad("maxVal", 11)}meanVal`);
  prof.pairs.forEach((p, i) => {
    const s = statsOf(p.val);
    const flag = s.n === 0 ? "   <-- EMPTY" : "";
    L.push(`  ${pad(i + 1, 4)}${pad(s.n, 9)}${pad(f2(s.min), 11)}${pad(f2(s.max), 11)}${pad(f2(s.mean), 9)}${flag}`);
  });
  L.push(`Parse warnings: ${prof.warnings.length ? "" : "none"}`);
  prof.warnings.forEach((w) => L.push(`  ! ${w}`));
  L.push("");
  L.push("Note: blank cells and -9999 (SMS no-data) are dropped during parsing,");
  L.push("so 'points' is the count of VALID (distance,value) pairs per dataset.");

  // ---- Matching ----
  L.push(section("STATION MATCHING  (the suspected mis-match)"));
  let built = null, buildErr = null;
  try {
    built = buildSections(prof.pairs, sum.rows, {
      events,
      conditionLabel: run.condition || "",
      roundingMode: "nearest",
    });
  } catch (e) {
    buildErr = e.message;
  }

  if (buildErr) {
    L.push(`buildSections threw: ${buildErr}`);
  } else {
    const { sections, warnings: bw, datasetsPerSection } = built;
    L.push(`Detected sections: ${sections.length}   Summary stations: ${sum.rows.length}   datasets/section: ${datasetsPerSection}`);

    // Paste-order view: each section's ground classification + final station.
    L.push("");
    L.push("Per-section (paste order) — ground classification & assigned station:");
    L.push(`  ${pad("sec#", 6)}${pad("thalweg", 11)}${pad("#surf", 7)}${pad("station", 11)}${pad("matchDiff", 11)}surfaces (name:mean)`);
    sections.forEach((s) => {
      const surf = s.surfaces.map((x) => `${x.name}:${f2(statsOf(x.val).mean)}`).join("  ");
      L.push(
        `  ${pad(s.index + 1, 6)}${pad(f2(s.groundMin), 11)}${pad(s.surfaces.length, 7)}` +
        `${pad(s.stationLabel || "—", 11)}${pad(s.matchDiff != null ? f2(s.matchDiff) : "—", 11)}${surf}`
      );
    });

    // The actual optimal 1-D pairing the matcher uses: sort both, pair rank-to-rank.
    L.push("");
    L.push("Optimal 1-D pairing  (sections sorted by thalweg  ↔  stations sorted by Z-min):");
    const secSorted = [...sections].sort((a, b) => a.groundMin - b.groundMin);
    const rowSorted = [...sum.rows].filter((r) => isFinite(r.zmin)).sort((a, b) => a.zmin - b.zmin);
    L.push(`  ${pad("rank", 6)}${pad("thalweg", 11)}${pad("Z-min", 11)}${pad("diff", 9)}${pad("station", 11)}flag`);
    const n = Math.max(secSorted.length, rowSorted.length);
    for (let i = 0; i < n; i++) {
      const s = secSorted[i], r = rowSorted[i];
      const tw = s ? f2(s.groundMin) : "—";
      const zm = r ? f2(r.zmin) : "—";
      const diff = s && r ? Math.abs(s.groundMin - r.zmin) : NaN;
      const sta = r ? formatStation(r.station, "nearest") : "(no station)";
      const flag = isFinite(diff) && diff > 1.0 ? "  <-- DIFF > 1 ft" : "";
      L.push(`  ${pad(i + 1, 6)}${pad(tw, 11)}${pad(zm, 11)}${pad(f2(diff), 9)}${pad(sta, 11)}${flag}`);
    }

    L.push("");
    L.push(`Build warnings: ${bw.length ? "" : "none"}`);
    bw.forEach((w) => L.push(`  ! ${w}`));
  }

  // ---- All warnings rollup ----
  const all = [...sum.warnings, ...prof.warnings, ...(built ? built.warnings : []), ...(buildErr ? [buildErr] : [])];
  L.push(section("ALL WARNINGS (rollup)"));
  if (all.length) all.forEach((w) => L.push(`  ! ${w}`));
  else L.push("  none");

  return L.join("\n") + "\n";
}

// A safe filename for the report download.
export function reportFilename(run) {
  const cond = (run.condition || "Appendix H").replace(/[^\w]+/g, "_");
  const stamp = run.savedAt ? new Date(run.savedAt).toISOString().slice(0, 19).replace(/[:T]/g, "-") : "saved";
  return `${cond}_diagnostic_${stamp}.txt`;
}
