import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    after_each,
    before_each,
    by_id,
    change,
    check,
    choose,
    draw_plot,
    fetched_urls,
    install_environment,
    last_plot,
    load_page,
    media_query,
    not_found,
    plot_calls,
    plotly,
    query,
    scrolled_to,
    serve,
    settle,
    table_headers,
    table_rows,
    table_title,
    totals,
    url_params,
} from "./plots-harness.js";
import { ALL_DANDISET_TOTALS } from "../fixtures/mock-data.js";

// The stub is taken from the global the harness keeps it in (see PLOTLY_STUB_GLOBAL)
vi.mock("plotly.js-dist-min", () => ({ default: (globalThis as any).__plots_harness_plotly__ }));

install_environment();
beforeEach(before_each);
afterEach(after_each);

// ── Page load ────────────────────────────────────────────────────────────────

describe("page load", () => {
    it("lists the archive first in the Dandiset selector, then every Dandiset by number, titled where known", async () => {
        await load_page();
        const options = Array.from(by_id<HTMLSelectElement>("dandiset_selector").options);
        expect(options.map((option) => option.value)).toEqual([
            "archive",
            "000001",
            "000002",
            "000003",
            "000004",
            "undetermined",
        ]);
        expect(options.map((option) => option.textContent)).toEqual([
            "(All) - Archive",
            "000001 - Mock electrophysiology recordings",
            "000002 - Mock calcium imaging dataset",
            "000003",
            "000004 - A detailed data-driven network model of prefrontal cortex reproduces key features of in vivo activity",
            "undetermined",
        ]);
    });

    it("renders the archive totals as a table of labeled metrics", async () => {
        await load_page();
        expect(totals()).toEqual([
            ["Transferred", "15 TB"],
            ["Views", "96,000"],
            ["Full downloads", "1,450,000"],
            ["Unique visitors", "12,000"],
            ["Regions", "150"],
            ["Countries", "60"],
        ]);
    });

    it("draws the three sections of the archive and their tables", async () => {
        await load_page();
        expect(last_plot("over_time_plot").data[0].type).toBe("bar");
        expect(last_plot("histogram_plot").data[0].type).toBe("bar");
        expect(last_plot("geography_heatmap").data[0].type).toBe("choroplethmap");
        expect(table_title("over_time_table")).toBe("Usage per day");
        expect(table_title("histogram_table")).toBe("Usage per Dandiset");
        expect(table_title("top_regions_table")).toBe("Usage per region");
    });

    it("stamps the version and commit in the footer", async () => {
        await load_page();
        expect(by_id("site_version").textContent).toBe("v1.2.3+abcdef12");
    });

    it("re-enables transitions once the first paint has been committed", async () => {
        await load_page();
        expect(document.documentElement.classList.contains("preload")).toBe(false);
    });

    it("points the data link at the folder of summary tables for the selection", async () => {
        await load_page();
        const link = by_id<HTMLAnchorElement>("dandiset_data_link");
        expect(link.href).toBe("https://github.com/dandi/access-summaries/tree/main/content/summaries/archive");
        expect(link.title).toBe("Source data tables for the entire archive on GitHub");

        change("dandiset_selector", "000002");
        await settle();
        expect(link.href).toBe("https://github.com/dandi/access-summaries/tree/main/content/summaries/000002");
        expect(link.getAttribute("aria-label")).toBe("Source data tables for 000002 on GitHub");
    });

    it("renders a Dandiset's totals, keeping a censored visitor count as given", async () => {
        await load_page();
        change("dandiset_selector", "000003");
        await settle();
        expect(totals()).toEqual([
            ["Transferred", "1 GB"],
            ["Views", "95"],
            ["Full downloads", "120"],
            ["Unique visitors", "<50"],
            ["Regions", "5"],
            ["Countries", "3"],
        ]);
        expect(document.querySelector("#totals .totals-note")).toBeNull();
    });

    it("explains the undetermined bucket below its totals", async () => {
        await load_page();
        change("dandiset_selector", "undetermined");
        await settle();
        expect(query("#totals .totals-note").textContent).toContain(
            "This usage could not be uniquely associated with a particular Dandiset."
        );
    });

    it("logs the region coordinates failing to load, which only the points map needs", async () => {
        serve("/content/region_codes_to_coordinates.yaml", not_found);
        await load_page();
        expect(console.error).toHaveBeenCalledWith("Error loading YAML file:", expect.anything());
        expect(last_plot("geography_heatmap").data[0].type).toBe("choroplethmap");
    });

    it("keeps the titles cosmetic: a Dandiset is listed by bare ID when they fail to load", async () => {
        serve("/dandiset_id_to_title.jsonl", not_found);
        await load_page();
        const labels = Array.from(by_id<HTMLSelectElement>("dandiset_selector").options).map((o) => o.textContent);
        expect(labels).toContain("000001");
        expect(labels).not.toContain("000001 - Mock electrophysiology recordings");
        expect(console.error).toHaveBeenCalledWith("Error loading dandiset titles:", expect.anything());
    });
});

// ── Theme ────────────────────────────────────────────────────────────────────

describe("theme", () => {
    it("opens in dark mode when nothing is stored and the browser states no preference", async () => {
        await load_page();
        expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
        const button = by_id("theme_toggle_btn");
        expect(button.getAttribute("aria-label")).toBe("Switch to light mode");
        expect(button.querySelector("svg")).not.toBeNull();
        expect(last_plot("over_time_plot").layout.paper_bgcolor).toBe("#16213e");
    });

    it("follows the browser's preference when nothing is stored", async () => {
        await load_page({ prefers_dark: false });
        expect(window.matchMedia).toHaveBeenCalledWith("(prefers-color-scheme: dark)");
        expect(document.documentElement.getAttribute("data-theme")).toBe("light");
        expect(by_id("theme_toggle_btn").getAttribute("aria-label")).toBe("Switch to dark mode");
        expect(last_plot("over_time_plot").layout.paper_bgcolor).toBe("#ffffff");
    });

    it("prefers a stored choice over the browser's preference", async () => {
        await load_page({ theme: "light", prefers_dark: true });
        expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    });

    it("toggling flips and stores the theme and redraws every plot in its colors", async () => {
        await load_page();
        const drawn_before = plotly.newPlot.mock.calls.length;

        by_id("theme_toggle_btn").click();
        await settle();

        expect(document.documentElement.getAttribute("data-theme")).toBe("light");
        expect(localStorage.getItem("theme")).toBe("light");
        expect(by_id("theme_toggle_btn").getAttribute("aria-label")).toBe("Switch to dark mode");
        expect(plotly.newPlot.mock.calls.length).toBeGreaterThan(drawn_before);
        expect(last_plot("over_time_plot").layout.paper_bgcolor).toBe("#ffffff");
        expect(last_plot("histogram_plot").layout.font.color).toBe("#1a1a2e");
        expect(last_plot("geography_heatmap").layout.map.style).toBe("carto-positron");
    });

    it("follows a change of the browser's preference only while no choice is stored", async () => {
        await load_page({ prefers_dark: true });
        expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

        media_query!.fire(false);
        expect(document.documentElement.getAttribute("data-theme")).toBe("light");
        expect(by_id("theme_toggle_btn").getAttribute("aria-label")).toBe("Switch to dark mode");

        // Toggling stores a choice, which the browser no longer overrides.
        by_id("theme_toggle_btn").click();
        await settle();
        expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
        media_query!.fire(false);
        expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    });
});

