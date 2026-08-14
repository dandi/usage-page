import { test, expect } from "@playwright/test";
import { setupDataMocks, waitForMapToSettle, waitForPlotsToRender } from "../fixtures/page-mocks.js";

// ── Why this suite exists ────────────────────────────────────────────────────
//
// The Chromatic run archives a serialization of the DOM, which carries a canvas
// element's size and position but none of its pixels.  The geography section is
// drawn by MapLibre into a WebGL canvas, so it reaches Chromatic only because
// that run stands a screenshot in for the canvas before archiving it (see
// inlineMapCanvas in the shared fixtures).
//
// That makes the map visible there, but it does not make it verified: what
// Chromatic diffs is whatever image the run baked in, and accepting a changed
// Chromatic baseline is a judgement someone makes by eye.  This suite is the
// one that fails the build.  It compares the section against a PNG committed
// beside it and, because a map's worth of regions is far too few pixels to
// register against any workable difference tolerance, asks the map outright
// how much of the data it drew.
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
 * Moves the map to the top-left corner of the viewport for the capture.
 *
 * Its size in CSS pixels is a whole number, but its position is not: it is
 * centered, which puts its left edge on a half pixel, and it sits below a
 * column of text whose height rounds differently depending on the fonts
 * available.  An element straddling the pixel grid is captured one pixel wider
 * and taller than it is, and Playwright rejects a size mismatch outright
 * without comparing anything — so a baseline taken on a machine whose text is a
 * fraction of a pixel different is one that can never match.
 *
 * Pinning it to whole coordinates, over a backdrop of its own, makes the
 * captured image depend on the section alone.  Nothing is redrawn: the size is
 * untouched, so Plotly has no resize to react to and the canvas keeps the
 * pixels it already holds.
 */
async function pinToViewportCorner(page) {
    await page.evaluate(() => {
        const el = document.getElementById("geography_heatmap");
        el.style.position = "fixed";
        el.style.top = "0";
        el.style.left = "0";
        el.style.margin = "0";
        // Plotly leaves the paper behind the title and credits transparent, so
        // without a backdrop of its own the section is captured with whatever
        // it now sits over — the site header, text and all — showing through.
        el.style.background = getComputedStyle(document.body).backgroundColor;
        el.style.zIndex = "9999";
    });
    await page.waitForTimeout(100);
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
                await pinToViewportCorner(page);

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
