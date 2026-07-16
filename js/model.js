// Turns parsed dataset pairs + summary rows into labelled cross sections.
// Classification is by elevation (modeler-naming-independent); station identity
// is by matching each section's ground minimum (thalweg) to the Summary Table
// Z-min (column/arc-order-independent).

import { formatStation } from "./parse.js";
import { sectionOutlierCount } from "./trim.js";

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const min = (a) => (a.length ? Math.min(...a) : Infinity);

/**
 * @param pairs   ordered dataset pairs from parseProfile
 * @param summaryRows  [{station, zmin}] from parseSummary (may be empty)
 * @param opts    { events:[names...], conditionLabel, roundingMode,
 *                  stationLabels:[...]  // optional manual fallback }
 */
export function buildSections(pairs, summaryRows, opts) {
  const warnings = [];
  const nSections = summaryRows && summaryRows.length ? summaryRows.length : null;

  // datasets per section
  let dps;
  if (opts.events && opts.events.length) {
    dps = opts.events.length + 1; // +1 ground
  } else if (nSections) {
    dps = Math.round(pairs.length / nSections);
  } else {
    throw new Error("Provide either an event list or a Summary Table to set the section size.");
  }

  if (pairs.length % dps !== 0) {
    warnings.push(
      `Paste has ${pairs.length} datasets, not divisible by ${dps} per section. ` +
        `Check that the event list matches what was exported.`
    );
  }
  const computedSections = Math.floor(pairs.length / dps);
  if (nSections && computedSections !== nSections) {
    warnings.push(
      `Summary Table lists ${nSections} cross sections but the values paste implies ${computedSections}. ` +
        `Using ${computedSections}.`
    );
  }

  const eventNames =
    opts.events && opts.events.length
      ? opts.events.slice()
      : Array.from({ length: dps - 1 }, (_, i) => `Event ${i + 1}`);

  // "Existing Conditions" -> "Existing Ground" for the legend.
  const groundWord = (opts.conditionLabel || "").replace(/\s*conditions?\s*/i, " ").trim();
  const groundLabel = (groundWord ? groundWord + " " : "") + "Ground";

  const sections = [];
  for (let s = 0; s < computedSections; s++) {
    const group = pairs.slice(s * dps, s * dps + dps);
    // Ground = dataset with the lowest minimum value (thalweg sits below all WSEs).
    let groundIdx = 0;
    for (let i = 1; i < group.length; i++) {
      if (min(group[i].val) < min(group[groundIdx].val)) groundIdx = i;
    }
    const ground = group[groundIdx];
    const groundMin = min(ground.val);

    // Remaining datasets are water surfaces; rank ascending by mean elevation
    // and map onto the user's ordered event names (2-yr < 5-yr < ... < 500-yr).
    const surfaces = group
      .filter((_, i) => i !== groundIdx)
      .map((d) => ({ d, key: mean(d.val) }))
      .sort((a, b) => a.key - b.key);

    const labelled = surfaces.map((s2, i) => ({
      name: eventNames[i] || `Event ${i + 1}`,
      dist: s2.d.dist,
      val: s2.d.val,
    }));

    sections.push({
      index: s,
      ground: { name: groundLabel, dist: ground.dist, val: ground.val },
      groundMin,
      surfaces: labelled,
      station: null,
      stationLabel: null,
      structure: null, // { type:'Culvert'|'Bridge', x, top, bottom }
      yOverride: null, // { min, max } optional
    });
  }

  assignStations(sections, summaryRows, opts, warnings);

  // Flag (never auto-remove) disconnected "extra area" points so the UI can
  // offer a per-chart trim. See js/trim.js.
  const flagged = [];
  for (const sec of sections) {
    sec.outlierCount = sectionOutlierCount(sec);
    if (sec.outlierCount > 0) flagged.push(`${sec.stationLabel} (${sec.outlierCount})`);
  }
  if (flagged.length) {
    warnings.push(
      `Possible disconnected "extra-area" points detected at ${flagged.join(", ")}. ` +
        `These distort the chart but not the station match; use the "Trim outliers" control on those charts to drop them — nothing is removed automatically.`
    );
  }

  return { sections, warnings, datasetsPerSection: dps, eventNames };
}

