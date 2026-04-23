"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ArrowUpDown, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/lang-store"

export interface Column<T> {
  key: keyof T | string
  header: string
  render?: (row: T) => React.ReactNode
  sortable?: boolean
  className?: string
}

interface Props<T extends object> {
  data: T[]
  columns: Column<T>[]
  pageSize?: number
}

export function DataTable<T extends object>({
  data,
  columns,
  pageSize = 10,
}: Props<T>) {
  const t = useT()
  const [search,  setSearch]  = useState("")
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [page,    setPage]    = useState(1)

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc")
    else { setSortKey(key); setSortDir("asc") }
    setPage(1)
  }

  const filtered = data.filter(row =>
    Object.values(row as Record<string, unknown>).some(v =>
      String(v ?? "").toLowerCase().includes(search.toLowerCase())
    )
  )

  const sorted = sortKey
    ? [...filtered].sort((a, b) => {
        const av = (a as Record<string, unknown>)[sortKey]
        const bv = (b as Record<string, unknown>)[sortKey]
        // Sort numerically when both values are finite numbers
        const an = Number(av)
        const bn = Number(bv)
        if (Number.isFinite(an) && Number.isFinite(bn)) {
          return sortDir === "asc" ? an - bn : bn - an
        }
        const as_ = String(av ?? "")
        const bs_ = String(bv ?? "")
        return sortDir === "asc"
          ? as_ > bs_ ? 1 : -1
          : as_ < bs_ ? 1 : -1
      })
    : filtered

  const totalPages = Math.ceil(sorted.length / pageSize)
  const paged = sorted.slice((page - 1) * pageSize, page * pageSize)

  return (
    <div className="space-y-3">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <input
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1) }}
          placeholder={t.searchPlaceholder}
          className="w-full pl-8 pr-4 py-2 text-sm bg-muted/50 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              {columns.map(col => (
                <th
                  key={String(col.key)}
                  onClick={() => col.sortable !== false && toggleSort(String(col.key))}
                  className={cn(
                    "px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider",
                    col.sortable !== false && "cursor-pointer hover:text-foreground select-none",
                    col.className
                  )}
                >
                  <span className="flex items-center gap-1">
                    {col.header}
                    {col.sortable !== false && (
                      <ArrowUpDown className="w-3 h-3 opacity-40" />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            <AnimatePresence mode="wait">
              {paged.map((row, i) => (
                <motion.tr
                  key={i}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ delay: i * 0.02 }}
                  className="hover:bg-muted/30 transition-colors"
                >
                  {columns.map(col => (
                    <td key={String(col.key)} className={cn("px-4 py-3 text-foreground/80", col.className)}>
                      {col.render
                        ? col.render(row)
                        : String((row as Record<string, unknown>)[String(col.key)] ?? "—")}
                    </td>
                  ))}
                </motion.tr>
              ))}
            </AnimatePresence>
            {paged.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-muted-foreground text-sm">
                  No results found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{t.showing} {filtered.length}</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-2 py-1 rounded border border-border disabled:opacity-30 hover:bg-muted transition-colors"
            >
              {t.prev}
            </button>
            <span>{t.pageLabel} {page} / {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-2 py-1 rounded border border-border disabled:opacity-30 hover:bg-muted transition-colors"
            >
              {t.next}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
