/**
 * csv-export.ts — lightweight, zero-dependency CSV generation for the browser.
 *
 * Usage:
 *   import { buildCsv, downloadCsv } from "@/lib/csv-export"
 *
 *   const csv = buildCsv(rows, [
 *     { header: "Report ID", value: r => r.savedReportId },
 *     { header: "Score",     value: r => r.score ?? "" },
 *   ])
 *   downloadCsv(csv, "export-2026-04.csv")
 */

// ── Cell serialiser ───────────────────────────────────────────────────────────

/**
 * Converts any value to a CSV-safe string:
 *  - null / undefined  → empty string
 *  - Date              → YYYY-MM-DD
 *  - strings with commas / quotes / newlines → wrapped in double quotes
 *  - everything else   → String(value).trim()
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  const s = String(value).trim()
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

// ── Column definition ─────────────────────────────────────────────────────────

export interface CsvColumn<T> {
  /** Text shown in the header row */
  header: string
  /** Extract the cell value from a row — return null / undefined for empty */
  value: (row: T) => unknown
}

// ── Builder ───────────────────────────────────────────────────────────────────

/**
 * Builds a CSV string from an array of rows and column definitions.
 *
 * Returns a single "No data available" line when rows is empty so the
 * downloaded file is never completely blank.
 */
export function buildCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  if (!rows.length) return "No data available\n"
  const header = columns.map((c) => csvCell(c.header)).join(",")
  const body   = rows
    .map((row) => columns.map((c) => csvCell(c.value(row))).join(","))
    .join("\n")
  return `${header}\n${body}\n`
}

// ── Downloader ────────────────────────────────────────────────────────────────

/**
 * Triggers a browser file-download of a CSV string.
 * Cleans up the object URL immediately after the click.
 */
export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }) // BOM for Excel
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement("a")
  a.href     = url
  a.download = filename
  a.style.display = "none"
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── Filename helper ───────────────────────────────────────────────────────────

/** Returns a filename like "kpi-summary-2026-04-23.csv" */
export function csvFilename(prefix: string): string {
  const date = new Date().toISOString().slice(0, 10)
  return `${prefix}-${date}.csv`
}
