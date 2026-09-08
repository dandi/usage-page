// Reading the region keys of `by_region.tsv`.
//
// A region there is an ISO 3166-1 alpha-3 country code, on its own or followed
// by the ISO 3166-2 code of one of its subdivisions: `NLD`, `USA/MA`, `DNK/84`.
// Neither the choropleth nor the tables can use those as they stand — one needs
// a GADM boundary and the other needs something a reader recognizes — so both
// go through `parse_region_key`, which resolves a key against the table built
// by `src/scripts/build-iso-region-codes.mjs`.
//
// Three other kinds of key share the column and are passed through as they are:
// the cloud regions of `AWS/us-east-1` and `GCP/us-central1`, which are data
// centers rather than places; the alpha-2 country code and English subdivision
// name of the older summaries, which the archive still carries alongside the
// codes while it is reprocessed; and the handful of labels for traffic that has
// no location at all, such as `VPN` and `unknown`.

export interface IsoRegionCodes {
    alpha3_to_alpha2: Record<string, string>;
    countries: Record<string, string>;
    subdivisions: Record<string, Record<string, { name: string; gadm?: string }>>;
}

export type RegionKind = "cloud" | "subdivision" | "country" | "other";

export interface ParsedRegion {
    kind: RegionKind;
    /** "AWS" or "GCP", for a cloud region. */
    provider?: string;
    /** ISO 3166-1 alpha-2 code, for a place. */
    country_code?: string;
    /** English name of the subdivision, falling back to its code when unnamed. */
    subdivision_name?: string;
    /** Name of the GADM boundary the subdivision sits in, where one is known. */
    gadm_name?: string;
    /** What to show a reader, e.g. "Massachusetts, United States". */
    label: string;
}

const CLOUD_PROVIDERS = ["AWS", "GCP"];

// Characters that survive being stripped of their accents as the wrong letter,
// or as no letter at all, and so are spelled out before that happens.
const CHARACTER_REPLACEMENTS: Record<string, string> = {
    ß: "ss",
    ø: "o",
    æ: "ae",
    œ: "oe",
    đ: "d",
    ð: "d",
    þ: "th",
    ł: "l",
    ı: "i",
    ħ: "h",
    ŋ: "n",
    ǝ: "e",
    "&": " and ",
    "-": " ",
    "–": " ",
    _: " ",
    ".": "",
    "/": " ",
    "'": "",
    "’": "",
    "‘": "",
    ʼ: "",
    ʻ: "",
};

const NAME_PREFIXES = ["state of ", "province of ", "region of ", "republic of ", "city state ", "county of "];

const NAME_SUFFIXES = [
    " county",
    " province",
    " region",
    " parish",
    " prefecture",
    " department",
    " district",
    " governorate",
    " municipality",
];

/**
 * Folds a subdivision name down to what two datasets naming the same place can
 * be expected to agree on: lower case, without accents, and without the words
 * that say what kind of division it is.
 *
 * Both sides of every name comparison go through this, the names the summaries
 * carry and the names GADM does alike, so that "Nordrhein-Westfalen" and
 * "Nordrhein Westfalen" — or "Córdoba" and "Cordoba" — meet in the middle.
 */
export function normalize_region_name(name: string): string {
    if (!name) return "";
    let normalized = name.toLowerCase();
    for (const prefix of NAME_PREFIXES) {
        if (normalized.startsWith(prefix)) normalized = normalized.slice(prefix.length);
    }
    for (const suffix of NAME_SUFFIXES) {
        if (normalized.endsWith(suffix)) normalized = normalized.slice(0, -suffix.length);
    }
    let replaced = "";
    for (const character of normalized) {
        replaced += CHARACTER_REPLACEMENTS[character] ?? character;
    }
    // Decomposing separates every remaining accent from the letter it sits on,
    // so that the combining marks can be dropped and the letter kept.
    return replaced.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Splits a region key into the country and subdivision it names, the GADM
 * boundary that subdivision belongs to, and a label to show for it.
 *
 * `codes` is the generated ISO table, or null before it has loaded; without it
 * a key is still split and labeled, just with its codes left as codes.
 */
export function parse_region_key(region: string, codes: IsoRegionCodes | null): ParsedRegion {
    // Split on the first separator only: the older summaries carry subdivision
    // names that contain one themselves, such as "TT/Tunapuna/Piarco".
    const separator = region.indexOf("/");
    const head = separator < 0 ? region : region.slice(0, separator);
    const tail = separator < 0 ? null : region.slice(separator + 1);

    if (CLOUD_PROVIDERS.includes(head)) {
        return { kind: "cloud", provider: head, label: tail ? `${head} ${tail}` : head };
    }

    // An alpha-3 code is only recognizable through the table, but an alpha-2
    // one is its own country code, so the older keys keep working — labeled by
    // code rather than by name — even if the table failed to load.
    const alpha2 = codes?.alpha3_to_alpha2[head];
    const is_alpha3 = /^[A-Z]{3}$/.test(head) && alpha2 !== undefined;
    const is_alpha2 = /^[A-Z]{2}$/.test(head) && (!codes || head in codes.countries);
    if (!is_alpha3 && !is_alpha2) return { kind: "other", label: region };

    const country_code = is_alpha3 ? (alpha2 as string) : head;
    const country_name = codes?.countries[country_code] ?? country_code;
    if (tail === null) return { kind: "country", country_code, label: country_name };

    // An alpha-3 country code marks a key from the reprocessed summaries, whose
    // subdivision is an ISO 3166-2 code to be looked up.  An alpha-2 one marks
    // an older key, whose subdivision is already a name.
    const subdivision = is_alpha3 ? codes?.subdivisions[country_code]?.[tail.toUpperCase()] : undefined;
    const subdivision_name = is_alpha3 ? (subdivision?.name ?? tail) : tail;

    return {
        kind: "subdivision",
        country_code,
        subdivision_name,
        gadm_name: subdivision?.gadm,
        label: `${subdivision_name}, ${country_name}`,
    };
}
