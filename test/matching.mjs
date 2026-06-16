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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
