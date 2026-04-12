import { NextRequest, NextResponse } from "next/server"
import { getAIResponse } from "@/lib/ai"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const prompt = String(body?.prompt ?? "").trim()

    if (!prompt) {
      return NextResponse.json({ error: "Missing prompt" }, { status: 400 })
    }

    const answer = await getAIResponse(prompt)
    return NextResponse.json({ answer })
  } catch (err) {
    console.error("[/api/ai]", err)
    return NextResponse.json(
      { error: "AI service is temporarily unavailable." },
      { status: 500 }
    )
  }
}
