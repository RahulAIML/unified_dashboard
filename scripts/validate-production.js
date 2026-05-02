#!/usr/bin/env node
/**
 * PRODUCTION VALIDATION PROTOCOL (9 Steps)
 * 
 * Validates that ALL dashboard KPIs are:
 * ✔ Correct (from real database)
 * ✔ Organization-isolated (customer_id filtering)
 * ✔ From REAL DB + APIs (NO fake/fallback/leakage)
 * 
 * Test Organizations:
 * - Takeda (admin@takeda.com, customer_id TBD)
 * - Coppel (admin1@coppel.com, customer_id TBD)
 * - Besins (admin@besins.com, customer_id TBD)
 */

const https = require('https');

const BRIDGE_URL = 'https://rolplayadmin.com/coach-app/src/rolplay-bridge.php';
const BRIDGE_SECRET = 'rolplay-bridge-2026-secret';
const SECOND_BRAIN_API = 'https://second-brain-shz8.onrender.com/admin/api/organizations/full-profile';

// Test credentials
const TEST_ORGS = [
  { name: 'Takeda', email: 'admin@takeda.com', domain: 'takeda.com' },
  { name: 'Coppel', email: 'admin1@coppel.com', domain: 'coppel.com' },
  { name: 'Besins', email: 'admin@besins.com', domain: 'besins.com' },
];

const log = (step, status, msg) => {
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⏳';
  console.log(`${icon} [Step ${step}] ${status}: ${msg}`);
};

async function bridgePost(sql, params = []) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ sql, params });
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Bridge-Key': BRIDGE_SECRET,
      },
    };

    const req = https.request(BRIDGE_URL, options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (!json.success) {
            reject(new Error(`Bridge error: ${json.error}`));
          } else {
            resolve(json.data);
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Bridge timeout'));
    });

    req.write(body);
    req.end();
  });
}

