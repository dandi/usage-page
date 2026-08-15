import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { gzipSync } from "node:zlib";
import {
    escape_html,
    make_cumulative,
    fetchWithRetry,
    apply_view_mode,
    apply_geo_view_mode,
    default_choropleth_view,
    default_points_view,
    derive_data_source_urls,
    render_sortable_table,
    render_totals_summary,
    parse_dandiset_titles_jsonl,
    parse_dandiset_numbers_jsonl,
    build_table_tsv,
    table_download_filename,
    decode_maybe_gzipped_response,
    fetch_maybe_gzipped_text,
    format_dandiset_label,
} from "../../src/plot-helpers.js";

// ── escape_html ───────────────────────────────────────────────────────────────

describe("escape_html", () => {
    it("escapes ampersand", () => {
        expect(escape_html("a & b")).toBe("a &amp; b");
    });

    it("escapes less-than", () => {
        expect(escape_html("<script>")).toBe("&lt;script&gt;");
    });

    it("escapes greater-than", () => {
        expect(escape_html("1 > 0")).toBe("1 &gt; 0");
    });

    it("escapes double quotes", () => {
        expect(escape_html('say "hello"')).toBe("say &quot;hello&quot;");
    });

    it("escapes single quotes", () => {
        expect(escape_html("it's")).toBe("it&#39;s");
    });

    it("escapes all five special characters in one string", () => {
        expect(escape_html(`<a href="x" onclick='y'>AT&T</a>`)).toBe(
            "&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;AT&amp;T&lt;/a&gt;"
        );
    });

    it("returns the original string when there is nothing to escape", () => {
        expect(escape_html("hello world")).toBe("hello world");
    });

    it("returns an empty string unchanged", () => {
        expect(escape_html("")).toBe("");
    });
});

// ── make_cumulative ───────────────────────────────────────────────────────────

describe("make_cumulative", () => {
    it("returns an empty array for empty input", () => {
        expect(make_cumulative([])).toEqual([]);
    });

    it("returns a single-element array unchanged in cumulative terms", () => {
        expect(make_cumulative([42])).toEqual([42]);
    });

    it("accumulates two values correctly", () => {
        expect(make_cumulative([10, 20])).toEqual([10, 30]);
    });

    it("accumulates multiple values correctly", () => {
        expect(make_cumulative([1, 2, 3, 4])).toEqual([1, 3, 6, 10]);
    });

    it("handles zeros in the input", () => {
        expect(make_cumulative([5, 0, 0, 3])).toEqual([5, 5, 5, 8]);
    });

    it("does not mutate the original array", () => {
        const input = [1, 2, 3];
        make_cumulative(input);
        expect(input).toEqual([1, 2, 3]);
    });
});

// ── fetchWithRetry ────────────────────────────────────────────────────────────

