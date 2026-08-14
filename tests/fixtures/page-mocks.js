import { expect } from "@playwright/test";
import { gzipSync } from "node:zlib";

// This module is shared by every Playwright suite that needs the page
// rendered against fixed content: the Chromatic archive run and the
// screenshot-comparison run both import it.

// ── Static fixture data ──────────────────────────────────────────────────────
// All external data fetches are intercepted with these fixed values so that
// Chromatic snapshots are always taken against stable, deterministic content
// and are never affected by live data changing between runs.

const BASE_URL = "https://raw.githubusercontent.com/dandi/access-summaries/main";
const BASE_TSV_URL = `${BASE_URL}/content/summaries`;

const ARCHIVE_TOTALS = JSON.stringify({
    total_bytes_sent: 15000000000000,
    total_number_of_downloads: 1450000,
    total_number_of_requests: 8200000,
    total_number_of_views: 96000,
    number_of_requesters: 12000,
    number_of_unique_regions: 150,
    number_of_unique_countries: 60,
});

const ALL_DANDISET_TOTALS = JSON.stringify({
    "000001": { total_bytes_sent: 5000000000, total_number_of_downloads: 900, total_number_of_requests: 6400, total_number_of_views: 540, number_of_requesters: 320, number_of_unique_regions: 10, number_of_unique_countries: 5 },
    "000002": { total_bytes_sent: 3000000000, total_number_of_downloads: 450, total_number_of_requests: 4100, total_number_of_views: 310, number_of_requesters: 210, number_of_unique_regions: 8, number_of_unique_countries: 4 },
    "000003": { total_bytes_sent: 1000000000, total_number_of_downloads: 120, total_number_of_requests: 1200, total_number_of_views: 95, number_of_requesters: "<50", number_of_unique_regions: 5, number_of_unique_countries: 3 },
    "000004": { total_bytes_sent: 800000000, total_number_of_downloads: 90, total_number_of_requests: 900, total_number_of_views: 70, number_of_requesters: 60, number_of_unique_regions: 6, number_of_unique_countries: 3 },
    undetermined: { total_bytes_sent: 250000000, total_number_of_downloads: 60, total_number_of_requests: 300, total_number_of_views: 40, number_of_requesters: 75, number_of_unique_regions: 4, number_of_unique_countries: 2 },
});

// Titles for the mock Dandisets.  "000003" is deliberately left out so the
// snapshot also covers a row whose name is unknown (and so is not hyperlinked).
// "000004" carries a title of the length real Dandisets reach.  A <select> is
// as wide as its widest option, so a fixture of short titles hides the one
// thing about this control that is hard to get right on a narrow viewport.
const DANDISET_TITLES_JSONL = `\
{"000001": "Mock electrophysiology recordings"}
{"000002": "Mock calcium imaging dataset"}
{"000004": "A detailed data-driven network model of prefrontal cortex reproduces key features of in vivo activity"}
`;

// Asset counts and stored sizes behind the scaled metrics of the per-Dandiset
// table.  "000003" is deliberately left out of both so the snapshot also covers
// rows whose scaled metrics are unavailable and render as "--".
const NUMBER_OF_ASSETS_JSONL = `\
{"000001": 40}
{"000002": 12}
`;

const TOTAL_SIZE_JSONL = `\
{"000001": 250000000}
{"000002": 1500000000}
`;

const REGION_COORDS_YAML = `\
US/California:
  latitude: 36.7783
  longitude: -119.4179
DE/Bavaria:
  latitude: 48.7904
  longitude: 11.4979
GB/England:
  latitude: 52.3555
  longitude: -1.1743
`;

const BY_DAY_TSV = `\
date\tbytes_sent\tnumber_of_requests\tnumber_of_downloads\tnumber_of_views
2024-01-01\t100000000\t400\t120\t35
2024-01-02\t200000000\t600\t180\t52
2024-01-03\t150000000\t500\t140\t41
2024-01-04\t300000000\t1000\t320\t88
2024-01-05\t250000000\t700\t220\t63
2024-01-06\t180000000\t550\t160\t47
2024-01-07\t220000000\t630\t190\t55
`;

const BY_REGION_TSV = `\
region\tbytes_sent\tnumber_of_requests\tnumber_of_downloads\tnumber_of_views
US/California\t5000000000\t3200\t900\t260
DE/Bavaria\t2000000000\t1400\t380\t110
GB/England\t1500000000\t1050\t290\t85
AWS/us-east-1\t8000000000\t5100\t1500\t420
`;

