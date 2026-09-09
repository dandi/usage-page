// Regenerates `src/configs/region_info.json`, the table the page uses to turn
// the ISO 3166 codes of `by_region.tsv` into something it can draw and label: a
// region there is written as an ISO 3166-1 alpha-3 country code, optionally
// followed by an ISO 3166-2 subdivision code (`USA/CA`, `DNK/84`).
//
// Neither half means anything to the choropleth on its own.  Its boundaries
// come from GADM, which keys its features by alpha-2 country code and an
// English subdivision name, and carries no ISO 3166-2 code at all.  So each
// subdivision code is resolved here, once, against two sources:
//
//   * its English name, from the Unicode CLDR subdivision names, which is what
//     the region tables and the hover labels show; and
//   * the GADM feature that contains it, found by looking up the subdivision's
//     coordinates in the same `region_codes_to_coordinates.yaml` the points
//     view uses and testing which of that country's boundaries the point falls
//     inside.
//
// Resolving by coordinate rather than by name is what makes the mapping hold
// where the two datasets disagree about how a country is divided: GADM splits
// Finland into five regions where ISO 3166-2 lists nineteen, and each of the
// nineteen lands inside one of the five without anyone having to write the
// correspondence down.
//
// Run it after the boundaries or the upstream region codes change:
//
//     node src/scripts/build-region-info.mjs
//
// It reads the coordinates over the network (pass a local path as the first
// argument to use a copy instead) and rewrites the config in place, reporting
// how many codes it resolved.
//
// Each subdivision is written as a [name, boundary] pair, either half of which
// is null where the source it comes from does not cover that code: CLDR names
// no subdivision of a handful of small territories, and a coordinate can fall
// outside every boundary GADM draws for its country.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { load as loadYaml } from "js-yaml";
import { feature as topojsonFeature } from "topojson-client";
import { iso31661 } from "iso-3166";

const COORDINATES_URL =
    "https://raw.githubusercontent.com/dandi/access-summaries/main/content/region_codes_to_coordinates.yaml";

const CONFIGS_DIR = new URL("../configs/", import.meta.url);
const TOPOJSON_PATH = new URL("gadm_admin1_simplified.topojson", CONFIGS_DIR);
const OUTPUT_PATH = new URL("region_info.json", CONFIGS_DIR);

const CLDR_SUBDIVISIONS_PATH = new URL(
    "../../node_modules/cldr-subdivisions-full/subdivisions/en/en.json",
    import.meta.url
);
// Kosovo has no ISO 3166-1 entry, but the summaries report it under the
// user-assigned code the rest of the world settled on for it.
const USER_ASSIGNED_COUNTRIES = [{ alpha2: "XK", alpha3: "XKX" }];

// A subdivision whose coordinates fall outside every one of its country's
// boundaries — an island a simplified coastline dropped, or a point placed just
// off the shore — is assigned the nearest boundary of that country instead, but
// only if it is close enough for "nearest" to mean anything.  Squared degrees,
// so this is a little under three degrees away.
const MAXIMUM_SQUARED_DEGREES_TO_NEAREST = 8;

function read_json(path) {
    return JSON.parse(readFileSync(path, "utf8"));
}

async function read_coordinates(source) {
    if (source) return loadYaml(readFileSync(source, "utf8"));
    const response = await fetch(COORDINATES_URL);
    if (!response.ok) throw new Error(`Failed to fetch ${COORDINATES_URL}: ${response.status}`);
    return loadYaml(await response.text());
}

// True when the point is inside the ring, by the even-odd rule.
function ring_contains(ring, longitude, latitude) {
    let inside = false;
    for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
        const [x_i, y_i] = ring[index];
        const [x_j, y_j] = ring[previous];
        const straddles = y_i > latitude !== y_j > latitude;
        if (straddles && longitude < ((x_j - x_i) * (latitude - y_i)) / (y_j - y_i) + x_i) {
            inside = !inside;
        }
    }
    return inside;
}

// A polygon contains the point when its outer ring does and none of its holes do.
function polygon_contains(polygon, longitude, latitude) {
    if (!ring_contains(polygon[0], longitude, latitude)) return false;
    return polygon.slice(1).every((hole) => !ring_contains(hole, longitude, latitude));
}

function feature_contains(feature, longitude, latitude) {
    const geometry = feature.geometry;
    if (!geometry) return false;
    if (geometry.type === "Polygon") return polygon_contains(geometry.coordinates, longitude, latitude);
    if (geometry.type === "MultiPolygon") {
        return geometry.coordinates.some((polygon) => polygon_contains(polygon, longitude, latitude));
    }
    return false;
}

