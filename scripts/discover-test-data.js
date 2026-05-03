#!/usr/bin/env node
/**
 * DISCOVER REAL TEST DATA
 * 
 * Find actual users and organizations in the database for validation
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
    console.log('Discovering real test data...\n');

    // Find all unique customer IDs
    console.log('1️⃣ CUSTOMER IDs IN DATABASE:');
    const customers = await bridgePost(
      `SELECT DISTINCT customer_id FROM coach_app.coach_users ORDER BY customer_id LIMIT 20`
    );
    console.log(`   Found ${customers.length} customer IDs:`, customers.map(c => c.customer_id).join(', '));

    // Find sample users
    console.log('\n2️⃣ SAMPLE USERS (first 10):');
    const users = await bridgePost(
      `SELECT DISTINCT user_email, customer_id FROM coach_app.coach_users LIMIT 10`
    );
    users.forEach(u => {
      console.log(`   ${u.user_email} (customer_id=${u.customer_id})`);
    });

    // Get data volume per customer
    console.log('\n3️⃣ DATA VOLUME PER CUSTOMER:');
    const volumes = await bridgePost(
      `SELECT 
         customer_id,
         COUNT(DISTINCT saved_report_id) as session_count,
         COUNT(*) as total_records
       FROM rolplay_pro_analytics.report_field_current
       GROUP BY customer_id
       ORDER BY session_count DESC`
    );
    volumes.forEach(v => {
      console.log(`   customer_id=${v.customer_id}: ${v.session_count} sessions, ${v.total_records} records`);
    });

    // Sample records for first customer
    if (customers.length > 0) {
      const cid = customers[0].customer_id;
      console.log(`\n4️⃣ SAMPLE KPI DATA FOR customer_id=${cid}:`);
      
      const sample = await bridgePost(
        `SELECT
           COUNT(DISTINCT saved_report_id) as total_sessions,
           ROUND(AVG(value_num), 2) as avg_score,
           MIN(value_num) as min_score,
           MAX(value_num) as max_score,
           SUM(CASE WHEN saved_report_id IS NOT NULL THEN 1 ELSE 0 END) as record_count
         FROM rolplay_pro_analytics.report_field_current
         WHERE customer_id = ? AND field_key = 'overall_score'`,
        [cid]
      );
      
      console.log(`   ${JSON.stringify(sample[0], null, 2)}`);
    }

  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
