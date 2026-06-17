import { test, expect } from "@playwright/test";
import { openApp, pasteFixtures, generate, chips, chipTexts } from "./helpers.js";
import { EXPECTED } from "./fixtures.js";

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await pasteFixtures(page);
});

// Scenario 1 — happy path
test("happy path: generates 2 charts with correct banner and chips", async ({ page }) => {
  await generate(page);

  await expect(page.locator("#messages .msg-ok")).toHaveText(EXPECTED.bannerRe);
  await expect(page.locator(".chart-card canvas")).toHaveCount(EXPECTED.sectionCount);
  await expect(chips(page)).toHaveCount(EXPECTED.sectionCount);
  expect(await chipTexts(page)).toEqual(EXPECTED.stationsAsc);

  // download is enabled once charts exist
  await expect(page.locator("#download")).toBeEnabled();
});

// Scenario 2 — station matching correctness (no "differs by" warning)
test("station matching: no Z-min mismatch warning", async ({ page }) => {
  await generate(page);
  await expect(page.locator("#messages")).not.toContainText(/differs from Summary Z-min/);
  await expect(page.locator("#messages .msg-warn")).toHaveCount(0);
});

// Scenario 3 — order toggle reverses chips and first caption
test("order toggle: descending reverses chips and first caption", async ({ page }) => {
  await generate(page);
  expect(await chipTexts(page)).toEqual(["10+47", "12+72"]);

  await page.click("#orderToggle");

  await expect.poll(async () => (await chipTexts(page))).toEqual(["12+72", "10+47"]);
  await expect(page.locator(".chart-card .caption-preview").first()).toContainText(
    "Cross Section at Station 12+72"
  );
});

// Scenario 4 — chip navigation scrolls the target card into view and marks it active
test("chip navigation: clicking a chip activates it and scrolls into view", async ({ page }) => {
  await generate(page);
  const targetChip = chips(page).filter({ hasText: "12+72" });
  await targetChip.click();

  await expect(targetChip).toHaveClass(/active/);

  // the matching card should scroll substantially into the strip viewport.
  // scrollIntoView is animated (smooth), so poll until it settles.
  await expect
    .poll(
      async () =>
        await page.evaluate(() => {
          const cards = [...document.querySelectorAll(".chart-card")];
          const strip = document.querySelector(".chart-strip");
          const target = cards.find((c) =>
            c.querySelector(".caption-preview")?.textContent.includes("12+72")
          );
          if (!target || !strip) return 0;
          const cr = target.getBoundingClientRect();
          const sr = strip.getBoundingClientRect();
          const overlap = Math.min(cr.right, sr.right) - Math.max(cr.left, sr.left);
          return overlap / cr.width;
        }),
      { timeout: 5000 }
    )
    .toBeGreaterThan(0.5);
});
