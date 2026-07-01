import sql from 'mssql';
import crypto from 'node:crypto';

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

const clean = (value) => String(value ?? '').trim();
const money = (value) => Number(Number(value || 0).toFixed(2));

try {
  const pool = await sql.connect(config);

  console.log("Fetching Suppliers from INV_DB_IMPORT_TEMP...");
  const suppliersSrc = await pool.request().query(`SELECT * FROM [INV_DB_IMPORT_TEMP].[dbo].[Supplier]`);

  console.log("Fetching Salesmen from INV_DB_IMPORT_TEMP...");
  const salesmenSrc = await pool.request().query(`SELECT * FROM [INV_DB_IMPORT_TEMP].[dbo].[SalesMan]`);

  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  let suppliersInserted = 0;
  let suppliersSkipped = 0;
  let salesRepsInserted = 0;
  let salesRepsSkipped = 0;

  const now = new Date().toISOString();

  // Migrate Suppliers
  for (const s of suppliersSrc.recordset) {
    const id = clean(s.SupplierID) || crypto.randomUUID();
    const name = clean(s.Name);
    
    // Check if supplier already exists in target
    const existing = await new sql.Request(transaction)
      .input('id', sql.NVarChar, id)
      .query(`SELECT id FROM [AlMuttahida_New].[dbo].[suppliers] WHERE id = @id`);

    if (existing.recordset.length > 0) {
      suppliersSkipped++;
      continue;
    }

    await new sql.Request(transaction)
      .input('id', sql.NVarChar, id)
      .input('name', sql.NVarChar, name)
      .input('phone', sql.NVarChar, clean(s.ContactNo) || null)
      .input('email', sql.NVarChar, clean(s.EmailID) || null)
      .input('address', sql.NVarChar, clean(s.Address) || null)
      .input('balance', sql.Decimal(18, 2), money(s.OpeningBalance))
      .input('notes', sql.NVarChar, clean(s.Remarks) || null)
      .input('createdAt', sql.NVarChar, now)
      .input('updatedAt', sql.NVarChar, now)
      .query(`
        INSERT INTO [AlMuttahida_New].[dbo].[suppliers] (
          id, name, phone, email, address, balance, notes, created_at, updated_at
        ) VALUES (
          @id, @name, @phone, @email, @address, @balance, @notes, @createdAt, @updatedAt
        )
      `);
    suppliersInserted++;
  }

  // Migrate Sales Reps
  for (const sm of salesmenSrc.recordset) {
    const id = clean(sm.SalesMan_ID) || crypto.randomUUID();
    const name = clean(sm.Name);

    // Check if sales rep already exists in target
    const existing = await new sql.Request(transaction)
      .input('id', sql.NVarChar, id)
      .query(`SELECT id FROM [AlMuttahida_New].[dbo].[sales_reps] WHERE id = @id`);

    if (existing.recordset.length > 0) {
      salesRepsSkipped++;
      continue;
    }

    await new sql.Request(transaction)
      .input('id', sql.NVarChar, id)
      .input('name', sql.NVarChar, name)
      .input('phone', sql.NVarChar, clean(sm.ContactNo) || null)
      .input('email', sql.NVarChar, clean(sm.EmailID) || null)
      .input('address', sql.NVarChar, clean(sm.Address) || null)
      .input('area', sql.NVarChar, clean(sm.City) || null)
      .input('commission', sql.Decimal(18, 2), money(sm.CommissionPer))
      .input('createdAt', sql.NVarChar, now)
      .query(`
        INSERT INTO [AlMuttahida_New].[dbo].[sales_reps] (
          id, name, phone, email, address, area, target, achieved, commission, is_active, created_at
        ) VALUES (
          @id, @name, @phone, @email, @address, @area, 0.0, 0.0, @commission, 1, @createdAt
        )
      `);
    salesRepsInserted++;
  }

  await transaction.commit();
  console.log(`Suppliers: ${suppliersInserted} inserted, ${suppliersSkipped} skipped.`);
  console.log(`Sales Reps: ${salesRepsInserted} inserted, ${salesRepsSkipped} skipped.`);

  await pool.close();
} catch (err) {
  console.error("Migration Error:", err.message);
}
