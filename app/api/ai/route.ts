import { NextRequest, NextResponse } from "next/server"
import { getAIResponse } from "@/lib/ai"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { prompt, context } = body as {
      prompt?: string
      context?: string
    }

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return NextResponse.json({ error: "Missing prompt" }, { status: 400 })
    }

    const answer = await getAIResponse(
      prompt.trim(),
      context ?? "No dashboard context provided."
    )

    return NextResponse.json({ answer })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    console.error("[/api/ai]", message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
