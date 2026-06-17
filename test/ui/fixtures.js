// Deterministic, known-good fixtures for the UI tests.
//
// Two cross sections, each with a ground dataset + 3 water surfaces, pasted in a
// scrambled dataset order (high surface, ground, low surface, mid surface) so the
// elevation classification in model.js is actually exercised. Ground minima are
// 54.78 and 65.25 to match the Summary Table Z-mins, so the optimal Z-min
// matching should label them 10+47 and 12+72 with no "differs by" warnings.
//
// Everything here is pure (no Math.random / Date) so results are reproducible.

// One ground profile: a channel that dips to `base` (the thalweg) near the middle.
function ground(base) {
  const shape = [7, 5, 3, 1.5, 0.4, 0, 0.5, 2, 4, 6]; // 0 is the thalweg
  return [0, 2, 4, 6, 8, 10, 12, 14, 16, 18].map((d, i) => [d, +(base + shape[i]).toFixed(2)]);
}

// A flat-ish water surface at `lvl`, sampled on its own x-grid (ragged columns).
function surf(lvl, x0, x1) {
  const out = [];
  for (let d = x0; d <= x1; d += 1.5) out.push([d, +lvl.toFixed(2)]);
  return out;
}

// Two sections. surf array is [low, mid, high]; columns emitted scrambled.
const SECTIONS = [
  { g: ground(54.78), surf: [surf(56.40, 4, 14), surf(56.55, 4, 14), surf(56.72, 4, 14)] },
  { g: ground(65.25), surf: [surf(80.80, 3, 16), surf(83.20, 3, 16), surf(86.10, 3, 16)] },
];

function buildProfileTSV(secs) {
  const cols = [];
  for (const s of secs) {
    const [low, mid, high] = s.surf;
    // scrambled order: high surface, ground, low surface, mid surface
    [high, s.g, low, mid].forEach((series) => {
      cols.push(series.map((p) => p[0])); // distance column
      cols.push(series.map((p) => p[1])); // value column
    });
  }
  const n = Math.max(...cols.map((c) => c.length));
  const head = [];
  for (let i = 0; i < cols.length / 2; i++) head.push("Distance", "Value");
  const lines = [head.join("\t")];
  for (let r = 0; r < n; r++) {
    const cells = [String(r + 1)]; // leading index column
    for (const col of cols) cells.push(col[r] !== undefined ? String(col[r]) : "");
    lines.push(cells.join("\t"));
  }
  return lines.join("\n");
}

export const SUMMARY_TSV = ["Reach\tStation\tMin", "Hood Canal\t1047.09\t54.78", "Hood Canal\t1272.11\t65.25"].join("\n");

export const PROFILE_TSV = buildProfileTSV(SECTIONS);

export const EVENTS = ["2-year", "100-year", "500-year"];

export const EXPECTED = {
  sectionCount: 2,
  datasetsPerSection: 4,
  stationsAsc: ["10+47", "12+72"],
  bannerRe: /Generated 2 cross sections · 4 datasets each \(1 ground \+ 3 surfaces\)\./,
};

// A profile that is NOT divisible by the section size (3 datasets for 1 section
// of 4) — used to assert the auto-count "isn't whole" warning. We reuse one
// section but drop a column so the math is ragged.
export const PROFILE_NOT_WHOLE = (() => {
  const lines = PROFILE_TSV.split("\n");
  // Keep header + rows but chop to an odd number of dataset columns by removing
  // the last 6 columns (3 datasets), leaving 5 datasets across 2 summary rows.
  return lines.map((line) => line.split("\t").slice(0, 11).join("\t")).join("\n");
})();
