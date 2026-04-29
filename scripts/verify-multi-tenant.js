#!/usr/bin/env node

/**
 * verify-multi-tenant.js
 *
 * Verification script for multi-tenant architecture
 *
 * Usage:
 *   node scripts/verify-multi-tenant.js
 */

const fs = require('fs')
const path = require('path')

const checks = []

function check(name, condition, details = '') {
  checks.push({
    name,
    passed: condition,
    details: condition ? '✓' : `✗ ${details}`,
  })
}

function fileExists(filepath) {
  return fs.existsSync(filepath)
}

function fileContains(filepath, text) {
  if (!fileExists(filepath)) return false
  const content = fs.readFileSync(filepath, 'utf-8')
  return content.includes(text)
}

function log(msg) {
  console.log(msg)
}

// ============================================================================
// Core Security Files
// ============================================================================

log('\n📋 Checking core security files...')

check(
  'lib/multi-tenant.ts exists',
  fileExists('lib/multi-tenant.ts'),
  'Missing multi-tenant validation helpers'
)

check(
  'lib/multi-tenant.ts has validateClientAccess',
  fileContains('lib/multi-tenant.ts', 'export function validateClientAccess'),
  'Missing validateClientAccess function'
)

check(
  'lib/multi-tenant.ts has sanitizeCompanyId',
  fileContains('lib/multi-tenant.ts', 'export function sanitizeCompanyId'),
  'Missing sanitizeCompanyId function'
)

check(
  'lib/bridge-secure.ts exists',
  fileExists('lib/bridge-secure.ts'),
  'Missing secure bridge wrapper'
)

check(
  'lib/bridge-secure.ts has secureInsert',
  fileContains('lib/bridge-secure.ts', 'export async function secureInsert'),
  'Missing secureInsert function'
)

check(
  'lib/api-helpers.ts exists',
  fileExists('lib/api-helpers.ts'),
  'Missing API context helpers'
)

check(
  'lib/api-helpers.ts has getApiContext',
  fileContains('lib/api-helpers.ts', 'export function getApiContext'),
  'Missing getApiContext function'
)

// ============================================================================
// Middleware Security
// ============================================================================

log('\n🔒 Checking middleware security...')

check(
  'middleware.ts imports multi-tenant',
  fileContains('middleware.ts', "import { sanitizeCompanyId, logSecurityEvent } from './lib/multi-tenant'"),
  'Missing multi-tenant imports'
)

check(
  'middleware.ts validates company_id format',
  fileContains('middleware.ts', 'const sanitized = sanitizeCompanyId(payload.company_id)'),
  'Missing company_id validation'
)

check(
  'middleware.ts checks sanitized company_id',
  fileContains('middleware.ts', 'if (!sanitized)'),
  'Missing sanitized company_id check'
)

check(
  'middleware.ts sets x-user-company-id header',
  fileContains('middleware.ts', "response.headers.set('x-user-company-id'"),
  'Missing x-user-company-id header'
)

check(
  'middleware.ts logs security events',
  fileContains('middleware.ts', 'logSecurityEvent'),
  'Missing security event logging'
)

// ============================================================================
// API Endpoints
// ============================================================================

log('\n🔌 Checking API endpoint patterns...')

check(
  'Example read endpoint exists: api/kpis/coach/route.ts',
  fileExists('app/api/kpis/coach/route.ts'),
  'Missing example read endpoint'
)

check(
  'Read endpoint calls getApiContext',
  fileContains('app/api/kpis/coach/route.ts', 'const context = getApiContext(request)'),
  'Missing getApiContext call'
)

check(
  'Read endpoint validates context',
  fileContains('app/api/kpis/coach/route.ts', 'if (!context)'),
  'Missing context validation'
)

check(
  'Read endpoint uses secureQuery',
  fileContains('app/api/kpis/coach/route.ts', 'await secureQuery'),
  'Missing secureQuery call'
)

check(
  'Example write endpoint exists: api/coach-sessions/route.ts',
  fileExists('app/api/coach-sessions/route.ts'),
  'Missing example write endpoint'
)

check(
  'Write endpoint validates request body',
  fileContains('app/api/coach-sessions/route.ts', 'validateRequestBody'),
  'Missing request body validation'
)

