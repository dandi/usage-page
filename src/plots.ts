import { handlePlotlyError } from "./errors.js";
import {
    setUrlParam,
    color_with_alpha,
    parse_by_day_tsv,
    parse_by_asset_type_per_week_tsv,
    aggregate_by_timebin,
    format_bytes as format_bytes_pure,
    scaled_metric,
    format_ratio,
    exclude_testing_dandisets,
    METRIC_LABELS,
    RAW_PLOT_METRICS,
    SCALED_PLOT_METRICS,
    PER_DANDISET_METRIC_ORDER,
    histogram_metrics_for,
    default_histogram_metric,
    validate_plot_metric,
    format_metric_value,
    metric_unit_label,
    histogram_plot_title,
} from "./utils.js";
import {
    escape_html,
    make_cumulative,
    fetchWithRetry,
    apply_view_mode,
    apply_geo_view_mode,
    derive_data_source_urls,
    render_sortable_table,
    render_totals_summary,
    parse_dandiset_titles_jsonl,
    parse_dandiset_numbers_jsonl,
    fetch_maybe_gzipped_text,
    format_dandiset_label,
} from "./plot-helpers.js";
import { load as loadYaml } from "js-yaml";
import Plotly from "plotly.js-dist-min";
import { feature as topojsonFeature } from "topojson-client";

declare const __APP_VERSION__: string;
declare const __GIT_HASH__: string;

// ── Theme helpers (mirrors :root CSS variables in styles.css) ───────────────
const DARK_THEME = {
    bg:            '#1a1a2e',
    surface:       '#16213e',
    border:        '#2a2a4a',
    text:          '#e0e0e0',
    textSecondary: '#a0a0b0',
    accent:        '#53a8b6',
    mapStyle:      'carto-darkmatter',
    annotationBg:  'rgba(22, 33, 62, 0.7)',
};

const LIGHT_THEME = {
    bg:            '#f5f7fa',
    surface:       '#ffffff',
    border:        '#d1d9e0',
    text:          '#1a1a2e',
    textSecondary: '#5a6580',
    accent:        '#53a8b6',
    mapStyle:      'carto-positron',
    annotationBg:  'rgba(245, 247, 250, 0.85)',
};

// Media query used to detect the OS / browser dark-mode preference.
const PREFERS_DARK_MQ = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

// Tracks whether the page is currently in dark mode; initialised from
// localStorage (or browser preference) in initTheme() on DOMContentLoaded.
let IS_DARK_MODE = true;

/** Returns the active theme colour object. */
function getTheme() {
    return IS_DARK_MODE ? DARK_THEME : LIGHT_THEME;
}

/**
 * Mutates `layout` in-place to apply the current theme colours and returns it.
 * Axis overrides are merged so callers can still add axis-specific options.
 */
function applyTheme(layout: Partial<Plotly.Layout>): Partial<Plotly.Layout> {
    const theme = getTheme();
    layout.paper_bgcolor = theme.surface;
    layout.plot_bgcolor  = theme.surface;
    layout.font = Object.assign({ color: theme.text }, layout.font || {});

    const axisDefaults = {
        gridcolor:     theme.border,
        linecolor:     theme.border,
        zerolinecolor: theme.border,
        tickfont:      { color: theme.textSecondary },
        titlefont:     { color: theme.textSecondary },
    };
    if (layout.xaxis) Object.assign(layout.xaxis, { ...axisDefaults, ...layout.xaxis });
    if (layout.yaxis) Object.assign(layout.yaxis, { ...axisDefaults, ...layout.yaxis });
    return layout;
}

// ── Shared Plotly config ─────────────────────────────────────────────────────
// Replaces the default PNG camera button with a paired group containing both
// PNG and SVG download buttons, keeping them side-by-side in the modebar, and
// adds a "view source data" button that opens the plot's backing file on
// GitHub (the target is read from the plot element's data-source-data-url
// attribute, set via set_plot_source_url() at each render site).
const PLOTLY_CONFIG: Partial<Plotly.Config> = {
    modeBarButtonsToRemove: ['toImage' as Plotly.ModeBarDefaultButtons],
    modeBarButtonsToAdd: [
        [
            {
                name: 'Download plot as PNG',
                icon: Plotly.Icons.camera,
                click: (gd: Plotly.PlotlyHTMLElement) => {
                    Plotly.downloadImage(gd, { format: 'png', filename: gd.id || 'dandi-plot' } as Plotly.DownloadImgopts);
                },
            },
            {
                name: 'Download plot as SVG',
                icon: {
                    // Material Design "file_download" arrow icon
                    width: 24,
                    height: 24,
                    path: 'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z',
                },
                click: (gd: Plotly.PlotlyHTMLElement) => {
                    Plotly.downloadImage(gd, { format: 'svg', filename: gd.id || 'dandi-plot' } as Plotly.DownloadImgopts);
                },
            },
        ] as any,
        [
            {
                name: 'View source data on GitHub',
                icon: {
                    // Material Design "database" (stacked cylinder) icon
                    width: 24,
                    height: 24,
                    path: 'M12 3C7.58 3 4 4.79 4 7s3.58 4 8 4 8-1.79 8-4-3.58-4-8-4zM4 9v3c0 2.21 3.58 4 8 4s8-1.79 8-4V9c0 2.21-3.58 4-8 4s-8-1.79-8-4zm0 5v3c0 2.21 3.58 4 8 4s8-1.79 8-4v-3c0 2.21-3.58 4-8 4s-8-1.79-8-4z',
                },
                click: (gd: Plotly.PlotlyHTMLElement) => {
                    const url = (gd as unknown as HTMLElement).dataset.sourceDataUrl;
                    if (url) window.open(url, '_blank', 'noopener');
                },
            },
        ] as any,
    ],
};

/**
 * Records the source-data file behind a plot on its container element, so the
 * shared "View source data on GitHub" modebar button knows where to link.
 * Prefers the version-tracked GitHub file view when the URL can be derived
 * from a raw.githubusercontent.com URL; falls back to the URL as given.
 */
function set_plot_source_url(plot_element_id: string, raw_url: string) {
    const element = document.getElementById(plot_element_id);
    if (!element) return;
    const { file } = derive_data_source_urls(raw_url);
    element.dataset.sourceDataUrl = file ?? raw_url;
}

/**
 * Reads the saved theme preference from localStorage.  When no preference has
 * been saved yet, falls back to the browser / OS setting via
 * `prefers-color-scheme`.  Applies the resolved theme to the <html> element,
 * updates IS_DARK_MODE, and registers a media-query listener so the page
 * automatically follows OS theme changes as long as the user has not chosen an
 * explicit override.
 * Call once on page load before any plots are rendered.
 *
 * NOTE: The defaulting logic (anything other than 'light' → dark) must stay
 * in sync with the inline anti-FOUC script in index.html <head>.
 */
function initTheme() {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark' || saved === 'light') {
        IS_DARK_MODE = saved === 'dark';
    } else {
        IS_DARK_MODE = PREFERS_DARK_MQ ? PREFERS_DARK_MQ.matches : true;
    }
    document.documentElement.setAttribute('data-theme', IS_DARK_MODE ? 'dark' : 'light');
    syncThemeToggleIcon();

    // When no explicit preference is stored, keep in sync with OS theme changes.
    if (PREFERS_DARK_MQ) {
        PREFERS_DARK_MQ.addEventListener('change', (e) => {
            if (localStorage.getItem('theme')) return; // user override takes precedence
            IS_DARK_MODE = e.matches;
            document.documentElement.setAttribute('data-theme', IS_DARK_MODE ? 'dark' : 'light');
            syncThemeToggleIcon();
        });
    }
}

/**
 * Flips the active theme, persists it to localStorage, updates the <html>
 * attribute, and re-renders all visible plots so they adopt the new colours.
 */
function toggleTheme() {
    IS_DARK_MODE = !IS_DARK_MODE;
    const theme = IS_DARK_MODE ? 'dark' : 'light';
    localStorage.setItem('theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
    syncThemeToggleIcon();

    // Re-render all plots with the new theme colours
    const selector = document.getElementById('dandiset_selector') as HTMLSelectElement | null;
    if (selector) {
        const id = selector.value;
        load_over_time_plot(id);
        load_histogram(id);
        load_aws_histogram(id);
        load_geographic_heatmap(id);
    }
}

/** Updates the toggle button icon to reflect the current theme. */
function syncThemeToggleIcon() {
    const btn = document.getElementById('theme_toggle_btn') as HTMLElement | null;
    if (!btn) return;
    if (IS_DARK_MODE) {
        // Currently dark → clicking will switch to light → show sun icon
        btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0-13a1 1 0 0 0 1-1V2a1 1 0 1 0-2 0v1a1 1 0 0 0 1 1zm0 14a1 1 0 0 0-1 1v1a1 1 0 1 0 2 0v-1a1 1 0 0 0-1-1zm10-5a1 1 0 0 0 0-2h-1a1 1 0 1 0 0 2h1zM3 12a1 1 0 0 0-1-1H1a1 1 0 1 0 0 2h1a1 1 0 0 0 1-1zm15.36-6.36a1 1 0 0 0 0-1.41l-.71-.71a1 1 0 0 0-1.41 1.41l.71.71a1 1 0 0 0 1.41 0zM6.05 17.95a1 1 0 0 0-1.41 0l-.71.71a1 1 0 1 0 1.41 1.41l.71-.71a1 1 0 0 0 0-1.41zm12.02 2.12-.71-.71a1 1 0 0 0-1.41 1.41l.71.71a1 1 0 0 0 1.41-1.41zM5.34 5.64a1 1 0 0 0-1.41-1.41l-.71.71a1 1 0 1 0 1.41 1.41l.71-.71z"/></svg>';
        btn.setAttribute('aria-label', 'Switch to light mode');
        btn.setAttribute('title', 'Switch to light mode');
    } else {
        // Currently light → clicking will switch to dark → show moon icon
        btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z"/></svg>';
        btn.setAttribute('aria-label', 'Switch to dark mode');
        btn.setAttribute('title', 'Switch to dark mode');
    }
}
// ────────────────────────────────────────────────────────────────────────────

/**
 * Shows or hides the "Group by" control for the over-time plot, and
 * shows/hides the "Dandisets" option based on whether the archive is selected.
 * When a non-archive dandiset is selected, the "Dandisets" option is hidden and
 * any active "dandisets" group-by is reset to "none".
 * The whole control is hidden when the table view is active.
 */
function apply_over_time_group_by_visibility() {
    const container = document.getElementById("over_time_group_by_container");
    if (!container) return;
    container.style.display = !USE_OVER_TIME_TABLE ? "" : "none";

    const settingsContainer = document.getElementById("ot_settings_container");
    if (settingsContainer) {
        settingsContainer.style.display = !USE_OVER_TIME_TABLE ? "contents" : "none";
        if (USE_OVER_TIME_TABLE) {
            const panel = document.getElementById("ot_settings_panel");
            const btn = document.getElementById("ot_settings_btn") as HTMLButtonElement | null;
            if (panel) {
                panel.classList.remove("open");
                panel.setAttribute("aria-hidden", "true");
            }
            if (btn) btn.setAttribute("aria-expanded", "false");
        }
    }

    const selector = document.getElementById("dandiset_selector") as HTMLSelectElement | null;
    const isArchive = !selector || selector.value === "archive";
    const dandisets_option = document.querySelector('#over_time_group_by option[value="dandisets"]');
    if (dandisets_option) {
        (dandisets_option as HTMLOptionElement).hidden = !isArchive;
    }

    // If "dandisets" was selected but a non-archive dandiset is now active, reset to "none"
    const groupBySelector = document.getElementById("over_time_group_by") as HTMLSelectElement | null;
    if (!isArchive && groupBySelector && groupBySelector.value === "dandisets") {
        groupBySelector.value = "none";
        OVER_TIME_GROUP_BY = "none";
    }
}

/**
 * Disables the 'Daily' aggregation radio button when grouping by 'asset type',
 * because the underlying data is only available at weekly granularity.
 * If 'Daily' is currently selected, it is automatically switched to 'Weekly'.
 */
function apply_daily_aggregation_restriction() {
    const daily_radio = document.getElementById("aggregation_daily") as HTMLInputElement | null;
    const daily_label = document.querySelector('label[for="aggregation_daily"]') as HTMLElement | null;
    if (!daily_radio) return;

    const restrict = OVER_TIME_GROUP_BY === "asset_type";
    daily_radio.disabled = restrict;
    if (daily_label) {
        daily_label.title = restrict
            ? "Daily data is not available when grouping by asset type"
            : "";
    }

    if (restrict && TIME_AGGREGATION === "daily") {
        TIME_AGGREGATION = "weekly";
        const weekly_radio = document.getElementById("aggregation_weekly") as HTMLInputElement | null;
        if (weekly_radio) weekly_radio.checked = true;
    }
}

/**
 * Shows the over-time metric selector only in plot view, since the table view
 * lists every metric as its own column already, and restricts it to "Bytes"
 * while grouping by asset type — the one grouping whose source data carries no
 * other metric.  A selection that is unavailable falls back to "Bytes".
 */
function apply_over_time_metric_visibility() {
    const container = document.getElementById("over_time_metric_container");
    if (container) container.style.display = USE_OVER_TIME_TABLE ? "none" : "";

    const bytes_only = OVER_TIME_GROUP_BY === "asset_type";
    if (bytes_only) OVER_TIME_METRIC = "bytes";

    const selector = document.getElementById("over_time_metric") as HTMLSelectElement | null;
    if (!selector) return;
    selector.disabled = bytes_only;
    selector.title = bytes_only ? "Only bytes are available when grouping by asset type" : "";
    selector.value = OVER_TIME_METRIC;
}

/**
 * Whether the histogram is showing Dandisets (the archive-wide selection)
 * rather than the assets of one Dandiset.  An empty selector means its options
 * have not been fetched yet, which is still the archive-wide default; the
 * selection is re-applied once they arrive, so a deep-linked scaled metric is
 * not dropped in the meantime.
 */
function histogram_shows_dandisets(): boolean {
    const selector = document.getElementById("dandiset_selector") as HTMLSelectElement | null;
    return (selector?.value || "archive") === "archive";
}

/**
 * Shows the histogram metric selector only in plot view (its table lists every
 * metric already), and offers the scaled metrics only for the archive-wide
 * selection, whose bars are Dandisets with a known asset count and stored size.
 * Any other selection falls back to its own first metric ("Bytes") when a
 * scaled metric was active.
 */
function apply_histogram_metric_visibility() {
    const container = document.getElementById("histogram_metric_container");
    if (container) container.style.display = USE_HISTOGRAM_TABLE ? "none" : "";

    const is_archive = histogram_shows_dandisets();
    if (!is_archive && SCALED_PLOT_METRICS.includes(HISTOGRAM_METRIC)) {
        HISTOGRAM_METRIC = default_histogram_metric(false);
    }

    const selector = document.getElementById("histogram_metric") as HTMLSelectElement | null;
    if (!selector) return;
    SCALED_PLOT_METRICS.forEach((metric) => {
        const option = selector.querySelector(`option[value="${metric}"]`) as HTMLOptionElement | null;
        if (option) option.hidden = !is_archive;
    });
    // Each selection lists its metrics in the column order of the table beside
    // it, so the dropdown and the table read the same way round.  Re-appending
    // an option moves it to the end, so walking the order sorts the list; the
    // hidden scaled metrics trail the per-asset ones, out of sight.
    const metric_order = is_archive
        ? histogram_metrics_for(true)
        : [...histogram_metrics_for(false), ...SCALED_PLOT_METRICS];
    metric_order.forEach((metric) => {
        const option = selector.querySelector(`option[value="${metric}"]`);
        if (option) selector.appendChild(option);
    });
    selector.value = HISTOGRAM_METRIC;
}

// ────────────────────────────────────────────────────────────────────────────

// Initialise the theme and URL-driven state as early as possible (before plots
// are rendered) so that CSS variables, global flags, and form controls are all
// in sync from the very first paint.  syncFromUrl() is called here instead of
// inside the window "load" handler so it always runs before any async data
// fetch can resolve and trigger the first plot render.
document.addEventListener("DOMContentLoaded", () => {
    initTheme();

    // Set the version tag in the footer
    const versionEl = document.getElementById("site_version");
    if (versionEl) {
        versionEl.textContent = `v${__APP_VERSION__}+${__GIT_HASH__}`;
    }

    // Sync global state and form controls from URL parameters early so that
    // when the data fetch Promise resolves and plots are rendered for the first
    // time, the correct settings (cumulative, group_by, etc.) are already in
    // effect.
    syncFromUrl();

    // Remove the 'preload' class added by the inline <head> script so that CSS
    // transitions are re-enabled for all subsequent user interactions (theme
    // toggle, settings changes, etc.).  Using rAF ensures the class is removed
    // after the browser has committed the initial paint with the correct state.
    window.requestAnimationFrame(() => {
        document.documentElement.classList.remove('preload');
    });
});

// Handle section anchor link clicks: update the URL hash via pushState so the
// address bar reflects the section link, but without triggering a popstate
// event (which would re-render all plots and cause visible flicker).
// Then manually scroll to the target element so the anchor behaves like a
// normal in-page link.
document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".section-anchor").forEach((anchor) => {
        anchor.addEventListener("click", (e) => {
            e.preventDefault();
            const href = anchor.getAttribute("href");
            window.history.pushState(null, "", href);
            document.querySelector(href!)?.scrollIntoView({ behavior: "smooth" });
        });
    });
});

