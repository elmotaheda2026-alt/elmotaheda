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
  // Let's query details for Invoice ID = 1 and some others
  const invoice = await pool.request().query(`
    SELECT Inv_ID, InvoiceNo, CustomerID, GrandTotal, Balance, Remarks
    FROM [dbo].[InvoiceInfo]
    WHERE Inv_ID = 1
  `);
  console.log('=== InvoiceInfo (Inv_ID = 1) ===');
  console.log(invoice.recordset);

  const ip = await pool.request().query(`
    SELECT *
    FROM [dbo].[Invoice_Payment]
    WHERE InvoiceID = 1
  `);
  console.log('\n=== Invoice_Payment (InvoiceID = 1) ===');
  console.log(ip.recordset);

  const installments = await pool.request().query(`
    SELECT *
    FROM [dbo].[installment]
    WHERE InvoiceNo = '1' OR InvoiceNo = (SELECT InvoiceNo FROM [dbo].[InvoiceInfo] WHERE Inv_ID = 1)
  `);
  console.log('\n=== installments for Invoice ===');
  console.log(installments.recordset);

  const ledger = await pool.request().query(`
    SELECT *
    FROM [dbo].[LedgerBook]
    WHERE Manual_Inv = '1' OR PartyID = (SELECT CAST(CustomerID AS VARCHAR(50)) FROM [dbo].[InvoiceInfo] WHERE Inv_ID = 1)
  `);
  console.log('\n=== LedgerBook entries ===');
  console.log(ledger.recordset);

} finally {
  await pool.close();
}
