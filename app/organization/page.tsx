"use client"

import { useMemo } from "react"
import { Users, Shield, UserCog, Building2, UserX } from "lucide-react"
import { DashboardHeader } from "@/components/DashboardHeader"
import { MetricCard } from "@/components/MetricCard"
import { useApi, buildApiUrl } from "@/lib/hooks/useApi"
import { useDashboardStore } from "@/lib/store"
import { useT } from "@/lib/lang-store"
import { useAuthContext } from "@/components/AuthProvider"
import type { OrganizationApiResponse } from "@/lib/types"

interface AccessCaps { hasPharmaAccess?: boolean; hasRolplayAppAccess?: boolean }

const MODULE_LABEL_KEY: Record<string, "navCoach" | "navSimulator" | "navCertification"> = {
  coach: "navCoach", simulator: "navSimulator", certification: "navCertification",
}

export default function OrganizationPage() {
  const { dateRange, refreshKey } = useDashboardStore()
  const t = useT()
  const { user } = useAuthContext()

  const { data: access } = useApi<AccessCaps>(user ? "/api/auth/access-status" : null)
  const ready = access?.hasPharmaAccess === true || access?.hasRolplayAppAccess === true

  const url = ready
    ? buildApiUrl("/api/dashboard/organization", dateRange.from, dateRange.to, { rk: refreshKey })
    : null
  const { data, loading } = useApi<OrganizationApiResponse>(url)

  // rolplay-app tenants have no real admin/member hierarchy (adminId is
  // always null, admins is always []) -- lib/bridge-rolplay-app.ts's
  // rolplayAppOrganization instead annotates each member with real activity
  // (status/sessions/modulesUsed/lastSessionAt). Detecting THAT shape, not
  // just "no admins", so a pharma tenant with a genuinely empty admin list
  // keeps its existing grouped/"Unassigned" rendering unchanged.
  const isFlatRoster = !!data && data.members.some(m => m.status !== undefined)

  // Group members under their admin so the structure reads as a hierarchy;
  // members with no admin fall into an "unassigned" bucket. Pharma path only.
  const grouped = useMemo(() => {
    if (!data || isFlatRoster) return []
    const byAdmin = new Map<number | null, typeof data.members>()
    for (const m of data.members) {
      const key = m.adminId ?? null
      if (!byAdmin.has(key)) byAdmin.set(key, [])
      byAdmin.get(key)!.push(m)
    }
    return data.admins.map(a => ({ admin: a, members: byAdmin.get(a.id) ?? [] }))
      .concat(byAdmin.has(null) ? [{ admin: null as never, members: byAdmin.get(null)! }] : [])
  }, [data, isFlatRoster])

  const neverPracticed = isFlatRoster && data ? data.members.filter(m => (m.sessions ?? 0) === 0).length : 0

  return (
    <div className="min-h-screen w-full">
      <DashboardHeader title={t.orgTitle} subtitle={isFlatRoster ? t.orgSubFlat : t.orgSub} showModuleFilter={false} />

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
        ) : isFlatRoster ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <MetricCard label={t.orgRegistered}     value={data.totalMembers} icon={<Users className="w-4 h-4" />} info={t.orgRegisteredInfo} />
              <MetricCard label={t.orgMembers}         value={data.members.length - neverPracticed} icon={<UserCog className="w-4 h-4" />} info={t.orgMembersInfo} />
              <MetricCard label={t.orgNeverPracticed} value={neverPracticed}   icon={<UserX className="w-4 h-4" />} info={t.orgNeverPracticedInfo} />
            </div>

            <div className="rounded-[16px] border border-border/60 bg-card shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] overflow-hidden">
              <div className="divide-y divide-border/50">
                {data.members.map(m => (
                  <div key={m.id} className="px-4 sm:px-5 py-3 flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-foreground truncate">{m.fullName || m.email}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {m.email}
                        {m.department ? ` · ${m.department}` : ""}
                        {m.designation ? ` · ${m.designation}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-4 text-right shrink-0">
                      <div className="min-w-[90px]">
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{t.orgModulesUsed}</p>
                        <p className="text-xs text-foreground">
                          {m.modulesUsed && m.modulesUsed.length > 0
                            ? m.modulesUsed.map(mod => t[MODULE_LABEL_KEY[mod]] ?? mod).join(", ")
                            : "—"}
                        </p>
                      </div>
                      <div className="min-w-[70px]">
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{t.orgSessionsShort}</p>
                        <p className="text-sm font-bold text-foreground tabular-nums">{m.sessions ?? 0}</p>
                      </div>
                      <div className="min-w-[90px]">
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{t.orgLastSession}</p>
                        <p className="text-xs text-foreground">{m.lastSessionAt ? String(m.lastSessionAt).slice(0, 10) : t.orgNoSessionYet}</p>
                      </div>
                      <span className={
                        "text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 " +
                        (m.status === "disabled" ? "bg-muted text-muted-foreground" : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400")
                      }>
                        {m.status === "disabled" ? t.orgStatusDisabled : t.orgStatusActive}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <MetricCard label={t.orgAdmins}      value={data.totalAdmins}      icon={<Shield className="w-4 h-4" />} info={t.orgAdminsInfo} />
              <MetricCard label={t.orgSupervisors} value={data.totalSupervisors} icon={<UserCog className="w-4 h-4" />} info={t.orgSupervisorsInfo} />
              <MetricCard label={t.orgMembers}      value={data.totalMembers}     icon={<Users className="w-4 h-4" />} info={t.orgMembersInfo} />
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
