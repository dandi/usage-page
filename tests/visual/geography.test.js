import { test, expect } from "@playwright/test";
import { setupDataMocks, waitForPlotsToRender } from "../fixtures/page-mocks.js";

// ── Why this suite exists ────────────────────────────────────────────────────
//
// The Chromatic run archives a serialization of the DOM, which carries a
// <canvas> element's size and position but none of its pixels.  The geography
// section is drawn by MapLibre into a WebGL canvas, so Chromatic's snapshot of
// it covers the title, colorbar and credits around a map that is always blank —
// a map that failed to draw at all looks exactly like one that drew perfectly.
//
// Playwright's own screenshots are taken by the browser and do include canvas
// pixels, so this suite is what actually holds the map to account: it compares
// the rendered section against a committed PNG.
//
// The baselines are per platform (Playwright suffixes them with the browser and
// OS), and are the Linux ones CI runs on.  Regenerate with:
//
//     npm run test:visual -- --update-snapshots
//
// ── What is compared ─────────────────────────────────────────────────────────
//
// The section's text is masked out of the comparison.  Fonts rasterize
// differently between machines, and the point here is the map: whether the
// regions carrying data are drawn, in the right places, in the right colors.

const MASKED_TEXT = [".gtitle", ".annotation"];

// The fixture data carries three mappable regions — US/California, DE/Bavaria
// and GB/England (AWS/us-east-1 is not a place) — but how many of them the map
// opens on depends on its width: the view is centered on longitude 0 and zoomed
// to the map's width, so a phone-width map does not reach California.  Each
// viewport therefore states what it should be showing.

/**
 * The number of the choropleth's regions MapLibre has actually painted.
 *
 * The screenshot below cannot answer this on its own: at world zoom the three
 * fixture regions come to about a thousand pixels between them, orders of
 * magnitude below the difference tolerance that keeps the comparison stable
 * across machines.  A map that drew its basemap and none of its data would sail
 * through the image diff, so it is asked directly instead.
 */
async function countRenderedRegions(page) {
    return page.evaluate(() => {
        const map = document.getElementById("geography_heatmap")?._fullLayout?.map?._subplot?.map;
        if (!map) return -1;
        const fillLayers = map
            .getStyle()
            .layers.filter((layer) => layer.type === "fill" && layer.id.includes("plotly-trace-layer"))
            .map((layer) => layer.id);
        if (fillLayers.length === 0) return -1;
        // A region that straddles a tile boundary comes back once per tile it
        // is drawn into, so the features are counted by the id the trace keys
        // them on rather than one apiece.
        const features = map.queryRenderedFeatures({ layers: fillLayers });
        return new Set(features.map((feature) => feature.id ?? feature.properties?.id)).size;
    });
}

/**
 * Waits for MapLibre to finish drawing.  Plotly resolves newPlot() once the map
 * is created, which is well before it has painted its layers, so the canvas can
 * still be empty at that point.
 */
async function waitForMapToSettle(page) {
    await page.waitForFunction(
        () => {
            const el = document.getElementById("geography_heatmap");
            const map = el?._fullLayout?.map?._subplot?.map;
            return Boolean(map?.loaded?.());
        },
        undefined,
        { timeout: 30000 },
    );
    // MapLibre reports itself loaded a frame or two before the last paint.
    await page.waitForTimeout(500);
}

const VIEWPORTS = [
    { name: "desktop", width: 1280, height: 720, regions: 3 },
    { name: "mobile-portrait", width: 390, height: 844, regions: 2 },
];

test.describe("Geography choropleth", () => {
    for (const viewport of VIEWPORTS) {
        for (const theme of ["dark", "light"]) {
            test(`draws its regions — ${theme} theme, ${viewport.name}`, async ({ page }) => {
                await page.setViewportSize({ width: viewport.width, height: viewport.height });
                await setupDataMocks(page);
                await page.addInitScript((theme) => {
                    localStorage.setItem("theme", theme);
                    localStorage.setItem("analytics_consent", "declined");
                }, theme);
                await page.goto("/");
                await waitForPlotsToRender(page);
                await waitForMapToSettle(page);

                expect(await countRenderedRegions(page), "Choropleth regions painted onto the map").toBe(
                    viewport.regions,
                );

                await expect(page.locator("#geography_heatmap")).toHaveScreenshot(
                    `geography-${theme}-${viewport.name}.png`,
                    {
                        mask: MASKED_TEXT.map((selector) => page.locator(`#geography_heatmap ${selector}`)),
                        animations: "disabled",
                        // Enough room for the antialiasing of the region outlines
                        // to differ between machines, and nowhere near enough to
                        // let a map that did not draw pass as one that did.
                        maxDiffPixelRatio: 0.05,
                    },
                );
            });
        }
    }
});