// ── URL state ────────────────────────────────────────────────────────────────

describe("URL state", () => {
    it("applies every parameter to the controls and the plots before the first render", async () => {
        await load_page({
            url:
                "/?log=true&cumulative=true&ot_plot_type=line&hist_plot_type=line&stacked=false&prefix=binary" +
                "&map=table&over_time=table&aggregation=monthly&group_by=dandisets&ot_metric=views&top_n=3" +
                "&histogram=table&hist_metric=views&ignore_testing=false&resolution=subdivisions",
        });

        expect(by_id<HTMLInputElement>("log_scale").checked).toBe(true);
        expect(by_id<HTMLInputElement>("cumulative").checked).toBe(true);
        expect(by_id<HTMLSelectElement>("ot_plot_type").value).toBe("line");
        expect(by_id<HTMLSelectElement>("hist_plot_type").value).toBe("line");
        expect(by_id<HTMLSelectElement>("ot_stacked").value).toBe("overlay");
        expect(by_id<HTMLSelectElement>("prefix").value).toBe("binary");
        expect(query<HTMLInputElement>('input[name="geo_view"][value="table"]').checked).toBe(true);
        expect(query<HTMLInputElement>('input[name="over_time_view"][value="table"]').checked).toBe(true);
        expect(query<HTMLInputElement>('input[name="time_aggregation"][value="monthly"]').checked).toBe(true);
        expect(by_id<HTMLSelectElement>("over_time_group_by").value).toBe("dandisets");
        expect(by_id<HTMLSelectElement>("over_time_metric").value).toBe("views");
        expect(by_id<HTMLInputElement>("top_n_dandisets").value).toBe("3");
        expect(query<HTMLInputElement>('input[name="histogram_view"][value="table"]').checked).toBe(true);
        expect(by_id<HTMLSelectElement>("histogram_metric").value).toBe("views");
        expect(by_id<HTMLInputElement>("ignore_testing_dandisets").checked).toBe(false);
        expect(query<HTMLInputElement>('input[name="geo_resolution"][value="subdivisions"]').checked).toBe(true);

        // Table views: the plots are hidden, and with them the plot-only controls
        expect(by_id("over_time_plot").style.display).toBe("none");
        expect(by_id("over_time_table").style.display).toBe("");
        expect(by_id("over_time_metric_group").style.display).toBe("none");
        expect(by_id("histogram_plot").style.display).toBe("none");
        expect(by_id("histogram_metric_container").style.display).toBe("none");
        expect(by_id("geography_heatmap").style.display).toBe("none");
        expect(by_id("geo_resolution_control").style.display).toBe("none");

        // The plots were still drawn from that state, ready for a switch back
        const over_time = last_plot("over_time_plot");
        expect(over_time.layout.yaxis.type).toBe("log");
        expect(over_time.layout.title.text).toBe("Total Views to date");
        expect(over_time.data.map((trace: any) => trace.name)).toEqual([
            "DANDI:000001",
            "DANDI:000002",
            "DANDI:000003",
            "Other",
        ]);
        expect(over_time.data[0]).toMatchObject({ type: "scatter", mode: "lines", fill: "tozeroy" });
        const histogram = last_plot("histogram_plot");
        expect(histogram.data[0].type).toBe("scatter");
        expect(histogram.layout.title.text).toBe("Views per Dandiset");
        expect(plot_calls("geography_heatmap")).toHaveLength(0);
        expect(totals()[0]).toEqual(["Transferred", "13.64 TiB"]);
    });

    it("falls back to the defaults for values it does not recognize", async () => {
        await load_page({
            url: "/?map=bogus&aggregation=bogus&group_by=bogus&ot_metric=bogus&hist_metric=bogus&top_n=0&resolution=bogus",
        });
        expect(query<HTMLInputElement>('input[name="geo_view"][value="regions"]').checked).toBe(true);
        expect(query<HTMLInputElement>('input[name="time_aggregation"][value="daily"]').checked).toBe(true);
        expect(query<HTMLInputElement>('input[name="geo_resolution"][value="countries"]').checked).toBe(true);
        expect(by_id<HTMLSelectElement>("over_time_group_by").value).toBe("none");
        expect(by_id<HTMLSelectElement>("over_time_metric").value).toBe("bytes");
        expect(by_id<HTMLSelectElement>("histogram_metric").value).toBe("views_per_asset");
        expect(by_id<HTMLInputElement>("top_n_dandisets").value).toBe("8");
    });

    it("opens on the Dandiset named in the URL and scrolls to its hash once the plots are in", async () => {
        await load_page({ url: "/?dandiset=000002#histogram" });
        expect(by_id<HTMLSelectElement>("dandiset_selector").value).toBe("000002");
        expect(last_plot("histogram_plot").layout.title.text).toBe("MB per asset");
        expect(scrolled_to).toHaveBeenCalledWith({ behavior: "instant" });
        expect(scrolled_to.mock.contexts).toContain(by_id("histogram"));
    });

    it("ignores a Dandiset the archive does not have", async () => {
        await load_page({ url: "/?dandiset=999999" });
        expect(by_id<HTMLSelectElement>("dandiset_selector").value).toBe("archive");
    });

    it("writes the selection to the URL, dropping the parameter for the archive", async () => {
        await load_page();
        change("dandiset_selector", "000001");
        await settle();
        expect(url_params().get("dandiset")).toBe("000001");

        change("dandiset_selector", "archive");
        await settle();
        expect(url_params().has("dandiset")).toBe(false);
    });

    it("restores the state of an address navigated back to", async () => {
        await load_page();
        window.history.replaceState({}, "", "/?dandiset=000001&cumulative=true");
        window.dispatchEvent(new PopStateEvent("popstate"));
        await settle();

        expect(by_id<HTMLSelectElement>("dandiset_selector").value).toBe("000001");
        expect(by_id<HTMLInputElement>("cumulative").checked).toBe(true);
        expect(last_plot("over_time_plot").layout.title.text).toBe("Total GB to date");
        expect(last_plot("histogram_plot").layout.title.text).toBe("MB per asset");
    });
});

