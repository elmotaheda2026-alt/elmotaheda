import React, { useEffect, useMemo, useState } from 'react';
import { CalendarRange, CheckCircle2, Clock3, Search, UserRound, Wallet, LayoutList, FileText, Printer, User, Phone, MapPin, Briefcase, Shield, AlertTriangle, Gavel } from 'lucide-react';
import { Customer, Guarantor, InstallmentSchedule, Sale, Setting, SalesRep } from '../types';
import { getCustomers, getSales, getSalesReps, syncCustomers, syncSales, syncSalesReps } from '../lib/storage';
import { useAuth } from '../context/AuthContext';
import { DatePicker } from '../components/DatePicker';
import { formatDateDisplay } from '../lib/dateUtils';
import { formatWholeCurrency } from '../lib/utils';
import { isApiMode } from '../lib/apiClient';

interface CollectionInvoiceView {
  saleId: string;
  customerId: string;
  invoiceNumber: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  saleDate: string;
  total: number;
  paid: number;
  remaining: number;
  paymentMethod: string;
  salesRepId?: string;
  salesRepName?: string;
  schedules: InstallmentSchedule[];
  guarantors: (Guarantor | null)[];
  isSued?: boolean;
  lastPaymentDate?: string;
}

interface DueCustomerRow {
  saleId: string;
  invoiceNumber: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  installmentLabel: string;
  dueDate: string;
  installmentAmount: number;
  remainingAmount: number;
  status: InstallmentSchedule['status'];
  paidAt?: string;
  guarantors: (Guarantor | null)[];
  salesRepId?: string;
  salesRepName?: string;
  isSued?: boolean;
  lastPaymentDate?: string;
}

const pad = (value: number) => String(value).padStart(2, '0');

const formatLocalDate = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const toISODateOnly = (dateStr: string | Date | null | undefined): string => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const getCurrentMonthRange = () => {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  return {
    from: formatLocalDate(firstDay),
    to: formatLocalDate(lastDay),
  };
};

