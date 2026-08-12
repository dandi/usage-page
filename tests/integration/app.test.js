import { test as base, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const COVERAGE_ENABLED = process.env.PW_COVERAGE === "1";
const COVERAGE_RAW_OUTPUT_DIR = resolve(process.cwd(), "coverage", "integration", "raw");

const test = COVERAGE_ENABLED
    ? base.extend({
          page: async ({ page }, use, testInfo) => {
              if (typeof page.coverage?.startJSCoverage !== "function") {
                  await use(page);
                  return;
              }

              await page.coverage.startJSCoverage({ resetOnNavigation: false });
              try {
                  await use(page);
              } finally {
                  const coverage = await page.coverage.stopJSCoverage();
                  if (coverage.length === 0) return;

                  await mkdir(COVERAGE_RAW_OUTPUT_DIR, { recursive: true });
                  const fileHash = createHash("sha1").update(testInfo.testId).digest("hex");
                  const outputFile = resolve(COVERAGE_RAW_OUTPUT_DIR, `${fileHash}.json`);
                  await writeFile(outputFile, JSON.stringify(coverage));
              }
          },
      })
    : base;

test.describe("DANDI Access Page", () => {
    test.beforeEach(async ({ page }) => {
        page.on("console", (msg) => {
            if (msg.type() === "warning") {
                const text = msg.text();
                // Suppress GPU/GL driver performance warnings emitted by the
                // software rasteriser (Swiftshader) in headless CI environments.
                if (text.includes("GL Driver Message")) return;
                console.warn(`[browser:warning] ${text}`);
            }
        });
        await page.addInitScript(() => localStorage.clear());
        await page.goto("/");
    });

    test("page loads and displays the header with DANDI logo", async ({ page }) => {
        await expect(page.locator("header")).toBeVisible();
        await expect(page.locator("header img[alt]")).toBeVisible();
    });

    test("dandiset selector is present", async ({ page }) => {
        await expect(page.locator("#dandiset_selector")).toBeVisible();
    });

    test("settings panel button is visible", async ({ page }) => {
        await expect(page.locator("#settings_btn")).toBeVisible();
    });

    test("settings panel opens and closes", async ({ page }) => {
        const settingsBtn = page.locator("#settings_btn");
        const settingsPanel = page.locator("#settings_panel");

        await settingsBtn.click();
        await expect(settingsPanel).toHaveClass(/open/);

        await page.keyboard.press("Escape");
        await expect(settingsPanel).not.toHaveClass(/open/);
    });

    test("theme toggle button is visible", async ({ page }) => {
        await expect(page.locator("#theme_toggle_btn")).toBeVisible();
    });

    test("theme toggle switches between dark and light mode", async ({ page }) => {
        const html = page.locator("html");

        // Read the actual initial theme (depends on system prefers-color-scheme)
        const initialTheme = await html.getAttribute("data-theme");
        const otherTheme = initialTheme === "dark" ? "light" : "dark";

        await page.locator("#theme_toggle_btn").click();
        await expect(html).toHaveAttribute("data-theme", otherTheme);

        await page.locator("#theme_toggle_btn").click();
        await expect(html).toHaveAttribute("data-theme", initialTheme);
    });

    test("over-time plot section is present", async ({ page }) => {
        await expect(page.locator("#over_time_plot")).toBeVisible();
    });

    test("histogram plot section is present", async ({ page }) => {
        await expect(page.locator("#histogram_plot")).toBeVisible();
    });

    test("geography section is present", async ({ page }) => {
        await expect(page.locator("#geography_heatmap, #geo_table_section").first()).toBeVisible();
    });

    // Regression: loading straight into the histogram table view (a refresh on
    // a deep link) used to reserve the height of the plot and the table
    // stacked, leaving a band of whitespace between the table and the
    // geography section below it.
    test("histogram table view leaves no gap below the table on a fresh load", async ({ page }) => {
        await page.goto("/?histogram=table");

        const table = page.locator("#histogram_table");
        await expect(table.locator("tbody tr").first()).toBeVisible();
        await expect(page.locator("#histogram_plot")).toBeHidden();

        const gap = await page.evaluate(() => {
            const table_el = document.getElementById("histogram_table");
            const section_el = table_el.closest(".view-section");
            return section_el.offsetHeight - table_el.offsetHeight;
        });
        expect(gap).toBeLessThanOrEqual(1);
    });
});
