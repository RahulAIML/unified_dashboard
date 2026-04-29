#!/usr/bin/env node

/**
 * inspect-database.js
 *
 * Inspects the existing database structure via PHP Bridge
 * Shows all tables, columns, and identifies which multi-tenant columns are missing
 *
 * Usage:
 *   node scripts/inspect-database.js
 */

const https = require('https')

const BRIDGE_URL = 'https://rolplay.pro/src/rolplay-bridge.php'
const BRIDGE_SECRET = 'REDACTED_BRIDGE_SECRET'

function log(msg) {
  console.log(msg)
}

function makeRequest(sql) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      sql: sql,
      params: [],
    })

    const options = {
      hostname: 'rolplay.pro',
      path: '/src/rolplay-bridge.php',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'X-Bridge-Key': BRIDGE_SECRET,
      },
    }

    const req = https.request(options, (res) => {
      let data = ''

      res.on('data', (chunk) => {
        data += chunk
      })

      res.on('end', () => {
        try {
          const response = JSON.parse(data)
          resolve(response)
        } catch (e) {
          reject(new Error(`Failed to parse response: ${data}`))
        }
      })
    })

    req.on('error', (e) => {
      reject(e)
    })

    req.write(payload)
    req.end()
  })
}

async function inspectDatabase() {
  log('\n' + '='.repeat(80))
  log('DATABASE STRUCTURE INSPECTION')
  log('='.repeat(80))

  try {
    // Step 1: Get all tables
    log('\n📋 Fetching all tables...')
    const tablesResult = await makeRequest(`
      SELECT TABLE_NAME, TABLE_SCHEMA
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY TABLE_NAME
    `)

    if (!tablesResult.success) {
      log('❌ Failed to fetch tables')
      log('Error:', tablesResult.error || tablesResult.message)
      return
    }

    const tables = tablesResult.data || []
    log(`✅ Found ${tables.length} tables`)

    // Key analytics tables to check for multi-tenant columns
    const analyticsTables = [
      'coach_sessions',
      'simulator_scenarios',
      'lms_enrollments',
      'certification_attempts',
      'second_brain_queries',
    ]

    const userTables = ['users', 'user_sessions', 'clients']

    log('\n' + '─'.repeat(80))
    log('USER MANAGEMENT TABLES')
    log('─'.repeat(80))

    for (const tableName of userTables) {
      const tableExists = tables.some((t) => t.TABLE_NAME === tableName)

      if (!tableExists) {
        log(`\n❌ ${tableName.toUpperCase()} — NOT FOUND`)
        log('   Status: Needs to be created')
        continue
      }

      log(`\n✅ ${tableName.toUpperCase()} — EXISTS`)

      // Get columns
      const columnsResult = await makeRequest(`
        SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, EXTRA
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${tableName}'
        ORDER BY ORDINAL_POSITION
      `)

      if (columnsResult.success && columnsResult.data) {
        columnsResult.data.forEach((col) => {
          const nullable = col.IS_NULLABLE === 'YES' ? '(nullable)' : '(NOT NULL)'
          const key = col.COLUMN_KEY ? `[${col.COLUMN_KEY}]` : ''
          log(`   • ${col.COLUMN_NAME}: ${col.COLUMN_TYPE} ${nullable} ${key}`)
        })
      }
    }

    log('\n' + '─'.repeat(80))
    log('ANALYTICS TABLES (Need company_id column)')
    log('─'.repeat(80))

    for (const tableName of analyticsTables) {
      const tableExists = tables.some((t) => t.TABLE_NAME === tableName)

      if (!tableExists) {
        log(`\n⚠️  ${tableName.toUpperCase()} — NOT FOUND`)
        log('   Status: Table does not exist')
        continue
      }

      log(`\n✅ ${tableName.toUpperCase()} — EXISTS`)

      // Get columns
      const columnsResult = await makeRequest(`
        SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${tableName}'
        ORDER BY ORDINAL_POSITION
      `)

      if (columnsResult.success && columnsResult.data) {
        const columns = columnsResult.data
        const hasCompanyId = columns.some((c) => c.COLUMN_NAME === 'company_id')

        columnsResult.data.forEach((col) => {
          const nullable = col.IS_NULLABLE === 'YES' ? '(nullable)' : '(NOT NULL)'
          const key = col.COLUMN_KEY ? `[${col.COLUMN_KEY}]` : ''
          const mark = col.COLUMN_NAME === 'company_id' ? ' ✅' : ''
          log(`   • ${col.COLUMN_NAME}: ${col.COLUMN_TYPE} ${nullable} ${key}${mark}`)
        })

        if (!hasCompanyId) {
          log(`   ⚠️  MISSING: company_id column (required for multi-tenant support)`)
        }
      }
    }

    // Step 2: Check for missing multi-tenant columns
    log('\n' + '='.repeat(80))
    log('MULTI-TENANT READINESS REPORT')
    log('='.repeat(80))

    const requiredTables = {
      users: ['id', 'email', 'password_hash', 'company_id'],
      user_sessions: ['id', 'user_id', 'token_jti'],
      clients: ['id', 'name', 'domain'],
      coach_sessions: ['company_id'],
      simulator_scenarios: ['company_id'],
      lms_enrollments: ['company_id'],
      certification_attempts: ['company_id'],
      second_brain_queries: ['company_id'],
    }

    const missingItems = []

    for (const [tableName, requiredCols] of Object.entries(requiredTables)) {
      const tableExists = tables.some((t) => t.TABLE_NAME === tableName)

      if (!tableExists) {
        missingItems.push({
          table: tableName,
          issue: 'TABLE MISSING',
          required: requiredCols,
        })
        continue
      }

      // Get actual columns
      const columnsResult = await makeRequest(`
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${tableName}'
      `)

      if (columnsResult.success && columnsResult.data) {
        const actualCols = columnsResult.data.map((c) => c.COLUMN_NAME)

        requiredCols.forEach((col) => {
          if (!actualCols.includes(col)) {
            missingItems.push({
              table: tableName,
              issue: `COLUMN MISSING: ${col}`,
              required: col,
            })
          }
        })
      }
    }

    if (missingItems.length === 0) {
      log('✅ DATABASE IS READY FOR MULTI-TENANT SUPPORT')
      log('   • All required tables exist')
      log('   • All required columns exist')
      log('   • No migrations needed')
    } else {
      log(`❌ DATABASE NEEDS UPDATES (${missingItems.length} items missing)\n`)

      // Group by table
      const byTable = {}
      missingItems.forEach((item) => {
        if (!byTable[item.table]) byTable[item.table] = []
        byTable[item.table].push(item.issue)
      })

      Object.entries(byTable).forEach(([table, issues]) => {
        log(`  ${table}:`)
        issues.forEach((issue) => {
          log(`    • ${issue}`)
        })
      })

      log('\n📝 NEXT STEPS:')
      log('   1. Run: migrations/001_add_multi_tenant_support.sql')
      log('   2. This will create missing tables and add missing columns')
      log('   3. Re-run this script to verify')
    }

    log('\n' + '='.repeat(80))
  } catch (error) {
    log(`\n❌ Error: ${error.message}`)
    log('\nTroubleshooting:')
    log('  1. Check BRIDGE_URL is correct: ' + BRIDGE_URL)
    log('  2. Check BRIDGE_SECRET is correct')
    log('  3. Verify network connectivity to rolplay.pro')
    log('  4. Check PHP bridge is running and accessible')
  }
}

inspectDatabase()
