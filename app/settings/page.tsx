"use client"

import { DashboardHeader } from "@/components/DashboardHeader"
import { ThemeSwitcher } from "@/components/theme-switcher"
import { useT } from "@/lib/lang-store"

export default function SettingsPage() {
  const t = useT()

  return (
    <div className="min-h-screen">
      <DashboardHeader title={t.settingsTitle} subtitle={t.settingsSub} />
      <div className="p-6 space-y-6">
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm max-w-xl">
          <h3 className="text-sm font-semibold">{t.brandColors}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t.brandColorsSub}
          </p>
          <div className="mt-4">
            <ThemeSwitcher />
          </div>
        </div>
      </div>
    </div>
  )
}