// URLs for fetching data
// When forking this repo for a different deployment, update BASE_URL to point at the new data repository.
const BASE_URL = "https://raw.githubusercontent.com/dandi/access-summaries/main";
const BASE_TSV_URL = `${BASE_URL}/content/summaries`;

const ARCHIVE_TOTALS_URL = `${BASE_URL}/content/archive_totals.json`;
const ALL_DANDISET_TOTALS_URL = `${BASE_URL}/content/totals.json`;
const REGION_CODES_TO_LATITUDE_LONGITUDE_URL = `${BASE_URL}/content/region_codes_to_coordinates.yaml`;
const DANDISET_ID_TO_TITLE_URL =
    "https://raw.githubusercontent.com/dandi-cache/dandiset-id-to-title/derivatives/derivatives/dandiset_id_to_title.jsonl";
// Content of each Dandiset (asset count and stored size), used to scale the raw
// usage metrics into per-asset and per-stored-byte rates.  Both are gzipped
// JSONL and are decompressed client-side.
const DANDISET_ID_TO_NUMBER_OF_ASSETS_URL =
    "https://raw.githubusercontent.com/dandi-cache/dandiset-id-to-number-of-assets/dist/derivatives/dandiset_id_to_number_of_assets.jsonl.gz";
const DANDISET_ID_TO_TOTAL_SIZE_URL =
    "https://raw.githubusercontent.com/dandi-cache/dandiset-id-to-total-size/dist/derivatives/dandiset_id_to_total_size.jsonl.gz";

// Landing page for a Dandiset on the DANDI archive.
const DANDI_ARCHIVE_DANDISET_URL = "https://dandiarchive.org/dandiset";

/**
 * Returns the DANDI archive landing-page URL for a Dandiset ID, or null when
 * the ID is not a real Dandiset (for example the "undetermined" bucket, which
 * has no archive page to link to).
 */
function dandiset_archive_url(dandiset_id: unknown): string | null {
    return typeof dandiset_id === "string" && /^\d{6}$/.test(dandiset_id)
        ? `${DANDI_ARCHIVE_DANDISET_URL}/${dandiset_id}`
        : null;
}

interface DandisetTotals {
    total_bytes_sent: number;
    total_number_of_downloads: number;
    total_number_of_requests: number;
    total_number_of_views: number;
    number_of_requesters: number | string;
    number_of_unique_regions: number | string;
    number_of_unique_countries: number | string;
}

let REGION_CODES_TO_LATITUDE_LONGITUDE: Record<string, { latitude: number; longitude: number }> = {};
let ALL_DANDISET_TOTALS: Record<string, DandisetTotals> = {};
// Maps a Dandiset ID to its current title, used to annotate ID displays with a human-readable name.
let DANDISET_TITLES: Record<string, string> = {};
// Maps a Dandiset ID to the number of assets it contains and to its total
// stored size in bytes; both are the denominators of the scaled metrics shown
// in the per-Dandiset table.
let DANDISET_ASSET_COUNTS: Record<string, number> = {};
let DANDISET_TOTAL_SIZES: Record<string, number> = {};
let USE_LOG_SCALE = false;
let USE_CUMULATIVE = false;
let USE_OT_LINE_PLOT = false;
let USE_HIST_LINE_PLOT = false;
let USE_BINARY = false;
let USE_STACKED = true;
let GEO_VIEW = "regions";  // "regions" | "points" | "table" | "aws"
let TIME_AGGREGATION = "daily";  // "daily" | "weekly" | "monthly" | "yearly"
let OVER_TIME_GROUP_BY = "none";  // "none" | "dandisets"
// The metric each of the first two plots is drawn in.  The over-time plot has
// the raw metrics only; the per-Dandiset histogram additionally offers the
// scaled ones (see SCALED_PLOT_METRICS), which exist only for that selection.
let OVER_TIME_METRIC = "bytes";  // "bytes" | "views" | "downloads"
// Defaults to the first metric its dropdown offers for the archive-wide
// selection the page opens on, and falls back to the first metric of whichever
// selection is active thereafter (see default_histogram_metric).
let HISTOGRAM_METRIC = default_histogram_metric(true);
let TOP_N_DANDISETS = 8;
let USE_OVER_TIME_TABLE = false;
let USE_HISTOGRAM_TABLE = false;
// Defaults on: a first visit should show research usage, not the testing
// traffic that otherwise leads most of the per-Dandiset metrics.
let IGNORE_TESTING_DANDISETS = true;
let GEOJSON_DATA: { features: any[] } | null = null;
let NAME_ALIASES: Record<string, Record<string, string>> | null = null;

/** Returns a Plotly hover-text fragment for one metric; empty string if value is NaN. */
const hover_metric = (label: string, value: number): string =>
    isNaN(value) ? "" : `<br>${label}: ${value.toLocaleString()}`;

/** The metrics a hover label lists, in the order they follow the plotted one. */
const HOVER_METRIC_ORDER = ["bytes", "views", "downloads", "requests"];

/**
 * Builds the value lines of a hover label: the plotted metric first, so the
 * first value read is always the one the bar's height shows, followed by the
 * remaining metrics for context.  Metrics with no value are left out, and each
 * is formatted in its own units.
 */
function hover_metric_lines(plotted_metric: string, values: Record<string, number | undefined>): string {
    const order = [plotted_metric, ...HOVER_METRIC_ORDER.filter((metric) => metric !== plotted_metric)];
    return order
        .map((metric) => {
            const value = values[metric];
            if (value === undefined || isNaN(value)) return "";
            return `<br>${METRIC_LABELS[metric] ?? metric}: ${format_metric_value(metric, value, USE_BINARY)}`;
        })
        .join("");
}

/**
 * Builds the y-axis options for a plot drawn in `metric`: byte plots get a "B"
 * tick suffix and named decade ticks on a log scale, every other metric is a
 * plain count or ratio.
 */
function build_metric_yaxis(metric: string, tickformat = "~s"): Partial<Plotly.LayoutAxis> {
    const is_bytes = metric === "bytes";
    return {
        type: USE_LOG_SCALE ? "log" : "linear",
        tickformat: USE_LOG_SCALE ? "" : tickformat,
        ticksuffix: USE_LOG_SCALE || !is_bytes ? "" : "B",
        tickvals: USE_LOG_SCALE && is_bytes ? [1000, 1000000, 1000000000, 1000000000000, 1000000000000000] : undefined,
        ticktext: USE_LOG_SCALE && is_bytes ? ["KB", "MB", "GB", "TB", "PB"] : undefined,
    } as Partial<Plotly.LayoutAxis>;
}

/**
 * Reads all URL parameters and synchronises them to the global state variables
 * and UI elements, without triggering any plot reloads.  Call this on initial
 * load and whenever the browser navigates back/forward.
 */
function syncFromUrl() {
    const params = new URLSearchParams(window.location.search);

    // Log scale
    const logScaleCheckbox = document.getElementById("log_scale") as HTMLInputElement | null;
    if (logScaleCheckbox) {
        USE_LOG_SCALE = params.get("log") === "true";
        logScaleCheckbox.checked = USE_LOG_SCALE;
    }

    // Cumulative
    const cumulativeCheckbox = document.getElementById("cumulative") as HTMLInputElement | null;
    if (cumulativeCheckbox) {
        USE_CUMULATIVE = params.get("cumulative") === "true";
        cumulativeCheckbox.checked = USE_CUMULATIVE;
    }

    // Plot type (bar vs line) — independent for over-time and histogram
    USE_OT_LINE_PLOT = params.get("ot_plot_type") === "line";
    const otPlotTypeSelect = document.getElementById("ot_plot_type") as HTMLSelectElement | null;
    if (otPlotTypeSelect) otPlotTypeSelect.value = USE_OT_LINE_PLOT ? "line" : "bar";

    USE_HIST_LINE_PLOT = params.get("hist_plot_type") === "line";
    const histPlotTypeSelect = document.getElementById("hist_plot_type") as HTMLSelectElement | null;
    if (histPlotTypeSelect) histPlotTypeSelect.value = USE_HIST_LINE_PLOT ? "line" : "bar";

    // Stacked vs overlay for grouped over-time plot (default: stacked)
    USE_STACKED = params.get("stacked") !== "false";
    const stackedSelect = document.getElementById("ot_stacked") as HTMLSelectElement | null;
    if (stackedSelect) stackedSelect.value = USE_STACKED ? "stacked" : "overlay";

    // Prefix (binary vs decimal)
    const prefixSelector = document.getElementById("prefix") as HTMLSelectElement | null;
    if (prefixSelector) {
        USE_BINARY = params.get("prefix") === "binary";
        prefixSelector.value = USE_BINARY ? "binary" : "decimal";
    }

    // Geo view
    const urlMap = params.get("map");
    const validGeoViews = ["regions", "points", "table", "aws"];
    GEO_VIEW = urlMap !== null && validGeoViews.includes(urlMap) ? urlMap : "regions";
    const geoRadio = document.querySelector(`input[name="geo_view"][value="${GEO_VIEW}"]`) as HTMLInputElement | null;
    if (geoRadio) geoRadio.checked = true;
    apply_geo_view_mode(GEO_VIEW);

    // Over-time view (plot vs table)
    USE_OVER_TIME_TABLE = params.get("over_time") === "table";
    const overTimeValue = USE_OVER_TIME_TABLE ? "table" : "plot";
    const overTimeRadio = document.querySelector(`input[name="over_time_view"][value="${overTimeValue}"]`) as HTMLInputElement | null;
    if (overTimeRadio) overTimeRadio.checked = true;
    apply_view_mode("over_time_plot", "over_time_table", USE_OVER_TIME_TABLE);
    apply_over_time_group_by_visibility();
    const validAggregations = ["daily", "weekly", "monthly", "yearly"];
    const urlAggregation = params.get("aggregation");
    TIME_AGGREGATION = urlAggregation !== null && validAggregations.includes(urlAggregation) ? urlAggregation : "daily";
    const aggregationRadio = document.querySelector(`input[name="time_aggregation"][value="${TIME_AGGREGATION}"]`) as HTMLInputElement | null;
    if (aggregationRadio) aggregationRadio.checked = true;

    // Over-time group by
    const groupBySelector = document.getElementById("over_time_group_by") as HTMLSelectElement | null;
    if (groupBySelector) {
        const urlGroupBy = params.get("group_by");
        OVER_TIME_GROUP_BY = (urlGroupBy !== null && ["none", "dandisets", "asset_type"].includes(urlGroupBy)) ? urlGroupBy : "none";
        groupBySelector.value = OVER_TIME_GROUP_BY;
    }
    apply_daily_aggregation_restriction();

    // Plotted metric, independent for the over-time and histogram sections
    OVER_TIME_METRIC = validate_plot_metric(params.get("ot_metric"), RAW_PLOT_METRICS);
    apply_over_time_metric_visibility();

    // Top N dandisets
    const topNInput = document.getElementById("top_n_dandisets") as HTMLInputElement | null;
    if (topNInput) {
        const urlTopN = parseInt(params.get("top_n") ?? "", 10);
        TOP_N_DANDISETS = (!isNaN(urlTopN) && urlTopN >= 1) ? urlTopN : 8;
        topNInput.value = String(TOP_N_DANDISETS);
    }

    // Histogram view (plot vs table)
    USE_HISTOGRAM_TABLE = params.get("histogram") === "table";
    const histogramValue = USE_HISTOGRAM_TABLE ? "table" : "plot";
    const histogramRadio = document.querySelector(`input[name="histogram_view"][value="${histogramValue}"]`) as HTMLInputElement | null;
    if (histogramRadio) histogramRadio.checked = true;
    apply_view_mode("histogram_plot", "histogram_table", USE_HISTOGRAM_TABLE);

    // Which metrics are on offer, and which of them is the default, both follow
    // the current selection; apply_histogram_metric_visibility() re-resolves
    // this once the Dandiset list has arrived and a selection is made.
    const histogram_is_archive = histogram_shows_dandisets();
    HISTOGRAM_METRIC = validate_plot_metric(
        params.get("hist_metric"),
        histogram_metrics_for(histogram_is_archive),
        default_histogram_metric(histogram_is_archive)
    );
    apply_histogram_metric_visibility();

    // Ignore testing Dandisets
    const ignoreTestingCheckbox = document.getElementById("ignore_testing_dandisets") as HTMLInputElement | null;
    if (ignoreTestingCheckbox) {
        IGNORE_TESTING_DANDISETS = params.get("ignore_testing") !== "false";
        ignoreTestingCheckbox.checked = IGNORE_TESTING_DANDISETS;
    }
    apply_ignore_testing_visibility();
}

/**
 * Shows the "Ignore testing datasets" setting only where it applies: the
 * per-Dandiset table, which is the archive-wide selection.  Any other selection
 * lists assets rather than Dandisets, so there is nothing to filter.
 */
