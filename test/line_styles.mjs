// Per-line styling: color + line-type + thickness override flows through to the
// chart, for ground / each water surface / culvert.
import { createCanvas } from "canvas";
import { renderChart, surfaceColor, LINE_STYLES, DEFAULT_WIDTHS, lineWidthPx } from "../js/chart.js";

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log("  ✓ " + m)) : (fail++, console.error("  ✗ " + m)));

const sec = {
  ground: { name: "Ground", dist: [0, 10, 20, 30, 40], val: [75, 68, 65, 68, 75] },
  surfaces: [
    { name: "42 CFS", dist: [6, 18, 30], val: [69.0, 69.0, 69.0] },
    { name: "43 CFS", dist: [6, 18, 30], val: [69.15, 69.15, 69.15] },
  ],
  groundMin: 65,
  structure: { type: "Culvert", kind: "box", x: 20, bottom: 60, width: 10, top: 68 },
};
const render = (styles) => { const cv = createCanvas(700, 460); renderChart(cv.getContext("2d"), 700, 460, sec, { styles }); return cv.toBuffer("image/png").toString("base64"); };

ok(["solid", "dashed", "longDash", "dashDot", "dotted"].every((k) => Array.isArray(LINE_STYLES[k])), "LINE_STYLES exposes the named styles");
ok(LINE_STYLES.solid.length === 0, "solid → no dash");
ok(LINE_STYLES.dashed.length > 0, "dashed → dash pattern");
ok(DEFAULT_WIDTHS.ground && DEFAULT_WIDTHS.surface && DEFAULT_WIDTHS.culvert, "DEFAULT_WIDTHS for ground/surface/culvert");
ok(Math.abs(lineWidthPx(1300, 2) - 2) < 1e-9, "weight == px at reference width 1300");
ok(lineWidthPx(2600, 2) > 3.9, "weight scales with render width");

ok(surfaceColor("2080 100-year", 0, 3).dash, "2080 climate event keeps its default dash");
ok(surfaceColor("100-year", 0, 3).dash === null, "ordinary event defaults to solid");

const base = render(undefined);
ok(render({}) === base, "empty styles map === default render");
ok(render({ "43 CFS": { color: "#d23b3b" } }) !== base, "surface color override changes the chart");
ok(render({ "43 CFS": { style: "dashed" } }) !== base, "surface line-type override changes the chart");
ok(render({ "43 CFS": { width: 6 } }) !== base, "surface thickness override changes the chart");
ok(render({ __ground__: { color: "#0000ff" } }) !== base, "ground color override changes the chart");
ok(render({ __ground__: { width: 6 } }) !== base, "ground thickness override changes the chart");
ok(render({ __culvert__: { color: "#cc00cc" } }) !== base, "culvert color override changes the chart");
ok(render({ __culvert__: { style: "dashed", width: 5 } }) !== base, "culvert line-type + thickness override changes the chart");
ok(render({ "nope": { color: "#000" } }) === base, "override for an absent line is a no-op");

console.log(`\nline styles: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
