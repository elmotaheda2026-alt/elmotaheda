import assert from 'node:assert/strict';
import test from 'node:test';
import { dbPromise, poolPromise } from './db.js';

test('live MSSQL wrapper supports scalar, TOP, explicit pagination, and bound parameters', async () => {
  const db = await dbPromise;

  const countRow = await db.get<{ total: number }>('SELECT COUNT(*) AS total FROM users');
  assert.equal(typeof countRow?.total, 'number');

  const topRow = await db.get<{ username: string }>('SELECT TOP 1 username FROM users ORDER BY created_at ASC');
  assert.equal(typeof topRow?.username, 'string');

  const pagedRows = await db.all<{ username: string }>(
    'SELECT username FROM users ORDER BY created_at ASC',
    [],
    { page: 1, limit: 1 },
  );
  assert.ok(pagedRows.length <= 1);

  const injectionAttempt = await db.get<{ total: number }>(
    'SELECT COUNT(*) AS total FROM users WHERE username = ?',
    "admin' OR 1=1 --",
  );
  assert.equal(injectionAttempt?.total, 0);
});

test.after(async () => {
  const pool = await poolPromise;
  await pool.close();
});
