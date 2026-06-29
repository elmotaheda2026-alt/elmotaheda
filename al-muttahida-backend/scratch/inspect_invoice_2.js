import sql from 'mssql';

const config = {
  server: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 1433),
  user: process.env.DB_USER || 'sallam',
  password: process.env.DB_PASSWORD || 'ah123',
  database: 'master',
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
};

const pool = await sql.connect(config);
try {
  // Source DB
  const invoice = await pool.request().query(`
    SELECT Inv_ID, InvoiceNo, CustomerID, GrandTotal, Balance
    FROM [INV_DB_IMPORT_TEMP].[dbo].[InvoiceInfo]
    WHERE InvoiceNo LIKE '%PB-0002%'
  `);
  console.log('Source InvoiceInfo PB-0002:', invoice.recordset[0]);

  const installments = await pool.request().query(`
    SELECT SUM(kima_ins) as total_due, SUM(kima_msd) as total_paid
    FROM [INV_DB_IMPORT_TEMP].[dbo].[installment]
    WHERE InvoiceNo LIKE '%PB-0002%'
  `);
  console.log('Source Installments sum:', installments.recordset[0]);

  // Target DB
  const targetSale = await pool.request().query(`
    SELECT id, invoice_number, total, paid, remaining
    FROM [AlMuttahida_New].[dbo].[sales]
    WHERE invoice_number = 'PB-0002'
  `);
  console.log('Target Sale PB-0002:', targetSale.recordset[0]);

  const targetSchedules = await pool.request().query(`
    SELECT SUM(amount) as total_due, SUM(paid_amount) as total_paid
    FROM [AlMuttahida_New].[dbo].[installment_schedules]
    WHERE sale_id = '${targetSale.recordset[0]?.id}'
  `);
  console.log('Target schedules sum:', targetSchedules.recordset[0]);

} finally {
  await pool.close();
}
