import { describe, it, expect } from "vitest";
import {
    setUrlParam,
    color_with_alpha,
    parse_by_day_tsv,
    parse_by_asset_type_per_week_tsv,
    aggregate_by_timebin,
    format_bytes,
    bytes_unit,
    scaled_metric,
    format_ratio,
    exclude_testing_dandisets,
    TESTING_DANDISET_IDS,
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
} from "../../src/utils.ts";

// ── setUrlParam ──────────────────────────────────────────────────────────────

describe("setUrlParam", () => {
    it("sets a parameter when value differs from default", () => {
        const params = new URLSearchParams();
        setUrlParam(params, "log", "true", "false");
        expect(params.get("log")).toBe("true");
    });

    it("deletes the parameter when value equals default", () => {
        const params = new URLSearchParams("log=true");
        setUrlParam(params, "log", "false", "false");
        expect(params.has("log")).toBe(false);
    });

    it("does not add a parameter that was already absent and equals the default", () => {
        const params = new URLSearchParams();
        setUrlParam(params, "aggregation", "daily", "daily");
        expect(params.has("aggregation")).toBe(false);
    });
});

// ── color_with_alpha ─────────────────────────────────────────────────────────

describe("color_with_alpha", () => {
    it("converts a 6-digit hex color to rgba", () => {
        expect(color_with_alpha("#ff8800", 0.5)).toBe("rgba(255,136,0,0.5)");
    });

    it("converts a black hex color correctly", () => {
        expect(color_with_alpha("#000000", 1)).toBe("rgba(0,0,0,1)");
    });

    it("converts a white hex color correctly", () => {
        expect(color_with_alpha("#ffffff", 0)).toBe("rgba(255,255,255,0)");
    });

    it("replaces the alpha in an existing rgba string", () => {
        expect(color_with_alpha("rgba(88,174,192,0.7)", 0.3)).toBe("rgba(88,174,192,0.3)");
    });

    it("replaces the alpha in an existing rgb string", () => {
        expect(color_with_alpha("rgb(10, 20, 30)", 0.9)).toBe("rgba(10,20,30,0.9)");
    });

    it("returns the original string for unrecognised formats", () => {
        expect(color_with_alpha("red", 0.5)).toBe("red");
        expect(color_with_alpha("hsl(0,100%,50%)", 0.5)).toBe("hsl(0,100%,50%)");
    });
});

// ── parse_by_day_tsv ─────────────────────────────────────────────────────────

describe("parse_by_day_tsv", () => {
    const sample = [
        "date\tbytes_sent",
        "2024-01-01\t1000",
        "2024-01-02\t2000",
        "2024-01-03\t3000",
    ].join("\n");

    it("parses dates correctly", () => {
        const { dates } = parse_by_day_tsv(sample);
        expect(dates).toEqual(["2024-01-01", "2024-01-02", "2024-01-03"]);
    });

    it("parses bytes as integers", () => {
        const { bytes } = parse_by_day_tsv(sample);
        expect(bytes).toEqual([1000, 2000, 3000]);
    });

    it("ignores trailing blank lines", () => {
        const { dates } = parse_by_day_tsv(sample + "\n\n");
        expect(dates).toHaveLength(3);
    });

    it("throws when there is no data row", () => {
        expect(() => parse_by_day_tsv("date\tbytes_sent")).toThrow("TSV file does not contain enough data.");
    });

    it("throws for an empty string", () => {
        expect(() => parse_by_day_tsv("")).toThrow("TSV file does not contain enough data.");
    });

    it("parses requests, downloads, and views as integers", () => {
        const tsv = [
            "date\tbytes_sent\tnumber_of_requests\tnumber_of_downloads\tnumber_of_views",
            "2024-01-01\t1000\t20\t4\t11",
            "2024-01-02\t2000\t30\t8\t12",
        ].join("\n");
        const { requests, downloads, views } = parse_by_day_tsv(tsv);
        expect(requests).toEqual([20, 30]);
        expect(downloads).toEqual([4, 8]);
        expect(views).toEqual([11, 12]);
    });

    it("defaults requests, downloads, and views to 0 when columns are absent", () => {
        const { requests, downloads, views } = parse_by_day_tsv(sample);
        expect(requests).toEqual([0, 0, 0]);
        expect(downloads).toEqual([0, 0, 0]);
        expect(views).toEqual([0, 0, 0]);
    });

    it("defaults views to 0 when only the views column is absent", () => {
        const tsv = [
            "date\tbytes_sent\tnumber_of_requests\tnumber_of_downloads",
            "2024-01-01\t1000\t20\t4",
            "2024-01-02\t2000\t30\t8",
        ].join("\n");
        const { views } = parse_by_day_tsv(tsv);
        expect(views).toEqual([0, 0]);
    });

    it("parses bytes correctly when additional columns are present", () => {
        const extended = [
            "date\tbytes_sent\tnumber_of_requests\tnumber_of_downloads\tnumber_of_views",
            "2024-01-01\t1000\t20\t4\t11",
            "2024-01-02\t2000\t30\t8\t12",
        ].join("\n");
        const { dates, bytes, requests, downloads, views } = parse_by_day_tsv(extended);
        expect(dates).toEqual(["2024-01-01", "2024-01-02"]);
        expect(bytes).toEqual([1000, 2000]);
        expect(requests).toEqual([20, 30]);
        expect(downloads).toEqual([4, 8]);
        expect(views).toEqual([11, 12]);
    });
});