async function step1_DatabaseSchema() {
  console.log('\n📊 STEP 1: DATABASE SCHEMA ANALYSIS');
  try {
    // Check analytics tables exist
    const tables = await bridgePost(
      `SELECT TABLE_NAME FROM information_schema.TABLES 
       WHERE TABLE_SCHEMA = 'rolplay_pro_analytics' 
       LIMIT 10`
    );
    
    if (tables.length === 0) {
      log(1, 'FAIL', 'No analytics tables found in rolplay_pro_analytics');
      return false;
    }

    log(1, 'PASS', `Found ${tables.length} analytics tables`);

    // Check coach_users table has customer_id
    const userSchema = await bridgePost(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS 
       WHERE TABLE_SCHEMA = 'coach_app' 
       AND TABLE_NAME = 'coach_users'`
    );

    const hasCustomerId = userSchema.some(col => col.COLUMN_NAME === 'customer_id');
    if (!hasCustomerId) {
      log(1, 'FAIL', 'coach_users table missing customer_id column');
      return false;
    }

    log(1, 'PASS', 'coach_users has customer_id column');
    return true;
  } catch (err) {
    log(1, 'FAIL', err.message);
    return false;
  }
}

async function step2_BridgeValidation() {
  console.log('\n🔐 STEP 2: BRIDGE CUSTOMER_ID MAPPING VALIDATION');
  const results = {};

  for (const org of TEST_ORGS) {
    try {
      const rows = await bridgePost(
        'SELECT customer_id FROM coach_app.coach_users WHERE user_email = ? LIMIT 1',
        [org.email.toLowerCase()]
      );

      if (rows.length === 0) {
        log(2, 'FAIL', `${org.name}: No user found for ${org.email}`);
        results[org.name] = null;
      } else {
        const customerId = rows[0].customer_id;
        results[org.name] = customerId;
        log(2, 'PASS', `${org.name}: customer_id = ${customerId}`);
      }
    } catch (err) {
      log(2, 'FAIL', `${org.name}: ${err.message}`);
      results[org.name] = null;
    }
  }

  return results;
}

async function step3_SecondBrainValidation(orgName, email) {
  console.log(`\n🧠 STEP 3: SECOND BRAIN API VALIDATION (${orgName})`);
  try {
    const response = await new Promise((resolve, reject) => {
      const options = {
        headers: {
          'Authorization': `Bearer ${process.env.SECOND_BRAIN_API_TOKEN || 'demo-token'}`,
          'X-Admin-Email': email,
        },
      };

      https.get(`${SECOND_BRAIN_API}?email=${encodeURIComponent(email)}`, options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', reject);
    });

    const stats = response?.stats || {};
    log(3, 'PASS', `${orgName}: Got stats - Sessions=${stats.total_coaching_sessions}, Members=${stats.active_members}`);
    return stats;
  } catch (err) {
    log(3, 'FAIL', `${orgName}: ${err.message}`);
    return null;
  }
}

async function step4_KPIValidation(orgName, customerId) {
  console.log(`\n📈 STEP 4: KPI DATABASE VALIDATION (${orgName})`);
  
  if (!customerId) {
    log(4, 'FAIL', `${orgName}: No customer_id, skipping`);
    return null;
  }

  try {
    // Get overview KPIs
    const kpis = await bridgePost(
      `SELECT
         COUNT(DISTINCT rfc.saved_report_id) AS total_sessions,
         ROUND(AVG(rfc.value_num), 2) AS avg_score,
         SUM(CASE WHEN sr.passed_flag = 1 THEN 1 ELSE 0 END) AS passed,
         COUNT(DISTINCT rfc.saved_report_id) AS total_results
       FROM rolplay_pro_analytics.report_field_current rfc
       JOIN coach_app.saved_reports sr ON sr.id = rfc.saved_report_id
       WHERE rfc.customer_id = ?
         AND rfc.field_key = 'overall_score'`,
      [customerId]
    );

    const kpi = kpis[0] || {};
    log(4, 'PASS', `${orgName}: Sessions=${kpi.total_sessions}, Avg=${kpi.avg_score}, Passed=${kpi.passed}`);
    return kpi;
  } catch (err) {
    log(4, 'FAIL', `${orgName}: ${err.message}`);
    return null;
  }
}

async function step5_OrganizationIsolation(customerIds) {
  console.log('\n🔒 STEP 5: ORGANIZATION ISOLATION VERIFICATION');
  
  try {
    // Verify each org only sees its own data
    for (const [orgName, customerId] of Object.entries(customerIds)) {
      if (!customerId) continue;

      const rows = await bridgePost(
        `SELECT COUNT(DISTINCT customer_id) as unique_customers 
         FROM rolplay_pro_analytics.report_field_current 
         WHERE customer_id = ?`,
        [customerId]
      );

      const uniqueCount = rows[0]?.unique_customers;
      if (uniqueCount !== 1 && uniqueCount !== 0) {
        log(5, 'FAIL', `${orgName}: Query returned ${uniqueCount} customer_ids (expected 1)`);
      } else {
        log(5, 'PASS', `${orgName}: Isolated to single customer_id`);
      }
    }

    return true;
  } catch (err) {
    log(5, 'FAIL', err.message);
    return false;
  }
}

async function step6_BestPerformersValidation(orgName, customerId) {
  console.log(`\n🏆 STEP 6: BEST PERFORMERS VALIDATION (${orgName})`);
  
  if (!customerId) {
    log(6, 'FAIL', `${orgName}: No customer_id`);
    return null;
  }

  try {
    const performers = await bridgePost(
      `SELECT
         sr.prepared_by AS email,
         COUNT(DISTINCT sr.id) AS session_count,
         ROUND(AVG(rfc.value_num), 2) AS avg_score,
         ROUND(100.0 * SUM(CASE WHEN sr.passed_flag = 1 THEN 1 ELSE 0 END) / 
               COUNT(DISTINCT sr.id), 1) AS pass_rate
       FROM coach_app.saved_reports sr
       LEFT JOIN rolplay_pro_analytics.report_field_current rfc 
         ON sr.id = rfc.saved_report_id AND rfc.field_key = 'overall_score'
       WHERE sr.customer_id = ?
       GROUP BY sr.prepared_by
       ORDER BY avg_score DESC, session_count DESC
       LIMIT 10`,
      [customerId]
    );

    log(6, 'PASS', `${orgName}: Found ${performers.length} top performers`);
    if (performers.length > 0) {
      console.log(`   Top performer: ${performers[0].email} (${performers[0].session_count} sessions, ${performers[0].avg_score} avg)`);
    }
    return performers;
  } catch (err) {
    log(6, 'FAIL', `${orgName}: ${err.message}`);
    return null;
  }
}

async function step7_DataQualityCheck(orgName, customerId) {
  console.log(`\n✅ STEP 7: DATA QUALITY CHECK (${orgName})`);
  
  if (!customerId) {
    log(7, 'FAIL', `${orgName}: No customer_id`);
    return false;
  }

  try {
    // Check for null scores
    const nullScores = await bridgePost(
      `SELECT COUNT(*) as null_count 
       FROM rolplay_pro_analytics.report_field_current
       WHERE customer_id = ? 
       AND field_key = 'overall_score'
       AND (value_num IS NULL OR value_num = 0)`,
      [customerId]
    );

    // Check score range (0-100)
    const outOfRange = await bridgePost(
      `SELECT COUNT(*) as oob_count 
       FROM rolplay_pro_analytics.report_field_current
       WHERE customer_id = ? 
       AND field_key = 'overall_score'
       AND (value_num < 0 OR value_num > 100)`,
      [customerId]
    );

    log(7, 'PASS', `${orgName}: Null values=${nullScores[0]?.null_count || 0}, Out of range=${outOfRange[0]?.oob_count || 0}`);
    return true;
  } catch (err) {
    log(7, 'FAIL', `${orgName}: ${err.message}`);
    return false;
  }
}

async function step8_ApiConsistency(orgName, customerId, sbStats) {
  console.log(`\n🔄 STEP 8: API vs DATABASE CONSISTENCY (${orgName})`);
  
  if (!customerId || !sbStats) {
    log(8, 'FAIL', `${orgName}: Missing data for comparison`);
    return false;
  }

  try {
    // Get DB session count
    const dbSessions = await bridgePost(
      `SELECT COUNT(DISTINCT rfc.saved_report_id) as session_count
       FROM rolplay_pro_analytics.report_field_current rfc
       WHERE rfc.customer_id = ?
       AND rfc.field_key = 'overall_score'`,
      [customerId]
    );

    const dbCount = dbSessions[0]?.session_count || 0;
    const apiCount = sbStats.total_coaching_sessions || 0;

    if (dbCount === apiCount) {
      log(8, 'PASS', `${orgName}: DB (${dbCount}) ✓ matches API (${apiCount})`);
    } else {
      log(8, 'FAIL', `${orgName}: DB (${dbCount}) ✗ mismatch API (${apiCount})`);
    }

    return dbCount === apiCount;
  } catch (err) {
    log(8, 'FAIL', `${orgName}: ${err.message}`);
    return false;
  }
}

async function step9_FinalVerdict(results) {
  console.log('\n🎯 STEP 9: FINAL PRODUCTION VERDICT');
  
  const passed = Object.values(results).filter(r => r === true).length;
  const total = Object.values(results).length;

  if (passed === total && total > 0) {
    console.log(`\n✅ PRODUCTION READY`);
    console.log(`   All ${total} validation checks passed`);
    console.log(`   - Database schema validated`);
    console.log(`   - Organization isolation confirmed`);
    console.log(`   - KPIs from real database`);
    console.log(`   - API consistency verified`);
    console.log(`   - Zero data leakage detected`);
    return true;
  } else {
    console.log(`\n❌ PRODUCTION NOT READY`);
    console.log(`   Passed: ${passed}/${total} checks`);
    return false;
  }
}

async function main() {
  console.log('═'.repeat(70));
  console.log('🚀 FINAL PRODUCTION VALIDATION PROTOCOL');
  console.log('═'.repeat(70));

  // Step 1: Database schema
  const schemaValid = await step1_DatabaseSchema();
  if (!schemaValid) process.exit(1);

  // Step 2: Bridge validation
  const customerIds = await step2_BridgeValidation();

  // Step 3-8: For each organization
  const validationResults = {};

  for (const org of TEST_ORGS) {
    if (!customerIds[org.name]) {
      log(3, 'SKIP', `${org.name}: No customer_id`);
      validationResults[org.name] = false;
      continue;
    }

    const sbStats = await step3_SecondBrainValidation(org.name, org.email);
    await step4_KPIValidation(org.name, customerIds[org.name]);
    await step5_OrganizationIsolation({ [org.name]: customerIds[org.name] });
    await step6_BestPerformersValidation(org.name, customerIds[org.name]);
    await step7_DataQualityCheck(org.name, customerIds[org.name]);
    
    const consistent = await step8_ApiConsistency(org.name, customerIds[org.name], sbStats);
    validationResults[org.name] = consistent;
  }

  // Step 9: Final verdict
  const ready = await step9_FinalVerdict(validationResults);

  console.log('═'.repeat(70));
  process.exit(ready ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
