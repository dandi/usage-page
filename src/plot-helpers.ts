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

// ── View-mode helpers ─────────────────────────────────────────────────────────

/**
 * Toggles visibility between a Plotly plot element and its paired table element.
 * Before switching, the enclosing `.view-section` wrapper's current rendered
 * height is stored as its `min-height`, so elements further down the page do
 * not jump when a shorter view replaces a taller one.
 *
 * @param plot_id - ID of the plot container element.
 * @param table_id - ID of the table container element.
 * @param use_table - When true, shows the table and hides the plot.
 */
export function apply_view_mode(plot_id: string, table_id: string, use_table: boolean): void {
    const plot_el = document.getElementById(plot_id);
    const table_el = document.getElementById(table_id);

    const section_el = (plot_el && plot_el.closest('.view-section')) as HTMLElement | null;
    if (section_el) {
        if (use_table) {
            // Switching to table: lock the current (plot) height so elements below
            // don't jump while the table renders.
            const current_height = section_el.offsetHeight;
            if (current_height > 0) {
                section_el.style.minHeight = current_height + 'px';
            }
        } else {
            // Switching back to plot: release the lock so the section shrinks back
            // to the plot's natural height and doesn't leave an empty gap below.
            section_el.style.minHeight = '';
        }
    }

    if (plot_el) plot_el.style.display = use_table ? "none" : "";
    if (table_el) table_el.style.display = use_table ? "" : "none";
}

/**
 * Shows/hides the geography map and its paired table panels according to the
 * selected geo view mode ("regions" | "points" | "table" | "aws").
 */
export function apply_geo_view_mode(view: string): void {
    const mapEl   = document.getElementById("geography_heatmap");
    const tableEl = document.getElementById("geo_table_section");
    const showMap = (view === "regions" || view === "points");

    // Lock the section height before switching to prevent layout shift on elements below
    const section_el = (mapEl && mapEl.closest('.view-section')) as HTMLElement | null;
    if (section_el) {
        if (!showMap) {
            // Switching to table: lock the current (map) height so elements below
            // don't jump while the table renders.
            const current_height = section_el.offsetHeight;
            if (current_height > 0) {
                section_el.style.minHeight = current_height + 'px';
            }
        } else {
            // Switching back to map: release the lock so the section returns to its
            // natural height and doesn't leave an empty gap below.
            section_el.style.minHeight = '';
        }
    }

    if (mapEl)   mapEl.style.display   = showMap ? "" : "none";
    if (tableEl) tableEl.style.display = showMap ? "none" : "";
    // When showing a table, hide the one that isn't selected
    const regionsEl = document.getElementById("top_regions_table");
    const awsEl     = document.getElementById("aws_histogram");
    if (regionsEl) regionsEl.style.display = (view === "table") ? "" : "none";
    if (awsEl)     awsEl.style.display     = (view === "aws")   ? "" : "none";
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

// ── Sortable table renderer ───────────────────────────────────────────────────

/**
 * Renders a sortable HTML table inside a container element.
 * Clicking a column header re-sorts the table in place and updates the sort
 * indicator (▲ ascending / ▼ descending / ⇅ unsorted).
 *
 * @param container_id - ID of the container element.
 * @param title - Heading text rendered above the table.
 * @param columns - Column definitions.  `numeric: true` formats the cell value with
 *        `format_fn()`; otherwise the raw value is displayed as-is.
 * @param rows - Data rows (plain objects keyed by column.key).
 * @param format_fn - Formatter applied to numeric cell values.  Defaults to
 *        `format_bytes` (decimal SI suffixes).
 * @param data_url - Optional URL to the source data file; when provided a
 *        "Data ▾" menu (GitHub file view / raw download / containing folder)
 *        is rendered top-right in the table header.  Falls back to a plain
 *        "Data" hyperlink when the URL is not a raw.githubusercontent.com URL.
 */
export function render_sortable_table(
    container_id: string,
    title: string,
    columns: Array<{label: string; key: string; numeric: boolean; format_fn?: (val: number) => string}>,
    rows: Array<Record<string, unknown>>,
    format_fn: (bytes: number) => string = format_bytes_default,
    data_url?: string
): void {
    const container = document.getElementById(container_id);
    if (!container) return;

    // Default: sort by the last column (bytes) descending
    // sort_asc: true = ascending (A→Z / low→high), false = descending (Z→A / high→low)
    let sort_key = columns[columns.length - 1].key;
    let sort_asc  = false; // start descending so highest values appear first

    function render_table() {
        const sorted = [...rows].sort((a, b) => {
            const va = a[sort_key];
            const vb = b[sort_key];
            const factor = sort_asc ? 1 : -1;
            if (typeof va === "number" && typeof vb === "number") {
                return factor * ((va as number) - (vb as number));
            }
            // Numeric-aware locale comparison handles Dandiset IDs like "000123"
            return factor * String(va).localeCompare(String(vb), undefined, { numeric: true });
        });

        let data_link = "";
        if (data_url) {
            const { raw, file, folder } = derive_data_source_urls(data_url);
            data_link = file && folder
                ? `<div class="table-data-menu">` +
                  `<button type="button" class="table-data-menu-btn" aria-haspopup="true" aria-expanded="false">Data <span class="table-data-caret">▾</span></button>` +
                  `<div class="table-data-menu-panel" role="menu">` +
                  `<a href="${escape_html(file)}" target="_blank" rel="noopener" role="menuitem">View file on GitHub</a>` +
                  `<a href="${escape_html(raw)}" target="_blank" rel="noopener" role="menuitem">Download raw file</a>` +
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
                const val = col.numeric ? (col.format_fn ?? format_fn)(row[col.key] as number) : escape_html(String(row[col.key] ?? ""));
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
                render_table();
            });
        });
    }

    render_table();
}
