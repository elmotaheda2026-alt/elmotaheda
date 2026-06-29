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
  const paidInstallments = await pool.request().query(`
    SELECT COUNT(*) as count, SUM(kima_msd) as total_paid
    FROM [dbo].[installment]
    WHERE kima_msd > 0
  `);
  console.log('Paid Installments (kima_msd > 0):', paidInstallments.recordset[0]);

  const invoicePayments = await pool.request().query(`
    SELECT COUNT(*) as count, SUM(TotalPaid) as total_paid
    FROM [dbo].[Invoice_Payment]
  `);
  console.log('Invoice_Payment rows:', invoicePayments.recordset[0]);

  const downpaymentsFromLedger = await pool.request().query(`
    SELECT COUNT(*) as count, SUM(Credit) as total_credit
    FROM [dbo].[LedgerBook]
    WHERE Label LIKE '%مقدم%' AND Credit > 0
  `);
  console.log('Downpayments in LedgerBook:', downpaymentsFromLedger.recordset[0]);

} finally {
  await pool.close();
}
