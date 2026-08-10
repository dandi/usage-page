import { test, takeSnapshot } from "@chromatic-com/playwright";

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
    undetermined: { total_bytes_sent: 250000000, total_number_of_downloads: 60, total_number_of_requests: 300, total_number_of_views: 40, number_of_requesters: 75, number_of_unique_regions: 4, number_of_unique_countries: 2 },
});

// Titles for the mock Dandisets.  "000003" is deliberately left out so the
// snapshot also covers a row whose name is unknown (and so is not hyperlinked).
const DANDISET_TITLES_JSONL = `\
{"000001": "Mock electrophysiology recordings"}
{"000002": "Mock calcium imaging dataset"}
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

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Registers Playwright route handlers that intercept every external data
 * request (raw.githubusercontent.com) and respond with the static fixture
 * values above.  Must be called before page.goto().
 */
async function setupDataMocks(page) {
    await page.route("**/dandiset_id_to_title.jsonl", (route) =>
        route.fulfill({ status: 200, contentType: "text/plain", body: DANDISET_TITLES_JSONL }),
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
async function mockVersion(page) {
    await page.evaluate(() => {
        const versionEl = document.getElementById("site_version");
        if (versionEl) versionEl.textContent = "v0.0.0+test0000";
    });
}

/**
 * Waits until all three main Plotly plot sections have finished rendering.
 * Plotly adds the "js-plotly-plot" class to a div once newPlot() completes.
 */
async function waitForPlotsToRender(page) {
    await page.waitForFunction(
        () => {
            const isRendered = (id) => document.getElementById(id)?.classList.contains("js-plotly-plot");
            return isRendered("over_time_plot") && isRendered("histogram_plot") && isRendered("geography_heatmap");
        },
        { timeout: 30000 },
    );
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe("DANDI Usage Page", () => {
    // The Chromatic fixture calls takeSnapshot automatically after the test body
    // unless disableAutoSnapshot is set. Since we call takeSnapshot explicitly
    // ourselves, disabling the automatic one prevents two identical captures per
    // test (which would show up as four redundant snapshots in Chromatic's UI).
    test.use({ disableAutoSnapshot: true });

    test("dark theme", async ({ page }, testInfo) => {
        await setupDataMocks(page);
        await page.addInitScript(() => {
            localStorage.setItem("theme", "dark");
            // Pre-dismiss the analytics consent banner so it does not overlap the plots
            localStorage.setItem("analytics_consent", "declined");
        });
        await page.goto("/");
        await waitForPlotsToRender(page);
        await mockVersion(page);
        await takeSnapshot(page, testInfo);
    });

    test("light theme", async ({ page }, testInfo) => {
        await setupDataMocks(page);
        await page.addInitScript(() => {
            localStorage.setItem("theme", "light");
            // Pre-dismiss the analytics consent banner so it does not overlap the plots
            localStorage.setItem("analytics_consent", "declined");
        });
        await page.goto("/");
        await waitForPlotsToRender(page);
        await mockVersion(page);
        await takeSnapshot(page, testInfo);
    });
});
