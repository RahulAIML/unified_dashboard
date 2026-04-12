"use client"

import { useMemo, useRef, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Bot, Send, X } from "lucide-react"
import { useDashboardStore } from "@/lib/store"
import { buildApiUrl } from "@/lib/hooks/useApi"
import type { OverviewApiResponse, TrendsApiResponse } from "@/lib/types"
import { cn } from "@/lib/utils"

interface Message {
  role: "user" | "assistant"
  content: string
}

function parseInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  const regex = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index))
    }
    const token = match[0]
    if (token.startsWith("**")) {
      nodes.push(<strong key={`${match.index}-b`}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith("`")) {
      nodes.push(
        <code
          key={`${match.index}-c`}
          className="rounded bg-muted px-1.5 py-0.5 text-[12px]"
        >
          {token.slice(1, -1)}
        </code>
      )
    } else if (token.startsWith("*")) {
      nodes.push(<em key={`${match.index}-i`}>{token.slice(1, -1)}</em>)
    }
    lastIndex = match.index + token.length
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex))
  }

  return nodes
}

function renderMarkdown(content: string): React.ReactNode[] {
  const lines = content.split(/\r?\n/)
  const blocks: React.ReactNode[] = []
  let listItems: string[] = []

  const flushList = () => {
    if (listItems.length === 0) return
    blocks.push(
      <ul key={`list-${blocks.length}`} className="ml-4 list-disc space-y-1">
        {listItems.map((item, i) => (
          <li key={`li-${blocks.length}-${i}`}>{parseInline(item)}</li>
        ))}
      </ul>
    )
    listItems = []
  }

  lines.forEach((line, idx) => {
    const trimmed = line.trim()
    const listMatch = /^[-*•]\s+(.+)$/.exec(trimmed)
    if (listMatch) {
      listItems.push(listMatch[1])
      return
    }

    flushList()

    if (trimmed.length === 0) {
      blocks.push(<div key={`sp-${idx}`} className="h-2" />)
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

function summarizeTrend(trend?: { value: number }[]): string {
  if (!trend || trend.length < 2) return "trend data is limited"
  const first = trend[0].value
  const last = trend[trend.length - 1].value
  if (last > first) return "trend is increasing"
  if (last < first) return "trend is decreasing"
  return "trend is flat"
}

export function AIAssistant() {
  const { dateRange } = useDashboardStore()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "Hi! Ask me about performance, pass rate, or a quick summary.",
    },
  ])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const dateLabel = useMemo(() => {
    const days = Math.round(
      (dateRange.to.getTime() - dateRange.from.getTime()) / 86_400_000
    )
    return `${days} days`
  }, [dateRange])

  async function fetchContext(): Promise<string> {
    const overviewUrl = buildApiUrl(
      "/api/dashboard/overview",
      dateRange.from,
      dateRange.to
    )
    const trendsUrl = buildApiUrl(
      "/api/dashboard/trends",
      dateRange.from,
      dateRange.to
    )

    try {
      const [overviewRes, trendsRes] = await Promise.all([
        fetch(overviewUrl),
        fetch(trendsUrl),
      ])

      const overviewJson = await overviewRes.json()
      const trendsJson = await trendsRes.json()

      if (!overviewRes.ok || !trendsRes.ok) {
        throw new Error("dashboard data unavailable")
      }

      const overview = overviewJson as OverviewApiResponse
      const trends = trendsJson as TrendsApiResponse
      const trendSummary = summarizeTrend(trends?.evalCountTrend)

      return `Average score is ${overview.avgScore ?? "N/A"}, pass rate is ${overview.passRate ?? "N/A"}%, total evaluations ${overview.totalEvaluations ?? "N/A"}, ${trendSummary}. Time range: ${dateLabel}.`
    } catch {
      return "Dashboard data is currently unavailable. Provide a general summary without specific metrics."
    }
  }

  async function handleSend() {
    const question = input.trim()
    if (!question || loading) return

    setMessages((prev) => [...prev, { role: "user", content: question }])
    setInput("")
    setLoading(true)
    setError(null)

    const context = await fetchContext()
    const prompt = `You are an analytics assistant. Based on this data:\n${context}\n\nAnswer this question:\n${question}`

    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      })

      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? "AI error")

      setMessages((prev) => [...prev, { role: "assistant", content: json.answer }])
    } catch (err) {
      const fallback =
        "I couldn't reach the AI service. Based on the dashboard, the key metrics look stable; check the KPIs and trends for details."
      setMessages((prev) => [...prev, { role: "assistant", content: fallback }])
      setError("AI is temporarily unavailable.")
    } finally {
      setLoading(false)
      setTimeout(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight
        }
      }, 0)
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-lg hover:shadow-xl transition-shadow"
        aria-label="Open AI assistant"
      >
        <Bot className="h-4 w-4" />
        Ask AI
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className="fixed bottom-6 right-6 z-50 w-[360px] max-w-[90vw] rounded-2xl border border-border bg-card shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Bot className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold">AI Assistant</p>
                  <p className="text-xs text-muted-foreground">Dashboard insights</p>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded-full p-1 text-muted-foreground hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div
              ref={scrollRef}
              className="max-h-[360px] overflow-y-auto px-4 py-3 space-y-3"
            >
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={cn(
                    "rounded-xl px-3 py-2 text-sm",
                    m.role === "user"
                      ? "bg-primary/10 text-foreground"
                      : "bg-muted text-foreground"
                  )}
                >
                  <div className="space-y-2">{renderMarkdown(m.content)}</div>
                </div>
              ))}
              {loading && (
                <div className="rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
                  Thinking...
                </div>
              )}
              {error && (
                <div className="text-xs text-rose-500">{error}</div>
              )}
            </div>

            <div className="border-t border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSend()
                  }}
                  placeholder="Ask about KPIs, pass rate, trends..."
                  className="h-10 flex-1 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <button
                  onClick={handleSend}
                  disabled={loading || !input.trim()}
                  className="h-10 w-10 rounded-lg bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-50"
                  aria-label="Send"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

