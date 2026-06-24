import { dbPromise } from '../src/db.js';

const pad = (v: number) => String(v).padStart(2, '0');

function addMonths(dateStr: string, months: number): string {
  const origDate = new Date(dateStr);
  if (isNaN(origDate.getTime())) return dateStr;

  const originalDay = origDate.getDate();
  const newDate = new Date(origDate);
  newDate.setMonth(newDate.getMonth() + months);
  const daysInTargetMonth = new Date(newDate.getFullYear(), newDate.getMonth() + 1, 0).getDate();
  newDate.setDate(Math.min(originalDay, daysInTargetMonth));
  return `${newDate.getFullYear()}-${pad(newDate.getMonth() + 1)}-${pad(newDate.getDate())}`;
}

async function fixScheduleDates() {
  const db = await dbPromise;

  // Get all installment sales with their schedules
  const sales = await db.all<{
    id: string;
    invoice_number: string;
    date: string;
    installment_months: number | null;
    installment_start_date: string | null;
  }>(`SELECT id, invoice_number, date, installment_months, installment_start_date
      FROM sales
      WHERE payment_method = 'installment'`);

  console.log(`Found ${sales.length} installment sale(s)`);
  let totalFixed = 0;

  for (const sale of sales) {
    const schedules = await db.all<{
      id: string;
      month_index: number;
      due_date: string;
    }>(`SELECT id, month_index, due_date
        FROM installment_schedules
        WHERE sale_id = ?
        ORDER BY month_index ASC`, sale.id);

    if (!schedules.length) continue;

    // Check if all due dates are the same (bug symptom) or detect bad dates
    const uniqueDates = new Set(schedules.map(s => s.due_date));
    const startDate = sale.installment_start_date || sale.date;
    const expectedFirstDate = addMonths(startDate, 1);

    let hasBug = false;

    // Bug: all due dates the same
    if (uniqueDates.size === 1 && schedules.length > 1) {
      hasBug = true;
      console.log(`[BUG - Same dates] Sale ${sale.invoice_number}: all ${schedules.length} schedules have date ${schedules[0].due_date}`);
    }

    // Bug: dates don't increment month by month (e.g., 2020 vs expected 2026)
    if (!hasBug && schedules.length > 0) {
      const expectedYear = new Date(expectedFirstDate).getFullYear();
      const actualYear = new Date(schedules[0].due_date).getFullYear();
      if (Math.abs(expectedYear - actualYear) >= 1) {
        hasBug = true;
        console.log(`[BUG - Wrong year] Sale ${sale.invoice_number}: first schedule is ${schedules[0].due_date}, expected around ${expectedFirstDate}`);
      }
    }

    if (!hasBug) {
      console.log(`[OK] Sale ${sale.invoice_number}: ${schedules.length} schedules look correct`);
      continue;
    }

    // Fix: recalculate correct due dates
    for (const schedule of schedules) {
      // month_index is 1-based; index 1 = first installment = startDate + 1 month
      const correctDueDate = addMonths(startDate, schedule.month_index);
      await db.run(
        'UPDATE installment_schedules SET due_date = ? WHERE id = ?',
        correctDueDate,
        schedule.id
      );
      console.log(`  Fixed schedule #${schedule.month_index}: ${schedule.due_date} -> ${correctDueDate}`);
      totalFixed++;
    }
  }

  console.log(`\nDone. Fixed ${totalFixed} schedule(s).`);
  process.exit(0);
}

fixScheduleDates().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