// ── parse_by_asset_type_per_week_tsv ─────────────────────────────────────────

describe("parse_by_asset_type_per_week_tsv", () => {
    const sample = [
        "week_start\tNeurophysiology\tMicroscopy",
        "2024-01-01\t500\t300",
        "2024-01-08\t600\t400",
    ].join("\n");

    it("returns the correct dates", () => {
        const { dates } = parse_by_asset_type_per_week_tsv(sample);
        expect(dates).toEqual(["2024-01-01", "2024-01-08"]);
    });

    it("returns the correct asset_types list", () => {
        const { asset_types } = parse_by_asset_type_per_week_tsv(sample);
        expect(asset_types).toEqual(["Neurophysiology", "Microscopy"]);
    });

    it("builds the series_map with correct values", () => {
        const { series_map } = parse_by_asset_type_per_week_tsv(sample);
        expect(series_map.get("Neurophysiology")).toEqual([500, 600]);
        expect(series_map.get("Microscopy")).toEqual([300, 400]);
    });

    it("treats missing numeric cells as 0", () => {
        const sparse = ["week_start\tNeurophysiology", "2024-01-01\t", "2024-01-08\t700"].join("\n");
        const { series_map } = parse_by_asset_type_per_week_tsv(sparse);
        expect(series_map.get("Neurophysiology")).toEqual([0, 700]);
    });

    it("throws when there is no data row", () => {
        expect(() => parse_by_asset_type_per_week_tsv("week_start\tType")).toThrow(
            "TSV file does not contain enough data."
        );
    });
});

// ── aggregate_by_timebin ─────────────────────────────────────────────────────

