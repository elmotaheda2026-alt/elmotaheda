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

  const getCols = async (db, table) => {
    const res = await pool.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE 
      FROM [${db}].INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = '${table}'
    `);
    console.log(`\nColumns in [${db}].[${table}]:`);
    res.recordset.forEach(col => {
      console.log(`  ${col.COLUMN_NAME} (${col.DATA_TYPE})`);
    });
  };

  await getCols('INV_DB_IMPORT_TEMP', 'Supplier');
  await getCols('AlMuttahida_New', 'suppliers');
  await getCols('INV_DB_IMPORT_TEMP', 'SalesMan');
  await getCols('AlMuttahida_New', 'sales_reps');

  await pool.close();
} catch (err) {
  console.error("Error:", err.message);
}
