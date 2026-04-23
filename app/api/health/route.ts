import { buildApiError, buildSuccess } from "@/lib/api-utils"

export const dynamic = "force-dynamic"

const DEFAULT_TIMEOUT_MS = 8_000

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null
}

async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<{ ok: boolean; status: number; json: unknown | null; error?: string }> {
  const controller = new AbortController()
  const tid = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, cache: "no-store" })
    const json = await res.json().catch(() => null)
    return { ok: res.ok, status: res.status, json }
  } catch (err) {
    return { ok: false, status: 0, json: null, error: String((err as { message?: unknown })?.message ?? err) }
  } finally {
    clearTimeout(tid)
  }
}

export async function GET() {
  try {
    const bridgeUrl = process.env.BRIDGE_URL ?? null
    const bridgeSecret = process.env.BRIDGE_SECRET ?? null
    const useRealDb = process.env.USE_REAL_DB ?? "(not set — defaults true)"

    const config = {
      USE_REAL_DB: useRealDb,
      BRIDGE_URL: bridgeUrl ? bridgeUrl : "NOT SET",
      BRIDGE_SECRET: bridgeSecret ? "set (hidden)" : "NOT SET",
      DB_HOST: process.env.DB_HOST ? "set" : "(not set)",
      DB_USER: process.env.DB_USER ? "set" : "(not set)",
      DB_NAME: process.env.DB_NAME ? "set" : "(not set)",
    }

    if (!bridgeUrl) {
      return buildSuccess(
        {
          status: "no_bridge" as const,
          message: "BRIDGE_URL is not set — configure it in your environment variables",
          config,
          bridge_connectivity: null,
          data_sample: null,
        },
        { endpoint: "health" }
      )
    }

    const headers: Record<string, string> = {}
    if (bridgeSecret) headers["X-Bridge-Key"] = bridgeSecret

    const bridgeTest = await fetchJsonWithTimeout(`${bridgeUrl}?action=test`, {
      method: "GET",
      headers,
    })

    const bridgeOk =
      bridgeTest.ok &&
      isRecord(bridgeTest.json) &&
      bridgeTest.json["success"] === true

    let dataSample: unknown = null
    if (bridgeOk) {
      dataSample = await fetchJsonWithTimeout(`${bridgeUrl}?action=kpis`, {
        method: "GET",
        headers,
      })
    }

    return buildSuccess(
      {
        status: bridgeOk ? "ok" : "bridge_error",
        config,
        bridge_connectivity: bridgeTest,
        data_sample: bridgeOk ? dataSample : null,
      },
      { endpoint: "health" }
    )
  } catch (err) {
    console.error("[/api/health]", err)
    return buildApiError("Health check failed")
  }
}