const BY_ASSET_TSV = `\
asset\tbytes_sent\tnumber_of_requests\tnumber_of_downloads\tnumber_of_views
sub-001/func/sub-001_task-rest_bold.nwb\t1000000\t420\t130\t38
sub-002/func/sub-002_task-rest_bold.nwb\t500000\t210\t65\t19
`;

const BY_ASSET_TYPE_PER_WEEK_TSV = `\
date\tNeurophysiology\tMicroscopy\tVideo\tMiscellaneous
2024-01-01\t50000000\t30000000\t20000000\t10000000
2024-01-08\t60000000\t35000000\t25000000\t15000000
`;

// The basemap the choropleth is drawn over is a MapLibre style fetched from
// CARTO (positron for the light theme, dark matter for the dark one).  These
// stand in for it: a single flat background layer and no tile sources, in the
// rough tone of the basemap each replaces.  MapLibre needs *some* style to
// initialize — given none it errors out and the map never draws at all, region
// fills included — so this is what keeps the map in the snapshot while keeping
// the snapshot off the network and off whatever the live basemap looks like on
// the day.
const BASEMAP_BACKGROUNDS = { "dark-matter": "#101a33", positron: "#e9edf3" };

function basemap_style_for(url) {
    const name = url.includes("dark-matter") ? "dark-matter" : "positron";
    return JSON.stringify({
        version: 8,
        sources: {},
        layers: [{ id: "background", type: "background", paint: { "background-color": BASEMAP_BACKGROUNDS[name] } }],
    });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Registers Playwright route handlers that intercept every external data
 * request (raw.githubusercontent.com, and the CARTO basemap behind the
 * choropleth) and respond with the static fixture values above.  Must be
 * called before page.goto().
 */
export async function setupDataMocks(page) {
    await page.route(/basemaps\.cartocdn\.com/, (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: basemap_style_for(route.request().url()) }),
    );
    await page.route("**/dandiset_id_to_title.jsonl", (route) =>
        route.fulfill({ status: 200, contentType: "text/plain", body: DANDISET_TITLES_JSONL }),
    );
    // Served gzipped, exactly as the real derivatives are, so the page's
    // client-side decompression is exercised by the snapshot run too.
    await page.route("**/dandiset_id_to_number_of_assets.jsonl.gz", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/octet-stream",
            body: gzipSync(Buffer.from(NUMBER_OF_ASSETS_JSONL)),
        }),
    );
    await page.route("**/dandiset_id_to_total_size.jsonl.gz", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/octet-stream",
            body: gzipSync(Buffer.from(TOTAL_SIZE_JSONL)),
        }),
    );
    await page.route(`${BASE_URL}/content/archive_totals.json`, (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: ARCHIVE_TOTALS }),
    );
    await page.route(`${BASE_URL}/content/totals.json`, (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: ALL_DANDISET_TOTALS }),
    );
    await page.route(`${BASE_URL}/content/region_codes_to_coordinates.yaml`, (route) =>
        route.fulfill({ status: 200, contentType: "text/plain", body: REGION_COORDS_YAML }),
    );
    await page.route(`${BASE_TSV_URL}/*/by_day.tsv`, (route) =>
        route.fulfill({ status: 200, contentType: "text/tab-separated-values", body: BY_DAY_TSV }),
    );
    await page.route(`${BASE_TSV_URL}/*/by_region.tsv`, (route) =>
        route.fulfill({ status: 200, contentType: "text/tab-separated-values", body: BY_REGION_TSV }),
    );
    await page.route(`${BASE_TSV_URL}/*/by_asset.tsv`, (route) =>
        route.fulfill({ status: 200, contentType: "text/tab-separated-values", body: BY_ASSET_TSV }),
    );
    await page.route(`${BASE_TSV_URL}/*/by_asset_type_per_week.tsv`, (route) =>
        route.fulfill({
            status: 200,
            contentType: "text/tab-separated-values",
            body: BY_ASSET_TYPE_PER_WEEK_TSV,
        }),
    );
}

/**
 * Replaces the footer version string with a fixed mock value so that
 * Chromatic snapshots are not invalidated by version bumps or new commits.
 */
export async function mockVersion(page) {
    await page.evaluate(() => {
        const versionEl = document.getElementById("site_version");
        if (versionEl) versionEl.textContent = "v0.0.0+test0000";
    });
}

export const PLOT_IDS = ["over_time_plot", "histogram_plot", "geography_heatmap"];

// Text the plot loaders write into their container when they give up, e.g.
// "Failed to load data for geographic choropleth."
export const PLOT_FAILURE_TEXT = "Failed to load";

