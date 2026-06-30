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
  const tables = await pool.request().query(`
    SELECT
      s.name AS schema_name,
      t.name AS table_name,
      SUM(p.rows) AS row_count
    FROM sys.tables t
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
    GROUP BY s.name, t.name
    ORDER BY SUM(p.rows) DESC, t.name
  `);

  console.table(tables.recordset);

  const candidates = tables.recordset
    .filter((row) => /cust|client|customer|عميل|عملاء|account|person/i.test(row.table_name))
    .slice(0, 8);

  for (const candidate of candidates) {
    const fullName = `[${candidate.schema_name}].[${candidate.table_name}]`;
    const columns = await pool.request()
      .input('schemaName', sql.NVarChar, candidate.schema_name)
      .input('tableName', sql.NVarChar, candidate.table_name)
      .query(`
        SELECT c.name, ty.name AS type_name, c.max_length, c.is_nullable
        FROM sys.columns c
        JOIN sys.types ty ON ty.user_type_id = c.user_type_id
        WHERE c.object_id = OBJECT_ID(QUOTENAME(@schemaName) + '.' + QUOTENAME(@tableName))
        ORDER BY c.column_id
      `);

    console.log(`\n${fullName}`);
    console.table(columns.recordset);

    const sample = await pool.request().query(`SELECT TOP 5 * FROM ${fullName}`);
    console.table(sample.recordset);
  }
} finally {
  await pool.close();
}
