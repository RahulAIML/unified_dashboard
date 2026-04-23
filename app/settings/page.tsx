"use client"

import { DashboardHeader } from "@/components/DashboardHeader"
import { useT } from "@/lib/lang-store"
import { useClientBrand } from "@/lib/hooks/useClientBrand"
import { useDashboardStore } from "@/lib/store"

export default function SettingsPage() {
  const t = useT()
  const brand = useClientBrand()
  const clientId = useDashboardStore((s) => s.clientId)

  return (
    <div className="min-h-screen">
      <DashboardHeader title={t.settingsTitle} subtitle={t.settingsSub} />
      <div className="p-6 space-y-6">
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm max-w-xl">
          <h3 className="text-sm font-semibold">{t.brandColors}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t.brandColorsSub}
          </p>

          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Active client</p>
                <p className="text-sm font-semibold">{clientId ?? "default"}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Brand</p>
                <p className="text-sm font-semibold">{brand.name}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="h-4 w-4 rounded-full bg-primary border border-border" />
                <span className="text-xs text-muted-foreground">Primary</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-4 w-4 rounded-full border border-border" style={{ background: "var(--brand-accent)" }} />
                <span className="text-xs text-muted-foreground">Accent</span>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Switch tenants by appending <code className="font-mono">?client=&lt;id&gt;</code> to the URL.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
