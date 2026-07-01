import fs from 'fs';

const filePath = 'al-muttahida-saas/src/pages/CollectionStatement.tsx';
let content = fs.readFileSync(filePath, 'utf8');
content = content.replace(/\r\n/g, "\n");

// 1. Import ChevronDown, ChevronUp
const importTarget = "import { CalendarRange, CheckCircle2, Clock3, Search, UserRound, Wallet, LayoutList, FileText, Printer, User, Phone, MapPin, Briefcase, Shield, AlertTriangle, Gavel } from 'lucide-react';";
const importReplacement = "import { CalendarRange, CheckCircle2, Clock3, Search, UserRound, Wallet, LayoutList, FileText, Printer, User, Phone, MapPin, Briefcase, Shield, AlertTriangle, Gavel, ChevronDown, ChevronUp } from 'lucide-react';";
if (content.includes(importTarget)) {
  content = content.replace(importTarget, importReplacement);
  console.log("Updated lucide-react imports with Chevron icons.");
}

// 2. Add accordion states and pagination states
const targetStates = "  const [printingInvoice, setPrintingInvoice] = useState<CollectionInvoiceView | null>(null);";
const replacementStates = `  const [printingInvoice, setPrintingInvoice] = useState<CollectionInvoiceView | null>(null);
  
  // Collapsible cards & pagination states for "due" tab
  const [expandedCustomerSaleId, setExpandedCustomerSaleId] = useState<string | null>(null);
  const [dueCurrentPage, setDueCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 5;

  // Reset pagination and expand states when filters change
  useEffect(() => {
    setDueCurrentPage(1);
    setExpandedCustomerSaleId(null);
  }, [dueSearchTerm, dueFromDate, dueToDate, selectedSalesRepId, hideSuedCustomers]);`;

if (content.includes(targetStates)) {
  content = content.replace(targetStates, replacementStates);
  console.log("Added state variables and auto-reset effect.");
}

// 3. Compute total pages and paginated rows
const targetGroupedRows = `  const groupedDueRows = useMemo(() => {
    const groupsMap = new Map<string, DueCustomerRow[]>();
    dueRows.forEach((row) => {
      const key = row.saleId; // Group by Invoice
      if (!groupsMap.has(key)) groupsMap.set(key, []);
      groupsMap.get(key)!.push(row);
    });
    return Array.from(groupsMap.values());
  }, [dueRows]);`;

const replacementGroupedRows = `  const groupedDueRows = useMemo(() => {
    const groupsMap = new Map<string, DueCustomerRow[]>();
    dueRows.forEach((row) => {
      const key = row.saleId; // Group by Invoice
      if (!groupsMap.has(key)) groupsMap.set(key, []);
      groupsMap.get(key)!.push(row);
    });
    return Array.from(groupsMap.values());
  }, [dueRows]);

  const totalDuePages = Math.ceil(groupedDueRows.length / ITEMS_PER_PAGE);

  const paginatedGroupedDueRows = useMemo(() => {
    const startIndex = (dueCurrentPage - 1) * ITEMS_PER_PAGE;
    return groupedDueRows.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [groupedDueRows, dueCurrentPage]);`;

if (content.includes(targetGroupedRows)) {
  content = content.replace(targetGroupedRows, replacementGroupedRows);
  console.log("Added pagination page slicing math.");
}

