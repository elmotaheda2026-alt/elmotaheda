import sql from 'mssql';

const config = {
  server: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 1433),
  user: process.env.DB_USER || 'sallam',
  password: process.env.DB_PASSWORD || 'ah123',
  database: 'INV_DB_IMPORT_TEMP',
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
};

const pool = await sql.connect(config);
try {
  const tables = ['Invoice_Payment', 'Payment', 'LedgerBook', 'Voucher'];
  for (const t of tables) {
    const columns = await pool.request().query(`
      SELECT c.name, ty.name AS type_name, c.max_length, c.is_nullable
      FROM sys.columns c
      JOIN sys.types ty ON ty.user_type_id = c.user_type_id
      WHERE c.object_id = OBJECT_ID('[dbo].[${t}]')
      ORDER BY c.column_id
    `);
    console.log(`\n=== Table: ${t} ===`);
    console.table(columns.recordset);

    const sample = await pool.request().query(`SELECT TOP 5 * FROM [dbo].[${t}]`);
    console.log(`\nSample data for ${t}:`);
    console.table(sample.recordset);
  }
} finally {
  await pool.close();
}
