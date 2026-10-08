const fs = require('fs');

// 1. Update src/lib/storage/operations.ts
let op = fs.readFileSync('src/lib/storage/operations.ts', 'utf8');

const oldSyncMap = `      id: r.id,
      periodType: r.period_type,
      periodDate: r.period_date,
      status: r.status,
      closedBy: r.closed_by,
      closedAt: r.closed_at,
      notes: r.notes,`;

const newSyncMap = `      id: r.id,
      periodType: r.period_type,
      periodDate: r.period_date,
      status: r.status,
      closedBy: r.closed_by,
      closedAt: r.closed_at,
      notes: r.notes,
      totalIn: r.total_in != null ? Number(r.total_in) : (r.totalIn != null ? Number(r.totalIn) : undefined),
      totalOut: r.total_out != null ? Number(r.total_out) : (r.totalOut != null ? Number(r.totalOut) : undefined),
      netMovement: r.net_movement != null ? Number(r.net_movement) : (r.netMovement != null ? Number(r.netMovement) : undefined),
      closingBalance: r.closing_balance != null ? Number(r.closing_balance) : (r.closingBalance != null ? Number(r.closingBalance) : undefined),`;

if (op.includes(oldSyncMap)) {
  op = op.replace(oldSyncMap, newSyncMap);
  fs.writeFileSync('src/lib/storage/operations.ts', op, 'utf8');
  console.log('Updated operations.ts sync mapping');
}

// 2. Update src/pages/Payments.tsx
let p = fs.readFileSync('src/pages/Payments.tsx', 'utf8');

// A. Insert calculateExpectedTreasuryBalance calculation
const targetVars = `  const closingDateYYYYMMDD = toYYYYMMDD(closingDate);
  const closingDatePayments = payments.filter((p) => toYYYYMMDD(p.date) === closingDateYYYYMMDD);
  const closingTotalIn = closingDatePayments.filter((p) => p.type === 'in').reduce((sum, p) => sum + p.amount, 0);
  const closingTotalOut = closingDatePayments.filter((p) => p.type === 'out').reduce((sum, p) => sum + p.amount, 0);
  const closingNet = closingTotalIn - closingTotalOut;`;

const newVars = `  const closingDateYYYYMMDD = toYYYYMMDD(closingDate);
  const closingDatePayments = payments.filter((p) => toYYYYMMDD(p.date) === closingDateYYYYMMDD);
  const closingTotalIn = closingDatePayments.filter((p) => p.type === 'in').reduce((sum, p) => sum + p.amount, 0);
  const closingTotalOut = closingDatePayments.filter((p) => p.type === 'out').reduce((sum, p) => sum + p.amount, 0);
  const closingNet = closingTotalIn - closingTotalOut;

  // Calculate cumulative treasury cash balance up to and including the closing date:
  // Formula: Starting Cash Balance + All Inflows up to closing date - (All Outflows + Standalone Expenses up to closing date)
  const calculateAccumulatedCashUpToDate = (targetDateStr: string) => {
    const ob = getOpeningBalances();
    const startingCash = Number(ob?.startingCashBalance || 0);

    const eligiblePayments = payments.filter(
      (pmt) => toYYYYMMDD(pmt.date) <= targetDateStr && pmt.status !== 'voided'
    );
    const inflowUpToDate = eligiblePayments
      .filter((pmt) => pmt.type === 'in')
      .reduce((sum, pmt) => sum + (Number(pmt.amount) || 0), 0);

    const paymentOutflowUpToDate = eligiblePayments
      .filter((pmt) => pmt.type === 'out')
      .reduce((sum, pmt) => sum + (Number(pmt.amount) || 0), 0);

    const standaloneExpensesUpToDate = expenses
      .filter(
        (exp) =>
          toYYYYMMDD(exp.date) <= targetDateStr &&
          !eligiblePayments.some((pmt) => pmt.referenceId === exp.id || (pmt.description && pmt.description.includes(exp.id)))
      )
      .reduce((sum, exp) => sum + (Number(exp.amount) || 0), 0);

    return startingCash + inflowUpToDate - (paymentOutflowUpToDate + standaloneExpensesUpToDate);
  };

  const expectedTreasuryClosingBalance = calculateAccumulatedCashUpToDate(closingDateYYYYMMDD);`;

if (p.includes(targetVars)) {
  p = p.replace(targetVars, newVars);
}

// B. Update handleClosePeriod to use expectedTreasuryClosingBalance
const targetHandle = `      const closingDayCashBalance = calculateTotalCashBalance(payments, expenses);
      await closePeriodApi('daily', closingDate, user?.name || 'مدير النظام', closingNotes, {
        totalIn: closingTotalIn,
        totalOut: closingTotalOut,
        netMovement: closingNet,
        closingBalance: closingDayCashBalance,
      });`;

