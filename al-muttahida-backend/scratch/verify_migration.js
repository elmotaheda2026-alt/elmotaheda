import sql from 'mssql';

const sourceDatabase = 'INV_DB_IMPORT_TEMP';
const targetDatabase = 'AlMuttahida_New';

const config = {
  server: '127.0.0.1',
  port: 1433,
  user: 'sallam',
  password: 'ah123',
  database: 'master',
  options: { encrypt: false, trustServerCertificate: true },
};

const money = (v) => Number(Number(v || 0).toFixed(2));

try {
  const pool = await sql.connect(config);
  console.log("=== COMPREHENSIVE DATA VERIFICATION ===\n");

  // 1. Row counts comparison
  console.log("--- 1. Row Counts Comparison ---");
  const srcCustomers = (await pool.request().query(`SELECT COUNT(*) as c FROM [${sourceDatabase}].[dbo].[Customer]`)).recordset[0].c;
  const tgtCustomers = (await pool.request().query(`SELECT COUNT(*) as c FROM [${targetDatabase}].[dbo].[customers]`)).recordset[0].c;
  console.log(`Customers:    Source=${srcCustomers}  Target=${tgtCustomers}  ${srcCustomers === tgtCustomers ? '✅' : '❌'}`);

  const srcProducts = (await pool.request().query(`SELECT COUNT(*) as c FROM [${sourceDatabase}].[dbo].[Product]`)).recordset[0].c;
  const tgtProducts = (await pool.request().query(`SELECT COUNT(*) as c FROM [${targetDatabase}].[dbo].[products]`)).recordset[0].c;
  console.log(`Products:     Source=${srcProducts}  Target=${tgtProducts}  ${tgtProducts >= srcProducts ? '✅' : '❌'}`);

  const srcSales = (await pool.request().query(`SELECT COUNT(*) as c FROM [${sourceDatabase}].[dbo].[InvoiceInfo]`)).recordset[0].c;
  const tgtSales = (await pool.request().query(`SELECT COUNT(*) as c FROM [${targetDatabase}].[dbo].[sales]`)).recordset[0].c;
  console.log(`Sales:        Source=${srcSales}  Target=${tgtSales}  ${tgtSales >= srcSales ? '✅' : '❌'}`);

  const srcInstallments = (await pool.request().query(`SELECT COUNT(*) as c FROM [${sourceDatabase}].[dbo].[installment]`)).recordset[0].c;
  const tgtSchedules = (await pool.request().query(`SELECT COUNT(*) as c FROM [${targetDatabase}].[dbo].[installment_schedules]`)).recordset[0].c;
  console.log(`Installments: Source=${srcInstallments}  Target=${tgtSchedules}  ${tgtSchedules >= srcInstallments ? '✅' : '❌'}`);

  const tgtPayments = (await pool.request().query(`SELECT COUNT(*) as c FROM [${targetDatabase}].[dbo].[payments]`)).recordset[0].c;
  console.log(`Payments:     Target=${tgtPayments}`);

  // 2. Financial totals comparison
  console.log("\n--- 2. Financial Totals Comparison ---");
  const srcTotalGrand = (await pool.request().query(`SELECT SUM(GrandTotal) as s FROM [${sourceDatabase}].[dbo].[InvoiceInfo]`)).recordset[0].s;
  const tgtTotalGrand = (await pool.request().query(`SELECT SUM(total) as s FROM [${targetDatabase}].[dbo].[sales] WHERE invoice_number != 'INV-1005'`)).recordset[0].s;
  console.log(`Grand Total:  Source=${money(srcTotalGrand)}  Target=${money(tgtTotalGrand)}  ${Math.abs(money(srcTotalGrand) - money(tgtTotalGrand)) < 1 ? '✅' : '❌ DIFF=' + (money(tgtTotalGrand) - money(srcTotalGrand))}`);

  const srcTotalBalance = (await pool.request().query(`SELECT SUM(Balance) as s FROM [${sourceDatabase}].[dbo].[InvoiceInfo]`)).recordset[0].s;
  const tgtTotalRemaining = (await pool.request().query(`SELECT SUM(remaining) as s FROM [${targetDatabase}].[dbo].[sales] WHERE invoice_number != 'INV-1005'`)).recordset[0].s;
  console.log(`Remaining:    Source=${money(srcTotalBalance)}  Target=${money(tgtTotalRemaining)}  ${Math.abs(money(srcTotalBalance) - money(tgtTotalRemaining)) < 1 ? '✅' : '❌ DIFF=' + (money(tgtTotalRemaining) - money(srcTotalBalance))}`);

  const srcTotalPaid = money(srcTotalGrand) - money(srcTotalBalance);
  const tgtTotalPaid = (await pool.request().query(`SELECT SUM(paid) as s FROM [${targetDatabase}].[dbo].[sales] WHERE invoice_number != 'INV-1005'`)).recordset[0].s;
  console.log(`Total Paid:   Source=${money(srcTotalPaid)}  Target=${money(tgtTotalPaid)}  ${Math.abs(money(srcTotalPaid) - money(tgtTotalPaid)) < 1 ? '✅' : '❌ DIFF=' + (money(tgtTotalPaid) - money(srcTotalPaid))}`);

  // 3. Per-invoice spot check (sample 5 invoices)
  console.log("\n--- 3. Per-Invoice Spot Check (Sample) ---");
  const sampleSales = (await pool.request().query(`
    SELECT TOP 10 s.invoice_number, s.total, s.paid, s.remaining,
      src.GrandTotal as src_total, src.Balance as src_balance
    FROM [${targetDatabase}].[dbo].[sales] s
    INNER JOIN [${sourceDatabase}].[dbo].[InvoiceInfo] src 
      ON RTRIM(LTRIM(src.InvoiceNo)) = s.invoice_number
    ORDER BY s.total DESC
  `)).recordset;

  for (const row of sampleSales) {
    const srcPaid = money(row.src_total) - money(row.src_balance);
    const match = Math.abs(money(row.total) - money(row.src_total)) < 0.01 &&
                  Math.abs(money(row.remaining) - money(row.src_balance)) < 1;
    console.log(`  ${row.invoice_number}: Total=${money(row.total)} vs ${money(row.src_total)} | Remaining=${money(row.remaining)} vs ${money(row.src_balance)} | Paid=${money(row.paid)} vs ${srcPaid}  ${match ? '✅' : '❌'}`);
  }

  // 4. Payment totals per invoice
  console.log("\n--- 4. Payment Records Summary ---");
  const paymentSummary = (await pool.request().query(`
    SELECT 
      COUNT(*) as total_payments,
      SUM(CASE WHEN description LIKE '%مقدم%' THEN 1 ELSE 0 END) as downpayments,
      SUM(CASE WHEN description LIKE '%قسط%' THEN 1 ELSE 0 END) as installment_payments,
      SUM(amount) as total_amount
    FROM [${targetDatabase}].[dbo].[payments]
  `)).recordset[0];
  console.log(`  Total Payments: ${paymentSummary.total_payments}`);
  console.log(`  Down Payments: ${paymentSummary.downpayments}`);
  console.log(`  Installment Payments: ${paymentSummary.installment_payments}`);
  console.log(`  Total Amount: ${money(paymentSummary.total_amount)}`);

  // 5. Customer balance check
  console.log("\n--- 5. Customer Balance Check (Top 10) ---");
  const customerBalances = (await pool.request().query(`
    SELECT TOP 10 c.name, c.balance, c.balance_type,
      (SELECT SUM(remaining) FROM [${targetDatabase}].[dbo].[sales] WHERE customer_id = c.id) as calculated_remaining
    FROM [${targetDatabase}].[dbo].[customers] c
    ORDER BY c.balance DESC
  `)).recordset;

  for (const row of customerBalances) {
    const calcRemaining = money(row.calculated_remaining);
    const balance = money(row.balance);
    console.log(`  ${row.name}: Balance=${balance} (${row.balance_type}) | SalesRemaining=${calcRemaining}  ${Math.abs(balance - calcRemaining) < 1 ? '✅' : '⚠️'}`);
  }

  console.log("\n=== VERIFICATION COMPLETE ===");
  await pool.close();
} catch (err) {
  console.error("Error:", err.message);
}