// ── Settings panels and anchors ──────────────────────────────────────────────

describe("settings panels", () => {
    it("open on their button and close on a click outside or on Escape", async () => {
        await load_page();
        const button = by_id("settings_btn");
        const panel = by_id("settings_panel");

        button.click();
        expect(panel.classList.contains("open")).toBe(true);
        expect(button.getAttribute("aria-expanded")).toBe("true");
        expect(panel.getAttribute("aria-hidden")).toBe("false");

        document.body.click();
        expect(panel.classList.contains("open")).toBe(false);
        expect(button.getAttribute("aria-expanded")).toBe("false");

        button.click();
        expect(panel.classList.contains("open")).toBe(true);
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        expect(panel.classList.contains("open")).toBe(false);
        expect(panel.getAttribute("aria-hidden")).toBe("true");
    });

    it("close again when clicked a second time", async () => {
        await load_page();
        by_id("hist_settings_btn").click();
        by_id("hist_settings_btn").click();
        expect(by_id("hist_settings_panel").classList.contains("open")).toBe(false);
    });
});

describe("section anchors", () => {
    it("put the section in the address bar and scroll to it without reloading the plots", async () => {
        await load_page();
        const drawn_before = plotly.newPlot.mock.calls.length;
        query<HTMLAnchorElement>('a.section-anchor[href="#histogram"]').click();
        await settle();

        expect(window.location.hash).toBe("#histogram");
        expect(scrolled_to).toHaveBeenCalledWith({ behavior: "smooth" });
        expect(scrolled_to.mock.contexts).toContain(by_id("histogram"));
        expect(plotly.newPlot.mock.calls.length).toBe(drawn_before);
    });
});

// ── Usage over time ──────────────────────────────────────────────────────────

const DATES = ["2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05", "2024-01-06", "2024-01-07"];
const BYTES = [1e8, 2e8, 1.5e8, 3e8, 2.5e8, 1.8e8, 2.2e8];
const VIEWS = [35, 52, 41, 88, 63, 47, 55];

