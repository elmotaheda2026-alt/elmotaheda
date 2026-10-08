const fs = require('fs');

let c = fs.readFileSync('src/pages/Payments.tsx', 'utf8');

// 1. Update handleClosePeriod to pass totals
const targetHandle = `    try {
      await closePeriodApi('daily', closingDate, user?.name || 'مدير النظام', closingNotes);
      await loadData();`;

const replHandle = `    try {
      const closingDayCashBalance = calculateTotalCashBalance(payments, expenses);
      await closePeriodApi('daily', closingDate, user?.name || 'مدير النظام', closingNotes, {
        totalIn: closingTotalIn,
        totalOut: closingTotalOut,
        netMovement: closingNet,
        closingBalance: closingDayCashBalance,
      });
      await loadData();`;

if (c.includes(targetHandle)) {
  c = c.replace(targetHandle, replHandle);
}

// 2. Update auto-closing timer to close previous days automatically if missing on startup and set up timer
const targetAutoClose = `    // Automatic daily closing at midnight
  useEffect(() => {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const msUntilMidnight = tomorrow.getTime() - now.getTime();

    const timerId = setTimeout(async () => {
      try {
        const todayDate = today();
        await closePeriodApi('daily', todayDate, user?.name || 'مدير النظام', 'إغلاق تلقائي');
        await loadData();
        setMessage({ type: 'success', text: 'تم إغلاق اليومية تلقائيًا عند انتهاء اليوم.' });
      } catch (err: any) {
        console.error('Auto close failed:', err);
        setMessage({ type: 'error', text: err.message || 'خطأ في إغلاق اليومية تلقائيًا.' });
      }
    }, msUntilMidnight);

    return () => clearTimeout(timerId);
  }, [user]);`;

const replAutoClose = `    // Automatic daily closing (at 23:59 / midnight, and check for unclosed previous day on startup)
  useEffect(() => {
    const checkAndAutoClose = async () => {
      try {
        const todayStr = today();
        // Check if yesterday or previous days had unclosed transactions
        const existingPeriods = getClosingPeriods();
        const yDate = new Date();
        yDate.setDate(yDate.getDate() - 1);
        const yesterdayStr = toYYYYMMDD(yDate.toISOString());

        // Check if yesterday is not closed yet
        const isYesterdayClosed = existingPeriods.some(p => p.periodType === 'daily' && p.periodDate === yesterdayStr && p.status === 'closed');
        if (!isYesterdayClosed && yesterdayStr) {
          // Check if there were any payments on yesterday
          const yesterdayPayments = payments.filter(p => toYYYYMMDD(p.date) === yesterdayStr);
          if (yesterdayPayments.length > 0) {
            const yIn = yesterdayPayments.filter(p => p.type === 'in').reduce((sum, p) => sum + p.amount, 0);
            const yOut = yesterdayPayments.filter(p => p.type === 'out').reduce((sum, p) => sum + p.amount, 0);
            await closePeriodApi('daily', yesterdayStr, 'النظام التلقائي', 'إغلاق تلقائي عند بدء اليوم الجديد', {
              totalIn: yIn,
              totalOut: yOut,
              netMovement: yIn - yOut,
              closingBalance: calculateTotalCashBalance(payments, expenses),
            });
            await loadData();
          }
        }
      } catch (e) {
        console.warn('Startup auto-close check skipped:', e);
      }
    };

    void checkAndAutoClose();

    // Schedule closing at 23:59:00 PM or midnight
    const now = new Date();
    const tonight = new Date(now);
    tonight.setHours(23, 59, 0, 0);
    let msUntilClose = tonight.getTime() - now.getTime();
    if (msUntilClose <= 0) {
      // If past 23:59, set for next day 23:59
      tonight.setDate(tonight.getDate() + 1);
      msUntilClose = tonight.getTime() - now.getTime();
    }

    const timerId = setTimeout(async () => {
      try {
        const todayDate = today();
        const currentBalance = calculateTotalCashBalance(payments, expenses);
        await closePeriodApi('daily', todayDate, 'النظام التلقائي', 'إغلاق تلقائي في نهاية اليوم (11:59 م)', {
          totalIn: closingTotalIn,
          totalOut: closingTotalOut,
          netMovement: closingNet,
          closingBalance: currentBalance,
        });
        await loadData();
        setMessage({ type: 'success', text: 'تم إغلاق اليومية تلقائيًا (11:59 م).' });
      } catch (err: any) {
        console.error('Auto close failed:', err);
      }
    }, msUntilClose);

    return () => clearTimeout(timerId);
  }, [user, payments, expenses, closingTotalIn, closingTotalOut, closingNet]);`;

