"use server"

/**
 * The "Robin AI" dashboard assistant (components/ai-assistant.tsx -> /api/ai).
 *
 * Retrofitted onto docs/AI_ASSISTANT_HARNESS_STANDARD.md's two mandatory
 * capabilities (analytical + navigational) -- this file previously ran a
 * SYSTEM_INSTRUCTION for a "TCF French learning assistant" (a leftover from
 * an unrelated prototype) against real Rolplay dashboard data, which is
 * exactly the "shallow, fact-level answers... cannot help a user navigate
 * the product" gap the standard was written to close. There was no French
 * feature anywhere in this app for that prompt to have ever been correct.
 *
 * Root cause, not just symptom: the model was never told what product it
 * was embedded in, so it had no way to ground a "where do I export this"
 * question in a real click path, or an "is this good" question in a real
 * benchmark -- it could only pattern-match on the raw numbers dashboard.tsx
 * happened to paste into the prompt. Fixed by giving it what the harness
 * calls AssistantContext: a real glossary, a real navigation map, and a
 * hard split between "interpret" and "guide" prompting so one doesn't leak
 * into the other.
 */

// Robin is a fast, low-latency assistant (thinkingBudget: 0 below) -- the
// model is env-configurable (mirroring ai-service/app/config.py's LLM_MODEL
// for the Dashboard Builder, which was already configurable) rather than
// hardcoded, so the flash-tier model in use can be swapped without a code
// change/redeploy. ROBIN_AI_MODEL unset keeps today's exact behavior.
const GEMINI_MODEL = process.env.ROBIN_AI_MODEL || "gemini-2.5-flash"
const GEMINI_API_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

// ── Product knowledge (harness.py's AssistantContext.product_glossary) ──────
//
// Real Rolplay terms this session verified against actual code/data, not
// guessed: COACH/SIM/SEGMENT are r_simulator.category values (lib/bridge-
// rolplay-app.ts's SOLUTION_TO_CATEGORY); PASS_THRESHOLD/MASTERY_THRESHOLD
// are the same constants the dashboards themselves compute pass rate and
// the Cesar KPI framework's mastery bar from.
const PRODUCT_GLOSSARY: Record<string, string> = {
  "Master Coach / Coach Maestro": "AI role-play coaching sessions (category COACH). Practice-oriented, ungraded pass/fail is informational, not certifying.",
  "Simulator / Simulador": "Structured practice scenarios (category SIM). The bulk of session volume for most clients.",
  "Certifier Coach / Coach Certificador": "Formal certification attempts (category SEGMENT). This is the module a certification pass rate refers to.",
  "Second Brain": "A separate WhatsApp-based AI coaching follow-up product with its own API and data source -- never blended with Master Coach/Simulator/Certifier numbers, since it measures a different thing (ongoing field coaching, not a scored session).",
  "Pass Rate": "% of sessions scoring at or above this client's pass threshold. The threshold is configurable per client (70 unless the client has explicitly set a different one, e.g. 80) and shown as a legend right on the Pass Rate tile -- never assume it's the same number for every client. Some clients have no score-based passing criteria at all (certified by completion instead), in which case the tile doesn't appear.",
  "MAU (Monthly Active Users)": "Users with at least one session in the real last 30 days, independent of whatever wider date range the dashboard filter currently shows.",
  "Activation Rate": "% of enrolled users who have started at least one session (not necessarily completed or passed one).",
  "Mastery / Mastery threshold": "A score of 95 or above -- the Cesar KPI framework's bar for 'certified/mastered', distinct from a client's own pass threshold.",
  "KPIs page": "The Cesar KPI framework (activation, weekly practice frequency, MAU, mastery distribution, commercial-domain breakdown) -- only populated for rolplay_app_sql clients; every other connector shows it empty by design, not by bug. Practices to Mastery and Trial-and-Error Index were removed from this framework's scope and no longer exist as KPIs.",
  "Journey": "The cross-module progression view (LMS -> Master Coach/Simulator -> Certifier Coach -> Second Brain). Only appears in navigation when a tenant has 2+ of those modules -- a single module has nothing to sequence.",
  "Business Segments": "Pharma-tenant-only breakdown by business line/segment. Not available for rolplay_app_sql or banco tenants.",
  "Confidential label": "An optional tag an admin can set when generating/publishing a dashboard, shown on the published /d/[slug] view for links shared before a client's own login is set up.",
}

