// Longitudinal profile parsing + build, validated against a real SMS paste.
import { parseProfile } from "../js/parse.js";
import { buildLongitudinal } from "../js/model.js";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log("  ✓ " + m)) : (fail++, console.error("  ✗ " + m)));
const finite = (a) => a.filter((v) => v != null && Number.isFinite(v));

const text = readFileSync(new URL("./fixtures_longitudinal.txt", import.meta.url), "utf8");

// --- gaps preserved vs dropped ---
const dropped = parseProfile(text).pairs;
const kept = parseProfile(text, { keepGaps: true }).pairs;
ok(dropped.length === 4, `4 datasets parsed (1 ground + 3 WSE), got ${dropped.length}`);
ok(kept.some((p) => p.val.includes(null)), "keepGaps preserves null gaps (dry under culvert)");
ok(!dropped.some((p) => p.val.includes(null)), "default parse drops -9999 (no nulls)");

// --- build one reach ---
const sec = buildLongitudinal(kept, { events: ["2-year", "100-year", "500-year"], conditionLabel: "Existing Conditions" });
ok(sec.longitudinal === true, "section flagged longitudinal");
ok(/Ground/.test(sec.ground.name), `ground labelled ("${sec.ground.name}")`);
ok(sec.surfaces.length === 3, "3 water surfaces");
ok(sec.surfaces.map((s) => s.name).join(",") === "2-year,100-year,500-year", "events assigned in order");

// ground = lowest minimum; it includes the road/culvert crest spike (~92 ft)
const groundMax = Math.max(...finite(sec.ground.val));
ok(groundMax > 90, `ground carries the road crest spike (~${groundMax.toFixed(0)} ft)`);

// surfaces ranked ascending by mean → 2yr mean < 100yr mean < 500yr mean
const means = sec.surfaces.map((s) => { const v = finite(s.val); return v.reduce((a, b) => a + b, 0) / v.length; });
ok(means[0] < means[1] && means[1] < means[2], `WSE means strictly increasing (${means.map((m) => m.toFixed(1)).join(" < ")})`);

// each surface actually has a gap (the dry culvert reach) preserved
ok(sec.surfaces.every((s) => s.val.includes(null)), "each WSE keeps its dry-reach gap");

// extra Proposed flood (5 datasets) still works
const fivePairs = [...kept, { dist: kept[0].dist.slice(), val: kept[1].val.map((v) => (v == null ? null : v + 5)) }];
const sec5 = buildLongitudinal(fivePairs, { events: ["2-year", "100-year", "500-year", "2080 100-year"] });
ok(sec5.surfaces.length === 4, "5-column Proposed: 4 water surfaces");
ok(sec5.surfaces[3].name === "2080 100-year", "extra Proposed flood named from events");

console.log(`\nlongitudinal: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