function apply_ignore_testing_visibility() {
    const container = document.getElementById("hist_ignore_testing_container");
    if (!container) return;
    const selector = document.getElementById("dandiset_selector") as HTMLSelectElement | null;
    const is_archive = !selector || selector.value === "archive";
    container.style.display = is_archive ? "" : "none";
}

/**
 * Wires up open/close behaviour for a settings panel (gear wheel).
 * Clicking the button toggles the panel; clicking outside or pressing Escape
 * closes it.
 */
function setupSettingsPanel(btnId: string, panelId: string): void {
    const btn = document.getElementById(btnId);
    const panel = document.getElementById(panelId);
    if (!btn || !panel) return;

    btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = panel.classList.toggle("open");
        btn.setAttribute("aria-expanded", String(isOpen));
        panel.setAttribute("aria-hidden", String(!isOpen));
    });
    document.addEventListener("click", (e) => {
        if (!panel.contains(e.target as Node | null) && !btn.contains(e.target as Node | null)) {
            panel.classList.remove("open");
            btn.setAttribute("aria-expanded", "false");
            panel.setAttribute("aria-hidden", "true");
        }
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            panel.classList.remove("open");
            btn.setAttribute("aria-expanded", "false");
            panel.setAttribute("aria-hidden", "true");
        }
    });
}

// Check if Plotly is loaded after the window loads
window.addEventListener("load", () => {
    if (typeof Plotly === "undefined") {
        handlePlotlyError();
    }

    // Theme toggle button
    const themeToggleBtn = document.getElementById("theme_toggle_btn");
    if (themeToggleBtn) {
        themeToggleBtn.addEventListener("click", toggleTheme);
    }

    // Settings panels (gear wheels) open/close
    setupSettingsPanel("settings_btn", "settings_panel");
    setupSettingsPanel("ot_settings_btn", "ot_settings_panel");
    setupSettingsPanel("hist_settings_btn", "hist_settings_panel");

    // Add event listener for log scale checkbox
    const logScaleCheckbox = document.getElementById("log_scale");
    if (logScaleCheckbox) {
        logScaleCheckbox.addEventListener("change", () => {
            USE_LOG_SCALE = (logScaleCheckbox as HTMLInputElement).checked;

            const params = new URLSearchParams(window.location.search);
            setUrlParam(params, "log", String(USE_LOG_SCALE), "false");
            const query = params.toString();
            window.history.pushState({}, "", window.location.pathname + (query ? "?" + query : ""));

            // Get the current dandiset ID
            const dandiset_selector = document.getElementById("dandiset_selector") as HTMLSelectElement | null;
            const selected_dandiset = dandiset_selector?.value ?? "";

            // Reload plots with the current dandiset ID
            load_over_time_plot(selected_dandiset);
            load_histogram(selected_dandiset);
            load_aws_histogram(selected_dandiset);
            load_geographic_heatmap(selected_dandiset);
        });
    }

    // Add event listener for cumulative totals
    const cumulativeCheckbox = document.getElementById("cumulative");
    if (cumulativeCheckbox) {
        cumulativeCheckbox.addEventListener("change", () => {
            USE_CUMULATIVE = (cumulativeCheckbox as HTMLInputElement).checked;

            const params = new URLSearchParams(window.location.search);
            if ((cumulativeCheckbox as HTMLInputElement).checked) {
                params.set("cumulative", "true");
            } else {
                params.delete("cumulative");
            }
            const query = params.toString();
            const newUrl = window.location.pathname + (query ? "?" + query : "");
            window.history.pushState({}, "", newUrl);

            // Get the current dandiset ID
            const dandiset_selector = document.getElementById("dandiset_selector") as HTMLSelectElement | null;
            const selected_dandiset = dandiset_selector?.value ?? "";

            // Reload plots with the current dandiset ID
            load_over_time_plot(selected_dandiset);
            load_histogram(selected_dandiset);
            load_aws_histogram(selected_dandiset);
            load_geographic_heatmap(selected_dandiset);
        });
    }

    // Add event listener for over-time plot type toggle (bar vs line)
    const otPlotTypeSelect = document.getElementById("ot_plot_type");
    if (otPlotTypeSelect) {
        otPlotTypeSelect.addEventListener("change", () => {
            USE_OT_LINE_PLOT = (otPlotTypeSelect as HTMLSelectElement).value === "line";

            const params = new URLSearchParams(window.location.search);
            setUrlParam(params, "ot_plot_type", (otPlotTypeSelect as HTMLSelectElement).value, "bar");
            const query = params.toString();
            window.history.pushState({}, "", window.location.pathname + (query ? "?" + query : ""));

            const selected_dandiset = (document.getElementById("dandiset_selector") as HTMLSelectElement | null)?.value ?? "";
            load_over_time_plot(selected_dandiset);
        });
    }

    // Add event listener for stacked vs overlay toggle
    const stackedSelect = document.getElementById("ot_stacked");
    if (stackedSelect) {
        stackedSelect.addEventListener("change", () => {
            USE_STACKED = (stackedSelect as HTMLSelectElement).value === "stacked";

            const params = new URLSearchParams(window.location.search);
            setUrlParam(params, "stacked", String(USE_STACKED), "true");
            const query = params.toString();
            window.history.pushState({}, "", window.location.pathname + (query ? "?" + query : ""));

            const selected_dandiset = (document.getElementById("dandiset_selector") as HTMLSelectElement | null)?.value ?? "";
            load_over_time_plot(selected_dandiset);
        });
    }

    // Add event listener for histogram plot type toggle (bar vs line)
    const histPlotTypeSelect = document.getElementById("hist_plot_type");
    if (histPlotTypeSelect) {
        histPlotTypeSelect.addEventListener("change", () => {
            USE_HIST_LINE_PLOT = (histPlotTypeSelect as HTMLSelectElement).value === "line";

            const params = new URLSearchParams(window.location.search);
            setUrlParam(params, "hist_plot_type", (histPlotTypeSelect as HTMLSelectElement).value, "bar");
            const query = params.toString();
            window.history.pushState({}, "", window.location.pathname + (query ? "?" + query : ""));

            const selected_dandiset = (document.getElementById("dandiset_selector") as HTMLSelectElement | null)?.value ?? "";
            load_histogram(selected_dandiset);
        });
    }

    // Add event listener for binary/decimal toggle
    const prefix_selector = document.getElementById("prefix");
    if (prefix_selector) {
        prefix_selector.addEventListener("change", () => {
            USE_BINARY = (prefix_selector as HTMLSelectElement).value === "binary";

            const params = new URLSearchParams(window.location.search);
            setUrlParam(params, "prefix", (prefix_selector as HTMLSelectElement).value, "decimal");
            const query = params.toString();
            window.history.pushState({}, "", window.location.pathname + (query ? "?" + query : ""));

            // Get the current dandiset ID
            const dandiset_selector = document.getElementById("dandiset_selector") as HTMLSelectElement | null;
            const selected_dandiset = dandiset_selector?.value ?? "";

            // Reload plots with the current dandiset ID
            update_totals(selected_dandiset);
            load_over_time_plot(selected_dandiset);
            load_histogram(selected_dandiset);
            load_aws_histogram(selected_dandiset);
            load_geographic_heatmap(selected_dandiset);
        });
    }

    // Add event listener for over-time view radio toggle (Plot vs Table)
    const overTimeViewRadios = document.querySelectorAll('input[name="over_time_view"]');
    overTimeViewRadios.forEach((radio) => {
        radio.addEventListener("change", () => {
            USE_OVER_TIME_TABLE = (radio as HTMLInputElement).value === "table";

            const params = new URLSearchParams(window.location.search);
            setUrlParam(params, "over_time", (radio as HTMLInputElement).value, "plot");
            const query = params.toString();
            window.history.pushState({}, "", window.location.pathname + (query ? "?" + query : ""));

            apply_view_mode("over_time_plot", "over_time_table", USE_OVER_TIME_TABLE);
            resize_plot("over_time_plot");
            apply_over_time_group_by_visibility();
            apply_over_time_metric_visibility();
        });
    });

    // Add event listener for the over-time metric selector
    const otMetricSelect = document.getElementById("over_time_metric");
    if (otMetricSelect) {
        otMetricSelect.addEventListener("change", () => {
            OVER_TIME_METRIC = (otMetricSelect as HTMLSelectElement).value;

            const params = new URLSearchParams(window.location.search);
            setUrlParam(params, "ot_metric", OVER_TIME_METRIC, "bytes");
            const query = params.toString();
            window.history.pushState({}, "", window.location.pathname + (query ? "?" + query : ""));

            const selected_dandiset = (document.getElementById("dandiset_selector") as HTMLSelectElement | null)?.value ?? "";
            load_over_time_plot(selected_dandiset);
        });
    }

    // Add event listener for histogram view radio toggle (Plot vs Table)
    const histogramViewRadios = document.querySelectorAll('input[name="histogram_view"]');
    histogramViewRadios.forEach((radio) => {
        radio.addEventListener("change", () => {
            USE_HISTOGRAM_TABLE = (radio as HTMLInputElement).value === "table";

            const params = new URLSearchParams(window.location.search);
            setUrlParam(params, "histogram", (radio as HTMLInputElement).value, "plot");
            const query = params.toString();
            window.history.pushState({}, "", window.location.pathname + (query ? "?" + query : ""));

            apply_view_mode("histogram_plot", "histogram_table", USE_HISTOGRAM_TABLE);
            resize_plot("histogram_plot");
            apply_histogram_metric_visibility();
        });
    });

    // Add event listener for the histogram metric selector
    const histMetricSelect = document.getElementById("histogram_metric");
    if (histMetricSelect) {
        histMetricSelect.addEventListener("change", () => {
            HISTOGRAM_METRIC = (histMetricSelect as HTMLSelectElement).value;

            const params = new URLSearchParams(window.location.search);
            setUrlParam(params, "hist_metric", HISTOGRAM_METRIC, default_histogram_metric(histogram_shows_dandisets()));
            const query = params.toString();
            window.history.pushState({}, "", window.location.pathname + (query ? "?" + query : ""));

            const selected_dandiset = (document.getElementById("dandiset_selector") as HTMLSelectElement | null)?.value ?? "";
            load_histogram(selected_dandiset);
        });
    }

    // Add event listener for the "Ignore testing datasets" checkbox
    const ignoreTestingCheckbox = document.getElementById("ignore_testing_dandisets");
    if (ignoreTestingCheckbox) {
        ignoreTestingCheckbox.addEventListener("change", () => {
            IGNORE_TESTING_DANDISETS = (ignoreTestingCheckbox as HTMLInputElement).checked;

            const params = new URLSearchParams(window.location.search);
            setUrlParam(params, "ignore_testing", String(IGNORE_TESTING_DANDISETS), "true");
            const query = params.toString();
            window.history.pushState({}, "", window.location.pathname + (query ? "?" + query : ""));

            const selected_dandiset = (document.getElementById("dandiset_selector") as HTMLSelectElement | null)?.value ?? "";
            load_histogram(selected_dandiset);
        });
    }

    // Add event listener for time aggregation radio toggle (Daily / Weekly / Monthly / Yearly)
    const timeAggregationRadios = document.querySelectorAll('input[name="time_aggregation"]');
    timeAggregationRadios.forEach((radio) => {
        radio.addEventListener("change", () => {
            TIME_AGGREGATION = (radio as HTMLInputElement).value;

            const params = new URLSearchParams(window.location.search);
            setUrlParam(params, "aggregation", TIME_AGGREGATION, "daily");
            const query = params.toString();
            window.history.pushState({}, "", window.location.pathname + (query ? "?" + query : ""));

            const selected_dandiset = (document.getElementById("dandiset_selector") as HTMLSelectElement | null)?.value ?? "";
            load_over_time_plot(selected_dandiset);
        });
    });

    // Add event listener for the single geo view toggle (Regions / Dots / Table / AWS)
    const geoViewRadios = document.querySelectorAll('input[name="geo_view"]');
    geoViewRadios.forEach((radio) => {
        radio.addEventListener("change", () => {
            GEO_VIEW = (radio as HTMLInputElement).value;

            const params = new URLSearchParams(window.location.search);
            setUrlParam(params, "map", GEO_VIEW, "regions");
            const query = params.toString();
            window.history.pushState({}, "", window.location.pathname + (query ? "?" + query : ""));

            apply_geo_view_mode(GEO_VIEW);

            const selected_dandiset = (document.getElementById("dandiset_selector") as HTMLSelectElement | null)?.value ?? "";
            // Re-render the map only when a map mode is selected
            if (GEO_VIEW === "regions" || GEO_VIEW === "points") {
                load_geographic_heatmap(selected_dandiset);
            }
        });
    });

    // Add event listener for over-time group-by selector
    const groupBySelector = document.getElementById("over_time_group_by");
    if (groupBySelector) {
        groupBySelector.addEventListener("change", () => {
            OVER_TIME_GROUP_BY = (groupBySelector as HTMLSelectElement).value;
            apply_daily_aggregation_restriction();
            apply_over_time_metric_visibility();

            const params = new URLSearchParams(window.location.search);
            setUrlParam(params, "group_by", OVER_TIME_GROUP_BY, "none");
            setUrlParam(params, "aggregation", TIME_AGGREGATION, "daily");
            setUrlParam(params, "ot_metric", OVER_TIME_METRIC, "bytes");
            const query = params.toString();
            window.history.pushState({}, "", window.location.pathname + (query ? "?" + query : ""));

            const selected_dandiset = (document.getElementById("dandiset_selector") as HTMLSelectElement | null)?.value ?? "";
            load_over_time_plot(selected_dandiset);
        });
    }

    // Add event listener for top-N dandisets setting
    const topNInput = document.getElementById("top_n_dandisets");
    if (topNInput) {
        topNInput.addEventListener("change", () => {
            const val = parseInt((topNInput as HTMLInputElement).value, 10);
            TOP_N_DANDISETS = (!isNaN(val) && val >= 1) ? val : 8;
            (topNInput as HTMLInputElement).value = String(TOP_N_DANDISETS);

            const params = new URLSearchParams(window.location.search);
            setUrlParam(params, "top_n", String(TOP_N_DANDISETS), "8");
            const query = params.toString();
            window.history.pushState({}, "", window.location.pathname + (query ? "?" + query : ""));

            if (OVER_TIME_GROUP_BY === "dandisets") {
                const selected_dandiset = (document.getElementById("dandiset_selector") as HTMLSelectElement | null)?.value ?? "";
                load_over_time_plot(selected_dandiset);
            }
        });
    }
});

// Add an event listener for window resize
window.addEventListener("resize", resizePlots);

/**
 * Re-sizes a rendered Plotly graph to its container, doing nothing when the
 * graph is absent, empty, or hidden — Plotly throws on a hidden div, which has
 * no width to size to.  Used both on window resize and when a plot is shown
 * again, since one drawn while hidden falls back to Plotly's default size.
 */
function resize_plot(plot_id: string): void {
    const el = document.getElementById(plot_id) as Plotly.PlotlyHTMLElement | null;
    if (el && (el as any).data && el.offsetParent !== null) {
        Plotly.Plots.resize(el);
    }
}

