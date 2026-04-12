"use server"

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"

export async function getAIResponse(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set")
  }

  const payload = {
    system_instruction: {
      parts: [
        {
          text: "You are an analytics assistant for a business dashboard. Be concise, practical, and data-driven.",
        },
      ],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 256,
    },
  }

  const res = await fetch(GEMINI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => "")
    throw new Error(`Gemini API error ${res.status}: ${errText}`)
  }

  const data = await res.json()
  const text = data?.candidates?.[0]?.content?.parts
    ?.map((p: { text?: string }) => p.text ?? "")
    .join("")
    .trim()

  if (!text) {
    throw new Error("Empty response from Gemini")
  }

  return text
}
