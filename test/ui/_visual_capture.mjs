// Throwaway visual-capture helper: drives the real app, renders the fixture
// charts (plus one with a culvert box), and writes PNGs to /tmp for inspection.
// Not part of the automated suite. Run: node test/ui/_visual_capture.mjs
import { chromium } from "@playwright/test";
import { SUMMARY_TSV, PROFILE_TSV } from "./fixtures.js";

const BASE = process.env.BASE_URL || "http://127.0.0.1:8000";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
await page.goto(`${BASE}/index.html`);
await page.evaluate(() => localStorage.clear());
await page.fill("#summary", SUMMARY_TSV);
await page.fill("#profile", PROFILE_TSV);
await page.click("#generate");
await page.locator(".chart-card canvas").first().waitFor();

// chart 1 (no box)
await page.locator(".chart-card canvas").nth(0).screenshot({ path: "/tmp/visual_chart_1.png" });

// add a culvert box on the first card, then capture it
const card = page.locator(".chart-card").first();
await card.locator(".stype").selectOption("Culvert");
await card.locator(".cscour").fill("4");
await card.locator(".cheight").fill("15.2");
await card.locator(".cwidth").fill("12");
await page.waitForTimeout(300);
await card.locator("canvas").screenshot({ path: "/tmp/visual_chart_1_culvert.png" });

// chart 2
await page.locator(".chart-card canvas").nth(1).screenshot({ path: "/tmp/visual_chart_2.png" });

// full results strip for layout review
await page.locator("#results").screenshot({ path: "/tmp/visual_results.png" });

console.log("wrote /tmp/visual_chart_1.png, /tmp/visual_chart_1_culvert.png, /tmp/visual_chart_2.png, /tmp/visual_results.png");
await browser.close();