// The mean of a feature's vertices: crude as centroids go, but it is only ever
// used to rank one boundary of a country against another.
function vertex_mean(feature) {
    let sum_longitude = 0;
    let sum_latitude = 0;
    let count = 0;
    const scan = (coordinates) => {
        if (typeof coordinates[0] === "number") {
            sum_longitude += coordinates[0];
            sum_latitude += coordinates[1];
            count += 1;
        } else {
            coordinates.forEach(scan);
        }
    };
    scan(feature.geometry.coordinates);
    return [sum_longitude / count, sum_latitude / count];
}

const topojson = read_json(TOPOJSON_PATH);
const features = topojsonFeature(topojson, topojson.objects[Object.keys(topojson.objects)[0]]).features;

const features_by_country = {};
features.forEach((feature, index) => {
    const iso2 = feature.properties.iso2;
    if (iso2) (features_by_country[iso2] ??= []).push(index);
});
const vertex_means = features.map(vertex_mean);

const cldr_subdivisions = read_json(CLDR_SUBDIVISIONS_PATH).subdivisions.localeDisplayNames.subdivisions;

// Country names come from the same CLDR the subdivision names do, by way of the
// ICU data Node carries: "United States" and "South Korea" rather than the
// register ISO 3166-1 itself is written in.
const region_display_names = new Intl.DisplayNames(["en"], { type: "region" });

const alpha3_to_alpha2 = {};
const alpha2_to_country_name = {};
for (const entry of [...iso31661, ...USER_ASSIGNED_COUNTRIES]) {
    alpha3_to_alpha2[entry.alpha3] = entry.alpha2;
    alpha2_to_country_name[entry.alpha2] = region_display_names.of(entry.alpha2) ?? entry.name ?? entry.alpha2;
}

const coordinates = await read_coordinates(process.argv[2]);

// The GADM feature a subdivision's coordinates fall in, as that feature's
// English name, or undefined when the country has no boundaries here or the
// point lands too far from all of them.
function gadm_name_for(alpha2, longitude, latitude) {
    const candidates = features_by_country[alpha2] ?? [];
    const containing = candidates.find((index) => feature_contains(features[index], longitude, latitude));
    if (containing !== undefined) return features[containing].properties.name;

    let nearest;
    let nearest_distance = Infinity;
    for (const index of candidates) {
        const [mean_longitude, mean_latitude] = vertex_means[index];
        const distance = (mean_longitude - longitude) ** 2 + (mean_latitude - latitude) ** 2;
        if (distance < nearest_distance) {
            nearest_distance = distance;
            nearest = index;
        }
    }
    if (nearest !== undefined && nearest_distance <= MAXIMUM_SQUARED_DEGREES_TO_NEAREST) {
        return features[nearest].properties.name;
    }
    return undefined;
}

// Every ISO 3166-2 code CLDR names, plus the boundary each one sits in where
// the coordinates place it inside one.
const subdivisions = {};
for (const [cldr_key, name] of Object.entries(cldr_subdivisions)) {
    const alpha2 = cldr_key.slice(0, 2).toUpperCase();
    const subdivision_code = cldr_key.slice(2).toUpperCase();
    if (!(alpha2 in alpha2_to_country_name)) continue;
    (subdivisions[alpha2] ??= {})[subdivision_code] = [name, null];
}

let placed = 0;
let unplaced = 0;
for (const [region_key, point] of Object.entries(coordinates)) {
    const separator = region_key.indexOf("/");
    if (separator < 0) continue;
    const alpha3 = region_key.slice(0, separator);
    const subdivision_code = region_key.slice(separator + 1).toUpperCase();
    const alpha2 = alpha3_to_alpha2[alpha3];
    if (!alpha2 || !/^[A-Z]{3}$/.test(alpha3)) continue;

    const gadm_name = gadm_name_for(alpha2, point.longitude, point.latitude);
    if (!gadm_name) {
        unplaced += 1;
        continue;
    }
    // A code CLDR does not name keeps a null name rather than the code echoed
    // back as one; the page falls back to showing the code itself.
    const country_subdivisions = (subdivisions[alpha2] ??= {});
    (country_subdivisions[subdivision_code] ??= [null, null])[1] = gadm_name;
    placed += 1;
}

const output = { alpha3_to_alpha2, alpha2_to_country_name, subdivisions };
writeFileSync(fileURLToPath(OUTPUT_PATH), `${JSON.stringify(output, null, 2)}\n`);

const all_subdivisions = Object.values(subdivisions).flatMap((entries) => Object.values(entries));
const unnamed = all_subdivisions.filter(([name]) => name === null).length;
console.log(
    `Wrote ${fileURLToPath(OUTPUT_PATH)}: ` +
        `${Object.keys(alpha2_to_country_name).length} countries, ${all_subdivisions.length} subdivisions ` +
        `(${unnamed} of them unnamed by CLDR), ${placed} placed on a GADM boundary, ` +
        `${unplaced} with coordinates but no boundary.`
);
