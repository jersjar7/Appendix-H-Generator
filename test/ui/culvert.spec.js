import { test, expect } from "@playwright/test";
import { openApp, pasteFixtures, generate } from "./helpers.js";

test("culvert box: adding a box changes the canvas but not the caption", async ({ page }) => {
  await openApp(page);
  await pasteFixtures(page);
  await generate(page);

  const card = page.locator(".chart-card").first();
  const canvas = card.locator("canvas");
  const captionBefore = await card.locator(".caption-preview").textContent();
  const pngBefore = await canvas.evaluate((c) => c.toDataURL());

  // Culvert → Box, then enter scour / height / width.
  await card.locator(".stype").selectOption("box");
  await expect(card.locator(".culvert-fields")).toBeVisible();
  await card.locator(".cscour").fill("4");
  await card.locator(".cheight").fill("15.2");
  await card.locator(".cwidth").fill("12");

  // the box draws once all three required fields are present
  await expect
    .poll(async () => await canvas.evaluate((c) => c.toDataURL()))
    .not.toBe(pngBefore);

  // caption is unchanged by adding a structure
  const captionAfter = await card.locator(".caption-preview").textContent();
  expect(captionAfter).toBe(captionBefore);
});

test("culvert arch: selecting Arch shows span/leg/rise fields and draws", async ({ page }) => {
  await openApp(page);
  await pasteFixtures(page);
  await generate(page);

  const card = page.locator(".chart-card").first();
  const canvas = card.locator("canvas");
  const pngBefore = await canvas.evaluate((c) => c.toDataURL());

  await card.locator(".stype").selectOption("arch");
  // arch-specific fields show; box-specific fields hide
  await expect(card.locator(".kf-arch")).toBeVisible();
  await expect(card.locator(".kf-box")).toBeHidden();
  await card.locator(".cscour").fill("4");
  await card.locator(".cspan").fill("24");
  await card.locator(".cleg").fill("5");
  await card.locator(".crise").fill("9");

  await expect
    .poll(async () => await canvas.evaluate((c) => c.toDataURL()))
    .not.toBe(pngBefore);
});
