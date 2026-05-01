#!/usr/bin/env node

/**
 * Shared PHP bridge client for scripts/.
 *
 * - Loads `dashboard/.env.local` (if present) so scripts match the dashboard env.
 * - Uses `BRIDGE_URL` + `BRIDGE_SECRET`.
 * - Sends both `X-Bridge-Key` and `X-Bridge-Secret` headers for compatibility.
 */

const fs = require('fs')
const path = require('path')
const https = require('https')

function loadDashboardEnv() {
  const envPath = path.join(__dirname, '..', '.env.local')
  if (!fs.existsSync(envPath)) return

  const content = fs.readFileSync(envPath, 'utf-8')
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const idx = line.indexOf('=')
    if (idx <= 0) continue

    const key = line.slice(0, idx).trim()
    let value = line.slice(idx + 1).trim()
    if (!key) continue

    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1)
    }

    if (process.env[key] === undefined) process.env[key] = value
  }
}

function getBridgeConfig() {
  loadDashboardEnv()

  const bridgeUrl = process.env.BRIDGE_URL
  const bridgeSecret = process.env.BRIDGE_SECRET

  if (!bridgeUrl) throw new Error('Missing BRIDGE_URL (set env var or dashboard/.env.local)')
  if (!bridgeSecret) throw new Error('Missing BRIDGE_SECRET (set env var or dashboard/.env.local)')

  const url = new URL(bridgeUrl)
  if (url.protocol !== 'https:') {
    throw new Error(`BRIDGE_URL must be https. Got: ${bridgeUrl}`)
  }

  return { url, bridgeSecret }
}

function bridgeRequest(bodyObj) {
  const { url, bridgeSecret } = getBridgeConfig()
  const payload = JSON.stringify(bodyObj)

  const options = {
    hostname: url.hostname,
    path: url.pathname + url.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      'X-Bridge-Key': bridgeSecret,
      'X-Bridge-Secret': bridgeSecret,
    },
  }

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = ''

      res.on('data', (chunk) => {
        data += chunk
      })

      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch (e) {
          reject(new Error(`Failed to parse JSON response (${res.statusCode}): ${data}`))
        }
      })
    })

    req.on('error', (e) => reject(e))
    req.write(payload)
    req.end()
  })
}

module.exports = {
  getBridgeConfig,
  bridgeRequest,
}

