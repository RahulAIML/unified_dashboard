'use client'

import { useEffect, useRef } from 'react'
import { useDashboardStore } from '@/lib/store'
import { useAuthContext } from '@/components/AuthProvider'

/**
 * On the first authenticated mount, fetch the tenant's real data span from
 * /api/dashboard/data-bounds and snap the dashboard's default date range to it,
 * exactly once. This is why a tenant like Apotex (772 sessions spanning
 * Oct 2025–Jun 2026) now shows its full history on login instead of only the
 * handful of sessions that fell inside an arbitrary trailing window.
 *
 * No-ops when: not authenticated, the user has already changed the range
 * (rangeInitialized), the request fails, or bounds are unavailable — in every
 * one of those cases the store keeps its default window. Never throws.
 */
export function useSnapDateRange() {
  const { isAuthenticated } = useAuthContext()
  const initializeDateRange = useDashboardStore((s) => s.initializeDateRange)
  const rangeInitialized = useDashboardStore((s) => s.rangeInitialized)
  const attempted = useRef(false)

  useEffect(() => {
    if (!isAuthenticated || attempted.current || rangeInitialized) return
    attempted.current = true

    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/dashboard/data-bounds', { credentials: 'include' })
        if (!res.ok) return
        const json = (await res.json().catch(() => null)) as
          | { data?: { from?: string; to?: string } | null }
          | null
        const data = json?.data
        if (cancelled || !data?.from || !data?.to) return

        const from = new Date(data.from)
        const to = new Date(data.to)
        if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return

        initializeDateRange({ from, to })
      } catch {
        // Non-fatal — keep the default window.
      }
    })()

    return () => {
      cancelled = true
    }
  }, [isAuthenticated, rangeInitialized, initializeDateRange])
}
