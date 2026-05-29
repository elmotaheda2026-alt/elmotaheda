// verifyRbac.js – runs a quick RBAC sanity check using the API
// Run with: node scripts/verifyRbac.js
const fetch = require('node-fetch');

const API_BASE = process.env.API_BASE_URL || 'http://localhost:4000';

async function request(path, token, method = 'GET', body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}${path}`, opts);
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function login(email, password) {
  const { status, json } = await request('/auth/login', null, 'POST', { email, password });
  if (status !== 200) throw new Error(`Login failed for ${email}: ${json.message || 'unknown'}`);
  return json.token;
}

async function main() {
  console.log('--- RBAC verification start ---');

  // Ensure admin exists (seed if needed)
  try {
    await request('/auth/seed-admin', null, 'POST');
    console.log('Admin seeded (if not present).');
  } catch (e) {
    console.log('Seed admin error (ignore if already exists).');
  }

  // Login as admin
  const adminToken = await login('admin@almuttahida.com', 'admin123');
  console.log('✅ Admin login OK');

  // Create manager & user accounts (idempotent – ignore errors)
  const manager = { name: 'مدير', email: 'manager@example.com', password: 'manager123', role: 'manager', permissions: { sales: true, users: false } };
  const user = { name: 'مستخدم', email: 'user@example.com', password: 'user123', role: 'user', permissions: { sales: false, users: false } };
  await request('/users', adminToken, 'POST', manager).catch(() => {});
  await request('/users', adminToken, 'POST', user).catch(() => {});
  console.log('✅ Manager & User created (or already exist)');

  // Helper to test an endpoint
  async function test(name, fn) {
    try {
      const result = await fn();
      console.log(`✔ ${name}: ${result.status}`);
    } catch (e) {
      console.log(`✖ ${name}: ${e.message}`);
    }
  }

  // Login each role
  const managerToken = await login('manager@example.com', 'manager123');
  const userToken = await login('user@example.com', 'user123');

  // Test GET suppliers (read)
  await test('GET /suppliers as admin', () => request('/suppliers', adminToken));
  await test('GET /suppliers as manager', () => request('/suppliers', managerToken));
  await test('GET /suppliers as user', () => request('/suppliers', userToken));

  // Test POST supplier (write)
  const newSup = { name: 'مورد اختبار', phone: '12345', email: 'test@example.com', address: 'شارع', notes: '' };
  await test('POST /suppliers as admin', () => request('/suppliers', adminToken, 'POST', newSup));
  await test('POST /suppliers as manager', () => request('/suppliers', managerToken, 'POST', newSup));
  await test('POST /suppliers as user', () => request('/suppliers', userToken, 'POST', newSup));

  // Test DELETE supplier (admin only)
  // First list to obtain an id (use admin token)
  const { json: list } = await request('/suppliers', adminToken);
  const id = list[0]?.id;
  if (id) {
    await test('DELETE /suppliers/:id as admin', () => request(`/suppliers/${id}`, adminToken, 'DELETE'));
    await test('DELETE /suppliers/:id as manager', () => request(`/suppliers/${id}`, managerToken, 'DELETE'));
    await test('DELETE /suppliers/:id as user', () => request(`/suppliers/${id}`, userToken, 'DELETE'));
  }

  // Test GET /users (admin only)
  await test('GET /users as admin', () => request('/users', adminToken));
  await test('GET /users as manager', () => request('/users', managerToken));
  await test('GET /users as user', () => request('/users', userToken));

  console.log('--- RBAC verification finished ---');
}

main().catch(err => console.error('Fatal error:', err));
