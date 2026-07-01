import sql from 'mssql';

const targetDatabase = 'AlMuttahida_New';

const config = {
  server: '127.0.0.1',
  port: 1433,
  user: 'sallam',
  password: 'ah123',
  database: 'master',
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
};

try {
  const pool = await sql.connect(config);

  const result = await pool.request().query(`
    SELECT id, amount, receipt_number, description, invoice_number
    FROM [${targetDatabase}].[dbo].[payments]
    WHERE receipt_number LIKE '%PB-0131%'
  `);

  console.log("Existing payments for PB-0131 in target database:");
  console.log(result.recordset);

  await pool.close();
} catch (err) {
  console.error("Error:", err.message);
}