function resizePlots() {
    const plotIds = ["over_time_plot", "histogram_plot", "aws_histogram", "geography_heatmap"];
    plotIds.forEach(resize_plot);

    // Update min zoom for the choroplethmap based on new width
    const mapEl = document.getElementById("geography_heatmap") as Plotly.PlotlyHTMLElement | null;
    if (mapEl && GEO_VIEW === "regions" && (mapEl as any)._fullLayout && (mapEl as any)._fullLayout.map && (mapEl as any)._fullLayout.map._subplot) {
        const mapWidth = mapEl.offsetWidth;
        const defaultZoom = Math.max(1, Math.log2(mapWidth / 512));
        const minZoom = defaultZoom - 0.15;
        const map = (mapEl as any)._fullLayout.map._subplot.map;
        if (map && map.setMinZoom) {
            map.setMinZoom(minZoom);
        }
    }
}



fetchWithRetry(REGION_CODES_TO_LATITUDE_LONGITUDE_URL)
    .then((response) => response.text())
    .then((data) => {
        REGION_CODES_TO_LATITUDE_LONGITUDE = loadYaml(data) as Record<string, { latitude: number; longitude: number }>;
    })
    .catch((error) => {
        console.error("Error loading YAML file:", error);
    });

// Both archive totals and dandiset totals are fetched in parallel, but the dropdown
// and initial plots are only rendered once BOTH have resolved. This prevents a race
// condition where update_totals("archive") is called before ALL_DANDISET_TOTALS["archive"]
// has been populated.
const archiveTotalsPromise = fetchWithRetry(ARCHIVE_TOTALS_URL)
    .then((response) => response.text())
    .then((archive_totals_text) => {
        ALL_DANDISET_TOTALS["archive"] = JSON.parse(archive_totals_text);
    })
    .catch((error) => {
        console.error("Error:", error);

        const totals_element = document.getElementById("totals");
        if (totals_element) {
            totals_element.innerText = "Failed to load data for archive totals.";
        }
    });

const allDandisetTotalsPromise = fetchWithRetry(ALL_DANDISET_TOTALS_URL)
    .then((response) => response.text())
    .then((all_dandiset_totals_text) => {
        Object.assign(ALL_DANDISET_TOTALS, JSON.parse(all_dandiset_totals_text));
    })
    .catch((error) => {
        console.error("Error:", error);
        throw error; // Propagate so Promise.all rejects and its .catch() renders the error message
    });

// Dandiset titles are cosmetic (ID displays fall back to the bare ID when
// missing), so a failure here is logged but does not block the rest of the page.
const dandisetTitlesPromise = fetchWithRetry(DANDISET_ID_TO_TITLE_URL)
    .then((response) => response.text())
    .then((dandiset_titles_text) => {
        Object.assign(DANDISET_TITLES, parse_dandiset_titles_jsonl(dandiset_titles_text));
    })
    .catch((error) => {
        console.error("Error loading dandiset titles:", error);
    });

// Asset counts and stored sizes are only the denominators of the scaled metrics
// in the per-Dandiset table, which fall back to "--" when unavailable, so a
// failure here is logged but does not block the rest of the page.
const dandisetAssetCountsPromise = fetch_maybe_gzipped_text(DANDISET_ID_TO_NUMBER_OF_ASSETS_URL)
    .then((asset_counts_text) => {
        Object.assign(DANDISET_ASSET_COUNTS, parse_dandiset_numbers_jsonl(asset_counts_text));
    })
    .catch((error) => {
        console.error("Error loading dandiset asset counts:", error);
    });

const dandisetTotalSizesPromise = fetch_maybe_gzipped_text(DANDISET_ID_TO_TOTAL_SIZE_URL)
    .then((total_sizes_text) => {
        Object.assign(DANDISET_TOTAL_SIZES, parse_dandiset_numbers_jsonl(total_sizes_text));
    })
    .catch((error) => {
        console.error("Error loading dandiset total sizes:", error);
    });

// Populate the dropdown with IDs and render initial plots only after both fetches complete
Promise.all([
    archiveTotalsPromise,
    allDandisetTotalsPromise,
    dandisetTitlesPromise,
    dandisetAssetCountsPromise,
    dandisetTotalSizesPromise,
])
    .then(() => {
        // Re-sync from URL here as a safety net: if DOMContentLoaded fired
        // before the data was ready, the global state is already correct, but
        // if (in edge cases such as Service Worker caching) the fetch resolved
        // before DOMContentLoaded, this call ensures the URL-driven settings
        // are applied before any plot is rendered for the first time.
        syncFromUrl();

        let dandiset_ids = Object.keys(ALL_DANDISET_TOTALS);
        dandiset_ids.sort((a, b) => {
            if (a === "archive") return -1;
            if (b === "archive") return 1;
            // Compare as numbers if both are numeric
            const aNum = Number(a);
            const bNum = Number(b);
            if (!isNaN(aNum) && !isNaN(bNum)) {
                return aNum - bNum;
            }
            // Fallback to string comparison
            return a.localeCompare(b);
        });

        const selector = document.getElementById("dandiset_selector") as HTMLSelectElement | null;

        if (!selector) {
            throw new Error("Dropdown element not found on main page.");
        }

        dandiset_ids.forEach((id) => {
            const option = document.createElement("option");
            option.value = id;
            option.textContent = format_dandiset_label(id, DANDISET_TITLES);
            selector.appendChild(option);
        });

        // Normalize a raw dandiset ID to a valid selection, falling back to "archive"
        const validateDandisetId = (raw: string | null) => (raw && dandiset_ids.includes(raw) ? raw : "archive");

        // Update the selector and reload all plots/totals for the given dandiset ID
        const setSelectedDandiset = (rawId: string | null) => {
            const id = validateDandisetId(rawId);
            selector.value = id;
            apply_over_time_group_by_visibility();
            apply_over_time_metric_visibility();
            apply_ignore_testing_visibility();
            apply_histogram_metric_visibility();
            update_dandiset_data_link(id);
            update_totals(id);
            return [
                load_over_time_plot(id),
                load_histogram(id),
                load_aws_histogram(id),
                load_geographic_heatmap(id),
            ];
        };

        // Check URL for a dandiset parameter and load initial plots
        const urlParams = new URLSearchParams(window.location.search);
        const initialHash = window.location.hash;
        const initialPromises = setSelectedDandiset(urlParams.get("dandiset"));

        // Once all initial plots have rendered, re-scroll to the URL hash anchor so
        // that async data loading (which expands the page) doesn't leave the user at
        // the wrong scroll position.  Use allSettled so the scroll still happens even
        // if one or more plots fail to load.
        if (initialHash) {
            Promise.allSettled(initialPromises.map(p => (p instanceof Promise ? p : Promise.resolve()))).then(() => {
                const target = document.querySelector(initialHash);
                if (target) target.scrollIntoView({ behavior: "instant" });
            });
        }

        // Update the plots and URL when a new Dandiset ID is selected
        selector.addEventListener("change", (event) => {
            const id = (event.target as HTMLSelectElement).value;
            // Applied before the URL is written, since the selection decides
            // which metrics the histogram offers and which of them is its
            // default — both of which the "hist_metric" parameter is relative to.
            setSelectedDandiset(id);

            const params = new URLSearchParams(window.location.search);
            if (id === "archive") {
                params.delete("dandiset");
            } else {
                params.set("dandiset", id);
            }
            setUrlParam(params, "hist_metric", HISTOGRAM_METRIC, default_histogram_metric(id === "archive"));
            const query = params.toString();
            const newUrl = window.location.pathname + (query ? "?" + query : "");
            window.history.pushState({}, "", newUrl);
        });

        // Handle browser back/forward navigation
        window.addEventListener("popstate", () => {
            const params = new URLSearchParams(window.location.search);
            syncFromUrl();
            setSelectedDandiset(params.get("dandiset"));
        });
    })
    .catch((error) => {
        console.error("Error:", error);

        // Only overlay error message over first plot element
        const over_time_plot_element = document.getElementById("over_time_plot");
        if (over_time_plot_element) {
            over_time_plot_element.innerText = "Failed to load Dandiset IDs and populate default plots.";
        }
    });

// Points the source-data link beside the Dandiset selector at the GitHub
// folder containing all summary tables for the current selection.
function update_dandiset_data_link(dandiset_id: string) {
    const link = document.getElementById("dandiset_data_link") as HTMLAnchorElement | null;
    if (!link) return;
    const { folder } = derive_data_source_urls(`${BASE_TSV_URL}/${dandiset_id}/by_day.tsv`);
    if (folder) link.href = folder;
    const selection = dandiset_id === "archive" ? "the entire archive" : dandiset_id;
    const label = `Source data tables for ${selection} on GitHub`;
    link.title = label;
    link.setAttribute("aria-label", label);
}

// Function to display scalar totals
function update_totals(dandiset_id: string) {
    const totals_element_id = "totals";
    const totals_element = document.getElementById(totals_element_id);
    const totals = ALL_DANDISET_TOTALS[dandiset_id];  // Include 'archive' as a special key

    try {
        const format_metric = (value: number | string | undefined) =>
            typeof value === "number" ? value.toLocaleString() : String(value ?? "--");
        const selection =
            dandiset_id === "archive" ? "the entire archive"
            : dandiset_id === "undetermined" ? "undetermined usage"
            : `Dandiset ${dandiset_id}`;
        render_totals_summary(totals_element_id, {
            caption: `Totals for ${selection}`,
            caption_tooltip:
                "Dandiset source determination is heuristic and may change over time. " +
                "Activity that cannot be confidently attributed to a Dandiset or any other field " +
                "is reported as 'undetermined'.",
            metrics: [
                { label: "Transferred", value: format_bytes(totals.total_bytes_sent) },
                { label: "Web requests", value: format_metric(totals.total_number_of_requests) },
                { label: "Full downloads", value: format_metric(totals.total_number_of_downloads) },
                {
                    label: "Views",
                    value: format_metric(totals.total_number_of_views),
                    tooltip: "Streaming sessions per asset, counted separately from full downloads.",
                },
                {
                    label: "Unique visitors",
                    value: format_metric(totals.number_of_requesters),
                    tooltip: "Counted by unique IP address, and so may be skewed by undetermined VPN usage patterns.",
                },
                { label: "Regions", value: format_metric(totals.number_of_unique_regions) },
                { label: "Countries", value: format_metric(totals.number_of_unique_countries) },
            ],
            note: dandiset_id === "undetermined"
                ? "This usage could not be uniquely associated with a particular Dandiset."
                : undefined,
            note_tooltip: dandiset_id === "undetermined"
                ? "The primary cause of this is when an asset is removed from a 'draft' state prior to being made persistent by publication."
                : undefined,
        });
    } catch (error) {
        console.error("Error:", error);
        if (totals_element) {
            totals_element.innerText = "Failed to load totals.";
        }
    }
}

// Abbreviated descriptions shown as tooltip text on legend items when the
// over-time plot is grouped by asset type.
const ASSET_TYPE_DESCRIPTIONS: Record<string, string> = {
    Neurophysiology: "NWB files",
    Microscopy:      "OME-Zarr, NIfTI, TIFF",
    Video:          "AVI, MKV, MP4, MOV, WMV",
    Miscellaneous:      "TXT, TSV, JSON, code, etc.",
};

// Categorical colour palette for the "group by Dandisets" overlay bars.
// Colours include 0.7 alpha so overlapping bars remain visible.
const DANDISET_BAR_COLORS = [
    "rgba(88,174,192,0.7)",
    "rgba(255,152,0,0.7)",
    "rgba(76,175,80,0.7)",
    "rgba(229,57,53,0.7)",
    "rgba(156,39,176,0.7)",
    "rgba(233,30,99,0.7)",
    "rgba(0,188,212,0.7)",
    "rgba(205,220,57,0.7)",
    "rgba(255,87,34,0.7)",
    "rgba(63,81,181,0.7)",
    "rgba(0,150,136,0.7)",
    "rgba(255,193,7,0.7)",
    "rgba(96,125,139,0.7)",
    "rgba(33,150,243,0.7)",
    "rgba(139,195,74,0.7)",
    "rgba(171,71,188,0.7)",
    "rgba(121,85,72,0.7)",
    "rgba(0,230,118,0.7)",
    "rgba(244,67,54,0.7)",
    "rgba(3,169,244,0.7)",
];

/**
 * Adds SVG <title> tooltip elements to Plotly legend items whose display name
 * appears in `label_to_tooltip`.  Attaches to the plotly_afterplot event so
 * tooltips survive redraws (theme switches, resizes, trace toggles, etc.).
 *
 * @param plot_element_id - ID of the Plotly graph div.
 * @param label_to_tooltip - Map of legend label → tooltip string.
 */
function attach_legend_tooltips(plot_element_id: string, label_to_tooltip: Record<string, string>): void {
    const el = document.getElementById(plot_element_id);
    if (!el) return;

    function inject_titles() {
        el!.querySelectorAll(".legendtext").forEach((text_el) => {
            const desc = label_to_tooltip[text_el.textContent!];
            if (!desc) return;
            const group = text_el.closest(".traces");
            if (!group) return;
            // Replace any stale title so re-renders always have the correct text.
            const existing = group.querySelector("title");
            if (existing) existing.remove();
            const title_el = document.createElementNS("http://www.w3.org/2000/svg", "title");
            title_el.textContent = desc;
            group.appendChild(title_el);
        });
    }

    inject_titles();
    // `el.on()` is Plotly's own event-emitter API (added to the graph div by
    // Plotly.newPlot); it is the documented way to subscribe to plotly_* events.
    (el as Plotly.PlotlyHTMLElement).on("plotly_afterplot", inject_titles);
}

/**
 * Returns the largest value the y-axis has to accommodate, which sets the unit
 * the plot is effectively drawn in: the per-x stacked total when traces are
 * stacked on top of one another, otherwise the largest single trace value.
 */
function peak_plotted_value(traces: Array<{ x: unknown; y: unknown }>, stacked: boolean): number {
    const series = traces.map((t) => ({ x: t.x as string[], y: t.y as number[] }));
    if (series.length === 0) return 0;
    if (!stacked) {
        return series.reduce((max, s) => s.y.reduce((m, v) => (v > m ? v : m), max), 0);
    }
    const totals = new Map<string, number>();
    series.forEach((s) => s.x.forEach((x, i) => totals.set(x, (totals.get(x) ?? 0) + (s.y[i] || 0))));
    return Array.from(totals.values()).reduce((m, v) => (v > m ? v : m), 0);
}

/**
 * Builds the over-time plot's title, naming the unit the y-axis is effectively
 * in (e.g. "TB per day", or "Views per day" when views are plotted) rather than
 * the generic "Usage".  `peak_value` is the largest plotted value, which
 * determines that unit for the byte metric.
 */
function build_over_time_title(aggregation: string, peak_value: number): string {
    const bin_suffixes: Record<string, string> = {
        daily:   "per day",
        weekly:  "per week",
        monthly: "per month",
        yearly:  "per year",
    };
    return `${metric_unit_label(OVER_TIME_METRIC, peak_value, USE_BINARY)} ${bin_suffixes[aggregation]}`;
}

/**
 * Builds the shared layout options used by both single-series and grouped
 * over-time plots.  `peak_value` is the largest plotted value; it names the
 * unit in the title (see build_over_time_title).
 */
