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
  const sourceCustomers = await pool.request().query(`
    SELECT ID, CustomerID, Name FROM [INV_DB_IMPORT_TEMP].[dbo].[Customer] ORDER BY ID
  `);

  const targetCustomers = await pool.request().query(`
    SELECT id, customer_number, name FROM [AlMuttahida_New].[dbo].[customers]
  `);

  const targetNumbers = new Set(targetCustomers.recordset.map(c => c.customer_number.trim()));

  console.log('Total source customers:', sourceCustomers.recordset.length);
  console.log('Total target customers:', targetCustomers.recordset.length);

  const missing = [];
  for (const src of sourceCustomers.recordset) {
    const num = src.CustomerID.trim();
    if (!targetNumbers.has(num)) {
      missing.push(src);
    }
  }

  console.log('Missing customers in target DB:');
  console.log(missing);
} finally {
  await pool.close();
}
