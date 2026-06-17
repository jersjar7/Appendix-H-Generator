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

  // Culvert → Add box, then enter scour / height / width.
  await card.locator(".stype").selectOption("Culvert");
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
