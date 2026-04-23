"use client"

import { useMemo, useRef, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Bot, Send, X, Loader2 } from "lucide-react"
import { useDashboardStore } from "@/lib/store"
import { buildApiUrl } from "@/lib/hooks/useApi"
import type { OverviewApiResponse, TrendsApiResponse } from "@/lib/types"
import { cn } from "@/lib/utils"

interface Message {
  role: "user" | "assistant"
  content: string
}

// ── Markdown renderer ────────────────────────────────────────────────────────

function parseInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  const regex = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index))
    const token = match[0]
    if (token.startsWith("**"))
      nodes.push(<strong key={`${match.index}-b`}>{token.slice(2, -2)}</strong>)
    else if (token.startsWith("`"))
      nodes.push(
        <code key={`${match.index}-c`} className="rounded bg-muted px-1.5 py-0.5 text-[12px]">
          {token.slice(1, -1)}
        </code>
      )
    else if (token.startsWith("*"))
      nodes.push(<em key={`${match.index}-i`}>{token.slice(1, -1)}</em>)
    lastIndex = match.index + token.length
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes
}

function renderMarkdown(content: string): React.ReactNode[] {
  const lines = content.split(/\r?\n/)
  const blocks: React.ReactNode[] = []
  let listItems: string[] = []

  const flushList = () => {
    if (listItems.length === 0) return
    blocks.push(
      <ul key={`list-${blocks.length}`} className="ml-2 space-y-1">
        {listItems.map((item, i) => (
          <li key={`li-${blocks.length}-${i}`} className="flex gap-1.5">
            <span className="mt-0.5 shrink-0 text-primary">•</span>
            <span>{parseInline(item)}</span>
          </li>
        ))}
      </ul>
    )
    listItems = []
  }

  lines.forEach((line, idx) => {
    const trimmed = line.trim()
    // Match bullet lines: -, *, •
    const listMatch = /^[-*•]\s+(.+)$/.exec(trimmed)
    if (listMatch) { listItems.push(listMatch[1]); return }

    flushList()

    if (trimmed.length === 0) {
      blocks.push(<div key={`sp-${idx}`} className="h-1.5" />)
      return
    }

    // Summary line — make it stand out
    if (/^summary:/i.test(trimmed)) {
      blocks.push(
        <p key={`sum-${idx}`} className="mt-2 border-t border-border pt-2 text-xs font-semibold text-muted-foreground">
          {parseInline(trimmed)}
        </p>
      )
      return
    }

    blocks.push(
      <p key={`p-${idx}`} className="leading-relaxed">
        {parseInline(trimmed)}
      </p>
    )
  })

  flushList()
  return blocks
}

// ── Context builder ──────────────────────────────────────────────────────────

function trendDirection(trend?: { value: number }[]): string {
  if (!trend || trend.length < 2) return "insufficient data"
  const first = trend[0].value
  const last  = trend[trend.length - 1].value
  const pct   = first > 0 ? Math.round(((last - first) / first) * 100) : 0
  if (last > first) return `increasing (+${pct}%)`
  if (last < first) return `decreasing (${pct}%)`
  return "stable (0%)"
}

// ── Component ────────────────────────────────────────────────────────────────

const QUICK_PROMPTS = ["Summary", "Pass rate", "Score trend", "Top insights"]

