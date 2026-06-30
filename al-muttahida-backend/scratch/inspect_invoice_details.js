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
  const invoice = await pool.request().query(`
    SELECT Inv_ID, InvoiceNo, CustomerID, GrandTotal, Balance, Remarks
    FROM [dbo].[InvoiceInfo]
    WHERE Inv_ID = 1
  `);
  console.log('InvoiceInfo:', invoice.recordset[0]);

  const ip = await pool.request().query(`
    SELECT *
    FROM [dbo].[Invoice_Payment]
    WHERE InvoiceID = 1
  `);
  console.log('Invoice_Payment count:', ip.recordset.length, 'Data:', ip.recordset);

  const installments = await pool.request().query(`
    SELECT *
    FROM [dbo].[installment]
    WHERE InvoiceNo = '1'
  `);
  console.log('installments count:', installments.recordset.length, 'Sample:', installments.recordset.slice(0, 5));

  const ledger = await pool.request().query(`
    SELECT *
    FROM [dbo].[LedgerBook]
    WHERE PartyID = 'C-0001'
    ORDER BY Date
  `);
  console.log('LedgerBook count:', ledger.recordset.length);
  // print ledger group by Label
  const labels = {};
  for (const entry of ledger.recordset) {
    const lbl = String(entry.Label).trim();
    labels[lbl] = (labels[lbl] || 0) + 1;
  }
  console.log('Ledger Labels for customer C-0001:', labels);
  console.log('First 5 Ledger records:', ledger.recordset.slice(0, 5));
} finally {
  await pool.close();
}
