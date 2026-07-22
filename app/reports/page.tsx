"use client"

import { FileText, Download, BarChart2, GitBranch, UserCog, TrendingUp } from "lucide-react"
import { DashboardHeader } from "@/components/DashboardHeader"
import { useT } from "@/lib/lang-store"
import { useCombinedExport } from "@/lib/hooks/useCombinedExport"

export default function ReportsPage() {
  const t = useT()
  const { exportAllSolutions, loading } = useCombinedExport()

  // Faithful to the reference dashboards: exportable data now, richer report
  // templates flagged as upcoming (honestly labelled, not fake links).
  const templates = [
    { icon: BarChart2, title: t.repTplExecutive, desc: t.repTplExecutiveSub },
    { icon: GitBranch, title: t.repTplByLine,    desc: t.repTplByLineSub },
    { icon: UserCog,   title: t.repTplByAdmin,   desc: t.repTplByAdminSub },
    { icon: TrendingUp,title: t.repTplProgress,  desc: t.repTplProgressSub },
  ]

  return (
    <div className="min-h-screen w-full">
      <DashboardHeader title={t.repTitle} subtitle={t.repSub} showModuleFilter={false} />

      <div className="w-full px-4 sm:px-6 lg:px-8 py-5 sm:py-8 space-y-8 max-w-[1200px] mx-auto">
        {/* Export data */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">{t.repExportData}</h2>
          <div className="rounded-[16px] border border-border/60 bg-card p-5 sm:p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">{t.repExportAllTitle}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t.repExportAllSub}</p>
            </div>
            <button
              onClick={() => exportAllSolutions()}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-primary text-primary-foreground hover:opacity-90 active:scale-[0.98] transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {loading
                ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                : <Download className="w-4 h-4" />}
              {t.repExportAllTitle}
            </button>
          </div>
        </section>

        {/* Report templates */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">{t.repTemplates}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {templates.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="rounded-[16px] border border-border/60 bg-card p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center shrink-0 text-muted-foreground">
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-foreground">{title}</p>
                    <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">{t.repComingSoon}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
