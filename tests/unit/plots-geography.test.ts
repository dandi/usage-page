import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    after_each,
    before_each,
    by_id,
    choose,
    fake_map,
    fetched_urls,
    install_environment,
    last_plot,
    load_page,
    not_found,
    plot_calls,
    plotly,
    query,
    serve,
    settle,
    table_headers,
    table_rows,
    table_title,
    url_params,
    type PlotElement,
} from "./plots-harness.js";

// The stub is taken from the global the harness keeps it in (see PLOTLY_STUB_GLOBAL)
vi.mock("plotly.js-dist-min", () => ({ default: (globalThis as any).__plots_harness_plotly__ }));

install_environment();
beforeEach(before_each);
afterEach(after_each);

const HEADER = "region\tbytes_sent\tnumber_of_requests\tnumber_of_downloads\tnumber_of_views\n";

// One row for each way a region key reaches a boundary of the mock topology,
// and for each way it does not (see tests/fixtures/mock-topology.js).
const EVERY_KIND_OF_REGION =
    HEADER +
    "USA/CA\t5000000000\t3200\t900\t260\n" + // through the region table's boundary
    "USA/AK\t1000000\t10\t2\t1\n" + // likewise, a boundary partly across the antimeridian
    "DEU/BY\t2000000000\t1400\t380\t110\n" + // through the region table
    "DE/Bavaria\t500000000\t100\t20\t5\n" + // an older key, by alias, onto the same boundary
    "DE/Baden\t400000000\t80\t10\t4\n" + // by substring
    "GB/England\t1500000000\t1050\t290\t85\n" + // an older key, by name
    "HK/Hong Kong Island\t300000000\t60\t9\t3\n" + // remapped onto China's boundaries
    "SG/Central Singapore\t200000000\t40\t5\t2\n" + // remapped to nothing
    "RUS/CHU\t100000000\t20\t3\t1\n" + // a boundary wholly across the antimeridian
    "AQ/Nowhere\t100000000\t20\t3\t1\n" + // a boundary with no geometry
    "IT/Roma\t100000000\t20\t3\t1\n" + // a point
    "FRA/IDF\t100000000\t20\t3\t1\n" + // a name to be matched without its accents
    "DNK/84\t100000000\t20\t3\t1\n" + // a subdivision the topology has no boundary for
    "NLD\t100000000\t20\t3\t1\n" + // located no further than a country
    "AWS/us-east-1\t8000000000\t5100\t1500\t420\n" +
    "VPN\t50000000\t10\t2\t1\n";

// ── Cloud tables ─────────────────────────────────────────────────────────────

describe("cloud region tables", () => {
    it("lists each provider's regions under the bytes sent to it", async () => {
        await load_page();
        expect(table_title("aws_histogram")).toBe("8 GB sent to AWS data centers");
        expect(table_headers("aws_histogram")).toEqual(["AWS Region", "Bytes", "Views", "Downloads", "Requests"]);
        expect(table_rows("aws_histogram")).toEqual([["us-east-1", "8 GB", "420", "1,500", "5,100"]]);
        expect(table_title("gcp_histogram")).toBe("6 GB sent to GCP data centers");
        expect(table_rows("gcp_histogram")).toEqual([["us-central1", "6 GB", "310", "1,100", "4,200"]]);
    });

    it("shows nothing for a provider the selection sent nothing to", async () => {
        serve("/by_region.tsv", HEADER + "USA/CA\t5000000000\t3200\t900\t260\n");
        await load_page();
        expect(by_id("aws_histogram").innerHTML).toBe("");
        expect(by_id("gcp_histogram").innerHTML).toBe("");
    });

    it("shows nothing when the summary is empty or cannot be fetched", async () => {
        serve("/archive/by_region.tsv", HEADER);
        serve("/000001/by_region.tsv", not_found);
        await load_page();
        expect(by_id("aws_histogram").innerHTML).toBe("");

        choose("geo_view", "aws");
        by_id("aws_histogram").innerHTML = "stale";
        (document.getElementById("dandiset_selector") as HTMLSelectElement).value = "000001";
        by_id("dandiset_selector").dispatchEvent(new Event("change"));
        await settle();
        expect(by_id("aws_histogram").innerHTML).toBe("");
    });
});

// ── The region table ─────────────────────────────────────────────────────────