// Build a single longitudinal profile section from the same columnar paste (one
// reach along the stream centerline, not many cross sections). Mirrors the cross-
// section classification: ground = the dataset with the lowest minimum (channel
// bed); the rest are water surfaces ranked ascending by mean elevation and named
// from the events list (so column order / extra Proposed floods don't matter).
// Tolerates null gaps (dry reaches under a culvert) kept by parseProfile keepGaps.
export function buildLongitudinal(pairs, opts = {}) {
  const valid = (a) => a.filter((v) => v != null && Number.isFinite(v));
  if (pairs.length < 2) throw new Error("Need at least a ground line and one water surface.");
  const events = opts.events && opts.events.length ? opts.events : [];
  const extraGroundCount = events.length && pairs.length > events.length + 1 ? 2 : 1;
  let groundPairs, surfacePairs, groundNames, primaryGroundIndex;

  if (extraGroundCount > 1) {
    groundPairs = pairs.slice(0, extraGroundCount);
    surfacePairs = pairs.slice(extraGroundCount);
    groundNames = extraGroundCount === 2
      ? ["Existing Ground", "Proposed Ground"]
      : Array.from({ length: extraGroundCount }, (_, i) => `Ground ${i + 1}`);
    primaryGroundIndex = /existing/i.test(opts.conditionLabel || "") ? 0 : Math.min(1, extraGroundCount - 1);
  } else {
    let gi = 0;
    for (let i = 1; i < pairs.length; i++) {
      if (min(valid(pairs[i].val)) < min(valid(pairs[gi].val))) gi = i;
    }
    groundPairs = [pairs[gi]];
    surfacePairs = pairs.filter((_, i) => i !== gi);
    const groundWord = (opts.conditionLabel || "").replace(/\s*conditions?\s*/i, " ").trim();
    groundNames = [(groundWord ? groundWord + " " : "") + "Ground"];
    primaryGroundIndex = 0;
  }

  const labelledGrounds = groundPairs.map((g, i) => ({ name: groundNames[i] || `Ground ${i + 1}`, dist: g.dist, val: g.val }));
  const ground = labelledGrounds[primaryGroundIndex];
  const extraGrounds = labelledGrounds
    .filter((_, i) => i !== primaryGroundIndex)
    .map((g, i) => ({ ...g, styleKey: `__ground_extra_${i}__` }));

  const surfaces = surfacePairs
    .map((d) => ({ d, key: mean(valid(d.val)) }))
    .sort((a, b) => a.key - b.key)
    .map((s, i) => ({ name: events[i] || `Event ${i + 1}`, dist: s.d.dist, val: s.d.val }));
  return {
    ground,
    extraGrounds,
    groundMin: min(valid(ground.val)),
    surfaces,
    longitudinal: true,
  };
}

// Elevation rank of a section: its thalweg (channel bed minimum). The channel
// bed rises monotonically with stationing going upstream, so the thalweg is the
// quantity that tracks station order. (The reference Excel ranks by "avg water
// surface", which usually agrees but can invert when a low channel carries high
// backwater — the thalweg is the more direct, stable key.)
function rankKey(sec) {
  return sec.groundMin;
}

// Match sections to stations by ORDER, the way the reference Excel does it:
// rank the cross sections by elevation and pair them, rank-to-rank, with the
// station list sorted by stationing (lowest section -> lowest station). The
// Summary Z-min is NOT used as a join key: on real reaches it can differ from
// the observation-profile thalweg by 10-20 ft (it's a different SMS measurement)
// and it is non-monotonic along the reach, which scrambled the pairing. Z-min is
// kept only as a soft visual cross-check. Fallback: explicit station labels.
function assignStations(sections, summaryRows, opts, warnings) {
  const hasStations =
    summaryRows && summaryRows.length && summaryRows.every((r) => typeof r.station === "number" && isFinite(r.station));

  if (hasStations) {
    const secSorted = [...sections].sort((a, b) => rankKey(a) - rankKey(b));
    const rowSorted = [...summaryRows].sort((a, b) => a.station - b.station);

    if (secSorted.length !== rowSorted.length) {
      warnings.push(
        `Summary Table lists ${rowSorted.length} station${rowSorted.length === 1 ? "" : "s"} but ${secSorted.length} cross section${secSorted.length === 1 ? "" : "s"} were detected — pairing the overlap by stationing order.`
      );
    }
    const n = Math.min(secSorted.length, rowSorted.length);
    for (let i = 0; i < n; i++) {
      const sec = secSorted[i];
      const row = rowSorted[i];
      sec.station = row.station;
      sec.stationLabel = formatStation(row.station, opts.roundingMode);
      if (typeof row.zmin === "number" && isFinite(row.zmin)) {
        sec.matchDiff = Math.abs(row.zmin - sec.groundMin);
        // Soft cross-check only — the assignment is by stationing order, not this.
        if (sec.matchDiff > 2.0) {
          warnings.push(
            `Station ${sec.stationLabel}: Summary Z-min (${row.zmin.toFixed(2)}) differs from the profile thalweg (${sec.groundMin.toFixed(2)}) by ${sec.matchDiff.toFixed(2)} ft. Sections are assigned by stationing order, so this is informational — verify visually if this one looks off.`
          );
        }
      }
    }
    for (let i = n; i < secSorted.length; i++) {
      secSorted[i].stationLabel = `Section ${secSorted[i].index + 1}`;
    }
    return;
  }

  // Fallback ordering by elevation rank ascending (profile rises with stationing).
  const order = [...sections].sort((a, b) => rankKey(a) - rankKey(b));
  const labels =
    opts.stationLabels && opts.stationLabels.length
      ? opts.stationLabels
      : summaryRows
      ? summaryRows
          .slice()
          .sort((a, b) => a.station - b.station)
          .map((r) => formatStation(r.station, opts.roundingMode))
      : [];
  order.forEach((sec, i) => {
    sec.stationLabel = labels[i] || `Section ${sec.index + 1}`;
  });
  if (!labels.length)
    warnings.push("No Summary Table or station labels provided — sections numbered by elevation order.");
}