function build_over_time_layout(dates: string[], peak_value: number): Partial<Plotly.Layout> {
    const tick_formats: Record<string, string> = {
        daily:   "%Y-%m-%d",
        weekly:  "%Y-%m-%d",
        monthly: "%Y-%m",
        yearly:  "%Y",
    };

    const layout = applyTheme({
        bargap: 0,
        title: {
            text: USE_CUMULATIVE
                ? `Total ${metric_unit_label(OVER_TIME_METRIC, peak_value, USE_BINARY)} to date`
                : build_over_time_title(TIME_AGGREGATION, peak_value),
            font: { size: 24 }
        },
        xaxis: {
            tickformat: tick_formats[TIME_AGGREGATION],
        },
        yaxis: build_metric_yaxis(OVER_TIME_METRIC, "s"),
    });

    // For cumulative views, remove range gaps so the display is continuous
    if (USE_CUMULATIVE && dates.length > 0) {
        if (TIME_AGGREGATION === "daily") {
            const date_set = new Set(dates);
            const date_objects = dates.map(d => new Date(d + "T00:00:00Z"));
            const min_date = new Date(Math.min(...date_objects.map(d => d.getTime())));
            const max_date = new Date(Math.max(...date_objects.map(d => d.getTime())));
            const all_dates: string[] = [];
            for (let d = new Date(min_date); d <= max_date; d.setDate(d.getDate() + 1)) {
                all_dates.push(d.toISOString().slice(0, 10));
            }
            if (layout.xaxis) (layout.xaxis as any).rangebreaks = [{ values: all_dates.filter(d => !date_set.has(d)) }];
        } else if (TIME_AGGREGATION === "weekly") {
            // dates are "YYYY-MM-DD" (Mondays); keep only those, remove all other days
            const week_set = new Set(dates);
            const date_objects = dates.map(d => new Date(d + "T00:00:00Z"));
            const min_date = new Date(Math.min(...date_objects.map(d => d.getTime())));
            const max_date = new Date(Math.max(...date_objects.map(d => d.getTime())));
            // Extend to end of last week (Sunday)
            const end_date = new Date(max_date);
            end_date.setUTCDate(end_date.getUTCDate() + 6);
            const all_days: string[] = [];
            for (let d = new Date(min_date); d <= end_date; d.setUTCDate(d.getUTCDate() + 1)) {
                all_days.push(d.toISOString().slice(0, 10));
            }
            if (layout.xaxis) (layout.xaxis as any).rangebreaks = [{ values: all_days.filter(d => !week_set.has(d)) }];
        } else if (TIME_AGGREGATION === "monthly") {
            // dates are "YYYY-MM" (month bin keys); map to "YYYY-MM-01" for Date operations
            const month_starts = new Set(dates.map(d => d + "-01"));
            const date_objects = dates.map(d => new Date(d + "-01T00:00:00Z"));
            const min_date = new Date(Math.min(...date_objects.map(d => d.getTime())));
            const max_date = new Date(Math.max(...date_objects.map(d => d.getTime())));
            // Extend to last day of the final month
            const end_date = new Date(max_date);
            end_date.setUTCMonth(end_date.getUTCMonth() + 1);
            end_date.setUTCDate(0);
            const all_days: string[] = [];
            for (let d = new Date(min_date); d <= end_date; d.setUTCDate(d.getUTCDate() + 1)) {
                all_days.push(d.toISOString().slice(0, 10));
            }
            if (layout.xaxis) (layout.xaxis as any).rangebreaks = [{ values: all_days.filter(d => !month_starts.has(d)) }];
        }
    }

    return layout;
}

