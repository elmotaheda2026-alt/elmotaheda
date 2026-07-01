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

  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  // 1. Update the existing 35000 payment's receipt_number to end with -8874
  console.log("Updating 35000 payment receipt number...");
  await new sql.Request(transaction).query(`
    UPDATE [${targetDatabase}].[dbo].[payments]
    SET receipt_number = 'RCPT-DOWN-PB-0131-8874'
    WHERE id = '4e09d002-496f-42b8-96fd-d52e0ff644b6'
  `);
  console.log("Updated successfully.");

  // 2. Insert the 3000 payment with receipt number ending with -8873
  console.log("Inserting 3000 payment...");
  const sale = (await new sql.Request(transaction).query(`
    SELECT id, customer_id FROM [${targetDatabase}].[dbo].[sales] WHERE invoice_number = 'PB-0131'
  `)).recordset[0];

  const paymentId = '32b35a96-a212-4c2c-851f-2e4526d7f0c1';
  const paymentDate = '2024-12-22T00:00:00.000Z';

  await new sql.Request(transaction)
    .input('id', sql.NVarChar, paymentId)
    .input('saleId', sql.NVarChar, sale.id)
    .input('customerId', sql.NVarChar, sale.customer_id)
    .query(`
      INSERT INTO [${targetDatabase}].[dbo].[payments] (
        id, type, amount, sale_id, description, date, receipt_number,
        status, channel, created_by, created_at, customer_id, invoice_number, affects_customer_balance
      )
      VALUES (
        @id, 'in', 3000, @saleId, N'مقدم إضافي - فاتورة PB-0131', '${paymentDate}', 'RCPT-DOWN-PB-0131-8873',
        'posted', 'cash', 'import', '${paymentDate}', @customerId, 'PB-0131', 0
      )
    `);
  console.log("Inserted 3000 payment successfully.");

  await transaction.commit();
  console.log("Transaction committed successfully.");
  await pool.close();
} catch (err) {
  console.error("Error:", err.message);
}
