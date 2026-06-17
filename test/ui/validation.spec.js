import { test, expect } from "@playwright/test";
import { openApp } from "./helpers.js";
import { SUMMARY_TSV, PROFILE_TSV, PROFILE_NOT_WHOLE } from "./fixtures.js";

// Scenario 9 — auto-count hint warns when datasets aren't divisible by sections
test("validation: non-divisible dataset count shows the 'isn't whole' hint", async ({ page }) => {
  await openApp(page);
  await page.fill("#summary", SUMMARY_TSV);
  await page.fill("#profile", PROFILE_NOT_WHOLE);

  await expect(page.locator("#autoCount")).toContainText("isn't whole");
});

test("validation: clean fixtures show a whole-number detection hint", async ({ page }) => {
  await openApp(page);
  await page.fill("#summary", SUMMARY_TSV);
  await page.fill("#profile", PROFILE_TSV);

  await expect(page.locator("#autoCount")).toContainText("Detected 2 cross sections × 4 datasets");
});
