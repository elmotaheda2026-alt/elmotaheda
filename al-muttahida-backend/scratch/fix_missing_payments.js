import crypto from 'node:crypto';
import sql from 'mssql';

const sourceDatabase = 'INV_DB_IMPORT_TEMP';
const targetDatabase = 'AlMuttahida_New';
const money = (v) => Number(Number(v || 0).toFixed(2));
const iso = (v) => { if (!v) return null; const d = v instanceof Date ? v : new Date(v); return Number.isNaN(d.getTime()) ? null : d.toISOString(); };

const config = {
  server: '127.0.0.1', port: 1433, user: 'sallam', password: 'ah123',
  database: 'master', options: { encrypt: false, trustServerCertificate: true },
};

try {
  const pool = await sql.connect(config);

  // Find all sales where sum(payments) != sale.paid
  const allSales = (await pool.request().query(`
    SELECT s.id, s.invoice_number, s.paid, s.customer_id, s.upfront_amount,
      COALESCE((SELECT SUM(amount) FROM [${targetDatabase}].[dbo].[payments] WHERE sale_id = s.id), 0) as payments_sum
    FROM [${targetDatabase}].[dbo].[sales] s
    WHERE s.invoice_number != 'INV-1005'
  `)).recordset;
  const mismatches = allSales.filter(s => Math.abs(money(s.paid) - money(s.payments_sum)) > 0.02);

  console.log(`Found ${mismatches.length} sales with payment mismatches.\n`);

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  let fixed = 0;

  for (const sale of mismatches) {
    const diff = money(sale.paid) - money(sale.payments_sum);
    console.log(`Fixing ${sale.invoice_number}: sale.paid=${money(sale.paid)}, sum(payments)=${money(sale.payments_sum)}, missing=${diff}`);

    // Find the source invoice
    const srcInv = (await new sql.Request(transaction)
      .input('invoiceNo', sql.NVarChar, sale.invoice_number)
      .query(`SELECT Inv_ID FROM [${sourceDatabase}].[dbo].[InvoiceInfo] WHERE RTRIM(LTRIM(InvoiceNo)) = @invoiceNo`)
    ).recordset[0];

    if (!srcInv) { console.log(`  Skipping - source not found`); continue; }

    // Find ALL downpayments from source
    const srcDownpayments = (await new sql.Request(transaction)
      .input('invoiceId', sql.Int, srcInv.Inv_ID)
      .query(`SELECT IP_ID, PaymentDate, TotalPaid, PaymentMode FROM [${sourceDatabase}].[dbo].[Invoice_Payment] WHERE InvoiceID = @invoiceId`)
    ).recordset;

    // Find which downpayments are already imported
    const existingDownpayments = (await new sql.Request(transaction)
      .input('saleId', sql.NVarChar, sale.id)
      .query(`SELECT receipt_number FROM [${targetDatabase}].[dbo].[payments] WHERE sale_id = @saleId AND description LIKE N'%مقدم%'`)
    ).recordset;
    const existingReceipts = new Set(existingDownpayments.map(r => r.receipt_number));

    for (const dp of srcDownpayments) {
      const receiptNumber = `RCPT-DOWN-${sale.invoice_number}-${dp.IP_ID}`;
      if (existingReceipts.has(receiptNumber)) {
        continue; // already imported
      }

      const paidAmount = money(dp.TotalPaid);
      if (paidAmount <= 0) continue;

      const paymentId = crypto.randomUUID();
      const paymentDate = iso(dp.PaymentDate) || new Date().toISOString();

      await new sql.Request(transaction)
        .input('id', sql.NVarChar, paymentId)
        .input('type', sql.NVarChar, 'in')
        .input('amount', sql.Decimal(18, 2), paidAmount)
        .input('saleId', sql.NVarChar, sale.id)
        .input('description', sql.NVarChar, `مقدم إضافي - فاتورة ${sale.invoice_number}`)
        .input('date', sql.NVarChar, paymentDate)
        .input('receiptNumber', sql.NVarChar, receiptNumber)
        .input('channel', sql.NVarChar, 'cash')
        .input('createdBy', sql.NVarChar, 'import')
        .input('createdAt', sql.NVarChar, paymentDate)
        .input('customerId', sql.NVarChar, sale.customer_id)
        .input('invoiceNumber', sql.NVarChar, sale.invoice_number)
        .query(`
          INSERT INTO [${targetDatabase}].[dbo].[payments] (
            id, type, amount, sale_id, description, date, receipt_number,
            status, channel, created_by, created_at, customer_id, invoice_number, affects_customer_balance
          )
          VALUES (
            @id, @type, @amount, @saleId, @description, @date, @receiptNumber,
            'posted', @channel, @createdBy, @createdAt, @customerId, @invoiceNumber, 0
          )
        `);

      console.log(`  Added missing downpayment: ${paidAmount} (receipt: ${receiptNumber})`);
      fixed++;
    }
  }

  await transaction.commit();
  console.log(`\nFixed ${fixed} missing payment records.`);
  await pool.close();
} catch (err) {
  console.error("Error:", err.message);
}