// Function to fetch and render the over time for a given Dandiset ID
function load_over_time_plot(dandiset_id: string): Promise<void> {
    const plot_element_id = "over_time_plot";

    // Clear any locked height from the previous dandiset to avoid a stale gap
    const over_time_el = document.getElementById(plot_element_id);
    const section_el = (over_time_el && over_time_el.closest('.view-section')) as HTMLElement | null;
    if (section_el) section_el.style.minHeight = "";

    // ── Grouped mode: overlay asset types ────────────────────────────────────
    if (OVER_TIME_GROUP_BY === "asset_type") {
        const tsv_url = `${BASE_TSV_URL}/${dandiset_id}/by_asset_type_per_week.tsv`;
        const archive_tsv_url = `${BASE_TSV_URL}/${dandiset_id}/by_day.tsv`;

        const asset_type_promise = fetch(tsv_url)
            .then((r) => {
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return r.text();
            });
        const archive_promise = fetch(archive_tsv_url)
            .then((r) => r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))
            .then((text) => parse_by_day_tsv(text))
            .catch(() => null);

        return Promise.all([asset_type_promise, archive_promise])
            .then(([text, archive_data]) => {
                const { dates: raw_dates, asset_types, series_map } = parse_by_asset_type_per_week_tsv(text);

                // Data is weekly; treat "daily" aggregation as weekly since no finer data exists
                const effective_aggregation = TIME_AGGREGATION === "daily" ? "weekly" : TIME_AGGREGATION;

                const bin_label_prefix: Record<string, string> = {
                    weekly: "Week of ", monthly: "Month: ", yearly: "Year: ",
                };

                const all_dates_for_layout: string[] = [];

                const plot_info = asset_types.map((type, i) => {
                    const raw_bytes = series_map.get(type) ?? [];
                    const agg = aggregate_by_timebin(raw_dates, raw_bytes, effective_aggregation);
                    const plot_data = USE_CUMULATIVE ? make_cumulative(agg.bytes_sent) : agg.bytes_sent;
                    const human_readable = plot_data.map((b) => format_bytes(b));
                    const color = DANDISET_BAR_COLORS[i % DANDISET_BAR_COLORS.length];
                    all_dates_for_layout.push(...agg.dates);
                    return {
                        ...(USE_OT_LINE_PLOT
                            ? {
                                type: "scatter", mode: "lines", line: { color },
                                ...(USE_STACKED
                                    ? { stackgroup: "one" }
                                    : { fill: "tozeroy", fillcolor: color_with_alpha(color, 0.2) }),
                            }
                            : { type: "bar", marker: { color } }),
                        name: type,
                        x: agg.dates,
                        y: plot_data,
                        text: agg.dates.map((date, idx) =>
                            `${type}<br>${bin_label_prefix[effective_aggregation]}${date}<br>${human_readable[idx]}`
                        ),
                        textposition: "none",
                        hoverinfo: "text",
                    };
                });

                // Build an "Other" series: archive total minus the sum of all asset types
                if (archive_data) {
                    const archive_agg = aggregate_by_timebin(archive_data.dates, archive_data.bytes, effective_aggregation);
                    const archive_plot_data = USE_CUMULATIVE
                        ? make_cumulative(archive_agg.bytes_sent)
                        : archive_agg.bytes_sent;
                    // Build per-date lookup for the sum of all asset-type series
                    const series_by_date = new Map<string, number>();
                    for (const series of plot_info) {
                        (series.x as string[]).forEach((date, idx) => {
                            series_by_date.set(date, (series_by_date.get(date) || 0) + (series.y as number[])[idx]);
                        });
                    }
                    const other_y = archive_agg.dates.map((date, i) => {
                        const asset_type_total = series_by_date.get(date) || 0;
                        return Math.max(0, archive_plot_data[i] - asset_type_total);
                    });
                    const other_human_readable = other_y.map((b) => format_bytes(b));
                    plot_info.push({
                        ...(USE_OT_LINE_PLOT
                            ? {
                                type: "scatter", mode: "lines", line: { color: "rgba(150,150,150,0.7)" },
                                ...(USE_STACKED
                                    ? { stackgroup: "one" }
                                    : { fill: "tozeroy", fillcolor: "rgba(150,150,150,0.15)" }),
                            }
                            : { type: "bar", marker: { color: "rgba(150,150,150,0.7)" } }),
                        name: "Undetermined file types",
                        x: archive_agg.dates,
                        y: other_y,
                        text: archive_agg.dates.map((date, idx) =>
                            `Undetermined file types<br>${bin_label_prefix[effective_aggregation]}${date}<br>${other_human_readable[idx]}`
                        ),
                        textposition: "none",
                        hoverinfo: "text",
                    });
                    all_dates_for_layout.push(...archive_agg.dates);
                }

                const unique_dates = [...new Set(all_dates_for_layout)].sort();
                const peak_bytes = peak_plotted_value(plot_info, USE_STACKED);
                const layout = build_over_time_layout(unique_dates, peak_bytes);
                if (!USE_OT_LINE_PLOT) layout.barmode = USE_STACKED ? "stack" : "overlay";
                layout.showlegend = true;
                layout.legend = { title: { text: "Asset type" } };

                // Override title for "daily" since we show weekly granularity
                if (!USE_OT_LINE_PLOT && TIME_AGGREGATION === "daily") {
                    if (layout.title && typeof layout.title === 'object') {
                        (layout.title as Partial<Plotly.DataTitle>).text = build_over_time_title("weekly", peak_bytes);
                    }
                }

                Plotly.newPlot(plot_element_id, plot_info as Plotly.Data[], layout, PLOTLY_CONFIG);
                set_plot_source_url(plot_element_id, tsv_url);
                attach_legend_tooltips(plot_element_id, ASSET_TYPE_DESCRIPTIONS);

                // Table: show total bytes per time bin (sum across all asset types)
                const total_bytes = raw_dates.map((_, i) =>
                    asset_types.reduce((sum, type) => sum + ((series_map.get(type) ?? [])[i] || 0), 0)
                );
                const agg_total = aggregate_by_timebin(raw_dates, total_bytes, effective_aggregation);
                const per_bin_titles: Record<string, string> = {
                    weekly: "Usage per week",
                    monthly: "Usage per month", yearly: "Usage per year",
                };
                const date_col_labels: Record<string, string> = {
                    weekly: "Week of", monthly: "Month", yearly: "Year",
                };
                const count_format = (n: number) => n.toLocaleString();
                if (archive_data) {
                    const agg_req = aggregate_by_timebin(archive_data.dates, archive_data.requests, effective_aggregation);
                    const agg_dl = aggregate_by_timebin(archive_data.dates, archive_data.downloads, effective_aggregation);
                    const agg_views = aggregate_by_timebin(archive_data.dates, archive_data.views, effective_aggregation);
                    const req_by_date = new Map(agg_req.dates.map((d, i) => [d, agg_req.bytes_sent[i]]));
                    const dl_by_date = new Map(agg_dl.dates.map((d, i) => [d, agg_dl.bytes_sent[i]]));
                    const views_by_date = new Map(agg_views.dates.map((d, i) => [d, agg_views.bytes_sent[i]]));
                    const combined = agg_total.dates.map((date, i) => ({
                        date,
                        bytes: agg_total.bytes_sent[i],
                        requests: req_by_date.get(date) ?? 0,
                        downloads: dl_by_date.get(date) ?? 0,
                        views: views_by_date.get(date) ?? 0,
                    }));
                    render_sortable_table("over_time_table", per_bin_titles[effective_aggregation], [
                        { label: date_col_labels[effective_aggregation], key: "date", numeric: false },
                        { label: "Bytes", key: "bytes", numeric: true },
                        { label: "Views", key: "views", numeric: true, format_fn: count_format },
                        { label: "Downloads", key: "downloads", numeric: true, format_fn: count_format },
                        { label: "Requests", key: "requests", numeric: true, format_fn: count_format },
                    ], combined, format_bytes, tsv_url);
                } else {
                    const combined = agg_total.dates.map((date, i) => ({ date, bytes: agg_total.bytes_sent[i] }));
                    render_sortable_table("over_time_table", per_bin_titles[effective_aggregation], [
                        { label: date_col_labels[effective_aggregation], key: "date", numeric: false },
                        { label: "Bytes", key: "bytes", numeric: true },
                    ], combined, format_bytes, tsv_url);
                }

                apply_view_mode(plot_element_id, "over_time_table", USE_OVER_TIME_TABLE);
            })
            .catch((error) => {
                console.error("Error in asset type grouped over-time plot:", error);
                const plot_element = document.getElementById(plot_element_id);
                if (plot_element) {
                    plot_element.innerText = "Failed to load data for asset type grouped plot.";
                }
            });
    }

    // ── Grouped mode: overlay top-N dandisets (archive view only) ────────────
    if (OVER_TIME_GROUP_BY === "dandisets" && dandiset_id === "archive") {
        const top_dandiset_ids = Object.entries(ALL_DANDISET_TOTALS)
            .filter(([id]) => id !== "archive" && id !== "undetermined")
            .sort((a, b) => b[1].total_bytes_sent - a[1].total_bytes_sent)
            .slice(0, TOP_N_DANDISETS)
            .map(([id]) => id);

        const bin_label_prefix: Record<string, string> = {
            daily: "", weekly: "Week of ", monthly: "Month: ", yearly: "Year: ",
        };

        const per_series_promises = top_dandiset_ids.map((id) =>
            fetch(`${BASE_TSV_URL}/${id}/by_day.tsv`)
                .then((r) => {
                    if (!r.ok) throw new Error(`HTTP ${r.status}`);
                    return r.text();
                })
                .then((text) => {
                    const { dates: raw_dates, bytes: raw_bytes, requests: raw_requests, downloads: raw_downloads, views: raw_views } = parse_by_day_tsv(text);
                    const agg = aggregate_by_timebin(raw_dates, raw_bytes, TIME_AGGREGATION);
                    const agg_req = aggregate_by_timebin(raw_dates, raw_requests, TIME_AGGREGATION);
                    const agg_dl = aggregate_by_timebin(raw_dates, raw_downloads, TIME_AGGREGATION);
                    const agg_views = aggregate_by_timebin(raw_dates, raw_views, TIME_AGGREGATION);
                    return { id, dates: agg.dates, bytes_sent: agg.bytes_sent, requests: agg_req.bytes_sent, downloads: agg_dl.bytes_sent, views: agg_views.bytes_sent };
                })
                .catch((err) => {
                    console.warn(`Skipping dandiset ${id} in grouped view:`, err);
                    return null;
                })
        );

        // Also fetch the archive's by_day.tsv for the table view
        const archive_tsv_url = `${BASE_TSV_URL}/archive/by_day.tsv`;
        const archive_promise = fetch(archive_tsv_url)
            .then((r) => r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))
            .then((text) => parse_by_day_tsv(text))
            .catch(() => null);

        return Promise.all([Promise.all(per_series_promises), archive_promise])
            .then(([series_results, archive_data]) => {
                const valid_series = series_results.filter((s): s is { id: string; dates: string[]; bytes_sent: number[]; requests: number[]; downloads: number[]; views: number[] } => s !== null);

                // Compute global bin edges: union of all dandiset bins and archive bins.
                // Aligning every series to the same x-axis eliminates gaps between bars
                // that would otherwise appear when dandisets have different date ranges.
                const global_bin_set = new Set(valid_series.flatMap((s) => s.dates));
                let archive_agg: { dates: string[]; bytes_sent: number[] } | null = null;
                let archive_agg_req: { bytes_sent: number[] } | null = null;
                let archive_agg_dl: { bytes_sent: number[] } | null = null;
                let archive_agg_views: { bytes_sent: number[] } | null = null;
                if (archive_data) {
                    archive_agg = aggregate_by_timebin(archive_data.dates, archive_data.bytes, TIME_AGGREGATION);
                    archive_agg_req = aggregate_by_timebin(archive_data.dates, archive_data.requests, TIME_AGGREGATION);
                    archive_agg_dl = aggregate_by_timebin(archive_data.dates, archive_data.downloads, TIME_AGGREGATION);
                    archive_agg_views = aggregate_by_timebin(archive_data.dates, archive_data.views, TIME_AGGREGATION);
                    archive_agg.dates.forEach((d) => global_bin_set.add(d));
                }
                const global_bins = [...global_bin_set].sort();

                // Align every metric of every series to the global bins, so any
                // of them can be plotted and the rest shown in the hover text.
                const align_to_bins = (dates: string[], values: number[]): number[] => {
                    const by_date = new Map(dates.map((d, idx) => [d, values[idx]]));
                    return global_bins.map((k) => by_date.get(k) || 0);
                };
                const display = (values: number[]) => (USE_CUMULATIVE ? make_cumulative(values) : values);
                const aligned_series = valid_series.map((series) => ({
                    id: series.id,
                    metrics: {
                        bytes: align_to_bins(series.dates, series.bytes_sent),
                        views: align_to_bins(series.dates, series.views),
                        downloads: align_to_bins(series.dates, series.downloads),
                        requests: align_to_bins(series.dates, series.requests),
                    } as Record<string, number[]>,
                }));

                const plot_info = aligned_series.map((series, i) => {
                    const color = DANDISET_BAR_COLORS[i % DANDISET_BAR_COLORS.length];
                    const display_metrics: Record<string, number[]> = {
                        bytes: display(series.metrics.bytes),
                        views: display(series.metrics.views),
                        downloads: display(series.metrics.downloads),
                        requests: display(series.metrics.requests),
                    };
                    const plot_data = display_metrics[OVER_TIME_METRIC] ?? display_metrics.bytes;
                    return {
                        ...(USE_OT_LINE_PLOT
                            ? {
                                type: "scatter", mode: "lines", line: { color },
                                ...(USE_STACKED
                                    ? { stackgroup: "one" }
                                    : { fill: "tozeroy", fillcolor: color_with_alpha(color, 0.2) }),
                            }
                            : { type: "bar", marker: { color } }),
                        name: `DANDI:${series.id}`,
                        x: global_bins,
                        y: plot_data,
                        text: global_bins.map((date, idx) =>
                            `DANDI:${format_dandiset_label(series.id, DANDISET_TITLES)}<br>${bin_label_prefix[TIME_AGGREGATION]}${date}` +
                            hover_metric_lines(OVER_TIME_METRIC, {
                                bytes: display_metrics.bytes[idx],
                                views: display_metrics.views[idx],
                                downloads: display_metrics.downloads[idx],
                                requests: display_metrics.requests[idx],
                            })
                        ),
                        textposition: "none",
                        hoverinfo: "text",
                    };
                });

                // Build an "Other" series: archive total minus the sum of all top-N dandisets
                if (archive_agg) {
                    const archive_metrics: Record<string, number[]> = {
                        bytes: align_to_bins(archive_agg.dates, archive_agg.bytes_sent),
                        views: align_to_bins(archive_agg.dates, archive_agg_views!.bytes_sent),
                        downloads: align_to_bins(archive_agg.dates, archive_agg_dl!.bytes_sent),
                        requests: align_to_bins(archive_agg.dates, archive_agg_req!.bytes_sent),
                    };
                    // Every metric of "Other" is the archive total less the sum
                    // of the top-N series, differenced after cumulating when the
                    // cumulative view is on, and never allowed below zero.
                    const display_other_metrics: Record<string, number[]> = {};
                    HOVER_METRIC_ORDER.forEach((metric) => {
                        const archive_values = display(archive_metrics[metric]);
                        const top_n_values = display(
                            global_bins.map((_, i) =>
                                aligned_series.reduce((sum, series) => sum + series.metrics[metric][i], 0)
                            )
                        );
                        display_other_metrics[metric] = global_bins.map((_, i) =>
                            Math.max(0, archive_values[i] - top_n_values[i])
                        );
                    });
                    const other_y = display_other_metrics[OVER_TIME_METRIC] ?? display_other_metrics.bytes;
                    plot_info.push({
                        ...(USE_OT_LINE_PLOT
                            ? {
                                type: "scatter", mode: "lines", line: { color: "rgba(150,150,150,0.7)" },
                                ...(USE_STACKED
                                    ? { stackgroup: "one" }
                                    : { fill: "tozeroy", fillcolor: "rgba(150,150,150,0.15)" }),
                            }
                            : { type: "bar", marker: { color: "rgba(150,150,150,0.7)" } }),
                        name: "Other",
                        x: global_bins,
                        y: other_y,
                        text: global_bins.map((date, idx) =>
                            `Other<br>${bin_label_prefix[TIME_AGGREGATION]}${date}` +
                            hover_metric_lines(OVER_TIME_METRIC, {
                                bytes: display_other_metrics.bytes[idx],
                                views: display_other_metrics.views[idx],
                                downloads: display_other_metrics.downloads[idx],
                                requests: display_other_metrics.requests[idx],
                            })
                        ),
                        textposition: "none",
                        hoverinfo: "text",
                    });
                }

                const layout = build_over_time_layout(global_bins, peak_plotted_value(plot_info, USE_STACKED));
                if (!USE_OT_LINE_PLOT) layout.barmode = USE_STACKED ? "stack" : "overlay";
                layout.legend = { title: { text: "Dandiset" } };

                Plotly.newPlot(plot_element_id, plot_info as Plotly.Data[], layout, PLOTLY_CONFIG);
                set_plot_source_url(plot_element_id, archive_tsv_url);

                // Render archive table view even in grouped mode
                const per_bin_titles: Record<string, string> = {
                    daily: "Usage per day", weekly: "Usage per week",
                    monthly: "Usage per month", yearly: "Usage per year",
                };
                const date_col_labels: Record<string, string> = {
                    daily: "Date", weekly: "Week of", monthly: "Month", yearly: "Year",
                };
                if (archive_data && archive_agg) {
                    const count_format = (n: number) => n.toLocaleString();
                    const combined_days = archive_agg.dates.map((date, i) => ({
                        date,
                        bytes: archive_agg!.bytes_sent[i],
                        requests: archive_agg_req!.bytes_sent[i],
                        downloads: archive_agg_dl!.bytes_sent[i],
                        views: archive_agg_views!.bytes_sent[i],
                    }));
                    render_sortable_table("over_time_table", per_bin_titles[TIME_AGGREGATION], [
                        { label: date_col_labels[TIME_AGGREGATION], key: "date",  numeric: false },
                        { label: "Bytes", key: "bytes", numeric: true },
                        { label: "Views", key: "views", numeric: true, format_fn: count_format },
                        { label: "Downloads", key: "downloads", numeric: true, format_fn: count_format },
                        { label: "Requests", key: "requests", numeric: true, format_fn: count_format },
                    ], combined_days, format_bytes, archive_tsv_url);
                }

                apply_view_mode(plot_element_id, "over_time_table", USE_OVER_TIME_TABLE);
            })
            .catch((error) => {
                console.error("Error in grouped over-time plot:", error);
                const plot_element = document.getElementById(plot_element_id);
                if (plot_element) {
                    plot_element.innerText = "Failed to load data for grouped per day plot.";
                }
            });
    }

    // ── Default single-series mode ────────────────────────────────────────────
    const by_day_summary_tsv_url = `${BASE_TSV_URL}/${dandiset_id}/by_day.tsv`;

    return fetch(by_day_summary_tsv_url)
        .then((response) => {
            if (!response.ok) {
                throw new Error(`Failed to fetch TSV file: ${response.statusText}`);
            }
            return response.text();
        })
        .then((text) => {
            const { dates: raw_dates, bytes: raw_bytes, requests: raw_requests, downloads: raw_downloads, views: raw_views } = parse_by_day_tsv(text);

            // Aggregate raw daily data into the selected time bin
            const aggregated = aggregate_by_timebin(raw_dates, raw_bytes, TIME_AGGREGATION);
            const agg_req = aggregate_by_timebin(raw_dates, raw_requests, TIME_AGGREGATION);
            const agg_dl = aggregate_by_timebin(raw_dates, raw_downloads, TIME_AGGREGATION);
            const agg_views = aggregate_by_timebin(raw_dates, raw_views, TIME_AGGREGATION);
            const dates = aggregated.dates;
            const bytes_sent = aggregated.bytes_sent;
            const requests = agg_req.bytes_sent;
            const downloads = agg_dl.bytes_sent;
            const views = agg_views.bytes_sent;

            // Convert to cumulative if the checkbox is checked
            const display = (values: number[]) => (USE_CUMULATIVE ? make_cumulative(values) : values);
            const plot_metrics: Record<string, number[]> = {
                bytes: display(bytes_sent),
                views: display(views),
                downloads: display(downloads),
                requests: display(requests),
            };
            // The selected metric is what the bars/line show; the others stay in
            // the hover text as context.
            const plot_data = plot_metrics[OVER_TIME_METRIC] ?? plot_metrics.bytes;

            // Build hover label prefix based on the selected aggregation
            const bin_label_prefix: Record<string, string> = {
                daily: "",
                weekly: "Week of ",
                monthly: "Month: ",
                yearly: "Year: ",
            };

            const plot_info = [
                {
                    ...(USE_OT_LINE_PLOT
                        ? { type: "scatter", mode: "lines", line: { color: getTheme().accent }, fill: "tozeroy", fillcolor: color_with_alpha(getTheme().accent, 0.2) }
                        : { type: "bar", marker: { color: getTheme().accent } }),
                    x: dates,
                    y: plot_data,
                    text: dates.map((date, index) =>
                        `${bin_label_prefix[TIME_AGGREGATION]}${date}` +
                        hover_metric_lines(OVER_TIME_METRIC, {
                            bytes: plot_metrics.bytes[index],
                            views: plot_metrics.views[index],
                            downloads: plot_metrics.downloads[index],
                            requests: plot_metrics.requests[index],
                        })
                    ),
                    textposition: "none",
                    hoverinfo: "text",
                }
            ];

            // Table view keeps the generic "Usage" wording: its rows are each
            // formatted to their own unit, so no single unit describes them.
            const per_bin_titles: Record<string, string> = {
                daily:   "Usage per day",
                weekly:  "Usage per week",
                monthly: "Usage per month",
                yearly:  "Usage per year",
            };

            const layout = build_over_time_layout(dates, peak_plotted_value(plot_info, USE_STACKED));

            Plotly.newPlot(plot_element_id, plot_info as Plotly.Data[], layout, PLOTLY_CONFIG);
            set_plot_source_url(plot_element_id, by_day_summary_tsv_url);

            // Render table view (sortable by column header click; default: bytes descending)
            const date_col_labels: Record<string, string> = {
                daily:   "Date",
                weekly:  "Week of",
                monthly: "Month",
                yearly:  "Year",
            };
            const count_format = (n: number) => n.toLocaleString();
            const combined_days = dates.map((date, i) => ({ date, bytes: bytes_sent[i], requests: requests[i], downloads: downloads[i], views: views[i] }));
            render_sortable_table("over_time_table", per_bin_titles[TIME_AGGREGATION], [
                { label: date_col_labels[TIME_AGGREGATION], key: "date",  numeric: false },
                { label: "Bytes", key: "bytes", numeric: true },
                { label: "Views", key: "views", numeric: true, format_fn: count_format },
                { label: "Downloads", key: "downloads", numeric: true, format_fn: count_format },
                { label: "Requests", key: "requests", numeric: true, format_fn: count_format },
            ], combined_days, format_bytes, by_day_summary_tsv_url);

            apply_view_mode(plot_element_id, "over_time_table", USE_OVER_TIME_TABLE);
        })
        .catch((error) => {
            console.error("Error:", error);
            const plot_element = document.getElementById(plot_element_id);
            if (plot_element) {
                plot_element.innerText = "Failed to load data for per day plot.";
            }
        });
}

// Function to fetch and render histogram over asset or Dandiset IDs
function load_histogram(dandiset_id: string): Promise<void> | string {
    let by_asset_summary_tsv_url;
    const controls_el = document.getElementById("histogram");
    const plot_element = document.getElementById("histogram_plot");
    const section_el = (plot_element && plot_element.closest('.view-section')) as HTMLElement | null;

    // Suppress entire histogram section if 'undetermined' is selected (nonsensical there)
    if (dandiset_id === "undetermined") {
        if (plot_element) {
            plot_element.innerText = "";
        }
        if (controls_el) controls_el.style.display = "none";
        if (section_el) {
            section_el.style.minHeight = "";
            section_el.style.display = "none";
        }
        return "";
    }

    if (controls_el) controls_el.style.display = "";
    if (section_el) section_el.style.display = "";
    // Restore whichever of the two views is selected, rather than un-hiding the
    // plot unconditionally: in table view an un-hidden plot pushes the table
    // down for as long as the fetch takes, and the height reserved when the new
    // data arrives would cover the two of them stacked.  This also clears any
    // height locked in for the previous Dandiset.
    apply_view_mode("histogram_plot", "histogram_table", USE_HISTOGRAM_TABLE);

    if (dandiset_id === "archive") {
        return load_dandiset_histogram();
    } else {
        by_asset_summary_tsv_url = `${BASE_TSV_URL}/${dandiset_id}/by_asset.tsv`;
        return load_per_asset_histogram(by_asset_summary_tsv_url);
    }
}