check(
  'Write endpoint uses secureInsert',
  fileContains('app/api/coach-sessions/route.ts', 'await secureInsert'),
  'Missing secureInsert call'
)

// ============================================================================
// Database Schema
// ============================================================================

log('\n🗄️  Checking database schema...')

check(
  'Migration file exists',
  fileExists('migrations/001_add_multi_tenant_support.sql'),
  'Missing database migration'
)

check(
  'Migration creates clients table',
  fileContains('migrations/001_add_multi_tenant_support.sql', 'CREATE TABLE IF NOT EXISTS clients'),
  'Missing clients table'
)

check(
  'Migration creates users table with company_id',
  fileContains('migrations/001_add_multi_tenant_support.sql', 'company_id VARCHAR(50) NOT NULL'),
  'Missing company_id in users table'
)

check(
  'Migration creates user_sessions table',
  fileContains('migrations/001_add_multi_tenant_support.sql', 'CREATE TABLE IF NOT EXISTS user_sessions'),
  'Missing user_sessions table'
)

check(
  'Migration adds company_id to coach_sessions',
  fileContains('migrations/001_add_multi_tenant_support.sql', 'ALTER TABLE coach_sessions'),
  'Missing company_id for coach_sessions'
)

check(
  'Migration creates foreign key constraints',
  fileContains('migrations/001_add_multi_tenant_support.sql', 'FOREIGN KEY'),
  'Missing foreign key constraints'
)

check(
  'Migration creates indexes',
  fileContains('migrations/001_add_multi_tenant_support.sql', 'INDEX idx_company'),
  'Missing company_id indexes'
)

// ============================================================================
// Auth System Integration
// ============================================================================

log('\n🔐 Checking auth system integration...')

check(
  'User type has company_id',
  fileContains('lib/auth.ts', 'company_id: string'),
  'Missing company_id in User type'
)

check(
  'TokenPayload has company_id',
  fileContains('lib/auth.ts', 'company_id: string'),
  'Missing company_id in TokenPayload'
)

check(
  'generateAccessToken includes company_id',
  fileContains('lib/auth.ts', 'company_id: user.company_id'),
  'Missing company_id in token generation'
)

check(
  'db-users.ts includes company_id in queries',
  fileContains('lib/db-users.ts', 'company_id'),
  'Missing company_id in user queries'
)

// ============================================================================
// Documentation
// ============================================================================

log('\n📚 Checking documentation...')

check(
  'Implementation guide exists',
  fileExists('MULTI_TENANT_IMPLEMENTATION.md'),
  'Missing implementation guide'
)

check(
  'Implementation guide documents security layers',
  fileContains('MULTI_TENANT_IMPLEMENTATION.md', 'Security Layers'),
  'Missing security documentation'
)

check(
  'Implementation guide includes integration checklist',
  fileContains('MULTI_TENANT_IMPLEMENTATION.md', 'Integration Checklist'),
  'Missing integration instructions'
)

// ============================================================================
// Results
// ============================================================================

log('\n' + '='.repeat(80))
log('VERIFICATION RESULTS')
log('='.repeat(80))

const passed = checks.filter((c) => c.passed).length
const total = checks.length

checks.forEach((c) => {
  const icon = c.passed ? '✅' : '❌'
  log(`${icon} ${c.name}`)
  if (c.details && !c.passed) {
    log(`   ${c.details}`)
  }
})

log('\n' + '='.repeat(80))
log(`Results: ${passed}/${total} checks passed`)
log('='.repeat(80))

if (passed === total) {
  log('✅ Multi-tenant architecture is properly implemented!')
  log('')
  log('Next steps:')
  log('1. Run database migration: migrations/001_add_multi_tenant_support.sql')
  log('2. Update existing API endpoints to use getApiContext()')
  log('3. Update data-provider functions to filter by company_id')
  log('4. Test multi-tenant isolation with 2+ companies')
  log('5. Monitor security audit logs in production')
  log('')
  process.exit(0)
} else {
  log('❌ Some checks failed. Review above and fix issues.')
  log('')
  process.exit(1)
}