export function AIAssistant() {
  const { dateRange } = useDashboardStore()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "Hi! Ask me about performance, pass rate, score trends, or type \"summary\" for a full overview.",
    },
  ])
  const [input, setInput]   = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const dateLabel = useMemo(() => {
    const days = Math.round(
      (dateRange.to.getTime() - dateRange.from.getTime()) / 86_400_000
    )
    return `${days} days`
  }, [dateRange])

  // Build rich context string from live API data
  async function buildContext(): Promise<string> {
    const overviewUrl = buildApiUrl("/api/dashboard/overview", dateRange.from, dateRange.to)
    const trendsUrl   = buildApiUrl("/api/dashboard/trends",   dateRange.from, dateRange.to)

    try {
      const [ovRes, trRes] = await Promise.all([
        fetch(overviewUrl),
        fetch(trendsUrl),
      ])

      if (!ovRes.ok || !trRes.ok) throw new Error("API unavailable")

      const ov = (await ovRes.json()) as OverviewApiResponse
      const tr = (await trRes.json()) as TrendsApiResponse

      const lines = [
        `Time period: last ${dateLabel}`,
        `Total evaluations: ${ov.totalEvaluations ?? "N/A"}`,
        `Average score: ${ov.avgScore != null ? `${ov.avgScore} pts` : "N/A"}`,
        `Pass rate: ${ov.passRate != null ? `${ov.passRate}%` : "N/A"}`,
        `Passed evaluations: ${ov.passedEvaluations ?? "N/A"}`,
        `Prior period evaluations: ${ov.prevTotalEvaluations ?? "N/A"}`,
        `Prior period avg score: ${ov.prevAvgScore != null ? `${ov.prevAvgScore} pts` : "N/A"}`,
        `Prior period pass rate: ${ov.prevPassRate != null ? `${ov.prevPassRate}%` : "N/A"}`,
        `Score trend: ${trendDirection(tr?.scoreTrend)}`,
        `Evaluation count trend: ${trendDirection(tr?.evalCountTrend)}`,
      ]

      // Pass/fail summary
      if (tr?.passFailTrend?.length) {
        const totalPass = tr.passFailTrend.reduce((s, p) => s + (p.value  ?? 0), 0)
        const totalFail = tr.passFailTrend.reduce((s, p) => s + (p.value2 ?? 0), 0)
        lines.push(`Cumulative passed: ${totalPass}, failed: ${totalFail}`)
      }

      return lines.join("\n")
    } catch {
      return `Time period: last ${dateLabel}\nDashboard data temporarily unavailable.`
    }
  }

  async function handleSend(questionOverride?: string) {
    const question = (questionOverride ?? input).trim()
    if (!question || loading) return

    setMessages(prev => [...prev, { role: "user", content: question }])
    setInput("")
    setLoading(true)
    setError(null)

    try {
      const context = await buildContext()

      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: question, context }),
      })

      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? "AI error")

      setMessages(prev => [...prev, { role: "assistant", content: json.answer }])
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error"
      setError(`AI unavailable: ${msg}`)
      setMessages(prev => [
        ...prev,
        {
          role: "assistant",
          content:
            "I couldn't reach the AI service right now. Please check the KPI cards and charts directly for the latest metrics.",
        },
      ])
    } finally {
      setLoading(false)
      setTimeout(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight
        }
      }, 50)
    }
  }

  return (
    <>
      {/* Floating trigger button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-lg hover:shadow-xl transition-all hover:scale-105"
        aria-label="Open AI assistant"
      >
        <Bot className="h-4 w-4" />
        Ask AI
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ duration: 0.18 }}
            className="fixed bottom-6 right-6 z-50 flex w-[380px] max-w-[92vw] flex-col rounded-2xl border border-border bg-card shadow-2xl"
            style={{ maxHeight: "min(600px, 90vh)" }}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-4 py-3 shrink-0">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Bot className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold">AI Assistant</p>
                  <p className="text-xs text-muted-foreground">Last {dateLabel}</p>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Messages */}
            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
              style={{ minHeight: 0 }}
            >
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={cn(
                    "rounded-xl px-3 py-2.5 text-sm",
                    m.role === "user"
                      ? "ml-6 bg-primary/10 text-foreground"
                      : "mr-6 bg-muted text-foreground"
                  )}
                >
                  <div className="space-y-1.5">{renderMarkdown(m.content)}</div>
                </div>
              ))}

              {loading && (
                <div className="mr-6 flex items-center gap-2 rounded-xl bg-muted px-3 py-2.5 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                  <span>Analyzing dashboard data...</span>
                </div>
              )}

              {error && (
                <p className="text-center text-xs text-destructive">{error}</p>
              )}
            </div>

            {/* Quick prompts */}
            {messages.length <= 1 && !loading && (
              <div className="border-t border-border px-4 py-2 shrink-0">
                <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Quick questions
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_PROMPTS.map(q => (
                    <button
                      key={q}
                      onClick={() => handleSend(q)}
                      className="rounded-full border border-border bg-background px-3 py-1 text-xs text-foreground hover:bg-muted transition-colors"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Input */}
            <div className="border-t border-border px-4 py-3 shrink-0">
              <div className="flex items-center gap-2">
                <input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) handleSend() }}
                  placeholder="Ask about KPIs, pass rate, trends…"
                  disabled={loading}
                  className="h-10 flex-1 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
                />
                <button
                  onClick={() => handleSend()}
                  disabled={loading || !input.trim()}
                  className="h-10 w-10 shrink-0 rounded-lg bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 transition-opacity"
                  aria-label="Send"
                >
                  {loading
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Send className="h-4 w-4" />
                  }
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
