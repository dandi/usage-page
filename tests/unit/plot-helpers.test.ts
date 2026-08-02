import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
    escape_html,
    make_cumulative,
    fetchWithRetry,
    apply_view_mode,
    apply_geo_view_mode,
    derive_data_source_urls,
    render_sortable_table,
    parse_dandiset_titles_jsonl,
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

    it("locks the min-height to the current height when switching to table and offsetHeight is positive", () => {
        const section = document.querySelector(".view-section") as HTMLElement;
        Object.defineProperty(section, "offsetHeight", { configurable: true, get: () => 400 });

        apply_view_mode("over_time_plot", "over_time_table", true);

        expect(section.style.minHeight).toBe("400px");
    });
    it("releases the min-height lock when switching back to plot", () => {
        const section = document.querySelector(".view-section") as HTMLElement;
        section.style.minHeight = "500px";

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

    it("locks the min-height to the current height when switching away from map and offsetHeight is positive", () => {
        const section = document.querySelector(".view-section") as HTMLElement;
        Object.defineProperty(section, "offsetHeight", { configurable: true, get: () => 350 });

        apply_geo_view_mode("table");

        expect(section.style.minHeight).toBe("350px");
    });
    it("releases the min-height lock when switching back to a map view", () => {
        const section = document.querySelector(".view-section") as HTMLElement;
        section.style.minHeight = "400px";

        apply_geo_view_mode("regions");

        expect(section.style.minHeight).toBe("");
    });

    it("does not throw when geo elements are absent", () => {
        document.body.innerHTML = "";
        expect(() => apply_geo_view_mode("regions")).not.toThrow();
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

    it("sorts rows by the last column descending by default", () => {
        render_sortable_table("my_table", "Title", columns, rows, fmt);
        const firstCell = document.querySelector("#my_table tbody tr:first-child td:last-child")!;
        // bytes 300 is the highest → should appear first
        expect(firstCell.textContent).toBe("300B");
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
        // The last-column header (Size) is sorted descending by default; clicking toggles to ascending
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

    it("falls back to the bare ID for special selections like 'archive'", () => {
        expect(format_dandiset_label("archive", {})).toBe("archive");
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

    it("renders file, raw, and folder menu items with derived hrefs", () => {
        render_sortable_table("my_table", "Title", columns, rows, fmt, raw_url);
        const hrefs = Array.from(
            document.querySelectorAll("#my_table .table-data-menu-panel a")
        ).map((a) => (a as HTMLAnchorElement).href);
        expect(hrefs).toEqual([
            "https://github.com/dandi/access-summaries/blob/main/content/summaries/000003/by_day.tsv",
            raw_url,
            "https://github.com/dandi/access-summaries/tree/main/content/summaries/000003",
        ]);
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