describe("aggregate_by_timebin", () => {
    const dates = ["2024-01-01", "2024-01-02", "2024-01-08", "2024-01-15"];
    const bytes = [100, 200, 300, 400];

    it("returns data unchanged for 'daily' aggregation", () => {
        const result = aggregate_by_timebin(dates, bytes, "daily");
        expect(result.dates).toEqual(dates);
        expect(result.bytes_sent).toEqual(bytes);
    });

    it("sums values into weekly bins (Monday-based)", () => {
        // 2024-01-01 is a Monday, 2024-01-02 is a Tuesday → both go to 2024-01-01 week
        // 2024-01-08 is next Monday
        // 2024-01-15 is the following Monday
        const result = aggregate_by_timebin(dates, bytes, "weekly");
        expect(result.dates).toContain("2024-01-01");
        expect(result.dates).toContain("2024-01-08");
        expect(result.dates).toContain("2024-01-15");
        const week1Idx = result.dates.indexOf("2024-01-01");
        expect(result.bytes_sent[week1Idx]).toBe(300); // 100 + 200
    });

    it("sums values into monthly bins", () => {
        const result = aggregate_by_timebin(dates, bytes, "monthly");
        expect(result.dates).toEqual(["2024-01"]);
        expect(result.bytes_sent).toEqual([1000]);
    });

    it("sums values into yearly bins", () => {
        const result = aggregate_by_timebin(dates, bytes, "yearly");
        expect(result.dates).toEqual(["2024"]);
        expect(result.bytes_sent).toEqual([1000]);
    });

    it("returns bins sorted chronologically", () => {
        const datesUnsorted = ["2024-03-01", "2024-01-01"];
        const bytesUnsorted = [50, 100];
        const result = aggregate_by_timebin(datesUnsorted, bytesUnsorted, "monthly");
        expect(result.dates[0]).toBe("2024-01");
        expect(result.dates[1]).toBe("2024-03");
    });

    it("handles Sunday as last day of the previous ISO week", () => {
        // 2024-01-07 is a Sunday — should belong to the Mon 2024-01-01 week
        const result = aggregate_by_timebin(["2024-01-01", "2024-01-07"], [10, 20], "weekly");
        const week1Idx = result.dates.indexOf("2024-01-01");
        expect(result.bytes_sent[week1Idx]).toBe(30);
    });
});

// ── format_bytes ─────────────────────────────────────────────────────────────

describe("format_bytes", () => {
    it("returns '0 Bytes' for zero input", () => {
        expect(format_bytes(0)).toBe("0 Bytes");
    });

    it("formats bytes in decimal (SI) mode by default", () => {
        expect(format_bytes(1000)).toBe("1 KB");
        expect(format_bytes(1_000_000)).toBe("1 MB");
        expect(format_bytes(1_000_000_000)).toBe("1 GB");
    });

    it("formats bytes in binary (IEC) mode when use_binary is true", () => {
        expect(format_bytes(1024, 2, true)).toBe("1 KiB");
        expect(format_bytes(1024 * 1024, 2, true)).toBe("1 MiB");
    });

    it("respects the decimals parameter", () => {
        expect(format_bytes(1500, 1)).toBe("1.5 KB");
        expect(format_bytes(1500, 0)).toBe("2 KB");
    });

    it("formats small byte counts without a prefix", () => {
        expect(format_bytes(500)).toBe("500 Bytes");
    });
});

// ── bytes_unit ───────────────────────────────────────────────────────────────

describe("bytes_unit", () => {
    it("returns the decimal (SI) unit by default", () => {
        expect(bytes_unit(1000)).toBe("KB");
        expect(bytes_unit(1_000_000)).toBe("MB");
        expect(bytes_unit(2_500_000_000_000)).toBe("TB");
    });

    it("returns the binary (IEC) unit when use_binary is true", () => {
        expect(bytes_unit(1024, true)).toBe("KiB");
        expect(bytes_unit(1024 ** 4, true)).toBe("TiB");
    });

    it("matches the unit that format_bytes chooses", () => {
        for (const value of [999, 1000, 1_500_000, 3_200_000_000, 7e15]) {
            expect(format_bytes(value).split(" ")[1]).toBe(bytes_unit(value));
        }
    });

    it("returns 'Bytes' for values below one kilobyte", () => {
        expect(bytes_unit(500)).toBe("Bytes");
    });

    it("falls back to 'Bytes' for zero, negative, and non-finite input", () => {
        expect(bytes_unit(0)).toBe("Bytes");
        expect(bytes_unit(-5)).toBe("Bytes");
        expect(bytes_unit(NaN)).toBe("Bytes");
        expect(bytes_unit(Infinity)).toBe("Bytes");
    });

    it("clamps to the largest known unit for absurdly large values", () => {
        expect(bytes_unit(1e40)).toBe("YB");
    });
});