describe("fetchWithRetry", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("returns the response immediately on a successful first attempt", async () => {
        const mockResponse = { ok: true, status: 200 };
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

        const result = await fetchWithRetry("https://example.com/data");
        expect(result).toBe(mockResponse);
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("throws immediately on a 4xx (client) error without retrying", async () => {
        const mockResponse = { ok: false, status: 404, statusText: "Not Found" };
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

        await expect(fetchWithRetry("https://example.com/missing", {}, 3, 0)).rejects.toThrow(
            "HTTP error 404: Not Found"
        );
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("retries on a 5xx (server) error and throws after exhausting retries", async () => {
        const mockResponse = { ok: false, status: 503, statusText: "Service Unavailable" };
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

        await expect(
            fetchWithRetry("https://example.com/flaky", {}, 2, 0)
        ).rejects.toThrow("HTTP error 503: Service Unavailable");
        // 1 initial attempt + 2 retries = 3 total calls
        expect(fetch).toHaveBeenCalledTimes(3);
    });

    it("succeeds on a retry after an initial 5xx failure", async () => {
        const failResponse = { ok: false, status: 500, statusText: "Internal Server Error" };
        const okResponse   = { ok: true,  status: 200 };
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValueOnce(failResponse).mockResolvedValueOnce(okResponse)
        );

        const result = await fetchWithRetry("https://example.com/flaky", {}, 3, 0);
        expect(result).toBe(okResponse);
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("retries on a network error and succeeds on the next attempt", async () => {
        const networkError = new TypeError("Failed to fetch");
        const okResponse   = { ok: true, status: 200 };
        vi.stubGlobal(
            "fetch",
            vi.fn().mockRejectedValueOnce(networkError).mockResolvedValueOnce(okResponse)
        );

        const result = await fetchWithRetry("https://example.com/unreliable", {}, 3, 0);
        expect(result).toBe(okResponse);
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("throws the network error after all retries are exhausted", async () => {
        const networkError = new TypeError("Network failure");
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(networkError));

        await expect(
            fetchWithRetry("https://example.com/down", {}, 2, 0)
        ).rejects.toThrow("Network failure");
        expect(fetch).toHaveBeenCalledTimes(3);
    });
});

// ── apply_view_mode ───────────────────────────────────────────────────────────

/**
 * jsdom lays nothing out, so every element measures 0 tall; the view-mode
 * helpers reserve space from measured heights, and this gives them something
 * to measure.
 */
function stub_height(element_id: string, height: number): void {
    Object.defineProperty(document.getElementById(element_id)!, "offsetHeight", {
        configurable: true,
        get: () => height,
    });
}

describe("apply_view_mode", () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <div class="view-section">
                <div id="over_time_plot"></div>
                <div id="over_time_table" style="display:none;"></div>
            </div>
        `;
    });

    it("hides the plot and shows the table when use_table is true", () => {
        apply_view_mode("over_time_plot", "over_time_table", true);
        expect(document.getElementById("over_time_plot")!.style.display).toBe("none");
        expect(document.getElementById("over_time_table")!.style.display).toBe("");
    });

    it("shows the plot and hides the table when use_table is false", () => {
        // First switch to table so there is something to switch back from
        apply_view_mode("over_time_plot", "over_time_table", true);
        apply_view_mode("over_time_plot", "over_time_table", false);
        expect(document.getElementById("over_time_plot")!.style.display).toBe("");
        expect(document.getElementById("over_time_table")!.style.display).toBe("none");
    });

    it("reserves the height of the plot it replaces while the table is still empty", () => {
        const section = document.querySelector(".view-section") as HTMLElement;
        stub_height("over_time_plot", 400);

        apply_view_mode("over_time_plot", "over_time_table", true);

        expect(section.style.minHeight).toBe("400px");
    });

    it("reserves only the taller view when both are visible at once", () => {
        // A re-render un-hides the plot while the table view is active, so both
        // can be on screen; the reservation must not stack the two heights.
        const section = document.querySelector(".view-section") as HTMLElement;
        stub_height("over_time_plot", 350);
        stub_height("over_time_table", 0);
        document.getElementById("over_time_table")!.style.display = "";

        apply_view_mode("over_time_plot", "over_time_table", true);

        expect(section.style.minHeight).toBe("350px");
    });

    it("releases the reservation once the table has rendered", () => {
        const section = document.querySelector(".view-section") as HTMLElement;
        section.style.minHeight = "500px";
        stub_height("over_time_plot", 400);
        stub_height("over_time_table", 200);

        apply_view_mode("over_time_plot", "over_time_table", true);

        expect(section.style.minHeight).toBe("");
    });

    it("releases the min-height lock when switching back to plot", () => {
        const section = document.querySelector(".view-section") as HTMLElement;
        section.style.minHeight = "500px";
        stub_height("over_time_plot", 400);

        apply_view_mode("over_time_plot", "over_time_table", false);

        expect(section.style.minHeight).toBe("");
    });

    it("does not throw when the plot element does not exist", () => {
        expect(() => apply_view_mode("nonexistent_plot", "over_time_table", true)).not.toThrow();
    });

    it("does not throw when the table element does not exist", () => {
        expect(() => apply_view_mode("over_time_plot", "nonexistent_table", true)).not.toThrow();
    });
});

// ── apply_geo_view_mode ───────────────────────────────────────────────────────

describe("apply_geo_view_mode", () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <div class="view-section">
                <div id="geography_heatmap"></div>
                <div id="geo_table_section" style="display:none;">
                    <div id="top_regions_table" style="display:none;"></div>
                    <div id="aws_histogram" style="display:none;"></div>
                </div>
            </div>
        `;
    });

    it('shows the map and hides the table section for "regions" view', () => {
        apply_geo_view_mode("regions");
        expect(document.getElementById("geography_heatmap")!.style.display).toBe("");
        expect(document.getElementById("geo_table_section")!.style.display).toBe("none");
    });

    it('shows the map and hides the table section for "points" view', () => {
        apply_geo_view_mode("points");
        expect(document.getElementById("geography_heatmap")!.style.display).toBe("");
        expect(document.getElementById("geo_table_section")!.style.display).toBe("none");
    });

    it('hides the map and shows the table section for "table" view', () => {
        apply_geo_view_mode("table");
        expect(document.getElementById("geography_heatmap")!.style.display).toBe("none");
        expect(document.getElementById("geo_table_section")!.style.display).toBe("");
    });

    it('shows the top-regions table and hides the aws panel in "table" view', () => {
        apply_geo_view_mode("table");
        expect(document.getElementById("top_regions_table")!.style.display).toBe("");
        expect(document.getElementById("aws_histogram")!.style.display).toBe("none");
    });

    it('hides the map and shows the table section for "aws" view', () => {
        apply_geo_view_mode("aws");
        expect(document.getElementById("geography_heatmap")!.style.display).toBe("none");
        expect(document.getElementById("geo_table_section")!.style.display).toBe("");
    });

    it('shows the aws histogram and hides the top-regions table in "aws" view', () => {
        apply_geo_view_mode("aws");
        expect(document.getElementById("aws_histogram")!.style.display).toBe("");
        expect(document.getElementById("top_regions_table")!.style.display).toBe("none");
    });

    it("reserves the height of the map it replaces while the table is still empty", () => {
        const section = document.querySelector(".view-section") as HTMLElement;
        stub_height("geography_heatmap", 350);

        apply_geo_view_mode("table");

        expect(section.style.minHeight).toBe("350px");
    });

    it("releases the reservation once the table section has rendered", () => {
        const section = document.querySelector(".view-section") as HTMLElement;
        section.style.minHeight = "400px";
        stub_height("geography_heatmap", 350);
        stub_height("geo_table_section", 120);

        apply_geo_view_mode("table");

        expect(section.style.minHeight).toBe("");
    });

    it("releases the min-height lock when switching back to a map view", () => {
        const section = document.querySelector(".view-section") as HTMLElement;
        section.style.minHeight = "400px";
        stub_height("geography_heatmap", 350);

        apply_geo_view_mode("regions");

        expect(section.style.minHeight).toBe("");
    });

    it("does not throw when geo elements are absent", () => {
        document.body.innerHTML = "";
        expect(() => apply_geo_view_mode("regions")).not.toThrow();
    });
});

// ── default_choropleth_view / default_points_view ─────────────────────────────

/** The degrees of longitude a MapLibre map of this width shows at this zoom. */
function tiled_map_longitude_span(map_width_px: number, zoom: number): number {
    return (360 * map_width_px) / (512 * Math.pow(2, zoom));
}

describe("default_choropleth_view", () => {
    it("centers the view on the United States", () => {
        expect(default_choropleth_view(400).center).toEqual({ lat: 40, lon: -98 });
    });

    it("opens on the whole world once the map is wide enough to draw it", () => {
        const view = default_choropleth_view(2048);
        expect(view.zoom).toBeCloseTo(2);
        expect(tiled_map_longitude_span(2048, view.zoom)).toBeCloseTo(360);
    });

    it("opens on a proportionally narrower window on a narrower map", () => {
        const view = default_choropleth_view(400);
        expect(tiled_map_longitude_span(400, view.zoom)).toBeCloseTo(360 * (400 / 1024));
    });

    it("allows zooming a little further out than the default", () => {
        const view = default_choropleth_view(400);
        expect(view.min_zoom).toBeCloseTo(view.zoom - 0.15);
    });
});

describe("default_points_view", () => {
    it("opens on the same window of longitude as the choropleth of that width", () => {
        const [west, east] = default_points_view(400, 320).longitude_range;
        expect(east - west).toBeCloseTo(tiled_map_longitude_span(400, default_choropleth_view(400).zoom));
    });

    it("centers the view on the United States", () => {
        const view = default_points_view(400, 320);
        const [west, east] = view.longitude_range;
        const [south, north] = view.latitude_range;
        expect((west + east) / 2).toBeCloseTo(-98);
        expect((south + north) / 2).toBeCloseTo(40);
    });

    it("gives the window the shape of the map it is drawn into", () => {
        const view = default_points_view(400, 320);
        const [west, east] = view.longitude_range;
        const [south, north] = view.latitude_range;
        // 400 x 320 less Plotly's margins is a drawing area of 240 x 140.
        expect((east - west) / (north - south)).toBeCloseTo(240 / 140);
    });

    it("opens on the whole world once the map is wide enough to draw it", () => {
        const view = default_points_view(2048, 1200);
        expect(view.longitude_range).toEqual([-180, 180]);
        expect(view.latitude_range).toEqual([-90, 90]);
    });

    it("pulls a window that would run off the end of the world back inside it", () => {
        // A `geo` subplot does not repeat the world to either side, so a
        // US-centered window this wide would leave empty paper to the west.
        const view = default_points_view(800, 600);
        expect(view.longitude_range[0]).toBeCloseTo(-180);
        expect(view.longitude_range[1] - view.longitude_range[0]).toBeCloseTo(360 * (800 / 1024));
    });
});

// ── render_sortable_table ─────────────────────────────────────────────────────

describe("render_sortable_table", () => {
    const columns = [
        { label: "Name", key: "name", numeric: false },
        { label: "Size", key: "bytes", numeric: true },
    ];

    const rows = [
        { name: "alpha", bytes: 300 },
        { name: "beta",  bytes: 100 },
        { name: "gamma", bytes: 200 },
    ];

    const fmt = (n: number) => `${n}B`;

    beforeEach(() => {
        document.body.innerHTML = '<div id="my_table"></div>';
    });

    it("renders a table inside the container", () => {
        render_sortable_table("my_table", "My Title", columns, rows, fmt);
        const table = document.querySelector("#my_table table");
        expect(table).not.toBeNull();
    });

    it("renders the correct column headers", () => {
        render_sortable_table("my_table", "My Title", columns, rows, fmt);
        const headers = Array.from(document.querySelectorAll("#my_table th")).map(
            (th) => th.textContent!.replace(/[▲▼⇅]/g, "").trim()
        );
        expect(headers).toEqual(["Name", "Size"]);
    });

    it("renders the title heading", () => {
        render_sortable_table("my_table", "My Title", columns, rows, fmt);
        expect(document.querySelector("#my_table h3")!.textContent).toBe("My Title");
    });

    it("sorts rows by the first numeric column descending by default", () => {
        render_sortable_table("my_table", "Title", columns, rows, fmt);
        const firstCell = document.querySelector("#my_table tbody tr:first-child td:last-child")!;
        // bytes 300 is the highest → should appear first
        expect(firstCell.textContent).toBe("300B");
    });

    it("keeps the default sort on the first numeric column when trailing metric columns are present", () => {
        const metric_columns = [
            { label: "Name", key: "name", numeric: false },
            { label: "Usage", key: "bytes", numeric: true },
            { label: "Views", key: "views", numeric: true },
        ];
        const metric_rows = [
            { name: "alpha", bytes: 300, views: 1 },
            { name: "beta", bytes: 100, views: 9 },
            { name: "gamma", bytes: 200, views: 5 },
        ];
        render_sortable_table("my_table", "Title", metric_columns, metric_rows, fmt);
        const sortedHeader = document.querySelector("#my_table th.th-sorted") as HTMLElement | null;
        expect(sortedHeader!.dataset.key).toBe("bytes");
        // Highest bytes (not highest views) must lead
        const firstCell = document.querySelector("#my_table tbody tr:first-child td:first-child")!;
        expect(firstCell.textContent).toBe("alpha");
    });

    it("falls back to the last column when no column is numeric", () => {
        const text_columns = [
            { label: "Name", key: "name", numeric: false },
            { label: "Region", key: "region", numeric: false },
        ];
        const text_rows = [
            { name: "alpha", region: "AA" },
            { name: "beta", region: "ZZ" },
        ];
        render_sortable_table("my_table", "Title", text_columns, text_rows, fmt);
        const sortedHeader = document.querySelector("#my_table th.th-sorted") as HTMLElement | null;
        expect(sortedHeader!.dataset.key).toBe("region");
    });

    it("renders exactly as many data rows as provided", () => {
        render_sortable_table("my_table", "Title", columns, rows, fmt);
        const dataRows = document.querySelectorAll("#my_table tbody tr");
        expect(dataRows.length).toBe(rows.length);
    });

    it("applies the format function to numeric columns", () => {
        const customFmt = (n: number) => `${n} bytes`;
        render_sortable_table("my_table", "Title", columns, rows, customFmt);
        const cells = Array.from(document.querySelectorAll("#my_table tbody td:last-child")).map(
            (td) => td.textContent
        );
        expect(cells).toContain("300 bytes");
    });

    it("escapes HTML in string column values", () => {
        const xssRows = [{ name: "<script>alert(1)</script>", bytes: 50 }];
        render_sortable_table("my_table", "Title", columns, xssRows, fmt);
        const firstNameCell = document.querySelector("#my_table tbody td:first-child")!;
        expect(firstNameCell.innerHTML).not.toContain("<script>");
        expect(firstNameCell.textContent).toBe("<script>alert(1)</script>");
    });

    it("escapes HTML in the title", () => {
        render_sortable_table("my_table", "<b>Bold</b>", columns, rows, fmt);
        const heading = document.querySelector("#my_table h3")!;
        expect(heading.innerHTML).toBe("&lt;b&gt;Bold&lt;/b&gt;");
    });

    // ── link_fn (hyperlinked cells) ──────────────────────────────────────────

    const link_columns = [
        { label: "Name", key: "name", numeric: false, link_fn: (row: Record<string, unknown>) => (row.url as string | null) ?? null },
        { label: "Size", key: "bytes", numeric: true },
    ];

    it("renders a hyperlink in a cell when link_fn returns a URL", () => {
        const link_rows = [{ name: "alpha", bytes: 300, url: "https://example.com/alpha" }];
        render_sortable_table("my_table", "Title", link_columns, link_rows, fmt);
        const link = document.querySelector("#my_table tbody td:first-child a") as HTMLAnchorElement | null;
        expect(link).not.toBeNull();
        expect(link!.href).toBe("https://example.com/alpha");
        expect(link!.textContent).toBe("alpha");
        expect(link!.target).toBe("_blank");
        expect(link!.rel).toBe("noopener");
    });

    it("leaves the cell as plain text when link_fn returns null", () => {
        const link_rows = [{ name: "alpha", bytes: 300, url: null }];
        render_sortable_table("my_table", "Title", link_columns, link_rows, fmt);
        expect(document.querySelector("#my_table tbody td:first-child a")).toBeNull();
        expect(document.querySelector("#my_table tbody td:first-child")!.textContent).toBe("alpha");
    });

    it("does not link an empty cell, which would be invisible to click", () => {
        const link_rows = [{ name: "", bytes: 300, url: "https://example.com/alpha" }];
        render_sortable_table("my_table", "Title", link_columns, link_rows, fmt);
        expect(document.querySelector("#my_table tbody td:first-child a")).toBeNull();
    });

    it("ignores link_fn URLs that are not http(s)", () => {
        const link_rows = [{ name: "alpha", bytes: 300, url: "javascript:alert(1)" }];
        render_sortable_table("my_table", "Title", link_columns, link_rows, fmt);
        expect(document.querySelector("#my_table tbody td:first-child a")).toBeNull();
        expect(document.querySelector("#my_table tbody td:first-child")!.textContent).toBe("alpha");
    });

    it("escapes both the link text and the href", () => {
        const link_rows = [{ name: '<script>x</script>', bytes: 300, url: 'https://example.com/"onmouseover="alert(1)' }];
        render_sortable_table("my_table", "Title", link_columns, link_rows, fmt);
        const cell = document.querySelector("#my_table tbody td:first-child")!;
        const link = cell.querySelector("a") as HTMLAnchorElement;
        expect(cell.innerHTML).not.toContain("<script>");
        expect(cell.textContent).toBe("<script>x</script>");
        // The quote in the URL must stay escaped so it cannot close the href
        // attribute and introduce an event handler of its own.
        expect(link.outerHTML).not.toMatch(/href="[^"]*"[^>]*onmouseover/);
        expect(link.getAttributeNames()).not.toContain("onmouseover");
    });

    it("keeps hyperlinked cells sortable by their text value", () => {
        const link_rows = [
            { name: "beta", bytes: 100, url: "https://example.com/beta" },
            { name: "alpha", bytes: 300, url: "https://example.com/alpha" },
        ];
        render_sortable_table("my_table", "Title", link_columns, link_rows, fmt);
        (document.querySelector('#my_table th[data-key="name"]') as HTMLElement).click();
        const first = document.querySelector("#my_table tbody tr:first-child td:first-child a")!;
        expect(first.textContent).toBe("beta"); // descending on first click
    });

    it("renders a data link when data_url is provided", () => {
        render_sortable_table("my_table", "Title", columns, rows, fmt, "https://example.com/data.tsv");
        const link = document.querySelector("#my_table a.table-data-link") as HTMLAnchorElement | null;
        expect(link).not.toBeNull();
        expect(link!.href).toBe("https://example.com/data.tsv");
    });

    it("does not render a data link when data_url is absent", () => {
        render_sortable_table("my_table", "Title", columns, rows, fmt);
        expect(document.querySelector("#my_table a.table-data-link")).toBeNull();
    });

    it("escapes HTML in the data_url to prevent XSS", () => {
        render_sortable_table("my_table", "Title", columns, rows, fmt, 'https://x.example/"onload="alert(1)');
        const link = document.querySelector("#my_table a.table-data-link");
        expect(link).not.toBeNull();
        // The raw HTML must not contain an unescaped " that could break the attribute
        expect(link!.outerHTML).not.toMatch(/href="[^"]*"[^>]*onload/);
    });

    it("re-sorts ascending when the sorted column header is clicked", () => {
        render_sortable_table("my_table", "Title", columns, rows, fmt);
        // The Size header (first numeric column) is sorted descending by default; clicking toggles to ascending
        const sizeHeader = document.querySelector('#my_table th[data-key="bytes"]') as HTMLElement | null;
        sizeHeader!.click();
        const firstCell = document.querySelector("#my_table tbody tr:first-child td:last-child")!;
        // bytes 100 is the lowest → should appear first in ascending order
        expect(firstCell.textContent).toBe("100B");
    });

    it("sorts descending on first click of a different column header", () => {
        render_sortable_table("my_table", "Title", columns, rows, fmt);
        // Click the Name column (not the default sort column)
        const nameHeader = document.querySelector('#my_table th[data-key="name"]') as HTMLElement | null;
        nameHeader!.click();
        const firstCell = document.querySelector("#my_table tbody tr:first-child td:first-child")!;
        // "gamma" > "beta" > "alpha" alphabetically descending
        expect(firstCell.textContent).toBe("gamma");
    });

    it("does nothing when the container element does not exist", () => {
        expect(() =>
            render_sortable_table("nonexistent", "Title", columns, rows, fmt)
        ).not.toThrow();
    });

    it("handles an empty rows array without throwing", () => {
        expect(() =>
            render_sortable_table("my_table", "Title", columns, [], fmt)
        ).not.toThrow();
        expect(document.querySelectorAll("#my_table tbody tr").length).toBe(0);
    });

    it("renders an empty string for null/undefined non-numeric cell values", () => {
        render_sortable_table("my_table", "Title", columns, [{ name: null, bytes: 500 }], fmt);
        const cell = document.querySelector("#my_table tbody td:first-child")!;
        expect(cell.textContent).toBe("");
    });

    it("marks the default sort column header with th-sorted class", () => {
        render_sortable_table("my_table", "Title", columns, rows, fmt);
        const sortedHeader = document.querySelector("#my_table th.th-sorted") as HTMLElement | null;
        expect(sortedHeader).not.toBeNull();
        expect(sortedHeader!.dataset.key).toBe("bytes");
    });

    it("uses the default format_bytes formatter when no format_fn is provided", () => {
        // Calling with only 4 arguments; the default formatter (SI decimal) should be used
        render_sortable_table("my_table", "Title", columns, [{ name: "x", bytes: 1000 }]);
        const cell = document.querySelector("#my_table tbody td:last-child")!;
        expect(cell.textContent).toBe("1 KB");
    });

    it("uses per-column format_fn when provided, overriding the table-level formatter", () => {
        const count_format = (n: number) => n.toLocaleString("en-US");
        const cols_with_override = [
            { label: "Name", key: "name", numeric: false },
            { label: "Bytes", key: "bytes", numeric: true },
            { label: "Count", key: "count", numeric: true, format_fn: count_format },
        ];
        render_sortable_table(
            "my_table",
            "Title",
            cols_with_override,
            [{ name: "x", bytes: 1000000, count: 42000 }],
            (n: number) => `${n}B`,
        );
        const cells = document.querySelectorAll("#my_table tbody td");
        // bytes cell uses table-level formatter
        expect((cells[1] as HTMLElement).textContent).toBe("1000000B");
        // count cell uses per-column formatter
        expect((cells[2] as HTMLElement).textContent).toBe("42,000");
    });
});

// ── parse_dandiset_titles_jsonl ────────────────────────────────────────────────

describe("parse_dandiset_titles_jsonl", () => {
    it("parses one title per line into a single lookup map", () => {
        const text = '{"000003": "Alpha dataset"}\n{"000004": "Beta dataset"}';
        expect(parse_dandiset_titles_jsonl(text)).toEqual({
            "000003": "Alpha dataset",
            "000004": "Beta dataset",
        });
    });

    it("skips blank lines", () => {
        const text = '{"000003": "Alpha dataset"}\n\n\n{"000004": "Beta dataset"}\n';
        expect(parse_dandiset_titles_jsonl(text)).toEqual({
            "000003": "Alpha dataset",
            "000004": "Beta dataset",
        });
    });

    it("skips malformed lines without throwing", () => {
        const text = '{"000003": "Alpha dataset"}\nnot json\n{"000004": "Beta dataset"}';
        expect(parse_dandiset_titles_jsonl(text)).toEqual({
            "000003": "Alpha dataset",
            "000004": "Beta dataset",
        });
    });

    it("returns an empty object for empty input", () => {
        expect(parse_dandiset_titles_jsonl("")).toEqual({});
    });
});

// ── parse_dandiset_numbers_jsonl ──────────────────────────────────────────────

describe("parse_dandiset_numbers_jsonl", () => {
    it("parses one number per line into a single lookup map", () => {
        const text = '{"000003": 101}\n{"000004": 87}';
        expect(parse_dandiset_numbers_jsonl(text)).toEqual({ "000003": 101, "000004": 87 });
    });

    it("keeps zero values", () => {
        expect(parse_dandiset_numbers_jsonl('{"000003": 0}')).toEqual({ "000003": 0 });
    });

    it("preserves large byte counts exactly", () => {
        expect(parse_dandiset_numbers_jsonl('{"001412": 1067232272269263}')).toEqual({
            "001412": 1067232272269263,
        });
    });

    it("skips blank lines and trailing newlines", () => {
        const text = '{"000003": 101}\n\n\n{"000004": 87}\n';
        expect(parse_dandiset_numbers_jsonl(text)).toEqual({ "000003": 101, "000004": 87 });
    });

    it("skips malformed lines without throwing", () => {
        const text = '{"000003": 101}\nnot json\n{"000004": 87}';
        expect(parse_dandiset_numbers_jsonl(text)).toEqual({ "000003": 101, "000004": 87 });
    });

    it("drops entries whose value is not a finite number", () => {
        const text = '{"000003": 101}\n{"000004": null}\n{"000005": "87"}';
        expect(parse_dandiset_numbers_jsonl(text)).toEqual({ "000003": 101 });
    });

    it("returns an empty object for empty input", () => {
        expect(parse_dandiset_numbers_jsonl("")).toEqual({});
    });
});

// ── decode_maybe_gzipped_response ─────────────────────────────────────────────

describe("decode_maybe_gzipped_response", () => {
    const jsonl = '{"000003": 101}\n{"000004": 87}\n';

    it("inflates a gzipped body", async () => {
        const response = new Response(new Uint8Array(gzipSync(Buffer.from(jsonl))));
        expect(await decode_maybe_gzipped_response(response)).toBe(jsonl);
    });

    it("inflates a body large enough to arrive in multiple chunks", async () => {
        const big = Array.from({ length: 20000 }, (_, i) => `{"${String(i).padStart(6, "0")}": ${i}}`).join("\n");
        const response = new Response(new Uint8Array(gzipSync(Buffer.from(big))));
        expect(await decode_maybe_gzipped_response(response)).toBe(big);
    });

    it("passes through a body that was already decompressed upstream", async () => {
        const response = new Response(jsonl);
        expect(await decode_maybe_gzipped_response(response)).toBe(jsonl);
    });

    it("returns an empty string for an empty body", async () => {
        const response = new Response("");
        expect(await decode_maybe_gzipped_response(response)).toBe("");
    });

    it("rejects when the gzipped body is corrupt", async () => {
        // Valid gzip magic number followed by garbage
        const corrupt = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0x01, 0x02, 0x03, 0x04]);
        await expect(decode_maybe_gzipped_response(new Response(corrupt))).rejects.toThrow();
    });
});