export default function CollectionStatement() {
  const { settings } = useAuth();
  const currentMonthRange = useMemo(() => getCurrentMonthRange(), []);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [activeTab, setActiveTab] = useState<'due' | 'invoices' | 'legal'>('due');

  const [invoiceSearchTerm, setInvoiceSearchTerm] = useState('');
  const [dueSearchTerm, setDueSearchTerm] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState('all');
  const [showOnlyDue, setShowOnlyDue] = useState(true);
  const [hideSuedCustomers, setHideSuedCustomers] = useState(false);

  const [dueFromDate, setDueFromDate] = useState(currentMonthRange.from);
  const [dueToDate, setDueToDate] = useState(currentMonthRange.to);
  const [selectedSalesRepId, setSelectedSalesRepId] = useState('all');
  const [salesReps, setSalesReps] = useState<SalesRep[]>([]);
  const [printingInvoice, setPrintingInvoice] = useState<CollectionInvoiceView | null>(null);

  useEffect(() => {
    const loadData = async () => {
      if (isApiMode()) {
        await Promise.allSettled([syncCustomers(), syncSales(), syncSalesReps()]);
      }

      setCustomers(getCustomers());
      setSales(getSales().filter((sale) => sale.status !== 'cancelled').slice().reverse());
      setSalesReps(getSalesReps());
    };

    void loadData();

    // Reload when user comes back to this tab/page (e.g. after making a payment)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void loadData();
      }
    };

    // Reload when localStorage changes (e.g. payment saved in another tab/component)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === null || e.key?.includes('sales') || e.key?.includes('payments')) {
        void loadData();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('storage', handleStorageChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  const customerMap = useMemo(() => {
    return new Map(customers.map((customer) => [customer.id, customer]));
  }, [customers]);

  const salesRepMap = useMemo(() => {
    return new Map(salesReps.map((rep) => [rep.id, rep.name]));
  }, [salesReps]);

  const rows = useMemo<CollectionInvoiceView[]>(
    () =>
      sales.map((sale) => {
        const customer = customerMap.get(sale.customerId);
        const salesRepId = sale.financing?.salesRepId;
        const salesRepName = sale.financing?.salesRepName || (salesRepId ? salesRepMap.get(salesRepId) : undefined);

        const schedules = sale.financing?.schedules?.length
          ? sale.financing.schedules
          : [
            {
              id: `${sale.id}-single`,
              monthIndex: 1,
              label: 'دفعة واحدة',
              dueDate: toISODateOnly(sale.date),
              amount: sale.total,
              paidAmount: sale.paid,
              paidAt: sale.paid > 0 ? sale.date : undefined,
              status: (sale.remaining <= 0 ? 'paid' : sale.paid > 0 ? 'partial' : 'unpaid') as InstallmentSchedule['status'],
            },
          ];

        const customerAddress = customer?.address || '-';

        return {
          saleId: sale.id,
          customerId: sale.customerId,
          invoiceNumber: sale.invoiceNumber,
          customerName: sale.customerName,
          customerPhone: customer?.phone || '-',
          customerAddress,
          saleDate: sale.date,
          total: sale.total,
          paid: sale.paid,
          remaining: sale.remaining,
          paymentMethod: sale.financing?.paymentMethod || 'cash',
          salesRepId,
          salesRepName,
          schedules,
          guarantors: customer?.guarantors || [],
          lastPaymentDate: schedules
            .filter((s) => s.paidAt)
            .reduce((latest, s) => (!latest || s.paidAt! > latest ? s.paidAt : latest), undefined as string | undefined),
          isSued: customer?.isSued || false,
        };
      }),
    [customerMap, sales, salesRepMap],
  );

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (selectedCustomerId !== 'all' && row.customerId !== selectedCustomerId) return false;
      if (hideSuedCustomers && row.isSued) return false;

      // Filter by sales rep removed from here as per user request to keep it only for Due tab

      if (showOnlyDue && row.remaining <= 0) return false;

      const search = invoiceSearchTerm.trim().toLowerCase();
      if (!search) return true;

      return (
        row.customerName.toLowerCase().includes(search) ||
        row.invoiceNumber.toLowerCase().includes(search) ||
        row.customerPhone.includes(search) ||
        row.customerAddress.toLowerCase().includes(search)
      );
    });
  }, [rows, invoiceSearchTerm, selectedCustomerId, showOnlyDue, hideSuedCustomers]);

  const dueRows = useMemo<DueCustomerRow[]>(() => {
    if (!dueFromDate || !dueToDate || dueFromDate > dueToDate) return [];

    const result: DueCustomerRow[] = [];

    rows.forEach((row) => {
      if (hideSuedCustomers && row.isSued) return;

      row.schedules.forEach((schedule) => {
        if (schedule.status === 'paid') return;
        const normalizedDueDate = toISODateOnly(schedule.dueDate);
        if (normalizedDueDate < dueFromDate || normalizedDueDate > dueToDate) return;

        result.push({
          saleId: row.saleId,
          invoiceNumber: row.invoiceNumber,
          customerName: row.customerName,
          customerPhone: row.customerPhone,
          customerAddress: row.customerAddress,
          installmentLabel: schedule.label,
          dueDate: toISODateOnly(schedule.dueDate),
          installmentAmount: schedule.amount,
          remainingAmount: Math.max(schedule.amount - schedule.paidAmount, 0),
          status: schedule.status,
          paidAt: schedule.paidAt,
          lastPaymentDate: row.lastPaymentDate,
          guarantors: customerMap.get(row.customerId)?.guarantors || [],
          salesRepId: row.salesRepId,
          salesRepName: row.salesRepName,
          isSued: customerMap.get(row.customerId)?.isSued || false,
        });
      });
    });

    let finalResult = result.sort((a, b) => (a.dueDate > b.dueDate ? 1 : -1));
    const search = dueSearchTerm.trim().toLowerCase();
    if (search) {
      finalResult = finalResult.filter((row) =>
        row.customerName.toLowerCase().includes(search) ||
        row.invoiceNumber.toLowerCase().includes(search) ||
        row.customerPhone.includes(search) ||
        row.customerAddress.toLowerCase().includes(search) ||
        row.installmentLabel.toLowerCase().includes(search),
      );
    }

    if (selectedSalesRepId !== 'all') {
      finalResult = finalResult.filter(r => r.salesRepId === selectedSalesRepId);
    }

    return finalResult;
  }, [dueFromDate, dueToDate, dueSearchTerm, rows, selectedSalesRepId, customerMap, hideSuedCustomers]);

  const groupedDueRows = useMemo(() => {
    const groupsMap = new Map<string, DueCustomerRow[]>();
    dueRows.forEach((row) => {
      const key = row.saleId; // Group by Invoice
      if (!groupsMap.has(key)) groupsMap.set(key, []);
      groupsMap.get(key)!.push(row);
    });
    return Array.from(groupsMap.values());
  }, [dueRows]);

  const suedCustomersList = useMemo(() => {
    return customers.filter(c => c.isSued).map(c => {
      const customerInvoices = rows.filter(r => r.customerId === c.id);
      const totalDebt = customerInvoices.reduce((sum, r) => sum + r.remaining, 0);
      return {
        ...c,
        totalDebt,
        invoicesCount: customerInvoices.length
      };
    }).sort((a, b) => b.totalDebt - a.totalDebt);
  }, [customers, rows]);

  const totalDue = filteredRows.reduce((sum, row) => sum + row.remaining, 0);
  const dueInvoices = filteredRows.filter((row) => row.remaining > 0).length;
  const overdueMonths = filteredRows.reduce(
    (sum, row) => sum + row.schedules.filter((schedule) => schedule.status !== 'paid').length,
    0,
  );

  const dueTotalInPeriod = dueRows.reduce((sum, row) => sum + row.remainingAmount, 0);

  const formatCurrency = (amount: number) => formatWholeCurrency(amount, settings.currency);

  const handlePrint = (invoice: CollectionInvoiceView) => {
    setPrintingInvoice(invoice);
    setTimeout(() => window.print(), 100);
  };

  return (
    <>
      <style>{`
      @media print {
        @page {
          size: A4 portrait;
          margin: 0;
        }
        body {
          background: white !important;
          padding: 10mm !important;
          margin: 0 !important;
        }
        table {
          min-width: 0 !important;
          width: 100% !important;
          table-layout: fixed !important;
        }
        th, td {
          padding: 4px 2px !important;
          font-size: 10px !important;
          word-break: break-all !important;
        }
        .print\\:hidden {
          display: none !important;
        }
      }
    `}</style>
      <div className={`space-y-4 ${printingInvoice ? 'print:hidden' : ''}`}>
        <div className="flex justify-between items-center print:hidden border-b border-slate-100 pb-2">
          <h2 className="text-xl font-black text-slate-900">متابعة التحصيل</h2>
        </div>

        {/* TABS SECTION */}
        <div className="flex gap-2 border-b border-slate-200 pb-[1px] print:hidden">
          <button
            onClick={() => setActiveTab('due')}
            className={`flex items-center gap-2 px-5 py-3 font-semibold text-sm rounded-t-xl transition-colors ${activeTab === 'due' ? 'bg-sky-50 text-sky-700 border-b-2 border-sky-600' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700 border-b-2 border-transparent'
              }`}
          >
            <LayoutList size={18} />
            العملاء المستحقون (فترة)
          </button>
          <button
            onClick={() => setActiveTab('invoices')}
            className={`flex items-center gap-2 px-5 py-3 font-semibold text-sm rounded-t-xl transition-colors ${activeTab === 'invoices' ? 'bg-sky-50 text-sky-700 border-b-2 border-sky-600' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700 border-b-2 border-transparent'
              }`}
          >
            <FileText size={18} />
            سجل فواتير العملاء
          </button>
          <button
            onClick={() => setActiveTab('legal')}
            className={`flex items-center gap-2 px-5 py-3 font-semibold text-sm rounded-t-xl transition-colors ${activeTab === 'legal' ? 'bg-red-50 text-red-700 border-b-2 border-red-600' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700 border-b-2 border-transparent'
              }`}
          >
            <Gavel size={18} />
            الشئون القانونية (النزاعات)
          </button>
        </div>

        {/* TAB CONTENT: DUE */}
        {activeTab === 'due' && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
            {/* Filters for Due */}
            <div className="bg-white px-5 py-4 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap items-end gap-4 print:hidden">
              <label className="block flex-1 min-w-[220px]">
                <span className="mb-1 block text-xs font-bold text-slate-500">بحث</span>
                <div className="relative">
                  <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={dueSearchTerm}
                    onChange={(e) => setDueSearchTerm(e.target.value)}
                    className="input-ui pr-10 h-10 text-sm"
                    placeholder="بحث باسم العميل، رقم الفاتورة، أو الهاتف..."
                  />
                </div>
              </label>
              <label className="block flex-1 min-w-[155px]">
                <span className="mb-1 block text-xs font-bold text-slate-500">من تاريخ</span>
                <DatePicker value={dueFromDate} onChange={setDueFromDate} className="w-full rounded-2xl border-slate-300 px-4 py-2 text-sm font-bold shadow-sm" />
              </label>
              <label className="block flex-1 min-w-[155px]">
                <span className="mb-1 block text-xs font-bold text-slate-500">إلى تاريخ</span>
                <DatePicker value={dueToDate} onChange={setDueToDate} className="w-full rounded-2xl border-slate-300 px-4 py-2 text-sm font-bold shadow-sm" />
              </label>
              <label className="block flex-1 min-w-[160px]">
                <span className="mb-1 block text-xs font-bold text-slate-500">المندوب</span>
                <select
                  value={selectedSalesRepId}
                  onChange={(e) => setSelectedSalesRepId(e.target.value)}
                  className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 font-bold outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100 transition shadow-sm"
                >
                  <option value="all">كل المناديب</option>
                  {salesReps.map((rep) => (
                    <option key={rep.id} value={rep.id}>
                      {rep.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex items-center shrink-0 mb-1">
                <label className="flex items-center gap-2 cursor-pointer bg-red-50 text-red-700 px-4 py-2 rounded-xl border border-red-100 hover:bg-red-100 transition-colors shadow-sm h-10">
                  <input
                    type="checkbox"
                    checked={hideSuedCustomers}
                    onChange={(e) => setHideSuedCustomers(e.target.checked)}
                    className="h-4 w-4 rounded text-red-600 accent-red-600"
                  />
                  <span className="text-sm font-bold whitespace-nowrap">إخفاء القضايا</span>
                </label>
              </div>

              <div className="w-full lg:w-auto flex-1"></div>

              <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto shrink-0">
                <div className="flex-1 sm:flex-none bg-red-50 text-red-700 px-4 py-2 rounded-xl border border-red-100 font-bold text-sm shadow-sm flex items-center justify-center gap-2 h-10">
                  <span className="opacity-80 text-xs">المستحق:</span>
                  <span className="text-base">{formatCurrency(dueTotalInPeriod)}</span>
                </div>
                <button onClick={() => window.print()} className="flex-1 sm:flex-none h-10 px-6 bg-slate-900 text-white rounded-xl hover:bg-slate-800 flex items-center justify-center gap-2 font-bold text-sm shadow-sm transition-all whitespace-nowrap">
                  <Printer size={16} />
                  طباعة
                </button>
              </div>
            </div>

            {dueFromDate > dueToDate && (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                تاريخ البداية يجب أن يكون قبل تاريخ النهاية.
              </div>
            )}

            {/* Table */}
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
                                        <span className={`text-lg font-black print:text-xs ${group[0].isSued ? 'text-red-600 line-through' : 'text-slate-900'}`}>
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
                            <tr key={`${row.saleId}-${row.installmentLabel}-${row.dueDate}`} className="hover:bg-sky-50/30 even:bg-slate-50/50 transition-colors border-b border-slate-100 last:border-b-0">
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
            </div>
          </div>
        )}

        {/* TAB CONTENT: INVOICES */}
        {activeTab === 'invoices' && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
            {/* Toolbar for Invoices */}
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row gap-4 items-center">
              <div className="relative w-full md:w-80">
                <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={invoiceSearchTerm}
                  onChange={(e) => setInvoiceSearchTerm(e.target.value)}
                  className="input-ui pr-10 h-10 text-sm"
                  placeholder="بحث برقم الفاتورة، اسم، رقم، أو عنوان..."
                />
              </div>
              <select
                value={selectedCustomerId}
                onChange={(e) => setSelectedCustomerId(e.target.value)}
                className="w-full md:w-64 rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 font-bold outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100 transition shadow-sm"
              >
                <option value="all">كل العملاء</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </select>

              <div className="flex gap-2 w-full md:w-auto justify-center mr-auto">
                <label className="flex items-center gap-2 cursor-pointer bg-red-50 px-4 py-2 rounded-xl border border-red-100 hover:bg-red-100 transition-colors">
                  <input
                    type="checkbox"
                    checked={hideSuedCustomers}
                    onChange={(e) => setHideSuedCustomers(e.target.checked)}
                    className="h-4 w-4 rounded text-red-600 accent-red-600"
                  />
                  <span className="text-sm font-bold text-red-800 whitespace-nowrap">إخفاء القضايا</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer bg-slate-50 px-4 py-2 rounded-xl border border-slate-200 hover:bg-slate-100 transition-colors">
                  <input
                    type="checkbox"
                    checked={showOnlyDue}
                    onChange={(e) => setShowOnlyDue(e.target.checked)}
                    className="h-4 w-4 rounded text-sky-600"
                  />
                  <span className="text-sm font-bold text-slate-700 whitespace-nowrap">إظهار المتبقي فقط</span>
                </label>
              </div>
            </div>

            {/* Invoice Cards */}
            <div className="space-y-4">
              {filteredRows.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-16 text-center shadow-sm">
                  <Search size={40} className="text-slate-300 mx-auto mb-4" />
                  <p className="text-slate-500 font-medium">لا توجد نتائج مطابقة للبحث الحالي.</p>
                </div>
              ) : (
                filteredRows.map((row) => (
                  <section key={row.saleId} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex flex-col gap-4 border-b border-slate-100 pb-5 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-2">
                        <div className="flex items-center gap-3">
                          <div className={`rounded-xl p-2.5 ${row.isSued ? 'bg-red-50 text-red-600' : 'bg-sky-50 text-sky-600'}`}>
                            {row.isSued ? <Gavel size={20} /> : <UserRound size={20} />}
                          </div>
                          <div>
                            <div className="flex flex-col">
                              <h3 className={`font-bold text-2xl ${row.isSued ? 'text-red-600 line-through' : 'text-slate-900'}`}>{row.customerName}</h3>
                              {row.isSued && <span className="text-xs text-red-500 font-bold flex items-center gap-1"><AlertTriangle size={12} /> محال للقضاء يمنع التعامل</span>}
                            </div>
                            <div className="flex items-center gap-2 text-sm text-slate-500 mt-0.5">
                              <span>{row.customerPhone}</span>
                              <span className="w-1 h-1 bg-slate-300 rounded-full"></span>
                              <span>{row.customerAddress}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs pt-1">
                          <Badge>فاتورة: {row.invoiceNumber}</Badge>
                          <Badge>تاريخ: {formatDateDisplay(row.saleDate)}</Badge>
                          <Badge>{row.paymentMethod === 'installment' ? 'دفع بالتقسيط' : 'غير مقسط'}</Badge>
                        </div>
                      </div>

                      <div className="flex flex-col gap-4 items-end">
                        <button
                          onClick={() => handlePrint(row)}
                          className="flex items-center gap-2 rounded-xl bg-slate-100 px-4 py-2 text-base font-bold text-slate-700 hover:bg-slate-200 transition-colors"
                        >
                          <Printer size={16} /> طباعة الكشف
                        </button>
                        <div className="grid gap-2 sm:grid-cols-3 min-w-[320px]">
                          <SmallStat label="الإجمالي" value={formatCurrency(row.total)} />
                          <SmallStat label="المدفوع" value={formatCurrency(row.paid)} tone="green" />
                          <SmallStat
                            label="المتبقي"
                            value={formatCurrency(row.remaining)}
                            tone={row.remaining > 0 ? 'red' : 'green'}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {row.schedules.map((schedule) => (
                        <div key={schedule.id} className="rounded-xl border border-slate-100 bg-slate-50 p-4 transition-colors hover:border-sky-100 hover:bg-sky-50/30">
                          <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-200/60 pb-3">
                            <div>
                              <p className="font-bold text-slate-800">{schedule.label}</p>
                              <p className="text-xs text-slate-500 mt-1">استحقاق: <span className="font-medium text-slate-700">{formatDateDisplay(schedule.dueDate)}</span></p>
                            </div>
                            <MonthBadge status={schedule.status} />
                          </div>

                          <div className="grid gap-2.5 text-sm">
                            <MonthRow icon={<Wallet size={15} />} label="قيمة الشهر" value={formatCurrency(schedule.amount)} />
                            <MonthRow icon={<CheckCircle2 size={15} />} label="المدفوع" value={formatCurrency(schedule.paidAmount)} />
                            <MonthRow
                              icon={<Clock3 size={15} />}
                              label="المتبقي"
                              value={formatCurrency(Math.max(schedule.amount - schedule.paidAmount, 0))}
                              highlightValue={Math.max(schedule.amount - schedule.paidAmount, 0) > 0}
                            />
                            <MonthRow icon={<CalendarRange size={15} />} label="تاريخ السداد" value={formatDateDisplay(schedule.paidAt)} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                ))
              )}
            </div>
          </div>
        )}

        {/* TAB CONTENT: LEGAL */}
        {activeTab === 'legal' && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="bg-red-50 border border-red-200 p-4 rounded-2xl flex items-center justify-between print:hidden">
              <div>
                <h3 className="text-red-800 font-bold text-lg flex items-center gap-2"><Gavel size={20} /> سجل القضايا والنزاعات القانونية</h3>
                <p className="text-red-600 text-sm mt-1">هذه القائمة مخصصة للمتابعة القانونية وللمحامي، وتعرض جميع العملاء الذين تم إحالتهم للقضاء.</p>
              </div>
              <button onClick={() => window.print()} className="h-10 px-6 bg-red-700 text-white rounded-xl hover:bg-red-800 flex items-center justify-center gap-2 font-bold text-sm shadow-sm transition-all whitespace-nowrap">
                <Printer size={16} />
                طباعة كشف المحامي
              </button>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full bg-white">
                  <thead className="bg-slate-50 text-slate-700 border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-4 text-right text-base font-bold">اسم العميل</th>
                      <th className="px-4 py-4 text-right text-base font-bold">رقم الهاتف</th>
                      <th className="px-4 py-4 text-right text-base font-bold">العنوان</th>
                      <th className="px-4 py-4 text-right text-base font-bold text-center">الفواتير</th>
                      <th className="px-4 py-4 text-right text-base font-bold text-center">تاريخ الإحالة</th>
                      <th className="px-4 py-4 text-right text-base font-bold text-center">المديونية</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {suedCustomersList.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-5 py-12 text-center text-slate-500">
                          <div className="flex flex-col items-center justify-center">
                            <CheckCircle2 size={40} className="text-slate-300 mb-3" />
                            <p>لا يوجد أي عملاء في الشئون القانونية حالياً.</p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      suedCustomersList.map((customer) => (
                        <tr key={customer.id} className="hover:bg-red-50/50 transition-colors">
                          <td className="px-4 py-4">
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center text-red-600 shrink-0">
                                <Gavel size={14} />
                              </div>
                              <span className="font-bold text-slate-900">{customer.name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-4 text-sm font-medium text-slate-700">{customer.phone}</td>
                          <td className="px-4 py-4 text-sm text-slate-600 truncate max-w-[200px]">{customer.address}</td>
                          <td className="px-4 py-4 text-center">
                            <span className="bg-slate-100 text-slate-700 font-bold px-3 py-1 rounded-lg text-sm">{customer.invoicesCount}</span>
                          </td>
                          <td className="px-4 py-4 text-center">
                            {customer.suedDate ? (
                              <div className="text-sm">
                                <span className="font-bold text-slate-800">{formatDateDisplay(customer.suedDate)}</span>
                              </div>
                            ) : <span className="text-slate-400">-</span>}
                          </td>
                          <td className="px-4 py-4 text-center font-black text-red-600 text-lg">
                            {formatCurrency(customer.totalDebt)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {suedCustomersList.length > 0 && (
                <div className="bg-slate-50 border-t border-slate-200 px-6 py-4 flex items-center justify-between">
                  <div className="font-bold text-slate-600">
                    إجمالي عملاء الشئون القانونية: <span className="text-slate-900 mx-1">{suedCustomersList.length}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-slate-500">إجمالي الديون المعلقة بالنزاعات:</span>
                    <span className="text-xl font-black text-red-700">{formatCurrency(suedCustomersList.reduce((s, c) => s + c.totalDebt, 0))}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* PRINTABLE INVOICE STATEMENT */}
      {printingInvoice && (
        <PrintableView invoice={printingInvoice} settings={settings} />
      )}
    </>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone: 'red' | 'amber' | 'slate' }) {
  const toneClass = {
    red: 'bg-red-50 text-red-700 border-red-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
    slate: 'bg-slate-50 text-slate-700 border-slate-200',
  }[tone];

  return (
    <div className={`rounded-xl border px-5 py-4 shadow-sm ${toneClass}`}>
      <p className="text-sm font-medium opacity-80">{label}</p>
      <p className="mt-1 font-bold text-2xl">{value}</p>
    </div>
  );
}

function SmallStat({
  label,
  value,
  tone = 'slate',
}: {
  label: string;
  value: string;
  tone?: 'slate' | 'green' | 'red';
}) {
  const toneClass = {
    slate: 'bg-slate-50 text-slate-700 border border-slate-100',
    green: 'bg-emerald-50 text-emerald-700 border border-emerald-100',
    red: 'bg-red-50 text-red-700 border border-red-100',
  }[tone];

  return (
    <div className={`rounded-xl px-4 py-3 text-center ${toneClass}`}>
      <p className="text-sm opacity-80 font-medium mb-1">{label}</p>
      <p className="font-bold text-base">{value}</p>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="rounded-lg bg-slate-100 border border-slate-200 px-3 py-1.5 font-bold text-slate-700 shadow-sm text-xs">{children}</span>;
}

function MonthBadge({ status }: { status: InstallmentSchedule['status'] }) {
  const labels = {
    paid: 'مدفوع',
    partial: 'جزئي',
    unpaid: 'غير مدفوع',
  };

  const styles = {
    paid: 'bg-emerald-100 text-emerald-700',
    partial: 'bg-amber-100 text-amber-700',
    unpaid: 'bg-rose-100 text-rose-700',
  };

  const icons = {
    paid: <CheckCircle2 size={14} />,
    partial: <Clock3 size={14} />,
    unpaid: <AlertTriangle size={14} />,
  };

  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold ${styles[status]}`}>
      {icons[status]}
      {labels[status]}
    </span>
  );
}

function MonthRow({ icon, label, value, highlightValue }: { icon: React.ReactNode; label: string; value: string, highlightValue?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-slate-500">
        {icon}
        {label}
      </span>
      <span className={`font-bold text-base ${highlightValue ? 'text-red-600' : 'text-slate-700'}`}>{value}</span>
    </div>
  );
}

function PrintableView({ invoice, settings }: { invoice: CollectionInvoiceView, settings: Setting }) {
  const formatCurrency = (amount: number) => formatWholeCurrency(amount, settings.currency);

  const hasGuarantor = invoice.guarantors.some(g => g && g.name);

  return (
    <div className="hidden print:block bg-white text-slate-900 w-full text-right" dir="rtl">
      <style>{`
        @page {
          size: auto;
          margin: 10mm;
        }
        @media print {
          body {
            margin: 0;
            padding: 0;
            background: #fff;
          }
          .print-container {
            width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
          }
        }
      `}</style>

      <div className="print-container">
        {/* Header */}
        <div className="flex justify-between items-start border-b-2 border-slate-800 pb-4 mb-4">
          <div>
            <h1 className="text-4xl font-black text-slate-900 mb-1">{settings.companyName}</h1>
            <p className="text-slate-600 text-sm">{settings.companyAddress}</p>
            <p className="text-slate-600 font-bold text-sm">{settings.companyPhone}</p>
          </div>
          <div className="text-left">
            <h2 className="text-3xl font-bold text-slate-800 border-b border-slate-300 pb-1 mb-1 inline-block">كشف حساب عميل</h2>
            <p className="text-slate-600 font-bold text-sm">تاريخ الطباعة: {formatDateDisplay(new Date())}</p>
            <p className="text-slate-600 font-bold text-sm">رقم الفاتورة: {invoice.invoiceNumber}</p>
            {invoice.salesRepName && (
              <p className="text-sky-700 font-bold text-sm">المندوب: {invoice.salesRepName}</p>
            )}
          </div>
        </div>

        {/* Customer Info */}
        <div className="flex flex-col gap-2 mb-4">
          <div className="border border-slate-300 p-3 rounded-lg bg-slate-50">
            <h3 className="font-bold text-base mb-2 text-slate-800 border-b border-slate-200 pb-1">بيانات العميل</h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <p><span className="font-semibold text-slate-600 w-20 inline-block">اسم العميل:</span> {invoice.customerName}</p>
              <p><span className="font-semibold text-slate-600 w-20 inline-block">رقم الموبايل:</span> {invoice.customerPhone}</p>
              <p className="col-span-2"><span className="font-semibold text-slate-600 w-20 inline-block">العنوان:</span> {invoice.customerAddress}</p>
            </div>
          </div>
        </div>

        {/* Financial Summary */}
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="border-2 border-slate-800 p-2 text-center rounded-lg">
            <p className="text-slate-600 font-bold mb-1 text-sm">إجمالي الفاتورة</p>
            <p className="text-xl font-black">{formatCurrency(invoice.total)}</p>
          </div>
          <div className="border-2 border-emerald-600 p-2 text-center rounded-lg bg-emerald-50">
            <p className="text-emerald-700 font-bold mb-1 text-sm">إجمالي المدفوع</p>
            <p className="text-xl font-black text-emerald-800">{formatCurrency(invoice.paid)}</p>
          </div>
          <div className="border-2 border-red-600 p-2 text-center rounded-lg bg-red-50">
            <p className="text-red-700 font-bold mb-1 text-sm">إجمالي المتبقي</p>
            <p className="text-xl font-black text-red-800">{formatCurrency(invoice.remaining)}</p>
          </div>
        </div>

        {/* Installments Table */}
        <div className="mb-4">
          <h3 className="font-bold text-lg mb-2 text-slate-900 border-b-2 border-slate-800 pb-1 inline-block">سجل الأقساط والدفعات</h3>
          <table className="w-full text-right border-collapse border border-slate-300 text-sm">
            <thead>
              <tr className="bg-slate-200">
                <th className="border border-slate-300 px-1 py-1 font-bold">البيان</th>
                <th className="border border-slate-300 px-1 py-1 font-bold">الاستحقاق</th>
                <th className="border border-slate-300 px-1 py-1 font-bold">تاريخ الدفع</th>
                <th className="border border-slate-300 px-1 py-1 font-bold text-center">المبلغ</th>
                <th className="border border-slate-300 px-1 py-1 font-bold text-center">المدفوع</th>
                <th className="border border-slate-300 px-1 py-1 font-bold text-center">المتبقي</th>
                <th className="border border-slate-300 px-1 py-1 font-bold text-center">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {invoice.schedules.map((schedule) => {
                const remaining = Math.max(schedule.amount - schedule.paidAmount, 0);
                const statusLabel = schedule.status === 'paid' ? 'مدفوع' : schedule.status === 'partial' ? 'جزئي' : 'غير مدفوع';
                return (
                  <tr key={schedule.id} className="even:bg-slate-50">
                    <td className="border border-slate-300 px-1 py-1 font-semibold text-xs">{schedule.label}</td>
                    <td className="border border-slate-300 px-1 py-1 whitespace-nowrap text-xs">{formatDateDisplay(schedule.dueDate)}</td>
                    <td className="border border-slate-300 px-1 py-1 whitespace-nowrap text-xs">{formatDateDisplay(schedule.paidAt)}</td>
                    <td className="border border-slate-300 px-1 py-1 text-center text-xs">{formatCurrency(schedule.amount)}</td>
                    <td className="border border-slate-300 px-1 py-1 text-center text-emerald-700 font-bold text-xs">{formatCurrency(schedule.paidAmount)}</td>
                    <td className="border border-slate-300 px-1 py-1 text-center text-red-700 font-bold text-xs">{formatCurrency(remaining)}</td>
                    <td className="border border-slate-300 px-1 py-1 text-center font-bold text-xs">{statusLabel}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>


        {/* Footer */}
        <div className="mt-6 text-center text-xs text-slate-500 border-t border-slate-300 pt-2 pb-2">
          {settings.invoiceFooter && <p className="mb-1 font-bold">{settings.invoiceFooter}</p>}
          <p>تم استخراج هذا الكشف من نظام {settings.companyName} للتقسيط</p>
        </div>
      </div>
    </div>
  );
}
