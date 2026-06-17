import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { openApp, pasteFixtures, generate } from "./helpers.js";

// Unzips a .docx (a ZIP) with the system `unzip` — no extra npm dependency.
function zipList(file) {
  return execFileSync("unzip", ["-l", file], { encoding: "utf8" });
}
function zipRead(file, entry) {
  return execFileSync("unzip", ["-p", file, entry], { encoding: "utf8" });
}

test("Word download: docx contains chart image and caption strings", async ({ page }) => {
  await openApp(page);
  await pasteFixtures(page);
  await generate(page);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.click("#download"),
  ]);
  const file = await download.path();
  expect(download.suggestedFilename()).toMatch(/Existing_Conditions_Cross_Sections\.docx$/);

  const listing = zipList(file);
  expect(listing).toContain("word/document.xml");
  expect(listing).toContain("word/media/image1.png");
  expect(listing).toContain("word/media/image2.png");
  expect(listing).toContain("[Content_Types].xml");

  const docXml = zipRead(file, "word/document.xml");
  expect(docXml).toContain("Cross Section at Station 10+47");
  expect(docXml).toContain("Cross Section at Station 12+72");
  expect(docXml).toContain("Existing Conditions");
});
