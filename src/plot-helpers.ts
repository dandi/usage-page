/**
 * Pure utility and DOM-manipulation helpers used by plots.ts.
 * Extracted here so they can be imported and unit-tested without triggering
 * the module-level side effects (Plotly, fetch calls, event listeners) that
 * live in plots.ts.
 */

import { format_bytes as format_bytes_default } from "./utils.js";

// ── HTML escaping ─────────────────────────────────────────────────────────────

/**
 * Escapes the five HTML-special characters so user-supplied strings are safe
 * to interpolate into innerHTML.
 */
export function escape_html(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// ── Cumulative transform ──────────────────────────────────────────────────────

/**
 * Returns a new array where each element is the running sum of `bytes_sent`
 * up to and including that index.
 */
export function make_cumulative(bytes_sent: number[]): number[] {
    return bytes_sent.reduce((acc: number[], value, index) => {
        acc.push((acc[index - 1] || 0) + value);
        return acc;
    }, []);
}

// ── Fetch with exponential back-off ──────────────────────────────────────────

/**
 * Fetches a URL with automatic retries using exponential backoff.
 * Only retries on transient failures: network errors or 5xx server errors.
 * Permanent client errors (4xx) are thrown immediately without retrying.
 *
 * @param url - The URL to fetch.
 * @param options - Optional fetch options.
 * @param maxRetries - Maximum number of retry attempts.
 * @param baseDelay - Base delay in milliseconds; doubles on each retry (1 s, 2 s, 4 s, 8 s).
 * @returns Resolves with the successful Response.
 * @throws After all retries are exhausted, or immediately on a non-retryable error.
 */
export async function fetchWithRetry(url: string, options: RequestInit = {}, maxRetries = 4, baseDelay = 1000): Promise<Response> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        let response;
        try {
            response = await fetch(url, options);
        } catch (networkError) {
            // Network failure — always retryable
            if (attempt === maxRetries) {
                throw networkError;
            }
            const delay = baseDelay * Math.pow(2, attempt);
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
        }

        if (response.ok) {
            return response;
        }

        // 4xx errors are permanent; do not retry
        if (response.status < 500) {
            throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
        }

        // 5xx errors are transient; retry with backoff
        if (attempt === maxRetries) {
            throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
        }
        const delay = baseDelay * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
    }
    // This line is unreachable but satisfies TypeScript's control-flow analysis
    throw new Error("fetchWithRetry: exhausted retries");
}

// ── Gzip decoding ─────────────────────────────────────────────────────────────

/**
 * Decodes a fetched response body that may be gzip-compressed into text.
 *
 * The gzipped derivative files are served as raw `application/octet-stream`
 * bytes (no `Content-Encoding: gzip` header), so the browser hands them over
 * still compressed and they have to be inflated here.  A caching layer that
 * *does* advertise the encoding will have transparently decompressed the body
 * already, so the gzip magic number is checked first and an already-plain body
 * is simply decoded as text.
 */
export async function decode_maybe_gzipped_response(response: Response): Promise<string> {
    const bytes = new Uint8Array(await response.arrayBuffer());
    const is_gzipped = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
    if (!is_gzipped) return new TextDecoder().decode(bytes);
    if (typeof DecompressionStream === "undefined") {
        throw new Error("Gzipped data cannot be decoded: DecompressionStream is unavailable.");
    }

    const stream = new DecompressionStream("gzip");
    const writer = stream.writable.getWriter();
    // Feeding the stream is deliberately not awaited here: the writes only
    // settle once the reader below drains the decompressed output, so awaiting
    // them first would deadlock.  A corrupt body rejects on both ends of the
    // stream, and it is the reader's rejection that is propagated, so the
    // writer's duplicate is swallowed rather than left unhandled.
    writer
        .write(bytes)
        .then(() => writer.close())
        .catch(() => {});

    const reader = stream.readable.getReader();
    const decoder = new TextDecoder();
    let text = "";
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
}

/**
 * Fetches a (possibly gzipped) file and returns its decoded text, retrying
 * transient failures via `fetchWithRetry`.
 */