// ── scaled_metric ────────────────────────────────────────────────────────────

describe("scaled_metric", () => {
    it("divides the numerator by the denominator", () => {
        expect(scaled_metric(600, 4)).toBe(150);
    });

    it("returns a fractional ratio when the numerator is smaller", () => {
        expect(scaled_metric(1, 8)).toBe(0.125);
    });

    it("returns zero when the numerator is zero", () => {
        expect(scaled_metric(0, 101)).toBe(0);
    });

    it("returns NaN for a zero denominator instead of Infinity", () => {
        expect(scaled_metric(500, 0)).toBeNaN();
    });

    it("returns NaN for a negative denominator", () => {
        expect(scaled_metric(500, -1)).toBeNaN();
    });

    it("returns NaN when either operand is missing", () => {
        expect(scaled_metric(undefined, 4)).toBeNaN();
        expect(scaled_metric(600, undefined)).toBeNaN();
    });

    it("returns NaN when either operand is not finite", () => {
        expect(scaled_metric(NaN, 4)).toBeNaN();
        expect(scaled_metric(600, Infinity)).toBeNaN();
    });

    it("computes bytes sent per stored byte for realistic magnitudes", () => {
        expect(scaled_metric(164445122622529, 2559248010229)).toBeCloseTo(64.255, 3);
    });
});

// ── format_ratio ─────────────────────────────────────────────────────────────

describe("format_ratio", () => {
    it("renders values of 100 or more as whole numbers with thousands separators", () => {
        expect(format_ratio(94966.4)).toBe("94,966");
        expect(format_ratio(100)).toBe("100");
    });

    it("keeps two decimals for values between 1 and 100", () => {
        expect(format_ratio(20.1333)).toBe("20.13");
        expect(format_ratio(1)).toBe("1");
    });

    it("keeps two significant digits for values below 1", () => {
        expect(format_ratio(0.171914)).toBe("0.17");
        expect(format_ratio(0.00456)).toBe("0.0046");
    });

    it("renders zero as '0'", () => {
        expect(format_ratio(0)).toBe("0");
    });

    it("renders non-finite values as '--'", () => {
        expect(format_ratio(NaN)).toBe("--");
        expect(format_ratio(Infinity)).toBe("--");
        expect(format_ratio(-Infinity)).toBe("--");
    });

    it("renders a missing value as '--'", () => {
        expect(format_ratio(undefined)).toBe("--");
    });
});

// ── exclude_testing_dandisets ────────────────────────────────────────────────

describe("exclude_testing_dandisets", () => {
    // Derived from the list itself rather than restated, so that adding a
    // testing Dandiset is a one-line change in src/utils.ts.
    const rows = [
        { raw_id: "000003" },
        ...TESTING_DANDISET_IDS.map((raw_id) => ({ raw_id })),
        { raw_id: "undetermined" },
    ];

    it("drops every testing Dandiset when asked to", () => {
        expect(exclude_testing_dandisets(rows, true)).toEqual([{ raw_id: "000003" }, { raw_id: "undetermined" }]);
    });

    it("returns the rows unchanged when not asked to", () => {
        expect(exclude_testing_dandisets(rows, false)).toBe(rows);
    });

    it("does not mutate the input", () => {
        const row_count = rows.length;
        exclude_testing_dandisets(rows, true);
        expect(rows).toHaveLength(row_count);
    });

    it("lists well-formed six-digit Dandiset IDs", () => {
        expect(TESTING_DANDISET_IDS.filter((id) => !/^\d{6}$/.test(id))).toEqual([]);
    });

    it("lists each testing Dandiset once, in ID order", () => {
        expect(new Set(TESTING_DANDISET_IDS).size).toBe(TESTING_DANDISET_IDS.length);
        expect([...TESTING_DANDISET_IDS].sort()).toEqual(TESTING_DANDISET_IDS);
    });

    it("keeps rows whose ID merely resembles a testing ID", () => {
        const near_misses = [{ raw_id: "0000027" }, { raw_id: "00027" }, { raw_id: "000027x" }];
        expect(exclude_testing_dandisets(near_misses, true)).toEqual(near_misses);
    });

    it("returns an empty array for empty input", () => {
        expect(exclude_testing_dandisets([], true)).toEqual([]);
    });
});