// ── fetch_maybe_gzipped_text ──────────────────────────────────────────────────

describe("fetch_maybe_gzipped_text", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("fetches and inflates a gzipped file", async () => {
        const jsonl = '{"000003": 101}\n';
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue(new Response(new Uint8Array(gzipSync(Buffer.from(jsonl))), { status: 200 }))
        );
        expect(await fetch_maybe_gzipped_text("https://example.com/data.jsonl.gz")).toBe(jsonl);
    });

    it("propagates a permanent fetch failure", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: "Not Found" }));
        await expect(fetch_maybe_gzipped_text("https://example.com/missing.jsonl.gz")).rejects.toThrow(
            "HTTP error 404: Not Found"
        );
    });
});

// ── format_dandiset_label ──────────────────────────────────────────────────────

describe("format_dandiset_label", () => {
    it("appends the title with a dash when known", () => {
        expect(format_dandiset_label("000003", { "000003": "Alpha dataset" })).toBe(
            "000003 - Alpha dataset"
        );
    });

    it("falls back to the bare ID when the title is unknown", () => {
        expect(format_dandiset_label("999999", { "000003": "Alpha dataset" })).toBe("999999");
    });

    it("renders the 'archive' sentinel ID as '(All) - Archive' instead of looking it up", () => {
        expect(format_dandiset_label("archive", {})).toBe("(All) - Archive");
    });

    it("renders 'archive' as '(All) - Archive' even if a title happens to be registered for it", () => {
        expect(format_dandiset_label("archive", { archive: "Should be ignored" })).toBe("(All) - Archive");
    });

    it("falls back to the bare ID when the titles map is empty", () => {
        expect(format_dandiset_label("000003", {})).toBe("000003");
    });
});

