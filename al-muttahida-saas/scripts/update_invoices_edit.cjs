const fs = require('fs');

let c = fs.readFileSync('src/pages/Invoices.tsx', 'utf8');

// Find editingSale object
const editingSaleDef = `  const editingSale = useMemo(() => {
    if (!editingSaleId) return null;
    return sales.find((s) => s.id === editingSaleId) || null;
  }, [editingSaleId, sales]);`;

// Insert editingSale after const filteredModalContracts
const targetAfter = 'const filteredModalContracts = useMemo(() => sales.slice(0, 10), [sales]);';
if (!c.includes('const editingSale = useMemo')) {
  c = c.replace(targetAfter, targetAfter + '\r\n\r\n' + editingSaleDef);
}

// In the JSX, after draftItems table Panel (and before procurementRows Panel / or inside the edit mode), 
// if editingSale && editingSale.financing?.paymentMethod === 'installment', render the installments schedule table with "ترحيل القسط" button for each unpaid/pending installment!
const editingSchedulePanel = `
          {/* Active Contract Installment Schedule in Edit Mode */}
          {editingSale && editingSale.financing?.paymentMethod === 'installment' && (editingSale.financing?.schedules?.length ?? 0) > 0 && (
            <Panel title="جدول أقساط التعاقد وإدارتها" icon={<CalendarCheck size={18} className="text-violet-600" />}>
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs font-bold text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <span>إجمالي الأقساط: {(editingSale.financing?.schedules ?? []).length}</span>
                  <span>المدفوع: {formatCurrency(editingSale.paid)}</span>
                  <span>المتبقي: <span className="text-rose-600 font-extrabold">{formatCurrency(editingSale.remaining)}</span></span>
                </div>

                <div className="overflow-hidden rounded-xl border border-slate-200">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-700 border-b border-slate-200">
                      <tr>
                        <th className="py-2.5 px-3 text-right font-bold">القسط</th>
                        <th className="py-2.5 px-3 text-right font-bold">تاريخ الاستحقاق</th>
                        <th className="py-2.5 px-3 text-right font-bold">المبلغ</th>
                        <th className="py-2.5 px-3 text-right font-bold">المسدد</th>
                        <th className="py-2.5 px-3 text-right font-bold">المتبقي</th>
                        <th className="py-2.5 px-3 text-center font-bold">الحالة</th>
                        <th className="py-2.5 px-3 text-center font-bold">الإجراء</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {(editingSale.financing?.schedules ?? []).map((sch) => {
                        const isPaid = sch.status === 'paid' || sch.status === 'settled_early';
                        const rem = Math.max(sch.amount - sch.paidAmount, 0);

                        return (
                          <tr key={sch.id} className="hover:bg-slate-50/70">
                            <td className="py-2.5 px-3 font-bold text-slate-800">{sch.label}</td>
                            <td className="py-2.5 px-3 text-slate-600 font-medium">{formatDateDisplay(sch.dueDate)}</td>
                            <td className="py-2.5 px-3 font-bold text-slate-800">{formatCurrency(sch.amount)}</td>
                            <td className="py-2.5 px-3 font-semibold text-emerald-600">{formatCurrency(sch.paidAmount)}</td>
                            <td className="py-2.5 px-3 font-bold text-rose-600">{formatCurrency(rem)}</td>
                            <td className="py-2.5 px-3 text-center">
                              <span className={\`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold \${
                                sch.status === 'paid' ? 'bg-emerald-100 text-emerald-700'
                                : sch.status === 'settled_early' ? 'bg-sky-100 text-sky-700'
                                : sch.status === 'partial' ? 'bg-amber-100 text-amber-700'
                                : 'bg-slate-100 text-slate-700'
                              }\`}>
                                {sch.status === 'paid' ? 'مدفوع' : sch.status === 'settled_early' ? 'تكييش' : sch.status === 'partial' ? 'جزئي' : 'معلق'}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              {canDelete && !isPaid ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setDeferModalSale(editingSale);
                                    setDeferInstallmentId(sch.id);
                                    setDeferNewDueDate(addMonths(sch.dueDate, 1));
                                    setDeferPenaltyFee(0);
                                    setDeferStrategy('shift_subsequent');
                                    setDeferPenaltyPaymentType('add_to_debt');
                                    setDeferMessage(null);
                                  }}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-[11px] font-bold transition-all shadow-xs"
                                >
                                  <CalendarCheck size={12} />
                                  ترحيل القسط
                                </button>
                              ) : (
                                <span className="text-slate-400 text-[10px]">-</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </Panel>
          )}
`;

// Insert this panel right before `{procurementRows.length > 0 && (` or right after the draft items table
const markerDraftTable = '</Panel>\r\n\r\n          {procurementRows.length > 0 && (';
const markerDraftTableLF = '</Panel>\n\n          {procurementRows.length > 0 && (';

if (c.includes(markerDraftTable)) {
  c = c.replace(markerDraftTable, '</Panel>\r\n' + editingSchedulePanel + '\r\n          {procurementRows.length > 0 && (');
} else if (c.includes(markerDraftTableLF)) {
  c = c.replace(markerDraftTableLF, '</Panel>\n' + editingSchedulePanel + '\n          {procurementRows.length > 0 && (');
} else {
  console.log('Marker not found, searching alternative insertion point');
  const altMarker = '{procurementRows.length > 0 && (';
  const idx = c.indexOf(altMarker);
  if (idx !== -1) {
    c = c.substring(0, idx) + editingSchedulePanel + '\r\n          ' + c.substring(idx);
  }
}

fs.writeFileSync('src/pages/Invoices.tsx', c, 'utf8');
console.log('Successfully updated Invoices.tsx with installment schedule and deferral in Edit mode');
