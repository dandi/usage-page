import { describe, it, expect } from "vitest";
import { normalize_region_name, parse_region_key, type IsoRegionCodes } from "../../src/region-codes.js";
// The generated table the page ships, so that these assertions are about the
// codes the summaries actually use rather than about a hand-written stand-in.
import iso_region_codes from "../../src/configs/iso_region_codes.json";

const ISO_REGION_CODES = iso_region_codes as IsoRegionCodes;

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
        expect(parse_region_key("USA/MA", ISO_REGION_CODES)).toEqual({
            kind: "subdivision",
            country_code: "US",
            subdivision_name: "Massachusetts",
            gadm_name: "Massachusetts",
            label: "Massachusetts, United States",
        });
    });

    it("resolves a numeric subdivision code", () => {
        const parsed = parse_region_key("DNK/84", ISO_REGION_CODES);
        expect(parsed.subdivision_name).toBe("Capital Region");
        expect(parsed.label).toBe("Capital Region, Denmark");
    });

    it("names the boundary a subdivision sits inside where the two divide a country differently", () => {
        // ISO 3166-2 lists nineteen regions of Finland where GADM draws five.
        expect(parse_region_key("FIN/02", ISO_REGION_CODES)).toMatchObject({
            subdivision_name: "South Karelia",
            gadm_name: "Southern Finland",
        });
    });

    it("reads a country code on its own as the country", () => {
        expect(parse_region_key("NLD", ISO_REGION_CODES)).toEqual({
            kind: "country",
            country_code: "NL",
            label: "Netherlands",
        });
    });

    it("still reads the alpha-2 keys and subdivision names of the older summaries", () => {
        expect(parse_region_key("US/California", ISO_REGION_CODES)).toEqual({
            kind: "subdivision",
            country_code: "US",
            subdivision_name: "California",
            gadm_name: undefined,
            label: "California, United States",
        });
    });

    it("splits an older key on its first separator only", () => {
        expect(parse_region_key("TT/Tunapuna/Piarco", ISO_REGION_CODES)).toMatchObject({
            country_code: "TT",
            subdivision_name: "Tunapuna/Piarco",
        });
    });

    it("marks cloud regions as such rather than as places", () => {
        expect(parse_region_key("AWS/us-east-1", ISO_REGION_CODES)).toEqual({
            kind: "cloud",
            provider: "AWS",
            label: "AWS us-east-1",
        });
        expect(parse_region_key("GCP/us-central1", ISO_REGION_CODES).kind).toBe("cloud");
    });

    it("passes through the labels for traffic that has no location", () => {
        for (const key of ["VPN", "GitHub", "unknown", "bogon"]) {
            expect(parse_region_key(key, ISO_REGION_CODES)).toEqual({ kind: "other", label: key });
        }
    });

    it("falls back to the code itself for a subdivision the table does not name", () => {
        expect(parse_region_key("USA/ZZ", ISO_REGION_CODES)).toEqual({
            kind: "subdivision",
            country_code: "US",
            subdivision_name: "ZZ",
            gadm_name: undefined,
            label: "ZZ, United States",
        });
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
