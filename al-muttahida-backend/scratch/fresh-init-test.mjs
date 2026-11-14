// Runs initDb against whatever database config.json points to and reports the result.
const m = await import('../dist/db.js');
try {
  await m.initDb();
  const db = await m.dbPromise;
  const t = await db.all('SELECT name FROM sys.tables ORDER BY name');
  console.log('TABLES', t.length, t.map((x) => x.name).join(','));
  const u = await db.all('SELECT username FROM users');
  console.log('USERS', JSON.stringify(u));
} catch (e) {
  console.error('INIT FAILED', e.message);
}
process.exit(0);