describe("usage per region", () => {
    it("names each region, cloud regions left out, highest bytes first", async () => {
        await load_page();
        expect(table_headers("top_regions_table")).toEqual(["Region", "Bytes", "Views", "Downloads", "Requests"]);
        expect(table_rows("top_regions_table")).toEqual([
            ["California, United States", "5 GB", "260", "900", "3,200"],
            ["Bavaria, Germany", "2 GB", "110", "380", "1,400"],
            ["England, United Kingdom", "1.5 GB", "85", "290", "1,050"],
        ]);
    });

    it("sums the rows that resolve to the same place, however they are keyed", async () => {
        serve("/by_region.tsv", EVERY_KIND_OF_REGION);
        await load_page();
        const rows = table_rows("top_regions_table");
        expect(rows.find((row) => row[0] === "Bavaria, Germany")).toEqual([
            "Bavaria, Germany",
            "2.5 GB",
            "115",
            "400",
            "1,500",
        ]);
        expect(rows.map((row) => row[0])).toContain("Netherlands (unspecified)");
        expect(rows.map((row) => row[0])).toContain("VPN");
        expect(rows.map((row) => row[0])).not.toContain("AWS us-east-1");
    });

    it("falls back to the codes themselves when the region table cannot be fetched", async () => {
        serve("region_info.json", not_found);
        await load_page();
        expect(table_rows("top_regions_table").map((row) => row[0])).toEqual(["USA/CA", "DEU/BY", "England, GB"]);
        expect(console.error).toHaveBeenCalledWith("Error loading region info:", expect.anything());
    });

    it("shows nothing when the summary is empty, holds no places, or cannot be fetched", async () => {
        serve("/archive/by_region.tsv", HEADER);
        serve("/000001/by_region.tsv", HEADER + "AWS/us-east-1\t8000000000\t5100\t1500\t420\n");
        serve("/000002/by_region.tsv", not_found);
        await load_page();
        for (const id of ["archive", "000001", "000002"]) {
            by_id("top_regions_table").innerHTML = "stale";
            (by_id("dandiset_selector") as HTMLSelectElement).value = id;
            by_id("dandiset_selector").dispatchEvent(new Event("change"));
            await settle();
            expect(by_id("top_regions_table").innerHTML).toBe("");
        }
    });
});

// ── The choropleth ───────────────────────────────────────────────────────────

