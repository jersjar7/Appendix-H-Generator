// Per-event line styling: color + line-type override flows through to the chart.
import { createCanvas } from "canvas";
import { renderChart, surfaceColor, LINE_STYLES } from "../js/chart.js";

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log("  ✓ " + m)) : (fail++, console.error("  ✗ " + m)));

const sec = {
  ground: { name: "Ground", dist: [0, 10, 20, 30, 40], val: [75, 68, 65, 68, 75] },
  surfaces: [
    { name: "42 CFS", dist: [6, 18, 30], val: [69.0, 69.0, 69.0] },
    { name: "43 CFS", dist: [6, 18, 30], val: [69.15, 69.15, 69.15] },
  ],
  groundMin: 65,
};
const render = (styles) => { const cv = createCanvas(700, 460); renderChart(cv.getContext("2d"), 700, 460, sec, { styles }); return cv.toBuffer("image/png").toString("base64"); };

ok(["solid", "dashed", "longDash", "dashDot", "dotted"].every((k) => Array.isArray(LINE_STYLES[k])), "LINE_STYLES exposes the named styles");
ok(LINE_STYLES.solid.length === 0, "solid → no dash");
ok(LINE_STYLES.dashed.length > 0, "dashed → dash pattern");

ok(surfaceColor("2080 100-year", 0, 3).dash, "2080 climate event keeps its default dash");
ok(surfaceColor("100-year", 0, 3).dash === null, "ordinary event defaults to solid");

const base = render(undefined);
ok(render({}) === base, "empty styles map === default render");
ok(render({ "43 CFS": { color: "#d23b3b" } }) !== base, "color override changes the chart");
ok(render({ "43 CFS": { style: "dashed" } }) !== base, "line-type override changes the chart");
ok(render({ "nope": { color: "#000" } }) === base, "override for an absent event is a no-op");

console.log(`\nline styles: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
