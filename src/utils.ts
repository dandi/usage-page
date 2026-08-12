/**
 * Pure utility functions shared across the application.
 * All exports here are side-effect-free and have no DOM or Plotly dependencies,
 * making them straightforward to unit test.
 */

export function setUrlParam(params: URLSearchParams, key: string, value: string, defaultValue: string): void {
    if (value === defaultValue) {
        params.delete(key);
    } else {
        params.set(key, value);
    }
}

export function color_with_alpha(color: string, alpha: number): string {
    const rgba_match = color.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (rgba_match) {
        return `rgba(${rgba_match[1]},${rgba_match[2]},${rgba_match[3]},${alpha})`;
    }
    const hex_match = color.match(/^#([0-9a-fA-F]{6})$/);
    if (hex_match) {
        const r = parseInt(hex_match[1].slice(0, 2), 16);
        const g = parseInt(hex_match[1].slice(2, 4), 16);
        const b = parseInt(hex_match[1].slice(4, 6), 16);
        return `rgba(${r},${g},${b},${alpha})`;
    }
    return color;
}

export function parse_by_day_tsv(text: string): { dates: string[]; bytes: number[]; requests: number[]; downloads: number[]; views: number[] } {
    const rows = text.split("\n").filter((row) => row.trim() !== "");
    if (rows.length < 2) throw new Error("TSV file does not contain enough data.");
    const raw_data = rows.slice(1).map((row) => row.split("\t"));
    return {
        dates: raw_data.map((row) => row[0]),
        bytes: raw_data.map((row) => parseInt(row[1], 10)),
        requests: raw_data.map((row) => parseInt(row[2] || "0", 10)),
        downloads: raw_data.map((row) => parseInt(row[3] || "0", 10)),
        views: raw_data.map((row) => parseInt(row[4] || "0", 10)),
    };
}

export function parse_by_asset_type_per_week_tsv(text: string): { dates: string[]; asset_types: string[]; series_map: Map<string, number[]> } {
    const rows = text.split("\n").filter((row) => row.trim() !== "");
    if (rows.length < 2) throw new Error("TSV file does not contain enough data.");
    const headers = rows[0].split("\t");
    const asset_types = headers.slice(1);
    const data_rows = rows.slice(1).map((row) => row.split("\t"));
    const dates = data_rows.map((row) => row[0]);
    const series_map = new Map<string, number[]>();
    asset_types.forEach((type, col_idx) => {
        series_map.set(type, data_rows.map((row) => parseInt(row[col_idx + 1], 10) || 0));
    });
    return { dates, asset_types, series_map };
}

export function aggregate_by_timebin(dates: string[], bytes_sent: number[], aggregation: string): { dates: string[]; bytes_sent: number[] } {
    if (aggregation === "daily") {
        return { dates, bytes_sent };
    }

    const bin_map = new Map<string, number>();
    dates.forEach((date_str, i) => {
        const date = new Date(date_str + "T00:00:00Z");
        let bin_key;
        if (aggregation === "weekly") {
            // Find the Monday (ISO week start) for this date
            const day_of_week = date.getUTCDay(); // 0 = Sunday, 1 = Monday, ...
            const days_to_monday = day_of_week === 0 ? -6 : 1 - day_of_week;
            const monday = new Date(date);
            monday.setUTCDate(date.getUTCDate() + days_to_monday);
            bin_key = monday.toISOString().slice(0, 10);
        } else if (aggregation === "monthly") {
            bin_key = date_str.slice(0, 7); // "YYYY-MM"
        } else { // "yearly"
            bin_key = date_str.slice(0, 4); // "YYYY"
        }
        bin_map.set(bin_key, (bin_map.get(bin_key) ?? 0) + bytes_sent[i]);
    });

    // ISO strings sort lexicographically, so this preserves chronological order
    const sorted_keys = Array.from(bin_map.keys()).sort();
    return {
        dates: sorted_keys,
        bytes_sent: sorted_keys.map((k) => bin_map.get(k) as number),
    };
}

export function format_bytes(bytes: number, decimals = 2, use_binary = false): string {
    if (bytes === 0) return "0 Bytes";

    const k = use_binary ? 1024 : 1000;
    const sizes = use_binary
        ? ["Bytes", "KiB", "MiB", "GiB", "TiB", "PiB", "EiB", "ZiB", "YiB"]
        : ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    const reduced = parseFloat((bytes / Math.pow(k, i)).toFixed(decimals));

    return `${reduced} ${sizes[i]}`;
}

/**
 * Dandisets whose recorded usage comes overwhelmingly from automated testing
 * of the archive rather than from research use, and which therefore dominate
 * (and distort) the per-Dandiset metrics.  The per-Dandiset table can be told
 * to leave them out.
 */
export const TESTING_DANDISET_IDS = [
    "000025",
    "000027",
    "000029",
    "000064",
    "000068",
    "000126",
    "000144",
    "000299",
    "000411",
    "000470",
    "000544",
    "000717",
    "000719",
    "000937",
    "001083",
];

/**
 * Returns `rows` without the testing Dandisets when `exclude` is true, and
 * unchanged (the same array) when it is false.
 */
export function exclude_testing_dandisets<T extends { raw_id: string }>(rows: T[], exclude: boolean): T[] {
    return exclude ? rows.filter((row) => !TESTING_DANDISET_IDS.includes(row.raw_id)) : rows;
}

/**
 * Divides one metric by another to produce a "scaled" (per-unit) metric, for
 * example bytes sent per byte stored or views per asset.  Returns NaN whenever
 * the ratio would be meaningless — a missing or non-finite operand, or a
 * denominator of zero — so callers can render it as "no data" rather than as
 * Infinity or a misleading zero.
 */
export function scaled_metric(numerator: number | undefined, denominator: number | undefined): number {
    if (typeof numerator !== "number" || typeof denominator !== "number") return NaN;
    if (!isFinite(numerator) || !isFinite(denominator) || denominator <= 0) return NaN;
    return numerator / denominator;
}

/**
 * Formats a scaled (per-unit) metric for display in a table cell.  Precision
 * follows magnitude, since these ratios span many orders of magnitude in
 * practice: values of 100 or more are rounded to whole numbers with thousands
 * separators, values of at least 1 keep two decimals, and values below 1 keep
 * two significant digits.  Non-finite values (produced by `scaled_metric` when
 * the ratio is undefined) render as "--".
 */
export function format_ratio(value: number): string {
    if (typeof value !== "number" || !isFinite(value)) return "--";
    const magnitude = Math.abs(value);
    if (magnitude >= 100) return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
    if (magnitude >= 1) return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
    return value.toLocaleString(undefined, { maximumSignificantDigits: 2 });
}

// ── Plot metrics ─────────────────────────────────────────────────────────────

/**
 * Display labels for every metric that can appear in a plot, whether as the
 * plotted quantity or as a line of hover text.
 */
export const METRIC_LABELS: Record<string, string> = {
    bytes: "Bytes",
    views: "Views",
    downloads: "Downloads",
    requests: "Requests",
    views_per_asset: "Views / Asset",
    downloads_per_asset: "Downloads / Asset",
    bytes_per_size: "Bytes / Size",
};

/**
 * The raw usage metrics a plot can be drawn in.  Every selection and every
 * section carries all three, and this is the order the per-asset table lists
 * them in, so it doubles as the metric order offered for a single Dandiset.
 */
export const RAW_PLOT_METRICS = ["bytes", "views", "downloads"];

/**
 * The metrics normalized by how much content a Dandiset holds.  They can only
 * be plotted per Dandiset (the archive-wide selection), the only case whose
 * bars have a known asset count and stored size to divide by.
 */
export const SCALED_PLOT_METRICS = ["views_per_asset", "downloads_per_asset", "bytes_per_size"];

/**
 * The order the archive-wide (per-Dandiset) metric selector lists its metrics
 * in, mirroring the column order of the per-Dandiset table beside it: each
 * scaled rate ahead of the totals it is derived from, closing on bytes.  Keep
 * this in step with that table's columns (see load_dandiset_histogram).
 */
export const PER_DANDISET_METRIC_ORDER = [
    "views_per_asset",
    "downloads_per_asset",
    "views",
    "downloads",
    "bytes_per_size",
    "bytes",
];

/**
 * Normalizes a metric name (typically read from a URL parameter) to one of
 * `allowed`, falling back to "bytes" for anything unrecognized.
 */
export function validate_plot_metric(metric: string | null, allowed: string[]): string {
    return metric !== null && allowed.includes(metric) ? metric : "bytes";
}

/**
 * Formats one value of `metric` in that metric's own units: bytes with a byte
 * suffix, the scaled metrics as ratios, and the raw counts with thousands
 * separators (or "--" when the count is missing).
 */
export function format_metric_value(metric: string, value: number, use_binary = false): string {
    if (metric === "bytes") return format_bytes(value, 2, use_binary);
    if (SCALED_PLOT_METRICS.includes(metric)) return format_ratio(value);
    return isFinite(value) ? value.toLocaleString() : "--";
}

/**
 * Names the unit a plot drawn in `metric` is effectively in, for use in its
 * title: for bytes, the byte unit the largest plotted value calls for (e.g.
 * "TB"); for every other metric, the metric's own label (e.g. "Views").
 */
export function metric_unit_label(metric: string, peak_value: number, use_binary = false): string {
    return metric === "bytes" ? bytes_unit(peak_value, use_binary) : (METRIC_LABELS[metric] ?? metric);
}

/**
 * Returns just the unit `format_bytes` would use for `bytes` (e.g. "TB", or
 * "TiB" in binary mode), without the numeric part.  Used to name the unit a
 * plot's y-axis is effectively in.  Non-positive and non-finite inputs fall
 * back to "Bytes"; very large inputs clamp to the largest known unit.
 */
export function bytes_unit(bytes: number, use_binary = false): string {
    const k = use_binary ? 1024 : 1000;
    const sizes = use_binary
        ? ["Bytes", "KiB", "MiB", "GiB", "TiB", "PiB", "EiB", "ZiB", "YiB"]
        : ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
    if (!isFinite(bytes) || bytes <= 0) return sizes[0];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
    return sizes[i];
}
