import fs from 'fs';

const filePath = 'al-muttahida-saas/src/pages/CollectionStatement.tsx';
let content = fs.readFileSync(filePath, 'utf8');
content = content.replace(/\r\n/g, "\n");

// 1. Locate and modify the accordion container start to hide on print
const targetDivStart = `{/* Accordion Cards Layout */}
            <div className="space-y-4 print:space-y-6">`;

const replacementDivStart = `{/* Accordion Cards Layout */}
            <div className="space-y-4 print:hidden">`;

if (content.includes(targetDivStart)) {
  content = content.replace(targetDivStart, replacementDivStart);
  console.log("Updated accordion cards wrapper to be print:hidden.");
}

// 2. Change the JS mapping back to simple paginatedGroupedDueRows (since printing is now handled by the separate classic table)
const targetMap = `(window.matchMedia && window.matchMedia('print').matches ? groupedDueRows : paginatedGroupedDueRows).map((group, gIdx) => {`;
const replacementMap = `paginatedGroupedDueRows.map((group, gIdx) => {`;

if (content.includes(targetMap)) {
  content = content.replace(targetMap, replacementMap);
  console.log("Simplified accordion mapping to use paginatedGroupedDueRows.");
}

// 3. Add the classic print table right after the print:hidden container ends
const targetEndOfCards = `                })
              )}
            </div>`;

const printTable = `                })
              )}
            </div>

            {/* Print-Only Classic Table Layout (Exactly matches the old format) */}
            <div className="hidden print:block bg-white rounded-2xl border border-slate-200 overflow-hidden w-full">
              <table className="w-full bg-white text-right text-sm">
                <thead className="bg-slate-50 text-slate-700 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-2 text-right text-xs font-bold">القسط</th>
                    <th className="px-4 py-2 text-right text-xs font-bold">تاريخ الاستحقاق</th>
                    <th className="px-4 py-2 text-center text-xs font-bold">قيمة القسط</th>
                    <th className="px-4 py-2 text-center text-xs font-bold">المتبقي</th>
                    <th className="px-4 py-2 text-center text-xs font-bold">الحالة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {groupedDueRows.map((group, gIdx) => (
                    <React.Fragment key={group[0].saleId}>
                      {/* Group Header for Customer Info */}
                      <tr className="bg-slate-50/80 border-t-2 border-slate-200">
                        <td colSpan={5} className="px-4 py-2">
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center justify-between gap-4 flex-wrap">
                              <div className="flex items-center gap-3 flex-wrap">
                                <span className={\`font-black text-sm \${group[0].isSued ? 'text-red-600 line-through' : 'text-slate-900'}\`}>
                                  {group[0].customerName}
                                </span>
                                <span className="text-xs text-slate-700 font-bold">هاتف: {group[0].customerPhone}</span>
                                <span className="text-xs text-sky-700 font-bold">مندوب: {group[0].salesRepName || '---'}</span>
                                <span className="text-xs text-slate-600 font-medium">عنوان: {group[0].customerAddress}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded">أخر سداد: {group[0].lastPaymentDate ? formatDateDisplay(group[0].lastPaymentDate) : '---'}</span>
                                <span className="text-xs text-red-700 font-bold bg-red-50 px-2 py-0.5 rounded">المستحق: {formatCurrency(group.reduce((sum, r) => sum + r.remainingAmount, 0))}</span>
                              </div>
                            </div>
                            {group[0].guarantors.some((g) => g && g.name) && (
                              <div className="text-[11px] text-slate-500 border-t border-dashed border-slate-200 pt-1 mt-1">
                                <span className="font-bold text-slate-600">الضامنين: </span>
                                {group[0].guarantors
                                  .filter((g) => g && g.name)
                                  .map((g, idx, arr) => \`\${g!.name} (\${g!.phone})\${idx < arr.length - 1 ? '، ' : ''}\`)}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                      {/* Installment Rows */}
                      {group.map((row) => (
                        <tr key={\`\${row.saleId}-\${row.installmentLabel}-\${row.dueDate}\`} className="border-b border-slate-100 last:border-b-0">
                          <td className="px-4 py-2 text-xs font-semibold text-slate-800">{row.installmentLabel}</td>
                          <td className="px-4 py-2 text-xs text-slate-600">{formatDateDisplay(row.dueDate)}</td>
                          <td className="px-4 py-2 text-xs text-slate-600 text-center">{formatCurrency(row.installmentAmount)}</td>
                          <td className="px-4 py-2 text-xs font-bold text-red-600 text-center">{formatCurrency(row.remainingAmount)}</td>
                          <td className="px-4 py-2 text-center text-xs">
                            <span className={\`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold \${
                              row.status === 'paid' ? 'bg-emerald-50 text-emerald-700' :
                              row.status === 'partial' ? 'bg-amber-50 text-amber-700' :
                              'bg-red-50 text-red-700'
                            }\`}>
                              {row.status === 'paid' ? 'مدفوع' : row.status === 'partial' ? 'جزئي' : 'غير مدفوع'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>`;

if (content.includes(targetEndOfCards)) {
  content = content.replace(targetEndOfCards, printTable);
  console.log("Added print-only classic table layout report.");
}

fs.writeFileSync(filePath, content, 'utf8');
console.log("Changes applied successfully.");
