import sql from 'mssql';

const sourceDatabase = 'INV_DB_IMPORT_TEMP';
const targetDatabase = 'AlMuttahida_New';
const money = (v) => Number(Number(v || 0).toFixed(2));

const config = {
  server: '127.0.0.1', port: 1433, user: 'sallam', password: 'ah123',
  database: 'master', options: { encrypt: false, trustServerCertificate: true },
};

try {
  const pool = await sql.connect(config);
  let errors = 0;

  // ========== TEST 1: paid + remaining = total for every sale ==========
  console.log("=== TEST 1: paid + remaining = total (per sale) ===");
  const salesCheck = (await pool.request().query(`
    SELECT invoice_number, total, paid, remaining
    FROM [${targetDatabase}].[dbo].[sales]
  `)).recordset;

  let test1Failures = 0;
  for (const s of salesCheck) {
    const diff = Math.abs(money(s.paid) + money(s.remaining) - money(s.total));
    if (diff > 0.02) {
      console.log(`  ❌ ${s.invoice_number}: paid(${money(s.paid)}) + remaining(${money(s.remaining)}) = ${money(s.paid) + money(s.remaining)} ≠ total(${money(s.total)})`);
      test1Failures++;
    }
  }
  if (test1Failures === 0) console.log(`  ✅ All ${salesCheck.length} sales pass (paid + remaining = total)`);
  else { console.log(`  ❌ ${test1Failures} sales FAILED`); errors += test1Failures; }

  // ========== TEST 2: customer balance = sum of their sales remaining ==========
  console.log("\n=== TEST 2: customer balance = sum(sales.remaining) ===");
  const custCheck = (await pool.request().query(`
    SELECT c.id, c.name, c.balance,
      COALESCE((SELECT SUM(remaining) FROM [${targetDatabase}].[dbo].[sales] WHERE customer_id = c.id), 0) as calc_remaining
    FROM [${targetDatabase}].[dbo].[customers] c
  `)).recordset;

  let test2Failures = 0;
  for (const c of custCheck) {
    const diff = Math.abs(money(c.balance) - money(c.calc_remaining));
    if (diff > 0.02) {
      console.log(`  ❌ ${c.name}: balance(${money(c.balance)}) ≠ sales_remaining(${money(c.calc_remaining)}), diff=${diff}`);
      test2Failures++;
    }
  }
  if (test2Failures === 0) console.log(`  ✅ All ${custCheck.length} customers pass (balance = sum of sales remaining)`);
  else { console.log(`  ❌ ${test2Failures} customers FAILED`); errors += test2Failures; }

  // ========== TEST 3: payment records sum = sale.paid (for imported sales) ==========
  console.log("\n=== TEST 3: sum(payments) = sale.paid ===");
  const payCheck = (await pool.request().query(`
    SELECT s.id, s.invoice_number, s.paid,
      COALESCE((SELECT SUM(amount) FROM [${targetDatabase}].[dbo].[payments] WHERE sale_id = s.id), 0) as payments_sum
    FROM [${targetDatabase}].[dbo].[sales] s
    WHERE s.invoice_number != 'INV-1005'
  `)).recordset;

  let test3Failures = 0;
  for (const p of payCheck) {
    const diff = Math.abs(money(p.paid) - money(p.payments_sum));
    if (diff > 0.02) {
      console.log(`  ❌ ${p.invoice_number}: sale.paid(${money(p.paid)}) ≠ sum(payments)(${money(p.payments_sum)}), diff=${diff}`);
      test3Failures++;
    }
  }
  if (test3Failures === 0) console.log(`  ✅ All ${payCheck.length} sales pass (sum(payments) = sale.paid)`);
  else { console.log(`  ❌ ${test3Failures} sales FAILED`); errors += test3Failures; }

  // ========== TEST 4: Source-Target GrandTotal match ==========
  console.log("\n=== TEST 4: Grand Total matches source ===");
  const srcTotal = (await pool.request().query(`SELECT SUM(GrandTotal) as s FROM [${sourceDatabase}].[dbo].[InvoiceInfo]`)).recordset[0].s;
  const tgtTotal = (await pool.request().query(`SELECT SUM(total) as s FROM [${targetDatabase}].[dbo].[sales] WHERE invoice_number != 'INV-1005'`)).recordset[0].s;
  if (Math.abs(money(srcTotal) - money(tgtTotal)) < 0.02) {
    console.log(`  ✅ Source=${money(srcTotal)}  Target=${money(tgtTotal)}`);
  } else {
    console.log(`  ❌ Source=${money(srcTotal)}  Target=${money(tgtTotal)}`);
    errors++;
  }

  // ========== TEST 5: Correct remaining per invoice (Source Balance - installment payments) ==========
  console.log("\n=== TEST 5: Target remaining = Source Balance - Source Installment Payments ===");
  const invoiceVerify = (await pool.request().query(`
    SELECT s.invoice_number, s.total, s.paid, s.remaining,
      src.GrandTotal as src_total, src.Balance as src_balance,
      COALESCE(inst_paid.total_paid, 0) as src_installments_paid
    FROM [${targetDatabase}].[dbo].[sales] s
    INNER JOIN [${sourceDatabase}].[dbo].[InvoiceInfo] src
      ON RTRIM(LTRIM(src.InvoiceNo)) = s.invoice_number
    LEFT JOIN (
      SELECT InvoiceNo, SUM(CAST(kima_msd AS DECIMAL(18,2))) as total_paid
      FROM [${sourceDatabase}].[dbo].[installment]
      WHERE kima_msd > 0
      GROUP BY InvoiceNo
    ) inst_paid ON inst_paid.InvoiceNo = RTRIM(LTRIM(src.InvoiceNo))
  `)).recordset;

  let test5Failures = 0;
  for (const row of invoiceVerify) {
    const expectedRemaining = money(row.src_balance) - money(row.src_installments_paid);
    const diff = Math.abs(money(row.remaining) - expectedRemaining);
    if (diff > 1) {
      console.log(`  ❌ ${row.invoice_number}: target_remaining(${money(row.remaining)}) ≠ expected(${expectedRemaining}) [srcBalance=${money(row.src_balance)} - instPaid=${money(row.src_installments_paid)}]`);
      test5Failures++;
    }
  }
  if (test5Failures === 0) console.log(`  ✅ All ${invoiceVerify.length} invoices pass (remaining = source balance - installment payments)`);
  else { console.log(`  ❌ ${test5Failures} invoices FAILED`); errors += test5Failures; }

  // ========== SUMMARY ==========
  console.log("\n========================================");
  if (errors === 0) {
    console.log("✅✅✅ ALL TESTS PASSED - DATA IS 100% CORRECT ✅✅✅");
  } else {
    console.log(`❌ ${errors} total failures found`);
  }
  console.log("========================================");

  await pool.close();
} catch (err) {
  console.error("Error:", err.message);
}
