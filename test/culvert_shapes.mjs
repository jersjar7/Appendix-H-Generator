// Geometry tests for parametric culvert shapes (box / arch / circle / ellipse).
import { culvertPoints, culvertHalfWidth } from "../js/chart.js";
import { createCanvas } from "canvas";
import { renderChart } from "../js/chart.js";

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log("  ✓ " + m)) : (fail++, console.error("  ✗ " + m)));
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const xs = (p) => p.map((q) => q[0]), ys = (p) => p.map((q) => q[1]);

// ---- box ----
const box = { kind: "box", x: 10, bottom: 50, width: 12, top: 56 };
{
  const p = culvertPoints(box);
  ok(p.length === 4, "box → 4 corner points");
  ok(near(Math.min(...xs(p)), 4) && near(Math.max(...xs(p)), 16), "box spans center ± width/2");
  ok(near(Math.min(...ys(p)), 50) && near(Math.max(...ys(p)), 56), "box runs invert→top");
  ok(near(culvertHalfWidth(box), 6), "box halfWidth = width/2");
}

// ---- arch: straight legs + curved crown ----
const arch = { kind: "arch", x: 0, bottom: 50, span: 20, legHeight: 5, rise: 8, top: 63 };
{
  const p = culvertPoints(arch);
  ok(near(p[0][0], -10) && near(p[0][1], 50), "arch starts base-left at invert");
  ok(near(p[1][0], -10) && near(p[1][1], 55), "arch goes straight up the left leg to springline");
  ok(near(p[p.length - 1][0], 10) && near(p[p.length - 1][1], 50), "arch ends base-right at invert");
  const apex = Math.max(...ys(p));
  ok(near(apex, 63), "arch crown reaches bottom+leg+rise");
  ok(near(Math.min(...xs(p)), -10) && near(Math.max(...xs(p)), 10), "arch width = span");
  ok(near(culvertHalfWidth(arch), 10), "arch halfWidth = span/2");
  // legless arch springs straight from the invert
  const a0 = culvertPoints({ ...arch, legHeight: 0 });
  ok(near(a0[1][1], 50), "leg height 0 → crown springs from invert");
}

// ---- circle ----
const circ = { kind: "circle", x: 0, bottom: 50, diameter: 12, top: 62 };
{
  const p = culvertPoints(circ);
  ok(near(Math.min(...ys(p)), 50) && near(Math.max(...ys(p)), 62), "circle runs invert→invert+diameter");
  ok(near(Math.min(...xs(p)), -6) && near(Math.max(...xs(p)), 6), "circle width = diameter");
  const cy = 56;                              // bottom + r
  ok(p.every((q) => near(Math.hypot(q[0], q[1] - cy), 6, 1e-6)), "all points lie on radius 6");
  ok(near(culvertHalfWidth(circ), 6), "circle halfWidth = diameter/2");
}

// ---- ellipse ----
const ell = { kind: "ellipse", x: 0, bottom: 50, width: 22, height: 10, top: 60 };
{
  const p = culvertPoints(ell);
  ok(near(Math.min(...xs(p)), -11) && near(Math.max(...xs(p)), 11), "ellipse width axis");
  ok(near(Math.min(...ys(p)), 50) && near(Math.max(...ys(p)), 60), "ellipse height axis");
}

// ---- legacy structure (no kind) renders as a box without throwing ----
{
  const sec = { ground: { name: "g", dist: [0, 10, 20], val: [60, 50, 60] }, surfaces: [], groundMin: 50,
    structure: { type: "Culvert", scour: 4, height: 10, width: 8, bed: 2, x: 10, bottom: 44, top: 54 } };
  const cv = createCanvas(400, 300);
  let threw = false; try { renderChart(cv.getContext("2d"), 400, 300, sec, {}); } catch { threw = true; }
  ok(!threw, "legacy (kind-less) box structure still renders");
}

console.log(`\nculvert shapes: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
