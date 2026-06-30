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
  const sourceSales = await pool.request().query(`
    SELECT Inv_ID, InvoiceNo, CustomerID, GrandTotal FROM [INV_DB_IMPORT_TEMP].[dbo].[InvoiceInfo] ORDER BY Inv_ID
  `);

  const targetSales = await pool.request().query(`
    SELECT id, invoice_number, customer_name, total FROM [AlMuttahida_New].[dbo].[sales]
  `);

  const targetNumbers = new Set(targetSales.recordset.map(s => s.invoice_number.trim()));

  console.log('Total source sales:', sourceSales.recordset.length);
  console.log('Total target sales:', targetSales.recordset.length);

  const missing = [];
  for (const src of sourceSales.recordset) {
    const num = src.InvoiceNo.trim();
    if (!targetNumbers.has(num)) {
      missing.push(src);
    }
  }

  console.log('Missing sales in target DB:');
  console.log(missing);
} finally {
  await pool.close();
}