// 4. Replace list UI with accordion cards and pagination controls
const targetTable = `            {/* Table */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full bg-white">
                  <thead className="bg-slate-50 text-slate-700 border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-3 text-right text-sm font-bold">القسط</th>
                      <th className="px-4 py-3 text-right text-sm font-bold">تاريخ الاستحقاق</th>
                      <th className="px-4 py-3 text-right text-sm font-bold text-center">قيمة القسط</th>
                      <th className="px-4 py-3 text-right text-sm font-bold text-center">المتبقي</th>
                      <th className="px-4 py-3 text-right text-sm font-bold text-center">الحالة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {groupedDueRows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-5 py-12 text-center text-slate-500">
                          <div className="flex flex-col items-center justify-center">
                            <CheckCircle2 size={40} className="text-slate-300 mb-3" />
                            <p>لا توجد أقساط مستحقة حالياً.</p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      groupedDueRows.map((group, gIdx) => (
                        <React.Fragment key={group[0].saleId}>
                          {/* Group Header for Customer Info - Professional, Tighter & More Compact UI */}
                          <tr className="bg-slate-50/80 border-t-2 border-slate-200">
                            <td colSpan={6} className="px-4 py-2.5 print:py-1">
                              <div className="flex flex-col gap-1.5 print:gap-0.5">
                                {/* Row 1: Name, Phone, Rep, Address (Right) & Badges (Left) */}
                                <div className="flex items-center justify-between gap-4 flex-wrap">
                                  <div className="flex items-center gap-4 flex-wrap print:gap-2">
                                    <div className="flex items-center gap-1.5">
                                      {group[0].isSued ? (
                                        <Gavel size={18} className="text-red-600 print:w-3.5 print:h-3.5" />
                                      ) : (
                                        <User size={18} className="text-sky-600 print:w-3.5 print:h-3.5" />
                                      )}
                                      <div className="flex flex-col">
                                        <span className={\`text-lg font-black print:text-xs \${group[0].isSued ? 'text-red-600 line-through' : 'text-slate-900'}\`}>
                                          {group[0].customerName}
                                        </span>
                                        {group[0].isSued && (
                                          <span className="text-[10px] text-red-500 font-bold flex items-center gap-0.5 print:text-[7px]">
                                            <AlertTriangle size={8} /> محال للقضاء يمنع التعامل
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-1.5 text-slate-600 border-r border-slate-200 pr-4 print:pr-2 print:gap-1">
                                      <Phone size={14} className="print:w-3 print:h-3 text-slate-400" />
                                      <span className="text-sm font-bold text-slate-700 print:text-[10px]">{group[0].customerPhone}</span>
                                    </div>
                                    <div className="flex items-center gap-1.5 text-sky-600 border-r border-slate-200 pr-4 print:pr-2 print:gap-1">
                                      <Briefcase size={14} className="print:w-3 print:h-3 text-sky-400" />
                                      <span className="text-sm font-bold text-sky-700 print:text-[10px]">{group[0].salesRepName || '---'}</span>
                                    </div>
                                    <div className="flex items-center gap-1.5 text-slate-500 border-r border-slate-200 pr-4 print:pr-2 print:gap-1">
                                      <MapPin size={14} className="print:w-3 print:h-3 text-slate-400" />
                                      <span className="text-sm font-medium text-slate-600 truncate max-w-[280px] print:hidden">{group[0].customerAddress}</span>
                                      <span className="hidden print:inline text-slate-600 font-medium print:text-[9px] print:whitespace-normal">{group[0].customerAddress}</span>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-2 flex-wrap print:gap-1">
                                    <div className="flex items-center gap-1.5 font-bold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded text-sm print:bg-emerald-50/50 print:px-1.5 print:text-[9px] print:gap-0.5">
                                      <Clock3 size={14} className="print:w-3 print:h-3" />
                                      <span>أخر سداد: {group[0].lastPaymentDate ? formatDateDisplay(group[0].lastPaymentDate) : '---'}</span>
                                    </div>
                                    <div className="flex items-center gap-1.5 bg-red-50 px-2.5 py-1 rounded border border-red-100 shadow-sm text-sm font-bold print:px-1.5 print:text-[9px] print:gap-0.5">
                                      <Wallet size={14} className="text-red-500 print:w-3 print:h-3" />
                                      <span className="text-red-400">إجمالي المستحق:</span>
                                      <span className="text-red-700 font-black">
                                        {formatCurrency(group.reduce((sum, r) => sum + r.remainingAmount, 0))}
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                {/* Row 2: Guarantors (Only if exists) */}
                                {group[0].guarantors.some((g) => g && g.name) && (
                                  <div className="flex items-center gap-1.5 text-sm text-slate-500 pr-5 border-t border-dashed border-slate-100 pt-1.5 mt-1.5 print:mt-1 print:pt-1 print:pr-2">
                                    <Shield size={14} className="text-amber-500 shrink-0 print:w-3 print:h-3" />
                                    <span className="font-bold text-slate-500 print:text-[10px]">الضامنين:</span>
                                    <div className="flex items-center gap-3 flex-wrap print:gap-1.5">
                                      {group[0].guarantors
                                        .filter((g) => g && g.name)
                                        .map((g, idx, arr) => (
                                          <span key={idx} className="text-slate-700 font-semibold print:text-[9px]">
                                            {g!.name} ({g!.phone}){idx < arr.length - 1 ? '، ' : ''}
                                          </span>
                                        ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                          {group.map((row, rIdx) => (
                            <tr key={\`\${row.saleId}-\${row.installmentLabel}-\${row.dueDate}\`} className="hover:bg-sky-50/30 even:bg-slate-50/50 transition-colors border-b border-slate-100 last:border-b-0">
                              <td className="px-4 py-3 text-sm text-slate-700 font-medium">{row.installmentLabel}</td>
                              <td className="px-4 py-3 text-sm text-slate-700">{formatDateDisplay(row.dueDate)}</td>
                              <td className="px-4 py-3 text-sm text-slate-700 text-center">{formatCurrency(row.installmentAmount)}</td>
                              <td className="px-4 py-3 text-sm font-bold text-red-600 text-center">{formatCurrency(row.remainingAmount)}</td>
                              <td className="px-4 py-3 text-center">
                                <MonthBadge status={row.status} />
                              </td>
                            </tr>
                          ))}
                        </React.Fragment>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Improved Table Footer */}
              <div className="bg-slate-50 border-t border-slate-200 px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-black text-slate-900">{dueRows.length}</span>
                    <span className="text-sm font-bold text-slate-500">أقساط مستحقة</span>
                  </div>
                  <div className="w-px h-6 bg-slate-200"></div>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-black text-slate-900">{groupedDueRows.length}</span>
                    <span className="text-sm font-bold text-slate-500">عملاء مستحقين</span>
                  </div>
                </div>

                <div className="flex items-center gap-4 bg-white px-5 py-2.5 rounded-2xl border border-slate-200 shadow-sm">
                  <div className="text-left">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">إجمالي مبالغ الأقساط</div>
                    <div className="text-xl font-black text-red-600">{formatCurrency(dueTotalInPeriod)}</div>
                  </div>
                  <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center text-red-500">
                    <Wallet size={20} />
                  </div>
                </div>
              </div>
            </div>`;