/**
 * Waits until all three main Plotly plot sections have settled — either every
 * one has drawn, or at least one has given up and written its failure message.
 *
 * A plot counts as drawn only once it holds a drawing surface, not merely the
 * "js-plotly-plot" class Plotly adds partway through newPlot(): a plot that
 * throws after that point keeps the class while its contents are replaced by
 * the failure text.  Waiting on the failure text as well means a broken plot
 * fails the assertion below rather than timing out here.
 */
export async function waitForPlotsToRender(page) {
    await page.waitForFunction(
        ([ids, failureText]) => {
            const failed = ids.some((id) => (document.getElementById(id)?.innerText ?? "").includes(failureText));
            const drawn = ids.every((id) => {
                const el = document.getElementById(id);
                return el?.classList.contains("js-plotly-plot") && el.querySelector("svg, canvas") !== null;
            });
            return failed || drawn;
        },
        [PLOT_IDS, PLOT_FAILURE_TEXT],
        { timeout: 30000 },
    );
}

/**
 * Waits for MapLibre to finish drawing.  Plotly resolves newPlot() once the map
 * is created, which is well before it has painted its layers, so the canvas can
 * still be empty at that point.
 */
export async function waitForMapToSettle(page) {
    await page.waitForFunction(
        () => Boolean(document.getElementById("geography_heatmap")?._fullLayout?.map?._subplot?.map?.loaded?.()),
        undefined,
        { timeout: 30000 },
    );
    // MapLibre reports itself loaded a frame or two before the last paint.
    await page.waitForTimeout(500);
}

/**
 * Rewrites same-document paint references so that they survive being archived.
 *
 * Plotly fills the colorbar with a gradient it defines in the document and
 * points at from an inline style, as `fill: url(#some-id)`.  Chrome resolves
 * that reference against the page's own address when it serializes the style,
 * so what an archive records is `url("http://localhost:5173/#some-id")` — an
 * absolute URL into a document that no longer exists once the archive is
 * replayed from somewhere else.  The reference then points at nothing and the
 * colorbar comes out an empty outline.
 *
 * The same reference written as an SVG presentation attribute is stored as it
 * was written, so moving it there keeps it relative to whatever document the
 * archive ends up in.  The two are equivalent to the browser, an inline style
 * simply outranking the attribute, so nothing changes about how the live page
 * paints.
 *
 * Returns how many it rewrote, so a caller can tell it did something.
 */
export async function relinkFragmentPaints(page) {
    return page.evaluate(() => {
        let rewritten = 0;
        document.querySelectorAll("svg *").forEach((el) => {
            for (const property of ["fill", "stroke"]) {
                const value = el.style?.getPropertyValue(property) ?? "";
                const fragment = /^url\(["']?[^"')]*#([^"')]+)["']?\)$/.exec(value.trim());
                if (!fragment) continue;
                el.style.removeProperty(property);
                el.setAttribute(property, `url(#${fragment[1]})`);
                rewritten += 1;
            }
        });
        return rewritten;
    });
}

/**
 * Replaces the map's canvas with an <img> of what it is currently showing.
 *
 * The choropleth is drawn by MapLibre into a WebGL canvas, and a canvas carries
 * its pixels nowhere but its own drawing buffer: a serialized DOM has the
 * element's size and position and nothing of what was painted into it.  So an
 * archive-based snapshot of this section shows an empty rectangle where the map
 * should be, and a map that failed to draw is indistinguishable from one that
 * drew perfectly.
 *
 * Playwright's own screenshots are taken by the browser and do include canvas
 * pixels.  Taking one here and standing it in for the canvas as a data URI puts
 * the map into the DOM as something a serialization can carry, so the archive
 * holds a picture of the map rather than a hole where one was.
 *
 * The map must have settled first — see waitForMapToSettle.
 */