describe("usage by region, as countries", () => {
    it("paints every boundary of a country with the country's total", async () => {
        await load_page();
        const { data, layout } = last_plot("geography_heatmap");
        expect(data[0]).toMatchObject({
            type: "choroplethmap",
            featureidkey: "properties.id",
            locations: [1, 2, 3, 4, 5],
            hoverinfo: "skip",
        });
        expect(data[0].z.map((z: number) => Number(z.toFixed(3)))).toEqual([9.699, 9.699, 9.301, 9.301, 9.176]);
        expect(data[0].text).toEqual([
            "United States<br>5 GB<br>Requests: 3,200<br>Downloads: 900<br>Views: 260",
            "United States<br>5 GB<br>Requests: 3,200<br>Downloads: 900<br>Views: 260",
            "Germany<br>2 GB<br>Requests: 1,400<br>Downloads: 380<br>Views: 110",
            "Germany<br>2 GB<br>Requests: 1,400<br>Downloads: 380<br>Views: 110",
            "United Kingdom<br>1.5 GB<br>Requests: 1,050<br>Downloads: 290<br>Views: 85",
        ]);
        // No borders within a country, and no seams where its boundaries meet
        expect(data[0].marker).toEqual({ line: { color: "white", width: 0 }, opacity: 1 });
        expect(layout.title.text).toBe("Usage by region");
        expect(layout.map).toMatchObject({ style: "carto-darkmatter", center: { lat: 40 } });
        expect(layout.map.minzoom).toBeCloseTo(layout.map.zoom - 0.15);
        expect(fake_map().setMinZoom).toHaveBeenCalledWith(layout.map.minzoom);
    });

    it("drops the part of a boundary that crosses the antimeridian, and keeps the rest", async () => {
        await load_page();
        const features = last_plot("geography_heatmap").data[0].geojson.features;
        const alaska = features.find((feature: any) => feature.properties.name === "Alaska");
        expect(alaska.geometry.type).toBe("MultiPolygon");
        expect(alaska.geometry.coordinates).toHaveLength(1);
        expect(alaska.geometry.coordinates[0][0][0]).toEqual([-170, 55]);
    });

    it("files Hong Kong under China's boundaries and leaves out what has no boundary to paint", async () => {
        serve("/by_region.tsv", EVERY_KIND_OF_REGION);
        await load_page();
        const { data } = last_plot("geography_heatmap");
        // Chukot (7) is dropped for crossing the antimeridian whole, Nowhere (8)
        // has no geometry, and no country holds a boundary for Singapore,
        // Denmark or the Netherlands.
        expect(data[0].locations).toEqual([1, 2, 3, 4, 5, 6, 10, 11]);
        expect(data[0].text[5]).toBe("China<br>300 MB<br>Requests: 60<br>Downloads: 9<br>Views: 3");
        expect(data[0].text[2]).toBe("Germany<br>2.9 GB<br>Requests: 1,580<br>Downloads: 410<br>Views: 119");
        // Every country here moved between 100 MB and 5 GB: a range that holds
        // no two named decades, so the colorbar is labeled by power of ten.
        expect(data[0].colorbar).toEqual({
            title: "Bytes (log scale)",
            tickvals: [8, 10],
            ticktext: ["10^8", "10^10"],
        });
    });

    it("labels the colorbar's decades from KB to PB where the data spans them", async () => {
        await load_page();
        expect(last_plot("geography_heatmap").data[0].colorbar).toEqual({
            title: "Bytes (log scale)",
            tickvals: [9, 10],
            ticktext: ["GB", "10^10"],
        });
    });

    it("gives a colorbar two ticks even when every region carries the same bytes", async () => {
        serve("/by_region.tsv", HEADER + "USA/CA\t1000000000\t1\t1\t1\nGB/England\t1000000000\t1\t1\t1\n");
        await load_page();
        expect(last_plot("geography_heatmap").data[0].colorbar).toEqual({
            title: "Bytes (log scale)",
            tickvals: [9, 10],
            ticktext: ["GB", "10^10"],
        });
    });

    it("draws an empty map, colorbar unlabeled, when no row has a place", async () => {
        serve("/by_region.tsv", HEADER + "AWS/us-east-1\t8000000000\t5100\t1500\t420\nVPN\t50\t1\t1\t1\n");
        await load_page();
        const { data } = last_plot("geography_heatmap");
        expect(data[0].locations).toEqual([]);
        expect(data[0].colorbar).toEqual({ title: "Bytes (log scale)" });
    });

    it("breaks the credits onto a line each, and trims the margins, on a map too narrow for one line", async () => {
        await load_page();
        const wide = last_plot("geography_heatmap").layout;
        expect(wide.annotations[0].text).toContain(" | ");
        expect(wide.margin).toBeUndefined();

        // Redrawn as wide as a phone
        by_id("geography_heatmap").dataset.mockWidth = "390";
        choose("geo_resolution", "countries");
        await settle();
        const narrow = last_plot("geography_heatmap").layout;
        expect(narrow.annotations[0].text).toContain("<br>");
        expect(narrow.annotations[0].text).not.toContain(" | ");
        expect(narrow.margin).toEqual({ l: 8, b: 8 });
        expect(narrow.map.zoom).toBeLessThan(wide.map.zoom);
    });
});

