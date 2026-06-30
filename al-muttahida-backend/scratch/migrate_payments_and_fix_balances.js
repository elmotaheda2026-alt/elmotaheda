import crypto from 'node:crypto';
import sql from 'mssql';

const sourceDatabase = 'INV_DB_IMPORT_TEMP';
const targetDatabase = process.env.TARGET_DB || 'AlMuttahida_New';

const clean = (value) => String(value ?? '').trim();
const money = (value) => Number(Number(value || 0).toFixed(2));
const iso = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const config = {
  server: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 1433),
  user: process.env.DB_USER || 'sallam',
  password: process.env.DB_PASSWORD || 'ah123',
  database: 'master',
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
};

const pool = await sql.connect(config);
const transaction = new sql.Transaction(pool);

try {
  await transaction.begin();

  // 1. Clear existing imported payments in target database
  console.log('Clearing existing imported payments...');
  await new sql.Request(transaction).query(`
    DELETE FROM [${targetDatabase}].[dbo].[payments] WHERE created_by = 'import'
  `);

  // 2. Fetch all sales in target database
  console.log('Fetching target sales...');
  const targetSales = await new sql.Request(transaction).query(`
    SELECT id, invoice_number, customer_id, total, upfront_amount FROM [${targetDatabase}].[dbo].[sales]
  `);
  console.log(`Found ${targetSales.recordset.length} sales in target database.`);

  let salesUpdated = 0;
  let installmentPaymentsImported = 0;
  let downpaymentsImported = 0;

  for (const sale of targetSales.recordset) {
    const invoiceNumber = sale.invoice_number;

    // Fetch the corresponding source invoice from INV_DB_IMPORT_TEMP
    const sourceInvoiceResult = await new sql.Request(transaction)
      .input('invoiceNo', sql.NVarChar, invoiceNumber)
      .query(`
        SELECT Inv_ID, InvoiceNo, CustomerID, GrandTotal, Balance
        FROM [${sourceDatabase}].[dbo].[InvoiceInfo]
        WHERE RTRIM(LTRIM(InvoiceNo)) = @invoiceNo
      `);

    const sourceInvoice = sourceInvoiceResult.recordset[0];
    if (!sourceInvoice) {
      console.log(`Warning: Source invoice not found for target sale: ${invoiceNumber}`);
      continue;
    }

    // Fetch schedules in target database for this sale
    const targetSchedulesResult = await new sql.Request(transaction)
      .input('saleId', sql.NVarChar, sale.id)
      .query(`
        SELECT id, month_index, amount, paid_amount, status
        FROM [${targetDatabase}].[dbo].[installment_schedules]
        WHERE sale_id = @saleId
        ORDER BY month_index ASC
      `);

    const targetSchedules = targetSchedulesResult.recordset;

    // Fetch source installments for this invoice
    const sourceInstallmentsResult = await new sql.Request(transaction)
      .input('invoiceNo', sql.NVarChar, sourceInvoice.InvoiceNo)
      .query(`
        SELECT ins_no, InvoiceNo, date_day, CustomerID, date_ins, kima_ins, status, kima_msd, id
        FROM [${sourceDatabase}].[dbo].[installment]
        WHERE InvoiceNo = @invoiceNo
        ORDER BY id ASC
      `);

    const sourceInstallments = sourceInstallmentsResult.recordset;

    let totalInstallmentsPaid = 0;

    // Link schedules and create payment records for paid installments
    for (const schedule of targetSchedules) {
      // Find the corresponding source installment by month_index (1-based index)
      const srcIns = sourceInstallments[schedule.month_index - 1];
      if (srcIns) {
        const paidVal = money(srcIns.kima_msd);
        totalInstallmentsPaid += paidVal;

        // If the installment is paid, record it in target payments table
        if (paidVal > 0) {
          const paymentId = crypto.randomUUID();
          const paymentDate = iso(srcIns.date_day) || iso(srcIns.date_ins) || new Date().toISOString();
          const receiptNumber = `RCPT-OLD-${srcIns.ins_no}`;

          await new sql.Request(transaction)
            .input('id', sql.NVarChar, paymentId)
            .input('type', sql.NVarChar, 'in')
            .input('amount', sql.Decimal(18, 2), paidVal)
            .input('saleId', sql.NVarChar, sale.id)
            .input('installmentId', sql.NVarChar, schedule.id)
            .input('description', sql.NVarChar, `سداد قسط شهر ${schedule.month_index} - فاتورة ${invoiceNumber}`)
            .input('date', sql.NVarChar, paymentDate)
            .input('receiptNumber', sql.NVarChar, receiptNumber)
            .input('channel', sql.NVarChar, 'cash')
            .input('createdBy', sql.NVarChar, 'import')
            .input('createdAt', sql.NVarChar, paymentDate)
            .input('customerId', sql.NVarChar, sale.customer_id)
            .input('invoiceNumber', sql.NVarChar, invoiceNumber)
            .query(`
              INSERT INTO [${targetDatabase}].[dbo].[payments] (
                id, type, amount, sale_id, installment_id, description, date, receipt_number,
                status, channel, created_by, created_at, customer_id, invoice_number, affects_customer_balance
              )
              VALUES (
                @id, @type, @amount, @saleId, @installmentId, @description, @date, @receiptNumber,
                'posted', @channel, @createdBy, @createdAt, @customerId, @invoiceNumber, 0
              )
            `);
          installmentPaymentsImported++;
        }
      }
    }

    // Now handle down payments from Invoice_Payment
    const sourceDownpaymentResult = await new sql.Request(transaction)
      .input('invoiceId', sql.Int, sourceInvoice.Inv_ID)
      .query(`
        SELECT IP_ID, PaymentDate, TotalPaid, PaymentMode
        FROM [${sourceDatabase}].[dbo].[Invoice_Payment]
        WHERE InvoiceID = @invoiceId
      `);

    const sourceDownpayment = sourceDownpaymentResult.recordset[0];
    const upfrontAmount = money(sale.upfront_amount || (sourceInvoice.GrandTotal - sourceInvoice.Balance));

    if (upfrontAmount > 0) {
      const paymentId = crypto.randomUUID();
      const paymentDate = sourceDownpayment ? iso(sourceDownpayment.PaymentDate) : iso(sourceInvoice.InvoiceDate) || new Date().toISOString();
      const ipId = sourceDownpayment ? sourceDownpayment.IP_ID : `UP-${sourceInvoice.Inv_ID}`;
      const receiptNumber = `RCPT-DOWN-${invoiceNumber}-${ipId}`;

      await new sql.Request(transaction)
        .input('id', sql.NVarChar, paymentId)
        .input('type', sql.NVarChar, 'in')
        .input('amount', sql.Decimal(18, 2), upfrontAmount)
        .input('saleId', sql.NVarChar, sale.id)
        .input('description', sql.NVarChar, `مقدم القسط - فاتورة ${invoiceNumber}`)
        .input('date', sql.NVarChar, paymentDate)
        .input('receiptNumber', sql.NVarChar, receiptNumber)
        .input('channel', sql.NVarChar, 'cash')
        .input('createdBy', sql.NVarChar, 'import')
        .input('createdAt', sql.NVarChar, paymentDate)
        .input('customerId', sql.NVarChar, sale.customer_id)
        .input('invoiceNumber', sql.NVarChar, invoiceNumber)
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
      downpaymentsImported++;
    }

    // Recalculate sales paid and remaining amounts
    const correctRemaining = money(sourceInvoice.Balance - totalInstallmentsPaid);
    const correctPaid = money(sale.total - correctRemaining);

    // Update target sale
    await new sql.Request(transaction)
      .input('paid', sql.Decimal(18, 2), correctPaid)
      .input('remaining', sql.Decimal(18, 2), correctRemaining)
      .input('status', sql.NVarChar, correctRemaining <= 0 ? 'completed' : 'pending')
      .input('saleId', sql.NVarChar, sale.id)
      .query(`
        UPDATE [${targetDatabase}].[dbo].[sales]
        SET paid = @paid, remaining = @remaining, status = @status
        WHERE id = @saleId
      `);

    salesUpdated++;
  }

  // 3. Recalculate customer balances in target database
  console.log('Recalculating customer balances...');
  const targetCustomers = await new sql.Request(transaction).query(`
    SELECT id, customer_number, name FROM [${targetDatabase}].[dbo].[customers]
  `);

  let customersUpdated = 0;

  for (const customer of targetCustomers.recordset) {
    const customerNumber = customer.customer_number;

    // Get source opening balance
    const sourceCustomerResult = await new sql.Request(transaction)
      .input('customerNumber', sql.NVarChar, customerNumber)
      .query(`
        SELECT OpeningBalance FROM [${sourceDatabase}].[dbo].[Customer]
        WHERE RTRIM(LTRIM(CustomerID)) = @customerNumber
      `);
    
    const openingBalance = sourceCustomerResult.recordset[0] ? money(sourceCustomerResult.recordset[0].OpeningBalance) : 0;

    // Get sum of corrected remaining balances of all sales for this customer
    const salesRemainingResult = await new sql.Request(transaction)
      .input('customerId', sql.NVarChar, customer.id)
      .query(`
        SELECT SUM(remaining) as total_remaining
        FROM [${targetDatabase}].[dbo].[sales]
        WHERE customer_id = @customerId
      `);
    
    const salesRemaining = money(salesRemainingResult.recordset[0]?.total_remaining);

    const correctBalance = money(openingBalance + salesRemaining);

    // Update target customer
    await new sql.Request(transaction)
      .input('balance', sql.Decimal(18, 2), correctBalance)
      .input('customerId', sql.NVarChar, customer.id)
      .query(`
        UPDATE [${targetDatabase}].[dbo].[customers]
        SET balance = @balance, updated_at = GETDATE()
        WHERE id = @customerId
      `);
    
    customersUpdated++;
  }

  await transaction.commit();

  console.log('\nMigration completed successfully!');
  console.log({
    salesUpdated,
    installmentPaymentsImported,
    downpaymentsImported,
    customersUpdated,
  });

} catch (error) {
  if (transaction._aborted === false) {
    await transaction.rollback();
  }
  console.error('Error occurred:', error);
} finally {
  await pool.close();
}
