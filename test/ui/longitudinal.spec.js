import { test, expect } from "@playwright/test";
import { openApp } from "./helpers.js";
import { readFileSync } from "node:fs";

const LONG = readFileSync(new URL("../fixtures_longitudinal.txt", import.meta.url), "utf8");

test("longitudinal: paste → generate one profile chart with a PNG download", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => (document.querySelector("#step5").open = true));
  await page.fill("#stationStart", "1000");
  await page.fill("#longitudinalPaste", LONG);
  await page.locator("#genLongitudinal").scrollIntoViewIfNeeded();
  await page.locator("#genLongitudinal").click({ force: true });

  // one big profile canvas + a PNG download button, and the ok banner
  await expect(page.locator(".long-card canvas")).toHaveCount(1);
  await expect(page.locator(".long-actions button")).toContainText(/PNG/i);
  await expect(page.locator("#messages")).toContainText(/Longitudinal profile/i);

  // the longitudinal canvas is non-blank
  const nonBlank = await page.locator(".long-card canvas").evaluate((c) => {
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    for (let i = 0; i < d.length; i += 4) if (d[i] !== d[0] || d[i + 1] !== d[1] || d[i + 2] !== d[2]) return true;
    return false;
  });
  expect(nonBlank).toBe(true);
});
