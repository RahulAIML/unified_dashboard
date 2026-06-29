/**
 * Second Brain API connectivity check.
 * Run with: SECOND_BRAIN_API_URL=<url> SECOND_BRAIN_API_TOKEN=<token> node scripts/sb-check.js
 */
const BASE  = process.env.SECOND_BRAIN_API_URL  || ''
const TOKEN = process.env.SECOND_BRAIN_API_TOKEN || ''
const EMAIL = process.env.SB_ADMIN_EMAIL         || ''

if (!BASE || !TOKEN) {
  console.error('Set SECOND_BRAIN_API_URL and SECOND_BRAIN_API_TOKEN env vars before running.')
  process.exit(1)
}

async function get(url) {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' },
      cache: 'no-store',
    })
    const text = await res.text()
    let json; try { json = JSON.parse(text) } catch { json = text }
    return { status: res.status, ok: res.ok, body: json }
  } catch (err) {
    return { error: err.message }
  }
}

;(async () => {
  console.log(`Checking Second Brain API at ${BASE}`)
  if (EMAIL) {
    console.log(`\nFull profile for ${EMAIL}:`)
    console.log(await get(`${BASE}/organizations/full-profile?admin_email=${encodeURIComponent(EMAIL)}`))
  }
  console.log('\nHealth:')
  console.log(await get(`${BASE}/health`).catch(() => ({ error: 'no /health endpoint' })))
})()
