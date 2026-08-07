/**
 * Validates lib/ai.ts's retrofit onto docs/AI_ASSISTANT_HARNESS_STANDARD.md's
 * two mandatory capabilities. Encodes the standard's own "Validation
 * Checklist" as tests rather than a one-time manual check, since this file
 * previously had zero test coverage at all -- which is exactly how a
 * "TCF French learning assistant" system prompt survived unnoticed in a
 * sales-enablement dashboard.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const fetchSpy = vi.fn()

async function fresh() {
  vi.resetModules()
  process.env.GEMINI_API_KEY = 'test-key'
  return import('../ai')
}

function geminiResponse(text: string) {
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text }] } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

/** A long-enough real answer so the < 80 char retry never fires unless a test wants it to. */
const PADDED_ANSWER = 'x'.repeat(120)

beforeEach(() => {
  fetchSpy.mockReset()
  fetchSpy.mockResolvedValue(geminiResponse(PADDED_ANSWER))
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.GEMINI_API_KEY
})

function lastRequestBody(): { system_instruction: { parts: { text: string }[] } } {
  const init = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1]?.[1] as { body?: string } | undefined
  return JSON.parse(init?.body ?? '{}')
}

describe('confidence gating (analytical questions)', () => {
  it('declines a trend/analytical question with no context, without calling the model', async () => {
    const { getAIResponse } = await fresh()
    const answer = await getAIResponse('Why did the pass rate drop?', '', 'en')

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(answer.toLowerCase()).toContain("don't have enough")
  })

  it('declines when context is the known "temporarily unavailable" fallback string', async () => {
    const { getAIResponse } = await fresh()
    const answer = await getAIResponse(
      'Is this trend normal?',
      'Time period: last 30 days\nDashboard data temporarily unavailable.',
      'en',
    )

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(answer.toLowerCase()).toContain("don't have enough")
  })

  it('proceeds to call the model when real context is present', async () => {
    const { getAIResponse } = await fresh()
    await getAIResponse('Why did the pass rate drop?', 'Pass rate: 65%\nPrior period pass rate: 78%')

    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})

describe('intent routing', () => {
  it('routes an analytical question to the analytics system prompt', async () => {
    const { getAIResponse } = await fresh()
    await getAIResponse('Why did the score trend drop this month?', 'Average score: 84 pts\nPrior period avg score: 90 pts')

    const body = lastRequestBody()
    const system = body.system_instruction.parts[0].text
    expect(system).toMatch(/INTERPRET data, not restate/i)
  })

  it('routes a navigational question to the navigation system prompt', async () => {
    const { getAIResponse } = await fresh()
    await getAIResponse('Where can I export this table?', '')

    const body = lastRequestBody()
    const system = body.system_instruction.parts[0].text
    expect(system).toMatch(/product guide/i)
  })

  it('answers a navigational question even with empty context (no grounding needed for "where is X")', async () => {
    const { getAIResponse } = await fresh()
    await getAIResponse('How do I export a report?', '')

    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})

describe('the standard\'s validation checklist, encoded', () => {
  it('the analytical prompt forbids bare restatement and requires citing the real comparison', async () => {
    const { getAIResponse } = await fresh()
    await getAIResponse('Is our pass rate good?', 'Pass rate: 65%\nPrior period pass rate: 60%')

    const system = lastRequestBody().system_instruction.parts[0].text
    expect(system).toMatch(/never restate/i)
    expect(system).toMatch(/cite figures precisely/i)
  })

  it('the navigational prompt requires a click-by-click path, not just "it exists"', async () => {
    const { getAIResponse } = await fresh()
    await getAIResponse('Where is the leaderboard?', '')

    const system = lastRequestBody().system_instruction.parts[0].text
    expect(system).toMatch(/click-by-click/i)
  })

  it('the navigational prompt contains real Rolplay terms (COACH/SIM/SEGMENT), not a foreign-language prompt', async () => {
    const { getAIResponse } = await fresh()
    await getAIResponse('What is the Master Coach module?', '')

    const system = lastRequestBody().system_instruction.parts[0].text
    expect(system).toMatch(/Master Coach/)
    expect(system).not.toMatch(/French/i)
    expect(system).not.toMatch(/TCF/)
  })

  it('never echoes the user\'s own question back as if it were the answer', async () => {
    // The old forceDirectAnswer() fallback returned `Here is the answer:\n\n${input}` --
    // i.e. the user's OWN question -- whenever the model's real answer happened to
    // contain a phrase like "great question". That entire code path is gone.
    const question = 'Why did the pass rate drop this month specifically'
    fetchSpy.mockResolvedValueOnce(geminiResponse(`That's a great question. ${PADDED_ANSWER}`))
    const { getAIResponse } = await fresh()
    const answer = await getAIResponse(question, 'Pass rate: 65%\nPrior period pass rate: 78%')

    expect(answer).not.toBe(`Here is the answer:\n\n${question}`)
  })
})

describe('language toggle (respond in the UI language, not whatever language the question used)', () => {
  it('defaults to Spanish when no lang is passed', async () => {
    const { getAIResponse } = await fresh()
    await getAIResponse('Why did the pass rate drop?', 'Pass rate: 65%\nPrior period pass rate: 78%')

    const system = lastRequestBody().system_instruction.parts[0].text
    expect(system).toMatch(/respond entirely in spanish/i)
  })

  it('forces English when lang="en", regardless of question language', async () => {
    const { getAIResponse } = await fresh()
    await getAIResponse('Por qué bajó la tasa de aprobación?', 'Pass rate: 65%\nPrior period pass rate: 78%', 'en')

    const system = lastRequestBody().system_instruction.parts[0].text
    expect(system).toMatch(/respond entirely in english/i)
  })

  it('forces Spanish for a navigational question when lang="es"', async () => {
    const { getAIResponse } = await fresh()
    await getAIResponse('Where can I export this table?', '', 'es')

    const system = lastRequestBody().system_instruction.parts[0].text
    expect(system).toMatch(/respond entirely in spanish/i)
  })

  it('the insufficient-context decline message itself is in the requested language', async () => {
    const { getAIResponse } = await fresh()
    const answer = await getAIResponse('Why did the pass rate drop?', '', 'en')

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(answer.toLowerCase()).toContain("don't have enough")
  })
})

describe('user context (contextualize navigation to where the person actually is and who they are)', () => {
  it('passes the current page into the navigational prompt', async () => {
    const { getAIResponse } = await fresh()
    await getAIResponse('Where can I export this table?', '', 'en', { currentPage: '/reports' })

    const system = lastRequestBody().system_instruction.parts[0].text
    expect(system).toContain('/reports')
  })

  it('tells the model the asking user\'s actual role, and instructs it to deny admin-only paths to a non-admin', async () => {
    const { getAIResponse } = await fresh()
    await getAIResponse('How do I open the Dashboard Builder?', '', 'en', { currentPage: '/', userRole: 'user' })

    const system = lastRequestBody().system_instruction.parts[0].text
    expect(system).toMatch(/role is: user/i)
    expect(system).toMatch(/don't have access/i)
  })

  it('tells the model when the asking user is an admin', async () => {
    const { getAIResponse } = await fresh()
    await getAIResponse('How do I open the Dashboard Builder?', '', 'en', { currentPage: '/', userRole: 'admin' })

    const system = lastRequestBody().system_instruction.parts[0].text
    expect(system).toMatch(/role is: admin/i)
  })
})

describe('resilience (unchanged behavior worth keeping)', () => {
  it('retries once on a suspiciously short response', async () => {
    fetchSpy
      .mockResolvedValueOnce(geminiResponse('short'))
      .mockResolvedValueOnce(geminiResponse(PADDED_ANSWER))
    const { getAIResponse } = await fresh()
    const answer = await getAIResponse('Why did the pass rate drop?', 'Pass rate: 65%')

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(answer).toBe(PADDED_ANSWER)
  })

  it('throws when GEMINI_API_KEY is not configured', async () => {
    vi.resetModules()
    delete process.env.GEMINI_API_KEY
    const { getAIResponse } = await import('../ai')

    await expect(getAIResponse('Why did the pass rate drop?', 'Pass rate: 65%')).rejects.toThrow(/GEMINI_API_KEY/)
  })
})
