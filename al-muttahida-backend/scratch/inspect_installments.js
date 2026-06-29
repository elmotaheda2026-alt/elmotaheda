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
  // Let's check some samples from installment table
  const sample = await pool.request().query(`
    SELECT TOP 10 * FROM [dbo].[installment]
  `);
  console.log('Sample installments:');
  console.log(sample.recordset);

  // Let's search for installments related to PB-0001
  const search1 = await pool.request().query(`
    SELECT * FROM [dbo].[installment] WHERE InvoiceNo LIKE '%PB-0001%'
  `);
  console.log('Search PB-0001:');
  console.log(search1.recordset);

  // Let's count how many distinct InvoiceNo we have in installment table
  const countDistinct = await pool.request().query(`
    SELECT COUNT(DISTINCT InvoiceNo) as distinct_invoices, COUNT(*) as total_rows
    FROM [dbo].[installment]
  `);
  console.log('Counts:', countDistinct.recordset[0]);

} finally {
  await pool.close();
}
