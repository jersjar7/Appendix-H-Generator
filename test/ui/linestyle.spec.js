import { test, expect } from "@playwright/test";
import { openApp, pasteFixtures, generate } from "./helpers.js";

test("line styles: per-event color + line type panel redraws all charts", async ({ page }) => {
  await openApp(page);
  await pasteFixtures(page);
  await generate(page);

  // panel lists ground + one row per water-surface event (fixtures: 2/100/500-year)
  const panel = page.locator(".style-panel");
  await expect(panel).toHaveCount(1);
  await panel.locator("summary").click();
  const rows = panel.locator(".style-row");
  await expect(rows).toHaveCount(4);                 // ground + 3 events
  await expect(rows.first().locator(".ls-name")).toContainText(/Ground/i);

  const canvas = page.locator(".chart-card").first().locator("canvas");
  const before = await canvas.evaluate((c) => c.toDataURL());

  // change the first line's (ground) line type → every chart redraws
  await rows.first().locator(".ls-style").selectOption("dashed");
  await expect.poll(async () => await canvas.evaluate((c) => c.toDataURL())).not.toBe(before);

  // changing color also redraws
  const afterDash = await canvas.evaluate((c) => c.toDataURL());
  await rows.first().locator(".ls-color").evaluate((el) => { el.value = "#d23b3b"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await expect.poll(async () => await canvas.evaluate((c) => c.toDataURL())).not.toBe(afterDash);

  // changing thickness also redraws
  const afterColor = await canvas.evaluate((c) => c.toDataURL());
  await rows.nth(1).locator(".ls-width").fill("6");
  await expect.poll(async () => await canvas.evaluate((c) => c.toDataURL())).not.toBe(afterColor);
});