function load_dandiset_histogram(): Promise<void> {
    const plot_element_id = "histogram_plot";

    return fetch(ALL_DANDISET_TOTALS_URL)
    .then((response) => {
        if (!response.ok) {
            throw new Error(`Failed to fetch JSON file: ${response.statusText}`);
        }
        return response.json();
    })
    .then((data) => {
        // Exclude 'archive' and cast IDs to strings; sort by bytes descending
        const combined = Object.keys(data)
            .map(dandiset_id => {
                const raw_id = String(dandiset_id);
                const bytes = data[dandiset_id].total_bytes_sent as number;
                const requests = data[dandiset_id].total_number_of_requests as number;
                const downloads = data[dandiset_id].total_number_of_downloads as number;
                const views = data[dandiset_id].total_number_of_views as number;
                // Denominators of the scaled metrics; missing for Dandisets
                // absent from the content derivatives (such as 'undetermined'),
                // in which case the ratios come out as NaN and render as "--".
                const number_of_assets = DANDISET_ASSET_COUNTS[raw_id] ?? NaN;
                const total_size = DANDISET_TOTAL_SIZES[raw_id] ?? NaN;
                return {
                    raw_id,
                    dandiset_id: format_dandiset_label(raw_id, DANDISET_TITLES),
                    title: DANDISET_TITLES[raw_id] ?? "",
                    bytes,
                    requests,
                    downloads,
                    views,
                    bytes_per_size: scaled_metric(bytes, total_size),
                    views_per_asset: scaled_metric(views, number_of_assets),
                    downloads_per_asset: scaled_metric(downloads, number_of_assets),
                    total_size,
                    number_of_assets,
                };
            })
            .sort((a, b) => b.bytes - a.bytes);

        // "Ignore testing datasets" applies to both views: the Dandisets whose
        // usage is dominated by automated testing of the archive lead most of
        // the metrics, the scaled ones especially, and would otherwise be the
        // tallest bars of a plot the setting claims to have filtered.
        const rows = exclude_testing_dandisets(combined, IGNORE_TESTING_DANDISETS);

        // Exclude 'undetermined' from the plot only (the table retains it),
        // along with any Dandiset that has no value for the plotted metric — a
        // scaled metric whose denominator is unknown has no bar to draw.  Bars
        // are ranked by the metric being plotted, so the tallest always leads.
        const plot_combined = rows
            .filter(item => item.raw_id !== "undetermined")
            .filter(item => isFinite(item[HISTOGRAM_METRIC as keyof typeof item] as number))
            .sort((a, b) =>
                (b[HISTOGRAM_METRIC as keyof typeof b] as number) - (a[HISTOGRAM_METRIC as keyof typeof a] as number)
            );

        const sorted_dandiset_ids = plot_combined.map(item => item.dandiset_id);

        const plot_data = [
            {
                ...(USE_HIST_LINE_PLOT
                    ? { type: "scatter", mode: "lines", line: { color: getTheme().accent }, fill: "tozeroy", fillcolor: color_with_alpha(getTheme().accent, 0.2) }
                    : { type: "bar", marker: { color: getTheme().accent } }),
                x: sorted_dandiset_ids,
                y: plot_combined.map(item => item[HISTOGRAM_METRIC as keyof typeof item] as number),
                text: plot_combined.map((item) =>
                    `${item.dandiset_id}` +
                    hover_metric_lines(HISTOGRAM_METRIC, {
                        bytes: item.bytes,
                        views: item.views,
                        downloads: item.downloads,
                        requests: item.requests,
                        [HISTOGRAM_METRIC]: item[HISTOGRAM_METRIC as keyof typeof item] as number,
                    })
                ),
                textposition: "none",
                hoverinfo: "text",
            }
        ];

        const layout = applyTheme({
            bargap: 0,
            title: {
                text: histogram_plot_title(HISTOGRAM_METRIC, peak_plotted_value(plot_data, false), "Dandiset", USE_BINARY),
                font: { size: 24 }
            },
            xaxis: {
                title: {
                    text: "(hover over a bar to see the Dandiset)",
                    font: { size: 12 }
                },
                showticklabels: false,
            },
            yaxis: build_metric_yaxis(HISTOGRAM_METRIC),
        });

        Plotly.newPlot(plot_element_id, plot_data as Plotly.Data[], layout, PLOTLY_CONFIG);
        set_plot_source_url(plot_element_id, ALL_DANDISET_TOTALS_URL);

        // Render table view (sortable by column header click; default: bytes descending)
        const count_format = (n: number) => n.toLocaleString();
        // The content columns are unknown for Dandisets missing from the
        // content derivatives, and show "--" there rather than "NaN".
        const optional_count_format = (n: number) => (isFinite(n) ? count_format(n) : "--");
        const optional_bytes_format = (n: number) => (isFinite(n) ? format_bytes(n) : "--");
        render_sortable_table("histogram_table", "Usage per Dandiset", [
            { label: "Dandiset ID", key: "raw_id", numeric: false },
            { label: "Name", key: "title", numeric: false, link_fn: (row) => dandiset_archive_url(row.raw_id) },
            // The scaled metrics lead, since they are what makes Dandisets of
            // very different sizes comparable; the raw totals they are derived
            // from follow.  Each scaled group sits beside its own denominator:
            // the three per-asset rates with "Total Assets", and "Bytes / Size"
            // with the "Total Bytes" and "Total Size" pair that ends the table.
            // "Total Bytes" stays the default sort so the table's initial
            // ordering still matches the plot beside it.  The metric selector
            // lists the plottable ones in this same order; keep
            // PER_DANDISET_METRIC_ORDER in step when these columns change.
            { label: "Views / Asset", key: "views_per_asset", numeric: true, format_fn: format_ratio },
            { label: "Downloads / Asset", key: "downloads_per_asset", numeric: true, format_fn: format_ratio },
            { label: "Total Assets", key: "number_of_assets", numeric: true, format_fn: optional_count_format },
            { label: "Total Views", key: "views", numeric: true, format_fn: count_format },
            { label: "Total Downloads", key: "downloads", numeric: true, format_fn: count_format },
            // Bytes sent sits next to bytes stored, the two being directly
            // comparable, with "Bytes / Size" — their ratio — leading them.
            { label: "Bytes / Size", key: "bytes_per_size", numeric: true, format_fn: format_ratio },
            { label: "Total Bytes", key: "bytes", numeric: true, default_sort: true },
            { label: "Total Size", key: "total_size", numeric: true, format_fn: optional_bytes_format },
        ], rows, format_bytes, ALL_DANDISET_TOTALS_URL);

        apply_view_mode(plot_element_id, "histogram_table", USE_HISTOGRAM_TABLE);
    })
    .catch((error) => {
        console.error("Error:", error);
        const plot_element = document.getElementById(plot_element_id);
        if (plot_element) {
            while (plot_element.firstChild) {
                plot_element.removeChild(plot_element.firstChild);
            }
        }
    });
}

function load_per_asset_histogram(by_asset_summary_tsv_url: string): Promise<void> {
    const plot_element_id = "histogram_plot";

    return fetch(by_asset_summary_tsv_url)
        .then((response) => {
            if (!response.ok) {
                throw new Error(`Failed to fetch TSV file: ${response.statusText}`);
            }
            return response.text();
        })
        .then((text) => {
            const rows = text.split("\n").filter((row) => row.trim() !== "");
            if (rows.length < 2) {
                throw new Error("TSV file does not contain enough data.");
            }

            const data = rows.slice(1).map((row) => row.split("\t"));

            const asset_names = data.map((row) => {
                let suffix, filename;
                suffix = row[0].split(".").at(-1);
                filename = suffix === "nwb" ? row[0].split("/").at(-1) : row[0];

                return filename;
            });
            const bytes_sent = data.map((row) => parseInt(row[1], 10));
            const requests = data.map((row) => parseInt(row[2] || "0", 10));
            const downloads = data.map((row) => parseInt(row[3] || "0", 10));
            const views = data.map((row) => parseInt(row[4] || "0", 10));

            const combined = asset_names.map((name, idx) => ({ name, bytes: bytes_sent[idx], requests: requests[idx], downloads: downloads[idx], views: views[idx] }));

            // Rank the bars by the metric being plotted, so the tallest leads.
            const plot_combined = [...combined].sort(
                (a, b) =>
                    (b[HISTOGRAM_METRIC as keyof typeof b] as number) - (a[HISTOGRAM_METRIC as keyof typeof a] as number)
            );

            // Use sorted arrays in the plot
            const plot_data = [
                {
                    ...(USE_HIST_LINE_PLOT
                        ? { type: "scatter", mode: "lines", line: { color: getTheme().accent }, fill: "tozeroy", fillcolor: color_with_alpha(getTheme().accent, 0.2) }
                        : { type: "bar", marker: { color: getTheme().accent } }),
                    x: plot_combined.map(item => item.name),
                    y: plot_combined.map(item => item[HISTOGRAM_METRIC as keyof typeof item] as number),
                    text: plot_combined.map((item) =>
                        `${item.name}` +
                        hover_metric_lines(HISTOGRAM_METRIC, {
                            bytes: item.bytes,
                            views: item.views,
                            downloads: item.downloads,
                            requests: item.requests,
                        })
                    ),
                    textposition: "none",
                    hoverinfo: "text",
                }
            ];

            const layout = applyTheme({
                bargap: 0,
                title: {
                    text: histogram_plot_title(HISTOGRAM_METRIC, peak_plotted_value(plot_data, false), "asset", USE_BINARY),
                    font: { size: 24 }
                },
                xaxis: {
                    showticklabels: false,
                },
                yaxis: build_metric_yaxis(HISTOGRAM_METRIC),
            });

            Plotly.newPlot(plot_element_id, plot_data as Plotly.Data[], layout, PLOTLY_CONFIG);
            set_plot_source_url(plot_element_id, by_asset_summary_tsv_url);

            // Render table view (sortable by column header click; default: bytes descending)
            const count_format = (n: number) => n.toLocaleString();
            render_sortable_table("histogram_table", "Usage per asset", [
                { label: "Asset", key: "name", numeric: false },
                { label: "Bytes", key: "bytes", numeric: true },
                { label: "Views", key: "views", numeric: true, format_fn: count_format },
                { label: "Downloads", key: "downloads", numeric: true, format_fn: count_format },
                { label: "Requests", key: "requests", numeric: true, format_fn: count_format },
            ], combined, format_bytes, by_asset_summary_tsv_url);

            apply_view_mode(plot_element_id, "histogram_table", USE_HISTOGRAM_TABLE);
        })
        .catch((error) => {
            console.error("Error:", error);
            const plot_element = document.getElementById(plot_element_id);
            if (plot_element) {
                while (plot_element.firstChild) {
                    plot_element.removeChild(plot_element.firstChild);
                }
            }
        });
}

// Function to fetch and render AWS regions as a table
function load_aws_histogram(dandiset_id: string): Promise<void> {
    const element = document.getElementById("aws_histogram");
    if (!element) return Promise.resolve();

    const by_region_summary_tsv_url = `${BASE_TSV_URL}/${dandiset_id}/by_region.tsv`;

    return fetch(by_region_summary_tsv_url)
        .then((response) => {
            if (!response.ok) {
                throw new Error(`Failed to fetch TSV file: ${response.statusText}`);
            }
            return response.text();
        })
        .then((text) => {
            const rows = text.split("\n").filter((row) => row.trim() !== "");
            if (rows.length < 2) {
                element.innerHTML = "";
                return;
            }

            const data = rows.slice(1).map((row) => row.split("\t"));
            const subregion_data: Array<{ name: string; bytes: number; requests: number; downloads: number; views: number }> = [];

            data.forEach((row) => {
                const region = row[0];
                if (!region.startsWith("AWS/")) return;
                const region_clipped = region.replace("AWS/", "");
                const bytes = parseInt(row[1], 10);
                const requests = parseInt(row[2] || "0", 10);
                const downloads = parseInt(row[3] || "0", 10);
                const views = parseInt(row[4] || "0", 10);
                subregion_data.push({ name: region_clipped, bytes, requests, downloads, views });
            });

            subregion_data.sort((a, b) => b.bytes - a.bytes);

            if (subregion_data.length === 0) {
                element.innerHTML = "";
                return;
            }

            const total_bytes = subregion_data.reduce((acc, item) => acc + item.bytes, 0);
            const count_format = (n: number) => n.toLocaleString();

            render_sortable_table("aws_histogram", `${format_bytes(total_bytes)} sent to AWS data centers`, [
                { label: "AWS Region", key: "name", numeric: false },
                { label: "Bytes", key: "bytes", numeric: true },
                { label: "Views", key: "views", numeric: true, format_fn: count_format },
                { label: "Downloads", key: "downloads", numeric: true, format_fn: count_format },
                { label: "Requests", key: "requests", numeric: true, format_fn: count_format },
            ], subregion_data, format_bytes, by_region_summary_tsv_url);
        })
        .catch((error) => {
            console.error("Error:", error);
            if (element) element.innerHTML = "";
        });
}

// Normalize a subdivision name for matching against GeoJSON features
function normalize_region_name(name: string): string {
    if (!name) return "";
    name = name.toLowerCase();
    const prefixes = ["state of ", "province of ", "region of ", "republic of ",
                      "city state ", "county of "];
    for (const prefix of prefixes) {
        if (name.startsWith(prefix)) {
            name = name.slice(prefix.length);
        }
    }
    const suffixes = [" county", " province", " region", " parish",
                      " prefecture", " department", " district",
                      " governorate", " municipality"];
    for (const suffix of suffixes) {
        if (name.endsWith(suffix)) {
            name = name.slice(0, -suffix.length);
        }
    }
    const replacements: Record<string, string> = {
        'á':'a','à':'a','â':'a','ä':'a','ã':'a','ą':'a','ă':'a','ā':'a',
        'é':'e','è':'e','ê':'e','ë':'e','ę':'e','ě':'e','ė':'e','ǝ':'e',
        'í':'i','ì':'i','î':'i','ï':'i','ı':'i','ī':'i',
        'ó':'o','ò':'o','ô':'o','ö':'o','õ':'o','ő':'o','ō':'o',
        'ú':'u','ù':'u','û':'u','ü':'u','ű':'u','ū':'u',
        'ñ':'n','ń':'n','ň':'n',
        'ç':'c','ć':'c','č':'c','ċ':'c',
        'ß':'ss','ş':'s','ș':'s','š':'s','ś':'s',
        'ø':'o','å':'a','æ':'ae',
        'ł':'l','ľ':'l',
        'ý':'y','ÿ':'y',
        'ž':'z','ź':'z','ż':'z',
        'ř':'r','ŕ':'r',
        'ţ':'t','ț':'t','ť':'t',
        'đ':'d','ď':'d',
        'ğ':'g','ħ':'h','ḥ':'h',
        '-':' ','_':' ',"'":"",'\u2019':'','\u2018':'','\u02bc':'',
    };
    for (const [old, repl] of Object.entries(replacements)) {
        name = name.split(old).join(repl);
    }
    return name.trim();
}

// Load TopoJSON and name aliases (cached after first load)
function load_choropleth_data(): Promise<void[]> {
    const promises: Promise<void>[] = [];
    if (!GEOJSON_DATA) {
        promises.push(
            fetch("gadm_admin1_simplified.topojson")
                .then(r => { if (!r.ok) throw new Error("Failed to fetch TopoJSON"); return r.json(); })
                .then((topoData: any) => {
                    const objectName = Object.keys(topoData.objects)[0];
                    GEOJSON_DATA = topojsonFeature(topoData, topoData.objects[objectName]) as unknown as { features: any[] };
                })
        );
    }
    if (!NAME_ALIASES) {
        promises.push(
            fetch("name_aliases.json")
                .then(r => { if (!r.ok) throw new Error("Failed to fetch name aliases"); return r.json(); })
                .then(data => { NAME_ALIASES = data; })
        );
    }
    return Promise.all(promises);
}

// Build lookups from "iso2/name_norm" to feature index for fast matching
function build_geojson_lookup(): { lookup: Record<string, number>; country_lookup: Record<string, Array<[string, number]>> } {
    const lookup: Record<string, number> = {};
    const country_lookup: Record<string, Array<[string, number]>> = {};
    GEOJSON_DATA!.features.forEach((feature, idx) => {
        const iso2 = feature.properties.iso2;
        const name_norm = feature.properties.name_norm;
        if (iso2 && name_norm && name_norm.length > 1) {
            const key = `${iso2}/${name_norm}`;
            lookup[key] = idx;
            if (!country_lookup[iso2]) country_lookup[iso2] = [];
            country_lookup[iso2].push([name_norm, idx]);
        }
    });
    return { lookup, country_lookup };
}

// Country remapping for special cases (e.g., HK → CN/Hong Kong)
const COUNTRY_REMAPPING = {
    'HK': ['CN', 'Hong Kong'],
    'MO': ['CN', 'Macau'],
    'SG': ['SG', null],
    'MK': ['MK', null],
    'XK': ['XK', null],
    'NU': ['NU', null],
    'MQ': ['MQ', null],
    'CW': ['CW', null],
    'MV': ['MV', null],
} as const;