export async function fetch_maybe_gzipped_text(url: string): Promise<string> {
    return decode_maybe_gzipped_response(await fetchWithRetry(url));
}

// ── Dandiset ID → value mappings ───────────────────────────────────────────

/**
 * Walks a newline-delimited JSON (JSONL) file where each line is a single
 * `{ "<dandiset_id>": <value> }` object, invoking `visit` for every key/value
 * pair.  Blank lines and lines that fail to parse are skipped so a single
 * malformed entry doesn't prevent the rest of the file from loading.
 */
function for_each_jsonl_entry(text: string, visit: (key: string, value: unknown) => void): void {
    text.split("\n").forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let parsed: unknown;
        try {
            parsed = JSON.parse(trimmed);
        } catch {
            // Skip malformed lines rather than failing the whole page.
            return;
        }
        if (parsed === null || typeof parsed !== "object") return;
        Object.entries(parsed as Record<string, unknown>).forEach(([key, value]) => visit(key, value));
    });
}

/**
 * Parses a JSONL file of `{ "<dandiset_id>": "<title>" }` lines into one
 * lookup map of Dandiset ID → title.
 */
export function parse_dandiset_titles_jsonl(text: string): Record<string, string> {
    const titles: Record<string, string> = {};
    for_each_jsonl_entry(text, (key, value) => {
        titles[key] = value as string;
    });
    return titles;
}

/**
 * Parses a JSONL file of `{ "<dandiset_id>": <number> }` lines (the asset-count
 * and total-size derivatives) into one lookup map of Dandiset ID → number.
 * Entries whose value is not a finite number are dropped, so a malformed value
 * shows up as missing data rather than as a bogus metric.
 */
export function parse_dandiset_numbers_jsonl(text: string): Record<string, number> {
    const numbers: Record<string, number> = {};
    for_each_jsonl_entry(text, (key, value) => {
        if (typeof value === "number" && isFinite(value)) numbers[key] = value;
    });
    return numbers;
}

/**
 * Formats a Dandiset ID for display, appending " - <title>" when a title is
 * known. The "archive" sentinel ID (the whole-archive selection) is always
 * rendered as "(All) - Archive" instead of being looked up. Falls back to
 * the bare ID (e.g. "undetermined", or any ID missing from the lookup) when
 * no title is available.
 */
export function format_dandiset_label(id: string, titles: Record<string, string>): string {
    if (id === "archive") return "(All) - Archive";
    const title = titles[id];
    return title ? `${id} - ${title}` : id;
}

// ── Default map view ──────────────────────────────────────────────────────────

/**
 * Where both map views open, in degrees: the middle of the contiguous United
 * States, which is where most of the archive's traffic is served to.
 */
const MAP_DEFAULT_CENTER = { latitude: 40, longitude: -98 };

/**
 * The width, in CSS pixels, at which a map opens on the whole world.  A map
 * narrower than this opens on a proportionally narrower window on it instead:
 * the world squeezed into a phone's width is both unreadable and, for the
 * points view, needlessly expensive to draw.
 */
const WORLD_VIEW_WIDTH_PX = 1024;

/**
 * The margins Plotly leaves around a plot by default, which the map is drawn
 * inside: 80 px to each side, and 100 px above the plot and 80 below it.  Used
 * to work out the shape of the drawn map from the size of its container, which
 * is the only one of the two known before the map is drawn.
 */
const PLOTLY_HORIZONTAL_MARGIN_PX = 160;
const PLOTLY_VERTICAL_MARGIN_PX = 180;

/** The fraction of the world's 360° of longitude a map of this width opens on. */
function default_view_longitude_fraction(map_width_px: number): number {
    return Math.min(1, map_width_px / WORLD_VIEW_WIDTH_PX);
}

/**
 * The view the choropleth — a MapLibre `map` subplot, which zooms in powers of
 * two over a 512 px world tile — opens on at the given map width.
 *
 * @param map_width_px - Width of the map's container element.
 * @returns The MapLibre `center`, `zoom` and `minzoom` of the default view.
 *          The minimum sits just below the default so the view can always be
 *          restored by zooming out, without letting the map be pulled back so
 *          far that the world no longer fills it.
 */