// ── plot metrics ─────────────────────────────────────────────────────────────

describe("plot metric definitions", () => {
    it("labels every selectable metric", () => {
        for (const metric of [...RAW_PLOT_METRICS, ...SCALED_PLOT_METRICS]) {
            expect(METRIC_LABELS[metric]).toBeTruthy();
        }
    });

    it("keeps the raw and scaled metric sets disjoint", () => {
        expect(RAW_PLOT_METRICS.filter((metric) => SCALED_PLOT_METRICS.includes(metric))).toEqual([]);
    });

    it("offers bytes as a raw metric, since it is the fallback everywhere", () => {
        expect(RAW_PLOT_METRICS).toContain("bytes");
    });

    it("orders every metric exactly once for the per-Dandiset selector", () => {
        expect([...PER_DANDISET_METRIC_ORDER].sort()).toEqual(
            [...RAW_PLOT_METRICS, ...SCALED_PLOT_METRICS].sort()
        );
    });

    it("follows the per-Dandiset table's columns, each scaled rate ahead of its totals", () => {
        // Mirrors the column order of the table rendered in load_dandiset_histogram.
        expect(PER_DANDISET_METRIC_ORDER).toEqual([
            "views_per_asset",
            "downloads_per_asset",
            "views",
            "downloads",
            "bytes_per_size",
            "bytes",
        ]);
    });
});

describe("validate_plot_metric", () => {
    it("keeps a metric that is allowed", () => {
        expect(validate_plot_metric("views", RAW_PLOT_METRICS)).toBe("views");
        expect(validate_plot_metric("bytes_per_size", SCALED_PLOT_METRICS)).toBe("bytes_per_size");
    });

    it("falls back to bytes for a metric that is not allowed here", () => {
        expect(validate_plot_metric("bytes_per_size", RAW_PLOT_METRICS)).toBe("bytes");
    });

    it("falls back to bytes for unknown and missing values", () => {
        expect(validate_plot_metric("nonsense", RAW_PLOT_METRICS)).toBe("bytes");
        expect(validate_plot_metric(null, RAW_PLOT_METRICS)).toBe("bytes");
        expect(validate_plot_metric("", RAW_PLOT_METRICS)).toBe("bytes");
    });

    it("uses the given fallback instead of bytes when one is passed", () => {
        expect(validate_plot_metric(null, PER_DANDISET_METRIC_ORDER, "views_per_asset")).toBe("views_per_asset");
        expect(validate_plot_metric("nonsense", PER_DANDISET_METRIC_ORDER, "views_per_asset")).toBe("views_per_asset");
    });
});

describe("histogram_metrics_for", () => {
    it("offers the per-Dandiset order for the archive-wide selection", () => {
        expect(histogram_metrics_for(true)).toEqual(PER_DANDISET_METRIC_ORDER);
    });

    it("offers the raw metrics alone for a single Dandiset, whose bars are assets", () => {
        expect(histogram_metrics_for(false)).toEqual(RAW_PLOT_METRICS);
        expect(histogram_metrics_for(false).some((metric) => SCALED_PLOT_METRICS.includes(metric))).toBe(false);
    });
});

describe("default_histogram_metric", () => {
    it("defaults to the first metric its dropdown offers, for either selection", () => {
        expect(default_histogram_metric(true)).toBe(histogram_metrics_for(true)[0]);
        expect(default_histogram_metric(false)).toBe(histogram_metrics_for(false)[0]);
    });

    it("leads with a scaled metric per Dandiset and with bytes per asset", () => {
        expect(default_histogram_metric(true)).toBe("views_per_asset");
        expect(default_histogram_metric(false)).toBe("bytes");
    });

    it("returns a metric that selection actually offers", () => {
        for (const is_archive of [true, false]) {
            expect(histogram_metrics_for(is_archive)).toContain(default_histogram_metric(is_archive));
        }
    });
});

