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

  console.log("=== TABLES IN INV_DB_IMPORT_TEMP ===");
  const sourceTables = await pool.request().query(`
    SELECT t.name AS TableName, p.rows AS RowCounts
    FROM [INV_DB_IMPORT_TEMP].sys.tables t
    INNER JOIN [INV_DB_IMPORT_TEMP].sys.partitions p ON t.object_id = p.object_id
    WHERE p.index_id IN (0, 1)
    ORDER BY RowCounts DESC
  `);
  sourceTables.recordset.forEach(row => {
    console.log(`  ${row.TableName.padEnd(30)}: ${row.RowCounts} rows`);
  });

  console.log("\n=== TABLES IN AlMuttahida_New ===");
  const targetTables = await pool.request().query(`
    SELECT t.name AS TableName, p.rows AS RowCounts
    FROM [AlMuttahida_New].sys.tables t
    INNER JOIN [AlMuttahida_New].sys.partitions p ON t.object_id = p.object_id
    WHERE p.index_id IN (0, 1)
    ORDER BY RowCounts DESC
  `);
  targetTables.recordset.forEach(row => {
    console.log(`  ${row.TableName.padEnd(30)}: ${row.RowCounts} rows`);
  });

  await pool.close();
} catch (err) {
  console.error("Error:", err.message);
}