export function default_choropleth_view(map_width_px: number): {
    center: { lat: number; lon: number };
    zoom: number;
    min_zoom: number;
} {
    const zoom = Math.log2(map_width_px / (512 * default_view_longitude_fraction(map_width_px)));
    return {
        center: { lat: MAP_DEFAULT_CENTER.latitude, lon: MAP_DEFAULT_CENTER.longitude },
        zoom: zoom,
        min_zoom: zoom - 0.15,
    };
}

/**
 * The same view for the points map — a `geo` subplot, which is framed by the
 * window of latitude and longitude it is drawn to rather than by a tile zoom.
 *
 * @param map_width_px - Width of the map's container element.
 * @param map_height_px - Height of the map's container element.
 * @returns The `geo.lonaxis.range` and `geo.lataxis.range` of the default view.
 */
export function default_points_view(map_width_px: number, map_height_px: number): {
    longitude_range: [number, number];
    latitude_range: [number, number];
} {
    const longitude_span = 360 * default_view_longitude_fraction(map_width_px);
    // The window is given the shape of the map it is drawn into, so that it
    // fills the map rather than being letterboxed inside it: a `geo` subplot
    // is drawn to the whole of the window it is given and clipped to it, so
    // one of a shape the map does not have leaves a band of empty paper along
    // whichever pair of sides is over-long.
    const drawn_width = Math.max(1, map_width_px - PLOTLY_HORIZONTAL_MARGIN_PX);
    const drawn_height = Math.max(1, map_height_px - PLOTLY_VERTICAL_MARGIN_PX);
    const latitude_span = Math.min(180, (longitude_span * drawn_height) / drawn_width);

    // A `geo` subplot does not repeat the world to either side the way a tiled
    // map does, so a window that would carry the view off the end of it is
    // pulled back to where the world still fills it — which, on a map opening
    // on the whole world, leaves it centered on the middle of it.
    const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));
    const longitude = clamp(MAP_DEFAULT_CENTER.longitude, 180 - longitude_span / 2);
    const latitude = clamp(MAP_DEFAULT_CENTER.latitude, 90 - latitude_span / 2);
    return {
        longitude_range: [longitude - longitude_span / 2, longitude + longitude_span / 2],
        latitude_range: [latitude - latitude_span / 2, latitude + latitude_span / 2],
    };
}

// ── View-mode helpers ─────────────────────────────────────────────────────────

/**
 * Height of the tallest of the given elements, ignoring those that are absent
 * or hidden (a hidden element has an `offsetHeight` of 0).  Measured before a
 * view switch, this is the height of the view being replaced.
 *
 * The tallest is taken rather than the enclosing section's own height, since
 * both views can briefly be visible at once — a re-render un-hides the plot —
 * and the section then measures as the two of them stacked, which is taller
 * than either view ever is on its own.
 */
function tallest_view_height(elements: (HTMLElement | null)[]): number {
    return elements.reduce((tallest, el) => Math.max(tallest, el ? el.offsetHeight : 0), 0);
}

/**
 * Reserves space for the view that was just switched to while it is still
 * empty, by holding the height of the view it replaced as the section's
 * `min-height`, so elements further down the page do not jump.  Once the new
 * view has rendered content of its own the lock is released: keeping it would
 * leave a gap below whenever the new view is the shorter of the two.
 *
 * @param section_el - The `.view-section` wrapper to lock, if any.
 * @param incoming_el - The view that is now visible.
 * @param outgoing_height - Height of the replaced view, measured before the switch.
 */
function reserve_section_height(
    section_el: HTMLElement | null,
    incoming_el: HTMLElement | null,
    outgoing_height: number
): void {
    if (!section_el) return;
    const incoming_height = incoming_el ? incoming_el.offsetHeight : 0;
    section_el.style.minHeight =
        incoming_height === 0 && outgoing_height > 0 ? outgoing_height + 'px' : '';
}

