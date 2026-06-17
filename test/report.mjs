// Tests for the saved-run diagnostic report (js/report.js).
import assert from "node:assert";
import { buildRunReport, reportFilename } from "../js/report.js";
import { SUMMARY_TSV, PROFILE_TSV } from "./ui/fixtures.js";

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log("  ✓", name); } else { fail++; console.log("  ✗", name); } }

// ---- Clean run: stations match, no diffs ----
const cleanRun = {
  id: "r1", savedAt: 1700000000000,
  condition: "Existing Conditions",
  events: ["2-year", "100-year", "500-year"],
  summary: SUMMARY_TSV,
  profile: PROFILE_TSV,
};
const rep = buildRunReport(cleanRun, { now: "2026-06-17T00:00:00Z" });

console.log("clean run:");
ok("echoes the raw summary paste", rep.includes("1047.09") && rep.includes("1272.11"));
ok("lists flow events", rep.includes("1. 2-year") && rep.includes("3. 500-year"));
ok("reports detected Station/Z-min columns", /detected Station col #\d/.test(rep));
ok("shows per-dataset stats with point counts", rep.includes("points") && rep.includes("meanVal"));
ok("has the matching section", rep.includes("STATION MATCHING"));
ok("has the optimal pairing table", rep.includes("Optimal 1-D pairing"));
ok("assigns correct stations 10+47 / 12+72", rep.includes("10+47") && rep.includes("12+72"));
ok("clean run flags NO diff>1ft", !rep.includes("DIFF > 1 ft"));
ok("clean run build warnings: none", /Build warnings: none/.test(rep));

// ---- Mismatch run: a Z-min that no thalweg matches → diff>1ft + warning ----
const badSummary = ["Reach\tStation\tMin", "Hood Canal\t1047.09\t54.78", "Hood Canal\t1660.00\t70.00"].join("\n");
const badRun = { ...cleanRun, id: "r2", summary: badSummary };
const rep2 = buildRunReport(badRun, { now: "2026-06-17T00:00:00Z" });

console.log("mismatch run:");
ok("surfaces a DIFF > 1 ft flag in the pairing table", rep2.includes("DIFF > 1 ft"));
ok("emits a 'differs from Summary Z-min' build warning", /differs from Summary Z-min/.test(rep2));
ok("rollup lists the warning", /ALL WARNINGS/.test(rep2) && /differs from Summary Z-min/.test(rep2.split("ALL WARNINGS")[1]));

// ---- Empty / no-data dataset is flagged ----
// Middle dataset has no values (a non-trailing empty pair survives parsing;
// trailing empties would be trimmed). Third pair has data so it isn't trimmed.
const emptyProfile = [
  "Distance\tValue\tDistance\tValue\tDistance\tValue",
  "1\t0\t54.78\t\t\t4\t60.0",
  "2\t2\t55.00\t\t\t6\t60.0",
].join("\n");
const emptyRun = { ...cleanRun, id: "r3", events: ["2-year"], profile: emptyProfile,
  summary: ["Reach\tStation\tMin", "Hood Canal\t1047.09\t54.78"].join("\n") };
const rep3 = buildRunReport(emptyRun, { now: "2026-06-17T00:00:00Z" });
ok("flags an EMPTY dataset column", rep3.includes("EMPTY"));

// ---- filename ----
ok("filename is safe and .txt", /^Existing_Conditions_diagnostic_.*\.txt$/.test(reportFilename(cleanRun)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