describe("usage over time", () => {
    it("draws the daily bytes of the selection as bars, every metric in the hover text", async () => {
        await load_page();
        const { data, layout } = last_plot("over_time_plot");
        expect(data).toHaveLength(1);
        expect(data[0]).toMatchObject({ type: "bar", x: DATES, y: BYTES, hoverinfo: "text" });
        expect(data[0].marker.color).toBe("#53a8b6");
        expect(data[0].text[0]).toBe("2024-01-01<br>Bytes: 100 MB<br>Views: 35<br>Downloads: 120<br>Requests: 400");
        expect(layout.title.text).toBe("MB per day");
        expect(layout.xaxis.tickformat).toBe("%Y-%m-%d");
        expect(layout.yaxis).toMatchObject({ type: "linear", tickformat: "s", ticksuffix: "B" });
        expect(fetched_urls()).toContain(
            "https://raw.githubusercontent.com/dandi/access-summaries/main/content/summaries/archive/by_day.tsv"
        );
    });

    it("lists the same days in the table, highest bytes first", async () => {
        await load_page();
        expect(table_title("over_time_table")).toBe("Usage per day");
        expect(table_headers("over_time_table")).toEqual(["Date", "Bytes", "Views", "Downloads", "Requests"]);
        expect(table_rows("over_time_table")[0]).toEqual(["2024-01-04", "300 MB", "88", "320", "1,000"]);
        expect(table_rows("over_time_table")).toHaveLength(7);
    });

    it.each([
        ["weekly", ["2024-01-01"], "GB per week", "Usage per week", "Week of", "%Y-%m-%d"],
        ["monthly", ["2024-01"], "GB per month", "Usage per month", "Month", "%Y-%m"],
        ["yearly", ["2024"], "GB per year", "Usage per year", "Year", "%Y"],
    ])("bins the days by %s", async (aggregation, bins, title, table, date_column, tickformat) => {
        await load_page();
        choose("time_aggregation", aggregation);
        await settle();

        const { data, layout } = last_plot("over_time_plot");
        expect(data[0].x).toEqual(bins);
        expect(data[0].y).toEqual([1.4e9]);
        expect(data[0].text[0]).toContain("Bytes: 1.4 GB<br>Views: 381<br>Downloads: 1,330<br>Requests: 4,380");
        expect(layout.title.text).toBe(title);
        expect(layout.xaxis.tickformat).toBe(tickformat);
        expect(table_title("over_time_table")).toBe(table);
        expect(table_headers("over_time_table")[0]).toBe(date_column);
        expect(url_params().get("aggregation")).toBe(aggregation);
    });

    it("accumulates the bytes to date and closes the gaps between the days it has", async () => {
        serve("/archive/by_day.tsv", "date\tbytes_sent\n2024-01-01\t100\n2024-01-02\t200\n2024-01-04\t400\n");
        await load_page();
        check("cumulative", true);
        await settle();

        const { data, layout } = last_plot("over_time_plot");
        expect(data[0].y).toEqual([100, 300, 700]);
        expect(layout.title.text).toBe("Total Bytes to date");
        expect(layout.xaxis.rangebreaks).toEqual([{ values: ["2024-01-03"] }]);
        expect(url_params().get("cumulative")).toBe("true");

        check("cumulative", false);
        await settle();
        expect(last_plot("over_time_plot").data[0].y).toEqual([100, 200, 400]);
        expect(url_params().has("cumulative")).toBe(false);
    });

    it("closes the days between weekly bins, up to the end of the last week", async () => {
        serve("/archive/by_day.tsv", "date\tbytes_sent\n2024-01-01\t100\n2024-01-02\t200\n2024-01-08\t400\n");
        await load_page({ url: "/?cumulative=true&aggregation=weekly" });
        const { data, layout } = last_plot("over_time_plot");
        expect(data[0].x).toEqual(["2024-01-01", "2024-01-08"]);
        expect(data[0].y).toEqual([300, 700]);
        expect(layout.xaxis.rangebreaks[0].values).toHaveLength(12);
        expect(layout.xaxis.rangebreaks[0].values).not.toContain("2024-01-08");
        expect(layout.xaxis.rangebreaks[0].values).toContain("2024-01-14");
    });

    it("closes the days between monthly bins, up to the end of the last month", async () => {
        serve("/archive/by_day.tsv", "date\tbytes_sent\n2024-01-31\t100\n2024-02-01\t200\n");
        await load_page({ url: "/?cumulative=true&aggregation=monthly" });
        const { data, layout } = last_plot("over_time_plot");
        expect(data[0].x).toEqual(["2024-01", "2024-02"]);
        // January and a leap February, less the first day of each
        expect(layout.xaxis.rangebreaks[0].values).toHaveLength(31 + 29 - 2);
        expect(layout.xaxis.rangebreaks[0].values).toContain("2024-02-29");
    });

    it("leaves a cumulative yearly plot without range breaks", async () => {
        await load_page({ url: "/?cumulative=true&aggregation=yearly" });
        expect(last_plot("over_time_plot").layout.xaxis.rangebreaks).toBeUndefined();
    });

    it("draws a filled line instead of bars when asked to", async () => {
        await load_page();
        change("ot_plot_type", "line");
        await settle();
        expect(last_plot("over_time_plot").data[0]).toMatchObject({
            type: "scatter",
            mode: "lines",
            fill: "tozeroy",
            fillcolor: "rgba(83,168,182,0.2)",
        });
        expect(url_params().get("ot_plot_type")).toBe("line");

        change("ot_plot_type", "bar");
        await settle();
        expect(url_params().has("ot_plot_type")).toBe(false);
    });

    it("names the byte decades on a log axis", async () => {
        await load_page();
        check("log_scale", true);
        await settle();
        expect(last_plot("over_time_plot").layout.yaxis).toMatchObject({
            type: "log",
            ticksuffix: "",
            tickvals: [1e3, 1e6, 1e9, 1e12, 1e15],
            ticktext: ["KB", "MB", "GB", "TB", "PB"],
        });
        expect(last_plot("histogram_plot").layout.yaxis.type).toBe("log");
        expect(url_params().get("log")).toBe("true");
    });

    it("plots the chosen metric and leads the hover text with it", async () => {
        await load_page();
        change("over_time_metric", "views");
        await settle();
        const { data, layout } = last_plot("over_time_plot");
        expect(data[0].y).toEqual(VIEWS);
        expect(data[0].text[0]).toBe("2024-01-01<br>Views: 35<br>Bytes: 100 MB<br>Downloads: 120<br>Requests: 400");
        expect(layout.title.text).toBe("Views per day");
        expect(layout.yaxis.ticksuffix).toBe("");
        expect(url_params().get("ot_metric")).toBe("views");

        change("over_time_metric", "bytes");
        await settle();
        expect(url_params().has("ot_metric")).toBe(false);
    });

    it("formats bytes with binary prefixes when asked to", async () => {
        await load_page();
        change("prefix", "binary");
        await settle();
        expect(last_plot("over_time_plot").layout.title.text).toBe("MiB per day");
        expect(totals()[0]).toEqual(["Transferred", "13.64 TiB"]);
        expect(table_rows("over_time_table")[0][1]).toBe("286.1 MiB");
        expect(url_params().get("prefix")).toBe("binary");
    });

    it("switches between the plot and its table, hiding the plot-only controls with the plot", async () => {
        await load_page();
        by_id("ot_settings_btn").click();
        expect(by_id("ot_settings_panel").classList.contains("open")).toBe(true);

        choose("over_time_view", "table");
        expect(by_id("over_time_plot").style.display).toBe("none");
        expect(by_id("over_time_table").style.display).toBe("");
        expect(by_id("over_time_metric_group").style.display).toBe("none");
        expect(by_id("ot_settings_container").style.display).toBe("none");
        expect(by_id("ot_settings_panel").classList.contains("open")).toBe(false);
        expect(by_id("ot_settings_btn").getAttribute("aria-expanded")).toBe("false");
        expect(url_params().get("over_time")).toBe("table");
        expect(plotly.Plots.resize).not.toHaveBeenCalled();

        choose("over_time_view", "plot");
        expect(by_id("over_time_plot").style.display).toBe("");
        expect(by_id("over_time_table").style.display).toBe("none");
        expect(by_id("ot_settings_container").style.display).toBe("contents");
        expect(url_params().has("over_time")).toBe(false);
        expect(plotly.Plots.resize).toHaveBeenCalledWith(by_id("over_time_plot"));
    });

    it("reports a summary that cannot be fetched in place of the plot", async () => {
        serve("/archive/by_day.tsv", not_found);
        await load_page();
        expect(by_id("over_time_plot").textContent).toBe("Failed to load data for per day plot.");
        expect(plot_calls("over_time_plot")).toHaveLength(0);
    });
});