describe("format_metric_value", () => {
    it("formats bytes with a byte unit, honoring the binary prefix", () => {
        expect(format_metric_value("bytes", 1000)).toBe("1 KB");
        expect(format_metric_value("bytes", 1024, true)).toBe("1 KiB");
    });

    it("formats counts with thousands separators", () => {
        expect(format_metric_value("views", 12345)).toBe((12345).toLocaleString());
        expect(format_metric_value("downloads", 0)).toBe("0");
    });

    it("formats scaled metrics as ratios", () => {
        expect(format_metric_value("views_per_asset", 12.345)).toBe(format_ratio(12.345));
        expect(format_metric_value("bytes_per_size", NaN)).toBe("--");
    });

    it("renders a missing count as '--' rather than NaN", () => {
        expect(format_metric_value("views", NaN)).toBe("--");
        expect(format_metric_value("requests", Infinity)).toBe("--");
    });
});

describe("metric_unit_label", () => {
    it("names the byte unit of the largest plotted value for bytes", () => {
        expect(metric_unit_label("bytes", 2_500_000_000_000)).toBe("TB");
        expect(metric_unit_label("bytes", 1024 ** 4, true)).toBe("TiB");
    });

    it("uses the metric's own label for every other metric", () => {
        expect(metric_unit_label("views", 1e12)).toBe("Views");
        expect(metric_unit_label("downloads", 1e12)).toBe("Downloads");
    });

    it("spells out the ratio of a scaled metric, for a title that reads as a phrase", () => {
        expect(metric_unit_label("views_per_asset", 1e12)).toBe("Views per Asset");
        expect(metric_unit_label("downloads_per_asset", 1e12)).toBe("Downloads per Asset");
        expect(metric_unit_label("bytes_per_size", 1e12)).toBe("Bytes per Size");
    });

    it("leaves the '/' form in the labels the dropdown and table headings use", () => {
        for (const metric of SCALED_PLOT_METRICS) {
            expect(METRIC_LABELS[metric]).toContain(" / ");
        }
    });

    it("falls back to the metric name when it has no label", () => {
        expect(metric_unit_label("unlabeled", 1)).toBe("unlabeled");
    });
});

describe("histogram_plot_title", () => {
    it("names the byte unit of the largest plotted value, per subject", () => {
        expect(histogram_plot_title("bytes", 2.5e15, "Dandiset")).toBe("PB per Dandiset");
        expect(histogram_plot_title("bytes", 2.5e12, "asset")).toBe("TB per asset");
        expect(histogram_plot_title("bytes", 1024 ** 4, "Dandiset", true)).toBe("TiB per Dandiset");
    });

    it("names a raw count metric, per subject", () => {
        expect(histogram_plot_title("views", 1e6, "Dandiset")).toBe("Views per Dandiset");
        expect(histogram_plot_title("downloads", 1e6, "asset")).toBe("Downloads per asset");
    });

    it("spells out a scaled metric's ratio, per subject", () => {
        expect(histogram_plot_title("views_per_asset", 1e3, "Dandiset")).toBe("Views per Asset per Dandiset");
        expect(histogram_plot_title("downloads_per_asset", 1e3, "Dandiset")).toBe("Downloads per Asset per Dandiset");
    });

    it("gives bytes-per-stored-byte a title of its own, that ratio not reading as a phrase", () => {
        expect(histogram_plot_title("bytes_per_size", 1e3, "Dandiset")).toBe(
            "Bytes transferred relative to total size of Dandiset"
        );
    });

    it("keeps that title whatever the plotted values and prefix are", () => {
        for (const [peak, binary] of [[0, false], [1e18, true], [NaN, false]]) {
            expect(histogram_plot_title("bytes_per_size", peak, "Dandiset", binary)).toBe(
                "Bytes transferred relative to total size of Dandiset"
            );
        }
    });
});
