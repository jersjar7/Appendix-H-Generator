import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { openApp, pasteFixtures } from "./helpers.js";

// The diagnostic report is offered per SAVED run, in the history panel.
test("report: a saved run downloads a .txt diagnostic with matching + inputs", async ({ page }) => {
  await openApp(page);
  await pasteFixtures(page);

  await page.click("#saveInputs");
  await expect(page.locator("#messages .msg-ok")).toContainText("Inputs saved");

  await page.locator("#historyPanel").evaluate((el) => (el.open = true));
  const entry = page.locator("#historyList li").filter({ has: page.locator(".report") }).first();
  await expect(entry).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    entry.locator(".report").click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/_diagnostic_.*\.txt$/);

  const text = readFileSync(await download.path(), "utf8");
  expect(text).toContain("RUN DIAGNOSTIC REPORT");
  expect(text).toContain("STEP 2 — SUMMARY TABLE");
  expect(text).toContain("STATION MATCHING");
  expect(text).toContain("Assignment");
  expect(text).toContain("10+47");
  expect(text).toContain("12+72");
});
