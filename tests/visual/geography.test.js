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

// The fixture data carries three mappable regions — USA/CA, DEU/BY and
// GB/England (the AWS and GCP rows are not places) — but how many of them the map
// opens on depends on its width: the view is centered on the United States and
// zoomed to the map's width, so a phone-width map does not reach Europe.  Each
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
    { name: "mobile-portrait", width: 390, height: 844, regions: 1 },
];

test.describe("Geography choropleth", () => {
    for (const viewport of VIEWPORTS) {
        for (const theme of ["dark", "light"]) {
            test(`draws its regions — ${theme} theme, ${viewport.name}`, async ({ page }) => {
                await page.setViewportSize({ width: viewport.width, height: viewport.height });
                await setupDataMocks(page);
                await page.addInitScript((theme) => {
                    localStorage.setItem("theme", theme);
                }, theme);
                // Pinned to the subdivision map, which is what these baselines
                // were drawn from; the map opens on countries by default.
                await page.goto("/?resolution=subdivisions");
                await waitForPlotsToRender(page);
                await waitForMapToSettle(page);
                await pinToViewportCorner(page);

                expect(await countRenderedRegions(page), "Choropleth regions painted onto the map").toBe(
                    viewport.regions
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
                    }
                );
            });
        }
    }

    // The default view, which has no committed baseline of its own: a country
    // is painted across every boundary it is made of, so it covers strictly
    // more of the map than the three subdivisions the fixture locates.
    test("paints whole countries in the default view", async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 720 });
        await setupDataMocks(page);
        await page.goto("/");
        await waitForPlotsToRender(page);
        await waitForMapToSettle(page);

        expect(
            await countRenderedRegions(page),
            "Boundaries painted for the countries of the three fixture regions"
        ).toBeGreaterThan(3);
    });

    // The hover label is drawn by the page rather than by Plotly, so that it
    // can be placed beside the pointer and kept inside the map — and driven
    // from MapLibre rather than from Plotly's hover events, which a redraw
    // quietly stops delivering.  Switching resolution redraws the plot, so the
    // label is checked on both sides of a switch.
    test("draws its hover label beside the pointer, before and after a change of resolution", async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 720 });
        await setupDataMocks(page);
        await page.goto("/");
        await waitForPlotsToRender(page);
        await waitForMapToSettle(page);
        // The pointer is moved in viewport coordinates, so the map has to be in
        // the viewport.
        await page.locator("#geography_heatmap").scrollIntoViewIfNeeded();
        await waitForMapToSettle(page);
        /**
         * Hovers a painted region and returns where the pointer was and where
         * the label went.
         *
         * Which pixel to point at is asked of the map rather than worked out
         * from longitude and latitude, and asked again after the switch: the
         * fixture paints whole countries at one resolution and three
         * subdivisions at the other, so a pixel painted in one is not
         * necessarily painted in the other.  Well inside a region rather than
         * on its edge, since an antialiased edge pixel counts as painted here
         * but not to the hover, which does its own hit testing.
         */
        const hover_a_painted_region = async () => {
            // Scrolled to and measured afresh each time: switching resolution
            // reflows the page and moves the map down it, out of the viewport
            // the pointer is aimed in.
            await page.locator("#geography_heatmap").scrollIntoViewIfNeeded();
            await waitForMapToSettle(page);
            const map = await page.locator("#geography_heatmap .maplibregl-canvas").boundingBox();
            const painted = await page.evaluate(() => {
                const rendered = document.getElementById("geography_heatmap")._fullLayout.map._subplot.map;
                const layers = rendered
                    .getStyle()
                    .layers.filter((layer) => layer.type === "fill" && layer.id.includes("plotly-trace-layer"))
                    .map((layer) => layer.id);
                const { width, height } = rendered.getCanvas().getBoundingClientRect();
                const painted_at = (x, y) => rendered.queryRenderedFeatures([x, y], { layers }).length > 0;
                for (let x = 8; x < width - 8; x += 4) {
                    for (let y = 8; y < height - 8; y += 4) {
                        if (
                            painted_at(x, y) &&
                            painted_at(x - 4, y) &&
                            painted_at(x + 4, y) &&
                            painted_at(x, y - 4) &&
                            painted_at(x, y + 4)
                        ) {
                            return { x, y };
                        }
                    }
                }
                return null;
            });
            expect(painted, "A painted region to point at").not.toBeNull();

            const pointer = { x: map.x + painted.x, y: map.y + painted.y };
            // Away first, so that a label left over from the last hover cannot
            // pass for one placed by this one.
            await page.mouse.move(map.x + 2, map.y + 2);
            await page.waitForTimeout(100);
            await page.mouse.move(pointer.x, pointer.y);
            const label = page.locator("#geography_heatmap .map-hover-label");
            await expect(label).toBeVisible();
            return { map, pointer, box: await label.boundingBox() };
        };

        /** How many regions the choropleth is currently drawn from. */
        const regions_drawn = () =>
            page.evaluate(() => document.getElementById("geography_heatmap").data?.[0]?.locations?.length ?? 0);

        const before = await hover_a_painted_region();
        const countries_drawn = await regions_drawn();
        await page.locator('label[for="geo_resolution_subdivisions"]').click();
        // Waited for by what is drawn rather than by the map settling: the map
        // settles as soon as it stops moving, which it does before the redraw
        // that the switch sets off has replaced the regions on it.
        await expect
            .poll(regions_drawn, { message: "Regions redrawn at the new resolution" })
            .not.toBe(countries_drawn);
        await waitForMapToSettle(page);
        const after = await hover_a_painted_region();

        for (const [when, { map, pointer, box }] of [
            ["before", before],
            ["after", after],
        ]) {
            const gap = Math.max(box.x - pointer.x, pointer.x - (box.x + box.width), 0);
            expect(gap, `Distance from the pointer to the hover label, ${when} the switch`).toBeLessThan(40);
            expect(box.x, `Hover label inside the map, ${when} the switch`).toBeGreaterThanOrEqual(map.x - 1);
            expect(box.x + box.width).toBeLessThanOrEqual(map.x + map.width + 1);
        }
    });
});