// ── derive_data_source_urls ───────────────────────────────────────────────────

describe("derive_data_source_urls", () => {
    it("derives GitHub file and folder URLs from a raw.githubusercontent.com URL", () => {
        const result = derive_data_source_urls(
            "https://raw.githubusercontent.com/dandi/access-summaries/main/content/summaries/000003/by_day.tsv"
        );
        expect(result.raw).toBe(
            "https://raw.githubusercontent.com/dandi/access-summaries/main/content/summaries/000003/by_day.tsv"
        );
        expect(result.file).toBe(
            "https://github.com/dandi/access-summaries/blob/main/content/summaries/000003/by_day.tsv"
        );
        expect(result.folder).toBe(
            "https://github.com/dandi/access-summaries/tree/main/content/summaries/000003"
        );
    });

    it("derives the containing folder for a file one level deep", () => {
        const result = derive_data_source_urls(
            "https://raw.githubusercontent.com/dandi/access-summaries/main/content/totals.json"
        );
        expect(result.file).toBe("https://github.com/dandi/access-summaries/blob/main/content/totals.json");
        expect(result.folder).toBe("https://github.com/dandi/access-summaries/tree/main/content");
    });

    it("points the folder at the ref root for a file at the repository root", () => {
        const result = derive_data_source_urls(
            "https://raw.githubusercontent.com/owner/repo/v1.0/README.md"
        );
        expect(result.file).toBe("https://github.com/owner/repo/blob/v1.0/README.md");
        expect(result.folder).toBe("https://github.com/owner/repo/tree/v1.0");
    });

    it("returns null file/folder for a non-raw.githubusercontent.com URL", () => {
        const result = derive_data_source_urls("https://example.com/data.tsv");
        expect(result.raw).toBe("https://example.com/data.tsv");
        expect(result.file).toBeNull();
        expect(result.folder).toBeNull();
    });
});

