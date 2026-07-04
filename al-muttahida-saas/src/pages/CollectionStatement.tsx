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
    .replace(/[ط£ط¥ط¢ط§]/g, 'ط§')
    .replace(/ط©/g, 'ظ‡')
    .replace(/[ظ‰ظٹ]/g, 'ظٹ')
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
  const [serverDueRows, setServerDueRows] = useState<DueCustomerRow[]>([]);
  const [isDueLoading, setIsDueLoading] = useState(false);
  const [dueLoadError, setDueLoadError] = useState('');
  const [hasLoadedAllSales, setHasLoadedAllSales] = useState(false);

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
  const ITEMS_PER_PAGE = 5;

  // Reset pagination and expand states when filters change
  useEffect(() => {
    setDueCurrentPage(1);
    setExpandedCustomerSaleId(null);
  }, [dueSearchTerm, dueFromDate, dueToDate, selectedSalesRepId, hideSuedCustomers]);
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
        const [apiCustomers, apiSalesReps] = await Promise.all([
          api.listCustomers(),
          api.listSalesReps(),
        ]);
        setCustomers(apiCustomers);
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

  useEffect(() => {
    if (!isApiMode() || activeTab !== 'due') return;

    if (!dueFromDate || !dueToDate || dueFromDate > dueToDate) {
      setServerDueRows([]);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    const handle = window.setTimeout(() => {
      const loadDueRows = async () => {
        setIsDueLoading(true);
        setDueLoadError('');
        try {
          const apiDueRows = await api.listCollectionDue(
            {
              from: dueFromDate,
              to: dueToDate,
              search: dueSearchTerm.trim() || undefined,
              salesRepId: selectedSalesRepId,
              hideSued: hideSuedCustomers,
            },
            { signal: controller.signal },
          );
          if (!cancelled) setServerDueRows(apiDueRows);
        } catch (error) {
          if (!cancelled) {
            setServerDueRows([]);
            setDueLoadError(error instanceof DOMException && error.name === 'AbortError' ? 'Request timed out. Please try a smaller date range.' : 'Failed to load due installments.');
          }
        } finally {
          window.clearTimeout(timeout);
          if (!cancelled) setIsDueLoading(false);
        }
      };

      void loadDueRows();
    }, 250);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timeout);
      window.clearTimeout(handle);
    };
  }, [activeTab, dueFromDate, dueSearchTerm, dueToDate, hideSuedCustomers, selectedSalesRepId]);

  useEffect(() => {
    if (!isApiMode() || activeTab !== 'legal' || hasLoadedAllSales) return;

    let cancelled = false;
    const loadAllSalesForLegal = async () => {
      const apiSales = await api.listSalesForCollection();
      if (!cancelled) {
        setSales(apiSales.filter((sale) => sale.status !== 'cancelled').slice().reverse());
        setHasLoadedAllSales(true);
      }
    };

    void loadAllSalesForLegal();
    return () => {
      cancelled = true;
    };
  }, [activeTab, hasLoadedAllSales]);

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
              label: 'ط¯ظپط¹ط© ظˆط§ط­ط¯ط©',
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
            label: 'ط¯ظپط¹ط© ظˆط§ط­ط¯ط©',
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
    if (isApiMode()) return serverDueRows;
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
  }, [dueFromDate, dueToDate, dueSearchTerm, rows, selectedSalesRepId, customerMap, hideSuedCustomers, serverDueRows]);

  const groupedDueRows = useMemo(() => {
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
  }, [groupedDueRows, dueCurrentPage]);

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
      <div className={`space-y-3 ${printingInvoice ? 'print:hidden' : ''}`}>
        {/* TABS SECTION - Flush to top */}
        <div className="flex gap-1 border-b border-slate-200 pb-[1px] print:hidden">
          <button
            onClick={() => setActiveTab('due')}
            className={`flex items-center gap-1.5 px-4 py-2 font-semibold text-sm rounded-t-xl transition-colors ${activeTab === 'due' ? 'bg-sky-50 text-sky-700 border-b-2 border-sky-600' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700 border-b-2 border-transparent'
              }`}
          >
            <LayoutList size={16} />
            ط§ظ„ط¹ظ…ظ„ط§ط، ط§ظ„ظ…ط³طھط­ظ‚ظˆظ† (ظپطھط±ط©)
          </button>
          <button
            onClick={() => setActiveTab('invoices')}
            className={`flex items-center gap-1.5 px-4 py-2 font-semibold text-sm rounded-t-xl transition-colors ${activeTab === 'invoices' ? 'bg-sky-50 text-sky-700 border-b-2 border-sky-600' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700 border-b-2 border-transparent'
              }`}
          >
            <FileText size={16} />
            ط³ط¬ظ„ ظپظˆط§طھظٹط± ط§ظ„ط¹ظ…ظ„ط§ط،
          </button>
          <button
            onClick={() => setActiveTab('legal')}
            className={`flex items-center gap-1.5 px-4 py-2 font-semibold text-sm rounded-t-xl transition-colors ${activeTab === 'legal' ? 'bg-red-50 text-red-700 border-b-2 border-red-600' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700 border-b-2 border-transparent'
              }`}
          >
            <Gavel size={16} />
            ط§ظ„ط´ط¦ظˆظ† ط§ظ„ظ‚ط§ظ†ظˆظ†ظٹط© (ط§ظ„ظ†ط²ط§ط¹ط§طھ)
          </button>
        </div>

        {/* TAB CONTENT: DUE */}
        {activeTab === 'due' && (
          <div className="space-y-3 pb-24 animate-in fade-in slide-in-from-bottom-2 duration-300">
            {/* Compact Inline Filters */}
            <div className="flex flex-wrap items-center gap-2 print:hidden">
              <div className="relative flex-1 min-w-[180px]">
                <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={dueSearchTerm}
                  onChange={(e) => setDueSearchTerm(e.target.value)}
                  className="w-full h-9 rounded-xl border border-slate-200 bg-white px-3 pr-9 text-sm outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition placeholder:text-slate-400"
                  placeholder="ط¨ط­ط« ط¨ط§ظ„ط§ط³ظ… ط£ظˆ ط±ظ‚ظ… ط§ظ„ظپط§طھظˆط±ط©..."
                />
              </div>
              <DatePicker value={dueFromDate} onChange={setDueFromDate} className="h-9 w-[130px] rounded-xl border-slate-200 px-3 text-sm font-semibold" />
              <DatePicker value={dueToDate} onChange={setDueToDate} className="h-9 w-[130px] rounded-xl border-slate-200 px-3 text-sm font-semibold" />
              <select
                value={selectedSalesRepId}
                onChange={(e) => setSelectedSalesRepId(e.target.value)}
                className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 font-semibold outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition min-w-[120px]"
              >
                <option value="all">ظƒظ„ ط§ظ„ظ…ظ†ط§ط¯ظٹط¨</option>
                {salesReps.map((rep) => (
                  <option key={rep.id} value={rep.id}>
                    {rep.name}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1.5 cursor-pointer text-red-600 bg-red-50 px-3 h-9 rounded-xl border border-red-100 hover:bg-red-100 transition-colors text-xs font-bold whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={hideSuedCustomers}
                  onChange={(e) => setHideSuedCustomers(e.target.checked)}
                  className="h-3.5 w-3.5 rounded text-red-600 accent-red-600"
                />
                ط¥ط®ظپط§ط، ط§ظ„ظ‚ط¶ط§ظٹط§
              </label>
              <button onClick={() => window.print()} className="h-9 px-4 bg-slate-800 text-white rounded-xl hover:bg-slate-900 flex items-center gap-1.5 font-bold text-xs shadow-sm transition-all whitespace-nowrap">
                <Printer size={14} />
                ط·ط¨ط§ط¹ط©
              </button>
            </div>

            {dueFromDate > dueToDate && (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                طھط§ط±ظٹط® ط§ظ„ط¨ط¯ط§ظٹط© ظٹط¬ط¨ ط£ظ† ظٹظƒظˆظ† ظ‚ط¨ظ„ طھط§ط±ظٹط® ط§ظ„ظ†ظ‡ط§ظٹط©.
              </div>
            )}

{/* Accordion Cards Layout */}
            {dueLoadError && (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 print:hidden">
                {dueLoadError}
              </div>
            )}
            <div className="space-y-2 print:hidden">
              {isDueLoading ? (
                <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center text-slate-500 shadow-sm">
                  <Clock3 size={36} className="text-sky-400 mx-auto mb-3 animate-pulse" />
                  <p className="font-bold">Loading due installments...</p>
                </div>
              ) : groupedDueRows.length === 0 ? (
                <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center text-slate-500 shadow-sm">
                  <div className="flex flex-col items-center justify-center">
                    <CheckCircle2 size={40} className="text-slate-300 mb-3" />
                    <p className="font-bold">Loading due installments...</p>
                  </div>
                </div>
              ) : (
                // Use paginatedGroupedDueRows on screen, but print all rows for full reports
                paginatedGroupedDueRows.map((group, gIdx) => {
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
                        className="p-3 px-4 flex items-center justify-between gap-4 flex-wrap cursor-pointer hover:bg-slate-50/50 transition-colors select-none print:bg-slate-50/30"
                      >
                        <div className="flex items-center gap-4 flex-wrap print:gap-2">
                          <div className="flex items-center gap-2">
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${group[0].isSued ? 'bg-red-50 text-red-600' : 'bg-sky-50 text-sky-600'}`}>
                              {group[0].isSued ? <Gavel size={20} /> : <User size={20} />}
                            </div>
                            <div className="flex flex-col">
                              <span className={`text-lg font-black print:text-sm ${group[0].isSued ? 'text-red-600 line-through' : 'text-slate-900'}`}>
                                {group[0].customerName}
                              </span>
                              {group[0].isSued && (
                                <span className="text-[10px] text-red-500 font-bold flex items-center gap-0.5 print:text-[8px]">
                                  <AlertTriangle size={10} /> ظ…ط­ط§ظ„ ظ„ظ„ظ‚ط¶ط§ط، ظٹظ…ظ†ط¹ ط§ظ„طھط¹ط§ظ…ظ„
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
                            <span className="text-sm font-medium text-slate-600">{group[0].customerAddress}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 print:gap-1.5">
                          <div className="flex items-center gap-1.5 font-bold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-xl text-xs print:px-1.5 print:text-[9px]">
                            <Clock3 size={14} />
                            <span>ط£ط®ط± ط³ط¯ط§ط¯: {group[0].lastPaymentDate ? formatDateDisplay(group[0].lastPaymentDate) : '---'}</span>
                          </div>
                          <div className="flex items-center gap-1.5 bg-red-50 px-3 py-1.5 rounded-xl border border-red-100 text-xs font-bold print:px-1.5 print:text-[9px]">
                            <Wallet size={14} className="text-red-500" />
                            <span className="text-red-500">ط§ظ„ظ…ط³طھط­ظ‚:</span>
                            <span className="text-red-700 font-black">{formatCurrency(totalRemaining)}</span>
                          </div>
                          <div className="text-slate-400 hover:text-slate-700 w-8 h-8 rounded-full flex items-center justify-center hover:bg-slate-100 transition-colors print:hidden">
                            {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                          </div>
                        </div>
                      </div>

                      {/* COLLAPSIBLE BODY */}
                      <div className={`${isExpanded ? 'block' : 'hidden print:block'} border-t border-slate-100 bg-slate-50/30 p-4 space-y-3`}>
                        {/* Guarantors Section */}
                        {group[0].guarantors.some((g) => g && g.name) && (
                          <div className="flex items-center gap-2 text-sm text-slate-500 bg-white p-3.5 rounded-2xl border border-slate-100 shadow-2sm">
                            <Shield size={16} className="text-amber-500 shrink-0" />
                            <span className="font-bold text-slate-500 print:text-[10px]">ط§ظ„ط¶ط§ظ…ظ†ظٹظ†:</span>
                            <div className="flex items-center gap-3 flex-wrap">
                              {group[0].guarantors
                                .filter((g) => g && g.name)
                                .map((g, idx, arr) => (
                                  <span key={idx} className="text-slate-700 font-semibold print:text-[10px]">
                                    {g!.name} ({g!.phone}){idx < arr.length - 1 ? 'طŒ ' : ''}
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
                                <th className="px-4 py-3 text-right font-bold text-xs uppercase tracking-wider">ط§ظ„ظ‚ط³ط·</th>
                                <th className="px-4 py-3 text-right font-bold text-xs uppercase tracking-wider">طھط§ط±ظٹط® ط§ظ„ط§ط³طھط­ظ‚ط§ظ‚</th>
                                <th className="px-4 py-3 text-center font-bold text-xs uppercase tracking-wider">ظ‚ظٹظ…ط© ط§ظ„ظ‚ط³ط·</th>
                                <th className="px-4 py-3 text-center font-bold text-xs uppercase tracking-wider">ط§ظ„ظ…طھط¨ظ‚ظٹ</th>
                                <th className="px-4 py-3 text-center font-bold text-xs uppercase tracking-wider">ط§ظ„ط­ط§ظ„ط©</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {group.map((row) => (
                                <tr key={`${row.saleId}-${row.installmentLabel}-${row.dueDate}`} className="hover:bg-slate-50/50 transition-colors">
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

            {/* Print-Only Classic Table Layout (Exactly matches the old format) */}
            <div className="hidden print:block bg-white rounded-2xl border border-slate-200 overflow-hidden w-full">
              <table className="w-full bg-white text-right text-sm">
                <thead className="bg-slate-50 text-slate-700 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-2 text-right text-xs font-bold">ط§ظ„ظ‚ط³ط·</th>
                    <th className="px-4 py-2 text-right text-xs font-bold">طھط§ط±ظٹط® ط§ظ„ط§ط³طھط­ظ‚ط§ظ‚</th>
                    <th className="px-4 py-2 text-center text-xs font-bold">ظ‚ظٹظ…ط© ط§ظ„ظ‚ط³ط·</th>
                    <th className="px-4 py-2 text-center text-xs font-bold">ط§ظ„ظ…طھط¨ظ‚ظٹ</th>
                    <th className="px-4 py-2 text-center text-xs font-bold">ط§ظ„ط­ط§ظ„ط©</th>
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
                                <span className={`font-black text-sm ${group[0].isSued ? 'text-red-600 line-through' : 'text-slate-900'}`}>
                                  {group[0].customerName}
                                </span>
                                <span className="text-xs text-slate-700 font-bold">ظ‡ط§طھظپ: {group[0].customerPhone}</span>
                                <span className="text-xs text-sky-700 font-bold">ظ…ظ†ط¯ظˆط¨: {group[0].salesRepName || '---'}</span>
                                <span className="text-xs text-slate-600 font-medium">ط¹ظ†ظˆط§ظ†: {group[0].customerAddress}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded">ط£ط®ط± ط³ط¯ط§ط¯: {group[0].lastPaymentDate ? formatDateDisplay(group[0].lastPaymentDate) : '---'}</span>
                                <span className="text-xs text-red-700 font-bold bg-red-50 px-2 py-0.5 rounded">ط§ظ„ظ…ط³طھط­ظ‚: {formatCurrency(group.reduce((sum, r) => sum + r.remainingAmount, 0))}</span>
                              </div>
                            </div>
                            {group[0].guarantors.some((g) => g && g.name) && (
                              <div className="text-[11px] text-slate-500 border-t border-dashed border-slate-200 pt-1 mt-1">
                                <span className="font-bold text-slate-600">ط§ظ„ط¶ط§ظ…ظ†ظٹظ†: </span>
                                {group[0].guarantors
                                  .filter((g) => g && g.name)
                                  .map((g, idx, arr) => `${g!.name} (${g!.phone})${idx < arr.length - 1 ? 'طŒ ' : ''}`)}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                      {/* Installment Rows */}
                      {group.map((row) => (
                        <tr key={`${row.saleId}-${row.installmentLabel}-${row.dueDate}`} className="border-b border-slate-100 last:border-b-0">
                          <td className="px-4 py-2 text-xs font-semibold text-slate-800">{row.installmentLabel}</td>
                          <td className="px-4 py-2 text-xs text-slate-600">{formatDateDisplay(row.dueDate)}</td>
                          <td className="px-4 py-2 text-xs text-slate-600 text-center">{formatCurrency(row.installmentAmount)}</td>
                          <td className="px-4 py-2 text-xs font-bold text-red-600 text-center">{formatCurrency(row.remainingAmount)}</td>
                          <td className="px-4 py-2 text-center text-xs">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              row.status === 'paid' ? 'bg-emerald-50 text-emerald-700' :
                              row.status === 'partial' ? 'bg-amber-50 text-amber-700' :
                              'bg-red-50 text-red-700'
                            }`}>
                              {row.status === 'paid' ? 'ظ…ط¯ظپظˆط¹' : row.status === 'partial' ? 'ط¬ط²ط¦ظٹ' : 'ط؛ظٹط± ظ…ط¯ظپظˆط¹'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {totalDuePages > 1 && (
              <div className="flex items-center justify-between border border-slate-200/60 bg-white px-4 py-2.5 rounded-2xl print:hidden">
                <div>
                  <p className="text-xs text-slate-500 font-bold whitespace-nowrap">
                    ط¹ط±ط¶ <span className="text-slate-900">{(dueCurrentPage - 1) * ITEMS_PER_PAGE + 1}</span> -{' '}
                    <span className="text-slate-900">{Math.min(groupedDueRows.length, dueCurrentPage * ITEMS_PER_PAGE)}</span> ظ…ظ†{' '}
                    <span className="text-slate-900">{groupedDueRows.length}</span> ط¹ظ…ظٹظ„
                  </p>
                </div>
                <nav className="inline-flex rounded-xl gap-1" aria-label="Pagination">
                  <button
                    disabled={dueCurrentPage === 1}
                    onClick={() => {
                      setDueCurrentPage(prev => Math.max(prev - 1, 1));
                      setExpandedCustomerSaleId(null);
                    }}
                    className="h-8 px-2.5 rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-[11px] font-bold transition-all shadow-3sm"
                  >
                    ط§ظ„ط³ط§ط¨ظ‚
                  </button>
                  {getPaginatedPages().map((page, idx) => {
                    if (page === '...') {
                      return (
                        <span key={`dots-${idx}`} className="h-8 w-6 flex items-center justify-center text-slate-400 text-xs font-bold">
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
                        className={`h-8 w-8 rounded-lg text-xs font-bold transition-all ${
                          dueCurrentPage === page
                            ? 'bg-sky-600 text-white shadow-sm'
                            : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 shadow-3sm'
                        }`}
                      >
                        {page}
                      </button>
                    );
                  })}
                  <button
                    disabled={dueCurrentPage === totalDuePages}
                    onClick={() => {
                      setDueCurrentPage(prev => Math.min(prev + 1, totalDuePages));
                      setExpandedCustomerSaleId(null);
                    }}
                    className="h-8 px-2.5 rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-[11px] font-bold transition-all shadow-3sm"
                  >
                    ط§ظ„طھط§ظ„ظٹ
                  </button>
                </nav>
              </div>
            )}

            {/* Quick Metrics Footer */}
            <div className="fixed bottom-2 left-4 right-4 z-40 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/95 px-4 py-2.5 shadow-lg backdrop-blur lg:right-[17rem] print:hidden">
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="text-xl font-black text-slate-900">{dueRows.length}</span>
                  <span className="text-xs font-bold text-slate-500">ط£ظ‚ط³ط§ط· ظ…ط³طھط­ظ‚ط©</span>
                </div>
                <div className="w-px h-5 bg-slate-200 hidden sm:block"></div>
                <div className="flex items-center gap-2">
                  <span className="text-xl font-black text-slate-900">{groupedDueRows.length}</span>
                  <span className="text-xs font-bold text-slate-500">ط¹ظ…ظ„ط§ط، ظ…ط³طھط­ظ‚ظٹظ†</span>
                </div>
              </div>

              <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-1.5 shadow-sm">
                <div className="text-left">
                  <div className="text-[10px] font-bold text-slate-400 uppercase mb-0.5">ط¥ط¬ظ…ط§ظ„ظٹ ظ…ط¨ط§ظ„ط؛ ط§ظ„ط£ظ‚ط³ط§ط·</div>
                  <div className="text-lg font-black text-red-600">{formatCurrency(dueTotalInPeriod)}</div>
                </div>
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-50 text-red-500">
                  <Wallet size={17} />
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
                  placeholder="ط§ط¨ط­ط« ط¹ظ† ط§ظ„ط¹ظ…ظٹظ„ ط¨ط§ظ„ط§ط³ظ… ط£ظˆ ط±ظ‚ظ… ط§ظ„ظپط§طھظˆط±ط©..."
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
                  <span className="text-sm font-bold whitespace-nowrap">ط¥ط®ظپط§ط، ط§ظ„ظ‚ط¶ط§ظٹط§</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer bg-sky-50/50 hover:bg-sky-50 text-sky-800 px-4 py-2 rounded-xl border border-sky-100/60 transition-all select-none shadow-sm">
                  <input
                    type="checkbox"
                    checked={showOnlyDue}
                    onChange={(e) => setShowOnlyDue(e.target.checked)}
                    className="h-4 w-4 rounded text-sky-600 accent-sky-600 cursor-pointer"
                  />
                  <span className="text-sm font-bold whitespace-nowrap">ط¥ط¸ظ‡ط§ط± ط§ظ„ظ…طھط¨ظ‚ظٹ ظپظ‚ط·</span>
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
                  <h3 className="text-lg font-bold text-slate-800 mb-2">ط§ط¨ط­ط« ط¹ظ† ط¹ظ…ظٹظ„ ظ„ط¹ط±ط¶ ظپظˆط§طھظٹط±ظ‡</h3>
                  <p className="text-slate-500 text-sm max-w-md mx-auto">ط§ظƒطھط¨ ط§ط³ظ… ط§ظ„ط¹ظ…ظٹظ„ ط£ظˆ ط±ظ‚ظ… ط§ظ„ظپط§طھظˆط±ط© ظپظٹ ط®ط§ظ†ط© ط§ظ„ط¨ط­ط« ط¨ط§ظ„ط£ط¹ظ„ظ‰طŒ ط£ظˆ ط§ط®طھط± ط¹ظ…ظٹظ„ ظ…ظ† ط§ظ„ظ‚ط§ط¦ظ…ط© ظ„ط¹ط±ط¶ ظƒط´ظپ ط­ط³ط§ط¨ظ‡ ظˆط­ط§ظ„ط© ط£ظ‚ط³ط§ط·ظ‡.</p>
                </div>
              ) : isInvoiceLoading ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-16 text-center shadow-sm">
                  <Clock3 size={40} className="text-sky-400 mx-auto mb-4 animate-pulse" />
                  <p className="text-slate-500 font-medium">ط¬ط§ط±ظٹ طھط­ظ…ظٹظ„ ظپظˆط§طھظٹط± ط§ظ„ط¹ظ…ظٹظ„...</p>
                </div>
              ) : filteredRows.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-16 text-center shadow-sm">
                  <Search size={40} className="text-slate-300 mx-auto mb-4" />
                  <p className="text-slate-500 font-medium">ظ„ط§ طھظˆط¬ط¯ ظ†طھط§ط¦ط¬ ظ…ط·ط§ط¨ظ‚ط© ظ„ظ„ط¨ط­ط« ط§ظ„ط­ط§ظ„ظٹ.</p>
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
                              {row.isSued && <span className="text-xs text-red-500 font-bold flex items-center gap-1"><AlertTriangle size={12} /> ظ…ط­ط§ظ„ ظ„ظ„ظ‚ط¶ط§ط، ظٹظ…ظ†ط¹ ط§ظ„طھط¹ط§ظ…ظ„</span>}
                            </div>
                            <div className="flex items-center gap-2 text-sm text-slate-500 mt-0.5">
                              <span>{row.customerPhone}</span>
                              <span className="w-1 h-1 bg-slate-300 rounded-full"></span>
                              <span>{row.customerAddress}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs pt-1">
                          <Badge>ظپط§طھظˆط±ط©: {row.invoiceNumber}</Badge>
                          <Badge>طھط§ط±ظٹط®: {formatDateDisplay(row.saleDate)}</Badge>
                          <Badge>{row.paymentMethod === 'installment' ? 'ط¯ظپط¹ ط¨ط§ظ„طھظ‚ط³ظٹط·' : 'ط؛ظٹط± ظ…ظ‚ط³ط·'}</Badge>
                        </div>
                      </div>

                      <div className="flex flex-col gap-4 items-end">
                        <button
                          onClick={() => handlePrint(row)}
                          className="flex items-center gap-2 rounded-xl bg-slate-100 px-4 py-2 text-base font-bold text-slate-700 hover:bg-slate-200 transition-colors"
                        >
                          <Printer size={16} /> ط·ط¨ط§ط¹ط© ط§ظ„ظƒط´ظپ
                        </button>
                        <div className="grid gap-2 sm:grid-cols-3 min-w-[320px]">
                          <SmallStat label="ط§ظ„ط¥ط¬ظ…ط§ظ„ظٹ" value={formatCurrency(row.total)} />
                          <SmallStat label="ط§ظ„ظ…ط¯ظپظˆط¹" value={formatCurrency(row.paid)} tone="green" />
                          <SmallStat
                            label="ط§ظ„ظ…طھط¨ظ‚ظٹ"
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
                                <p className="text-[10px] text-slate-400 font-bold">ط§ظ„ط£ظ‚ط³ط§ط· ط§ظ„ظ…ط¯ظپظˆط¹ط©</p>
                                <p className="text-xs font-semibold text-slate-700">{paidInstallments} ظ…ظ† {totalInstallments}</p>
                              </div>
                            </div>

                            {partialInstallments > 0 && (
                              <div className="bg-white px-3.5 py-2 rounded-lg border border-slate-200 shadow-sm flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center font-bold text-sm">
                                  {partialInstallments}
                                </div>
                                <div>
                                  <p className="text-[10px] text-slate-400 font-bold">ط£ظ‚ط³ط§ط· ظ…ط¯ظپظˆط¹ط© ط¬ط²ط¦ظٹط§ظ‹</p>
                                  <p className="text-xs font-semibold text-slate-700">{partialInstallments} ظ‚ط³ط·</p>
                                </div>
                              </div>
                            )}

                            <div className="bg-white px-3.5 py-2 rounded-lg border border-slate-200 shadow-sm flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center font-bold text-sm">
                                {unpaidInstallments}
                              </div>
                              <div>
                                <p className="text-[10px] text-slate-400 font-bold">ط§ظ„ط£ظ‚ط³ط§ط· ط§ظ„ظ…طھط¨ظ‚ظٹط©</p>
                                <p className="text-xs font-semibold text-slate-700">{unpaidInstallments} ظ‚ط³ط· ط؛ظٹط± ظ…ط¯ظپظˆط¹</p>
                              </div>
                            </div>
                          </div>

                          <div className="flex-1 min-w-[200px] bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
                            <div className="flex justify-between items-center mb-1.5 text-xs">
                              <span className="text-slate-500 font-bold">ظ†ط³ط¨ط© ط§ظ„طھط­طµظٹظ„ ظ…ظ† ط§ظ„ط£ظ‚ط³ط§ط·</span>
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
                              <p className="text-xs text-slate-500 mt-1">ط§ط³طھط­ظ‚ط§ظ‚: <span className="font-medium text-slate-700">{formatDateDisplay(schedule.dueDate)}</span></p>
                            </div>
                            <MonthBadge status={schedule.status} />
                          </div>

                          <div className="grid gap-2.5 text-sm">
                            <MonthRow icon={<Wallet size={15} />} label="ظ‚ظٹظ…ط© ط§ظ„ط´ظ‡ط±" value={formatCurrency(schedule.amount)} />
                            <MonthRow icon={<CheckCircle2 size={15} />} label="ط§ظ„ظ…ط¯ظپظˆط¹" value={formatCurrency(schedule.paidAmount)} />
                            <MonthRow
                              icon={<Clock3 size={15} />}
                              label="ط§ظ„ظ…طھط¨ظ‚ظٹ"
                              value={formatCurrency(Math.max(schedule.amount - schedule.paidAmount, 0))}
                              highlightValue={Math.max(schedule.amount - schedule.paidAmount, 0) > 0}
                            />
                            <MonthRow icon={<CalendarRange size={15} />} label="طھط§ط±ظٹط® ط§ظ„ط³ط¯ط§ط¯" value={formatDateDisplay(schedule.paidAt)} />
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
                <h3 className="text-red-800 font-bold text-lg flex items-center gap-2"><Gavel size={20} /> ط³ط¬ظ„ ط§ظ„ظ‚ط¶ط§ظٹط§ ظˆط§ظ„ظ†ط²ط§ط¹ط§طھ ط§ظ„ظ‚ط§ظ†ظˆظ†ظٹط©</h3>
                <p className="text-red-600 text-sm mt-1">ظ‡ط°ظ‡ ط§ظ„ظ‚ط§ط¦ظ…ط© ظ…ط®طµطµط© ظ„ظ„ظ…طھط§ط¨ط¹ط© ط§ظ„ظ‚ط§ظ†ظˆظ†ظٹط© ظˆظ„ظ„ظ…ط­ط§ظ…ظٹطŒ ظˆطھط¹ط±ط¶ ط¬ظ…ظٹط¹ ط§ظ„ط¹ظ…ظ„ط§ط، ط§ظ„ط°ظٹظ† طھظ… ط¥ط­ط§ظ„طھظ‡ظ… ظ„ظ„ظ‚ط¶ط§ط،.</p>
              </div>
              <button onClick={() => window.print()} className="h-10 px-6 bg-red-700 text-white rounded-xl hover:bg-red-800 flex items-center justify-center gap-2 font-bold text-sm shadow-sm transition-all whitespace-nowrap">
                <Printer size={16} />
                ط·ط¨ط§ط¹ط© ظƒط´ظپ ط§ظ„ظ…ط­ط§ظ…ظٹ
              </button>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full bg-white">
                  <thead className="bg-slate-50 text-slate-700 border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-4 text-right text-base font-bold">ط§ط³ظ… ط§ظ„ط¹ظ…ظٹظ„</th>
                      <th className="px-4 py-4 text-right text-base font-bold">ط±ظ‚ظ… ط§ظ„ظ‡ط§طھظپ</th>
                      <th className="px-4 py-4 text-right text-base font-bold">ط§ظ„ط¹ظ†ظˆط§ظ†</th>
                      <th className="px-4 py-4 text-right text-base font-bold text-center">ط§ظ„ظپظˆط§طھظٹط±</th>
                      <th className="px-4 py-4 text-right text-base font-bold text-center">طھط§ط±ظٹط® ط§ظ„ط¥ط­ط§ظ„ط©</th>
                      <th className="px-4 py-4 text-right text-base font-bold text-center">ط§ظ„ظ…ط¯ظٹظˆظ†ظٹط©</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {suedCustomersList.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-5 py-12 text-center text-slate-500">
                          <div className="flex flex-col items-center justify-center">
                            <CheckCircle2 size={40} className="text-slate-300 mb-3" />
                            <p>ظ„ط§ ظٹظˆط¬ط¯ ط£ظٹ ط¹ظ…ظ„ط§ط، ظپظٹ ط§ظ„ط´ط¦ظˆظ† ط§ظ„ظ‚ط§ظ†ظˆظ†ظٹط© ط­ط§ظ„ظٹط§ظ‹.</p>
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
                    ط¥ط¬ظ…ط§ظ„ظٹ ط¹ظ…ظ„ط§ط، ط§ظ„ط´ط¦ظˆظ† ط§ظ„ظ‚ط§ظ†ظˆظ†ظٹط©: <span className="text-slate-900 mx-1">{suedCustomersList.length}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-slate-500">ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ط¯ظٹظˆظ† ط§ظ„ظ…ط¹ظ„ظ‚ط© ط¨ط§ظ„ظ†ط²ط§ط¹ط§طھ:</span>
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
    paid: 'ظ…ط¯ظپظˆط¹',
    partial: 'ط¬ط²ط¦ظٹ',
    unpaid: 'ط؛ظٹط± ظ…ط¯ظپظˆط¹',
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
            <h2 className="text-3xl font-bold text-slate-800 border-b border-slate-300 pb-1 mb-1 inline-block">ظƒط´ظپ ط­ط³ط§ط¨ ط¹ظ…ظٹظ„</h2>
            <p className="text-slate-600 font-bold text-sm">طھط§ط±ظٹط® ط§ظ„ط·ط¨ط§ط¹ط©: {formatDateDisplay(new Date())}</p>
            <p className="text-slate-600 font-bold text-sm">ط±ظ‚ظ… ط§ظ„ظپط§طھظˆط±ط©: {invoice.invoiceNumber}</p>
            {invoice.salesRepName && (
              <p className="text-sky-700 font-bold text-sm">ط§ظ„ظ…ظ†ط¯ظˆط¨: {invoice.salesRepName}</p>
            )}
          </div>
        </div>

        {/* Customer Info */}
        <div className="flex flex-col gap-2 mb-4">
          <div className="border border-slate-300 p-3 rounded-lg bg-slate-50">
            <h3 className="font-bold text-base mb-2 text-slate-800 border-b border-slate-200 pb-1">ط¨ظٹط§ظ†ط§طھ ط§ظ„ط¹ظ…ظٹظ„</h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <p><span className="font-semibold text-slate-600 w-20 inline-block">ط§ط³ظ… ط§ظ„ط¹ظ…ظٹظ„:</span> {invoice.customerName}</p>
              <p><span className="font-semibold text-slate-600 w-20 inline-block">ط±ظ‚ظ… ط§ظ„ظ…ظˆط¨ط§ظٹظ„:</span> {invoice.customerPhone}</p>
              <p className="col-span-2"><span className="font-semibold text-slate-600 w-20 inline-block">ط§ظ„ط¹ظ†ظˆط§ظ†:</span> {invoice.customerAddress}</p>
            </div>
          </div>
        </div>

        {/* Financial Summary */}
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="border-2 border-slate-800 p-2 text-center rounded-lg">
            <p className="text-slate-600 font-bold mb-1 text-sm">ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ظپط§طھظˆط±ط©</p>
            <p className="text-xl font-black">{formatCurrency(invoice.total)}</p>
          </div>
          <div className="border-2 border-emerald-600 p-2 text-center rounded-lg bg-emerald-50">
            <p className="text-emerald-700 font-bold mb-1 text-sm">ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ظ…ط¯ظپظˆط¹</p>
            <p className="text-xl font-black text-emerald-800">{formatCurrency(invoice.paid)}</p>
          </div>
          <div className="border-2 border-red-600 p-2 text-center rounded-lg bg-red-50">
            <p className="text-red-700 font-bold mb-1 text-sm">ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ظ…طھط¨ظ‚ظٹ</p>
            <p className="text-xl font-black text-red-800">{formatCurrency(invoice.remaining)}</p>
          </div>
        </div>

        {/* Installments Table */}
        <div className="mb-4">
          <h3 className="font-bold text-lg mb-2 text-slate-900 border-b-2 border-slate-800 pb-1 inline-block">ط³ط¬ظ„ ط§ظ„ط£ظ‚ط³ط§ط· ظˆط§ظ„ط¯ظپط¹ط§طھ</h3>
          <table className="w-full text-right border-collapse border border-slate-300 text-sm">
            <thead>
              <tr className="bg-slate-200">
                <th className="border border-slate-300 px-1 py-1 font-bold">ط§ظ„ط¨ظٹط§ظ†</th>
                <th className="border border-slate-300 px-1 py-1 font-bold">ط§ظ„ط§ط³طھط­ظ‚ط§ظ‚</th>
                <th className="border border-slate-300 px-1 py-1 font-bold">طھط§ط±ظٹط® ط§ظ„ط¯ظپط¹</th>
                <th className="border border-slate-300 px-1 py-1 font-bold text-center">ط§ظ„ظ…ط¨ظ„ط؛</th>
                <th className="border border-slate-300 px-1 py-1 font-bold text-center">ط§ظ„ظ…ط¯ظپظˆط¹</th>
                <th className="border border-slate-300 px-1 py-1 font-bold text-center">ط§ظ„ظ…طھط¨ظ‚ظٹ</th>
                <th className="border border-slate-300 px-1 py-1 font-bold text-center">ط§ظ„ط­ط§ظ„ط©</th>
              </tr>
            </thead>
            <tbody>
              {invoice.schedules.map((schedule) => {
                const remaining = Math.max(schedule.amount - schedule.paidAmount, 0);
                const statusLabel = schedule.status === 'paid' ? 'ظ…ط¯ظپظˆط¹' : schedule.status === 'partial' ? 'ط¬ط²ط¦ظٹ' : 'ط؛ظٹط± ظ…ط¯ظپظˆط¹';
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
          <p>طھظ… ط§ط³طھط®ط±ط§ط¬ ظ‡ط°ط§ ط§ظ„ظƒط´ظپ ظ…ظ† ظ†ط¸ط§ظ… {settings.companyName} ظ„ظ„طھظ‚ط³ظٹط·</p>
        </div>
      </div>
    </div>
  );
}











