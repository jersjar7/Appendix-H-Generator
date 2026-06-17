import { test, expect } from "@playwright/test";
import { openApp } from "./helpers.js";
import { SUMMARY_ONE, PROFILE_WITH_OUTLIER } from "./fixtures.js";

// A section with disconnected stray points gets an informational message and a
// per-chart Trim control. Nothing is removed until the user opts in.
test("trim outliers: stray segment is flagged and the Trim control cleans the chart", async ({ page }) => {
  await openApp(page);
  await page.fill("#summary", SUMMARY_ONE);
  await page.fill("#profile", PROFILE_WITH_OUTLIER);
  await page.click("#generate");
  await expect(page.locator(".chart-card").first()).toBeVisible();

  // informational message names the disconnected points
  await expect(page.locator("#messages")).toContainText("disconnected");

  const card = page.locator(".chart-card").first();
  const trim = card.locator(".ctrim");
  await expect(trim).toBeVisible();

  // the station label is correct regardless of the stray points
  await expect(card.locator(".caption-preview")).toContainText("10+47");

  // toggling Trim redraws the canvas (the stray ~82 ft points are removed)
  const before = await card.locator("canvas").evaluate((c) => c.toDataURL());
  await trim.check();
  await expect.poll(async () => await card.locator("canvas").evaluate((c) => c.toDataURL())).not.toBe(before);

  // unchecking restores the original render
  await trim.uncheck();
  await expect.poll(async () => await card.locator("canvas").evaluate((c) => c.toDataURL())).toBe(before);
});