// ── Navigation map (harness.py's AssistantContext.navigation_map) ──────────
const NAVIGATION_MAP: Record<string, string> = {
  "Overview / Resumen": "Left sidebar -> Overview (first item). The default landing page after login -- KPI tiles, score trend, activity trend, use-case breakdown, best performers.",
  "Journey": "Left sidebar -> Journey (only visible if your organization has 2+ modules).",
  "LMS": "Left sidebar -> LMS (only visible if your organization has a LearnWorlds integration configured).",
  "Master Coach": "Left sidebar -> Coach Maestro.",
  "Simulator": "Left sidebar -> Simulador.",
  "Certifier Coach": "Left sidebar -> Coach Certificador.",
  "Second Brain": "Left sidebar -> Second Brain (only visible if your organization has its own Second Brain integration).",
  "Ranking / Leaderboard": "Left sidebar -> Ranking. Shows the top 20 performers; the Overview page's own leaderboard card shows the top 10 as a preview.",
  "Activities": "Left sidebar -> Activities. Per-activity/use-case breakdown.",
  "KPIs": "Left sidebar -> KPIs (rolplay_app_sql clients only).",
  "Reports / exporting a CSV": "Left sidebar -> Reports for the full searchable/paginated table, OR click Export in the top-right corner of any table widget on another page -- both download a CSV of exactly what's currently filtered on screen.",
  "Settings / branding": "Left sidebar -> Settings (bottom, above sign out). Platform name, logo, and color theme -- changes save on 'Guardar Cambios'/'Save Changes', not automatically.",
  "Language toggle": "The EN/ES button in the top-right of every dashboard page's header.",
  "Dark mode": "The sun/moon toggle near the bottom of the left sidebar. Light mode is the default on first visit; your choice is remembered after that.",
  "Dashboard Builder": "Left sidebar, admin accounts only -- generates a new AI-driven dashboard for a company by name.",
  "User Management": "Left sidebar, admin accounts only -- promote or demote another account's role.",
}

const ANALYTICAL_TRIGGERS = [
  "why", "trend", "is that normal", "is this normal", "should we", "should i",
  "what does this mean", "is that good", "is this good", "compared to",
  "improve", "improving", "drop", "dropped", "increase", "decrease",
  "how much", "what changed", "when did", "trending", "worse", "better",
]

const NAVIGATIONAL_TRIGGERS = [
  "where is", "where can i", "how do i", "how do you", "how to",
  "what is", "what's a", "what does", "what are", "find", "export", "download",
]

function detectIntent(question: string): "analytical" | "navigational" | "ambiguous" {
  const q = question.toLowerCase()
  const isAnalytical = ANALYTICAL_TRIGGERS.some(t => q.includes(t))
  const isNavigational = NAVIGATIONAL_TRIGGERS.some(t => q.includes(t))
  if (isAnalytical && !isNavigational) return "analytical"
  if (isNavigational && !isAnalytical) return "navigational"
  return "ambiguous"
}

type AssistantLang = "en" | "es"

const LANG_NAME: Record<AssistantLang, string> = { en: "English", es: "Spanish" }

function languageDirective(lang: AssistantLang): string {
  return `LANGUAGE: Respond entirely in ${LANG_NAME[lang]}, regardless of what language the question itself is written in. Never mix languages in one reply.`
}

const SPECIFICITY_RULE =
  "Never give a generic, one-size-fits-all answer. Every reply must be grounded in the specific numbers, dates, and comparisons given below (or, for a navigational question, the specific click path from the map below) -- if you can't point to a specific figure or step, say plainly that you don't have it rather than filling the gap with a vague generality."

function analyticalSystem(lang: AssistantLang): string {
  return `You are Robin, the analytics coach for Rolplay's sales-enablement dashboards.
Your role is to INTERPRET data, not restate it.

${languageDirective(lang)}

HARD RULES:
1. Never restate a number without adding interpretation ("pass rate is 65%" is not an answer by itself).
2. Cite figures precisely, including the comparison: "improved from 55% to 65% (+18%)", not "went up".
3. Reference the prior-period comparison or trend direction already given in the dashboard data below whenever it's relevant to the question.
4. If the data doesn't support a clear read, say so plainly rather than speculating: "There isn't enough data yet to call this a trend."
5. When something looks concerning, say what and suggest a concrete next step -- do not just describe the number.
6. Use the glossary below to explain what a metric measures if the question implies the user isn't sure.
7. ${SPECIFICITY_RULE}

Rolplay glossary:
${JSON.stringify(PRODUCT_GLOSSARY, null, 2)}`
}

