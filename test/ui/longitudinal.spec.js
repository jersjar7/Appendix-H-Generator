import { test, expect } from "@playwright/test";
import { openApp } from "./helpers.js";
import { readFileSync } from "node:fs";

const LONG = readFileSync(new URL("../fixtures_longitudinal.txt", import.meta.url), "utf8");
const SUMMARY_RELATIVE = `
    Z
Reach   Station Min
Reach 1 70      65
Reach 1 173     60
Reach 1 219     58
Reach 1 253     56
Reach 1 289     54
Reach 1 343     52
Reach 1 443     50
Reach 1 900     48
`;

test("longitudinal: paste → generate one profile chart with a PNG download", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => (document.querySelector("#step4").open = true));
  await page.fill("#stationStart", "1000");
  await page.fill("#longitudinalPaste", LONG);
  await page.locator("#genLongitudinal").scrollIntoViewIfNeeded();
  await page.locator("#genLongitudinal").click({ force: true });

  // one big profile canvas; the rail PNG download enables; ok banner
  await expect(page.locator(".long-card canvas")).toHaveCount(1);
  await expect(page.locator("#dlLong")).toBeEnabled();
  await expect(page.locator("#messages")).toContainText(/Longitudinal profile/i);

  const snap = () => page.locator(".long-card canvas").evaluate((c) => c.toDataURL());
  const blankCheck = () => page.locator(".long-card canvas").evaluate((c) => {
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    for (let i = 0; i < d.length; i += 4) if (d[i] !== d[0] || d[i + 1] !== d[1] || d[i + 2] !== d[2]) return true;
    return false;
  });
  expect(await blankCheck()).toBe(true);

  // legend controls re-place the legend (canvas changes)
  const before = await snap();
  await page.locator(".long-actions .leg-pos").selectOption("top-left");
  await expect.poll(snap).not.toBe(before);
  const afterPos = await snap();
  await page.locator('.leg-nudge button[data-d="D"]').click();
  await expect.poll(snap).not.toBe(afterPos);

  // Station direction flips the x-axis and redraws the profile.
  const beforeReverse = await snap();
  await page.locator("#longStationDirection").selectOption("reverse");
  await expect.poll(snap).not.toBe(beforeReverse);
});

test("longitudinal: start station offsets relative marker labels without hiding them", async ({ page }) => {
  await page.addInitScript(() => {
    window.__drawnText = [];
    const originalFillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      window.__drawnText.push(String(text));
      return originalFillText.call(this, text, ...args);
    };
  });
  await openApp(page);
  await page.evaluate(() => {
    document.querySelector("#step2").open = true;
    document.querySelector("#step4").open = true;
  });
  await page.fill("#stationStart", "1000");
  await page.fill("#longitudinalPaste", LONG);
  await page.locator("#genLongitudinal").click({ force: true });
  await expect(page.locator(".long-card canvas")).toHaveCount(1);
  const withoutMarkers = await page.locator(".long-card canvas").evaluate((c) => c.toDataURL());

  await page.fill("#summary", SUMMARY_RELATIVE);
  await page.evaluate(() => (window.__drawnText = []));
  await page.locator("#genLongitudinal").click({ force: true });
  await expect.poll(() => page.locator(".long-card canvas").evaluate((c) => c.toDataURL())).not.toBe(withoutMarkers);
  await expect.poll(() => page.evaluate(() => window.__drawnText.includes("10+70"))).toBe(true);
});

test("longitudinal: reversed edge station tick labels stay visible inside the canvas", async ({ page }) => {
  await page.addInitScript(() => {
    window.__drawnStations = [];
    const originalFillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, ...args) {
      const label = String(text);
      if (/^\d+\+\d{2}$/.test(label)) {
        const width = this.measureText(label).width;
        window.__drawnStations.push({ label, left: x - width / 2, right: x + width / 2, canvasW: this.canvas.width });
      }
      return originalFillText.call(this, text, x, y, ...args);
    };
  });
  await openApp(page);
  await page.evaluate(() => (document.querySelector("#step4").open = true));
  await page.fill("#stationStart", "1000");
  await page.fill("#longitudinalPaste", LONG);
  await page.locator("#longStationDirection").selectOption("reverse");
  await page.evaluate(() => (window.__drawnStations = []));
  await page.locator("#genLongitudinal").click({ force: true });
  await expect(page.locator(".long-card canvas")).toHaveCount(1);

  const edgeLabels = await page.evaluate(() => window.__drawnStations.filter((d) => d.label === "10+00"));
  expect(edgeLabels.length).toBe(1);
  expect(edgeLabels.every((d) => d.left >= 0 && d.right <= d.canvasW)).toBe(true);
});