describe("usage over time grouped by Dandiset", () => {
    it("stacks the top Dandisets by bytes with the rest of the archive as Other", async () => {
        await load_page();
        change("over_time_group_by", "dandisets");
        await settle();

        const { data, layout } = last_plot("over_time_plot");
        expect(data.map((trace: any) => trace.name)).toEqual([
            "DANDI:000001",
            "DANDI:000002",
            "DANDI:000003",
            "DANDI:000004",
            "Other",
        ]);
        expect(data[0]).toMatchObject({ type: "bar", x: DATES, y: BYTES });
        expect(data[0].text[0]).toBe(
            "000001 - Mock electrophysiology recordings<br>2024-01-01<br>Bytes: 100 MB<br>Views: 35<br>Downloads: 120<br>Requests: 400"
        );
        expect(data[2].text[0]).toMatch(/^000003<br>/);
        // Every Dandiset carries the whole archive's traffic in this fixture, so
        // nothing is left over for Other; the difference is clamped, not negative.
        expect(data[4].y).toEqual(DATES.map(() => 0));
        expect(data[4].text[0]).toBe(
            "Other<br>2024-01-01<br>Bytes: 0 Bytes<br>Views: 0<br>Downloads: 0<br>Requests: 0"
        );
        expect(layout.barmode).toBe("stack");
        expect(layout.legend.title.text).toBe("Dandiset");
        // Titled by the height of the stack, four Dandisets' 300 MB days together
        expect(layout.title.text).toBe("GB per day");
        expect(url_params().get("group_by")).toBe("dandisets");
        expect(table_title("over_time_table")).toBe("Usage per day");
    });

    it("plots as many Dandisets as the setting asks for, and only redraws when it applies", async () => {
        await load_page();
        change("top_n_dandisets", "2");
        await settle();
        expect(url_params().get("top_n")).toBe("2");
        expect(last_plot("over_time_plot").data).toHaveLength(1);

        change("over_time_group_by", "dandisets");
        await settle();
        expect(last_plot("over_time_plot").data.map((trace: any) => trace.name)).toEqual([
            "DANDI:000001",
            "DANDI:000002",
            "Other",
        ]);

        change("top_n_dandisets", "not a number");
        await settle();
        expect(by_id<HTMLInputElement>("top_n_dandisets").value).toBe("8");
        expect(url_params().has("top_n")).toBe(false);
        expect(last_plot("over_time_plot").data).toHaveLength(5);
    });

    it("overlays the bars, or stacks and fills the lines, as the settings say", async () => {
        await load_page({ url: "/?group_by=dandisets" });
        change("ot_stacked", "overlay");
        await settle();
        expect(last_plot("over_time_plot").layout.barmode).toBe("overlay");
        expect(url_params().get("stacked")).toBe("false");

        change("ot_plot_type", "line");
        await settle();
        expect(last_plot("over_time_plot").data[0]).toMatchObject({
            type: "scatter",
            fill: "tozeroy",
            fillcolor: "rgba(88,174,192,0.2)",
        });
        expect(last_plot("over_time_plot").data[4].fillcolor).toBe("rgba(150,150,150,0.15)");
        expect(last_plot("over_time_plot").layout.barmode).toBeUndefined();

        change("ot_stacked", "stacked");
        await settle();
        expect(last_plot("over_time_plot").data[0].stackgroup).toBe("one");
        expect(last_plot("over_time_plot").data[4].stackgroup).toBe("one");
        expect(url_params().has("stacked")).toBe(false);
    });

    it("plots the chosen metric per Dandiset, with the aggregation and cumulative settings", async () => {
        await load_page({ url: "/?group_by=dandisets&ot_metric=views&aggregation=weekly&cumulative=true" });
        const { data, layout } = last_plot("over_time_plot");
        expect(data[0].x).toEqual(["2024-01-01"]);
        expect(data[0].y).toEqual([381]);
        expect(data[0].text[0]).toContain("<br>Week of 2024-01-01<br>Views: 381<br>");
        expect(layout.title.text).toBe("Total Views to date");
    });

    it("skips a Dandiset whose summary cannot be fetched", async () => {
        serve("/000003/by_day.tsv", not_found);
        await load_page({ url: "/?group_by=dandisets" });
        expect(last_plot("over_time_plot").data.map((trace: any) => trace.name)).toEqual([
            "DANDI:000001",
            "DANDI:000002",
            "DANDI:000004",
            "Other",
        ]);
        expect(console.warn).toHaveBeenCalledWith(
            expect.stringContaining("Skipping dandiset 000003"),
            expect.anything()
        );
    });

    it("leaves Other out when the archive's own summary cannot be fetched", async () => {
        serve("/archive/by_day.tsv", not_found);
        await load_page({ url: "/?group_by=dandisets" });
        expect(last_plot("over_time_plot").data.map((trace: any) => trace.name)).not.toContain("Other");
    });

    it("reports a plot that fails to draw", async () => {
        // Thrown rather than rejected: the module does not wait on newPlot, so
        // only a throw reaches the handler that reports the failure.
        plotly.newPlot.mockImplementation((target, ...rest) => {
            if (target === "over_time_plot") throw new Error("no canvas");
            return draw_plot(target, ...rest);
        });
        await load_page({ url: "/?group_by=dandisets" });
        expect(by_id("over_time_plot").textContent).toBe("Failed to load data for grouped per day plot.");
        expect(last_plot("histogram_plot").data[0].type).toBe("bar");
    });

    it("offers the grouping for the archive alone, and drops it when a Dandiset is selected", async () => {
        await load_page({ url: "/?group_by=dandisets" });
        const option = query<HTMLOptionElement>('#over_time_group_by option[value="dandisets"]');
        expect(option.hidden).toBe(false);

        change("dandiset_selector", "000001");
        await settle();
        expect(option.hidden).toBe(true);
        expect(by_id<HTMLSelectElement>("over_time_group_by").value).toBe("none");
        expect(last_plot("over_time_plot").data).toHaveLength(1);
    });
});