if (c.includes(targetAutoClose)) {
  c = c.replace(targetAutoClose, replAutoClose);
}

// 3. Upgrade table columns in closed records modal
const targetTableHead = `<thead className="sticky top-0 bg-slate-50 text-slate-600">
                          <tr>
                            <th className="px-4 py-3 text-right font-bold">التاريخ</th>
                            <th className="px-4 py-3 text-right font-bold">بواسطة</th>
                            <th className="px-4 py-3 text-right font-bold">تاريخ الإغلاق</th>
                            <th className="px-4 py-3 text-right font-bold">الملاحظات</th>
                          </tr>
                        </thead>`;

const replTableHead = `<thead className="sticky top-0 bg-slate-50 text-slate-700 text-xs">
                          <tr>
                            <th className="px-3 py-2.5 text-right font-bold">التاريخ</th>
                            <th className="px-3 py-2.5 text-center font-bold text-emerald-700">إجمالي الوارد</th>
                            <th className="px-3 py-2.5 text-center font-bold text-rose-700">إجمالي المنصرف</th>
                            <th className="px-3 py-2.5 text-center font-bold text-slate-800">صافي اليومية</th>
                            <th className="px-3 py-2.5 text-center font-bold text-sky-800">رصيد الإغلاق</th>
                            <th className="px-3 py-2.5 text-right font-bold">بواسطة</th>
                            <th className="px-3 py-2.5 text-right font-bold">الملاحظات</th>
                          </tr>
                        </thead>`;

const targetTableBody = `<tbody className="divide-y divide-slate-100 text-slate-700">
                          {filteredClosedPeriods.slice(0, 20).map((period) => (
                            <tr key={period.id} className="hover:bg-slate-50/50">
                              <td className="px-4 py-3 font-semibold text-slate-800">{formatDateDisplay(period.periodDate)}</td>
                              <td className="px-4 py-3">{period.closedBy}</td>
                              <td className="px-4 py-3 text-xs text-slate-500">{formatDateDisplay(period.closedAt.slice(0, 10))}</td>
                              <td className="px-4 py-3 text-xs text-slate-500">{period.notes || '-'}</td>
                            </tr>
                          ))}
                        </tbody>`;

const replTableBody = `<tbody className="divide-y divide-slate-100 text-slate-700 text-xs">
                          {filteredClosedPeriods.slice(0, 30).map((period) => {
                            // Compute dynamic fallback if period record did not save stored totals
                            const pDate = toYYYYMMDD(period.periodDate);
                            const dayPayments = payments.filter(p => toYYYYMMDD(p.date) === pDate && p.status !== 'voided');
                            const computedIn = period.totalIn ?? dayPayments.filter(p => p.type === 'in').reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
                            const computedOut = period.totalOut ?? dayPayments.filter(p => p.type === 'out').reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
                            const computedNet = period.netMovement ?? (computedIn - computedOut);
                            const computedBalance = period.closingBalance;

                            return (
                              <tr key={period.id} className="hover:bg-slate-50/50 transition-colors">
                                <td className="px-3 py-2.5 font-bold text-slate-900 whitespace-nowrap">{formatDateDisplay(period.periodDate)}</td>
                                <td className="px-3 py-2.5 text-center font-bold text-emerald-600 font-mono">{formatCurrency(computedIn)}</td>
                                <td className="px-3 py-2.5 text-center font-bold text-rose-600 font-mono">{formatCurrency(computedOut)}</td>
                                <td className="px-3 py-2.5 text-center font-black font-mono text-slate-800">{formatCurrency(computedNet)}</td>
                                <td className="px-3 py-2.5 text-center font-extrabold font-mono text-sky-700">
                                  {computedBalance !== undefined ? formatCurrency(computedBalance) : '-'}
                                </td>
                                <td className="px-3 py-2.5 text-slate-600 font-medium whitespace-nowrap">{period.closedBy || 'مدير النظام'}</td>
                                <td className="px-3 py-2.5 text-xs text-slate-500 max-w-[180px] truncate">{period.notes || '-'}</td>
                              </tr>
                            );
                          })}
                        </tbody>`;

if (c.includes(targetTableHead)) {
  c = c.replace(targetTableHead, replTableHead);
}

if (c.includes(targetTableBody)) {
  c = c.replace(targetTableBody, replTableBody);
}

fs.writeFileSync('src/pages/Payments.tsx', c, 'utf8');
console.log('Payments.tsx updated successfully');