// ── render_sortable_table "Data ▾" menu ───────────────────────────────────────

describe("render_sortable_table data menu", () => {
    const columns = [
        { label: "Name", key: "name", numeric: false },
        { label: "Size", key: "bytes", numeric: true },
    ];
    const rows = [{ name: "alpha", bytes: 300 }];
    const fmt = (n: number) => `${n}B`;
    const raw_url = "https://raw.githubusercontent.com/dandi/access-summaries/main/content/summaries/000003/by_day.tsv";

    beforeEach(() => {
        document.body.innerHTML = '<div id="my_table"></div>';
    });

    it("renders a Data menu instead of a plain link for raw.githubusercontent.com URLs", () => {
        render_sortable_table("my_table", "Title", columns, rows, fmt, raw_url);
        expect(document.querySelector("#my_table .table-data-menu")).not.toBeNull();
        expect(document.querySelector("#my_table a.table-data-link")).toBeNull();
    });

    it("renders file and folder menu items with derived hrefs", () => {
        render_sortable_table("my_table", "Title", columns, rows, fmt, raw_url);
        const hrefs = Array.from(
            document.querySelectorAll("#my_table .table-data-menu-panel a")
        ).map((a) => (a as HTMLAnchorElement).href);
        expect(hrefs).toEqual([
            "https://github.com/dandi/access-summaries/blob/main/content/summaries/000003/by_day.tsv",
            "https://github.com/dandi/access-summaries/tree/main/content/summaries/000003",
        ]);
    });

    it("offers a table download in place of a link to the raw source file", () => {
        render_sortable_table("my_table", "Title", columns, rows, fmt, raw_url);
        const items = Array.from(
            document.querySelectorAll("#my_table .table-data-menu-panel a, #my_table .table-data-menu-panel button")
        ).map((el) => el.textContent);
        expect(items).toEqual(["View file on GitHub", "Download table", "Browse data folder"]);
    });

    it("is closed by default and opens on button click", () => {
        render_sortable_table("my_table", "Title", columns, rows, fmt, raw_url);
        const menu = document.querySelector("#my_table .table-data-menu")!;
        const btn = menu.querySelector(".table-data-menu-btn") as HTMLElement;
        expect(menu.classList.contains("open")).toBe(false);
        expect(btn.getAttribute("aria-expanded")).toBe("false");
        btn.click();
        expect(menu.classList.contains("open")).toBe(true);
        expect(btn.getAttribute("aria-expanded")).toBe("true");
    });

    it("closes when clicking outside the menu", () => {
        render_sortable_table("my_table", "Title", columns, rows, fmt, raw_url);
        const menu = document.querySelector("#my_table .table-data-menu")!;
        const btn = menu.querySelector(".table-data-menu-btn") as HTMLElement;
        btn.click();
        expect(menu.classList.contains("open")).toBe(true);
        document.body.click();
        expect(menu.classList.contains("open")).toBe(false);
        expect(btn.getAttribute("aria-expanded")).toBe("false");
    });

    it("closes on Escape", () => {
        render_sortable_table("my_table", "Title", columns, rows, fmt, raw_url);
        const menu = document.querySelector("#my_table .table-data-menu")!;
        const btn = menu.querySelector(".table-data-menu-btn") as HTMLElement;
        btn.click();
        menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        expect(menu.classList.contains("open")).toBe(false);
    });

    it("keeps a plain Data link for URLs that are not raw.githubusercontent.com", () => {
        render_sortable_table("my_table", "Title", columns, rows, fmt, "https://example.com/data.tsv");
        expect(document.querySelector("#my_table .table-data-menu")).toBeNull();
        const link = document.querySelector("#my_table a.table-data-link") as HTMLAnchorElement | null;
        expect(link).not.toBeNull();
        expect(link!.href).toBe("https://example.com/data.tsv");
    });
});

