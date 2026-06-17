import { test, expect } from "@playwright/test";
import { openApp, pasteFixtures, generate } from "./helpers.js";
import { SUMMARY_TSV, PROFILE_TSV } from "./fixtures.js";

// Scenario 7 — Save inputs, reload, load them back, no auto-generate
test("history: save inputs survive reload and load back without generating", async ({ page }) => {
  await openApp(page);
  await pasteFixtures(page);

  await page.click("#saveInputs");
  await expect(page.locator("#messages .msg-ok")).toContainText("Inputs saved");

  // reload WITHOUT clearing localStorage (history is persisted there)
  await page.reload();

  await page.locator("#historyPanel").evaluate((el) => (el.open = true));
  const entries = page.locator("#historyList li").filter({ has: page.locator(".load") });
  await expect(entries).toHaveCount(1);

  await entries.first().locator(".load").click();

  // step 2 & 3 textareas refill...
  await expect(page.locator("#summary")).toHaveValue(SUMMARY_TSV);
  await expect(page.locator("#profile")).toHaveValue(PROFILE_TSV);
  // ...and NO charts were auto-generated
  await expect(page.locator(".chart-card")).toHaveCount(0);
  await expect(page.locator("#messages .msg-ok")).toContainText("Review them, then click");
});

// Scenario 8 — Restart clears inputs and results after confirm
test("restart: clears inputs and results after confirming", async ({ page }) => {
  await openApp(page);
  await pasteFixtures(page);
  await generate(page);
  await expect(page.locator(".chart-card").first()).toBeVisible();

  page.once("dialog", (d) => d.accept());
  await page.click("#restart");

  await expect(page.locator("#summary")).toHaveValue("");
  await expect(page.locator("#profile")).toHaveValue("");
  await expect(page.locator(".chart-card")).toHaveCount(0);
  await expect(page.locator("#download")).toBeDisabled();
});
