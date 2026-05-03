/**
 * test-db.js — standalone MySQL connectivity test
 * Usage: node test-db.js
 * Reads credentials from .env.local (or process env if already exported)
 */

;(async () => {
  const fs = await import("node:fs")
  const path = await import("node:path")
  const mysql = await import("mysql2/promise")

// ── Load .env.local manually (no dotenv dependency needed) ───────────────────
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return
  const lines = fs.readFileSync(filePath, 'utf8').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key   = trimmed.slice(0, eqIdx).trim()
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '')
    if (!(key in process.env)) process.env[key] = value   // don't overwrite real env
  }
}

loadEnvFile(path.join(__dirname, '.env.local'))
loadEnvFile(path.join(__dirname, '.env'))

// ── Validate required variables ──────────────────────────────────────────────
const required = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']
const missing  = required.filter(k => !process.env[k])
if (missing.length) {
  console.error(`❌ Missing environment variables: ${missing.join(', ')}`)
  console.error('   Add them to .env.local or export them before running.')
  process.exit(1)
}

const config = {
  host           : process.env.DB_HOST,
  user           : process.env.DB_USER,
  password       : process.env.DB_PASSWORD,
  database       : process.env.DB_NAME,
  connectTimeout : 10000,   // 10 s — fail fast on firewall / timeout
  ssl            : process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  // port is intentionally omitted unless explicitly set via DB_PORT env var
  ...(process.env.DB_PORT ? { port: parseInt(process.env.DB_PORT, 10) } : {}),
}

const portLabel = process.env.DB_PORT ? `:${process.env.DB_PORT}` : ' (default)'

console.log('\n🔌 Connecting to MySQL...')
console.log(`   Host   : ${config.host}${portLabel}`)
console.log(`   User   : ${config.user}`)
console.log(`   DB     : ${config.database}`)
console.log()

// ── Run test ─────────────────────────────────────────────────────────────────
async function testConnection() {
  let connection

  try {
    connection = await mysql.createConnection(config)

    // 1. Basic reachability
    const [[row]] = await connection.execute('SELECT NOW() AS time, VERSION() AS version')
    console.log('✅ Database connected successfully')
    console.log(`   Server time    : ${row.time}`)
    console.log(`   MySQL version  : ${row.version}`)

    // 2. Confirm target database is accessible
    const [[dbRow]] = await connection.execute('SELECT DATABASE() AS current_db')
    console.log(`   Active database: ${dbRow.current_db}`)

    // 3. Quick table count — useful sanity check
    const [tables] = await connection.execute(
      `SELECT COUNT(*) AS table_count
       FROM information_schema.tables
       WHERE table_schema = ?`, [config.database]
    )
    console.log(`   Tables found   : ${tables[0].table_count}`)
    console.log()

  } catch (err) {
    console.error('❌ Connection failed:', err.message)
    console.error()

    // ── Actionable error hints ──────────────────────────────────────────────
    if (err.code === 'ETIMEDOUT' || err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
      console.error('   ⚠  Possible cause: firewall or port blocking issue')
      console.error(`      • Confirm the MySQL port is open on ${config.host}`)
      console.error('      • Check your hosting panel (cPanel → Remote MySQL)')
      console.error('      • Your current IP may not be whitelisted')
    } else if (err.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error('   ⚠  Possible cause: invalid credentials')
      console.error('      • Double-check DB_USER and DB_PASSWORD in .env.local')
    } else if (err.code === 'ER_BAD_DB_ERROR') {
      console.error(`   ⚠  Database "${config.database}" does not exist`)
      console.error('      • Check DB_NAME in .env.local')
    } else if (err.code === 'PROTOCOL_CONNECTION_LOST') {
      console.error('   ⚠  Connection dropped — server may have closed it immediately')
    }

    console.error(`   Error code : ${err.code || 'N/A'}`)
    process.exit(1)

  } finally {
    if (connection) await connection.end()
  }
}

  await testConnection()
})().catch((err) => {
  console.error("âŒ Unexpected failure:", err?.message ?? err)
  process.exit(1)
})
