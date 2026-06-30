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
  // Check customer record
  const customer = await pool.request().query(`
    SELECT * FROM [dbo].[customers] WHERE customer_number = 'C-0002'
  `);
  console.log('Customer C-0002 in target DB:');
  console.log(customer.recordset[0]);

  // Check sale record
  const sale = await pool.request().query(`
    SELECT * FROM [dbo].[sales] WHERE customer_id = '${customer.recordset[0]?.id}'
  `);
  console.log('\nSales for C-0002:');
  console.log(sale.recordset);

  // Check payments count
  const payments = await pool.request().query(`
    SELECT COUNT(*) as count, SUM(amount) as total_amount FROM [dbo].[payments] WHERE customer_id = '${customer.recordset[0]?.id}'
  `);
  console.log('\nPayments for C-0002:');
  console.log(payments.recordset[0]);

} finally {
  await pool.close();
}