const newHandle = `      const closingDayCashBalance = expectedTreasuryClosingBalance;
      await closePeriodApi('daily', closingDate, user?.name || 'مدير النظام', closingNotes, {
        totalIn: closingTotalIn,
        totalOut: closingTotalOut,
        netMovement: closingNet,
        closingBalance: closingDayCashBalance,
      });`;

if (p.includes(targetHandle)) {
  p = p.replace(targetHandle, newHandle);
}

// C. Update auto-close catch up
const targetAutoYesterday = `              closingBalance: calculateTotalCashBalance(payments, expenses),`;
const newAutoYesterday = `              closingBalance: calculateAccumulatedCashUpToDate(yesterdayStr),`;
p = p.replace(targetAutoYesterday, newAutoYesterday);

const targetAutoToday = `        const currentBalance = calculateTotalCashBalance(payments, expenses);
        await closePeriodApi('daily', todayDate, 'النظام التلقائي', 'إغلاق تلقائي في نهاية اليوم (11:59 م)', {
          totalIn: closingTotalIn,
          totalOut: closingTotalOut,
          netMovement: closingNet,
          closingBalance: currentBalance,
        });`;

const newAutoToday = `        const currentBalance = calculateAccumulatedCashUpToDate(toYYYYMMDD(todayDate));
        await closePeriodApi('daily', todayDate, 'النظام التلقائي', 'إغلاق تلقائي في نهاية اليوم (11:59 م)', {
          totalIn: closingTotalIn,
          totalOut: closingTotalOut,
          netMovement: closingNet,
          closingBalance: currentBalance,
        });`;
p = p.replace(targetAutoToday, newAutoToday);

// D. Update Daily Closing Modal UI summary cards: add the 4th box "إجمالي النقدية المتوقعة بالخزينة"
const targetModalCards = `                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4">
                      <p className="text-xs text-slate-500 font-bold">إجمالي الوارد (مقبوضات اليوم)</p>
                      <p className="mt-1 text-lg font-extrabold text-emerald-600">{formatCurrency(closingTotalIn)}</p>
                    </div>
                    <div className="rounded-2xl border border-rose-100 bg-rose-50/40 p-4">
                      <p className="text-xs text-slate-500 font-bold">إجمالي الصادر (مدفوعات اليوم)</p>
                      <p className="mt-1 text-lg font-extrabold text-rose-600">{formatCurrency(closingTotalOut)}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-xs text-slate-500 font-bold">صافي حركة اليوم</p>
                      <p className="mt-1 text-lg font-extrabold text-slate-800">{formatCurrency(closingNet)}</p>
                    </div>
                  </div>`;

const newModalCards = `                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
                    <div className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4">
                      <p className="text-xs text-slate-500 font-bold">إجمالي الوارد (مقبوضات اليوم)</p>
                      <p className="mt-1 text-lg font-extrabold text-emerald-600">{formatCurrency(closingTotalIn)}</p>
                    </div>
                    <div className="rounded-2xl border border-rose-100 bg-rose-50/40 p-4">
                      <p className="text-xs text-slate-500 font-bold">إجمالي الصادر (مدفوعات اليوم)</p>
                      <p className="mt-1 text-lg font-extrabold text-rose-600">{formatCurrency(closingTotalOut)}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-xs text-slate-500 font-bold">صافي حركة اليوم</p>
                      <p className="mt-1 text-lg font-extrabold text-slate-800">{formatCurrency(closingNet)}</p>
                    </div>
                    <div className="rounded-2xl border border-sky-200 bg-sky-50/50 p-4">
                      <p className="text-xs text-sky-800 font-bold">إجمالي النقدية المتوقعة بالخزينة</p>
                      <p className="mt-1 text-lg font-black text-sky-700">{formatCurrency(expectedTreasuryClosingBalance)}</p>
                    </div>
                  </div>`;

if (p.includes(targetModalCards)) {
  p = p.replace(targetModalCards, newModalCards);
}

// E. Update table fallback calculation for computedBalance in "السجلات المغلقة مؤخرًا"
const targetFallbackRow = `                            const computedBalance = period.closingBalance;`;
const newFallbackRow = `                            const computedBalance = period.closingBalance != null ? period.closingBalance : calculateAccumulatedCashUpToDate(pDate);`;
if (p.includes(targetFallbackRow)) {
  p = p.replace(targetFallbackRow, newFallbackRow);
}

fs.writeFileSync('src/pages/Payments.tsx', p, 'utf8');
console.log('Successfully updated Payments.tsx closing balance logic and UI');
