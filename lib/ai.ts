"use server"

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"

const SYSTEM_INSTRUCTION = `You are a professional business analytics assistant for a sales-training platform dashboard.

When answering:
- Always give a COMPLETE response — never stop mid-sentence
- Use bullet points (•) for lists
- Include exact numbers from the data when available
- Be concise but thorough
- End every response with a one-line "Summary:" statement
- Use plain text only — no markdown headers like ## or ###`

/** Expand short/vague queries into richer analytical prompts */
function expandQuery(question: string): string {
  const q = question.toLowerCase().trim()

  const expansions: [RegExp, string][] = [
    [
      /^(summary|overview|how are we doing|status)(\?)?$/,
      "Give a full performance summary including: total evaluations, average score, pass rate, score trend direction, and top insight. Be specific with numbers.",
    ],
    [
      /^(performance|perf)(\?)?$/,
      "Give a complete performance analysis including average score, pass rate, comparison to previous period, trend direction, and one key recommendation.",
    ],
    [
      /^(pass\s*rate|passing)(\?)?$/,
      "Explain the current pass rate in detail: the exact percentage, how it compares to the prior period, trend direction, and what it means for the team.",
    ],
    [
      /^(score|scores|avg|average)(\?)?$/,
      "Explain the average score in detail: the current value, prior period comparison, trend direction, and whether this is a concern or positive sign.",
    ],
    [
      /^(trend|trends)(\?)?$/,
      "Describe all available trends: evaluation count trend, score trend, and pass/fail trend over time. Specify direction (increasing/decreasing/stable).",
    ],
  ]

  for (const [pattern, expanded] of expansions) {
    if (pattern.test(q)) return expanded
  }

  return question // no expansion needed
}

/** Call Gemini once with the given payload */
async function callGemini(
  userContent: string,
  apiKey: string
): Promise<string> {
  const payload = {
    system_instruction: {
      parts: [{ text: SYSTEM_INSTRUCTION }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: userContent }],
      },
    ],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 1024,   // was 256 — that was cutting responses
      topP: 0.9,
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

  // Collect ALL parts across ALL candidates (guards against split responses)
  const text: string = (data?.candidates ?? [])
    .flatMap((c: { content?: { parts?: { text?: string }[] } }) =>
      (c?.content?.parts ?? []).map((p: { text?: string }) => p?.text ?? "")
    )
    .join("")
    .trim()

  return text
}

export async function getAIResponse(
  prompt: string,
  context: string
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set")
  }

  const expandedQuestion = expandQuery(prompt)

  const fullPrompt = `You are a business analytics assistant.

Based on the dashboard data below, give a COMPLETE and CLEAR response.

DASHBOARD DATA:
${context}

USER QUESTION:
${expandedQuestion}

INSTRUCTIONS:
• Give a full answer — do not stop midway
• Use bullet points starting with "•"
• Include exact numbers from the data
• Be concise but complete
• End with: Summary: [one sentence]`

  let answer = await callGemini(fullPrompt, apiKey)

  // Retry once if response is suspiciously short (< 80 chars)
  if (answer.length < 80) {
    console.warn("[ai] Response too short, retrying once...")
    answer = await callGemini(fullPrompt, apiKey)
  }

  if (!answer) {
    throw new Error("Empty response from Gemini after retry")
  }

  return answer
}
