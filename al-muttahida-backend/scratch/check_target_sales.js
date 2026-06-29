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
  // Check sales record
  const sale = await pool.request().query(`
    SELECT * FROM [dbo].[sales] WHERE invoice_number = 'PB-0001'
  `);
  console.log('Sale in target DB:');
  console.log(sale.recordset[0]);

  // Check installment_schedules records
  const schedules = await pool.request().query(`
    SELECT * FROM [dbo].[installment_schedules] WHERE sale_id = '${sale.recordset[0]?.id}' ORDER BY month_index
  `);
  console.log('\nSchedules in target DB (count = ' + schedules.recordset.length + '):');
  console.log(schedules.recordset);

  // Check customer record
  const customer = await pool.request().query(`
    SELECT * FROM [dbo].[customers] WHERE id = '${sale.recordset[0]?.customer_id}'
  `);
  console.log('\nCustomer in target DB:');
  console.log(customer.recordset[0]);

} finally {
  await pool.close();
}