interface UserContext {
  currentPage?: string
  userRole?: "admin" | "user"
}

function navigationalSystem(lang: AssistantLang, user: UserContext): string {
  return `You are Robin, the product guide for the Rolplay analytics dashboard.
Your role is to help users find features and understand what things mean -- not to interpret their data.

${languageDirective(lang)}

The person asking is currently on: ${user.currentPage ?? "an unknown page"}. Their account role is: ${user.userRole ?? "user"}.

HARD RULES:
1. Always give a click-by-click path using the navigation map below, never just "it's in the X page". Where it's natural, phrase the path relative to where they are right now (e.g. "From here, click...") rather than always starting from scratch.
2. Disambiguate Rolplay-specific terms using the glossary below rather than guessing.
3. If a feature depends on a capability the user's organization may not have (e.g. LMS, Second Brain), say so. If a feature is admin-only (per the navigation map) and this person's role is "user", tell them plainly they don't have access to it rather than describing the click path as if they could reach it.
4. If you're genuinely not sure of the exact path, say that plainly rather than inventing one.
5. ${SPECIFICITY_RULE}

Navigation map:
${JSON.stringify(NAVIGATION_MAP, null, 2)}

Rolplay glossary:
${JSON.stringify(PRODUCT_GLOSSARY, null, 2)}`
}

// ── Context-size guard (token overflow on large date ranges) ────────────────
//
// A long date range on a high-volume tenant (e.g. ~40k users) can grow the
// context this assistant hands to the model well beyond what it can
// reliably reason over in one pass. Two independent checks, both funneling
// into the same outcome -- tell the user to narrow the range -- because the
// alternative (the model quietly answering from a truncated/partial view of
// the period) produces a number the user trusts but that was never computed
// over the range they asked about.
//
//   1. Proactive: refuse before calling the model if our own payload is
//      already past a conservative budget. Fails fast -- no wasted
//      latency/cost on a call that was always going to be unreliable.
//   2. Reactive: Gemini itself reports the condition (its own docs: an
//      oversized request is rejected with a 400 citing the token count) --
//      caught here and translated into the same guidance rather than surfaced
//      as a generic "Gemini API error 400" message.
//
// ~4 chars/token is a standard rough estimate for English/Spanish prose;
// 100k tokens is comfortably below Gemini's window but far above anything
// this Q&A widget should legitimately need -- past this point the range
// itself is the problem, not the size of a normal answer.
const MAX_INPUT_CHARS = 400_000

class ContextOverflowError extends Error {}

function looksLikeContextOverflow(message: string): boolean {
  const m = message.toLowerCase()
  if (m.includes("context_length_exceeded") || m.includes("context length")) return true
  if (m.includes("payload") && m.includes("too large")) return true
  if (!m.includes("token")) return false
  return m.includes("exceed") || m.includes("too long") || m.includes("too large") || m.includes("maximum number of tokens")
}

interface GeminiResult {
  text: string
  /** true when the model itself signalled it couldn't finish within budget -- never treat as a complete answer. */
  truncated: boolean
}