describe("usage over time grouped by asset type", () => {
    it("stacks the weekly bytes of each asset type, the unaccounted-for remainder on top", async () => {
        await load_page();
        change("over_time_group_by", "asset_type");
        await settle();

        const { data, layout } = last_plot("over_time_plot");
        expect(data.map((trace: any) => trace.name)).toEqual([
            "Neurophysiology",
            "Microscopy",
            "Video",
            "Miscellaneous",
            "Undetermined file types",
        ]);
        expect(data[0]).toMatchObject({ type: "bar", x: ["2024-01-01", "2024-01-08"], y: [5e7, 6e7] });
        expect(data[0].text[0]).toBe("Neurophysiology<br>Week of 2024-01-01<br>50 MB");
        // The archive moved 1.4 GB in the first week, of which the breakdown
        // accounts for 110 MB; the second week has no daily data at all.
        expect(data[4].y).toEqual([1.29e9, 0]);
        expect(layout.barmode).toBe("stack");
        expect(layout.legend.title.text).toBe("Asset type");
        expect(layout.title.text).toBe("GB per week");
        expect(url_params().get("group_by")).toBe("asset_type");
    });

    it("restricts the controls to what the weekly, bytes-only data can show", async () => {
        await load_page();
        change("over_time_group_by", "asset_type");
        await settle();
        const daily = by_id<HTMLInputElement>("aggregation_daily");
        expect(daily.disabled).toBe(true);
        expect(daily.checked).toBe(false);
        expect(by_id<HTMLInputElement>("aggregation_weekly").checked).toBe(true);
        expect(query<HTMLLabelElement>('label[for="aggregation_daily"]').title).toContain(
            "Daily data is not available"
        );
        const metric = by_id<HTMLSelectElement>("over_time_metric");
        expect(metric.disabled).toBe(true);
        expect(metric.value).toBe("bytes");
        expect(url_params().get("aggregation")).toBe("weekly");

        change("over_time_group_by", "none");
        await settle();
        expect(daily.disabled).toBe(false);
        expect(metric.disabled).toBe(false);
        expect(query<HTMLLabelElement>('label[for="aggregation_daily"]').title).toBe("");
    });

    it("tables the breakdown's weekly totals beside the archive's other metrics", async () => {
        await load_page({ url: "/?group_by=asset_type" });
        expect(table_title("over_time_table")).toBe("Usage per week");
        expect(table_headers("over_time_table")).toEqual(["Week of", "Bytes", "Views", "Downloads", "Requests"]);
        expect(table_rows("over_time_table")).toEqual([
            ["2024-01-08", "135 MB", "0", "0", "0"],
            ["2024-01-01", "110 MB", "381", "1,330", "4,380"],
        ]);
    });

    it.each([
        ["monthly", ["2024-01"], "GB per month", "Usage per month"],
        ["yearly", ["2024"], "GB per year", "Usage per year"],
    ])("bins the weeks by %s", async (aggregation, bins, title, table) => {
        await load_page({ url: `/?group_by=asset_type&aggregation=${aggregation}` });
        const { data, layout } = last_plot("over_time_plot");
        expect(data[0].x).toEqual(bins);
        expect(data[0].y).toEqual([1.1e8]);
        expect(data[0].text[0]).toBe(
            `Neurophysiology<br>${aggregation === "monthly" ? "Month: 2024-01" : "Year: 2024"}<br>110 MB`
        );
        // Differenced per week before binning: the second week is fully
        // unaccounted for as far as the breakdown knows, the first mostly.
        expect(data[4].y).toEqual([1.29e9]);
        expect(layout.title.text).toBe(title);
        expect(table_title("over_time_table")).toBe(table);
    });

    it("draws stacked or filled lines and accumulates them like the bars", async () => {
        await load_page({ url: "/?group_by=asset_type&ot_plot_type=line&cumulative=true" });
        let { data, layout } = last_plot("over_time_plot");
        expect(data[0]).toMatchObject({ type: "scatter", mode: "lines", stackgroup: "one", y: [5e7, 1.1e8] });
        expect(data[4]).toMatchObject({ stackgroup: "one", y: [1.29e9, 1.29e9] });
        expect(layout.barmode).toBeUndefined();
        expect(layout.title.text).toBe("Total GB to date");

        change("ot_stacked", "overlay");
        await settle();
        ({ data } = last_plot("over_time_plot"));
        expect(data[0]).toMatchObject({ fill: "tozeroy", fillcolor: "rgba(88,174,192,0.2)" });
        expect(data[4]).toMatchObject({ fill: "tozeroy", fillcolor: "rgba(150,150,150,0.15)" });
    });

    it("overlays the bars when asked to", async () => {
        await load_page({ url: "/?group_by=asset_type&stacked=false" });
        expect(last_plot("over_time_plot").layout.barmode).toBe("overlay");
    });

    it("leaves the remainder out when the breakdown accounts for every byte", async () => {
        serve("/archive/by_day.tsv", "date\tbytes_sent\n2024-01-01\t1000\n2024-01-08\t1000\n");
        await load_page({ url: "/?group_by=asset_type" });
        expect(last_plot("over_time_plot").data.map((trace: any) => trace.name)).not.toContain(
            "Undetermined file types"
        );
    });

    it("tables the breakdown alone when the archive's summary cannot be fetched", async () => {
        serve("/archive/by_day.tsv", not_found);
        await load_page({ url: "/?group_by=asset_type" });
        expect(last_plot("over_time_plot").data).toHaveLength(4);
        expect(table_headers("over_time_table")).toEqual(["Week of", "Bytes"]);
        expect(table_rows("over_time_table")).toEqual([
            ["2024-01-08", "135 MB"],
            ["2024-01-01", "110 MB"],
        ]);
    });

    it("describes each asset type on its legend entry, and again after every redraw", async () => {
        await load_page({ url: "/?group_by=asset_type" });
        const plot = by_id("over_time_plot") as any;
        plot.innerHTML =
            '<svg><g class="traces"><text class="legendtext">Neurophysiology</text></g>' +
            '<g class="traces"><text class="legendtext">Microscopy</text></g>' +
            '<g class="traces"><text class="legendtext">Undetermined file types</text></g>' +
            '<text class="legendtext">Video</text></svg>';

        plot.emit("plotly_afterplot");
        const titles = () => Array.from(plot.querySelectorAll(".traces title")).map((title: any) => title.textContent);
        expect(titles()).toEqual(["NWB files", "OME-Zarr, NIfTI, TIFF"]);

        // A redraw keeps a single, current description per entry
        plot.emit("plotly_afterplot");
        expect(titles()).toEqual(["NWB files", "OME-Zarr, NIfTI, TIFF"]);
    });

    it("reports a breakdown that cannot be fetched in place of the plot", async () => {
        serve("/archive/by_asset_type_per_week.tsv", not_found);
        await load_page({ url: "/?group_by=asset_type" });
        expect(by_id("over_time_plot").textContent).toBe("Failed to load data for asset type grouped plot.");
    });
});

// ── Histogram ────────────────────────────────────────────────────────────────

