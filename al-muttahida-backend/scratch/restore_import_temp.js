import sql from 'mssql';

const backupPath = 'E:\\INV_DB 24-05-2026_11-35-40.bak';
const databaseName = 'INV_DB_IMPORT_TEMP';

const config = {
  server: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 1433),
  user: process.env.DB_USER || 'sallam',
  password: process.env.DB_PASSWORD || 'ah123',
  database: 'master',
  options: {
    encrypt: false,
    trustServerCertificate: true,
    requestTimeout: 120000,
  },
  requestTimeout: 120000,
};

const pool = await sql.connect(config);
try {
  const existing = await pool.request()
    .input('databaseName', sql.NVarChar, databaseName)
    .query('SELECT name FROM sys.databases WHERE name = @databaseName');

  if (existing.recordset.length > 0) {
    console.log(`${databaseName} already exists`);
    process.exit(0);
  }

  const restoreSql = `
    RESTORE DATABASE [${databaseName}]
    FROM DISK = N'${backupPath.replace(/'/g, "''")}'
    WITH
      MOVE N'INV_DB' TO N'C:\\tmp\\INV_DB_IMPORT_TEMP.mdf',
      MOVE N'INV_DB_log' TO N'C:\\tmp\\INV_DB_IMPORT_TEMP_log.ldf',
      RECOVERY,
      STATS = 10
  `;

  await pool.request().query(restoreSql);
  console.log(`${databaseName} restored`);
} finally {
  await pool.close();
}
