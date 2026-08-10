import rawHTML from "../src/index.html?raw";
import { render_sortable_table } from "../src/plot-helpers.ts";

export default {
    title: "DANDI Access Page/Plot Sections",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extracts all elements matched by `selectors` from the raw HTML and joins
 * their outer HTML.  Useful for building multi-section previews.
 */
function extractSections(html, ...selectors) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    return selectors
        .map((sel) => {
            const el = doc.querySelector(sel);
            return el ? el.outerHTML : "";
        })
        .join("\n");
}

// ── Over-Time Plot ────────────────────────────────────────────────────────────

/**
 * Controls and empty plot/table containers for the "Usage over time" section.
 * Plot data won't load (no live network), so only the control UI is visible.
 */
const overTimeSectionHTML = extractSections(
    rawHTML,
    "#over_time",
    "#over_time_aggregate_controls",
    ".view-section:has(#over_time_plot)"
);

export const OverTimePlotDark = {
    name: "Over-Time Plot – Dark",
    render: () => {
        document.documentElement.setAttribute("data-theme", "dark");
        return overTimeSectionHTML;
    },
};

export const OverTimePlotLight = {
    name: "Over-Time Plot – Light",
    render: () => {
        document.documentElement.setAttribute("data-theme", "light");
        return overTimeSectionHTML;
    },
};

// ── Histogram Plot ────────────────────────────────────────────────────────────

/**
 * Controls and empty plot/table containers for the "Usage per Dandiset /
 * asset" histogram section.
 */
const histogramSectionHTML = extractSections(rawHTML, "#histogram", ".view-section:has(#histogram_plot)");

export const HistogramPlotDark = {
    name: "Histogram Plot – Dark",
    render: () => {
        document.documentElement.setAttribute("data-theme", "dark");
        return histogramSectionHTML;
    },
};

export const HistogramPlotLight = {
    name: "Histogram Plot – Light",
    render: () => {
        document.documentElement.setAttribute("data-theme", "light");
        return histogramSectionHTML;
    },
};

// ── Geography Section ─────────────────────────────────────────────────────────

/**
 * Controls and empty map/table containers for the geographic heatmap section.
 */
const geoSectionHTML = extractSections(rawHTML, "#geo", ".view-section:has(#geography_heatmap)");

export const GeographyPlotDark = {
    name: "Geography Plot – Dark",
    render: () => {
        document.documentElement.setAttribute("data-theme", "dark");
        return geoSectionHTML;
    },
};

export const GeographyPlotLight = {
    name: "Geography Plot – Light",
    render: () => {
        document.documentElement.setAttribute("data-theme", "light");
        return geoSectionHTML;
    },
};

// ── Sortable Table (static mock data) ────────────────────────────────────────

const count_format = (n) => n.toLocaleString();

const MOCK_COLUMNS = [
    { label: "Region", key: "region", numeric: false },
    { label: "Bytes", key: "bytes", numeric: true },
    { label: "Requests", key: "requests", numeric: true, format_fn: count_format },
    { label: "Downloads", key: "downloads", numeric: true, format_fn: count_format },
    { label: "Views", key: "views", numeric: true, format_fn: count_format },
];

const MOCK_ROWS = [
    { region: "US/California", bytes: 1073741824, requests: 3200, downloads: 900, views: 260 },
    { region: "DE/Bavaria", bytes: 536870912, requests: 1400, downloads: 380, views: 110 },
    { region: "GB/England", bytes: 268435456, requests: 1050, downloads: 290, views: 85 },
    { region: "FR/Île-de-France", bytes: 134217728, requests: 720, downloads: 195, views: 60 },
    { region: "JP/Tokyo", bytes: 67108864, requests: 410, downloads: 105, views: 32 },
];

function mockFormatFn(n) {
    if (n >= 1e9) return (n / 1e9).toFixed(1) + " GB";
    if (n >= 1e6) return (n / 1e6).toFixed(1) + " MB";
    return n + " B";
}

/**
 * Renders a fully static sortable table using mock data so it is always
 * visible in Storybook regardless of network availability.
 * The `play` function runs after the HTML is in the DOM so that
 * `render_sortable_table` can find the container by ID.
 */
export const SortableTableDark = {
    name: "Sortable Table – Dark",
    render: () => {
        document.documentElement.setAttribute("data-theme", "dark");
        return '<div id="mock_table"></div>';
    },
    play: async () => {
        render_sortable_table("mock_table", "Usage per region (mock data)", MOCK_COLUMNS, MOCK_ROWS, mockFormatFn);
    },
};

export const SortableTableLight = {
    name: "Sortable Table – Light",
    render: () => {
        document.documentElement.setAttribute("data-theme", "light");
        return '<div id="mock_table"></div>';
    },
    play: async () => {
        render_sortable_table("mock_table", "Usage per region (mock data)", MOCK_COLUMNS, MOCK_ROWS, mockFormatFn);
    },
};
