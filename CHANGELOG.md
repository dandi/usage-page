# Changelog

## Upcoming

#### 🐛 Bug Fix

- Fixed the "Undetermined file types" series of the over-time plot grouped by asset type, which weighed the archive total against the weekly asset-type breakdown only after binning and so reported the days around each month and year boundary as undetermined bytes. The series is now left out entirely when every byte is accounted for. ([#249](https://github.com/dandi/usage-page/pull/249))

#### 🚀 Enhancement

- Dropped the "DANDI:" prefix from the hover text of the over-time plot grouped by Dandisets, so each hover leads with the Dandiset's ID and title. ([#247](https://github.com/dandi/usage-page/pull/247))
- Replaced the totals sentence and its block of footnotes above the plots with a table of the same metrics, each caveat behind an info icon on the metric (or the caption) it qualifies. The metrics are read as a row of labelled columns that wraps over as many lines as a narrow viewport needs, so the summary is never scrolled sideways. ([#246](https://github.com/dandi/usage-page/pull/246))
- Restyled the scroll bars of every table view as a slim, rounded, accent-tinted thumb on a transparent track, replacing the platform default that read as a light gray slab against the table, most jarringly in dark mode. ([#245](https://github.com/dandi/usage-page/pull/245))
- Added a "Metric" dropdown to the over-time and per-Dandiset histogram plots, so the plot is drawn in the chosen metric rather than always in bytes; the histogram additionally offers the scaled metrics for the archive-wide selection. Each choice is remembered in the URL (`ot_metric`, `hist_metric`), is shown only in plot view, and drives the plot's title and y-axis. ([#243](https://github.com/dandi/usage-page/pull/243))
- Disabled the over-time metric dropdown while grouping by asset type, the one grouping whose source data carries no metric other than bytes. ([#243](https://github.com/dandi/usage-page/pull/243))
- Ranked the bars of both histograms by the metric being plotted instead of always by bytes, and left out Dandisets with no value for the selected scaled metric. ([#243](https://github.com/dandi/usage-page/pull/243))
- Led plot hover text with the metric being plotted and labeled every value in it, so the byte figure now reads "Bytes: 1.2 TB" instead of a bare "1.2 TB". ([#243](https://github.com/dandi/usage-page/pull/243))
- Added three scaled metrics to the per-Dandiset table — "Views / Asset", "Downloads / Asset" and "Bytes / Size" — normalizing usage by each Dandiset's asset count and stored size, fetched as gzipped JSONL from [dandi-cache/dandiset-id-to-number-of-assets](https://github.com/dandi-cache/dandiset-id-to-number-of-assets) and [dandi-cache/dandiset-id-to-total-size](https://github.com/dandi-cache/dandiset-id-to-total-size). ([#241](https://github.com/dandi/usage-page/pull/241))
- Added "Total Size" and "Total Assets" columns to the per-Dandiset table, so the denominators behind the scaled metrics are visible alongside them. ([#241](https://github.com/dandi/usage-page/pull/241))
- Added an "Ignore testing datasets" checkbox to the per-Dandiset settings panel, leaving out the Dandisets whose usage is dominated by automated testing. On by default; turning it off is remembered in the URL (`ignore_testing=false`). ([#241](https://github.com/dandi/usage-page/pull/241))
- Kept the per-Dandiset settings button enabled in table view, now that its panel holds a table setting as well as the plot-only "Plot Type", and retitled the panel "Settings". ([#241](https://github.com/dandi/usage-page/pull/241))
- Kept a user's chosen table sort when the table is re-rendered with new rows, so toggling a setting no longer snaps it back to the default sort. ([#241](https://github.com/dandi/usage-page/pull/241))
- Replaced "Download raw file" in every table's "Data ▾" menu with "Download table", which hands back a TSV of the table as displayed rather than the source file, which no longer holds the derived columns. ([#241](https://github.com/dandi/usage-page/pull/241))
- Reordered the per-Dandiset table so each scaled metric sits beside what it is divided by, renamed the raw totals to "Total Bytes", "Total Views" and "Total Downloads", dropped its request column, and let it use the full page width. ([#241](https://github.com/dandi/usage-page/pull/241))
- Rendered a scaled metric as "--" when its denominator is unknown or zero, and sank rows with no value for the sorted column to the bottom in both sort directions. ([#241](https://github.com/dandi/usage-page/pull/241))

- Surfaced the view counts now published by [dandi/access-summaries](https://github.com/dandi/access-summaries) throughout the page: a "Views" column in every table, a `Views` entry in every plot's hover text, and a view count in the totals sentence above the plots. ([#240](https://github.com/dandi/usage-page/pull/240))
- Renamed the "Usage" column of every table view to "Bytes". ([#240](https://github.com/dandi/usage-page/pull/240))
- Ordered the metric columns of every table view as "Views", "Downloads", "Requests" (after the leading "Bytes" column). ([#240](https://github.com/dandi/usage-page/pull/240))
- Named the byte unit in each plot's title instead of the generic "Usage" — "TB per day", "PB per Dandiset" — deriving it from the largest plotted value. Table views keep the generic wording, their rows each being formatted to their own unit. ([#240](https://github.com/dandi/usage-page/pull/240))
- Gave the per-Dandiset histogram's table view the "Usage per Dandiset" title it was missing. ([#240](https://github.com/dandi/usage-page/pull/240))
- Hyperlinked each Dandiset name in the per-Dandiset table to its landing page on the DANDI archive, opening in a new tab. ([#240](https://github.com/dandi/usage-page/pull/240))
- Anchored the default sort of every table view to its first numeric column instead of its last, so appending further metric columns no longer changes which column tables open sorted by. ([#240](https://github.com/dandi/usage-page/pull/240))
- Annotated Dandiset ID displays with their current title from an external ID-to-title cache — the selector dropdown, histogram and grouped over-time hover text, and a new "Name" table column — falling back to the bare ID. ([#236](https://github.com/dandi/usage-page/pull/236))
- Added pointers to the underlying source data ([dandi/access-summaries](https://github.com/dandi/access-summaries)): an icon in the header, a per-Dandiset link beside the selector, a "Data ▾" menu on every table view, and a modebar button on every plot. ([#234](https://github.com/dandi/usage-page/pull/234))

- Excluded the 'undetermined' Dandiset ID from the usage-per-dandiset histogram plot while keeping it visible in the table view. ([#191](https://github.com/dandi/usage-page/pull/191))
- Grey out the plot-specific gear-wheel settings buttons (`ot_settings_btn`, `hist_settings_btn`) when their section is in table view, since those settings only affect plots; the panel is also closed automatically when switching to table view. ([#179](https://github.com/dandi/usage-page/pull/179))
- Appended the first 8 characters of the latest git commit hash to the version string displayed in the bottom-left footer (e.g. `v1.3.8+a25561a7`). ([#174](https://github.com/dandi/usage-page/pull/174))
- Added `number_of_requests` and `number_of_downloads` to Plotly hover text for all plot types (over-time, per-dandiset histogram, per-asset histogram, geographic scatter, geographic choropleth) and as new columns in all sortable table views. ([#201](https://github.com/dandi/usage-page/pull/201))

#### 🐛 Bug Fix

- Fixed the near-invisible tooltip text of every info icon under the light theme, which was drawn in the theme's dark body color on the tooltip's dark background. ([#246](https://github.com/dandi/usage-page/pull/246))
- Fixed the band of whitespace that opened below a section loaded, or refreshed, directly into its table view. The height each section reserves while swapping views was measured from the whole section, which briefly holds both of its views at once, and so came out as tall as the two stacked; it is now taken from the taller view and released once the new one has content of its own. ([#244](https://github.com/dandi/usage-page/pull/244))
- Re-sized a plot when it is switched back into view, so one drawn while hidden is no longer left at Plotly's default size. The shared resize helper now also skips hidden plots, clearing the "Resize must be passed a displayed plot div element" errors. ([#244](https://github.com/dandi/usage-page/pull/244))
- Applied "Ignore testing datasets" to the per-Dandiset plot as well as its table, so the setting means the same thing in both views. ([#243](https://github.com/dandi/usage-page/pull/243))
- Fixed the log-scale y-axis of both histograms, which paired six tick positions with only four labels and so mislabeled the upper decades. ([#243](https://github.com/dandi/usage-page/pull/243))

#### 🏠 Internal

- Condensed the `Upcoming` changelog entries and added a rule to `CLAUDE.md` keeping future entries to a sentence or two. ([#244](https://github.com/dandi/usage-page/pull/244))
- Renamed `AGENTS.md` to `CLAUDE.md` and recorded the American-English spelling convention in it. ([#241](https://github.com/dandi/usage-page/pull/241))

- Updated the version-check CI workflow to not trigger on `package-lock.json` changes; updated `AGENTS.md` to match. ([#174](https://github.com/dandi/usage-page/pull/174))
- Updated the version-check workflow to allow dependency-only `package.json` changes (for example Dependabot dependency bumps) without requiring a package version bump. ([#189](https://github.com/dandi/usage-page/pull/189))
- Fixed version-check CI parsing in the dependency-only `package.json` branch by replacing a malformed heredoc with `node -e`, so Dependabot dependency bumps no longer fail unexpectedly. ([#181](https://github.com/dandi/usage-page/pull/181))

#### 🧪 Tests

- Added unit tests for the totals summary renderer, covering its columns, info icons, optional note, and HTML escaping. ([#246](https://github.com/dandi/usage-page/pull/246))
- Covered the view-mode height reservation with the cases behind the whitespace bug, and added an integration test asserting that a fresh load of the per-Dandiset table view leaves no gap below the table. ([#244](https://github.com/dandi/usage-page/pull/244))
- Added unit tests for the gzipped-JSONL data path, the `scaled_metric` and `format_ratio` helpers, and the table renderer's handling of missing numeric values; the Chromatic fixtures now serve gzipped files, exercising the client-side decompression. ([#241](https://github.com/dandi/usage-page/pull/241))

- Extracted `escape_html`, `make_cumulative`, `fetchWithRetry`, `apply_view_mode`, `apply_geo_view_mode`, and `render_sortable_table` into a new `src/plot-helpers.ts` module and added 50 unit tests covering all six helpers; raised overall statement coverage from 5% to 13%. ([#175](https://github.com/dandi/usage-page/pull/175))
- Added `stories/PlotSections.stories.js` with Storybook stories for the over-time plot, histogram, geography, and sortable-table components in both dark and light themes. ([#175](https://github.com/dandi/usage-page/pull/175))
- Replaced the live version string in the footer with a fixed mock value (`v0.0.0+test0000`) before taking Chromatic Playwright snapshots so the baseline is not invalidated by version bumps or new commits. ([#178](https://github.com/dandi/usage-page/pull/178))

- Stabilized Chromatic Playwright snapshots by intercepting all external data requests with static mock fixtures and waiting for all three Plotly plots to finish rendering before calling `takeSnapshot`. ([#171](https://github.com/dandi/usage-page/pull/171))

#### 📝 Documentation

- Added Chromatic, Storybook, and Playwright badges to `README.md` and grouped all badges by theme (CI/quality, testing tools, code style). ([#169](https://github.com/dandi/usage-page/pull/169))
- Added Zenodo DOI badge to `README.md` using shields.io to avoid the classic Zenodo badge load failures. ([#167](https://github.com/dandi/usage-page/pull/167))


## v1.3.7

### 🚀 Enhancement

- Added "Stacked" toggle to the over-time plot settings panel to switch between stacked and overlay views when a group-by is active. ([#141](https://github.com/dandi/usage-page/pull/141))
- Modularized settings into per-plot gear panels instead of a single global modal. ([#132](https://github.com/dandi/usage-page/pull/132))
- Added line/bar plot type toggle with area shading for over-time and histogram views. ([#120](https://github.com/dandi/usage-page/pull/120))
- Respected browser `prefers-color-scheme` setting as the default light/dark theme. ([#127](https://github.com/dandi/usage-page/pull/127))
- Added version tag (bottom-left) and CON branding (bottom-right) to the page footer. ([#119](https://github.com/dandi/usage-page/pull/119))
- Added SVG export button to the Plotly modebar. ([#116](https://github.com/dandi/usage-page/pull/116))
- Stacked group-by over-time plots instead of overlaying them. ([#112](https://github.com/dandi/usage-page/pull/112))
- Added hover tooltip descriptions to asset-type legend items in the over-time plot. ([#109](https://github.com/dandi/usage-page/pull/109))
- Added "Asset type" group-by option to the over-time plot. ([#105](https://github.com/dandi/usage-page/pull/105))
- Made table column spacing dynamic. ([#96](https://github.com/dandi/usage-page/pull/96))
- Added "Group by Dandisets" overlay option for the usage over-time plot. ([#87](https://github.com/dandi/usage-page/pull/87))
- Added hover-reveal anchor links to each plot section heading. ([#85](https://github.com/dandi/usage-page/pull/85))
- Showed time aggregation controls in the table view of the over-time plot. ([#83](https://github.com/dandi/usage-page/pull/83))
- Added light/dark mode toggle with `localStorage` persistence. ([#75](https://github.com/dandi/usage-page/pull/75))
- Added daily/weekly/monthly/yearly time aggregation to the over-time bytes plot. ([#68](https://github.com/dandi/usage-page/pull/68))
- Replaced native radio buttons with a segmented pill toggle. ([#66](https://github.com/dandi/usage-page/pull/66))
- Moved source data download links into each table header. ([#65](https://github.com/dandi/usage-page/pull/65))
- Moved geographic map attributions into Plotly in-plot annotations. ([#60](https://github.com/dandi/usage-page/pull/60))
- Added logo and favicon. ([#59](https://github.com/dandi/usage-page/pull/59))
- Added plot/table view toggles with sortable columns for all sections. ([#50](https://github.com/dandi/usage-page/pull/50))
- Sorted geographic dots by size ascending and added transparency. ([#49](https://github.com/dandi/usage-page/pull/49))
- Added info icons to the settings panel to clarify the scope of each option. ([#45](https://github.com/dandi/usage-page/pull/45))
- Wrapped top-level config options into a gear wheel modal. ([#44](https://github.com/dandi/usage-page/pull/44))
- Synchronized color scheme and dark theme styling with other DANDI plugins. ([#42](https://github.com/dandi/usage-page/pull/42))
- Added a choropleth toggle for the geographic map. ([#40](https://github.com/dandi/usage-page/pull/40))
- Added exponential backoff retry logic for data fetches. ([#39](https://github.com/dandi/usage-page/pull/39))
- Synced the selected dandiset with a URL query parameter for shareable links. ([#36](https://github.com/dandi/usage-page/pull/36))
- Added AWS region histogram. ([#29](https://github.com/dandi/usage-page/pull/29))
- Added cumulative usage over-time plot. ([#11](https://github.com/dandi/usage-page/pull/11))
- Added log scale option for plots and updated the controls layout. ([#3](https://github.com/dandi/usage-page/pull/3))
- Initial deployment of the DANDI usage page with geographic map, per-dandiset breakdown, and CI/CD pipeline. ([#2](https://github.com/dandi/usage-page/pull/2))

### 📝 Documentation

- Added `CHANGELOG.md` to track changes to the project.
- Added daily tests passing badge to `README.md`. ([#157](https://github.com/dandi/usage-page/pull/157))
- Added codecov, license, release, and code style badges to `README.md`. ([#151](https://github.com/dandi/usage-page/pull/151))
- Added a consolidated "Data sources" section linking to underlying data files. ([#46](https://github.com/dandi/usage-page/pull/46))
- Added a note clarifying that only public (non-embargoed) datasets are included.

### 🐛 Bug Fix

- Fixed page flash (FOUC) and layout scrambling on page refresh. ([#126](https://github.com/dandi/usage-page/pull/126))
- Fixed x-axis gaps in grouped dandisets cumulative plot by using global bin edges. ([#123](https://github.com/dandi/usage-page/pull/123))
- Fixed first-load race condition that caused persistent URL parameters to be ignored. ([#121](https://github.com/dandi/usage-page/pull/121))
- Disabled "Daily" aggregation when grouping by asset type. ([#115](https://github.com/dandi/usage-page/pull/115))
- Capped asset name column width to prevent table layout blowout. ([#100](https://github.com/dandi/usage-page/pull/100))
- Fixed gaps between bars in cumulative weekly/monthly over-time plots. ([#99](https://github.com/dandi/usage-page/pull/99))
- Fixed anchor navigation so the page scrolls to the correct section after all plots load. ([#98](https://github.com/dandi/usage-page/pull/98))
- Fixed anchor link flicker caused by popstate-triggered plot re-renders. ([#95](https://github.com/dandi/usage-page/pull/95))
- Disabled and hid the per-asset histogram section for the "unassociated" dandiset. ([#79](https://github.com/dandi/usage-page/pull/79))
- Hidden the histogram section entirely for the "undetermined" dandiset. ([#77](https://github.com/dandi/usage-page/pull/77))
- Held fixed section sizes when switching between plot and table views. ([#73](https://github.com/dandi/usage-page/pull/73))
- Fixed a fetch race condition. ([#39](https://github.com/dandi/usage-page/pull/39))
- Improved histogram display and fixed cumulative bar gaps and labels. ([#24](https://github.com/dandi/usage-page/pull/24), [#26](https://github.com/dandi/usage-page/pull/26))

### 🏠 Internal

- Reorganized repository layout to use Vite with a `src/` + `configs/` structure. ([#103](https://github.com/dandi/usage-page/pull/103))
- Added Google Analytics tracking. ([#101](https://github.com/dandi/usage-page/pull/101))
- Renamed section anchor IDs by stripping the `_view_controls` suffix. ([#92](https://github.com/dandi/usage-page/pull/92))
- Renamed "Bytes sent" to "Usage" throughout the UI. ([#81](https://github.com/dandi/usage-page/pull/81))
- Generalized base URLs so source data can be served from any repository. ([#67](https://github.com/dandi/usage-page/pull/67))
- Offloaded inline styles to a separate `styles.css` file. ([#48](https://github.com/dandi/usage-page/pull/48))
- Added `CNAME` file to enable the `usage.dandiarchive.org` custom domain. ([#33](https://github.com/dandi/usage-page/pull/33))
- Swapped data source base URLs to the new repository location. ([#14](https://github.com/dandi/usage-page/pull/14))
- Moved `gadm_admin1_simplified.topojson` and `name_aliases.json` from `configs/` to `src/configs/` so changes to them are covered by the version-check CI. ([#147](https://github.com/dandi/usage-page/pull/147))
- Moved `src/tests/` and `src/stories/` to top-level `tests/` and `stories/` directories to avoid confusing AI tooling and the version-check CI. ([#145](https://github.com/dandi/usage-page/pull/145))
- Replaced the hand-duplicated HTML string in `MainPage.stories.js` with a `?raw` import of `src/index.html` so the Storybook story always derives its DOM structure directly from the source. ([#143](https://github.com/dandi/usage-page/pull/143))
- Moved `gadm_admin1_simplified.topojson` and `name_aliases.json` from `public/` to `configs/` to reduce top-level noise. ([#137](https://github.com/dandi/usage-page/pull/137))
- Fixed `configs/vite.config.js` `publicDir` from `config/` to `configs/`. ([#140](https://github.com/dandi/usage-page/pull/140))
- Swapped all `src/` source files from JavaScript to TypeScript (`plots.ts`, `utils.ts`, `errors.ts`); added `tsconfig.json`, type packages (`typescript`, `@types/js-yaml`, `@types/plotly.js`, `@types/topojson-client`, `@types/node`), a `vendor.d.ts` shim for `plotly.js-dist-min`, and a `typecheck` npm script. ([#149](https://github.com/dandi/usage-page/pull/149))

### 🧪 Tests

- Set up testing infrastructure: Vitest (unit), Playwright (e2e), Storybook/Chromatic (visual), and Codecov (coverage). ([#129](https://github.com/dandi/usage-page/pull/129))
- Added weekly CI workflow (`npm-audit.yml`) that runs `npm audit` every Monday and sends an email notification on failure. ([#134](https://github.com/dandi/usage-page/pull/134))
- Added weekly CI workflow (`weekly-tests.yml`) that runs build, unit, and integration tests every Monday and sends an email notification on any failure or detected warning. ([#138](https://github.com/dandi/usage-page/pull/138))
- Added daily CI workflow (`daily-tests.yml`) that runs build, unit, and integration tests every day at noon UTC and sends an email notification on any failure or detected warning. ([#153](https://github.com/dandi/usage-page/pull/153))
- Added Playwright visual testing with Chromatic: a new `chromatic-playwright.yml` CI workflow runs visual snapshot tests (dark and light themes) via `@chromatic-com/playwright` and uploads them to a dedicated Chromatic project using `CHROMATIC_PLAYWRIGHT_PROJECT_TOKEN`; the existing Chromatic workflow was renamed to "Chromatic (Storybook)". ([#163](https://github.com/dandi/usage-page/pull/163))
- Added `--disable-gpu` to Playwright Chromium launch args and filtered `GL Driver Message` browser warnings in the integration test console listener to suppress the WebGL GPU stall warning in CI. ([#161](https://github.com/dandi/usage-page/pull/161))
- Made `test.yml` a reusable workflow (`workflow_call`); simplified `daily-tests.yml` to call it directly (inheriting secrets for Codecov uploads); removed Playwright artifact uploads from `weekly-tests.yml`. ([#159](https://github.com/dandi/usage-page/pull/159))
