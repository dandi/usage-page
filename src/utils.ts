/**
 * Pure utility functions shared across the application.
 * All exports here are side-effect-free and have no DOM or Plotly dependencies,
 * making them straightforward to unit test.
 */

export function setUrlParam(params: URLSearchParams, key: string, value: string, defaultValue: string): void {
    if (value === defaultValue) {
        params.delete(key);
    } else {
        params.set(key, value);
    }
}

export function color_with_alpha(color: string, alpha: number): string {
    const rgba_match = color.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (rgba_match) {
        return `rgba(${rgba_match[1]},${rgba_match[2]},${rgba_match[3]},${alpha})`;
    }
    const hex_match = color.match(/^#([0-9a-fA-F]{6})$/);
    if (hex_match) {
        const r = parseInt(hex_match[1].slice(0, 2), 16);
        const g = parseInt(hex_match[1].slice(2, 4), 16);
        const b = parseInt(hex_match[1].slice(4, 6), 16);
        return `rgba(${r},${g},${b},${alpha})`;
    }
    return color;
}

export function parse_by_day_tsv(text: string): { dates: string[]; bytes: number[]; requests: number[]; downloads: number[] } {
    const rows = text.split("\n").filter((row) => row.trim() !== "");
    if (rows.length < 2) throw new Error("TSV file does not contain enough data.");
    const raw_data = rows.slice(1).map((row) => row.split("\t"));
    return {
        dates: raw_data.map((row) => row[0]),
        bytes: raw_data.map((row) => parseInt(row[1], 10)),
        requests: raw_data.map((row) => parseInt(row[2] || "0", 10)),
        downloads: raw_data.map((row) => parseInt(row[3] || "0", 10)),
    };
}

export function parse_by_asset_type_per_week_tsv(text: string): { dates: string[]; asset_types: string[]; series_map: Map<string, number[]> } {
    const rows = text.split("\n").filter((row) => row.trim() !== "");
    if (rows.length < 2) throw new Error("TSV file does not contain enough data.");
    const headers = rows[0].split("\t");
    const asset_types = headers.slice(1);
    const data_rows = rows.slice(1).map((row) => row.split("\t"));
    const dates = data_rows.map((row) => row[0]);
    const series_map = new Map<string, number[]>();
    asset_types.forEach((type, col_idx) => {
        series_map.set(type, data_rows.map((row) => parseInt(row[col_idx + 1], 10) || 0));
    });
    return { dates, asset_types, series_map };
}

export function aggregate_by_timebin(dates: string[], bytes_sent: number[], aggregation: string): { dates: string[]; bytes_sent: number[] } {
    if (aggregation === "daily") {
        return { dates, bytes_sent };
    }

    const bin_map = new Map<string, number>();
    dates.forEach((date_str, i) => {
        const date = new Date(date_str + "T00:00:00Z");
        let bin_key;
        if (aggregation === "weekly") {
            // Find the Monday (ISO week start) for this date
            const day_of_week = date.getUTCDay(); // 0 = Sunday, 1 = Monday, ...
            const days_to_monday = day_of_week === 0 ? -6 : 1 - day_of_week;
            const monday = new Date(date);
            monday.setUTCDate(date.getUTCDate() + days_to_monday);
            bin_key = monday.toISOString().slice(0, 10);
        } else if (aggregation === "monthly") {
            bin_key = date_str.slice(0, 7); // "YYYY-MM"
        } else { // "yearly"
            bin_key = date_str.slice(0, 4); // "YYYY"
        }
        bin_map.set(bin_key, (bin_map.get(bin_key) ?? 0) + bytes_sent[i]);
    });

    // ISO strings sort lexicographically, so this preserves chronological order
    const sorted_keys = Array.from(bin_map.keys()).sort();
    return {
        dates: sorted_keys,
        bytes_sent: sorted_keys.map((k) => bin_map.get(k) as number),
    };
}

export function format_bytes(bytes: number, decimals = 2, use_binary = false): string {
    if (bytes === 0) return "0 Bytes";

    const k = use_binary ? 1024 : 1000;
    const sizes = use_binary
        ? ["Bytes", "KiB", "MiB", "GiB", "TiB", "PiB", "EiB", "ZiB", "YiB"]
        : ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    const reduced = parseFloat((bytes / Math.pow(k, i)).toFixed(decimals));

    return `${reduced} ${sizes[i]}`;
}
