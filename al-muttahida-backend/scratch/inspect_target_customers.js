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
  const result = await pool.request().query(`
    SELECT id, customer_number, name, balance
    FROM [dbo].[customers]
    WHERE customer_number LIKE '%C-0001%' OR customer_number LIKE '%0001%'
  `);
  console.log('Search for C-0001 in customers:');
  console.log(result.recordset);

  const count = await pool.request().query(`
    SELECT COUNT(*) as count FROM [dbo].[customers]
  `);
  console.log('Total customers:', count.recordset[0].count);
} finally {
  await pool.close();
}
