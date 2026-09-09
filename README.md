<div align="center">
  <picture>
    <img alt="nwb2bids logo" src="src/assets/dandi-usage-logo.svg" width="200">
  </picture>

  <h1 align="center">DANDI usage webpage (source)</h1>

  <p align="center">
    <a href="https://github.com/dandi/usage-page/actions/workflows/daily-tests.yml"><img src="https://github.com/dandi/usage-page/actions/workflows/daily-tests.yml/badge.svg" alt="Daily tests"></a>
    <a href="https://codecov.io/github/dandi/usage-page"><img src="https://codecov.io/github/dandi/usage-page/coverage.svg?branch=main" alt="codecov"></a>
    <a href="https://github.com/dandi/usage-page/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-yellow.svg" alt="License: MIT"></a>
    <a href="https://github.com/dandi/usage-page/releases"><img src="https://img.shields.io/github/v/release/dandi/usage-page" alt="GitHub release"></a>
    <a href="https://doi.org/10.5281/zenodo.20031137"><img src="https://img.shields.io/badge/DOI-10.5281%2Fzenodo.20031137-blue" alt="DOI"></a>
  </p>
  <p align="center">
    <a href="https://www.chromatic.com"><img src="https://img.shields.io/badge/Chromatic-FC521F?logo=chromatic&logoColor=white" alt="Chromatic"></a>
    <a href="https://storybook.js.org"><img src="https://img.shields.io/badge/Storybook-FF4785?logo=storybook&logoColor=white" alt="Storybook"></a>
    <a href="https://playwright.dev"><img src="https://img.shields.io/badge/Playwright-2d2d2d?style=flat&logo=playwright&logoColor=2EAD33" alt="Playwright"></a>
  </p>
  <p align="center">
    <a href="https://github.com/prettier/prettier"><img src="https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=flat" alt="code style: prettier"></a>
  </p>
</div>

Visualizations of data usage across the archive.

Main webpage: https://usage.dandiarchive.org

## Configuration

When deploying a fork that points at a different data repository, update the
`BASE_URL` constant near the top of `src/plots.js`:

```js
const BASE_URL = "https://raw.githubusercontent.com/myorg/myrepo/main";
```

## Development

```bash
npm install
npm run dev
```

### Region codes

The geographic section reads `by_region.tsv`, whose regions are ISO 3166-1
alpha-3 country codes and ISO 3166-2 subdivision codes (`USA/CA`, `DNK/84`).
`src/configs/region_info.json` is what turns those into place names and into
the GADM boundaries the choropleth draws.  It is generated, so regenerate it
rather than editing it — after the boundaries change, or when new codes appear
upstream:

```bash
npm run build:region-info
```

#### Where its contents come from

| Field | Source |
| --- | --- |
| `alpha3_to_alpha2` | The ISO 3166-1 register, via the [`iso-3166`](https://www.npmjs.com/package/iso-3166) package (MIT). |
| `alpha2_to_country_name` | Unicode CLDR, via the ICU data Node itself carries (`Intl.DisplayNames`). |
| `subdivisions[..][0]`, the name | Unicode CLDR subdivision names, via the [`cldr-subdivisions-full`](https://www.npmjs.com/package/cldr-subdivisions-full) package (Unicode-3.0). |
| `subdivisions[..][1]`, the boundary | Not a dataset: computed by the generator, see below. |

Two things in the file come from neither register.  Kosovo has no ISO 3166-1
entry but the summaries report it, so the generator adds the user-assigned
`XKX`/`XK` pair by hand.  And CLDR names no subdivision at all of a few small
territories (BM, MP, NC, PF, VI), whose codes therefore carry a null name; the
page shows the bare code for those rather than inventing one.

Nothing published anywhere maps an ISO 3166-2 code to a GADM boundary, which is
why the boundary half is computed rather than looked up.  The generator takes
the subdivision's coordinates from the upstream `region_codes_to_coordinates.yaml`
— the same file the points view plots — and finds which of that country's GADM
polygons **contains** that point.  This is what lets the mapping survive the two
datasets dividing a country differently: ISO 3166-2 lists nineteen regions of
Finland where GADM draws five, and each of the nineteen falls inside one of the
five.

Containment is the only test.  Falling back to the *nearest* boundary when a
point lands outside them all was tried and dropped: it rescued a few islands off
a simplified coastline, but it also placed Jammu and Kashmir in Himachal Pradesh
and Azad Kashmir in Islamabad.  A code left without a boundary is matched by
name at runtime instead, against `src/configs/name_aliases.json` — a comparison
rather than a guess — and a code that matches nothing simply goes unpainted,
which is the honest outcome.
