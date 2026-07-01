import sql from 'mssql';

const config = {
  server: '127.0.0.1',
  port: 1433,
  user: 'sallam',
  password: 'ah123',
  database: 'AlMuttahida_New',
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
};

try {
  const pool = await sql.connect(config);
  const res = await pool.request().query(`
    SELECT TOP 5 due_date
    FROM [dbo].[installment_schedules]
  `);
  console.log("Raw due_dates in database:");
  res.recordset.forEach(row => {
    console.log(`  ${row.due_date} (Type: ${typeof row.due_date})`);
  });
  await pool.close();
} catch (err) {
  console.error("Error:", err.message);
}
