const fetch = global.fetch || require('node-fetch');
const BASE = 'https://second-brain-shz8.onrender.com/admin/api';
const TOKEN = 'QWERTYUIOPASDFGHJKLZXCVBNM1234567890abcdefABCDEFGH';

async function get(url) {
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' }, cache: 'no-store' });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { json = text; }
    return { status: res.status, ok: res.ok, body: json };
  } catch (err) {
    return { error: err.message };
  }
}

(async () => {
  console.log('EMAIL lookup for admin@salinas.com');
  console.log(await get(`${BASE}/organizations/full-profile?admin_email=admin@salinas.com`));

  console.log('\nORG query for organization_name=salinas');
  console.log(await get(`${BASE}/organizations/full-profile?organization_name=salinas`));

  console.log('\nORG path /organizations/salinas');
  console.log(await get(`${BASE}/organizations/salinas`));
})();
