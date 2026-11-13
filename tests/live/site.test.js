import { test, expect } from "@playwright/test";

// The page as visitors get it: deployed, over live data and the live basemap.
// When CARTO moved its basemap behind an API key, the region map showed
// "Failed to load data for geographic choropleth." to every visitor while
// every suite passed: the mocked ones never see CARTO, and the integration
// tests only checked that the map's element was visible, which an element
// holding an error message is.  So this suite checks what was drawn, and fails
// on any error or warning the page logs, a basemap it fell back from included.

// What headless Chromium's software renderer logs about WebGL, not the page
const IGNORED_CONSOLE_MESSAGES = [/GL Driver Message/];

/**
 * Collects everything that went wrong while the page loaded: the errors and
 * warnings it logged, which include every request that failed, and the errors
 * it left uncaught.
 */
function watch_for_problems(page) {
    const problems = [];
    page.on("console", (message) => {
        if (message.type() !== "error" && message.type() !== "warning") return;
        const text = message.text();
        if (IGNORED_CONSOLE_MESSAGES.some((pattern) => pattern.test(text))) return;
        // A failed request is logged without its URL in the text, which is the useful part
        const { url } = message.location();
        problems.push(`console.${message.type()}: ${text}${url ? ` (${url})` : ""}`);
    });
    page.on("pageerror", (error) => problems.push(`uncaught: ${error.message}`));
    return problems;
}

/** Waits for every Plotly plot in these elements to be drawn. */
async function expect_plots_drawn(page, ids) {
    for (const id of ids) {
        await expect(page.locator(`#${id} .main-svg`).first(), `#${id} is drawn`).toBeAttached();
    }
}

/** No section is reporting that it failed to load. */
async function expect_no_failure_messages(page) {
    await expect(page.getByText(/Failed to load/)).toHaveCount(0);
}

for (const theme of ["light", "dark"]) {
    test.describe(`in the ${theme} theme`, () => {
        test.use({ colorScheme: theme });

        test("the archive page draws every plot and the region map, with nothing logged", async ({ page }) => {
            const problems = watch_for_problems(page);
            await page.goto("/", { waitUntil: "networkidle" });

            await expect(page.locator("#totals")).not.toBeEmpty();
            await expect_plots_drawn(page, ["over_time_plot", "histogram_plot", "geography_heatmap"]);
            // The region map is a MapLibre canvas over the basemap
            await expect(page.locator("#geography_heatmap canvas").first()).toBeVisible();
            await page.waitForLoadState("networkidle");

            await expect_no_failure_messages(page);
            expect(problems, problems.join("\n")).toEqual([]);
        });
    });
}

test("the points map draws, with nothing logged", async ({ page }) => {
    const problems = watch_for_problems(page);
    await page.goto("/?map=points", { waitUntil: "networkidle" });

    await expect_plots_drawn(page, ["geography_heatmap"]);
    // A marker for each place there is usage from
    await expect(page.locator("#geography_heatmap .scattergeo path.point").first()).toBeAttached();
    await page.waitForLoadState("networkidle");

    await expect_no_failure_messages(page);
    expect(problems, problems.join("\n")).toEqual([]);
});

test("a Dandiset's page draws every plot and the region map, with nothing logged", async ({ page }) => {
    const problems = watch_for_problems(page);
    await page.goto("/?dandiset=000026", { waitUntil: "networkidle" });

    await expect_plots_drawn(page, ["over_time_plot", "histogram_plot", "geography_heatmap"]);
    await expect(page.locator("#geography_heatmap canvas").first()).toBeVisible();
    await page.waitForLoadState("networkidle");

    await expect_no_failure_messages(page);
    expect(problems, problems.join("\n")).toEqual([]);
});
