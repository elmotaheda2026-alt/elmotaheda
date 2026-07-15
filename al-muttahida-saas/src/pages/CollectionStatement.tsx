import React, { useEffect, useMemo, useState } from 'react';
import { CalendarRange, CheckCircle2, Clock3, Search, UserRound, Wallet, LayoutList, FileText, Printer, User, Phone, MapPin, Briefcase, Shield, AlertTriangle, Gavel, ChevronDown, ChevronUp } from 'lucide-react';
import { Customer, Guarantor, InstallmentSchedule, Sale, Setting, SalesRep } from '../types';
import { getCustomers, getSales, getSalesReps } from '../lib/storage';
import { useAuth } from '../context/AuthContext';
import { DatePicker } from '../components/DatePicker';
import { formatDateDisplay } from '../lib/dateUtils';
import { formatWholeCurrency } from '../lib/utils';
import { api, isApiMode } from '../lib/apiClient';

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

const normalizeArabic = (str: string): string => {
  if (!str) return '';
  return str
    .replace(/[أإآا]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[ىي]/g, 'ي')
    .trim()
    .toLowerCase();
};

export default function CollectionStatement() {
  const { settings } = useAuth();
  const currentMonthRange = useMemo(() => getCurrentMonthRange(), []);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [invoiceSales, setInvoiceSales] = useState<Sale[]>([]);
  const [isInvoiceLoading, setIsInvoiceLoading] = useState(false);
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
  // Collapsible cards & pagination states for "due" tab
  const [expandedCustomerSaleId, setExpandedCustomerSaleId] = useState<string | null>(null);
  const [dueCurrentPage, setDueCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(6);

  useEffect(() => {
    const calculatePageSize = () => {
      const calculatedRows = Math.max(3, Math.floor((window.innerHeight - 280) / 60));
      setPageSize(calculatedRows);
    };

    calculatePageSize();
    window.addEventListener('resize', calculatePageSize);
    return () => window.removeEventListener('resize', calculatePageSize);
  }, []);

  // Reset pagination and expand states when filters change
  useEffect(() => {
    setDueCurrentPage(1);
    setExpandedCustomerSaleId(null);
  }, [dueSearchTerm, dueFromDate, dueToDate, selectedSalesRepId, hideSuedCustomers, pageSize]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const suggestions = useMemo(() => {
    const term = normalizeArabic(invoiceSearchTerm);
    if (term.length < 1) return [];
    return customers.filter(
      (c) =>
        normalizeArabic(c.name).includes(term) ||
        (c.phone && c.phone.includes(term))
    );
  }, [customers, invoiceSearchTerm]);

  useEffect(() => {
    const loadData = async () => {
      if (isApiMode()) {
        const [apiCustomers, apiSales, apiSalesReps] = await Promise.all([
          api.listCustomers(),
          api.listSalesForCollection(),
          api.listSalesReps(),
        ]);
        setCustomers(apiCustomers);
        setSales(apiSales.filter((sale) => sale.status !== 'cancelled').slice().reverse());
        setSalesReps(apiSalesReps);
        return;
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

  const invoiceLookupTerm = invoiceSearchTerm.trim();
  const hasInvoiceLookup = selectedCustomerId !== 'all' || invoiceLookupTerm.length >= 2;

  useEffect(() => {
    if (!isApiMode() || activeTab !== 'invoices') return;

    if (!hasInvoiceLookup) {
      setInvoiceSales([]);
      return;
    }

    let cancelled = false;
    const loadInvoiceSales = async () => {
      setIsInvoiceLoading(true);
      try {
        const apiSales = await api.listSalesForCollection({
          customerId: selectedCustomerId !== 'all' ? selectedCustomerId : undefined,
          search: selectedCustomerId === 'all' ? invoiceLookupTerm : undefined,
        });
        if (!cancelled) {
          setInvoiceSales(apiSales.filter((sale) => sale.status !== 'cancelled').slice().reverse());
        }
      } finally {
        if (!cancelled) setIsInvoiceLoading(false);
      }
    };

    void loadInvoiceSales();
    return () => {
      cancelled = true;
    };
  }, [activeTab, hasInvoiceLookup, invoiceLookupTerm, selectedCustomerId]);
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

  const invoiceRows = useMemo<CollectionInvoiceView[]>(() => {
    if (!hasInvoiceLookup) return [];
    if (!isApiMode()) return rows;

    return invoiceSales.map((sale) => {
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

      return {
        saleId: sale.id,
        customerId: sale.customerId,
        invoiceNumber: sale.invoiceNumber,
        customerName: sale.customerName,
        customerPhone: customer?.phone || '-',
        customerAddress: customer?.address || '-',
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
    });
  }, [customerMap, hasInvoiceLookup, invoiceSales, rows, salesRepMap]);
  const filteredRows = useMemo(() => {
    return invoiceRows.filter((row) => {
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
  }, [invoiceRows, invoiceSearchTerm, selectedCustomerId, showOnlyDue, hideSuedCustomers]);

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

  const totalDuePages = Math.ceil(groupedDueRows.length / pageSize);

  const paginatedGroupedDueRows = useMemo(() => {
    const startIndex = (dueCurrentPage - 1) * pageSize;
    return groupedDueRows.slice(startIndex, startIndex + pageSize);
  }, [groupedDueRows, dueCurrentPage, pageSize]);

  // Generate pagination list with ellipses (...)
  const getPaginatedPages = () => {
    const pages: (number | string)[] = [];
    const range = 1; // Show current page +/- 1
    
    for (let i = 1; i <= totalDuePages; i++) {
      if (
        i === 1 ||
        i === totalDuePages ||
        (i >= dueCurrentPage - range && i <= dueCurrentPage + range)
      ) {
        pages.push(i);
      } else if (pages[pages.length - 1] !== '...') {
        pages.push('...');
      }
    }
    return pages;
  };

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
    setTimeout(() => window.print(), 150);
  };

  return (
    <>
      <style>{`
      @media print {
        @page {
          size: A4 portrait;
          margin: 10mm;
        }
        html, body, #root, main, div, section {
          height: auto !important;
          min-height: 0 !important;
          max-height: none !important;
          overflow: visible !important;
          position: static !important;
        }
        body {
          background: white !important;
          padding: 0 !important;
          margin: 0 !important;
        }
        table {
          min-width: 0 !important;
          width: 100% !important;
          table-layout: fixed !important;
        }
        tr {
          page-break-inside: avoid !important;
          break-inside: avoid !important;
        }
        th, td {
          padding: 6px 4px !important;
          font-size: 10px !important;
          word-break: break-all !important;
        }
        .print\:hidden {
          display: none !important;
        }
        .invoice-page {
          break-after: page !important;
          page-break-after: always !important;
        }
      }
    `}</style>
      <div className="flex flex-col h-[calc(100vh-110px)] overflow-hidden print:h-auto print:overflow-visible">
        {/* Header/Tabs & Filters Bar */}
        <div className="bg-white border-b border-slate-200 px-5 py-3 space-y-3 shrink-0 print:hidden">
          {/* Segmented Control Tabs */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-100 pb-3 gap-3">
            <div className="flex bg-slate-100 p-1 rounded-xl w-fit">
              <button
                type="button"
                onClick={() => setActiveTab('due')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                  activeTab === 'due'
                    ? 'bg-white text-sky-700 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <LayoutList size={14} />
                العملاء المستحقون (فترة)
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('invoices')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                  activeTab === 'invoices'
                    ? 'bg-white text-sky-700 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <FileText size={14} />
                سجل فواتير العملاء
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('legal')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                  activeTab === 'legal'
                    ? 'bg-white text-red-700 shadow-sm'
                    : 'text-slate-500 hover:text-red-600'
                }`}
              >
                <Gavel size={14} />
                الشئون القانونية (النزاعات)
              </button>
            </div>
            {/* Context/Page Title in Arabic */}
            <div className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <span>مديرية تحصيل الحسابات</span>
              <span className="h-4 w-px bg-slate-200"></span>
              <span className="text-xs text-slate-500 font-medium">إدارة الفواتير والتحصيل</span>
            </div>
          </div>

          {/* Render filters inside this card based on activeTab */}
          {activeTab === 'due' && (
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              {/* Centered/Prominent Search Bar */}
              <div className="relative flex-1 max-w-md min-w-[240px]">
                <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={dueSearchTerm}
                  onChange={(e) => setDueSearchTerm(e.target.value)}
                  className="w-full h-9 rounded-xl border border-slate-200 bg-white px-3 pr-9 text-xs outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition placeholder:text-slate-400 shadow-sm"
                  placeholder="بحث باسم العميل أو رقم الفاتورة..."
                />
              </div>

              {/* Filters group */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-slate-400 font-bold ml-1">الفترة من:</span>
                  <DatePicker value={dueFromDate} onChange={setDueFromDate} className="h-9 w-[125px] rounded-xl border-slate-200 text-xs font-bold" />
                  <span className="text-[11px] text-slate-400 font-bold mx-1">إلى:</span>
                  <DatePicker value={dueToDate} onChange={setDueToDate} className="h-9 w-[125px] rounded-xl border-slate-200 text-xs font-bold" />
                </div>
                <select
                  value={selectedSalesRepId}
                  onChange={(e) => setSelectedSalesRepId(e.target.value)}
                  className="h-9 rounded-xl border border-slate-200 bg-white px-2 text-xs text-slate-700 font-bold outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition min-w-[110px] shadow-sm"
                >
                  <option value="all">كل المناديب</option>
                  {salesReps.map((rep) => (
                    <option key={rep.id} value={rep.id}>
                      {rep.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setHideSuedCustomers(!hideSuedCustomers)}
                  className={`flex items-center gap-1.5 px-3 h-9 rounded-xl border text-xs font-bold whitespace-nowrap transition-colors shadow-sm ${
                    hideSuedCustomers
                      ? 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100/70'
                      : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-600'
                  }`}
                >
                  <AlertTriangle size={13} className={hideSuedCustomers ? 'text-red-500' : 'text-slate-400'} />
                  إخفاء القضايا
                </button>
                <button
                  onClick={() => window.print()}
                  className="h-9 px-4 bg-sky-600 text-white rounded-xl hover:bg-sky-700 flex items-center gap-1.5 font-bold text-xs shadow-sm transition-all whitespace-nowrap"
                >
                  <Printer size={13} />
                  طباعة
                </button>
              </div>
            </div>
          )}

          {activeTab === 'invoices' && (
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <div className="relative flex-1 max-w-md min-w-[240px]">
                <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={invoiceSearchTerm}
                  onChange={(e) => {
                    setInvoiceSearchTerm(e.target.value);
                    setShowSuggestions(true);
                    if (e.target.value.trim() === '') {
                      setSelectedCustomerId('all');
                    }
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                  className="w-full h-9 rounded-xl border border-slate-200 bg-white px-3 pr-9 text-xs outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition placeholder:text-slate-400 shadow-sm"
                  placeholder="ابحث عن العميل بالاسم أو رقم الفاتورة..."
                />
                {showSuggestions && suggestions.length > 0 && (
                  <div className="absolute right-0 left-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-50 max-h-60 overflow-y-auto divide-y divide-slate-100 text-right">
                    {suggestions.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setSelectedCustomerId(c.id);
                          setInvoiceSearchTerm(c.name);
                          setShowSuggestions(false);
                        }}
                        className="w-full text-right px-4 py-2 text-xs text-slate-700 hover:bg-sky-50 hover:text-sky-700 font-bold transition-colors"
                      >
                        <span>{c.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex gap-2 mr-auto">
                <button
                  type="button"
                  onClick={() => setHideSuedCustomers(!hideSuedCustomers)}
                  className={`flex items-center gap-1.5 px-3 h-9 rounded-xl border text-xs font-bold whitespace-nowrap transition-colors shadow-sm ${
                    hideSuedCustomers
                      ? 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100/70'
                      : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-600'
                  }`}
                >
                  <AlertTriangle size={13} className={hideSuedCustomers ? 'text-red-500' : 'text-slate-400'} />
                  إخفاء القضايا
                </button>

                <button
                  type="button"
                  onClick={() => setShowOnlyDue(!showOnlyDue)}
                  className={`flex items-center gap-1.5 px-3 h-9 rounded-xl border text-xs font-bold whitespace-nowrap transition-colors shadow-sm ${
                    showOnlyDue
                      ? 'border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100/70'
                      : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-600'
                  }`}
                >
                  <FileText size={13} className={showOnlyDue ? 'text-sky-500' : 'text-slate-400'} />
                  إظهار المتبقي فقط
                </button>
              </div>
            </div>
          )}
        </div>

        {/* TAB CONTENT: DUE */}
        {activeTab === 'due' && (
          <div className="flex-1 min-h-0 flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-300">
            {dueFromDate > dueToDate && (
              <div className="border-b border-red-200 bg-red-50 px-5 py-2.5 text-sm text-red-700 shrink-0">
                تاريخ البداية يجب أن يكون قبل تاريخ النهاية.
              </div>
            )}

            {/* Scrollable Table Body */}
            <div className="flex-1 min-h-0 overflow-y-auto bg-white">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-50/80 text-slate-600 border-b border-slate-200 font-bold sticky top-0 z-[5]">
                  <tr>
                    <th className="px-5 py-2.5 text-right">العميل</th>
                    <th className="px-4 py-2.5 text-right">الهاتف</th>
                    <th className="px-4 py-2.5 text-right">المندوب</th>
                    <th className="px-4 py-2.5 text-right">العنوان</th>
                    <th className="px-4 py-2.5 text-center">آخر سداد</th>
                    <th className="px-4 py-2.5 text-center">المبلغ المستحق</th>
                    <th className="px-4 py-2.5 text-center w-[80px] print:hidden">التفاصيل</th>
                  </tr>
                </thead>
                  <tbody className="divide-y divide-slate-100">
                    {groupedDueRows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-5 py-12 text-center text-slate-400 font-bold">
                          <div className="flex flex-col items-center justify-center">
                            <CheckCircle2 size={36} className="text-slate-300 mb-2" />
                            <p>لا توجد أقساط مستحقة حالياً.</p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      paginatedGroupedDueRows.map((group) => {
                        const totalRemaining = group.reduce((sum, r) => sum + r.remainingAmount, 0);
                        const isExpanded = expandedCustomerSaleId === group[0].saleId;
                        const lastPayment = group[0].lastPaymentDate ? toISODateOnly(group[0].lastPaymentDate) : '---';

                        return (
                          <React.Fragment key={group[0].saleId}>
                            <tr
                              onClick={() => setExpandedCustomerSaleId(isExpanded ? null : group[0].saleId)}
                              className="hover:bg-slate-50/75 transition-colors cursor-pointer select-none"
                            >
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2.5">
                                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${group[0].isSued ? 'bg-red-50 text-red-500' : 'bg-sky-50 text-sky-500'}`}>
                                    {group[0].isSued ? <Gavel size={14} /> : <User size={14} />}
                                  </div>
                                  <div className="flex flex-col">
                                    <span className={`font-bold text-slate-800 text-sm ${group[0].isSued ? 'text-red-500 line-through' : ''}`}>
                                      {group[0].customerName}
                                    </span>
                                    {group[0].isSued && (
                                      <span className="text-[9px] text-red-500 font-bold flex items-center gap-0.5 mt-0.5">
                                        <AlertTriangle size={9} /> محال للقضاء
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-slate-600 font-semibold">{group[0].customerPhone}</td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-1.5 text-slate-700">
                                  <Briefcase size={13} className="text-slate-400 shrink-0" />
                                  <span className="font-semibold">{group[0].salesRepName || '---'}</span>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-slate-500 max-w-[220px] truncate" title={group[0].customerAddress}>
                                <div className="flex items-center gap-1">
                                  <MapPin size={13} className="text-slate-400 shrink-0" />
                                  <span className="truncate">{group[0].customerAddress}</span>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-center">
                                <span className="font-semibold text-slate-600">{lastPayment}</span>
                              </td>
                              <td className="px-4 py-3 text-center">
                                <span className="text-red-600 text-sm font-black">{formatCurrency(totalRemaining)}</span>
                              </td>
                              <td className="px-4 py-3 text-center print:hidden">
                                <button className="text-slate-400 hover:text-slate-700 w-7 h-7 rounded-full flex items-center justify-center hover:bg-slate-100 transition-colors mx-auto">
                                  {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                </button>
                              </td>
                            </tr>

                            {/* Dropdown details row */}
                            {isExpanded && (
                              <tr className="bg-slate-50/50">
                                <td colSpan={7} className="p-4 border-t border-slate-100">
                                  <div className="space-y-3">
                                    {group[0].guarantors.some((g) => g && g.name) && (
                                      <div className="flex items-center gap-2 text-xs text-slate-500 bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
                                        <Shield size={14} className="text-amber-500 shrink-0" />
                                        <span className="font-bold text-slate-600">الضامنين:</span>
                                        <div className="flex items-center gap-2 flex-wrap">
                                          {group[0].guarantors
                                            .filter((g) => g && g.name)
                                            .map((g, idx, arr) => (
                                              <span key={idx} className="text-slate-700 font-semibold">
                                                {g!.name} ({g!.phone}){idx < arr.length - 1 ? '، ' : ''}
                                              </span>
                                            ))}
                                        </div>
                                      </div>
                                    )}

                                    <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
                                      <table className="w-full text-right text-xs">
                                        <thead className="bg-slate-50 text-slate-600 border-b border-slate-100">
                                          <tr>
                                            <th className="px-3 py-2 text-right">القسط</th>
                                            <th className="px-3 py-2 text-right">تاريخ الاستحقاق</th>
                                            <th className="px-3 py-2 text-center">قيمة القسط</th>
                                            <th className="px-3 py-2 text-center">المتبقي</th>
                                            <th className="px-3 py-2 text-center">الحالة</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-50">
                                          {group.map((row) => (
                                            <tr key={`${row.saleId}-${row.installmentLabel}-${row.dueDate}`} className="hover:bg-slate-50/30 transition-colors">
                                              <td className="px-3 py-2 font-semibold text-slate-800">{row.installmentLabel}</td>
                                              <td className="px-3 py-2 text-slate-500">{toISODateOnly(row.dueDate)}</td>
                                              <td className="px-3 py-2 text-slate-600 text-center">{formatCurrency(row.installmentAmount)}</td>
                                              <td className="px-3 py-2 font-bold text-red-600 text-center">{formatCurrency(row.remainingAmount)}</td>
                                              <td className="px-3 py-2 text-center">
                                                <MonthBadge status={row.status} />
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })
                    )}
                </tbody>
              </table>
            </div>

            {/* Locked Bottom Footer — rigid 3-column grid */}
            <div className="bg-white border-t border-slate-200 px-5 py-3 shrink-0 z-10 relative select-none print:hidden">
              <div className="grid grid-cols-3 items-center gap-4">
                {/* Right: Statistics */}
                <div className="flex items-center gap-3 text-xs font-bold text-slate-600">
                  <span>أقساط مستحقة: <span className="text-slate-900 font-black">{dueRows.length}</span></span>
                  <span className="w-px h-4 bg-slate-200"></span>
                  <span>عملاء: <span className="text-slate-900 font-black">{groupedDueRows.length}</span></span>
                  <span className="w-px h-4 bg-slate-200"></span>
                  <span>الإجمالي: <span className="text-red-600 font-black">{formatCurrency(dueTotalInPeriod)}</span></span>
                </div>

                {/* Center: Pagination — always centered */}
                <div className="flex items-center justify-center">
                  {totalDuePages > 1 ? (
                    <nav className="inline-flex items-center gap-1" aria-label="Pagination">
                      <button
                        disabled={dueCurrentPage === 1}
                        onClick={() => {
                          setDueCurrentPage((prev) => Math.max(prev - 1, 1));
                          setExpandedCustomerSaleId(null);
                        }}
                        className="h-7 px-2 rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-[11px] font-bold transition-all"
                      >
                        السابق
                      </button>
                      {getPaginatedPages().map((page, idx) => {
                        if (page === '...') {
                          return (
                            <span key={`dots-${idx}`} className="h-7 w-5 flex items-center justify-center text-slate-400 text-[11px] font-bold">
                              ...
                            </span>
                          );
                        }
                        return (
                          <button
                            key={`page-${page}`}
                            onClick={() => {
                              setDueCurrentPage(page as number);
                              setExpandedCustomerSaleId(null);
                            }}
                            className={`h-7 w-7 rounded-md text-[11px] font-bold transition-all ${
                              dueCurrentPage === page
                                ? 'bg-sky-600 text-white'
                                : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            {page}
                          </button>
                        );
                      })}
                      <button
                        disabled={dueCurrentPage === totalDuePages}
                        onClick={() => {
                          setDueCurrentPage((prev) => Math.min(prev + 1, totalDuePages));
                          setExpandedCustomerSaleId(null);
                        }}
                        className="h-7 px-2 rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-[11px] font-bold transition-all"
                      >
                        التالي
                      </button>
                    </nav>
                  ) : (
                    <span></span>
                  )}
                </div>

                {/* Left: Range indicator */}
                <div className="flex justify-end">
                  <p className="text-[11px] text-slate-500 font-bold whitespace-nowrap">
                    عرض <span className="text-slate-900">{(dueCurrentPage - 1) * pageSize + 1}</span> - <span className="text-slate-900">{Math.min(groupedDueRows.length, dueCurrentPage * pageSize)}</span> من <span className="text-slate-900">{groupedDueRows.length}</span> عميل
                  </p>
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
                  onChange={(e) => {
                    setInvoiceSearchTerm(e.target.value);
                    setShowSuggestions(true);
                    if (e.target.value.trim() === '') {
                      setSelectedCustomerId('all');
                    }
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                  className="input-ui pr-10 h-10 text-sm w-full"
                  placeholder="ابحث عن العميل بالاسم أو رقم الفاتورة..."
                />
                {showSuggestions && suggestions.length > 0 && (
                  <div className="absolute right-0 left-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-50 max-h-60 overflow-y-auto divide-y divide-slate-100">
                    {suggestions.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setSelectedCustomerId(c.id);
                          setInvoiceSearchTerm(c.name);
                          setShowSuggestions(false);
                        }}
                        className="w-full text-right px-4 py-2.5 text-sm text-slate-700 hover:bg-sky-50 hover:text-sky-700 font-medium transition-colors"
                      >
                        <span>{c.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex gap-3 w-full md:w-auto justify-center mr-auto">
                <label className="flex items-center gap-2 cursor-pointer bg-red-50/50 hover:bg-red-50 text-red-800 px-4 py-2 rounded-xl border border-red-100/60 transition-all select-none shadow-sm">
                  <input
                    type="checkbox"
                    checked={hideSuedCustomers}
                    onChange={(e) => setHideSuedCustomers(e.target.checked)}
                    className="h-4 w-4 rounded text-red-600 accent-red-600 cursor-pointer"
                  />
                  <span className="text-sm font-bold whitespace-nowrap">إخفاء القضايا</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer bg-sky-50/50 hover:bg-sky-50 text-sky-800 px-4 py-2 rounded-xl border border-sky-100/60 transition-all select-none shadow-sm">
                  <input
                    type="checkbox"
                    checked={showOnlyDue}
                    onChange={(e) => setShowOnlyDue(e.target.checked)}
                    className="h-4 w-4 rounded text-sky-600 accent-sky-600 cursor-pointer"
                  />
                  <span className="text-sm font-bold whitespace-nowrap">إظهار المتبقي فقط</span>
                </label>
              </div>
            </div>

            {/* Invoice Cards */}
            <div className="space-y-4">
              {!hasInvoiceLookup ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-gradient-to-b from-slate-50 to-white p-16 text-center shadow-sm">
                  <div className="w-16 h-16 rounded-2xl bg-sky-50 flex items-center justify-center mx-auto mb-5">
                    <Search size={32} className="text-sky-400" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-800 mb-2">ابحث عن عميل لعرض فواتيره</h3>
                  <p className="text-slate-500 text-sm max-w-md mx-auto">اكتب اسم العميل أو رقم الفاتورة في خانة البحث بالأعلى، أو اختر عميل من القائمة لعرض كشف حسابه وحالة أقساطه.</p>
                </div>
              ) : isInvoiceLoading ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-16 text-center shadow-sm">
                  <Clock3 size={40} className="text-sky-400 mx-auto mb-4 animate-pulse" />
                  <p className="text-slate-500 font-medium">جاري تحميل فواتير العميل...</p>
                </div>
              ) : filteredRows.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-16 text-center shadow-sm">
                  <Search size={40} className="text-slate-300 mx-auto mb-4" />
                  <p className="text-slate-500 font-medium">لا توجد نتائج مطابقة للبحث الحالي.</p>
                </div>
              ) : filteredRows.map((row) => {
                  // Calculate installment metrics
                  const totalInstallments = row.schedules.length;
                  const paidInstallments = row.schedules.filter((s) => s.status === 'paid').length;
                  const partialInstallments = row.schedules.filter((s) => s.status === 'partial').length;
                  const unpaidInstallments = row.schedules.filter((s) => s.status === 'unpaid').length;
                  const paymentProgress = row.total > 0 ? Math.min((row.paid / row.total) * 100, 100) : 0;

                  return (
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

                    {/* Installments Summary Dashboard */}
                    {row.paymentMethod === 'installment' && (
                      <div className="mt-4 bg-gradient-to-r from-slate-50 to-slate-100/50 p-4 rounded-xl border border-slate-200/60 shadow-inner">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                          <div className="flex flex-wrap gap-4 items-center">
                            <div className="bg-white px-3.5 py-2 rounded-lg border border-slate-200 shadow-sm flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold text-sm">
                                {paidInstallments}
                              </div>
                              <div>
                                <p className="text-[10px] text-slate-400 font-bold">الأقساط المدفوعة</p>
                                <p className="text-xs font-semibold text-slate-700">{paidInstallments} من {totalInstallments}</p>
                              </div>
                            </div>

                            {partialInstallments > 0 && (
                              <div className="bg-white px-3.5 py-2 rounded-lg border border-slate-200 shadow-sm flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center font-bold text-sm">
                                  {partialInstallments}
                                </div>
                                <div>
                                  <p className="text-[10px] text-slate-400 font-bold">أقساط مدفوعة جزئياً</p>
                                  <p className="text-xs font-semibold text-slate-700">{partialInstallments} قسط</p>
                                </div>
                              </div>
                            )}

                            <div className="bg-white px-3.5 py-2 rounded-lg border border-slate-200 shadow-sm flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center font-bold text-sm">
                                {unpaidInstallments}
                              </div>
                              <div>
                                <p className="text-[10px] text-slate-400 font-bold">الأقساط المتبقية</p>
                                <p className="text-xs font-semibold text-slate-700">{unpaidInstallments} قسط غير مدفوع</p>
                              </div>
                            </div>
                          </div>

                          <div className="flex-1 min-w-[200px] bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
                            <div className="flex justify-between items-center mb-1.5 text-xs">
                              <span className="text-slate-500 font-bold">نسبة التحصيل من الأقساط</span>
                              <span className="text-emerald-600 font-black">{paymentProgress.toFixed(1)}%</span>
                            </div>
                            <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                              <div
                                className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                                style={{ width: `${paymentProgress}%` }}
                              ></div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

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
                );
              })}
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
      {printingInvoice ? (
        <div className="invoice-page">
          <PrintableView invoice={printingInvoice} settings={settings} />
        </div>
      ) : (
        /* PRINTABLE ALL DUE CUSTOMERS (MULTIPLE PAGES) */
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
              .due-print-page {
                break-inside: avoid !important;
                page-break-inside: avoid !important;
                width: 100% !important;
                margin: 0 0 25px 0 !important;
                padding: 0 0 15px 0 !important;
                border-b: 1px dashed #cbd5e1;
              }
              .due-print-page:last-child {
                border-b: none !important;
                margin-bottom: 0 !important;
              }
            }
          `}</style>
          
          {/* Header of the full report */}
          <div className="flex justify-between items-start border-b-2 border-slate-800 pb-4 mb-6">
            <div>
              <h1 className="text-4xl font-black text-slate-900 mb-1">{settings.companyName}</h1>
              <p className="text-slate-600 text-sm">{settings.companyAddress}</p>
              <p className="text-slate-600 font-bold text-sm">{settings.companyPhone}</p>
            </div>
            <div className="text-left">
              <h2 className="text-3xl font-bold text-slate-800 border-b border-slate-300 pb-1 mb-1 inline-block">كشف التحصيل الإجمالي</h2>
              <p className="text-slate-600 font-bold text-sm">تاريخ التقرير: {formatDateDisplay(new Date())}</p>
              <p className="text-slate-600 font-bold text-sm">الفترة: من {formatDateDisplay(dueFromDate)} إلى {formatDateDisplay(dueToDate)}</p>
            </div>
          </div>

          {groupedDueRows.length === 0 ? (
            <div className="p-12 text-center text-slate-500">لا توجد أقساط مستحقة حالياً.</div>
          ) : (
            groupedDueRows.map((group, idx) => {
              const totalRemaining = group.reduce((sum, r) => sum + r.remainingAmount, 0);
              return (
                <div key={idx} className="due-print-page">
                  {/* Customer Header */}
                  <div className="flex justify-between items-center bg-slate-100 p-3 rounded-lg mb-3">
                    <div>
                      <h3 className="font-bold text-base text-slate-800">اسم العميل: {group[0].customerName}</h3>
                      <p className="text-xs text-slate-600 mt-1">الهاتف: {group[0].customerPhone} | العنوان: {group[0].customerAddress}</p>
                    </div>
                    <div className="text-left">
                      <span className="text-xs font-bold text-slate-500">المندوب: {group[0].salesRepName || '---'}</span>
                      <p className="text-sm font-black text-red-700 mt-0.5">المستحق الحالي: {formatCurrency(totalRemaining)}</p>
                    </div>
                  </div>

                  {/* Installments Table */}
                  <table className="w-full text-right border-collapse border border-slate-300 text-xs mb-4">
                    <thead>
                      <tr className="bg-slate-200">
                        <th className="border border-slate-300 px-2 py-1.5 font-bold">القسط</th>
                        <th className="border border-slate-300 px-2 py-1.5 font-bold">تاريخ الاستحقاق</th>
                        <th className="border border-slate-300 px-2 py-1.5 font-bold text-center">المبلغ المستحق</th>
                        <th className="border border-slate-300 px-2 py-1.5 font-bold text-center">المتبقي</th>
                        <th className="border border-slate-300 px-2 py-1.5 font-bold text-center">الحالة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.map((row, rIdx) => (
                        <tr key={rIdx} className="even:bg-slate-50">
                          <td className="border border-slate-300 px-2 py-1.5 font-semibold">{row.installmentLabel}</td>
                          <td className="border border-slate-300 px-2 py-1.5">{formatDateDisplay(row.dueDate)}</td>
                          <td className="border border-slate-300 px-2 py-1.5 text-center">{formatCurrency(row.installmentAmount)}</td>
                          <td className="border border-slate-300 px-2 py-1.5 text-center text-red-700 font-bold">{formatCurrency(row.remainingAmount)}</td>
                          <td className="border border-slate-300 px-2 py-1.5 text-center font-bold">
                            {row.status === 'paid' ? 'مدفوع' : row.status === 'partial' ? 'جزئي' : 'غير مدفوع'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })
          )}

          {/* Overall Report Footer */}
          <div className="mt-8 pt-4 border-t-2 border-slate-800 flex justify-between items-center text-sm font-bold">
            <div>
              <p>عدد العملاء المستحقين: <span className="text-slate-900">{groupedDueRows.length}</span></p>
              <p className="mt-1">إجمالي المبالغ المستحقة بالخارج: <span className="text-red-700">{formatCurrency(dueTotalInPeriod)}</span></p>
            </div>
            {settings.invoiceFooter && (
              <div className="text-left text-xs text-slate-500">
                <p>{settings.invoiceFooter}</p>
                <p className="mt-1">تم الاستخراج من نظام {settings.companyName}</p>
              </div>
            )}
          </div>
        </div>
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


