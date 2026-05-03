/**
 * second-brain-api.ts - Second Brain API integration
 * 
 * STRICT SEPARATION:
 * - Second Brain data comes ONLY from API
 * - NEVER from database
 * - No usecase_id mixing
 */

const API_URL = process.env.SECOND_BRAIN_API_URL
const API_TOKEN = process.env.SECOND_BRAIN_API_TOKEN

interface SecondBrainMember {
  email: string
  name?: string
  is_active?: boolean
  last_login?: string
}

interface SecondBrainMessageLog {
  total?: number
  rag_queries?: number
  conversations?: number
}

interface SecondBrainStats {
  total_members?: number
  active_members?: number
  total_message_logs?: number
  knowledgebase_docs?: number
  datastore_docs?: number
  total_documents?: number
}

export interface SecondBrainProfile {
  organization_name: string
  admin_email: string
  members: SecondBrainMember[]
  message_logs: SecondBrainMessageLog
  stats: SecondBrainStats
}

interface RawSecondBrainResponse {
  organization_name?: string
  admin_email?: string
  members?: SecondBrainMember[]
  stats?: SecondBrainStats
  message_logs?: SecondBrainMessageLog
}

function requireConfig() {
  if (!API_URL) throw new Error('SECOND_BRAIN_API_URL is not set')
  if (!API_TOKEN) throw new Error('SECOND_BRAIN_API_TOKEN is not set')
  return { url: API_URL, token: API_TOKEN }
}

/**
 * Fetch Second Brain profile from API
 * This is the ONLY way to get Second Brain data - never from DB
 */
export async function fetchSecondBrainProfile(adminEmail: string): Promise<SecondBrainProfile | null> {
  const { url, token } = requireConfig()

  const queryUrl = `${url}/organizations/full-profile?admin_email=${encodeURIComponent(adminEmail)}`

  try {
    const res = await fetch(queryUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    })

    if (!res.ok) {
      if (res.status === 404) return null
      throw new Error(`Second Brain API HTTP ${res.status}`)
    }

    const json = (await res.json()) as RawSecondBrainResponse

    return {
      organization_name: json.organization_name || 'Unknown',
      admin_email: json.admin_email || adminEmail,
      members: Array.isArray(json.members) ? json.members : [],
      message_logs: json.message_logs || {},
      stats: json.stats || {},
    }
  } catch (err) {
    console.error('Second Brain API error:', err)
    return null
  }
}

/**
 * Compute Second Brain KPIs from API data
 * ONLY for Second Brain module - never mix with DB data
 */
export function computeSecondBrainKpis(profile: SecondBrainProfile) {
  const stats = profile.stats ?? {}
  const messageLogs = profile.message_logs ?? {}
  const members = Array.isArray(profile.members) ? profile.members : []

  const totalMembers = Number(stats.total_members ?? members.length ?? 0)
  const activeMembers = Number(
    stats.active_members ?? members.filter((m) => m?.is_active).length ?? 0
  )

  const totalConversations = Number(
    messageLogs.total ?? stats.total_message_logs ?? 0
  )

  const queriesCount = Number(messageLogs.rag_queries ?? 0)

  const kbDocsUsed = Number(
    (stats.knowledgebase_docs ?? 0) + (stats.datastore_docs ?? 0) || stats.total_documents || 0
  )

  const engagementRate = totalMembers > 0
    ? Math.round((activeMembers / totalMembers) * 1000) / 10
    : 0

  return {
    totalConversations,
    totalMembers,
    activeMembers,
    queriesCount,
    kbDocsUsed,
    engagementRate,
    hasData: totalConversations > 0 || totalMembers > 0,
  }
}

/**
 * Format Second Brain data for dashboard display
 */
export function formatSecondBrainData(profile: SecondBrainProfile) {
  const kpis = computeSecondBrainKpis(profile)

  return {
    type: 'second-brain' as const,
    source: 'api' as const,
    organization: profile.organization_name,
    kpis,
    members: profile.members.slice(0, 10), // Top 10 for display
    lastUpdated: new Date().toISOString(),
  }
}