// Match a TSV region key to a GeoJSON feature index
function match_region_to_feature(region: string, lookup: Record<string, number>, country_lookup: Record<string, Array<[string, number]>>): number {
    const parts = region.split("/");
    if (parts.length < 2) return -1;
    let country_code = parts[0];
    if (country_code === "AWS" || country_code === "GCP") return -1;
    let subdivision_name = parts[1];

    // Apply country remapping
    if (country_code in COUNTRY_REMAPPING) {
        const [new_cc, fixed_region] = COUNTRY_REMAPPING[country_code as keyof typeof COUNTRY_REMAPPING];
        if (fixed_region) {
            country_code = new_cc;
            subdivision_name = fixed_region;
        } else {
            return -1; // Aggregate to country level, skip
        }
    }

    const norm_name = normalize_region_name(subdivision_name);

    // Try direct normalized match
    const direct_key = `${country_code}/${norm_name}`;
    if (direct_key in lookup) return lookup[direct_key];

    // Try alias match
    if (NAME_ALIASES && NAME_ALIASES[country_code]) {
        const aliased = NAME_ALIASES[country_code][norm_name];
        if (aliased) {
            const alias_key = `${country_code}/${aliased}`;
            if (alias_key in lookup) return lookup[alias_key];
        }
    }

    // Try partial/substring match as last resort
    if (country_lookup && country_lookup[country_code]) {
        for (const [feat_norm, feat_idx] of country_lookup[country_code]) {
            if (norm_name.length > 3 && (feat_norm.includes(norm_name) || norm_name.includes(feat_norm))) {
                return feat_idx;
            }
        }
    }

    return -1;
}

// Function to populate top regions table from TSV data
function load_top_regions_table(by_region_summary_tsv_url: string): Promise<void> {
    return fetch(by_region_summary_tsv_url)
        .then((response) => {
            if (!response.ok) throw new Error("Failed to fetch TSV");
            return response.text();
        })
        .then((text) => {
            const rows = text.split("\n").filter((row) => row.trim() !== "");
            if (rows.length < 2) {
                const el = document.getElementById("top_regions_table");
                if (el) el.innerHTML = "";
                return;
            }

            const data = rows.slice(1).map((row) => row.split("\t"));

            // Filter out cloud regions, sort by bytes descending
            const regions = data
                .filter((row) => {
                    const cc = row[0].split("/")[0];
                    return cc !== "AWS" && cc !== "GCP";
                })
                .map((row) => ({
                    region: row[0],
                    bytes: parseInt(row[1], 10),
                    requests: parseInt(row[2] || "0", 10),
                    downloads: parseInt(row[3] || "0", 10),
                    views: parseInt(row[4] || "0", 10),
                }));

            if (regions.length === 0) {
                const el = document.getElementById("top_regions_table");
                if (el) el.innerHTML = "";
                return;
            }

            const count_format = (n: number) => n.toLocaleString();
            render_sortable_table("top_regions_table", "Usage per region", [
                { label: "Region", key: "region", numeric: false },
                { label: "Bytes", key: "bytes", numeric: true },
                { label: "Views", key: "views", numeric: true, format_fn: count_format },
                { label: "Downloads", key: "downloads", numeric: true, format_fn: count_format },
                { label: "Requests", key: "requests", numeric: true, format_fn: count_format },
            ], regions, format_bytes, by_region_summary_tsv_url);
        })
        .catch(() => {
            const el = document.getElementById("top_regions_table");
            if (el) el.innerHTML = "";
        });
}

// Function to fetch and render heatmap over geography
function load_geographic_heatmap(dandiset_id: string): Promise<void | void[] | [void, void]> {
    const plot_element_id = "geography_heatmap";
    const by_region_summary_tsv_url = `${BASE_TSV_URL}/${dandiset_id}/by_region.tsv`;

    // Clear any locked height from the previous dandiset before reapplying view mode
    const mapEl = document.getElementById(plot_element_id);
    const section_el = (mapEl && mapEl.closest('.view-section')) as HTMLElement | null;
    if (section_el) section_el.style.minHeight = "";

    const topRegionsPromise = load_top_regions_table(by_region_summary_tsv_url);

    // Apply the current view mode each time geo data reloads
    apply_geo_view_mode(GEO_VIEW);

    if (GEO_VIEW === "regions") {
        return Promise.all([
            topRegionsPromise,
            load_geographic_choropleth(dandiset_id, plot_element_id, by_region_summary_tsv_url),
        ]);
    }

    // Table / AWS view: tables already populated above, nothing more to render
    if (GEO_VIEW !== "points") return topRegionsPromise;

    if (!REGION_CODES_TO_LATITUDE_LONGITUDE) {
        console.error("Region coordinates not loaded");
        const plot_element = document.getElementById(plot_element_id);
        if (plot_element) {
            plot_element.innerText = "Failed to load data for geographic heatmap.";
        }
        return topRegionsPromise;
    }

    const pointsPromise = fetch(by_region_summary_tsv_url)
        .then((response) => {
            if (!response.ok) {
                throw new Error(`Failed to fetch TSV file: ${response.statusText}`);
            }
            return response.text();
        })
        .then((text) => {
            const rows = text.split("\n").filter((row) => row.trim() !== "");
            if (rows.length < 2) {
                throw new Error("TSV file does not contain enough data.");
            }

            const data = rows
                .slice(1)
                .map((row) => row.split("\t"))
                .sort((a, b) => parseInt(a[1], 10) - parseInt(b[1], 10));

            const latitudes: number[] = [];
            const longitudes: number[] = [];
            const bytes_sent: number[] = [];
            const hover_texts: string[] = [];

            data.forEach((row) => {
                const region = row[0];
                const bytes = parseInt(row[1], 10);
                const requests = parseInt(row[2] || "0", 10);
                const downloads = parseInt(row[3] || "0", 10);
                const views = parseInt(row[4] || "0", 10);
                const coordinates = REGION_CODES_TO_LATITUDE_LONGITUDE[region];
                const human_readable_bytes_sent = format_bytes(bytes);

                if (coordinates) {
                    latitudes.push(coordinates.latitude);
                    longitudes.push(coordinates.longitude);
                    bytes_sent.push(bytes);
                    hover_texts.push(
                        `${region}<br>${human_readable_bytes_sent}` +
                        hover_metric("Requests", requests) +
                        hover_metric("Downloads", downloads) +
                        hover_metric("Views", views)
                    );
                }
            });

            const plot_info = [
                {
                    type: "scattergeo",
                    mode: "markers",
                    lat: latitudes,
                    lon: longitudes,
                    marker: {
                        symbol: "circle",
                        size: bytes_sent.map((bytes) => Math.log(bytes) * 0.5),
                        color: bytes_sent.map(bytes => Math.log10(Math.max(1, bytes))),
                        colorscale: "Viridis",
                        colorbar: {
                            title: "Bytes (log scale)",
                            tickvals: [3, 6, 9, 12],
                            ticktext: ["KB", "MB", "GB", "TB"]
                        },
                        opacity: 0.9,
                    },
                    text: hover_texts,
                    textposition: "none",
                    hoverinfo: "text",
                },
            ];

            const layout = applyTheme({
                title: {
                    text: "Usage by region",
                    font: { size: 24 },
                },
                geo: {
                    projection: { type: "equirectangular" },
                    bgcolor: getTheme().surface,
                    lakecolor: getTheme().bg,
                    landcolor: getTheme().border,
                    showocean: true,
                    oceancolor: getTheme().bg,
                    showlakes: true,
                    showland: true,
                    countrycolor: getTheme().border,
                },
            });

            Plotly.newPlot(plot_element_id, plot_info as Plotly.Data[], layout, PLOTLY_CONFIG);
            set_plot_source_url(plot_element_id, by_region_summary_tsv_url);
        })
        .catch((error) => {
            console.error("Error:", error);
            const plot_element = document.getElementById(plot_element_id);
            if (plot_element) {
                plot_element.innerText = "Failed to load data for geographic heatmap.";
            }
        });

    return Promise.all([topRegionsPromise, pointsPromise]);
}

// Function to fetch and render choropleth over geography
function load_geographic_choropleth(dandiset_id: string, plot_element_id: string, by_region_summary_tsv_url: string): Promise<void> {
    return Promise.all([
        load_choropleth_data(),
        fetch(by_region_summary_tsv_url).then(r => {
            if (!r.ok) throw new Error(`Failed to fetch TSV file: ${r.statusText}`);
            return r.text();
        })
    ])
    .then(([, text]) => {
        if (!GEOJSON_DATA) return;

        const rows = text.split("\n").filter((row) => row.trim() !== "");
        if (rows.length < 2) {
            throw new Error("TSV file does not contain enough data.");
        }

        const data = rows.slice(1).map((row) => row.split("\t"));
        const { lookup, country_lookup } = build_geojson_lookup();

        // Accumulate bytes, requests, and downloads per feature
        const feature_bytes = new Array(GEOJSON_DATA.features.length).fill(0);
        const feature_requests = new Array(GEOJSON_DATA.features.length).fill(0);
        const feature_downloads = new Array(GEOJSON_DATA.features.length).fill(0);
        const feature_views = new Array(GEOJSON_DATA.features.length).fill(0);
        data.forEach((row) => {
            const region = row[0];
            const bytes = parseInt(row[1], 10);
            const requests = parseInt(row[2] || "0", 10);
            const downloads = parseInt(row[3] || "0", 10);
            const views = parseInt(row[4] || "0", 10);
            const idx = match_region_to_feature(region, lookup, country_lookup);
            if (idx >= 0) {
                feature_bytes[idx] += bytes;
                feature_requests[idx] += requests;
                feature_downloads[idx] += downloads;
                feature_views[idx] += views;
            }
        });

        // Build a filtered GeoJSON with only features that have data
        // Skip features that cross the dateline (lon span > 300°) as they
        // cause Plotly to fill the entire map width
        const filtered_features: any[] = [];
        const z_values: number[] = [];
        const hover_texts: string[] = [];

        // Skip features that cross the antimeridian (have both very
        // negative and very positive longitudes) as they render incorrectly
        function hasWideLonSpan(feature: any) {
            let minLon = Infinity, maxLon = -Infinity;
            function scanCoords(coords: any) {
                if (typeof coords[0] === "number") {
                    if (coords[0] < minLon) minLon = coords[0];
                    if (coords[0] > maxLon) maxLon = coords[0];
                } else {
                    for (const c of coords) scanCoords(c);
                }
            }
            scanCoords(feature.geometry.coordinates);
            return (maxLon - minLon) > 180;
        }

        feature_bytes.forEach((bytes, idx) => {
            if (bytes > 0) {
                const feature = GEOJSON_DATA!.features[idx];
                if (hasWideLonSpan(feature)) return;
                const name = feature.properties.name;
                const iso2 = feature.properties.iso2;
                filtered_features.push(feature);
                z_values.push(Math.log10(bytes));
                hover_texts.push(
                    `${iso2}/${name}<br>${format_bytes(bytes)}` +
                    hover_metric("Requests", feature_requests[idx]) +
                    hover_metric("Downloads", feature_downloads[idx]) +
                    hover_metric("Views", feature_views[idx])
                );
            }
        });

        const filtered_geojson = {
            type: "FeatureCollection",
            features: filtered_features,
        };

        const locations = filtered_features.map(f => f.properties.id);

        // Compute colorbar ticks based on data range
        const colorbar_config = (function() {
            const allTicks = [3, 6, 9, 12, 15];
            const allLabels = ["KB", "MB", "GB", "TB", "PB"];
            if (z_values.length === 0) return { title: "Bytes (log scale)" };
            const zMin = Math.min(...z_values);
            const zMax = Math.max(...z_values);
            let vals = allTicks.filter(v => v >= zMin - 1 && v <= zMax + 1);
            let texts = vals.map(v => allLabels[allTicks.indexOf(v)]);
            if (vals.length < 2) {
                const lo = Math.floor(zMin);
                const hi = Math.ceil(zMax);
                vals = lo === hi ? [lo, lo + 1] : [lo, hi];
                texts = vals.map(v => {
                    const tickIdx = allTicks.indexOf(v);
                    return tickIdx >= 0 ? allLabels[tickIdx] : "10^" + v;
                });
            }
            return { title: "Bytes (log scale)", tickvals: vals, ticktext: texts };
        })();

        const plot_info = [
                {
                    type: "choroplethmap",
                    geojson: filtered_geojson,
                    featureidkey: "properties.id",
                    locations: locations,
                    z: z_values,
                    text: hover_texts,
                    hoverinfo: "text",
                    colorscale: "YlOrRd",
                    reversescale: true,
                    colorbar: colorbar_config,
                    marker: {
                        line: {
                            color: "white",
                            width: 0.5,
                        },
                        opacity: 0.8,
                    },
                },
            ];

            const mapEl = document.getElementById(plot_element_id);
            const mapWidth = mapEl ? mapEl.offsetWidth : 800;
            const defaultZoom = Math.max(1, Math.log2(mapWidth / 512));
            // Min zoom allows seeing the full earth: at 256px per tile at zoom 0,
            // we need zoom = log2(width / 256) to fill the container once
            const minZoom = defaultZoom - 0.15;

        const layout = applyTheme({
            title: {
                text: "Usage by region",
                font: { size: 24 },
            },
            annotations: [
                {
                    text: 'Geographic boundaries are defined by <a href="https://gadm.org/" target="_blank">GADM v4.1</a> | '
                        + '<a href="https://carto.com/attributions" target="_blank">© CARTO</a> | '
                        + '<a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap contributors</a>',
                    showarrow: false,
                    xref: "paper",
                    yref: "paper",
                    x: 0.01,
                    y: 0.01,
                    xanchor: "left",
                    yanchor: "bottom",
                    font: {
                        size: 10,
                        color: getTheme().textSecondary,
                    },
                    bgcolor: getTheme().annotationBg,
                    borderpad: 3,
                },
            ],
        });
        (layout as any).map = {
            style: getTheme().mapStyle,
            center: { lat: 40, lon: 0 },
            zoom: defaultZoom,
            minzoom: minZoom,
        };

        Plotly.newPlot(plot_element_id, plot_info as Plotly.Data[], layout, PLOTLY_CONFIG).then(() => {
            set_plot_source_url(plot_element_id, by_region_summary_tsv_url);
            const el = document.getElementById(plot_element_id);
            if (el && (el as any)._fullLayout && (el as any)._fullLayout.map && (el as any)._fullLayout.map._subplot) {
                const map = (el as any)._fullLayout.map._subplot.map;
                if (map) {
                    if (map.setMinZoom) map.setMinZoom(minZoom);
                }
            }
        });
    })
    .catch((error) => {
        console.error("Error:", error);
        const plot_element = document.getElementById(plot_element_id);
        if (plot_element) {
            plot_element.innerText = "Failed to load data for geographic choropleth.";
        }
    });
}

// format_bytes delegates to the pure utility, passing the current binary/decimal setting.
function format_bytes(bytes: number, decimals = 2): string {
    return format_bytes_pure(bytes, decimals, USE_BINARY);
}
