# Changelog

## Upcoming

#### 🚀 Enhancement

- Added a "Metric" dropdown to each of the first two plot sections, choosing which metric the plot is drawn in rather than always bytes. The over-time plot offers "Bytes", "Views" and "Downloads"; the per-Dandiset histogram (the archive-wide selection) additionally offers the three scaled metrics — "Views / Asset", "Downloads / Asset" and "Bytes / Size" — which are hidden for any other selection, since only Dandisets have a known asset count and stored size to divide by. Both selections are remembered in the URL (`ot_metric`, `hist_metric`), and both selectors are shown only in plot view, the table views listing every metric as their own columns already. The histogram selector lists its metrics in the column order of the table beside it — "Views / Asset", "Downloads / Asset", "Views", "Downloads", "Bytes / Size", "Bytes" for the per-Dandiset table, and "Bytes", "Views", "Downloads" for the per-asset one — so the two read the same way round. Each plot's title names the metric being plotted ("Views per day", "Views / Asset per Dandiset"), and its y-axis drops the byte suffix and byte decade labels for the metrics that are not bytes. ([#243](https://github.com/dandi/usage-page/pull/243))
- Restricted the over-time metric to "Bytes" while grouping by asset type, the one grouping whose source data (`by_asset_type_per_week.tsv`) carries no other metric; the dropdown is disabled there and explains why on hover, as the "Daily" aggregation already does. ([#243](https://github.com/dandi/usage-page/pull/243))
- Ranked the bars of both histograms by the metric being plotted instead of always by bytes, so the tallest bar always leads, and left out of the plot any Dandiset with no value for the selected scaled metric (one missing from the content derivatives) rather than drawing it as a gap. ([#243](https://github.com/dandi/usage-page/pull/243))
- Led the hover text of the over-time and histogram plots with the metric being plotted, and labeled every value in it — the byte figure now reads "Bytes: 1.2 TB" instead of a bare "1.2 TB" — so it is always clear which number the bar's height shows. ([#243](https://github.com/dandi/usage-page/pull/243))
- Added three "scaled" usage metrics to the per-Dandiset table, normalizing raw usage by how much content each Dandiset actually holds: "Views / Asset", "Downloads / Asset" and "Bytes / Size" (bytes sent per byte stored). Their denominators come from two new data sources, [dandi-cache/dandiset-id-to-number-of-assets](https://github.com/dandi-cache/dandiset-id-to-number-of-assets) and [dandi-cache/dandiset-id-to-total-size](https://github.com/dandi-cache/dandiset-id-to-total-size), which are gzipped JSONL files fetched from the GitHub raw CDN and decompressed in the browser. A failure to load either one leaves the rest of the page working. ([#241](https://github.com/dandi/usage-page/pull/241))
- Added "Total Size" and "Total Assets" columns to the end of the per-Dandiset table, so the denominators behind the scaled metrics are visible alongside them. Both show "--" for Dandisets missing from the content derivatives. ([#241](https://github.com/dandi/usage-page/pull/241))
- Added an "Ignore testing datasets" checkbox to the per-Dandiset section's gear-wheel settings panel, which leaves out the Dandisets listed in `TESTING_DANDISET_IDS` — those whose usage is dominated by automated testing of the archive, and which otherwise dominate the scaled metrics. It is on by default, so a first visit shows research usage rather than testing traffic; turning it off is remembered in the URL (`ignore_testing=false`). It is shown only for the archive-wide selection, the only one whose rows are Dandisets. ([#241](https://github.com/dandi/usage-page/pull/241))
- Stopped disabling the per-Dandiset gear-wheel settings button in table view, since its panel now holds a table setting as well as the plot-only "Plot Type"; both entries carry an info icon naming the view they apply to, and the panel is titled "Settings" rather than "Plot Settings". ([#241](https://github.com/dandi/usage-page/pull/241))
- Kept the sort a user has chosen for a table when that table is re-rendered with new rows — toggling "Ignore testing datasets" or the binary/decimal prefix no longer snaps the table back to its default sort. The remembered sort is tied to the table's container and column set, so a container that goes on to show a different table (the per-asset table replacing the per-Dandiset one) still starts from that table's own default. ([#241](https://github.com/dandi/usage-page/pull/241))
- Replaced the "Download raw file" item of every table's "Data ▾" menu with "Download table", which hands back a TSV of the table as displayed — the same columns, the same formatting, and the sort order currently in effect — rather than the source file, which no longer contains the derived columns. The source file itself is still one click away under "View file on GitHub". ([#241](https://github.com/dandi/usage-page/pull/241))
- Ordered the per-Dandiset table so each scaled metric sits beside what it is divided by: the per-asset rates with "Total Assets", then the usage totals, closing on "Bytes / Size" and the directly comparable "Total Bytes" and "Total Size" pair. Renamed the raw totals to "Total Bytes", "Total Views" and "Total Downloads", dropped the request columns (requests remain in the plot's hover text and in every other table), and let that table use the full page width (instead of the 1100px the other tables are capped at) so all of its columns are visible at once on a wide screen. Table columns gained an optional `default_sort` flag, used to keep "Total Bytes" the column the table is sorted by on load now that it is no longer the leftmost metric. ([#241](https://github.com/dandi/usage-page/pull/241))
- Rendered a scaled metric as "--" when its denominator is unknown (a Dandiset missing from the content derivatives, such as 'undetermined') or zero, rather than as a blank, zero, or infinite value. Table rows without a value for the sorted column now always sink to the bottom, in both sort directions. ([#241](https://github.com/dandi/usage-page/pull/241))

- Surfaced the view counts now published by [dandi/access-summaries](https://github.com/dandi/access-summaries) (`number_of_views` in `by_day.tsv`, `by_region.tsv` and `by_asset.tsv`; `total_number_of_views` in `totals.json` and `archive_totals.json`) throughout the page: a new "Views" column in every sortable table (over-time, per-Dandiset histogram, per-asset histogram, per-region, AWS regions), a `Views` entry in the hover text of every plot (over-time single-series and both grouped modes, per-Dandiset and per-asset histograms, geographic scatter and choropleth), and a view count in the totals sentence above the plots with an explanatory footnote. ([#240](https://github.com/dandi/usage-page/pull/240))
- Renamed the "Usage" column of every table view to "Bytes". ([#240](https://github.com/dandi/usage-page/pull/240))
- Ordered the metric columns of every table view as "Views", "Downloads", "Requests" (after the leading "Bytes" column). ([#240](https://github.com/dandi/usage-page/pull/240))
- Named the byte unit in each plot's title instead of the generic "Usage": the over-time plot now reads e.g. "TB per day" (or "TiB per day" with the binary prefix selected) and "Total TB to date" in cumulative mode, the per-Dandiset histogram "PB per Dandiset", and the per-asset histogram "TB per asset". The unit is derived from the largest plotted value, accounting for stacking in the grouped over-time modes. Table views keep the generic "Usage" wording, since their rows are each formatted to their own unit. ([#240](https://github.com/dandi/usage-page/pull/240))
- Gave the per-Dandiset histogram's table view the "Usage per Dandiset" title it was missing, matching the per-asset table's "Usage per asset". ([#240](https://github.com/dandi/usage-page/pull/240))
- Hyperlinked each Dandiset name in the per-Dandiset table to its landing page on the DANDI archive (`https://dandiarchive.org/dandiset/<id>`), opening in a new tab. Rows without a known name, and the 'undetermined' row (which has no archive page), stay as plain text. Table columns gained an optional `link_fn` for this, which keeps escaping of both the link text and the target URL inside the table renderer. ([#240](https://github.com/dandi/usage-page/pull/240))
- Anchored the default sort of every table view to its first numeric column (the "Bytes" metric) instead of its last column, so appending further metric columns no longer changes which column tables are sorted by on load. ([#240](https://github.com/dandi/usage-page/pull/240))
- Annotated Dandiset ID displays with their current title fetched from an external Dandiset-ID-to-title cache: the Dandiset selector dropdown, the "Usage per Dandiset" histogram's hover text and grouped over-time plot hover text now show "ID - Title", and the histogram table gained a new "Name" column. The "archive" (whole-archive) selection is always labeled "(All) - Archive". Falls back to the bare ID when a title is unavailable. ([#236](https://github.com/dandi/usage-page/pull/236))
- Added pointers to the underlying source data ([dandi/access-summaries](https://github.com/dandi/access-summaries)): a data-repository icon in the header beside the existing code icon, a per-Dandiset link beside the selector to the GitHub folder of summary tables for the current selection, a "Data ▾" menu on every table view (GitHub file view · raw download · containing folder) replacing the previous raw-CDN "Data" link, and a "View source data on GitHub" modebar button on every plot. ([#234](https://github.com/dandi/usage-page/pull/234))

- Excluded the 'undetermined' Dandiset ID from the usage-per-dandiset histogram plot while keeping it visible in the table view. ([#191](https://github.com/dandi/usage-page/pull/191))
- Grey out the plot-specific gear-wheel settings buttons (`ot_settings_btn`, `hist_settings_btn`) when their section is in table view, since those settings only affect plots; the panel is also closed automatically when switching to table view. ([#179](https://github.com/dandi/usage-page/pull/179))
- Appended the first 8 characters of the latest git commit hash to the version string displayed in the bottom-left footer (e.g. `v1.3.8+a25561a7`). ([#174](https://github.com/dandi/usage-page/pull/174))
- Added `number_of_requests` and `number_of_downloads` to Plotly hover text for all plot types (over-time, per-dandiset histogram, per-asset histogram, geographic scatter, geographic choropleth) and as new columns in all sortable table views. ([#201](https://github.com/dandi/usage-page/pull/201))

#### 🐛 Bug Fix

- Applied "Ignore testing datasets" to the per-Dandiset plot as well as its table, so the setting now means the same thing in both views. Previously it filtered the table only, which left the testing Dandisets as the tallest bars of the plot — most visibly under the scaled metrics, which they lead by a wide margin. ([#243](https://github.com/dandi/usage-page/pull/243))
- Fixed the log-scale y-axis of both histograms, which paired six tick positions with only four labels ("KB" through "TB") and so mislabeled the upper decades. All plots now share one y-axis builder, which pairs each decade with its own label. ([#243](https://github.com/dandi/usage-page/pull/243))

#### 🏠 Internal

- Renamed `AGENTS.md` to `CLAUDE.md` and recorded the American-English spelling convention in it. ([#241](https://github.com/dandi/usage-page/pull/241))

- Updated the version-check CI workflow to not trigger on `package-lock.json` changes; updated `AGENTS.md` to match. ([#174](https://github.com/dandi/usage-page/pull/174))
- Updated the version-check workflow to allow dependency-only `package.json` changes (for example Dependabot dependency bumps) without requiring a package version bump. ([#189](https://github.com/dandi/usage-page/pull/189))
- Fixed version-check CI parsing in the dependency-only `package.json` branch by replacing a malformed heredoc with `node -e`, so Dependabot dependency bumps no longer fail unexpectedly. ([#181](https://github.com/dandi/usage-page/pull/181))

#### 🧪 Tests

- Added unit tests for the new gzipped-JSONL data path (`parse_dandiset_numbers_jsonl`, `decode_maybe_gzipped_response`, `fetch_maybe_gzipped_text`), the `scaled_metric` and `format_ratio` helpers, and the table renderer's handling of missing numeric values. The Chromatic fixtures now serve gzipped asset-count and total-size files, so the snapshot run exercises the client-side decompression too. ([#241](https://github.com/dandi/usage-page/pull/241))

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