describe("usage per Dandiset", () => {
    it("ranks the Dandisets by views per asset, leaving out those whose asset count is unknown", async () => {
        await load_page();
        const { data, layout } = last_plot("histogram_plot");
        expect(data[0].x).toEqual([
            "000002 - Mock calcium imaging dataset",
            "000001 - Mock electrophysiology recordings",
        ]);
        expect(data[0].y[0]).toBeCloseTo(310 / 12);
        expect(data[0].y[1]).toBe(13.5);
        expect(data[0].text[0]).toBe(
            "000002 - Mock calcium imaging dataset<br>Views / Asset: 25.83<br>Bytes: 3 GB<br>Views: 310<br>Downloads: 450<br>Requests: 4,100"
        );
        expect(layout.title.text).toBe("Views per Asset per Dandiset");
        expect(layout.xaxis.title.text).toBe("(hover over a bar to see the Dandiset)");
        expect(layout.yaxis.ticksuffix).toBe("");
    });

    it("tables every Dandiset with its scaled metrics beside their denominators", async () => {
        await load_page();
        expect(table_headers("histogram_table")).toEqual([
            "Dandiset ID",
            "Name",
            "Views / Asset",
            "Downloads / Asset",
            "Total Assets",
            "Total Views",
            "Total Downloads",
            "Bytes / Size",
            "Total Bytes",
            "Total Size",
        ]);
        const rows = table_rows("histogram_table");
        expect(rows).toHaveLength(5);
        expect(rows[0]).toEqual([
            "000001",
            "Mock electrophysiology recordings",
            "13.5",
            "22.5",
            "40",
            "540",
            "900",
            "20",
            "5 GB",
            "250 MB",
        ]);
        expect(rows[2]).toEqual(["000003", "", "--", "--", "--", "95", "120", "--", "1 GB", "--"]);
        expect(rows[4][0]).toBe("undetermined");
        const link = query<HTMLAnchorElement>("#histogram_table tbody tr:first-child td:nth-child(2) a");
        expect(link.href).toBe("https://dandiarchive.org/dandiset/000001");
        // Only the rows with a name to click on are linked
        expect(document.querySelectorAll("#histogram_table tbody a")).toHaveLength(3);
    });

    it("ranks by whichever metric is chosen, in that metric's units", async () => {
        await load_page();
        change("histogram_metric", "bytes");
        await settle();
        let { data, layout } = last_plot("histogram_plot");
        expect(data[0].x).toEqual([
            "000001 - Mock electrophysiology recordings",
            "000002 - Mock calcium imaging dataset",
            "000003",
            "000004 - A detailed data-driven network model of prefrontal cortex reproduces key features of in vivo activity",
        ]);
        expect(data[0].y).toEqual([5e9, 3e9, 1e9, 8e8]);
        expect(data[0].text[2]).toBe("000003<br>Bytes: 1 GB<br>Views: 95<br>Downloads: 120<br>Requests: 1,200");
        expect(layout.title.text).toBe("GB per Dandiset");
        expect(layout.yaxis.ticksuffix).toBe("B");
        expect(url_params().get("hist_metric")).toBe("bytes");

        change("histogram_metric", "bytes_per_size");
        await settle();
        ({ data, layout } = last_plot("histogram_plot"));
        expect(data[0].y).toEqual([20, 2]);
        expect(layout.title.text).toBe("Bytes transferred relative to total size of Dandiset");

        change("histogram_metric", "views_per_asset");
        await settle();
        expect(url_params().has("hist_metric")).toBe(false);
    });

    it("leaves the testing Dandisets out until asked to include them", async () => {
        serve(
            "/content/totals.json",
            JSON.stringify({
                ...JSON.parse(ALL_DANDISET_TOTALS),
                "000027": {
                    total_bytes_sent: 9e12,
                    total_number_of_downloads: 1,
                    total_number_of_requests: 1,
                    total_number_of_views: 1,
                    number_of_requesters: 1,
                    number_of_unique_regions: 1,
                    number_of_unique_countries: 1,
                },
            })
        );
        await load_page({ url: "/?hist_metric=bytes" });
        const ids = () => table_rows("histogram_table").map((row) => row[0]);
        expect(ids()).not.toContain("000027");
        expect(last_plot("histogram_plot").data[0].x).not.toContain("000027");

        check("ignore_testing_dandisets", false);
        await settle();
        expect(ids()[0]).toBe("000027");
        expect(last_plot("histogram_plot").data[0].x[0]).toBe("000027");
        expect(url_params().get("ignore_testing")).toBe("false");

        check("ignore_testing_dandisets", true);
        await settle();
        expect(url_params().has("ignore_testing")).toBe(false);
    });

    it("draws a filled line instead of bars when asked to", async () => {
        await load_page();
        change("hist_plot_type", "line");
        await settle();
        expect(last_plot("histogram_plot").data[0]).toMatchObject({ type: "scatter", mode: "lines", fill: "tozeroy" });
        expect(url_params().get("hist_plot_type")).toBe("line");
    });

    it("switches between the plot and its table, hiding the metric selector with the plot", async () => {
        await load_page();
        choose("histogram_view", "table");
        expect(by_id("histogram_plot").style.display).toBe("none");
        expect(by_id("histogram_table").style.display).toBe("");
        expect(by_id("histogram_metric_container").style.display).toBe("none");
        expect(url_params().get("histogram")).toBe("table");

        choose("histogram_view", "plot");
        expect(by_id("histogram_plot").style.display).toBe("");
        expect(by_id("histogram_metric_container").style.display).toBe("");
        expect(plotly.Plots.resize).toHaveBeenCalledWith(by_id("histogram_plot"));
    });

    it("clears the plot when the totals cannot be fetched again", async () => {
        await load_page();
        serve("/content/totals.json", not_found);
        by_id("histogram_plot").innerHTML = "<svg></svg><div></div>";
        change("histogram_metric", "bytes");
        await settle();
        expect(by_id("histogram_plot").childNodes).toHaveLength(0);
        expect(console.error).toHaveBeenCalledWith(
            "Error:",
            expect.objectContaining({ message: "Failed to fetch JSON file: Not Found" })
        );
    });

    it("tables the scaled metrics as unavailable when the content derivatives fail to load", async () => {
        serve("/dandiset_id_to_number_of_assets.jsonl.gz", not_found);
        serve("/dandiset_id_to_total_size.jsonl.gz", not_found);
        await load_page();
        expect(table_rows("histogram_table")[0]).toEqual([
            "000001",
            "Mock electrophysiology recordings",
            "--",
            "--",
            "--",
            "540",
            "900",
            "--",
            "5 GB",
            "--",
        ]);
        expect(last_plot("histogram_plot").data[0].x).toEqual([]);
    });
});

