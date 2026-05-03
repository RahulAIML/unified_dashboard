#!/usr/bin/env node
/**
 * DEEP DATABASE EXPLORATION
 * 
 * Understand the actual schema and data structure
 */

const https = require('https');

const BRIDGE_URL = 'https://rolplayadmin.com/coach-app/src/rolplay-bridge.php';
const BRIDGE_SECRET = 'rolplay-bridge-2026-secret';

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

async function main() {
  try {
    console.log('DEEP DATABASE EXPLORATION\n');

    // 1. List all tables in analytics DB
    console.log('1️⃣ ALL TABLES IN ANALYTICS SCHEMA:');
    const tables = await bridgePost(
      `SELECT TABLE_NAME FROM information_schema.TABLES 
       WHERE TABLE_SCHEMA = 'rolplay_pro_analytics'`
    );
    console.log(tables.map(t => `   - ${t.TABLE_NAME}`).join('\n'));

    // 2. Check all columns in report_field_current
    console.log('\n2️⃣ COLUMNS IN report_field_current:');
    const columns = await bridgePost(
      `SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS 
       WHERE TABLE_SCHEMA = 'rolplay_pro_analytics'
       AND TABLE_NAME = 'report_field_current'
       ORDER BY ORDINAL_POSITION`
    );
    columns.forEach(c => {
      console.log(`   ${c.COLUMN_NAME} (${c.COLUMN_TYPE})`);
    });

    // 3. Check unique field_keys
    console.log('\n3️⃣ UNIQUE FIELD_KEYS IN report_field_current:');
    const fieldKeys = await bridgePost(
      `SELECT DISTINCT field_key FROM rolplay_pro_analytics.report_field_current LIMIT 20`
    );
    console.log(fieldKeys.map(f => `   - ${f.field_key}`).join('\n'));

    // 4. Check saved_reports table structure
    console.log('\n4️⃣ SAVED_REPORTS TABLE STRUCTURE:');
    const srColumns = await bridgePost(
      `SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS 
       WHERE TABLE_SCHEMA = 'coach_app'
       AND TABLE_NAME = 'saved_reports'
       ORDER BY ORDINAL_POSITION`
    );
    srColumns.forEach(c => {
      console.log(`   ${c.COLUMN_NAME} (${c.COLUMN_TYPE})`);
    });

    // 5. Get sample records for customer_id=0 (has most data)
    console.log('\n5️⃣ SAMPLE RECORDS FOR customer_id=0 (field_key, value_num):');
    const sample0 = await bridgePost(
      `SELECT DISTINCT field_key, value_num FROM rolplay_pro_analytics.report_field_current 
       WHERE customer_id = 0 LIMIT 10`
    );
    sample0.forEach(s => {
      console.log(`   ${s.field_key} = ${s.value_num}`);
    });

    // 6. Get ONE full record for customer_id=0
    console.log('\n6️⃣ FULL RECORD FOR customer_id=0:');
    const fullRecord = await bridgePost(
      `SELECT * FROM rolplay_pro_analytics.report_field_current 
       WHERE customer_id = 0 LIMIT 1`
    );
    if (fullRecord.length > 0) {
      console.log(JSON.stringify(fullRecord[0], null, 2));
    }

    // 7. Get sample from customer_id=11 (Takeda)
    console.log('\n7️⃣ DATA FOR customer_id=11 (Takeda):');
    const takeda = await bridgePost(
      `SELECT * FROM rolplay_pro_analytics.report_field_current 
       WHERE customer_id = 11 LIMIT 1`
    );
    if (takeda.length > 0) {
      console.log(JSON.stringify(takeda[0], null, 2));
    }

    // 8. Check report_payload_current if it exists
    console.log('\n8️⃣ CHECKING report_payload_current TABLE:');
    try {
      const payload = await bridgePost(
        `SELECT COUNT(*) as count FROM rolplay_pro_analytics.report_payload_current LIMIT 1`
      );
      console.log(`   EXISTS - ${payload[0]?.count || 0} records`);
      
      const payloadColumns = await bridgePost(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS 
         WHERE TABLE_SCHEMA = 'rolplay_pro_analytics'
         AND TABLE_NAME = 'report_payload_current'`
      );
      console.log('   Columns:', payloadColumns.map(c => c.COLUMN_NAME).join(', '));
    } catch (e) {
      console.log('   NOT FOUND');
    }

    // 9. KPI calculation with actual field_keys
    console.log('\n9️⃣ ACTUAL KPI DATA (customer_id=0):');
    const kpis = await bridgePost(
      `SELECT
         COUNT(DISTINCT saved_report_id) as total_sessions,
         COUNT(DISTINCT field_key) as field_types,
         COUNT(*) as total_records,
         GROUP_CONCAT(DISTINCT field_key) as all_fields
       FROM rolplay_pro_analytics.report_field_current
       WHERE customer_id = 0`
    );
    console.log(JSON.stringify(kpis[0], null, 2));

    // 10. Check for passed_flag in saved_reports
    console.log('\n🔟 PASSED_FLAG IN SAVED_REPORTS:');
    const passFlag = await bridgePost(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS 
       WHERE TABLE_SCHEMA = 'coach_app'
       AND TABLE_NAME = 'saved_reports'
       AND COLUMN_NAME LIKE '%pass%'`
    );
    if (passFlag.length > 0) {
      console.log(`   Found: ${passFlag.map(c => c.COLUMN_NAME).join(', ')}`);
    } else {
      console.log('   NOT FOUND - checking what evaluation columns exist:');
      const evalCols = await bridgePost(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS 
         WHERE TABLE_SCHEMA = 'coach_app'
         AND TABLE_NAME = 'saved_reports'
         AND (COLUMN_NAME LIKE '%eval%' OR COLUMN_NAME LIKE '%status%' OR COLUMN_NAME LIKE '%result%')`
      );
      evalCols.forEach(c => console.log(`      - ${c.COLUMN_NAME}`));
    }

  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
