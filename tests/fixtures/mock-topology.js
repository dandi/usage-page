// A stand-in for src/configs/gadm_admin1_simplified.topojson, for the jsdom
// harness of src/plots.ts.
//
// The real file is 14 MB of boundaries, which is far more than a unit test
// needs and takes a noticeable while to parse on every load of the page.  This
// one carries a dozen boxes shaped to exercise each way the choropleth matches
// a region key to a boundary, and each way it decides not to draw one:
//
// - California, Bayern, England and Île-de-France are found through the
//   generated region table, or by name directly.
// - Baden-Württemberg is found by substring ("DE/Baden") and Hong Kong through
//   the remapping of HK onto China's boundaries.
// - Alaska is a MultiPolygon one part of which crosses the antimeridian, so
//   that part alone is dropped; Chukot is a single Polygon crossing it, and is
//   dropped whole.
// - "Nowhere" has no geometry at all, "Roma" is a Point rather than an area,
//   and one boundary carries no country code and so is never matched.
//
// The features carry the same properties the real file's do (iso2, name,
// name_norm, id).  With no `transform`, the arcs are plain coordinates.

/** The ring of a box, west/south to east/north, closed on its first corner. */
function box(west, south, east, north) {
    return [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
    ];
}

const properties = (iso2, name, id) => ({ iso2, name, name_norm: name.toLowerCase(), id });

export const MOCK_TOPOLOGY = {
    type: "Topology",
    objects: {
        data: {
            type: "GeometryCollection",
            geometries: [
                { type: "Polygon", arcs: [[0]], properties: properties("US", "California", 1) },
                { type: "MultiPolygon", arcs: [[[1]], [[2]]], properties: properties("US", "Alaska", 2) },
                { type: "Polygon", arcs: [[3]], properties: properties("DE", "Bayern", 3) },
                { type: "Polygon", arcs: [[4]], properties: properties("DE", "Baden-Württemberg", 4) },
                { type: "Polygon", arcs: [[5]], properties: properties("GB", "England", 5) },
                { type: "Polygon", arcs: [[6]], properties: properties("CN", "Hong Kong", 6) },
                { type: "Polygon", arcs: [[7]], properties: properties("RU", "Chukot", 7) },
                { type: null, properties: properties("AQ", "Nowhere", 8) },
                { type: "Polygon", arcs: [[8]], properties: properties("", "", 9) },
                { type: "Polygon", arcs: [[9]], properties: properties("FR", "Île-de-France", 10) },
                { type: "Point", coordinates: [12.5, 41.9], properties: properties("IT", "Roma", 11) },
            ],
        },
    },
    arcs: [
        box(-124, 32, -114, 42), // 0: California
        box(-170, 55, -140, 72), // 1: mainland Alaska
        [
            // 2: the Aleutians, reaching across the antimeridian
            [170, 51],
            [179, 52],
            [-179, 53],
            [-170, 54],
            [170, 51],
        ],
        box(9, 47, 14, 51), // 3: Bayern
        box(7, 47, 10, 50), // 4: Baden-Württemberg
        box(-6, 50, 2, 56), // 5: England
        box(113.8, 22.1, 114.5, 22.6), // 6: Hong Kong
        [
            // 7: Chukot, across the antimeridian
            [170, 64],
            [179, 64],
            [-179, 66],
            [-170, 70],
            [170, 64],
        ],
        box(-60, -90, 60, -60), // 8: a boundary of no country
        box(1.4, 48.1, 3.6, 49.3), // 9: Île-de-France
    ],
};
