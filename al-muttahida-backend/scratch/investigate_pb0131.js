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

  // Investigate PB-0131
  console.log("=== PB-0131 Investigation ===\n");

  const targetSale = (await pool.request().query(`
    SELECT * FROM [${targetDatabase}].[dbo].[sales] WHERE invoice_number = 'PB-0131'
  `)).recordset[0];
  console.log("Target Sale:", { total: money(targetSale.total), paid: money(targetSale.paid), remaining: money(targetSale.remaining), upfront: money(targetSale.upfront_amount) });

  const sourceInvoice = (await pool.request().query(`
    SELECT * FROM [${sourceDatabase}].[dbo].[InvoiceInfo] WHERE RTRIM(LTRIM(InvoiceNo)) = 'PB-0131'
  `)).recordset[0];
  console.log("Source Invoice:", { GrandTotal: money(sourceInvoice.GrandTotal), Balance: money(sourceInvoice.Balance), paid: money(sourceInvoice.GrandTotal - sourceInvoice.Balance) });

  // Source installments
  const srcInstallments = (await pool.request().query(`
    SELECT id, ins_no, kima_ins, kima_msd, status, date_ins
    FROM [${sourceDatabase}].[dbo].[installment]
    WHERE InvoiceNo = 'PB-0131'
    ORDER BY id
  `)).recordset;
  console.log(`\nSource Installments (${srcInstallments.length}):`);
  let totalInstPaid = 0;
  for (const ins of srcInstallments) {
    const paid = money(ins.kima_msd);
    totalInstPaid += paid;
    if (paid > 0) console.log(`  #${ins.ins_no}: amount=${money(ins.kima_ins)}, paid=${paid}, status=${ins.status}`);
  }
  console.log(`Total Installments Paid: ${totalInstPaid}`);

  // Source downpayment
  const srcDownpayment = (await pool.request().query(`
    SELECT * FROM [${sourceDatabase}].[dbo].[Invoice_Payment]
    WHERE InvoiceID = ${sourceInvoice.Inv_ID}
  `)).recordset;
  console.log(`\nSource Downpayments (${srcDownpayment.length}):`);
  for (const dp of srcDownpayment) {
    console.log(`  ID=${dp.IP_ID}, TotalPaid=${money(dp.TotalPaid)}, Date=${dp.PaymentDate}`);
  }

  // Target payments
  const targetPayments = (await pool.request().query(`
    SELECT id, amount, description, date
    FROM [${targetDatabase}].[dbo].[payments]
    WHERE sale_id = '${targetSale.id}'
    ORDER BY date
  `)).recordset;
  console.log(`\nTarget Payments (${targetPayments.length}):`);
  let totalTargetPayments = 0;
  for (const p of targetPayments) {
    totalTargetPayments += money(p.amount);
    console.log(`  ${money(p.amount)} - ${p.description}`);
  }
  console.log(`Total Target Payments: ${totalTargetPayments}`);
  console.log(`Sale.paid: ${money(targetSale.paid)}`);
  console.log(`Difference: ${money(targetSale.paid) - totalTargetPayments}`);

  // The upfront amount calculation
  const upfrontCalc = money(sourceInvoice.GrandTotal - sourceInvoice.Balance);
  console.log(`\nUpfront calc: GrandTotal(${money(sourceInvoice.GrandTotal)}) - Balance(${money(sourceInvoice.Balance)}) = ${upfrontCalc}`);
  console.log(`sale.upfront_amount: ${money(targetSale.upfront_amount)}`);

  await pool.close();
} catch (err) {
  console.error("Error:", err.message);
}
