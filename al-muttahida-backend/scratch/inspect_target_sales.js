import sql from 'mssql';

const config = {
  server: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 1433),
  user: process.env.DB_USER || 'sallam',
  password: process.env.DB_PASSWORD || 'ah123',
  database: 'AlMuttahida_New',
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
};

const pool = await sql.connect(config);
try {
  const result = await pool.request().query(`
    SELECT TOP 10 id, invoice_number, customer_name, total, paid, remaining, date
    FROM [dbo].[sales]
    ORDER BY invoice_number
  `);
  console.log('Top 10 sales:');
  console.log(result.recordset);
} finally {
  await pool.close();
}
