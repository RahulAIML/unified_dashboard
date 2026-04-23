"use client"

import { useState } from "react"
import { Download } from "lucide-react"
import { cn } from "@/lib/utils"

interface Props<T> {
  /** Rows to export */
  data: T[]
  /** Column definitions — header + value extractor */
  columns: { header: string; value: (row: T) => unknown }[]
  /** File name, e.g. "coach-2026-04-23.csv" */
  filename: string
  /** Optional extra CSS classes */
  className?: string
  /** Label shown on the button (default: "Export CSV") */
  label?: string
}

/**
 * Zero-dependency CSV export button.
 * Accepts the same column definition shape as buildCsv() in lib/csv-export.ts.
 */
export function ExportButton<T>({
  data,
  columns,
  filename,
  className,
  label = "Export CSV",
}: Props<T>) {
  const [busy, setBusy] = useState(false)

  async function handleClick() {
    if (busy) return
    setBusy(true)
    try {
      // Dynamic import keeps csv-export out of the critical bundle
      const { buildCsv, downloadCsv } = await import("@/lib/csv-export")
      const csv = buildCsv(data, columns)
      downloadCsv(csv, filename)
    } finally {
      setBusy(false)
    }
  }

  const isEmpty = !data.length

  return (
    <button
      onClick={handleClick}
      disabled={busy}
      title={isEmpty ? `Download empty export (${filename})` : `Download ${filename}`}
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold",
        "border transition-all select-none",
        isEmpty
          ? "border-border text-muted-foreground hover:bg-muted/50"
          : "bg-primary text-primary-foreground border-transparent hover:bg-primary/90 active:scale-[0.97]",
        className
      )}
    >
      <Download className={cn("w-3.5 h-3.5", busy && "animate-bounce")} />
      {busy ? "Exporting…" : label}
    </button>
  )
}
