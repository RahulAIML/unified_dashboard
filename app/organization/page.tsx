"use client"

import { useMemo } from "react"
import { Users, Shield, UserCog, Building2 } from "lucide-react"
import { DashboardHeader } from "@/components/DashboardHeader"
import { MetricCard } from "@/components/MetricCard"
import { useApi, buildApiUrl } from "@/lib/hooks/useApi"
import { useDashboardStore } from "@/lib/store"
import { useT } from "@/lib/lang-store"
import { useAuthContext } from "@/components/AuthProvider"
import type { OrganizationApiResponse } from "@/lib/types"

interface AccessCaps { hasPharmaAccess?: boolean }

export default function OrganizationPage() {
  const { dateRange, refreshKey } = useDashboardStore()
  const t = useT()
  const { user } = useAuthContext()

  const { data: access } = useApi<AccessCaps>(user ? "/api/auth/access-status" : null)
  const ready = access?.hasPharmaAccess === true

  const url = ready
    ? buildApiUrl("/api/dashboard/organization", dateRange.from, dateRange.to, { rk: refreshKey })
    : null
  const { data, loading } = useApi<OrganizationApiResponse>(url)

  // Group members under their admin so the structure reads as a hierarchy;
  // members with no admin fall into an "unassigned" bucket.
  const grouped = useMemo(() => {
    if (!data) return []
    const byAdmin = new Map<number | null, typeof data.members>()
    for (const m of data.members) {
      const key = m.adminId ?? null
      if (!byAdmin.has(key)) byAdmin.set(key, [])
      byAdmin.get(key)!.push(m)
    }
    return data.admins.map(a => ({ admin: a, members: byAdmin.get(a.id) ?? [] }))
      .concat(byAdmin.has(null) ? [{ admin: null as never, members: byAdmin.get(null)! }] : [])
  }, [data])

  return (
    <div className="min-h-screen w-full">
      <DashboardHeader title={t.orgTitle} subtitle={t.orgSub} showModuleFilter={false} />

      <div className="w-full px-4 sm:px-6 lg:px-8 py-5 sm:py-8 space-y-6 max-w-[1400px] mx-auto">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-24 rounded-[16px] bg-muted/50 animate-pulse" />)}
          </div>
        ) : !data || (data.totalMembers === 0 && data.totalAdmins === 0) ? (
          <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
            <Building2 className="w-10 h-10 opacity-25 mb-3" />
            <p className="text-sm">{t.noDataAvailable}</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <MetricCard label={t.orgAdmins}      value={data.totalAdmins}      icon={<Shield className="w-4 h-4" />} />
              <MetricCard label={t.orgSupervisors} value={data.totalSupervisors} icon={<UserCog className="w-4 h-4" />} />
              <MetricCard label={t.orgMembers}      value={data.totalMembers}     icon={<Users className="w-4 h-4" />} />
            </div>

            <div className="space-y-4">
              {grouped.map((g, gi) => (
                <div key={g.admin?.id ?? `unassigned-${gi}`} className="rounded-[16px] border border-border/60 bg-card shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] overflow-hidden">
                  <div className="px-4 sm:px-5 py-3.5 border-b border-border/60 bg-muted/30 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <Shield className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{g.admin?.fullName ?? t.orgUnassigned}</p>
                      {g.admin && <p className="text-xs text-muted-foreground truncate">{g.admin.email} · {g.admin.profileType}</p>}
                    </div>
                    <span className="ml-auto text-xs text-muted-foreground shrink-0">{g.members.length} {t.orgMembers}</span>
                  </div>
                  {g.members.length > 0 && (
                    <div className="divide-y divide-border/50">
                      {g.members.map(m => (
                        <div key={m.id} className="px-4 sm:px-5 py-2.5 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm text-foreground truncate">{m.fullName}</p>
                            <p className="text-xs text-muted-foreground truncate">{m.email}</p>
                          </div>
                          {m.designation && <span className="text-xs text-muted-foreground shrink-0">{m.designation}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
