import { describe, it, expect } from "vitest";
import { normalize_region_name, parse_region_key, type RegionInfo } from "../../src/region-codes.js";
// The generated table the page ships, so that these assertions are about the
// codes the summaries actually use rather than about a hand-written stand-in.
import region_info from "../../src/configs/region_info.json";

// TypeScript widens the [name, boundary] pairs of an imported JSON file to
// arrays of unknown length, so the tuple type is asserted here.
const REGION_INFO = region_info as unknown as RegionInfo;

// ── normalize_region_name ────────────────────────────────────────────────────

describe("normalize_region_name", () => {
    it("lowercases and strips accents", () => {
        expect(normalize_region_name("Córdoba")).toBe("cordoba");
        expect(normalize_region_name("Ústecký")).toBe("ustecky");
    });

    it("spells out the letters that carry no accent to strip", () => {
        expect(normalize_region_name("Sjælland")).toBe("sjaelland");
        expect(normalize_region_name("Østfold")).toBe("ostfold");
    });

    it("reduces punctuation that two datasets need not agree on", () => {
        expect(normalize_region_name("Nordrhein-Westfalen")).toBe("nordrhein westfalen");
        expect(normalize_region_name("San Andrés & Providencia")).toBe("san andres and providencia");
        expect(normalize_region_name("Homyel’ Voblasc’")).toBe("homyel voblasc");
    });

    it("drops the words that only say what kind of division it is", () => {
        expect(normalize_region_name("Lima Province")).toBe("lima");
        expect(normalize_region_name("State of Kuwait")).toBe("kuwait");
    });

    it("returns an empty string for an empty name", () => {
        expect(normalize_region_name("")).toBe("");
    });
});

// ── parse_region_key ─────────────────────────────────────────────────────────

describe("parse_region_key", () => {
    it("resolves an ISO 3166-1 alpha-3 and 3166-2 pair to names and a boundary", () => {
        expect(parse_region_key("USA/MA", REGION_INFO)).toEqual({
            kind: "subdivision",
            country_code: "US",
            subdivision_name: "Massachusetts",
            gadm_name: "Massachusetts",
            label: "Massachusetts, United States",
        });
    });

    it("resolves a numeric subdivision code", () => {
        const parsed = parse_region_key("DNK/84", REGION_INFO);
        expect(parsed.subdivision_name).toBe("Capital Region");
        expect(parsed.label).toBe("Capital Region, Denmark");
    });

    it("names the boundary a subdivision sits inside where the two divide a country differently", () => {
        // ISO 3166-2 lists nineteen regions of Finland where GADM draws five.
        expect(parse_region_key("FIN/02", REGION_INFO)).toMatchObject({
            subdivision_name: "South Karelia",
            gadm_name: "Southern Finland",
        });
    });

    it("marks a country code on its own as located no further than the country", () => {
        // These rows sit alongside that country's regions rather than summing
        // them, so the label must not read as a country total.
        expect(parse_region_key("NLD", REGION_INFO)).toEqual({
            kind: "country",
            country_code: "NL",
            label: "Netherlands (unspecified region)",
        });
    });

    it("still reads the alpha-2 keys and subdivision names of the older summaries", () => {
        expect(parse_region_key("US/California", REGION_INFO)).toEqual({
            kind: "subdivision",
            country_code: "US",
            subdivision_name: "California",
            gadm_name: undefined,
            label: "California, United States",
        });
    });

    it("splits an older key on its first separator only", () => {
        expect(parse_region_key("TT/Tunapuna/Piarco", REGION_INFO)).toMatchObject({
            country_code: "TT",
            subdivision_name: "Tunapuna/Piarco",
        });
    });

    it("marks cloud regions as such rather than as places", () => {
        expect(parse_region_key("AWS/us-east-1", REGION_INFO)).toEqual({
            kind: "cloud",
            provider: "AWS",
            label: "AWS us-east-1",
        });
        expect(parse_region_key("GCP/us-central1", REGION_INFO).kind).toBe("cloud");
    });

    it("passes through the labels for traffic that has no location", () => {
        for (const key of ["VPN", "GitHub", "unknown", "bogon"]) {
            expect(parse_region_key(key, REGION_INFO)).toEqual({ kind: "other", label: key });
        }
    });

    it("falls back to the code itself for a subdivision the table does not carry", () => {
        expect(parse_region_key("USA/ZZ", REGION_INFO)).toEqual({
            kind: "subdivision",
            country_code: "US",
            subdivision_name: "ZZ",
            gadm_name: undefined,
            label: "ZZ, United States",
        });
    });

    it("falls back to the code for a subdivision CLDR does not name, keeping its boundary", () => {
        // CLDR names no subdivision of New Caledonia, so NC-S has a boundary
        // but no name of its own.
        expect(parse_region_key("NCL/S", REGION_INFO)).toMatchObject({
            kind: "subdivision",
            country_code: "NC",
            subdivision_name: "S",
            label: "S, New Caledonia",
        });
        expect(parse_region_key("NCL/S", REGION_INFO).gadm_name).toBeTruthy();
    });

    it("keeps reading the older alpha-2 keys when the table is unavailable", () => {
        expect(parse_region_key("US/California", null)).toEqual({
            kind: "subdivision",
            country_code: "US",
            subdivision_name: "California",
            gadm_name: undefined,
            label: "California, US",
        });
        expect(parse_region_key("USA/MA", null)).toEqual({ kind: "other", label: "USA/MA" });
    });
});
