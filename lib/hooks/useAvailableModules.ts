"use client"

import { useApi } from "./useApi"
import { useAuthContext } from "@/components/AuthProvider"
import type { Module } from "@/lib/types"

const ALL: Module[] = ['lms', 'coach', 'simulator', 'certification', 'second-brain']

/**
 * Modules (solutions) the signed-in tenant actually has, from
 * /api/dashboard/modules. Drives dynamic rendering: the module filter and the
 * sidebar show only these, so a client never sees a tab with no data.
 *
 * While loading (or if the probe fails) it returns the full set so nothing is
 * hidden prematurely — the UI narrows once the real list arrives.
 */
export function useAvailableModules(): { modules: Module[]; loading: boolean } {
  const { user } = useAuthContext()
  const { data, loading } = useApi<{ modules: string[] }>(
    user ? "/api/dashboard/modules" : null
  )

  if (loading || !data?.modules) return { modules: ALL, loading }

  const allowed = new Set(data.modules)
  const modules = ALL.filter(m => allowed.has(m))
  // Never render an empty selector — fall back to all if the probe returned none.
  return { modules: modules.length ? modules : ALL, loading: false }
}