describe("usage by region, as subdivisions", () => {
    it("paints each subdivision, matched by code, name, alias or substring", async () => {
        serve("/by_region.tsv", EVERY_KIND_OF_REGION);
        await load_page({ url: "/?resolution=subdivisions" });
        expect(query<HTMLInputElement>('input[name="geo_resolution"][value="subdivisions"]').checked).toBe(true);
        const { data } = last_plot("geography_heatmap");
        expect(data[0].locations).toEqual([1, 2, 3, 4, 5, 6, 10, 11]);
        expect(data[0].text).toEqual([
            "California, United States<br>5 GB<br>Requests: 3,200<br>Downloads: 900<br>Views: 260",
            "Alaska, United States<br>1 MB<br>Requests: 10<br>Downloads: 2<br>Views: 1",
            "Bayern, Germany<br>2.5 GB<br>Requests: 1,500<br>Downloads: 400<br>Views: 115",
            "Baden-Württemberg, Germany<br>400 MB<br>Requests: 80<br>Downloads: 10<br>Views: 4",
            "England, United Kingdom<br>1.5 GB<br>Requests: 1,050<br>Downloads: 290<br>Views: 85",
            "Hong Kong, China<br>300 MB<br>Requests: 60<br>Downloads: 9<br>Views: 3",
            "Île-de-France, France<br>100 MB<br>Requests: 20<br>Downloads: 3<br>Views: 1",
            "Roma, Italy<br>100 MB<br>Requests: 20<br>Downloads: 3<br>Views: 1",
        ]);
        // Borders between subdivisions, drawn a little translucent
        expect(data[0].marker).toEqual({ line: { color: "white", width: 0.5 }, opacity: 0.8 });
    });

    it("redraws at the new resolution when it is switched, and records it in the URL", async () => {
        await load_page();
        expect(plot_calls("geography_heatmap")).toHaveLength(1);

        choose("geo_resolution", "subdivisions");
        await settle();
        expect(plot_calls("geography_heatmap")).toHaveLength(2);
        expect(last_plot("geography_heatmap").data[0].locations).toEqual([1, 3, 5]);
        expect(url_params().get("resolution")).toBe("subdivisions");

        choose("geo_resolution", "countries");
        await settle();
        expect(url_params().has("resolution")).toBe(false);
        expect(last_plot("geography_heatmap").data[0].locations).toEqual([1, 2, 3, 4, 5]);
    });

    it("keeps painting the regions of the older, alpha-2 keys when the region table cannot be fetched", async () => {
        serve("region_info.json", not_found);
        await load_page({ url: "/?resolution=subdivisions" });
        const { data } = last_plot("geography_heatmap");
        expect(data[0].locations).toEqual([5]);
        expect(data[0].text).toEqual(["England, GB<br>1.5 GB<br>Requests: 1,050<br>Downloads: 290<br>Views: 85"]);
    });
});

describe("the map's hover label", () => {
    const hover = (x: number, y: number) =>
        fake_map().fire("mousemove", { point: [x, y], originalEvent: { clientX: x, clientY: y } });
    const label = () => by_id("geography_heatmap").querySelector(".map-hover-label") as HTMLDivElement | null;

    it("is drawn by the page beside the pointer, from the region under it", async () => {
        await load_page();
        const map = fake_map();
        expect(map.on).toHaveBeenCalledWith("mousemove", expect.any(Function));
        expect(map.on).toHaveBeenCalledWith("mouseout", expect.any(Function));
        expect(by_id("geography_heatmap").style.position).toBe("relative");
        // jsdom lays nothing out, so the plot is given a place on the page
        by_id("geography_heatmap").getBoundingClientRect = () =>
            ({ left: 0, top: 0, width: 800, height: 450 }) as DOMRect;

        map.queryRenderedFeatures.mockReturnValue([{ id: 3 }]);
        hover(120, 80);
        expect(map.queryRenderedFeatures).toHaveBeenCalledWith([120, 80], { layers: ["plotly-trace-layer-0-fill"] });
        expect(label()!.style.visibility).toBe("visible");
        expect(label()!.textContent).toBe("Germany2 GBRequests: 1,400Downloads: 380Views: 110");
        expect(label()!.querySelectorAll("br")).toHaveLength(4);
        // Beside the pointer, centered on it vertically (the label itself measures 0 by 0 here)
        expect(label()!.style.left).toBe("134px");
        expect(label()!.style.top).toBe("80px");
    });

    it("reads the region's id from its properties when the feature carries none", async () => {
        await load_page();
        fake_map().queryRenderedFeatures.mockReturnValue([{ properties: { id: "5" } }]);
        hover(10, 10);
        expect(label()!.textContent).toMatch(/^United Kingdom/);
    });

    it("hides when the pointer leaves the regions, or the map", async () => {
        await load_page();
        const map = fake_map();
        map.queryRenderedFeatures.mockReturnValue([{ id: 1 }]);
        hover(10, 10);
        expect(label()!.style.visibility).toBe("visible");

        map.queryRenderedFeatures.mockReturnValue([]);
        hover(20, 20);
        expect(label()!.style.visibility).toBe("hidden");

        map.queryRenderedFeatures.mockReturnValue([{ id: 999 }]);
        hover(30, 30);
        expect(label()!.style.visibility).toBe("hidden");

        map.queryRenderedFeatures.mockReturnValue([{ id: 1 }]);
        hover(40, 40);
        expect(label()!.style.visibility).toBe("visible");
        map.fire("mouseout");
        expect(label()!.style.visibility).toBe("hidden");
    });

    it("does not ask the map about regions before it has drawn any", async () => {
        await load_page();
        const map = fake_map();
        map.getStyle.mockReturnValue({ layers: [] });
        hover(10, 10);
        expect(map.queryRenderedFeatures).not.toHaveBeenCalled();
        expect(label()).toBeNull();
    });

    it("is placed inside the map's own canvas rather than the plot around it", async () => {
        await load_page();
        const plot = by_id("geography_heatmap");
        const canvas = document.createElement("canvas");
        canvas.className = "maplibregl-canvas";
        canvas.getBoundingClientRect = () => ({ left: 100, top: 50, width: 600, height: 300 }) as DOMRect;
        plot.appendChild(canvas);

        fake_map().queryRenderedFeatures.mockReturnValue([{ id: 1 }]);
        hover(10, 10);
        expect(label()!.style.left).toBe("100px");
        expect(label()!.style.top).toBe("50px");
    });

    it("is wired once per map, and handed the new texts on every redraw", async () => {
        await load_page();
        const map = fake_map();
        choose("geo_resolution", "subdivisions");
        await settle();
        expect(fake_map()).toBe(map);
        expect(map.on).toHaveBeenCalledTimes(2);

        // Named by the boundary now, not by the country it is in
        map.queryRenderedFeatures.mockReturnValue([{ id: 3 }]);
        hover(10, 10);
        expect(label()!.textContent).toMatch(/^Bayern, Germany/);
    });
});