/**
 * Toggles visibility between a Plotly plot element and its paired table element,
 * reserving the height of the view being replaced while the new one is still
 * empty (see reserve_section_height).
 *
 * @param plot_id - ID of the plot container element.
 * @param table_id - ID of the table container element.
 * @param use_table - When true, shows the table and hides the plot.
 */
export function apply_view_mode(plot_id: string, table_id: string, use_table: boolean): void {
    const plot_el = document.getElementById(plot_id);
    const table_el = document.getElementById(table_id);

    const section_el = (plot_el && plot_el.closest('.view-section')) as HTMLElement | null;
    const outgoing_height = tallest_view_height([plot_el, table_el]);

    if (plot_el) plot_el.style.display = use_table ? "none" : "";
    if (table_el) table_el.style.display = use_table ? "" : "none";

    reserve_section_height(section_el, use_table ? table_el : plot_el, outgoing_height);
}

/**
 * Shows/hides the geography map and its paired table panels according to the
 * selected geo view mode ("regions" | "points" | "table" | "aws").
 */
export function apply_geo_view_mode(view: string): void {
    const mapEl   = document.getElementById("geography_heatmap");
    const tableEl = document.getElementById("geo_table_section");
    const showMap = (view === "regions" || view === "points");

    const section_el = (mapEl && mapEl.closest('.view-section')) as HTMLElement | null;
    const outgoing_height = tallest_view_height([mapEl, tableEl]);

    if (mapEl)   mapEl.style.display   = showMap ? "" : "none";
    if (tableEl) tableEl.style.display = showMap ? "none" : "";
    // When showing a table, hide the one that isn't selected
    const regionsEl = document.getElementById("top_regions_table");
    const awsEl     = document.getElementById("aws_histogram");
    if (regionsEl) regionsEl.style.display = (view === "table") ? "" : "none";
    if (awsEl)     awsEl.style.display     = (view === "aws")   ? "" : "none";

    reserve_section_height(section_el, showMap ? mapEl : tableEl, outgoing_height);
}

// ── Source-data URL derivation ────────────────────────────────────────────────

/**
 * Derives version-tracked GitHub web URLs from a raw.githubusercontent.com
 * file URL, so views can link to the file's rendered GitHub page (with
 * history/blame) and to its containing folder in addition to the raw content.
 *
 * @param raw_url - A `https://raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>` URL.
 * @returns `file` (blob view) and `folder` (tree view) GitHub URLs, or `null`
 *          for both when the input is not a raw.githubusercontent.com URL.
 */
export function derive_data_source_urls(raw_url: string): { raw: string; file: string | null; folder: string | null } {
    const match = raw_url.match(/^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/);
    if (!match) {
        return { raw: raw_url, file: null, folder: null };
    }
    const [, owner, repo, ref, path] = match;
    const dir = path.split("/").slice(0, -1).join("/");
    return {
        raw: raw_url,
        file: `https://github.com/${owner}/${repo}/blob/${ref}/${path}`,
        folder: `https://github.com/${owner}/${repo}/tree/${ref}${dir ? "/" + dir : ""}`,
    };
}

// ── Table download ────────────────────────────────────────────────────────────

interface TableColumn {
    label: string;
    key: string;
    numeric: boolean;
    format_fn?: (val: number) => string;
    link_fn?: (row: Record<string, unknown>) => string | null;
    default_sort?: boolean;
}

/**
 * Returns the text a table cell displays for one column of one row: numeric
 * columns go through the column's formatter (or the table's default one),
 * everything else is stringified as-is.
 */
function table_cell_text(col: TableColumn, row: Record<string, unknown>, format_fn: (val: number) => string): string {
    return col.numeric ? (col.format_fn ?? format_fn)(row[col.key] as number) : String(row[col.key] ?? "");
}

/**
 * Serializes a table to tab-separated values exactly as it is displayed: the
 * same columns in the same order, the same formatted cell text, and `rows` in
 * whatever order they are passed (the caller passes the current sort order).
 * This is what the "Download table" menu item hands back, since the on-page
 * table carries derived columns that no single source file contains.
 *
 * Tabs and newlines inside a cell are collapsed to spaces so one stray value
 * cannot break the column alignment of the whole file.
 */
