// Shared helpers for the Playwright UI tests.
import { expect } from "@playwright/test";
import { SUMMARY_TSV, PROFILE_TSV } from "./fixtures.js";

// Load the app fresh, clearing localStorage so history tests are isolated.
export async function openApp(page) {
  await page.goto("/index.html");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator("#generate")).toBeVisible();
}

// Fill steps 2 & 3 with the standard fixtures. The default "Existing" preset
// already provides the 2-year/100-year/500-year events, so step 1 is left as-is.
export async function pasteFixtures(page, { summary = SUMMARY_TSV, profile = PROFILE_TSV } = {}) {
  await page.fill("#summary", summary);
  await page.fill("#profile", profile);
}

export async function generate(page) {
  await page.click("#generate");
  // wait until at least one chart card has been rendered
  await expect(page.locator(".chart-card").first()).toBeVisible();
}

export function chips(page) {
  return page.locator(".station-nav .chip");
}

export async function chipTexts(page) {
  return (await chips(page).allTextContents()).map((s) => s.trim());
}
