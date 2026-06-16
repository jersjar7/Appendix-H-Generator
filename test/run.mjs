import { parseProfile, parseSummary, formatStation } from "../js/parse.js";
import { buildSections } from "../js/model.js";
import { buildDocx } from "../js/docx.js";
import { writeFileSync } from "node:fs";

let pass = 0,
  fail = 0;
const ok = (cond, msg) => (cond ? (pass++, console.log("  ✓", msg)) : (fail++, console.error("  ✗", msg)));

// --- formatStation ---
console.log("formatStation:");
ok(formatStation(1047.09) === "10+47", "1047.09 -> 10+47 (nearest)");
ok(formatStation(1549.86) === "15+50", "1549.86 -> 15+50 (nearest)");
ok(formatStation(1644.82) === "16+45", "1644.82 -> 16+45 (nearest)");
ok(formatStation(47.2) === "0+47", "47.2 -> 0+47");
ok(formatStation(1272.11, "up") === "12+73", "1272.11 up -> 12+73");

// --- Build a synthetic tab-delimited profile: 2 sections x (ground + 3 surfaces) ---
// Section A thalweg ~54.78, Section B thalweg ~65.25 (to match summary z-mins).
// Datasets are intentionally placed in a NON sorted order to test elevation logic.
function colTSV(sectionDefs) {
  // sectionDefs: [{ground:[[d,v]...], surfaces:[[[d,v]...],...]}]
  const columns = [];
  for (const sec of sectionDefs) {
    // push in a deliberately scrambled order: surface(high), ground, surface(low), surface(mid)
    const [low, mid, high] = sec.surfaces;
    [high, sec.ground, low, mid].forEach((series) => {
      columns.push(series.map((p) => p[0])); // dist
      columns.push(series.map((p) => p[1])); // val
    });
  }
  const nRows = Math.max(...columns.map((c) => c.length));
  const lines = ["Distance\tValue".repeat(1)]; // header-ish (non-numeric -> dropped)
  const headerCells = [];
  for (let i = 0; i < columns.length / 2; i++) headerCells.push("Distance", "Value");
  lines[0] = headerCells.join("\t");
  for (let r = 0; r < nRows; r++) {
    const cells = [String(r + 1)]; // leading index column
    for (const col of columns) cells.push(col[r] !== undefined ? String(col[r]) : "");
    lines.push(cells.join("\t"));
  }
  return lines.join("\n");
}

const mkGround = (base) =>
  [0, 2, 4, 6, 8, 10, 12, 14, 16].map((d, i) => [d, base + [6, 4, 2, 1, 0.0, 0.2, 1, 3, 5][i]]);
const mkSurface = (lvl) =>
  [4, 6, 8, 10, 12].map((d) => [d, lvl]);

const sectionDefs = [
  { ground: mkGround(54.78), surfaces: [mkSurface(56.4), mkSurface(56.55), mkSurface(56.72)] },
  { ground: mkGround(65.25), surfaces: [mkSurface(80.8), mkSurface(83.2), mkSurface(86.1)] },
];
const profileText = colTSV(sectionDefs);

const summaryText = [
  "Reach\tStation\tMin",
  "Hood Canal\t1047.09\t54.78",
  "Hood Canal\t1272.11\t65.25",
].join("\n");

console.log("parseProfile:");
const { pairs, warnings: pw } = parseProfile(profileText);
ok(pairs.length === 8, `found 8 dataset pairs (got ${pairs.length})`);
ok(pw.length === 0, "no profile warnings");

console.log("parseSummary:");
const { rows: sumRows } = parseSummary(summaryText);
ok(sumRows.length === 2, `found 2 summary rows (got ${sumRows.length})`);
ok(sumRows[0].station === 1047.09 && sumRows[0].zmin === 54.78, "station/zmin parsed");

console.log("buildSections:");
const { sections, warnings: mw } = buildSections(pairs, sumRows, {
  events: ["2-year", "100-year", "500-year"],
  conditionLabel: "Existing Conditions",
  roundingMode: "nearest",
});
ok(sections.length === 2, `2 sections (got ${sections.length})`);
ok(sections[0].stationLabel === "10+47", `section A -> 10+47 (got ${sections[0].stationLabel})`);
ok(sections[1].stationLabel === "12+72", `section B -> 12+72 (got ${sections[1].stationLabel})`);
ok(
  Math.abs(sections[0].groundMin - 54.78) < 0.01,
  `section A thalweg ~54.78 (got ${sections[0].groundMin})`
);
ok(
  sections[0].surfaces.map((s) => s.name).join(",") === "2-year,100-year,500-year",
  "surfaces labelled in ascending-elevation order despite scrambled input"
);
ok(mw.length === 0, `no model warnings (got ${mw.length}: ${mw.join(" | ")})`);

console.log("buildDocx:");
// tiny 1x1 PNG
const png = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
  0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
  0x00, 0x00, 0x03, 0x00, 0x01, 0x4e, 0xd9, 0x8c, 0xb8, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
  0x44, 0xae, 0x42, 0x60, 0x82,
]);
const docx = buildDocx([
  { png, caption: "Existing Conditions, Cross Section at Station 10+47", widthIn: 6.5, heightIn: 3.86 },
  { png, caption: "Existing Conditions, Cross Section at Station 12+72", widthIn: 6.5, heightIn: 3.86 },
]);
writeFileSync("/tmp/test_out.docx", docx);
ok(docx[0] === 0x50 && docx[1] === 0x4b, "docx starts with PK zip signature");
ok(docx.length > 400, `docx has content (${docx.length} bytes)`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