export async function inlineMapCanvas(page) {
    // A screenshot clipped to the canvas still picks up whatever is drawn over
    // it, which here is Plotly's SVG layer carrying the credits.  Those are
    // archived as live text in their own right, so baking them into the image
    // as well would leave them drawn twice, one copy over the other.
    const overlaySelector = "#geography_heatmap svg";
    await page.evaluate((selector) => {
        document.querySelectorAll(selector).forEach((svg) => {
            svg.style.visibility = "hidden";
        });
    }, overlaySelector);

    const canvas = page.locator("#geography_heatmap canvas.maplibregl-canvas");
    const png = await canvas.screenshot();

    await page.evaluate((selector) => {
        document.querySelectorAll(selector).forEach((svg) => {
            svg.style.visibility = "";
        });
    }, overlaySelector);

    await page.evaluate((dataUri) => {
        const canvasEl = document.querySelector("#geography_heatmap canvas.maplibregl-canvas");
        if (!canvasEl) return;
        const image = document.createElement("img");
        image.src = dataUri;
        // The canvas is laid out by MapLibre through inline styles; the image
        // takes them over so that it lands exactly where the canvas was.
        image.style.cssText = canvasEl.style.cssText;
        image.setAttribute("data-testid", "map-canvas-image");
        image.alt = "";
        canvasEl.parentNode.insertBefore(image, canvasEl);
        canvasEl.style.display = "none";
    }, `data:image/png;base64,${png.toString("base64")}`);
}

/**
 * Asserts that no plot rendered its failure placeholder.  Chromatic would show
 * the placeholder as an image diff, but only against an existing baseline; a
 * plot that has never rendered at a given viewport would otherwise be accepted
 * as that viewport's baseline.
 */
export async function expectPlotsRendered(page) {
    const failed = await page.evaluate(
        ([ids, failureText]) => ids.filter((id) => (document.getElementById(id)?.innerText ?? "").includes(failureText)),
        [PLOT_IDS, PLOT_FAILURE_TEXT],
    );
    expect(failed, "Plots showing a load-failure message instead of a plot").toEqual([]);
}

/**
 * Asserts that no plot's title is run over by its mode bar, which Plotly draws
 * across the first row of the plot rather than above it — hidden until hovered
 * on a mouse, but on show for good on a touch device, which is where a title
 * pulled up into that row by a trimmed margin collides with it.
 */
export async function expectModeBarClearOfTitles(page) {
    const { collisions, checked } = await page.evaluate((ids) => {
        const collisions = [];
        let checked = 0;
        for (const id of ids) {
            const plot = document.getElementById(id);
            const bar = plot?.querySelector(".modebar");
            const title = plot?.querySelector(".gtitle");
            if (!bar || !title) continue;
            const b = bar.getBoundingClientRect();
            const t = title.getBoundingClientRect();
            // The mode bar is laid out whether or not it is being shown, so a
            // zero-sized one means it was never drawn and there is nothing to
            // compare the title against.
            if (b.width === 0 || b.height === 0) continue;
            checked += 1;
            const clears = t.top >= b.bottom || t.bottom <= b.top || t.left >= b.right || t.right <= b.left;
            if (!clears) collisions.push(`${id} (title ${Math.round(t.top)}-${Math.round(t.bottom)}, mode bar ${Math.round(b.top)}-${Math.round(b.bottom)})`);
        }
        return { collisions, checked };
    }, PLOT_IDS);
    expect(collisions, "Plot titles run over by their mode bar").toEqual([]);
    expect(checked, "Plots whose mode bar could be compared against their title").toBeGreaterThan(0);
}

/**
 * Asserts that the page does not scroll sideways at the current viewport, and
 * names the elements that overflow it when it does.  This is the failure mode
 * a narrow viewport hits first — a control bar that cannot wrap runs off the
 * screen — and it is far easier to act on as a named element than as a diff.
 */
export async function expectNoHorizontalOverflow(page) {
    const { scrollWidth, clientWidth, offenders } = await page.evaluate(() => {
        const root = document.documentElement;
        const offenders = [];
        document.querySelectorAll("body *").forEach((el) => {
            // Plotly measures text in a deliberately oversized off-screen SVG.
            if (el.id === "js-plotly-tester") return;
            // A plot's internal geometry is drawn to its own coordinate space
            // and is reported here in the thousands of pixels; the <svg> that
            // holds it is checked instead.  ownerSVGElement is null on that
            // outermost <svg> and non-null only on what is nested inside it.
            if (el.ownerSVGElement) return;
            const { width } = el.getBoundingClientRect();
            if (width > root.clientWidth + 1) {
                const id = el.id ? `#${el.id}` : "";
                const names = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean) : [];
                const classes = names.length ? `.${names.join(".")}` : "";
                offenders.push(`${el.tagName.toLowerCase()}${id}${classes} (${Math.round(width)}px)`);
            }
        });
        return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth, offenders };
    });
    expect(offenders, `Elements wider than the ${clientWidth}px viewport`).toEqual([]);
    expect(scrollWidth, `Page scrolls sideways at ${clientWidth}px`).toBeLessThanOrEqual(clientWidth + 1);
}
