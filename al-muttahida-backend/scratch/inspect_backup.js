import sql from 'mssql';

const backupPath = 'E:\\INV_DB 24-05-2026_11-35-40.bak';

const config = {
  server: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 1433),
  user: process.env.DB_USER || 'alm_app',
  password: process.env.DB_PASSWORD || 'Alm@2026#App',
  database: 'master',
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
};

const pool = await sql.connect(config);
try {
  const request = pool.request();
  request.input('backupPath', sql.NVarChar, backupPath);
  const result = await request.query('RESTORE FILELISTONLY FROM DISK = @backupPath');
  console.table(result.recordset.map((row) => ({
    LogicalName: row.LogicalName,
    Type: row.Type,
    PhysicalName: row.PhysicalName,
    Size: row.Size,
  })));
} finally {
  await pool.close();
}
