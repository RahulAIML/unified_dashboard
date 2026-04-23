import { NextRequest } from "next/server"
import { getAIResponse } from "@/lib/ai"
import { buildApiError, buildSuccess } from "@/lib/api-utils"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { prompt, context } = body as {
      prompt?: string
      context?: string
    }

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return buildApiError("Missing prompt", 400, { hasPrompt: Boolean(prompt) })
    }

    const answer = await getAIResponse(
      prompt.trim(),
      context ?? "No dashboard context provided."
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
    return buildApiError("Failed to get AI response")
  }
}
