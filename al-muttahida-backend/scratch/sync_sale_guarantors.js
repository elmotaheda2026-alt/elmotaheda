import crypto from 'node:crypto';
import sql from 'mssql';

const pool = await sql.connect({
  server: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 1433),
  user: process.env.DB_USER || 'alm_app',
  password: process.env.DB_PASSWORD || 'Alm@2026#App',
  database: process.env.TARGET_DB || 'AlMuttahida_New',
  options: { encrypt: false, trustServerCertificate: true },
});

try {
  const rows = (
    await pool.request().query(`
      SELECT s.id AS saleId, c.guarantors
      FROM sales s
      JOIN customers c ON c.id = s.customer_id
      WHERE c.guarantors IS NOT NULL
    `)
  ).recordset;

  let inserted = 0;
  const now = new Date().toISOString();
  for (const r of rows) {
    let arr = [];
    try {
      arr = JSON.parse(r.guarantors) || [];
    } catch {
      arr = [];
    }
    for (let i = 0; i < arr.length; i++) {
      const g = arr[i];
      if (!g || !g.name || !String(g.name).trim()) continue;
      await pool
        .request()
        .input('id', sql.NVarChar, crypto.randomUUID())
        .input('sid', sql.NVarChar, r.saleId)
        .input('slot', sql.Int, i + 1)
        .input('name', sql.NVarChar, String(g.name).trim())
        .input('phone', sql.NVarChar, g.phone || null)
        .input('nid', sql.NVarChar, g.nationalId || null)
        .input('addr', sql.NVarChar, g.address || null)
        .input('rel', sql.NVarChar, g.relationship || null)
        .input('now', sql.NVarChar, now)
        .query(`
          IF NOT EXISTS (SELECT 1 FROM sale_guarantors WHERE sale_id = @sid AND slot = @slot)
          INSERT INTO sale_guarantors (id, sale_id, slot, name, phone, national_id, address, relationship, status, created_at, updated_at)
          VALUES (@id, @sid, @slot, @name, @phone, @nid, @addr, @rel, 'active', @now, @now)
        `);
      inserted++;
    }
  }
  console.log('GUARANTORS_INSERTED=' + inserted);
} finally {
  await pool.close();
}