describe("usage by region, as points", () => {
    it("marks each region it has coordinates for, sized and colored by bytes", async () => {
        await load_page();
        choose("geo_view", "points");
        await settle();

        const { data, layout } = last_plot("geography_heatmap");
        expect(data[0]).toMatchObject({ type: "scattergeo", mode: "markers", hoverinfo: "text" });
        expect(data[0].lat).toEqual([52.3555, 48.7904, 36.7783]);
        expect(data[0].lon).toEqual([-1.1743, 11.4979, -119.4179]);
        expect(data[0].text[2]).toBe(
            "California, United States<br>5 GB<br>Requests: 3,200<br>Downloads: 900<br>Views: 260"
        );
        expect(data[0].marker.size[2]).toBeCloseTo(Math.log(5e9) * 0.5);
        expect(data[0].marker.color).toEqual([9, 10, 11].map((_, i) => Math.log10([1.5e9, 2e9, 5e9][i])));
        expect(layout.geo.projection.type).toBe("equirectangular");
        expect(layout.geo.lonaxis.range[1] - layout.geo.lonaxis.range[0]).toBeCloseTo(360 * (800 / 1024));
        expect(layout.geo.bgcolor).toBe("#16213e");
        expect(url_params().get("map")).toBe("points");
        expect(by_id("geo_resolution_control").style.display).toBe("none");
    });

    it.each([
        ["an empty summary", HEADER],
        ["a summary that cannot be fetched", not_found],
    ])("reports %s in place of the map", async (_what, body) => {
        serve("/by_region.tsv", body);
        await load_page({ url: "/?map=points" });
        expect(by_id("geography_heatmap").textContent).toBe("Failed to load data for geographic heatmap.");
        expect(plot_calls("geography_heatmap")).toHaveLength(0);
    });
});