describe("usage per asset", () => {
    it("ranks a Dandiset's assets by bytes, NWB files by their file name", async () => {
        serve(
            "/000001/by_asset.tsv",
            "asset\tbytes_sent\tnumber_of_requests\tnumber_of_downloads\tnumber_of_views\n" +
                "sub-001/func/sub-001_task-rest_bold.nwb\t1000000\t420\t130\t38\n" +
                "sub-002/func/sub-002_task-rest_bold.nwb\t500000\t210\t65\t19\n" +
                "derivatives/labels.json\t2000000\t\t\t\n"
        );
        await load_page();
        change("dandiset_selector", "000001");
        await settle();

        const { data, layout } = last_plot("histogram_plot");
        expect(data[0].x).toEqual([
            "derivatives/labels.json",
            "sub-001_task-rest_bold.nwb",
            "sub-002_task-rest_bold.nwb",
        ]);
        expect(data[0].y).toEqual([2e6, 1e6, 5e5]);
        expect(data[0].text[1]).toBe(
            "sub-001_task-rest_bold.nwb<br>Bytes: 1 MB<br>Views: 38<br>Downloads: 130<br>Requests: 420"
        );
        expect(layout.title.text).toBe("MB per asset");
        expect(table_title("histogram_table")).toBe("Usage per asset");
        expect(table_headers("histogram_table")).toEqual(["Asset", "Bytes", "Views", "Downloads", "Requests"]);
        expect(table_rows("histogram_table")[0]).toEqual(["derivatives/labels.json", "2 MB", "0", "0", "0"]);
    });

    it("offers the raw metrics alone, bytes first, and falls back to bytes from a scaled one", async () => {
        await load_page({ url: "/?hist_metric=downloads_per_asset" });
        expect(by_id<HTMLSelectElement>("histogram_metric").value).toBe("downloads_per_asset");

        change("dandiset_selector", "000001");
        await settle();
        const selector = by_id<HTMLSelectElement>("histogram_metric");
        const options = (hidden: boolean) =>
            Array.from(selector.options)
                .filter((option) => option.hidden === hidden)
                .map((option) => option.value);
        expect(selector.value).toBe("bytes");
        expect(options(false)).toEqual(["bytes", "views", "downloads"]);
        expect(options(true)).toEqual(["views_per_asset", "downloads_per_asset", "bytes_per_size"]);
        expect(by_id("hist_ignore_testing_container").style.display).toBe("none");
        expect(url_params().has("hist_metric")).toBe(false);

        change("histogram_metric", "views");
        await settle();
        expect(last_plot("histogram_plot").layout.title.text).toBe("Views per asset");
        expect(last_plot("histogram_plot").data[0].x).toEqual([
            "sub-001_task-rest_bold.nwb",
            "sub-002_task-rest_bold.nwb",
        ]);
        expect(url_params().get("hist_metric")).toBe("views");

        change("dandiset_selector", "archive");
        await settle();
        expect(options(false)).toEqual([
            "views_per_asset",
            "downloads_per_asset",
            "views",
            "downloads",
            "bytes_per_size",
            "bytes",
        ]);
        expect(options(true)).toEqual([]);
        expect(selector.value).toBe("views");
        expect(by_id("hist_ignore_testing_container").style.display).toBe("");
    });

    it("clears the plot when the per-asset summary cannot be fetched or is empty", async () => {
        serve("/000001/by_asset.tsv", not_found);
        serve("/000002/by_asset.tsv", "asset\tbytes_sent\n");
        await load_page();
        for (const id of ["000001", "000002"]) {
            by_id("histogram_plot").innerHTML = "<svg></svg>";
            change("dandiset_selector", id);
            await settle();
            expect(by_id("histogram_plot").childNodes).toHaveLength(0);
        }
        expect(console.error).toHaveBeenCalledWith(
            "Error:",
            expect.objectContaining({ message: "TSV file does not contain enough data." })
        );
    });

    it("hides the whole section for the undetermined bucket, which has no assets", async () => {
        await load_page();
        const section = by_id("histogram_plot").closest(".view-section") as HTMLElement;
        change("dandiset_selector", "undetermined");
        await settle();
        expect(by_id("histogram").style.display).toBe("none");
        expect(section.style.display).toBe("none");
        expect(by_id("histogram_plot").textContent).toBe("");

        change("dandiset_selector", "000001");
        await settle();
        expect(by_id("histogram").style.display).toBe("");
        expect(section.style.display).toBe("");
    });
});

// ── Pages missing what the module looks for ──────────────────────────────────

describe("a page missing its elements", () => {
    it("reports the Dandiset list failing to load in the first plot", async () => {
        serve("/content/totals.json", not_found);
        await load_page();
        expect(by_id("over_time_plot").textContent).toBe("Failed to load Dandiset IDs and populate default plots.");
        expect(by_id<HTMLSelectElement>("dandiset_selector").options).toHaveLength(0);
    });

    it("reports a missing selector the same way", async () => {
        await load_page({ body: '<div id="over_time_plot"></div>' });
        expect(by_id("over_time_plot").textContent).toBe("Failed to load Dandiset IDs and populate default plots.");
        expect(console.error).toHaveBeenCalledWith(
            "Error:",
            expect.objectContaining({ message: "Dropdown element not found on main page." })
        );
    });

    it("reports the archive totals failing to load, and then the totals it cannot show", async () => {
        serve("/content/archive_totals.json", not_found);
        await load_page();
        expect(by_id("totals").textContent).toBe("Failed to load totals.");
        expect(console.error).toHaveBeenCalledWith(
            "Error:",
            expect.objectContaining({ message: "HTTP error 404: Not Found" })
        );
        // The rest of the page still renders for the archive
        expect(last_plot("over_time_plot").data[0].type).toBe("bar");
    });

    it("still draws the plots on a page stripped of every control", async () => {
        await load_page({
            body:
                '<select id="dandiset_selector"></select><div id="over_time_plot"></div>' +
                '<div id="histogram_plot"></div><div id="geography_heatmap"></div>',
        });
        expect(last_plot("over_time_plot").data[0].type).toBe("bar");
        expect(last_plot("histogram_plot").data[0].type).toBe("bar");
        expect(last_plot("geography_heatmap").data[0].type).toBe("choroplethmap");
        expect(console.error).not.toHaveBeenCalled();

        // The controls' handlers are simply not wired
        window.dispatchEvent(new Event("resize"));
        expect(plotly.Plots.resize).toHaveBeenCalledTimes(3);
    });
});
