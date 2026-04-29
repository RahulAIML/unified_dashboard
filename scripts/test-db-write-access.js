#!/usr/bin/env node

/**
 * test-db-write-access.js
 *
 * Tests if you have write access to the database via PHP Bridge
 *
 * Attempts:
 * 1. Create a temporary test table
 * 2. Insert test data
 * 3. Query it back
 * 4. Drop the test table
 *
 * Usage:
 *   node scripts/test-db-write-access.js
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

async function testWriteAccess() {
  log('\n' + '='.repeat(80))
  log('DATABASE WRITE ACCESS TEST')
  log('='.repeat(80))
  log('\nAttempting to create a temporary test table...\n')

  const testTableName = `test_write_access_${Date.now()}`
  const tests = []

  try {
    // Test 1: Create a temporary test table
    log('📝 Step 1: Creating temporary test table...')
    const createResult = await makeRequest(`
      CREATE TABLE ${testTableName} (
        id INT AUTO_INCREMENT PRIMARY KEY,
        test_name VARCHAR(255),
        test_data TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)

    if (!createResult.success) {
      log(`❌ FAILED: Could not create table`)
      log(`   Error: ${createResult.error || createResult.message || 'Unknown error'}`)
      tests.push({ step: 'CREATE TABLE', result: false, error: createResult.error })
    } else {
      log(`✅ SUCCESS: Table created`)
      tests.push({ step: 'CREATE TABLE', result: true })

      // Test 2: Insert test data
      log('\n📝 Step 2: Inserting test data...')
      const insertResult = await makeRequest(`
        INSERT INTO ${testTableName} (test_name, test_data)
        VALUES ('write_access_test', 'This proves you have write access to the database')
      `)

      if (!insertResult.success) {
        log(`❌ FAILED: Could not insert data`)
        log(`   Error: ${insertResult.error || insertResult.message || 'Unknown error'}`)
        tests.push({ step: 'INSERT', result: false, error: insertResult.error })
      } else {
        log(`✅ SUCCESS: Data inserted`)
        tests.push({ step: 'INSERT', result: true })

        // Test 3: Query the data back
        log('\n📝 Step 3: Querying test data...')
        const queryResult = await makeRequest(`
          SELECT id, test_name, test_data FROM ${testTableName} ORDER BY id DESC LIMIT 1
        `)

        if (!queryResult.success || !queryResult.data || queryResult.data.length === 0) {
          log(`❌ FAILED: Could not read data back`)
          log(`   Error: ${queryResult.error || queryResult.message || 'No data returned'}`)
          tests.push({ step: 'SELECT', result: false })
        } else {
          const row = queryResult.data[0]
          log(`✅ SUCCESS: Data read successfully`)
          log(`   ID: ${row.id}`)
          log(`   Name: ${row.test_name}`)
          log(`   Data: ${row.test_data}`)
          tests.push({ step: 'SELECT', result: true })

          // Test 4: Update the data
          log('\n📝 Step 4: Updating test data...')
          const updateResult = await makeRequest(`
            UPDATE ${testTableName} SET test_data = 'Successfully updated at ${new Date().toISOString()}' WHERE id = ${row.id}
          `)

          if (!updateResult.success) {
            log(`❌ FAILED: Could not update data`)
            log(`   Error: ${updateResult.error || updateResult.message}`)
            tests.push({ step: 'UPDATE', result: false })
          } else {
            log(`✅ SUCCESS: Data updated`)
            tests.push({ step: 'UPDATE', result: true })
          }
        }
      }

      // Test 5: Drop the test table
      log('\n📝 Step 5: Cleaning up (dropping test table)...')
      const dropResult = await makeRequest(`
        DROP TABLE IF EXISTS ${testTableName}
      `)

      if (!dropResult.success) {
        log(`⚠️  WARNING: Could not drop test table`)
        log(`   Error: ${dropResult.error || dropResult.message}`)
        log(`   Please manually drop table: ${testTableName}`)
        tests.push({ step: 'DROP TABLE', result: false })
      } else {
        log(`✅ SUCCESS: Test table dropped`)
        tests.push({ step: 'DROP TABLE', result: true })
      }
    }
  } catch (error) {
    log(`\n❌ Connection Error: ${error.message}`)
    log('\nTroubleshooting:')
    log('  1. Check BRIDGE_URL is correct: ' + BRIDGE_URL)
    log('  2. Check BRIDGE_SECRET is correct')
    log('  3. Verify network connectivity to rolplay.pro')
    log('  4. Check PHP bridge is running and accessible')
    tests.push({ step: 'CONNECTION', result: false, error: error.message })
  }

  // Summary
  log('\n' + '='.repeat(80))
  log('TEST RESULTS')
  log('='.repeat(80))

  const passed = tests.filter((t) => t.result).length
  const total = tests.length

  tests.forEach((test) => {
    const icon = test.result ? '✅' : '❌'
    log(`${icon} ${test.step}: ${test.result ? 'PASS' : 'FAIL'}`)
    if (test.error) {
      log(`   → ${test.error}`)
    }
  })

  log('\n' + '─'.repeat(80))

  if (passed === total && total > 0) {
    log('✅ YOU HAVE WRITE ACCESS TO THE DATABASE!')
    log('\n✅ Next steps:')
    log('   1. You can now execute the migration to create required tables')
    log('   2. Run: node scripts/execute-migration.js')
    log('   3. Or manually run: migrations/001_add_multi_tenant_support.sql')
    log('\n')
    return true
  } else if (passed > 0) {
    log('⚠️  PARTIAL ACCESS - Some operations failed')
    log('\nYou have READ access but may have LIMITED WRITE access.')
    log('Some DDL operations (CREATE/ALTER TABLE) might be restricted.')
    log('\nRecommendation:')
    log('  Contact your database administrator with the failed operations above.')
    log('\n')
    return false
  } else {
    log('❌ YOU DO NOT HAVE WRITE ACCESS TO THE DATABASE')
    log('\nRecommendation:')
    log('  1. Contact your database administrator')
    log('  2. Ask them to execute: migrations/001_add_multi_tenant_support.sql')
    log('  3. Provide them the DATABASE_STATUS_REPORT.md for details')
    log('\n')
    return false
  }
}

testWriteAccess().then((hasAccess) => {
  process.exit(hasAccess ? 0 : 1)
})