/** Call Gemini once with the given system + user content. */
async function callGemini(system: string, userContent: string, apiKey: string): Promise<GeminiResult> {
  if (system.length + userContent.length > MAX_INPUT_CHARS) {
    throw new ContextOverflowError("Assembled prompt exceeds the safe input budget")
  }

  const payload = {
    system_instruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: userContent }] }],
    generationConfig: {
      temperature: 0.3,
      // gemini-2.5-flash "thinks" before answering by default, and that
      // reasoning silently eats into maxOutputTokens -- a 1024 budget was
      // getting consumed almost entirely by thinking, cutting the visible
      // answer off after a couple of sentences. thinkingBudget: 0 turns
      // that off (this assistant doesn't need multi-step reasoning), and
      // the higher cap gives the actual answer room to finish.
      maxOutputTokens: 2048,
      topP: 0.9,
      thinkingConfig: { thinkingBudget: 0 },
    },
  }

  const res = await fetch(GEMINI_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => "")
    if (res.status === 400 && looksLikeContextOverflow(errText)) {
      throw new ContextOverflowError(errText)
    }
    throw new Error(`Gemini API error ${res.status}: ${errText}`)
  }

  const data = await res.json()
  const candidate = (data?.candidates ?? [])[0]
  const text: string = (data?.candidates ?? [])
    .flatMap((c: { content?: { parts?: { text?: string }[] } }) =>
      (c?.content?.parts ?? []).map((p: { text?: string }) => p?.text ?? "")
    )
    .join("")
    .trim()

  // finishReason "MAX_TOKENS" means the model ran out of output budget while
  // working through the input -- the same "answered on a partial view"
  // failure mode as an input-side overflow, just discovered on the way out
  // instead of the way in. Never present that truncated text as a complete
  // answer.
  const truncated = candidate?.finishReason === "MAX_TOKENS"

  return { text, truncated }
}

/**
 * Confidence gate: an analytical question with no real dashboard numbers to
 * ground it, or ANY question with no context at all, isn't answerable
 * without guessing. Mirrors harness.py's ConfidenceAssessor -- decline
 * rather than let the model pad the gap with plausible-sounding filler.
 */
function hasGroundedContext(context: string): boolean {
  const c = context.trim().toLowerCase()
  if (!c) return false
  if (c.includes("temporarily unavailable")) return false
  return true
}

const INSUFFICIENT_CONTEXT_MESSAGE: Record<AssistantLang, string> = {
  en: "I don't have enough dashboard data loaded right now to answer that accurately. Try refreshing the page, or ask a more specific question once the data has loaded.",
  es: "No tengo suficientes datos del panel cargados en este momento para responder con precisión. Intenta actualizar la página o hacer una pregunta más específica una vez que los datos se hayan cargado.",
}

const RANGE_TOO_LARGE_MESSAGE: Record<AssistantLang, string> = {
  en: "This date range has too much data for me to analyze reliably in one pass, so I won't guess from a partial view. Please narrow the date range and ask again.",
  es: "Este rango de fechas tiene demasiados datos para analizarlos de forma confiable de una sola vez, así que no voy a adivinar con una vista parcial. Por favor, reduce el rango de fechas y vuelve a preguntar.",
}

export async function getAIResponse(
  prompt: string,
  context: string,
  lang: AssistantLang = "es",
  user: UserContext = {}
): Promise<string> {
  const question = prompt.trim()
  const intent = detectIntent(question)

  if (intent !== "navigational" && !hasGroundedContext(context)) {
    return INSUFFICIENT_CONTEXT_MESSAGE[lang]
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set")
  }

  const system = intent === "navigational" ? navigationalSystem(lang, user) : analyticalSystem(lang)
  const userContent =
    intent === "navigational"
      ? `Question: ${question}\n\nAnswer with a specific click-by-click path and, if relevant, what the feature is for. If it depends on a capability the user's organization might not have, say so.`
      : `Current dashboard data:\n${context}\n\nQuestion: ${question}\n\nAnalyze this data -- do not just restate it. Cite the real numbers, reference the trend/comparison already given if relevant, and suggest a next step if something looks off.`

  let result: GeminiResult
  try {
    result = await callGemini(system, userContent, apiKey)

    // Retry once if response is suspiciously short (< 80 chars) -- catches
    // truncated/empty-ish responses regardless of which prompt was used.
    if (!result.truncated && result.text.length < 80) {
      result = await callGemini(system, userContent, apiKey)
    }
  } catch (err) {
    if (err instanceof ContextOverflowError) return RANGE_TOO_LARGE_MESSAGE[lang]
    throw err
  }

  // A truncated response is, by definition, an answer computed from only
  // part of what the model was asked to consider -- surfacing it as if it
  // were complete is exactly the "silent partial answer" this guard exists
  // to prevent, so it's never returned even if non-empty.
  if (result.truncated) {
    return RANGE_TOO_LARGE_MESSAGE[lang]
  }

  if (!result.text) {
    throw new Error("Empty response from Gemini after retry")
  }

  return result.text
}