// ── render_sortable_table missing numeric values ──────────────────────────────

describe("render_sortable_table with missing numeric values", () => {
    // NaN is how a scaled metric reports "no ratio available" (unknown or zero
    // denominator); such rows must never displace rows that do have a value.
    const columns = [
        { label: "Name", key: "name", numeric: false },
        { label: "Ratio", key: "ratio", numeric: true, format_fn: (n: number) => (isFinite(n) ? String(n) : "--") },
    ];
    const rows = [
        { name: "alpha", ratio: 3 },
        { name: "beta", ratio: NaN },
        { name: "gamma", ratio: 1 },
        { name: "delta", ratio: 2 },
    ];

    const rendered_names = () =>
        Array.from(document.querySelectorAll("#my_table tbody tr td:first-child")).map((td) => td.textContent);

    beforeEach(() => {
        document.body.innerHTML = '<div id="my_table"></div>';
        render_sortable_table("my_table", "Title", columns, rows, (n) => String(n));
    });

    it("sorts rows without a value last when sorting descending", () => {
        expect(rendered_names()).toEqual(["alpha", "delta", "gamma", "beta"]);
    });

    it("keeps rows without a value last when sorting ascending", () => {
        (document.querySelector('#my_table th[data-key="ratio"]') as HTMLElement).click();
        expect(rendered_names()).toEqual(["gamma", "delta", "alpha", "beta"]);
    });

    it("renders the missing value through the column formatter", () => {
        const last_cell = document.querySelector("#my_table tbody tr:last-child td:last-child")!;
        expect(last_cell.textContent).toBe("--");
    });
});

// ── render_sortable_table default_sort column flag ────────────────────────────

