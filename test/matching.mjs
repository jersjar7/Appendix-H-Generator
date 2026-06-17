import { buildSections } from "../js/model.js";

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log("  ✓", m)) : (fail++, console.error("  ✗", m)));

// Build dataset pairs directly. Each section = [surface, ground] (ground 2nd,
// to also confirm ground is found by lowest elevation, not position).
const ground = (m) => ({ dist: [0, 1, 2, 3, 4], val: [m + 3, m + 1, m, m + 2, m + 4] });
const surface = (s) => ({ dist: [1, 2, 3], val: [s, s + 0.1, s + 0.05] });

// Paste order thalwegs: 55, 65, 50 — the classic case where greedy
// nearest-available mis-assigns the last (50) to the leftover station (70),
// producing a ~20 ft error. Optimal sort-and-pair must avoid that.
const pairs = [
  surface(58), ground(55), // section A, thalweg 55
  surface(68), ground(65), // section B, thalweg 65
  surface(53), ground(50), // section C, thalweg 50
];
const summaryRows = [
  { station: 1000, zmin: 50 },
  { station: 1100, zmin: 60 },
  { station: 1200, zmin: 70 },
];

const { sections, warnings } = buildSections(pairs, summaryRows, {
  events: ["100-year"],
  conditionLabel: "Existing Conditions",
  roundingMode: "nearest",
});

const byMin = (m) => sections.find((s) => Math.abs(s.groundMin - m) < 0.001);
ok(byMin(50).stationLabel === "10+00", `thalweg 50 -> 10+00 (got ${byMin(50).stationLabel})`);
ok(byMin(55).stationLabel === "11+00", `thalweg 55 -> 11+00 (got ${byMin(55).stationLabel})`);
ok(byMin(65).stationLabel === "12+00", `thalweg 65 -> 12+00 (got ${byMin(65).stationLabel})`);

const maxDiff = Math.max(...sections.map((s) => s.matchDiff || 0));
ok(maxDiff <= 5.0001, `no cascade blow-up: max thalweg/Z-min diff ${maxDiff.toFixed(2)} ft (greedy would be ~20)`);

// ---- Regression: assignment is by STATIONING order, not Z-min order ----
// Real reaches have a non-monotonic Z-min (a high section between lower ones).
// Here station 1100 has the HIGHEST Z-min (90) but sits between 1000 and 1200.
// Pairing by Z-min order would put the highest section at 1100; pairing by
// stationing order (correct, matches the Excel) keeps elevation rank == station
// rank: lowest section -> lowest station.
console.log("\nnon-monotonic Z-min (stationing order must win):");
const pairs2 = [
  surface(63), ground(60), // section thalweg 60 (lowest)
  surface(83), ground(80), // section thalweg 80 (highest)
  surface(73), ground(70), // section thalweg 70 (middle)
];
const rows2 = [
  { station: 1000, zmin: 60 },
  { station: 1100, zmin: 90 }, // Z-min spikes here, but it's the MIDDLE station
  { station: 1200, zmin: 70 },
];
const { sections: s2 } = buildSections(pairs2, rows2, {
  events: ["100-year"], conditionLabel: "Existing Conditions", roundingMode: "nearest",
});
const find = (m) => s2.find((s) => Math.abs(s.groundMin - m) < 0.001);
ok(find(60).stationLabel === "10+00", `thalweg 60 -> 10+00 (got ${find(60).stationLabel})`);
ok(find(70).stationLabel === "11+00", `thalweg 70 -> 11+00 (got ${find(70).stationLabel})`);
ok(find(80).stationLabel === "12+00", `thalweg 80 -> 12+00 (got ${find(80).stationLabel}) — Z-min order would wrongly give 11+00`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
