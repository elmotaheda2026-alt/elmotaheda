import sql from 'mssql';

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
  console.log("Connected to MSSQL Server using 'sallam' successfully.");

  // Row counts in INV_DB_IMPORT_TEMP
  console.log("\n--- Source Database (INV_DB_IMPORT_TEMP) Row Counts ---");
  const sourceTables = ['Customer', 'InvoiceInfo', 'installment', 'Product', 'ledger'];
  for (const table of sourceTables) {
    try {
      const result = await pool.request().query(`SELECT COUNT(*) as count FROM [INV_DB_IMPORT_TEMP].[dbo].[${table}]`);
      console.log(`${table}: ${result.recordset[0].count}`);
    } catch (e) {
      console.log(`${table}: Error or table does not exist (${e.message})`);
    }
  }

  // Row counts in AlMuttahida_New
  console.log("\n--- Target Database (AlMuttahida_New) Row Counts ---");
  const targetTables = ['customers', 'products', 'sales', 'installment_schedules', 'payments'];
  for (const table of targetTables) {
    try {
      const result = await pool.request().query(`SELECT COUNT(*) as count FROM [AlMuttahida_New].[dbo].[${table}]`);
      console.log(`${table}: ${result.recordset[0].count}`);
    } catch (e) {
      console.log(`${table}: Error or table does not exist (${e.message})`);
    }
  }

  await pool.close();
} catch (err) {
  console.error("Database connection error:", err.message);
}
