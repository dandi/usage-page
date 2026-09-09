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
