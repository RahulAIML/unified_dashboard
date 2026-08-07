import { NextRequest } from "next/server"
import { getAIResponse } from "@/lib/ai"
import { buildApiError, buildSuccess } from "@/lib/api-utils"
import { getAuthContextFromRequest } from "@/lib/server-auth"

export async function POST(req: NextRequest) {
  const auth = await getAuthContextFromRequest(req)
  if (!auth) return buildApiError("Unauthorized", 401)

  try {
    const body = await req.json()
    const { prompt, context, lang, currentPage, userRole } = body as {
      prompt?: string
      context?: string
      lang?: string
      currentPage?: string
      userRole?: string
    }

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return buildApiError("Missing prompt", 400, { hasPrompt: Boolean(prompt) })
    }

    const answer = await getAIResponse(
      prompt.trim(),
      context ?? "No dashboard context provided.",
      lang === "en" ? "en" : "es",
      { currentPage, userRole: userRole === "admin" ? "admin" : "user" }
    )

    return buildSuccess(
      { answer },
      {
        promptLength: prompt.trim().length,
        hasContext: Boolean(context && String(context).trim()),
      }
    )
  } catch (err) {
    console.error("[/api/ai]", err)
    // Surface the real cause (never a secret -- it's either our own
    // "GEMINI_API_KEY is not set" message or Gemini's own error body
    // describing why the call failed) instead of a generic message that
    // makes "not configured" indistinguishable from "upstream is down"
    // without server log access.
    const message = err instanceof Error ? err.message : "Failed to get AI response"
    return buildApiError(message)
  }
}