describe("render_sortable_table default_sort flag", () => {
    const columns = [
        { label: "Name", key: "name", numeric: false },
        { label: "Ratio", key: "ratio", numeric: true },
        { label: "Total", key: "total", numeric: true, default_sort: true },
    ];
    const rows = [
        { name: "alpha", ratio: 9, total: 100 },
        { name: "beta", ratio: 5, total: 300 },
        { name: "gamma", ratio: 7, total: 200 },
    ];

    beforeEach(() => {
        document.body.innerHTML = '<div id="my_table"></div>';
        render_sortable_table("my_table", "Title", columns, rows, (n) => String(n));
    });

    it("sorts by the flagged column instead of the first numeric one", () => {
        const sorted_header = document.querySelector("#my_table th.th-sorted");
        expect((sorted_header as HTMLElement).dataset.key).toBe("total");
        const first_name = document.querySelector("#my_table tbody tr:first-child td:first-child")!;
        expect(first_name.textContent).toBe("beta");
    });

    it("still starts descending on the flagged column", () => {
        const totals = Array.from(document.querySelectorAll("#my_table tbody tr td:last-child")).map(
            (td) => td.textContent
        );
        expect(totals).toEqual(["300", "200", "100"]);
    });

    it("lets a click move the sort to another column", () => {
        (document.querySelector('#my_table th[data-key="ratio"]') as HTMLElement).click();
        const first_name = document.querySelector("#my_table tbody tr:first-child td:first-child")!;
        expect(first_name.textContent).toBe("alpha");
    });
});

// ── build_table_tsv ───────────────────────────────────────────────────────────

describe("build_table_tsv", () => {
    const columns = [
        { label: "Name", key: "name", numeric: false },
        { label: "Total Bytes", key: "bytes", numeric: true },
        { label: "Views / Asset", key: "ratio", numeric: true, format_fn: (n: number) => (isFinite(n) ? n.toFixed(2) : "--") },
    ];
    const rows = [
        { name: "alpha", bytes: 300, ratio: 1.5 },
        { name: "beta", bytes: 100, ratio: NaN },
    ];
    const fmt = (n: number) => `${n}B`;

    it("writes the column labels as the header row", () => {
        expect(build_table_tsv(columns, rows, fmt).split("\n")[0]).toBe("Name\tTotal Bytes\tViews / Asset");
    });

    it("formats cells exactly as the table displays them", () => {
        const lines = build_table_tsv(columns, rows, fmt).split("\n");
        expect(lines[1]).toBe("alpha\t300B\t1.50");
        expect(lines[2]).toBe("beta\t100B\t--");
    });

    it("preserves the order of the rows it is given", () => {
        const reversed = build_table_tsv(columns, [...rows].reverse(), fmt).split("\n");
        expect(reversed[1].startsWith("beta")).toBe(true);
        expect(reversed[2].startsWith("alpha")).toBe(true);
    });

    it("ends with a trailing newline", () => {
        expect(build_table_tsv(columns, rows, fmt).endsWith("\n")).toBe(true);
    });

    it("renders a missing non-numeric cell as an empty field", () => {
        const tsv = build_table_tsv(columns, [{ bytes: 1, ratio: 1 }], fmt);
        expect(tsv.split("\n")[1]).toBe("\t1B\t1.00");
    });

    it("collapses tabs and newlines inside a cell so the columns stay aligned", () => {
        const tsv = build_table_tsv(columns, [{ name: "a\tb\nc", bytes: 1, ratio: 1 }], fmt);
        expect(tsv.split("\n")[1]).toBe("a b c\t1B\t1.00");
    });

    it("writes only a header row when there are no rows", () => {
        expect(build_table_tsv(columns, [], fmt)).toBe("Name\tTotal Bytes\tViews / Asset\n");
    });
});

// ── table_download_filename ───────────────────────────────────────────────────

describe("table_download_filename", () => {
    it("slugifies the table heading", () => {
        expect(table_download_filename("Usage per Dandiset")).toBe("usage_per_dandiset.tsv");
    });

    it("collapses punctuation runs into single underscores", () => {
        expect(table_download_filename("Usage per region (top 10)")).toBe("usage_per_region_top_10.tsv");
    });

    it("trims leading and trailing separators", () => {
        expect(table_download_filename("  Usage per asset  ")).toBe("usage_per_asset.tsv");
    });

    it("falls back to a generic name when the title has no usable characters", () => {
        expect(table_download_filename("—")).toBe("table.tsv");
    });
});

// ── render_sortable_table download menu item ──────────────────────────────────

