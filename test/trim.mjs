// Tests for disconnected "extra-area" detection/trimming (js/trim.js).
import { detectDisconnected, trimSeries, sectionOutlierCount, trimmedDatasets } from "../js/trim.js";

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log("  ✓", m)) : (fail++, console.error("  ✗", m)));

// A clean continuous valley: smooth V, gradual point-to-point change, densely
// sampled in the channel and sparser on the banks (the realistic pattern that
// fooled spacing-based detection).
const cleanDist = [0, 2.5, 4, 5, 6, 7, 7.5, 8, 8.5, 9, 10, 11, 12, 14, 16, 19];
const cleanVal = [62, 60, 58, 57, 56, 55.6, 55.5, 55.5, 55.6, 56, 57, 58, 59, 60.5, 61.5, 62.5];
ok(detectDisconnected(cleanDist, cleanVal).dropped.length === 0, "clean valley: nothing flagged");

// Same channel, plus two disconnected ~93 ft segments reached by a >10 ft jump
// with no slope points between (the real 14+13 signature).
const strayDist = [0, 2.8, 7.5, 8.2, 8.8, 9.5, 10.1, 10.8, 11.5, 12.3, 13, 13.7, 14.5, 15.2, 15.9, 17, 18.2, 19.4, 20.5, 24.6, 29.7, 34.2];
const strayVal = [93.7, 93.6, 72.4, 72.4, 72.3, 72.3, 72.3, 71.9, 71.6, 71.5, 71.4, 71.5, 71.6, 71.9, 72.3, 72.3, 72.4, 72.4, 72.5, 93.1, 93.0, 92.9];
const det = detectDisconnected(strayDist, strayVal);
ok(det.dropped.length === 5, `stray highs: 5 points flagged (got ${det.dropped.length})`);
ok(det.keep.length === strayDist.length - 5, "stray highs: keep = all but the 5");
// every kept point is in the ~71-72.5 channel band, every dropped one is ~93
ok(det.keep.every((i) => strayVal[i] < 80), "kept points are the channel");
ok(det.dropped.every((i) => strayVal[i] > 80), "dropped points are the ~93 ft strays");

// trimSeries returns a trimmed copy without mutating the original
const series = { name: "Proposed Ground", dist: strayDist, val: strayVal };
const t = trimSeries(series);
ok(t.dropped === 5 && t.series.val.length === strayDist.length - 5, "trimSeries drops 5, copies");
ok(series.val.length === strayDist.length, "trimSeries does not mutate the input");
ok(Math.min(...series.val) === Math.min(...t.series.val), "thalweg (min) is preserved by trimming");

// too-short series are left alone (not enough to judge)
ok(detectDisconnected([0, 1, 2, 5], [50, 51, 80, 52]).dropped.length === 0, "short series: no judgement");

// section helpers
const sec = { ground: series, surfaces: [{ name: "100-year", dist: [5, 10, 15], val: [74, 74, 74] }] };
ok(sectionOutlierCount(sec) === 5, "sectionOutlierCount sums across datasets");
ok(trimmedDatasets(sec).ground.val.length === strayDist.length - 5, "trimmedDatasets trims the ground");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
