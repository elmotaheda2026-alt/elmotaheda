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
  const result = await pool.request().query(`
    SELECT *
    FROM [dbo].[Customer]
    WHERE ID = 1 OR CustomerID LIKE '%C-0001%'
  `);
  console.log('Customer in source DB:');
  console.log(result.recordset);
} finally {
  await pool.close();
}