describe("the geographic views", () => {
    it("shows one table at a time in place of the map, without redrawing it", async () => {
        await load_page();
        const drawn = plot_calls("geography_heatmap").length;

        choose("geo_view", "table");
        await settle();
        expect(by_id("geography_heatmap").style.display).toBe("none");
        expect(by_id("geo_table_section").style.display).toBe("");
        expect(by_id("top_regions_table").style.display).toBe("");
        expect(by_id("aws_histogram").style.display).toBe("none");
        expect(by_id("geo_resolution_control").style.display).toBe("none");
        expect(url_params().get("map")).toBe("table");

        choose("geo_view", "gcp");
        await settle();
        expect(by_id("gcp_histogram").style.display).toBe("");
        expect(by_id("top_regions_table").style.display).toBe("none");
        expect(plot_calls("geography_heatmap")).toHaveLength(drawn);

        // Nor does the resolution, which only the region map is drawn from
        choose("geo_resolution", "subdivisions");
        await settle();
        expect(plot_calls("geography_heatmap")).toHaveLength(drawn);

        choose("geo_view", "regions");
        await settle();
        expect(by_id("geography_heatmap").style.display).toBe("");
        expect(by_id("geo_resolution_control").style.display).toBe("");
        expect(plot_calls("geography_heatmap")).toHaveLength(drawn + 1);
        expect(url_params().has("map")).toBe(false);
    });

    it.each([
        ["the region summary", "/archive/by_region.tsv"],
        ["the boundaries", "gadm_admin1_simplified.topojson"],
        ["the name aliases", "name_aliases.json"],
    ])("reports %s failing to load in place of the map", async (_what, file) => {
        serve(file, not_found);
        await load_page();
        expect(by_id("geography_heatmap").textContent).toBe("Failed to load data for geographic choropleth.");
        expect(plot_calls("geography_heatmap")).toHaveLength(0);
    });

    it("fetches the boundaries and the region table once, and the summary on every redraw", async () => {
        await load_page();
        choose("geo_resolution", "subdivisions");
        await settle();
        const fetched = (file: string) => fetched_urls().filter((url) => url.endsWith(file)).length;
        expect(fetched("gadm_admin1_simplified.topojson")).toBe(1);
        expect(fetched("region_info.json")).toBe(1);
        expect(fetched("name_aliases.json")).toBe(1);
        expect(fetched("/archive/by_region.tsv")).toBeGreaterThanOrEqual(2);
    });
});

// ── Resizing ─────────────────────────────────────────────────────────────────

describe("resizing the window", () => {
    it("resizes the plots that are drawn and visible, and re-fits the map's minimum zoom", async () => {
        await load_page({ url: "/?histogram=table" });
        window.dispatchEvent(new Event("resize"));

        expect(plotly.Plots.resize).toHaveBeenCalledWith(by_id("over_time_plot"));
        expect(plotly.Plots.resize).toHaveBeenCalledWith(by_id("geography_heatmap"));
        expect(plotly.Plots.resize).not.toHaveBeenCalledWith(by_id("histogram_plot"));
        expect(plotly.Plots.resize).not.toHaveBeenCalledWith(by_id("aws_histogram"));
        expect(fake_map().setMinZoom).toHaveBeenCalledTimes(2);
    });

    it("leaves the map alone when a table is shown in its place", async () => {
        await load_page({ url: "/?map=aws" });
        window.dispatchEvent(new Event("resize"));
        expect(plotly.Plots.resize).not.toHaveBeenCalledWith(by_id("geography_heatmap"));
    });
});

// ── The mode bar ─────────────────────────────────────────────────────────────

describe("the mode bar", () => {
    it("offers PNG and SVG downloads named after the plot", async () => {
        await load_page();
        const plot = by_id<PlotElement>("over_time_plot");
        const [[png, svg]] = plot.config.modeBarButtonsToAdd;
        expect(plot.config.modeBarButtonsToRemove).toEqual(["toImage"]);

        png.click(plot);
        expect(plotly.downloadImage).toHaveBeenCalledWith(plot, { format: "png", filename: "over_time_plot" });
        svg.click(plot);
        expect(plotly.downloadImage).toHaveBeenCalledWith(plot, { format: "svg", filename: "over_time_plot" });

        const nameless = document.createElement("div");
        png.click(nameless);
        expect(plotly.downloadImage).toHaveBeenLastCalledWith(nameless, { format: "png", filename: "dandi-plot" });
    });

    it("opens the plot's source data on GitHub, where it knows it", async () => {
        await load_page();
        const plot = by_id<PlotElement>("histogram_plot");
        const [, [source]] = plot.config.modeBarButtonsToAdd;
        expect(plot.dataset.sourceDataUrl).toBe(
            "https://github.com/dandi/access-summaries/blob/main/content/totals.json"
        );

        source.click(plot);
        expect(window.open).toHaveBeenCalledWith(
            "https://github.com/dandi/access-summaries/blob/main/content/totals.json",
            "_blank",
            "noopener"
        );

        source.click(document.createElement("div"));
        expect(window.open).toHaveBeenCalledTimes(1);
    });
});