export function build_table_tsv(
    columns: TableColumn[],
    rows: Array<Record<string, unknown>>,
    format_fn: (bytes: number) => string = format_bytes_default
): string {
    const sanitize = (text: string) => text.replace(/[\t\r\n]+/g, " ");
    const lines = [columns.map((col) => sanitize(col.label)).join("\t")];
    rows.forEach((row) => {
        lines.push(columns.map((col) => sanitize(table_cell_text(col, row, format_fn))).join("\t"));
    });
    return lines.join("\n") + "\n";
}

/**
 * Derives a download filename from a table's heading, e.g. "Usage per
 * Dandiset" → "usage_per_dandiset.tsv".
 */
export function table_download_filename(title: string): string {
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    return `${slug || "table"}.tsv`;
}

/**
 * Hands `text` to the browser as a file download, via a temporary object URL.
 */
function download_text_file(text: string, filename: string, mime_type: string): void {
    const url = URL.createObjectURL(new Blob([text], { type: mime_type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

// ── Sortable table renderer ───────────────────────────────────────────────────

/**
 * The sort each table is currently under, so that re-rendering it with new
 * rows can restore it.  Keyed by the container element (rather than its ID) so
 * the state disappears with the element it belongs to.
 */
const TABLE_SORT_STATE = new WeakMap<HTMLElement, { key: string; asc: boolean; signature: string }>();

/**
 * Renders a sortable HTML table inside a container element.
 * Clicking a column header re-sorts the table in place and updates the sort
 * indicator (▲ ascending / ▼ descending / ⇅ unsorted).
 *
 * @param container_id - ID of the container element.
 * @param title - Heading text rendered above the table.
 * @param columns - Column definitions.  `numeric: true` formats the cell value with
 *        `format_fn()`; otherwise the raw value is displayed as-is.  An optional
 *        `link_fn(row)` turns a non-numeric cell into a hyperlink: it returns the
 *        target URL, or `null` for rows that should stay plain text.  An optional
 *        `default_sort: true` marks the column the table is sorted by on first
 *        render, for tables whose primary metric is not their leftmost one.
 * @param rows - Data rows (plain objects keyed by column.key).
 * @param format_fn - Formatter applied to numeric cell values.  Defaults to
 *        `format_bytes` (decimal SI suffixes).
 * @param data_url - Optional URL to the source data file; when provided a
 *        "Data ▾" menu (GitHub file view / download of the table as shown /
 *        containing folder) is rendered top-right in the table header.  Falls
 *        back to a plain "Data" hyperlink when the URL is not a
 *        raw.githubusercontent.com URL.
 */
export function render_sortable_table(
    container_id: string,
    title: string,
    columns: TableColumn[],
    rows: Array<Record<string, unknown>>,
    format_fn: (bytes: number) => string = format_bytes_default,
    data_url?: string
): void {
    const container = document.getElementById(container_id);
    if (!container) return;

    // Default: sort by the column flagged `default_sort`, else by the first
    // numeric column (the primary "Bytes" metric in most tables here),
    // falling back to the last column when no column is numeric.  Anchoring to
    // a named or leading column rather than the last keeps the default ordering
    // stable as further metric columns are added.
    // sort_asc: true = ascending (A→Z / low→high), false = descending (Z→A / high→low)
    const default_sort_key = (
        columns.find((col) => col.default_sort) ??
        columns.find((col) => col.numeric) ??
        columns[columns.length - 1]
    ).key;

    // Re-rendering a table with fresh rows (a settings toggle, a reload of the
    // same view) keeps whatever sort the user last chose for it, instead of
    // snapping back to the default.  The remembered state only applies to a
    // table with the same columns, so a container that later shows a different
    // table (the per-asset table replacing the per-Dandiset one, say) starts
    // from that table's own default.
    const signature = columns.map((col) => col.key).join(" ");
    const remembered = TABLE_SORT_STATE.get(container);
    const restored = remembered?.signature === signature ? remembered : null;
    let sort_key = restored?.key ?? default_sort_key;
    let sort_asc  = restored?.asc ?? false; // start descending so highest values appear first

    function render_table() {
        const sorted = [...rows].sort((a, b) => {
            const va = a[sort_key];
            const vb = b[sort_key];
            const factor = sort_asc ? 1 : -1;
            if (typeof va === "number" && typeof vb === "number") {
                // Rows without a value for this column (NaN, e.g. a scaled
                // metric whose denominator is unknown) always sink to the
                // bottom, in both sort directions.
                const va_missing = !isFinite(va);
                const vb_missing = !isFinite(vb);
                if (va_missing || vb_missing) {
                    if (va_missing && vb_missing) return 0;
                    return va_missing ? 1 : -1;
                }
                return factor * (va - vb);
            }
            // Numeric-aware locale comparison handles Dandiset IDs like "000123"
            return factor * String(va).localeCompare(String(vb), undefined, { numeric: true });
        });

        let data_link = "";
        if (data_url) {
            const { file, folder } = derive_data_source_urls(data_url);
            data_link = file && folder
                ? `<div class="table-data-menu">` +
                  `<button type="button" class="table-data-menu-btn" aria-haspopup="true" aria-expanded="false">Data <span class="table-data-caret">▾</span></button>` +
                  `<div class="table-data-menu-panel" role="menu">` +
                  `<a href="${escape_html(file)}" target="_blank" rel="noopener" role="menuitem">View file on GitHub</a>` +
                  `<button type="button" class="table-data-menu-download" role="menuitem">Download table</button>` +
                  `<a href="${escape_html(folder)}" target="_blank" rel="noopener" role="menuitem">Browse data folder</a>` +
                  `</div></div>`
                : `<a class="table-data-link" href="${escape_html(data_url)}" target="_blank" rel="noopener">Data</a>`;
        }
        let html = `<div class="plot-table-header"><h3>${escape_html(title)}</h3>${data_link}</div>`;
        html += '<div class="plot-table-container"><table><thead><tr>';
        columns.forEach((col) => {
            const is_sorted = col.key === sort_key;
            const indicator = is_sorted ? (sort_asc ? "▲" : "▼") : "⇅";
            const cls = is_sorted ? "th-sorted" : "th-sortable";
            html += `<th class="${cls}" data-key="${escape_html(col.key)}">${escape_html(col.label)} <span class="sort-indicator">${indicator}</span></th>`;
        });
        html += "</tr></thead><tbody>";
        sorted.forEach((row) => {
            html += "<tr>";
            columns.forEach((col) => {
                let val;
                if (col.numeric) {
                    val = (col.format_fn ?? format_fn)(row[col.key] as number);
                } else {
                    val = escape_html(String(row[col.key] ?? ""));
                    // Only link cells that have text to click and a well-formed
                    // http(s) target, so an empty cell never becomes an
                    // invisible link and no other URL scheme can be injected.
                    const href = val === "" ? null : col.link_fn?.(row);
                    if (href && /^https?:\/\//.test(href)) {
                        val = `<a class="table-cell-link" href="${escape_html(href)}" target="_blank" rel="noopener">${val}</a>`;
                    }
                }
                html += `<td>${val}</td>`;
            });
            html += "</tr>";
        });
        html += "</tbody></table></div>";
        container!.innerHTML = html;

        // Attach "Data ▾" menu handlers after innerHTML is set
        const menu = container!.querySelector(".table-data-menu");
        const menu_btn = menu?.querySelector(".table-data-menu-btn");
        if (menu && menu_btn) {
            const close_menu = () => {
                menu.classList.remove("open");
                menu_btn.setAttribute("aria-expanded", "false");
                document.removeEventListener("click", on_document_click);
            };
            const on_document_click = (event: MouseEvent) => {
                if (!menu.contains(event.target as Node)) close_menu();
            };
            menu_btn.addEventListener("click", () => {
                const open = menu.classList.toggle("open");
                menu_btn.setAttribute("aria-expanded", String(open));
                if (open) {
                    document.addEventListener("click", on_document_click);
                } else {
                    document.removeEventListener("click", on_document_click);
                }
            });
            menu.addEventListener("keydown", (event) => {
                if ((event as KeyboardEvent).key === "Escape") {
                    close_menu();
                    (menu_btn as HTMLElement).focus();
                }
            });

            // Downloads the table as it currently stands — including the sort
            // order in effect — rather than the source file behind it.
            menu.querySelector(".table-data-menu-download")?.addEventListener("click", () => {
                download_text_file(
                    build_table_tsv(columns, sorted, format_fn),
                    table_download_filename(title),
                    "text/tab-separated-values"
                );
                close_menu();
            });
        }

        // Attach sort click handlers after innerHTML is set
        container!.querySelectorAll("th[data-key]").forEach((th) => {
            th.addEventListener("click", () => {
                const key = (th as HTMLElement).dataset.key!;
                if (key === sort_key) {
                    sort_asc = !sort_asc;
                } else {
                    sort_key = key;
                    sort_asc  = false; // first click on a new column → descending (high→low)
                }
                TABLE_SORT_STATE.set(container!, { key: sort_key, asc: sort_asc, signature });
                render_table();
            });
        });
    }

    render_table();
}

// ── Totals summary ────────────────────────────────────────────────────────────

/** One entry of the totals summary: a metric label above its formatted value. */
export interface TotalsMetric {
    label: string;
    value: string;
    /** Caveat about the metric, shown behind an info icon beside its label. */
    tooltip?: string;
}

export interface TotalsSummary {
    /** Line above the table naming what the totals cover. */
    caption: string;
    /** Caveats that apply to the summary as a whole, shown behind an info icon. */
    caption_tooltip?: string;
    metrics: TotalsMetric[];
    /** Optional line below the table, for a selection-specific remark. */
    note?: string;
    note_tooltip?: string;
}

/**
 * Markup for one info icon, matching the icons used by the settings panels:
 * hovering (or focusing) it reveals `tooltip`, which is also the accessible
 * name so the text is reachable without a pointer.
 */
function info_icon_html(label: string, tooltip: string): string {
    const text = escape_html(tooltip);
    return (
        `<span class="info-icon info-icon-wide" data-tooltip="${text}" tabindex="0" role="img" ` +
        `aria-label="${escape_html(label)}: ${text}">i</span>`
    );
}

/**
 * Renders the scalar totals of the current selection as a table of one metric
 * per row — laid out by the stylesheet as a row of labelled columns — instead
 * of a sentence.  Caveats that used to trail the sentence as footnotes are
 * attached to the metric they qualify (or to the caption, when they qualify
 * the whole summary) as info icons.
 *
 * Each metric is its own row so that the layout can wrap to as many lines as
 * the viewport needs, rather than overflowing a single row of columns; the
 * ARIA roles restate the semantics the display changes behind that would
 * otherwise drop.
 */
export function render_totals_summary(container_id: string, summary: TotalsSummary): void {
    const container = document.getElementById(container_id);
    if (!container) return;

    const caption_icon = summary.caption_tooltip
        ? " " + info_icon_html(summary.caption, summary.caption_tooltip)
        : "";
    let html =
        `<div class="totals-caption">${escape_html(summary.caption)}${caption_icon}</div>` +
        '<table class="totals-table" role="table"><tbody role="rowgroup">';
    summary.metrics.forEach((metric) => {
        const icon = metric.tooltip ? " " + info_icon_html(metric.label, metric.tooltip) : "";
        html +=
            '<tr role="row">' +
            `<th scope="row" role="rowheader"><span class="totals-th-inner">${escape_html(metric.label)}${icon}</span></th>` +
            `<td role="cell">${escape_html(metric.value)}</td>` +
            "</tr>";
    });
    html += "</tbody></table>";
    if (summary.note) {
        const note_icon = summary.note_tooltip ? " " + info_icon_html(summary.note, summary.note_tooltip) : "";
        html += `<div class="totals-note">${escape_html(summary.note)}${note_icon}</div>`;
    }

    container.innerHTML = html;
}