const replacementTable = `{/* Accordion Cards Layout */}
            <div className="space-y-4 print:space-y-6">
              {groupedDueRows.length === 0 ? (
                <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center text-slate-500 shadow-sm">
                  <div className="flex flex-col items-center justify-center">
                    <CheckCircle2 size={40} className="text-slate-300 mb-3" />
                    <p className="font-bold">لا توجد أقساط مستحقة حالياً.</p>
                  </div>
                </div>
              ) : (
                // Use paginatedGroupedDueRows on screen, but print all rows for full reports
                (window.matchMedia && window.matchMedia('print').matches ? groupedDueRows : paginatedGroupedDueRows).map((group, gIdx) => {
                  const isExpanded = expandedCustomerSaleId === group[0].saleId;
                  const totalRemaining = group.reduce((sum, r) => sum + r.remainingAmount, 0);

                  return (
                    <div
                      key={group[0].saleId}
                      className="bg-white rounded-[24px] border border-slate-200/80 shadow-sm hover:shadow-md hover:border-sky-100 transition-all duration-300 overflow-hidden"
                    >
                      {/* CARD HEADER (Clickable to Expand) */}
                      <div
                        onClick={() => setExpandedCustomerSaleId(isExpanded ? null : group[0].saleId)}
                        className="p-5 flex items-center justify-between gap-4 flex-wrap cursor-pointer hover:bg-slate-50/50 transition-colors select-none print:bg-slate-50/30"
                      >
                        <div className="flex items-center gap-4 flex-wrap print:gap-2">
                          <div className="flex items-center gap-2">
                            <div className={\`w-10 h-10 rounded-full flex items-center justify-center \${group[0].isSued ? 'bg-red-50 text-red-600' : 'bg-sky-50 text-sky-600'}\`}>
                              {group[0].isSued ? <Gavel size={20} /> : <User size={20} />}
                            </div>
                            <div className="flex flex-col">
                              <span className={\`text-lg font-black print:text-sm \${group[0].isSued ? 'text-red-600 line-through' : 'text-slate-900'}\`}>
                                {group[0].customerName}
                              </span>
                              {group[0].isSued && (
                                <span className="text-[10px] text-red-500 font-bold flex items-center gap-0.5 print:text-[8px]">
                                  <AlertTriangle size={10} /> محال للقضاء يمنع التعامل
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 text-slate-600 border-r border-slate-100 pr-4 print:pr-2">
                            <Phone size={14} className="text-slate-400" />
                            <span className="text-sm font-bold text-slate-700 print:text-[10px]">{group[0].customerPhone}</span>
                          </div>

                          <div className="flex items-center gap-1.5 text-sky-600 border-r border-slate-100 pr-4 print:pr-2">
                            <Briefcase size={14} className="text-sky-400" />
                            <span className="text-sm font-bold text-sky-700 print:text-[10px]">{group[0].salesRepName || '---'}</span>
                          </div>

                          <div className="flex items-center gap-1.5 text-slate-500 border-r border-slate-100 pr-4 print:pr-2">
                            <MapPin size={14} className="text-slate-400" />
                            <span className="text-sm font-medium text-slate-600 truncate max-w-[200px] print:max-w-none">{group[0].customerAddress}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 print:gap-1.5">
                          <div className="flex items-center gap-1.5 font-bold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-xl text-xs print:px-1.5 print:text-[9px]">
                            <Clock3 size={14} />
                            <span>أخر سداد: {group[0].lastPaymentDate ? formatDateDisplay(group[0].lastPaymentDate) : '---'}</span>
                          </div>
                          <div className="flex items-center gap-1.5 bg-red-50 px-3 py-1.5 rounded-xl border border-red-100 text-xs font-bold print:px-1.5 print:text-[9px]">
                            <Wallet size={14} className="text-red-500" />
                            <span className="text-red-500">المستحق:</span>
                            <span className="text-red-700 font-black">{formatCurrency(totalRemaining)}</span>
                          </div>
                          <div className="text-slate-400 hover:text-slate-700 w-8 h-8 rounded-full flex items-center justify-center hover:bg-slate-100 transition-colors print:hidden">
                            {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                          </div>
                        </div>
                      </div>

                      {/* COLLAPSIBLE BODY */}
                      <div className={\`\${isExpanded ? 'block' : 'hidden print:block'} border-t border-slate-100 bg-slate-50/30 p-5 space-y-4\`}>
                        {/* Guarantors Section */}
                        {group[0].guarantors.some((g) => g && g.name) && (
                          <div className="flex items-center gap-2 text-sm text-slate-500 bg-white p-3.5 rounded-2xl border border-slate-100 shadow-2sm">
                            <Shield size={16} className="text-amber-500 shrink-0" />
                            <span className="font-bold text-slate-500 print:text-[10px]">الضامنين:</span>
                            <div className="flex items-center gap-3 flex-wrap">
                              {group[0].guarantors
                                .filter((g) => g && g.name)
                                .map((g, idx, arr) => (
                                  <span key={idx} className="text-slate-700 font-semibold print:text-[10px]">
                                    {g!.name} ({g!.phone}){idx < arr.length - 1 ? '، ' : ''}
                                  </span>
                                ))}
                            </div>
                          </div>
                        )}

                        {/* Installments Table */}
                        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
                          <table className="w-full text-right text-sm">
                            <thead className="bg-slate-50 text-slate-700 border-b border-slate-200">
                              <tr>
                                <th className="px-4 py-3 text-right font-bold text-xs uppercase tracking-wider">القسط</th>
                                <th className="px-4 py-3 text-right font-bold text-xs uppercase tracking-wider">تاريخ الاستحقاق</th>
                                <th className="px-4 py-3 text-center font-bold text-xs uppercase tracking-wider">قيمة القسط</th>
                                <th className="px-4 py-3 text-center font-bold text-xs uppercase tracking-wider">المتبقي</th>
                                <th className="px-4 py-3 text-center font-bold text-xs uppercase tracking-wider">الحالة</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {group.map((row) => (
                                <tr key={\`\${row.saleId}-\${row.installmentLabel}-\${row.dueDate}\`} className="hover:bg-slate-50/50 transition-colors">
                                  <td className="px-4 py-3 font-semibold text-slate-800">{row.installmentLabel}</td>
                                  <td className="px-4 py-3 text-slate-600">{formatDateDisplay(row.dueDate)}</td>
                                  <td className="px-4 py-3 text-slate-600 text-center">{formatCurrency(row.installmentAmount)}</td>
                                  <td className="px-4 py-3 font-bold text-red-600 text-center">{formatCurrency(row.remainingAmount)}</td>
                                  <td className="px-4 py-3 text-center">
                                    <MonthBadge status={row.status} />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Pagination Controls */}
            {totalDuePages > 1 && (
              <div className="flex items-center justify-between border-t border-slate-200 bg-white px-6 py-4 rounded-2xl print:hidden">
                <div className="flex flex-1 justify-between sm:hidden">
                  <button
                    disabled={dueCurrentPage === 1}
                    onClick={() => {
                      setDueCurrentPage(prev => Math.max(prev - 1, 1));
                      setExpandedCustomerSaleId(null);
                    }}
                    className="relative inline-flex items-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    السابق
                  </button>
                  <button
                    disabled={dueCurrentPage === totalDuePages}
                    onClick={() => {
                      setDueCurrentPage(prev => Math.min(prev + 1, totalDuePages));
                      setExpandedCustomerSaleId(null);
                    }}
                    className="relative ml-3 inline-flex items-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    التالي
                  </button>
                </div>
                <div className="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm text-slate-500 font-bold">
                      عرض <span className="text-slate-900">{Math.min(groupedDueRows.length, (dueCurrentPage - 1) * ITEMS_PER_PAGE + 1)}</span> إلى{' '}
                      <span className="text-slate-900">{Math.min(groupedDueRows.length, dueCurrentPage * ITEMS_PER_PAGE)}</span> من أصل{' '}
                      <span className="text-slate-900">{groupedDueRows.length}</span> عميل مستحق
                    </p>
                  </div>
                  <div>
                    <nav className="isolate inline-flex -space-x-px rounded-xl shadow-sm gap-1" aria-label="Pagination">
                      <button
                        disabled={dueCurrentPage === 1}
                        onClick={() => {
                          setDueCurrentPage(prev => Math.max(prev - 1, 1));
                          setExpandedCustomerSaleId(null);
                        }}
                        className="relative inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-400 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-bold"
                      >
                        السابق
                      </button>
                      {Array.from({ length: totalDuePages }).map((_, idx) => {
                        const pageNum = idx + 1;
                        return (
                          <button
                            key={pageNum}
                            onClick={() => {
                              setDueCurrentPage(pageNum);
                              setExpandedCustomerSaleId(null);
                            }}
                            className={\`relative inline-flex items-center rounded-xl px-3 py-1.5 text-xs font-bold focus:z-20 transition-all \${
                              dueCurrentPage === pageNum
                                ? 'bg-sky-600 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 shadow-sm'
                                : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                            }\`}
                          >
                            {pageNum}
                          </button>
                        );
                      })}
                      <button
                        disabled={dueCurrentPage === totalDuePages}
                        onClick={() => {
                          setDueCurrentPage(prev => Math.min(prev + 1, totalDuePages));
                          setExpandedCustomerSaleId(null);
                        }}
                        className="relative inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-400 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-bold"
                      >
                        التالي
                      </button>
                    </nav>
                  </div>
                </div>
              </div>
            )}

            {/* Quick Metrics Footer */}
            <div className="bg-slate-50 border border-slate-200 px-6 py-5 rounded-2xl flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-6 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-black text-slate-900">{dueRows.length}</span>
                  <span className="text-sm font-bold text-slate-500">أقساط مستحقة</span>
                </div>
                <div className="w-px h-6 bg-slate-200 hidden sm:block"></div>
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-black text-slate-900">{groupedDueRows.length}</span>
                  <span className="text-sm font-bold text-slate-500">عملاء مستحقين</span>
                </div>
              </div>

              <div className="flex items-center gap-4 bg-white px-5 py-2.5 rounded-2xl border border-slate-200 shadow-sm">
                <div className="text-left">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">إجمالي مبالغ الأقساط</div>
                  <div className="text-xl font-black text-red-600">{formatCurrency(dueTotalInPeriod)}</div>
                </div>
                <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center text-red-500">
                  <Wallet size={20} />
                </div>
              </div>
            </div>`;

if (content.includes(targetTable)) {
  content = content.replace(targetTable, replacementTable);
  console.log("Replaced table with collapsible accordion cards and pagination controls.");
} else {
  console.log("Could NOT find the target table markup block in CollectionStatement.tsx");
}

fs.writeFileSync(filePath, content, 'utf8');
console.log("File saved successfully.");
