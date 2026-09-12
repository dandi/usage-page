// Static fixture data standing in for everything the page fetches.
//
// Shared by every suite that renders the page against fixed content: the
// Playwright suites mock the network with it (see page-mocks.js) and the
// jsdom harness for src/plots.ts serves it from a stubbed fetch, so a change
// here reaches both.  The values are deterministic on purpose, so that
// snapshots and assertions are never affected by live data changing between
// runs.

export const BASE_URL = "https://raw.githubusercontent.com/dandi/access-summaries/main";
export const BASE_TSV_URL = `${BASE_URL}/content/summaries`;

export const ARCHIVE_TOTALS = JSON.stringify({
    total_bytes_sent: 15000000000000,
    total_number_of_downloads: 1450000,
    total_number_of_requests: 8200000,
    total_number_of_views: 96000,
    number_of_requesters: 12000,
    number_of_unique_regions: 150,
    number_of_unique_countries: 60,
});

export const ALL_DANDISET_TOTALS = JSON.stringify({
    "000001": {
        total_bytes_sent: 5000000000,
        total_number_of_downloads: 900,
        total_number_of_requests: 6400,
        total_number_of_views: 540,
        number_of_requesters: 320,
        number_of_unique_regions: 10,
        number_of_unique_countries: 5,
    },
    "000002": {
        total_bytes_sent: 3000000000,
        total_number_of_downloads: 450,
        total_number_of_requests: 4100,
        total_number_of_views: 310,
        number_of_requesters: 210,
        number_of_unique_regions: 8,
        number_of_unique_countries: 4,
    },
    "000003": {
        total_bytes_sent: 1000000000,
        total_number_of_downloads: 120,
        total_number_of_requests: 1200,
        total_number_of_views: 95,
        number_of_requesters: "<50",
        number_of_unique_regions: 5,
        number_of_unique_countries: 3,
    },
    "000004": {
        total_bytes_sent: 800000000,
        total_number_of_downloads: 90,
        total_number_of_requests: 900,
        total_number_of_views: 70,
        number_of_requesters: 60,
        number_of_unique_regions: 6,
        number_of_unique_countries: 3,
    },
    undetermined: {
        total_bytes_sent: 250000000,
        total_number_of_downloads: 60,
        total_number_of_requests: 300,
        total_number_of_views: 40,
        number_of_requesters: 75,
        number_of_unique_regions: 4,
        number_of_unique_countries: 2,
    },
});

// Titles for the mock Dandisets.  "000003" is deliberately left out so the
// snapshot also covers a row whose name is unknown (and so is not hyperlinked).
// "000004" carries a title of the length real Dandisets reach.  A <select> is
// as wide as its widest option, so a fixture of short titles hides the one
// thing about this control that is hard to get right on a narrow viewport.
export const DANDISET_TITLES_JSONL = `\
{"000001": "Mock electrophysiology recordings"}
{"000002": "Mock calcium imaging dataset"}
{"000004": "A detailed data-driven network model of prefrontal cortex reproduces key features of in vivo activity"}
`;

// Asset counts and stored sizes behind the scaled metrics of the per-Dandiset
// table.  "000003" is deliberately left out of both so the snapshot also covers
// rows whose scaled metrics are unavailable and render as "--".
export const NUMBER_OF_ASSETS_JSONL = `\
{"000001": 40}
{"000002": 12}
`;

export const TOTAL_SIZE_JSONL = `\
{"000001": 250000000}
{"000002": 1500000000}
`;

export const REGION_COORDS_YAML = `\
USA/CA:
  latitude: 36.7783
  longitude: -119.4179
DEU/BY:
  latitude: 48.7904
  longitude: 11.4979
GB/England:
  latitude: 52.3555
  longitude: -1.1743
`;

export const BY_DAY_TSV = `\
date\tbytes_sent\tnumber_of_requests\tnumber_of_downloads\tnumber_of_views
2024-01-01\t100000000\t400\t120\t35
2024-01-02\t200000000\t600\t180\t52
2024-01-03\t150000000\t500\t140\t41
2024-01-04\t300000000\t1000\t320\t88
2024-01-05\t250000000\t700\t220\t63
2024-01-06\t180000000\t550\t160\t47
2024-01-07\t220000000\t630\t190\t55
`;

// Two of the three places are keyed the way the reprocessed summaries key
// them, by ISO 3166-1 alpha-3 and ISO 3166-2 code, and the third the way the
// summaries yet to be reprocessed still do, by alpha-2 code and subdivision
// name.  All three have to reach the same boundaries either way.
export const BY_REGION_TSV = `\
region\tbytes_sent\tnumber_of_requests\tnumber_of_downloads\tnumber_of_views
USA/CA\t5000000000\t3200\t900\t260
DEU/BY\t2000000000\t1400\t380\t110
GB/England\t1500000000\t1050\t290\t85
AWS/us-east-1\t8000000000\t5100\t1500\t420
GCP/us-central1\t6000000000\t4200\t1100\t310
`;

export const BY_ASSET_TSV = `\
asset\tbytes_sent\tnumber_of_requests\tnumber_of_downloads\tnumber_of_views
sub-001/func/sub-001_task-rest_bold.nwb\t1000000\t420\t130\t38
sub-002/func/sub-002_task-rest_bold.nwb\t500000\t210\t65\t19
`;

export const BY_ASSET_TYPE_PER_WEEK_TSV = `\
date\tNeurophysiology\tMicroscopy\tVideo\tMiscellaneous
2024-01-01\t50000000\t30000000\t20000000\t10000000
2024-01-08\t60000000\t35000000\t25000000\t15000000
`;