describe("render_sortable_table table download", () => {
    const columns = [
        { label: "Name", key: "name", numeric: false },
        { label: "Total Bytes", key: "bytes", numeric: true },
    ];
    const rows = [
        { name: "alpha", bytes: 100 },
        { name: "beta", bytes: 300 },
    ];
    const fmt = (n: number) => `${n}B`;
    const raw_url = "https://raw.githubusercontent.com/dandi/access-summaries/main/content/totals.json";

    let created_blobs: Blob[];
    let revoked: string[];

    beforeEach(() => {
        document.body.innerHTML = '<div id="my_table"></div>';
        created_blobs = [];
        revoked = [];
        vi.stubGlobal("URL", {
            ...URL,
            createObjectURL: vi.fn((blob: Blob) => {
                created_blobs.push(blob);
                return "blob:mock-url";
            }),
            revokeObjectURL: vi.fn((url: string) => {
                revoked.push(url);
            }),
        });
        render_sortable_table("my_table", "Usage per Dandiset", columns, rows, fmt, raw_url);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    const click_download = () =>
        (document.querySelector("#my_table .table-data-menu-download") as HTMLElement).click();

    it("builds a TSV of the table in its current sort order", async () => {
        click_download();
        expect(created_blobs).toHaveLength(1);
        // Default sort is the first numeric column descending, so beta leads
        expect(await created_blobs[0].text()).toBe("Name\tTotal Bytes\nbeta\t300B\nalpha\t100B\n");
    });

    it("follows the sort order chosen by the user", async () => {
        (document.querySelector('#my_table th[data-key="bytes"]') as HTMLElement).click();
        click_download();
        expect(await created_blobs[0].text()).toBe("Name\tTotal Bytes\nalpha\t100B\nbeta\t300B\n");
    });

    it("names the file after the table heading", () => {
        // The temporary anchor is removed again after the click, so capture it
        // as it is created.
        const anchors: HTMLAnchorElement[] = [];
        const create_element = document.createElement.bind(document);
        vi.spyOn(document, "createElement").mockImplementation((tag: string, options?: ElementCreationOptions) => {
            const element = create_element(tag, options);
            if (tag === "a") anchors.push(element as HTMLAnchorElement);
            return element;
        });

        click_download();

        expect(anchors.at(-1)!.download).toBe("usage_per_dandiset.tsv");
    });

    it("revokes the object URL once the download has started", () => {
        click_download();
        expect(revoked).toEqual(["blob:mock-url"]);
    });

    it("closes the menu after downloading", () => {
        (document.querySelector("#my_table .table-data-menu-btn") as HTMLElement).click();
        expect(document.querySelector("#my_table .table-data-menu")!.classList.contains("open")).toBe(true);
        click_download();
        expect(document.querySelector("#my_table .table-data-menu")!.classList.contains("open")).toBe(false);
    });
});

// ── render_sortable_table sort persistence across re-renders ──────────────────

describe("render_sortable_table sort persistence", () => {
    const columns = [
        { label: "Name", key: "name", numeric: false },
        { label: "Ratio", key: "ratio", numeric: true },
        { label: "Total", key: "total", numeric: true, default_sort: true },
    ];
    const rows = [
        { name: "alpha", ratio: 9, total: 100 },
        { name: "beta", ratio: 5, total: 300 },
        { name: "gamma", ratio: 7, total: 200 },
    ];
    const fmt = (n: number) => String(n);

    const sorted_key = () => (document.querySelector("#my_table th.th-sorted") as HTMLElement).dataset.key;
    const indicator = () => document.querySelector("#my_table th.th-sorted .sort-indicator")!.textContent;
    const first_name = () => document.querySelector("#my_table tbody tr:first-child td:first-child")!.textContent;

    beforeEach(() => {
        document.body.innerHTML = '<div id="my_table"></div>';
        render_sortable_table("my_table", "Title", columns, rows, fmt);
    });

    it("keeps the user's sort column when the same table is re-rendered", () => {
        (document.querySelector('#my_table th[data-key="ratio"]') as HTMLElement).click();
        expect(sorted_key()).toBe("ratio");

        // Same table, fewer rows — as when a filter setting is toggled
        render_sortable_table("my_table", "Title", columns, rows.slice(0, 2), fmt);

        expect(sorted_key()).toBe("ratio");
        expect(first_name()).toBe("alpha");
    });

    it("keeps the sort direction as well as the column", () => {
        const th = document.querySelector('#my_table th[data-key="ratio"]') as HTMLElement;
        th.click();
        th.click(); // second click flips to ascending
        expect(indicator()).toBe("▲");

        render_sortable_table("my_table", "Title", columns, rows, fmt);

        expect(sorted_key()).toBe("ratio");
        expect(indicator()).toBe("▲");
        expect(first_name()).toBe("beta");
    });

    it("starts from the default sort when the columns change", () => {
        (document.querySelector('#my_table th[data-key="ratio"]') as HTMLElement).click();

        const other_columns = [
            { label: "Name", key: "name", numeric: false },
            { label: "Bytes", key: "bytes", numeric: true },
        ];
        render_sortable_table("my_table", "Other table", other_columns, [{ name: "alpha", bytes: 1 }], fmt);

        expect(sorted_key()).toBe("bytes");
    });

    it("does not leak one table's sort into another table", () => {
        document.body.innerHTML = '<div id="my_table"></div><div id="other_table"></div>';
        render_sortable_table("my_table", "Title", columns, rows, fmt);
        (document.querySelector('#my_table th[data-key="ratio"]') as HTMLElement).click();

        render_sortable_table("other_table", "Title", columns, rows, fmt);

        expect((document.querySelector("#other_table th.th-sorted") as HTMLElement).dataset.key).toBe("total");
    });

    it("uses the default sort for a freshly created container", () => {
        (document.querySelector('#my_table th[data-key="ratio"]') as HTMLElement).click();

        // Replacing the container element discards the state tied to it
        document.body.innerHTML = '<div id="my_table"></div>';
        render_sortable_table("my_table", "Title", columns, rows, fmt);

        expect(sorted_key()).toBe("total");
    });
});

// ── render_totals_summary ─────────────────────────────────────────────────────

describe("render_totals_summary", () => {
    const summary = {
        caption: "Totals for the entire archive",
        caption_tooltip: "Dandiset source determination is heuristic.",
        metrics: [
            { label: "Transferred", value: "15.0 TB" },
            { label: "Views", value: "96,000", tooltip: "Streaming (partial) accesses of an asset." },
        ],
    };

    beforeEach(() => {
        document.body.innerHTML = '<div id="totals"></div>';
        render_totals_summary("totals", summary);
    });

    it("renders one row of a label and a value per metric, in the order given", () => {
        // The trailing "i" of a label is the info icon's own text.
        const rows = Array.from(document.querySelectorAll("#totals tbody tr")).map((tr) => [
            tr.querySelector("th")!.textContent!.trim(),
            tr.querySelector("td")!.textContent,
        ]);
        expect(rows).toEqual([
            ["Transferred", "15.0 TB"],
            ["Views i", "96,000"],
        ]);
    });

    it("attaches an info icon only to the metrics that carry a caveat", () => {
        const icons = document.querySelectorAll("#totals th .info-icon");
        expect(icons.length).toBe(1);
        expect(icons[0].getAttribute("data-tooltip")).toBe("Streaming (partial) accesses of an asset.");
    });

    it("puts the summary-wide caveat behind an info icon on the caption", () => {
        const icon = document.querySelector("#totals .totals-caption .info-icon")!;
        expect(icon.getAttribute("data-tooltip")).toBe("Dandiset source determination is heuristic.");
        expect(icon.getAttribute("aria-label")).toBe(
            "Totals for the entire archive: Dandiset source determination is heuristic."
        );
    });

    it("omits the note line when the selection has no remark", () => {
        expect(document.querySelector("#totals .totals-note")).toBeNull();
    });

    it("renders the note and its info icon when given one", () => {
        render_totals_summary("totals", {
            ...summary,
            note: "This usage could not be uniquely associated with a particular Dandiset.",
            note_tooltip: "Typically caused by an asset leaving a 'draft' state.",
        });
        const note = document.querySelector("#totals .totals-note")!;
        expect(note.textContent).toContain("could not be uniquely associated");
        expect(note.querySelector(".info-icon")!.getAttribute("data-tooltip")).toBe(
            "Typically caused by an asset leaving a 'draft' state."
        );
    });

    it("escapes values and tooltips rather than injecting markup", () => {
        render_totals_summary("totals", {
            caption: "Totals",
            metrics: [{ label: "<b>Views</b>", value: "<img src=x>", tooltip: "<script>alert(1)</script>" }],
        });
        expect(document.querySelector("#totals tbody td img")).toBeNull();
        expect(document.querySelector("#totals tbody td")!.textContent).toBe("<img src=x>");
        expect(document.querySelector("#totals .info-icon")!.getAttribute("data-tooltip")).toBe(
            "<script>alert(1)</script>"
        );
    });

    it("does nothing when the container is absent", () => {
        document.body.innerHTML = "";
        expect(() => render_totals_summary("totals", summary)).not.toThrow();
    });
});
