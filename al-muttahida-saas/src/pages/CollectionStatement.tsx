import React, { useEffect, useMemo, useState } from 'react';
import { Calendar, CalendarCheck, CalendarRange, CheckCircle2, Clock3, Search, UserRound, Wallet, LayoutList, FileText, Printer, User, Phone, MapPin, Briefcase, Shield, AlertTriangle, Gavel, ChevronDown, ChevronUp, RefreshCw, Eye, X, Package } from 'lucide-react';
import { Customer, Guarantor, InstallmentSchedule, Sale, Setting, SalesRep } from '../types';
import { getCustomers, getSales, getSalesReps, toggleCustomerSued } from '../lib/storage';
import { useAuth } from '../context/AuthContext';
import { useDialog } from '../context/DialogContext';
import { DatePicker } from '../components/DatePicker';
import { formatDateDisplay } from '../lib/dateUtils';
import { formatWholeCurrency } from '../lib/utils';
import { api, isApiMode } from '../lib/apiClient';
import LoadingState from '../components/LoadingState';

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
  totalInvoiceRemaining?: number;
}

interface DueCustomerRow {
  saleId: string;
  customerId?: string;
  invoiceNumber: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  customerNumber: string;
  installmentLabel: string;
  dueDate: string;
  installmentAmount: number;
  paidAmount?: number;
  remainingAmount: number;
  status: InstallmentSchedule['status'];
  paidAt?: string;
  guarantors: (Guarantor | null)[];
  salesRepId?: string;
  salesRepName?: string;
  isSued?: boolean;
  lastPaymentDate?: string;
  totalInvoiceRemaining?: number;
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

const getDefaultDueRange = () => {
  return getCurrentMonthRange();
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
  const { settings, user } = useAuth();
  const { confirmDialog, showToast } = useDialog();
  const currentMonthRange = useMemo(() => getCurrentMonthRange(), []);
  const defaultDueRange = useMemo(() => getDefaultDueRange(), []);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [invoiceSales, setInvoiceSales] = useState<Sale[]>([]);
  const [isInvoiceLoading, setIsInvoiceLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'due' | 'invoices' | 'legal'>('due');

  const [invoiceSearchTerm, setInvoiceSearchTerm] = useState('');
  const [dueSearchTerm, setDueSearchTerm] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState('all');
  const [showOnlyDue, setShowOnlyDue] = useState(false);
  const [hideSuedCustomers, setHideSuedCustomers] = useState(false);
  const [includeOverdue, setIncludeOverdue] = useState(false);

  const [dueFromDate, setDueFromDate] = useState(defaultDueRange.from);
  const [dueToDate, setDueToDate] = useState(defaultDueRange.to);
  const [selectedSalesRepId, setSelectedSalesRepId] = useState('all');
  const [salesReps, setSalesReps] = useState<SalesRep[]>([]);
  const [printingInvoice, setPrintingInvoice] = useState<CollectionInvoiceView | null>(null);
  const [printingLegalReport, setPrintingLegalReport] = useState(false);
  // Status & Date Basis filters: 'unpaid' | 'paid' | 'all'
  const [dueStatusFilter, setDueStatusFilter] = useState<'unpaid' | 'paid' | 'all'>('unpaid');
  const [dueDateBasis, setDueDateBasis] = useState<'actual_payment' | 'due_date'>('actual_payment');
  // Modal & pagination states for "due" tab
  const [selectedCustomerModal, setSelectedCustomerModal] = useState<DueCustomerRow[] | null>(null);
  const [expandedCustomerSaleId, setExpandedCustomerSaleId] = useState<string | null>(null);
  const [userPageSizePreference, setUserPageSizePreference] = useState<'auto' | number>('auto');
  const [dueCurrentPage, setDueCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(8);
  const tableContainerRef = React.useRef<HTMLDivElement>(null);

  // Dedicated API state for dues
  const [apiDues, setApiDues] = useState<DueCustomerRow[]>([]);
  const [isDueLoading, setIsDueLoading] = useState(false);
  const [dueError, setDueError] = useState<string | null>(null);

  useEffect(() => {
    if (!isApiMode()) return;
    let isCancelled = false;

    const fetchDues = async () => {
      setIsDueLoading(true);
      setDueError(null);
      try {
        const data = await api.listCollectionDue({
          from: dueFromDate,
          to: dueToDate,
          search: dueSearchTerm,
          salesRepId: selectedSalesRepId,
          hideSued: hideSuedCustomers,
          includeOverdue: includeOverdue,
          strictDate: !includeOverdue,
          statusFilter: dueStatusFilter,
          dateBasis: dueStatusFilter === 'paid' ? dueDateBasis : 'due_date',
        });
        if (!isCancelled) {
          setApiDues(data);
        }
      } catch (err: any) {
        if (!isCancelled) {
          console.error('Failed to load due collection data:', err);
          setDueError(err.message || 'تعذر تحميل بيانات المستحقات');
        }
      } finally {
        if (!isCancelled) {
          setIsDueLoading(false);
        }
      }
    };

    void fetchDues();

    return () => {
      isCancelled = true;
    };
  }, [dueFromDate, dueToDate, dueSearchTerm, selectedSalesRepId, hideSuedCustomers, includeOverdue, dueStatusFilter, dueDateBasis]);

  // Dynamic screen-fitting page size
  useEffect(() => {
    const calculateExactPageSize = () => {
      if (userPageSizePreference !== 'auto') {
        setPageSize(userPageSizePreference);
        return;
      }

      let availableHeight = 0;
      if (tableContainerRef.current) {
        const containerHeight = tableContainerRef.current.clientHeight;
        if (containerHeight > 80) {
          // Subtract table sticky header height (~38px)
          availableHeight = containerHeight - 38;
        }
      }

      if (!availableHeight || availableHeight < 100) {
        // Fallback calculation from window.innerHeight
        availableHeight = Math.max(150, window.innerHeight - 380);
      }

      // Measured row height: ~57px with two-line financial amount and avatar
      const rowHeight = 57;
      const computedRows = Math.max(3, Math.floor(availableHeight / rowHeight));
      setPageSize(computedRows);
    };

    calculateExactPageSize();
    const rafId = requestAnimationFrame(calculateExactPageSize);

    const handleResize = () => calculateExactPageSize();
    window.addEventListener('resize', handleResize);

    let observer: ResizeObserver | null = null;
    if (tableContainerRef.current && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        calculateExactPageSize();
      });
      observer.observe(tableContainerRef.current);
    }

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleResize);
      observer?.disconnect();
    };
  }, [userPageSizePreference, activeTab]);

  // Reset pagination when filters change
  useEffect(() => {
    setDueCurrentPage(1);
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

  const handleToggleLegalCustomer = async (customerId: string, nextIsSued: boolean) => {
    const customer = customers.find(c => c.id === customerId);
    if (!customer) return;
    const isConfirmed = await confirmDialog({
      title: nextIsSued ? 'تحويل للشئون القانونية' : 'إلغاء الإحالة القضائية',
      message: nextIsSued
        ? `هل أنت متأكد من تحويل العميل "${customer.name}" للشئون القانونية (النزاعات)؟`
        : `هل أنت متأكد من إلغاء تحويل العميل "${customer.name}" من الشئون القانونية؟`,
      confirmText: nextIsSued ? 'تحويل للقضاء' : 'إلغاء النزاع',
      type: nextIsSued ? 'warning' : 'info',
    });
    if (!isConfirmed) return;

    // Optimistic update: reflect change in UI immediately
    const now = new Date().toISOString();
    setCustomers(prev => prev.map(c =>
      c.id === customerId
        ? { ...c, isSued: nextIsSued, suedDate: nextIsSued ? (c.suedDate || now) : undefined, updatedAt: now }
        : c
    ));

    try {
      if (isApiMode()) {
        // Call the dedicated PATCH endpoint directly for speed and reliability
        await api.toggleCustomerSued(customerId, nextIsSued, nextIsSued ? now : undefined);
        // Re-fetch to sync with server truth
        const apiCustomers = await api.listCustomers();
        setCustomers(apiCustomers);
      } else {
        await toggleCustomerSued(customerId, nextIsSued, nextIsSued ? now : undefined);
        // Re-read from storage after write
        setCustomers([...getCustomers()]);
      }
    } catch (err: any) {
      // Rollback optimistic update on failure
      setCustomers(prev => prev.map(c =>
        c.id === customerId
          ? { ...c, isSued: customer.isSued, suedDate: customer.suedDate, updatedAt: customer.updatedAt }
          : c
      ));
      alert(err.message || 'حدث خطأ أثناء تحديث حالة الشئون القانونية.');
    }
  };

  const invoiceLookupTerm = invoiceSearchTerm.trim();
  const hasInvoiceLookup = selectedCustomerId !== 'all' || invoiceLookupTerm.length >= 3;

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

        const isInstallment = sale.financing?.paymentMethod === 'installment' ||
          Boolean(sale.financing?.installmentMonths && sale.financing.installmentMonths > 1) ||
          Boolean(sale.financing?.schedules && sale.financing.schedules.length > 1);

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
          paymentMethod: isInstallment ? 'installment' : (sale.financing?.paymentMethod || 'cash'),
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

      const isInstallment = sale.financing?.paymentMethod === 'installment' ||
        Boolean(sale.financing?.installmentMonths && sale.financing.installmentMonths > 1) ||
        Boolean(sale.financing?.schedules && sale.financing.schedules.length > 1);

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
        paymentMethod: isInstallment ? 'installment' : (sale.financing?.paymentMethod || 'cash'),
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
    if (isApiMode()) {
      return apiDues;
    }

    if (!dueFromDate || !dueToDate || dueFromDate > dueToDate) return [];

    const result: DueCustomerRow[] = [];

    rows.forEach((row) => {
      if (hideSuedCustomers && row.isSued) return;
      if (dueStatusFilter === 'unpaid' && row.remaining <= 0.01) return;

      row.schedules.forEach((schedule) => {
        const isPaid = schedule.status === 'paid' || (schedule.paidAmount >= schedule.amount);
        if (dueStatusFilter === 'unpaid' && isPaid) return;
        if (dueStatusFilter === 'paid' && !isPaid) return;

        const remaining = Math.max(schedule.amount - schedule.paidAmount, 0);
        if (dueStatusFilter === 'unpaid' && remaining <= 0.01) return;

        const normalizedDueDate = toISODateOnly(schedule.dueDate);
        const normalizedPaidDate = schedule.paidAt ? toISODateOnly(schedule.paidAt) : null;

        if (dueStatusFilter === 'unpaid') {
          if (includeOverdue) {
            if (normalizedDueDate && dueToDate && normalizedDueDate > dueToDate) return;
          } else {
            if (!normalizedDueDate || (dueFromDate && normalizedDueDate < dueFromDate) || (dueToDate && normalizedDueDate > dueToDate)) return;
          }
        } else if (dueStatusFilter === 'paid') {
          const dateToCheck = dueDateBasis === 'actual_payment' ? (normalizedPaidDate || normalizedDueDate) : normalizedDueDate;
          if (!dateToCheck || (dueFromDate && dateToCheck < dueFromDate) || (dueToDate && dateToCheck > dueToDate)) return;
        } else {
          const dateToCheck = dueDateBasis === 'actual_payment' && isPaid ? (normalizedPaidDate || normalizedDueDate) : normalizedDueDate;
          if (!dateToCheck || (dueFromDate && dateToCheck < dueFromDate) || (dueToDate && dateToCheck > dueToDate)) return;
        }

        result.push({
          saleId: row.saleId,
          invoiceNumber: row.invoiceNumber,
          customerName: row.customerName,
          customerPhone: row.customerPhone,
          customerAddress: row.customerAddress,
          customerNumber: customerMap.get(row.customerId)?.customerNumber || '',
          installmentLabel: schedule.label,
          dueDate: toISODateOnly(schedule.dueDate),
          installmentAmount: schedule.amount,
          paidAmount: schedule.paidAmount,
          remainingAmount: remaining,
          status: schedule.status,
          paidAt: schedule.paidAt,
          lastPaymentDate: row.lastPaymentDate,
          guarantors: customerMap.get(row.customerId)?.guarantors || [],
          salesRepId: row.salesRepId,
          salesRepName: row.salesRepName,
          isSued: customerMap.get(row.customerId)?.isSued || false,
          totalInvoiceRemaining: row.remaining,
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
  }, [apiDues, dueFromDate, dueToDate, dueSearchTerm, rows, selectedSalesRepId, customerMap, hideSuedCustomers, includeOverdue, dueStatusFilter, dueDateBasis]);

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

  const { totalInstallmentsAmount, totalPaidAmount, totalRemainingAmount, collectionRate } = useMemo(() => {
    let instTotal = 0;
    let paidTotal = 0;
    let remTotal = 0;
    dueRows.forEach((r) => {
      instTotal += r.installmentAmount || 0;
      const paid = r.status === 'paid' ? r.installmentAmount : (r.paidAmount || Math.max(0, (r.installmentAmount || 0) - (r.remainingAmount || 0)));
      paidTotal += paid;
      remTotal += r.remainingAmount || 0;
    });
    const rate = instTotal > 0 ? Math.round((paidTotal / instTotal) * 100) : 0;
    return {
      totalInstallmentsAmount: instTotal,
      totalPaidAmount: paidTotal,
      totalRemainingAmount: remTotal,
      collectionRate: rate,
    };
  }, [dueRows]);

  const dueTotalInPeriod = dueStatusFilter === 'paid' ? totalPaidAmount : totalRemainingAmount;

  const formatCurrency = (amount: number) => formatWholeCurrency(amount, settings.currency);

  useEffect(() => {
    const handleAfterPrint = () => {
      setPrintingInvoice(null);
    };
    window.addEventListener('afterprint', handleAfterPrint);
    return () => window.removeEventListener('afterprint', handleAfterPrint);
  }, []);

  const handlePrint = (invoice: CollectionInvoiceView) => {
    setPrintingInvoice(invoice);
    setTimeout(() => window.print(), 150);
  };

  return (
    <>
      <style>{`
      @media print {
        /* Completely hide dashboard UI components, navigation, buttons, cards in print mode */
        .desktop-view-container,
        .desktop-table-card,
        .no-print,
        .print\\:hidden,
        nav,
        aside,
        header,
        button,
        input,
        select {
          display: none !important;
          visibility: hidden !important;
          height: 0 !important;
          margin: 0 !important;
          padding: 0 !important;
        }

        html, body, #root, main {
          height: auto !important;
          min-height: 0 !important;
          max-height: none !important;
          overflow: visible !important;
          background: white !important;
          padding: 0 !important;
          margin: 0 !important;
        }

        /* Isolate the printable statement templates */
        .invoice-page,
        .due-print-page {
          display: block !important;
          visibility: visible !important;
          width: 100% !important;
          max-width: 100% !important;
          margin: 0 auto !important;
          padding: 0 !important;
          background: white !important;
        }

        .invoice-page *,
        .due-print-page * {
          visibility: visible !important;
        }

        table {
          min-width: 0 !important;
          width: 100% !important;
          table-layout: fixed !important;
          border-collapse: collapse !important;
        }

        tr {
          page-break-inside: avoid !important;
          break-inside: avoid !important;
        }

        th, td {
          padding: 6px 8px !important;
          font-size: 11px !important;
          word-break: normal !important;
          overflow-wrap: break-word !important;
        }
      }
    `}</style>
      <div className="desktop-view-container print:hidden">
        {/* Header/Tabs & Filters Bar */}
        <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 space-y-2.5 shrink-0 print:hidden shadow-xs">
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
            <div className="space-y-3 pt-1">
              {/* Row 1: Primary Scope (Status Capsule) & Search Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                {/* Right: Main Status Segmented Capsule */}
                <div className="inline-flex h-9 items-center rounded-xl border border-slate-200 bg-slate-100/90 p-0.5 text-xs font-bold shadow-2xs shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setDueStatusFilter('unpaid');
                      setDueCurrentPage(1);
                      setExpandedCustomerSaleId(null);
                      setIncludeOverdue(false);
                    }}
                    className={`h-full px-3.5 rounded-lg transition-all flex items-center gap-1.5 ${
                      dueStatusFilter === 'unpaid'
                        ? 'bg-white text-rose-700 shadow-2xs font-black'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${dueStatusFilter === 'unpaid' ? 'bg-rose-500 ring-2 ring-rose-200' : 'bg-slate-300'}`} />
                    <span>غير محصل</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDueStatusFilter('paid');
                      setDueCurrentPage(1);
                      setExpandedCustomerSaleId(null);
                      setIncludeOverdue(false);
                    }}
                    className={`h-full px-3.5 rounded-lg transition-all flex items-center gap-1.5 ${
                      dueStatusFilter === 'paid'
                        ? 'bg-white text-emerald-700 shadow-2xs font-black'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${dueStatusFilter === 'paid' ? 'bg-emerald-500 ring-2 ring-emerald-200' : 'bg-slate-300'}`} />
                    <span>تم تحصيله</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDueStatusFilter('all');
                      setDueDateBasis('due_date');
                      setDueCurrentPage(1);
                      setExpandedCustomerSaleId(null);
                      setIncludeOverdue(false);
                    }}
                    className={`h-full px-3.5 rounded-lg transition-all flex items-center gap-1.5 ${
                      dueStatusFilter === 'all'
                        ? 'bg-white text-sky-700 shadow-2xs font-black'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${dueStatusFilter === 'all' ? 'bg-sky-500 ring-2 ring-sky-200' : 'bg-slate-300'}`} />
                    <span>الكل</span>
                  </button>
                </div>

                {/* Left: Wide, Elegant Search Input */}
                <div className="relative flex-1 max-w-md min-w-[260px]">
                  <Search size={15} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <input
                    value={dueSearchTerm}
                    onChange={(e) => { setDueSearchTerm(e.target.value); setDueCurrentPage(1); setExpandedCustomerSaleId(null); }}
                    className="w-full h-9 rounded-xl border border-slate-200 bg-slate-50/70 hover:bg-white focus:bg-white px-3 pr-10 pl-8 text-xs font-medium outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition placeholder:text-slate-400 shadow-2xs"
                    placeholder="بحث سريع باسم العميل، الهاتف، أو رقم الفاتورة..."
                  />
                  {dueSearchTerm && (
                    <button
                      type="button"
                      onClick={() => { setDueSearchTerm(''); setDueCurrentPage(1); }}
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-sm font-bold w-4 h-4 flex items-center justify-center rounded-full hover:bg-slate-200"
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>

              {/* Row 2: Secondary Refinements (Date Range, Date Logic, Sales Rep, Toggles, Print) */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-2 border-t border-slate-100">
                {/* Right: Date Range + Attached Date Basis (only in Paid tab) + Sales Rep */}
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Date Range Group (Height h-9 unified) */}
                  <div className="flex h-9 items-center gap-1.5 bg-white border border-slate-200 rounded-xl px-2.5 text-xs shadow-2xs">
                    <Calendar size={14} className="text-slate-400 shrink-0" />
                    <span className="text-[11px] text-slate-400 font-bold">الفترة:</span>
                    <DatePicker value={dueFromDate} onChange={(d) => { setDueFromDate(d); setDueCurrentPage(1); }} className="h-7 w-[115px] rounded-lg border-0 bg-slate-50 text-xs font-bold text-slate-700 text-center" />
                    <span className="text-[11px] text-slate-300 font-bold px-0.5">←</span>
                    <DatePicker value={dueToDate} onChange={(d) => { setDueToDate(d); setDueCurrentPage(1); }} className="h-7 w-[115px] rounded-lg border-0 bg-slate-50 text-xs font-bold text-slate-700 text-center" />
                  </div>

                  {/* Date Basis Switcher: Only shown in 'paid' page as requested */}
                  {dueStatusFilter === 'paid' && (
                    <div className="inline-flex h-9 items-center rounded-xl border border-slate-200 bg-slate-50 p-0.5 text-xs font-bold shadow-2xs animate-in fade-in duration-200">
                      <button
                        type="button"
                        onClick={() => { setDueDateBasis('actual_payment'); setDueCurrentPage(1); setExpandedCustomerSaleId(null); }}
                        className={`h-full px-2.5 rounded-lg transition-all text-[11px] flex items-center gap-1.5 ${
                          dueDateBasis === 'actual_payment'
                            ? 'bg-white text-emerald-700 shadow-2xs font-black'
                            : 'text-slate-500 hover:text-slate-800'
                        }`}
                        title="فلترة بحسب تاريخ السداد والتحصيل الفعلي بالخزينة"
                      >
                        <CheckCircle2 size={12} className={dueDateBasis === 'actual_payment' ? 'text-emerald-600' : 'text-slate-400'} />
                        <span>السداد الفعلي</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => { setDueDateBasis('due_date'); setDueCurrentPage(1); setExpandedCustomerSaleId(null); }}
                        className={`h-full px-2.5 rounded-lg transition-all text-[11px] flex items-center gap-1.5 ${
                          dueDateBasis === 'due_date'
                            ? 'bg-white text-sky-700 shadow-2xs font-black'
                            : 'text-slate-500 hover:text-slate-800'
                        }`}
                        title="فلترة بحسب موعد استحقاق القسط الشهري"
                      >
                        <Clock3 size={12} className={dueDateBasis === 'due_date' ? 'text-sky-600' : 'text-slate-400'} />
                        <span>تاريخ الاستحقاق</span>
                      </button>
                    </div>
                  )}

                  {/* Sales Rep Selector: Clean, professional, NO emoji */}
                  <select
                    value={selectedSalesRepId}
                    onChange={(e) => { setSelectedSalesRepId(e.target.value); setDueCurrentPage(1); setExpandedCustomerSaleId(null); }}
                    className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-700 font-bold outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition min-w-[120px] shadow-2xs cursor-pointer"
                  >
                    <option value="all">كل المناديب</option>
                    {salesReps.map((rep) => (
                      <option key={rep.id} value={rep.id}>
                        {rep.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Left: Action Toggles & Print Button */}
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Include Overdue Toggle: Non-default (default = false). Shown only in unpaid tab */}
                  {dueStatusFilter === 'unpaid' && (
                    <button
                      type="button"
                      onClick={() => {
                        setIncludeOverdue(!includeOverdue);
                        setDueCurrentPage(1);
                        setExpandedCustomerSaleId(null);
                      }}
                      className={`flex items-center gap-1.5 px-3 h-9 rounded-xl border text-xs font-bold whitespace-nowrap transition-all shadow-2xs cursor-pointer ${
                        includeOverdue
                          ? 'border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100/70 ring-1 ring-indigo-200'
                          : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-600'
                      }`}
                      title={includeOverdue ? 'إلغاء المتأخرات والاكتفاء بأقساط الشهر المحدد فقط' : 'إدراج كافة الأقساط المتأخرة غير المسددة من الأشهر السابقة'}
                    >
                      <Clock3 size={13} className={includeOverdue ? 'text-indigo-600' : 'text-slate-400'} />
                      <span>شامل المتأخرات</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-black ${includeOverdue ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                        {includeOverdue ? 'مفعل' : 'مغلق'}
                      </span>
                    </button>
                  )}

                  {/* Hide Lawsuits Toggle */}
                  <button
                    type="button"
                    onClick={() => {
                      setHideSuedCustomers(!hideSuedCustomers);
                      setDueCurrentPage(1);
                      setExpandedCustomerSaleId(null);
                    }}
                    className={`flex items-center gap-1.5 px-3 h-9 rounded-xl border text-xs font-bold whitespace-nowrap transition-all shadow-2xs cursor-pointer ${
                      hideSuedCustomers
                        ? 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100/70'
                        : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-600'
                    }`}
                    title={hideSuedCustomers ? 'إلغاء إخفاء القضايا' : 'إخفاء العملاء المحالين للشئون القانونية (القضاء)'}
                  >
                    <AlertTriangle size={13} className={hideSuedCustomers ? 'text-red-500' : 'text-slate-400'} />
                    <span>إخفاء القضايا</span>
                    {hideSuedCustomers && (
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
                    )}
                  </button>

                  {/* Print Button */}
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="h-9 px-4 bg-sky-600 text-white rounded-xl hover:bg-sky-700 flex items-center gap-1.5 font-bold text-xs shadow-2xs transition-all whitespace-nowrap cursor-pointer active:scale-95"
                    title="طباعة كشف التحصيل الحالي"
                  >
                    <Printer size={13} />
                    <span>طباعة</span>
                  </button>
                </div>
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
          <div className="desktop-table-card animate-in fade-in slide-in-from-bottom-2 duration-300 print:hidden">
            {dueFromDate > dueToDate && (
              <div className="border-b border-red-200 bg-red-50 px-5 py-2.5 text-sm text-red-700 shrink-0">
                تاريخ البداية يجب أن يكون قبل تاريخ النهاية.
              </div>
            )}

            {/* Scrollable Table Body */}
            <div
              ref={tableContainerRef}
              className={`desktop-table-scroll ${userPageSizePreference === 'auto' ? 'overflow-y-hidden overflow-x-auto' : 'overflow-auto'}`}
            >
              <table className="w-full text-right text-xs border-collapse">
                <thead className="desktop-sticky-header">
                  <tr>
                    <th className="px-5 py-2.5 text-right">العميل</th>
                    <th className="px-4 py-2.5 text-right">الهاتف</th>
                    <th className="px-4 py-2.5 text-right">المندوب</th>
                    <th className="px-4 py-2.5 text-center">
                      {dueStatusFilter === 'paid' ? 'تاريخ التحصيل' : (dueStatusFilter === 'all' ? 'تاريخ الاستحقاق / السداد' : 'تاريخ الاستحقاق')}
                    </th>
                    <th className="px-4 py-2.5 text-center">
                      {dueStatusFilter === 'paid' ? 'المبلغ المحصل' : (dueStatusFilter === 'all' ? 'القسط / المحصل' : 'القسط الشهري المستحق')}
                    </th>
                  </tr>
                </thead>
                  <tbody className="divide-y divide-slate-100">
                    {isDueLoading ? (
                      <LoadingState variant="table" colSpan={5} />
                    ) : dueError ? (
                      <tr>
                        <td colSpan={5} className="px-5 py-8 text-center text-red-600 font-bold">
                          <div className="flex flex-col items-center justify-center gap-1">
                            <AlertTriangle size={28} className="text-red-500 mb-1" />
                            <p>{dueError}</p>
                          </div>
                        </td>
                      </tr>
                    ) : groupedDueRows.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-5 py-12 text-center text-slate-400 font-bold">
                          <div className="flex flex-col items-center justify-center">
                            <CheckCircle2 size={36} className="text-slate-300 mb-2" />
                            <p className="text-sm font-bold text-slate-600 mb-1">
                              {dueStatusFilter === 'paid' ? 'لا توجد أقساط مسددة في هذه الفترة' : 'لا توجد أقساط مستحقة للفترة المحددة'}
                            </p>
                            <p className="text-xs text-slate-400 font-normal">
                              {dueStatusFilter === 'paid' ? 'يمكنك تبديل خيار تاريخ الفلترة أو توسيع نطاق التاريخ.' : 'يمكنك تفعيل خيار "شامل المتأخرات" بالأعلى لعرض كافة المستحقات السابقة، أو تعديل نطاق التاريخ.'}
                            </p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      paginatedGroupedDueRows.map((group) => {
                        const totalRemaining = group.reduce((sum, r) => sum + r.remainingAmount, 0);
                        const totalPaidInGroup = group.reduce((sum, r) => sum + (r.status === 'paid' ? r.installmentAmount : (r.paidAmount || (r.installmentAmount - r.remainingAmount))), 0);
                        const isAllPaid = group.every((r) => r.status === 'paid' || r.remainingAmount <= 1);
                        const isPartial = !isAllPaid && group.some((r) => (r.paidAmount && r.paidAmount > 0) || r.status === 'paid');
                        const actualPaidDate = group[0].paidAt || group[0].lastPaymentDate;

                        return (
                          <tr
                            key={group[0].saleId}
                            onClick={() => setSelectedCustomerModal(group)}
                            className="hover:bg-sky-50/70 transition-colors cursor-pointer select-none group"
                            title="اضغط على أي عميل لعرض كافة بياناته والضامنين وجدول الأقساط"
                          >
                            <td className="px-4 py-2 sm:py-2.5">
                              <div className="flex items-center gap-2.5">
                                <div className={`w-7.5 h-7.5 rounded-full flex items-center justify-center shrink-0 ${group[0].isSued ? 'bg-red-50 text-red-500' : (isAllPaid ? 'bg-emerald-50 text-emerald-600' : 'bg-sky-50 text-sky-500 group-hover:bg-sky-100 group-hover:text-sky-600')}`}>
                                  {group[0].isSued ? <Gavel size={13} /> : (isAllPaid ? <CheckCircle2 size={14} /> : <User size={13} />)}
                                </div>
                                <div className="flex flex-col">
                                  <span className={`font-bold text-slate-800 text-xs sm:text-sm group-hover:text-sky-600 transition-colors ${group[0].isSued ? 'text-red-500 line-through' : ''}`}>
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
                            <td className="px-4 py-2 sm:py-2.5 text-slate-600 font-semibold font-mono text-xs">{group[0].customerPhone}</td>
                            <td className="px-4 py-2 sm:py-2.5">
                              <div className="flex items-center gap-1.5 text-slate-700">
                                <Briefcase size={12} className="text-slate-400 shrink-0" />
                                <span className="font-semibold text-xs">{group[0].salesRepName || '---'}</span>
                              </div>
                            </td>
                            <td className="px-4 py-2 sm:py-2.5 text-center">
                              {isAllPaid ? (
                                <span className="font-bold text-emerald-800 text-[11px] bg-emerald-50 border border-emerald-200/80 px-2 py-0.5 rounded-md inline-flex items-center gap-1 shadow-2xs">
                                  <CheckCircle2 size={11} className="text-emerald-600" />
                                  {actualPaidDate ? formatDateDisplay(actualPaidDate) : 'تم التحصيل'}
                                </span>
                              ) : (
                                <span className="font-bold text-slate-800 text-[11px] bg-slate-100/90 px-2 py-0.5 rounded-md border border-slate-200/70 inline-flex items-center gap-1 shadow-2xs">
                                  <Calendar size={11} className="text-slate-500" />
                                  {formatDateDisplay(group[0].dueDate)}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2 sm:py-2.5 text-center">
                              <div className="flex flex-col items-center">
                                {isAllPaid ? (
                                  <>
                                    <span className="text-emerald-700 text-xs sm:text-sm font-black flex items-center gap-1">
                                      <span className="text-[9px] bg-emerald-100 text-emerald-800 px-1 py-0.2 rounded font-bold">تم السداد</span>
                                      {formatCurrency(totalPaidInGroup)}
                                    </span>
                                    <span className="text-[9px] text-emerald-600 font-medium whitespace-nowrap">
                                      مسدد بالكامل
                                    </span>
                                  </>
                                ) : isPartial ? (
                                  <>
                                    <span className="text-amber-700 text-xs sm:text-sm font-black">
                                      {formatCurrency(totalRemaining)}
                                    </span>
                                    <span className="text-[9px] text-amber-600 font-medium whitespace-nowrap">
                                      متبقي (سُدد: {formatCurrency(totalPaidInGroup)})
                                    </span>
                                  </>
                                ) : (
                                  <>
                                    <span className="text-red-600 text-xs sm:text-sm font-black">{formatCurrency(totalRemaining)}</span>
                                    {group[0].totalInvoiceRemaining !== undefined && group[0].totalInvoiceRemaining > totalRemaining && (
                                      <span className="text-[9px] text-slate-400 font-medium whitespace-nowrap">
                                        متبقي العقد: {formatCurrency(group[0].totalInvoiceRemaining)}
                                      </span>
                                    )}
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
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
                  {dueStatusFilter === 'unpaid' && (
                    <>
                      <span>أقساط مستحقة: <span className="text-slate-900 font-black">{dueRows.length}</span></span>
                      <span className="w-px h-4 bg-slate-200"></span>
                      <span>عملاء: <span className="text-slate-900 font-black">{groupedDueRows.length}</span></span>
                      <span className="w-px h-4 bg-slate-200"></span>
                      <span>إجمالي المستحق: <span className="text-red-600 font-black">{formatCurrency(dueTotalInPeriod)}</span></span>
                    </>
                  )}
                  {dueStatusFilter === 'paid' && (
                    <>
                      <span>أقساط محصلة: <span className="text-slate-900 font-black">{dueRows.length}</span></span>
                      <span className="w-px h-4 bg-slate-200"></span>
                      <span>عملاء: <span className="text-slate-900 font-black">{groupedDueRows.length}</span></span>
                      <span className="w-px h-4 bg-slate-200"></span>
                      <span>إجمالي المحصل: <span className="text-emerald-600 font-black">{formatCurrency(totalPaidAmount)}</span></span>
                    </>
                  )}
                  {dueStatusFilter === 'all' && (
                    <>
                      <span>الأقساط: <span className="text-slate-900 font-black">{dueRows.length}</span></span>
                      <span className="w-px h-4 bg-slate-200"></span>
                      <span>محصل: <span className="text-emerald-600 font-black">{formatCurrency(totalPaidAmount)}</span></span>
                      <span className="w-px h-4 bg-slate-200"></span>
                      <span>متبقي: <span className="text-red-600 font-black">{formatCurrency(totalRemainingAmount)}</span></span>
                      <span className="w-px h-4 bg-slate-200"></span>
                      <span className="inline-flex items-center gap-1">
                        التحصيل:
                        <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-black border border-emerald-200 text-[11px]">
                          {collectionRate}%
                        </span>
                      </span>
                    </>
                  )}
                </div>

                {/* Center: Pagination — always centered */}
                <div className="flex items-center justify-center">
                  {totalDuePages > 1 ? (
                    <nav className="inline-flex items-center gap-1" aria-label="Pagination">
                      <button
                        disabled={dueCurrentPage === 1}
                        onClick={() => setDueCurrentPage((prev) => Math.max(prev - 1, 1))}
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
                            onClick={() => setDueCurrentPage(page as number)}
                            className={`h-7 w-7 rounded-md text-[11px] font-bold transition-all ${
                              dueCurrentPage === page
                                ? 'bg-blue-600 text-white'
                                : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            {page}
                          </button>
                        );
                      })}
                      <button
                        disabled={dueCurrentPage === totalDuePages}
                        onClick={() => setDueCurrentPage((prev) => Math.min(prev + 1, totalDuePages))}
                        className="h-7 px-2 rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-[11px] font-bold transition-all"
                      >
                        التالي
                      </button>
                    </nav>
                  ) : (
                    <span></span>
                  )}
                </div>

                {/* Left: Range indicator & Page size selector */}
                <div className="flex items-center justify-end gap-2.5">
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-slate-400 font-bold">العدد:</span>
                    <select
                      value={userPageSizePreference}
                      onChange={(e) => {
                        const val = e.target.value === 'auto' ? 'auto' : Number(e.target.value);
                        setUserPageSizePreference(val);
                        setDueCurrentPage(1);
                      }}
                      className="h-6 px-1.5 rounded border border-slate-200 bg-white text-[10px] font-bold text-slate-700 outline-none cursor-pointer hover:border-slate-300 shadow-2xs"
                      title="تحديد عدد العملاء المعروضين بالصفحة ليناسب شاشتك"
                    >
                      <option value="auto">ملء الشاشة تلقائياً</option>
                      <option value="6">6 عملاء</option>
                      <option value="8">8 عملاء</option>
                      <option value="10">10 عملاء</option>
                      <option value="12">12 عميل</option>
                      <option value="15">15 عميل</option>
                      <option value="20">20 عميل</option>
                    </select>
                  </div>
                  <p className="text-[11px] text-slate-500 font-bold whitespace-nowrap">
                    عرض <span className="text-slate-900">{(dueCurrentPage - 1) * pageSize + 1}</span> - <span className="text-slate-900">{Math.min(groupedDueRows.length, dueCurrentPage * pageSize)}</span> من <span className="text-slate-900">{groupedDueRows.length}</span>
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB CONTENT: INVOICES */}
        {activeTab === 'invoices' && (
          <div className="desktop-table-card p-3 flex flex-col flex-1 min-h-0 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300 print:hidden">
            {/* Invoice Cards Container */}
            <div className={`flex-1 min-h-0 ${filteredRows.length > 1 ? 'overflow-y-auto space-y-4 pr-1 block' : 'flex flex-col'}`}>
              {!hasInvoiceLookup ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-gradient-to-b from-slate-50 to-white p-16 text-center shadow-sm">
                  <div className="w-16 h-16 rounded-2xl bg-sky-50 flex items-center justify-center mx-auto mb-5">
                    <Search size={32} className="text-sky-400" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-800 mb-2">ابحث عن عميل لعرض فواتيره</h3>
                  <p className="text-slate-500 text-sm max-w-md mx-auto">اكتب اسم العميل أو رقم الفاتورة في خانة البحث بالأعلى، أو اختر عميل من القائمة لعرض كشف حسابه وحالة أقساطه.</p>
                </div>
              ) : isInvoiceLoading ? (
                <LoadingState size="md" minHeight="200px" />
              ) : filteredRows.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-16 text-center shadow-sm">
                  <Search size={40} className="text-slate-300 mx-auto mb-4" />
                  <p className="text-slate-500 font-medium">لا توجد نتائج مطابقة للبحث الحالي.</p>
                </div>
              ) : filteredRows.map((row) => {
                  const isSingle = filteredRows.length === 1;
                  // Calculate installment metrics with 1 EGP rounding tolerance
                  const totalInstallments = row.schedules.length;
                  const paidInstallments = row.schedules.filter((s) => s.status === 'paid' || Math.max(s.amount - s.paidAmount, 0) <= 1).length;
                  const partialInstallments = row.schedules.filter((s) => s.status === 'partial' && Math.max(s.amount - s.paidAmount, 0) > 1).length;
                  const unpaidInstallments = row.schedules.filter((s) => (s.status === 'unpaid' || s.paidAmount <= 0) && Math.max(s.amount - s.paidAmount, 0) > 1).length;
                  const paymentProgress = row.total > 0 ? Math.min((row.paid / row.total) * 100, 100) : 0;

                  return (
                  <section
                    key={row.saleId}
                    className={`${isSingle ? 'flex-1 min-h-0' : 'shrink-0'} flex flex-col rounded-xl border border-slate-200 bg-white p-3 shadow-2xs overflow-hidden`}
                  >
                    {/* Compact Top Header Bar */}
                    <div className="shrink-0 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between border-b border-slate-100 pb-2.5">
                      {/* Right side: Customer Name & Meta */}
                      <div className="flex items-center gap-2.5">
                        <div className={`rounded-lg p-2 shrink-0 ${row.isSued ? 'bg-red-50 text-red-600' : 'bg-sky-50 text-sky-600'}`}>
                          {row.isSued ? <Gavel size={16} /> : <UserRound size={16} />}
                        </div>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className={`font-black text-base md:text-lg ${row.isSued ? 'text-red-600 line-through' : 'text-slate-900'}`}>
                              {row.customerName}
                            </h3>
                            {row.isSued && (
                              <span className="text-[10px] bg-red-50 text-red-600 border border-red-200 px-1.5 py-0.5 rounded font-bold flex items-center gap-1">
                                <AlertTriangle size={10} /> محال للقضاء
                              </span>
                            )}
                            <span className="text-[11px] font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200">
                              {row.invoiceNumber}
                            </span>
                            <span className="text-[11px] text-slate-500 font-bold">
                              {formatDateDisplay(row.saleDate)}
                            </span>
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                              {row.paymentMethod === 'installment' ? 'دفع بالتقسيط' : 'نقداً'}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                            <span className="font-semibold text-slate-700">{row.customerPhone}</span>
                            {row.customerAddress && row.customerAddress !== '-' && (
                              <>
                                <span className="w-1 h-1 bg-slate-300 rounded-full"></span>
                                <span className="truncate max-w-sm">{row.customerAddress}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Left side: Stats & Action Buttons */}
                      <div className="flex items-center gap-2.5 flex-wrap lg:justify-end">
                        {/* Mini Financial Summary Pills */}
                        <div className="flex items-center gap-1.5 bg-slate-50 px-2 py-1 rounded-xl border border-slate-200 text-xs">
                          <div className="px-2 py-0.5 text-center">
                            <span className="text-[10px] text-slate-400 block font-bold leading-tight">الإجمالي</span>
                            <span className="font-black text-slate-800 text-xs">{formatCurrency(row.total)}</span>
                          </div>
                          <div className="w-px h-5 bg-slate-200"></div>
                          <div className="px-2 py-0.5 text-center">
                            <span className="text-[10px] text-slate-400 block font-bold leading-tight">المدفوع</span>
                            <span className="font-black text-emerald-700 text-xs">{formatCurrency(row.paid)}</span>
                          </div>
                          <div className="w-px h-5 bg-slate-200"></div>
                          <div className="px-2 py-0.5 text-center">
                            <span className="text-[10px] text-slate-400 block font-bold leading-tight">المتبقي</span>
                            <span className={`font-black text-xs ${row.remaining > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                              {formatCurrency(row.remaining)}
                            </span>
                          </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex items-center gap-1.5">
                          {user?.role !== 'manager' && (
                            <button
                              onClick={() => handleToggleLegalCustomer(row.customerId, !row.isSued)}
                              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                                row.isSued
                                  ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'
                                  : 'bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200'
                              }`}
                              title={row.isSued ? 'إلغاء النزاع والتحويل للقضاء' : 'تحويل العميل للشئون القانونية والنزاعات'}
                            >
                              <Gavel size={13} />
                              <span>{row.isSued ? 'إلغاء النزاع' : 'تحويل للقضاء'}</span>
                            </button>
                          )}

                          <button
                            onClick={() => handlePrint(row)}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold border border-slate-200 transition-colors cursor-pointer"
                          >
                            <Printer size={13} />
                            <span>طباعة</span>
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Compact Single-Row Installments Summary Strip */}
                    {row.paymentMethod === 'installment' && (
                      <div className="shrink-0 mt-2 flex flex-wrap items-center justify-between gap-3 bg-slate-50/80 px-3 py-1.5 rounded-lg border border-slate-200/60 text-xs">
                        <div className="flex items-center gap-3">
                          <span className="text-slate-600 font-bold">
                            المدفوع: <span className="text-emerald-700 font-black">{paidInstallments}</span> من {totalInstallments} قسط
                          </span>
                          {partialInstallments > 0 && (
                            <span className="text-amber-700 font-bold">
                              جزئي: <span className="font-black">{partialInstallments}</span>
                            </span>
                          )}
                          <span className="text-slate-600 font-bold">
                            المتبقي: <span className={`font-black ${unpaidInstallments > 0 ? 'text-rose-600' : 'text-slate-400'}`}>{unpaidInstallments}</span> قسط
                          </span>
                        </div>

                        <div className="flex items-center gap-2 min-w-[180px]">
                          <span className="text-[11px] text-slate-500 font-bold shrink-0">نسبة التحصيل: <span className="font-black text-emerald-700">{paymentProgress.toFixed(1)}%</span></span>
                          <div className="flex-1 bg-slate-200 h-1.5 rounded-full overflow-hidden">
                            <div
                              className="bg-emerald-500 h-full rounded-full transition-all duration-300"
                              style={{ width: `${paymentProgress}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Compact Scrollable Installments Table */}
                    <div className={`mt-2.5 ${isSingle ? 'flex-1 min-h-0' : 'min-h-[200px]'} flex flex-col rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden`}>
                      <div className={`${isSingle ? 'flex-1 min-h-0' : 'max-h-[380px]'} overflow-auto desktop-table-scroll`}>
                        <table className="w-full text-right border-collapse text-xs">
                          <thead className="sticky top-0 z-10 bg-slate-100/95 backdrop-blur-xs border-b border-slate-200 text-xs font-black text-slate-700 shadow-2xs">
                            <tr>
                              <th className="py-2.5 px-3.5 text-center w-24">القسط</th>
                              <th className="py-2.5 px-3.5 text-right">تاريخ الاستحقاق</th>
                              <th className="py-2.5 px-3.5 text-right">قيمة الشهر</th>
                              <th className="py-2.5 px-3.5 text-right">المدفوع</th>
                              <th className="py-2.5 px-3.5 text-right">المتبقي</th>
                              <th className="py-2.5 px-3.5 text-center w-28">الحالة</th>
                              <th className="py-2.5 px-3.5 text-right">تاريخ السداد</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {row.schedules.map((schedule) => {
                              const rawRemaining = Math.max(schedule.amount - schedule.paidAmount, 0);
                              const isEffectivelyPaid = schedule.status === 'paid' || rawRemaining <= 1;
                              const remaining = isEffectivelyPaid ? 0 : rawRemaining;
                              const effectiveStatus: InstallmentSchedule['status'] = isEffectivelyPaid
                                ? 'paid'
                                : (schedule.status === 'partial' || schedule.paidAmount > 0 ? 'partial' : 'unpaid');
                              const isPaid = effectiveStatus === 'paid';
                              const isPartial = effectiveStatus === 'partial';

                              return (
                                <tr
                                  key={schedule.id}
                                  className={`transition-colors hover:bg-slate-50 ${
                                    isPaid
                                      ? 'bg-emerald-50/20'
                                      : isPartial
                                        ? 'bg-amber-50/20'
                                        : 'bg-rose-50/15'
                                  }`}
                                >
                                  <td className="py-2 px-3.5 text-center">
                                    <span className="inline-block px-2.5 py-0.5 rounded-md bg-slate-100 text-slate-800 font-bold text-xs">
                                      {schedule.label}
                                    </span>
                                  </td>
                                  <td className="py-2 px-3.5 font-bold text-slate-700">
                                    {formatDateDisplay(schedule.dueDate)}
                                  </td>
                                  <td className="py-2 px-3.5 font-bold text-slate-800">
                                    {formatCurrency(schedule.amount)}
                                  </td>
                                  <td className="py-2 px-3.5 font-bold text-emerald-700">
                                    {formatCurrency(isEffectivelyPaid ? schedule.amount : schedule.paidAmount)}
                                  </td>
                                  <td className={`py-2 px-3.5 font-black ${remaining > 0 ? 'text-rose-600' : 'text-slate-400'}`}>
                                    {formatCurrency(remaining)}
                                  </td>
                                  <td className="py-2 px-3.5 text-center">
                                    <MonthBadge status={effectiveStatus} />
                                  </td>
                                  <td className="py-2 px-3.5 text-slate-500 font-medium">
                                    {schedule.paidAt ? formatDateDisplay(schedule.paidAt) : '---'}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      {/* Summary footer bar */}
                      <div className="shrink-0 bg-slate-50/90 border-t border-slate-200 px-4 py-2 flex flex-wrap items-center justify-between text-xs font-bold text-slate-600">
                        <span>عدد الأقساط: <span className="text-slate-900 font-extrabold">{row.schedules.length} قسط</span></span>
                        <span>إجمالي المسدد: <span className="text-emerald-700 font-extrabold">{formatCurrency(row.paid)}</span></span>
                        <span>إجمالي المتبقي: <span className="text-rose-700 font-extrabold">{formatCurrency(row.remaining)}</span></span>
                      </div>
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB CONTENT: LEGAL */}
        {activeTab === 'legal' && (
          <div className="desktop-table-card animate-in fade-in slide-in-from-bottom-2 duration-300 print:hidden">
            <div className="bg-red-50/80 border-b border-red-100 p-3.5 flex items-center justify-between shrink-0 print:hidden">
              <div>
                <h3 className="text-red-800 font-bold text-base flex items-center gap-2"><Gavel size={18} /> سجل القضايا والنزاعات القانونية</h3>
                <p className="text-red-600 text-xs mt-0.5">هذه القائمة مخصصة للمتابعة القانونية وللمحامي، وتعرض جميع العملاء الذين تم إحالتهم للقضاء.</p>
              </div>
              <button onClick={() => { setPrintingInvoice(null); setPrintingLegalReport(true); setTimeout(() => { window.print(); setPrintingLegalReport(false); }, 300); }} className="h-9 px-4 bg-red-700 text-white rounded-xl hover:bg-red-800 flex items-center justify-center gap-2 font-bold text-xs shadow-sm transition-all whitespace-nowrap">
                <Printer size={15} />
                طباعة كشف المحامي
              </button>
            </div>

            <div className="desktop-table-scroll">
              <table className="w-full bg-white border-collapse">
                <thead className="desktop-sticky-header">
                  <tr>
                    <th className="px-4 py-3 text-right">اسم العميل</th>
                    <th className="px-4 py-3 text-right">رقم الهاتف</th>
                    <th className="px-4 py-3 text-right">العنوان</th>
                    <th className="px-4 py-3 text-center">الفواتير</th>
                    <th className="px-4 py-3 text-center">تاريخ الإحالة</th>
                    <th className="px-4 py-3 text-center">المديونية</th>
                    <th className="px-4 py-3 text-center">الإجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {suedCustomersList.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-5 py-16 text-center text-slate-400">
                        <div className="flex flex-col items-center justify-center min-h-[220px]">
                          <CheckCircle2 size={40} className="text-slate-300 mb-3" />
                          <p className="font-bold text-sm text-slate-700">لا يوجد أي عملاء في الشئون القانونية حالياً</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    suedCustomersList.map((customer) => (
                      <tr key={customer.id} className="hover:bg-red-50/50 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-red-100 flex items-center justify-center text-red-600 shrink-0">
                              <Gavel size={13} />
                            </div>
                            <span className="font-bold text-slate-900 text-xs md:text-sm">{customer.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs md:text-sm font-semibold text-slate-700">{customer.phone}</td>
                        <td className="px-4 py-3 text-xs md:text-sm text-slate-600 truncate max-w-[200px]">{customer.address}</td>
                        <td className="px-4 py-3 text-center">
                          <span className="bg-slate-100 text-slate-700 font-bold px-2.5 py-0.5 rounded-lg text-xs">{customer.invoicesCount}</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {(() => {
                            const rawDate = (customer as any).suedDate || (customer as any).sued_date
                              || (customer as any).createdAt;
                            const formatted = formatDateDisplay(rawDate);
                            return formatted && formatted !== '-' ? (
                              <span className="font-bold text-slate-800 text-xs">{formatted}</span>
                            ) : <span className="text-slate-400">-</span>;
                          })()}
                        </td>
                        <td className="px-4 py-3 text-center font-black text-red-600 text-sm md:text-base">
                          {formatCurrency(customer.totalDebt)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => handleToggleLegalCustomer(customer.id, false)}
                            className="px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-xs font-bold border border-emerald-200 transition-colors inline-flex items-center gap-1"
                            title="إلغاء التحويل من الشئون القانونية"
                          >
                            <CheckCircle2 size={13} />
                            إلغاء النزاع
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {suedCustomersList.length > 0 && (
              <div className="erp-status-bar shrink-0">
                <div className="font-bold text-slate-700">
                  إجمالي عملاء الشئون القانونية: <span className="text-slate-900 font-black mx-1">{suedCustomersList.length}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-slate-500">إجمالي الديون المعلقة بالنزاعات:</span>
                  <span className="text-sm md:text-base font-black text-red-700">{formatCurrency(suedCustomersList.reduce((s, c) => s + c.totalDebt, 0))}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Small Customer Details Modal ("صفحة صغيرة") */}
      <CustomerDetailsModal
        isOpen={Boolean(selectedCustomerModal)}
        onClose={() => setSelectedCustomerModal(null)}
        customerGroup={selectedCustomerModal}
        sales={sales}
        customerMap={customerMap}
        settings={settings}
        dueStatusFilter={dueStatusFilter}
        onPrint={handlePrint}
      />

      {/* PRINTABLE INVOICE STATEMENT */}
      {printingInvoice ? (
        <div className="invoice-page">
          <PrintableView invoice={printingInvoice} settings={settings} />
        </div>
      ) : printingLegalReport || activeTab === 'legal' ? (
        /* PRINTABLE LEGAL AFFAIRS / LAWYER REPORT */
        <div className="hidden print:block bg-white text-slate-900 w-full text-right" dir="rtl">
          <div className="flex justify-between items-start border-b-2 border-slate-900 pb-3 mb-4">
            <div>
              <h1 className="text-2xl font-black text-slate-900 mb-0.5">{settings.companyName}</h1>
              <p className="text-slate-600 text-xs">{settings.companyAddress} | {settings.companyPhone}</p>
            </div>
            <div className="text-left">
              <h2 className="text-xl font-bold text-red-800 border-b-2 border-red-700 pb-0.5 mb-1 inline-block">كشف قضايا العملاء المحالين للشئون القانونية (كشف المحامي)</h2>
              <p className="text-slate-500 font-semibold text-[10px]">تاريخ الاستخراج والطباعة: {formatDateDisplay(new Date())}</p>
            </div>
          </div>

          <table className="w-full text-right border-collapse text-xs">
            <thead>
              <tr className="border-b-2 border-slate-800 bg-slate-100 text-slate-900 font-bold">
                <th className="p-2 w-8 text-center">#</th>
                <th className="p-2 text-right">اسم العميل</th>
                <th className="p-2 text-right">رقم الهاتف</th>
                <th className="p-2 text-right">العنوان</th>
                <th className="p-2 text-center w-20">عدد الفواتير</th>
                <th className="p-2 text-center w-28">تاريخ الإحالة</th>
                <th className="p-2 text-center w-36">إجمالي المديونية المعلقة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-300">
              {suedCustomersList.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-slate-500 font-bold">
                    لا يوجد أي عملاء محالين للشئون القانونية حالياً.
                  </td>
                </tr>
              ) : (
                suedCustomersList.map((customer, idx) => (
                  <tr key={customer.id} className="border-b border-slate-200">
                    <td className="p-2 text-center font-bold text-slate-700">{idx + 1}</td>
                    <td className="p-2 font-bold text-slate-900">{customer.name}</td>
                    <td className="p-2 text-slate-700 text-xs font-semibold">{customer.phone}</td>
                    <td className="p-2 text-slate-600 text-xs">{customer.address || '-'}</td>
                    <td className="p-2 text-center font-bold text-slate-800">{customer.invoicesCount}</td>
                    <td className="p-2 text-center text-xs text-slate-600">
                      {formatDateDisplay((customer as any).suedDate || (customer as any).sued_date || (customer as any).createdAt)}
                    </td>
                    <td className="p-2 text-center font-black text-red-700">{formatCurrency(customer.totalDebt)}</td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-900 bg-slate-50 font-bold">
                <td colSpan={4} className="p-2 text-right">إجمالي عدد العملاء المحالين للقضاء: {suedCustomersList.length} عميل</td>
                <td colSpan={3} className="p-2 text-center text-sm font-black text-red-800">
                  إجمالي المديونية المعلقة: {formatCurrency(suedCustomersList.reduce((s, c) => s + c.totalDebt, 0))}
                </td>
              </tr>
            </tfoot>
          </table>

          <div className="mt-8 pt-4 border-t border-slate-300 flex justify-between items-center text-xs text-slate-600">
            <div>توقيع واستلام المحامي: ................................................</div>
            <div>اعتماد الإدارة: ................................................</div>
          </div>
        </div>
      ) : (
        /* PRINTABLE ALL DUE CUSTOMERS (MULTIPLE PAGES) */
        <div className="due-print-page hidden print:block bg-white text-slate-900 w-full text-right" dir="rtl">
          <style>{`
            @page {
              size: A4 portrait;
              margin: 7mm 6mm;
            }
            @media print {
              body {
                margin: 0;
                padding: 0;
                background: #fff;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
              }
              .due-print-grid {
                display: grid !important;
                grid-template-columns: repeat(2, 1fr) !important;
                gap: 6.5px !important;
                width: 100% !important;
              }
              .due-card {
                border: 1px solid #cbd5e1 !important;
                border-radius: 6px !important;
                padding: 6.5px 8.5px !important;
                page-break-inside: avoid !important;
                break-inside: avoid !important;
                background: #fff !important;
                display: flex !important;
                flex-direction: column !important;
                justify-content: space-between !important;
                gap: 3.5px !important;
                box-shadow: none !important;
              }
              .due-card-header {
                border-bottom: 1px solid #e2e8f0 !important;
                padding-bottom: 3.5px !important;
                margin-bottom: 1px !important;
                display: flex !important;
                justify-content: space-between !important;
                align-items: baseline !important;
              }
              .due-card-title {
                font-weight: 900 !important;
                font-size: 12.5px !important;
                color: #0f172a !important;
                white-space: nowrap !important;
                overflow: hidden !important;
                text-overflow: ellipsis !important;
                flex: 1 !important;
                padding-left: 4px !important;
              }
              .due-card-phone {
                font-weight: 800 !important;
                font-size: 11px !important;
                color: #0284c7 !important;
                direction: ltr !important;
                white-space: nowrap !important;
              }
              .due-card-body {
                display: flex !important;
                flex-direction: column !important;
                gap: 3.5px !important;
              }
              .due-amount-banner {
                background: #f8fafc !important;
                border: 1px solid #e2e8f0 !important;
                border-radius: 4px !important;
                padding: 3.5px 7px !important;
                display: flex !important;
                justify-content: space-between !important;
                align-items: center !important;
              }
              .due-amount-banner-unpaid {
                border-right: 3px solid #dc2626 !important;
              }
              .due-amount-banner-paid {
                border-right: 3px solid #16a34a !important;
              }
              .due-amount-main {
                display: flex !important;
                align-items: baseline !important;
                gap: 4px !important;
              }
              .due-amount-label {
                font-size: 10px !important;
                font-weight: 700 !important;
                color: #475569 !important;
              }
              .due-amount-value {
                font-size: 13px !important;
                font-weight: 900 !important;
              }
              .due-amount-side {
                text-align: left !important;
                font-size: 9.5px !important;
                color: #64748b !important;
                font-weight: 700 !important;
              }
              .due-contract-rem {
                color: #475569 !important;
                font-weight: 800 !important;
              }
              .due-info-line {
                display: flex !important;
                align-items: flex-start !important;
                gap: 4px !important;
                font-size: 10px !important;
                line-height: 1.35 !important;
              }
              .due-info-tag {
                font-weight: 800 !important;
                color: #475569 !important;
                white-space: nowrap !important;
                min-width: 44px !important;
              }
              .due-info-val {
                color: #1e293b !important;
                font-weight: 600 !important;
                flex: 1 !important;
              }
              .due-guarantor-strong {
                font-weight: 800 !important;
                color: #0f172a !important;
              }
              .due-guarantor-phone {
                color: #0284c7 !important;
                direction: ltr !important;
                font-weight: 700 !important;
                margin-right: 2px !important;
              }
              .due-installments-strip {
                background: #f1f5f9 !important;
                border-radius: 3px !important;
                padding: 2.5px 6px !important;
                font-size: 9.5px !important;
                display: flex !important;
                justify-content: space-between !important;
                align-items: center !important;
                color: #334155 !important;
                font-weight: 700 !important;
              }
              .due-card-footer {
                border-top: 1px dashed #cbd5e1 !important;
                padding-top: 3.5px !important;
                margin-top: 1px !important;
                display: flex !important;
                justify-content: space-between !important;
                align-items: center !important;
                font-size: 9.5px !important;
              }
              .due-notes-area {
                display: flex !important;
                align-items: center !important;
              }
              .due-notes-label {
                font-weight: 900 !important;
                color: #1e293b !important;
                font-size: 10px !important;
              }
              .due-lastpay-area {
                font-size: 9.5px !important;
                color: #475569 !important;
                font-weight: 600 !important;
              }
              .due-lastpay-area b {
                color: #0f172a !important;
                font-weight: 800 !important;
              }
            }
          `}</style>
          
          {/* Header of the full report */}
          <div className="flex justify-between items-start border-b-2 border-slate-800 pb-3 mb-4">
            <div>
              <h1 className="text-3xl font-black text-slate-900 mb-0.5">{settings.companyName}</h1>
              <p className="text-slate-600 text-xs">{settings.companyAddress} | {settings.companyPhone}</p>
            </div>
            <div className="text-left">
              <h2 className="text-2xl font-bold text-slate-800 border-b border-slate-300 pb-0.5 mb-0.5 inline-block">
                {dueStatusFilter === 'paid' ? 'كشف الأقساط المحصلة (المسددة)' : dueStatusFilter === 'all' ? 'كشف التحصيل والمتابعة الشامل' : 'كشف التحصيل والمتابعة (المستحق)'}
              </h2>
              <p className="text-slate-500 font-semibold text-[10px]">من {formatDateDisplay(dueFromDate)} إلى {formatDateDisplay(dueToDate)} | تاريخ الطباعة: {formatDateDisplay(new Date())}</p>
            </div>
          </div>

          {groupedDueRows.length === 0 ? (
            <div className="p-12 text-center text-slate-500">لا توجد أقساط مطابقة للفترة المحددة.</div>
          ) : (
            <div className="due-print-grid">
              {groupedDueRows.map((group, idx) => {
                const totalRemaining = group.reduce((sum, r) => sum + r.remainingAmount, 0);
                const totalPaid = group.reduce((sum, r) => sum + (r.paidAmount || 0), 0);
                const isPaidMode = dueStatusFilter === 'paid' || (dueStatusFilter === 'all' && totalRemaining === 0);
                const firstRow = group[0];
                const activeGuarantors = firstRow.guarantors.filter(g => g && g.name);
                const lastPayment = firstRow.lastPaymentDate ? formatDateDisplay(firstRow.lastPaymentDate) : 'لا يوجد سداد سابق';
                const dueDateStr = group.map(r => `${r.installmentLabel} (${formatDateDisplay(r.dueDate)})`).join(' ، ');

                return (
                  <div key={idx} className="due-card">
                    {/* Header: Customer Name and Phone */}
                    <div className="due-card-header">
                      <span className="due-card-title">{idx + 1}. {firstRow.customerName}</span>
                      <span className="due-card-phone">{firstRow.customerPhone || '---'}</span>
                    </div>

                    <div className="due-card-body">
                      {/* Highlight Banner: Due Amount & Contract Remaining */}
                      <div className={`due-amount-banner ${isPaidMode ? 'due-amount-banner-paid' : 'due-amount-banner-unpaid'}`}>
                        <div className="due-amount-main">
                          <span className="due-amount-label">
                            {isPaidMode ? 'المبلغ المحصل:' : 'القسط المستحق:'}
                          </span>
                          <span className={`due-amount-value ${isPaidMode ? 'text-emerald-700' : 'text-red-700'}`}>
                            {formatCurrency(isPaidMode ? (totalPaid > 0 ? totalPaid : group.reduce((sum, r) => sum + r.installmentAmount, 0)) : totalRemaining)}
                          </span>
                        </div>
                        <div className="due-amount-side">
                          {firstRow.totalInvoiceRemaining !== undefined && firstRow.totalInvoiceRemaining > totalRemaining ? (
                            <span>متبقي العقد: <span className="due-contract-rem">{formatCurrency(firstRow.totalInvoiceRemaining)}</span></span>
                          ) : (
                            <span>فاتورة: <b>{firstRow.invoiceNumber || '---'}</b></span>
                          )}
                        </div>
                      </div>

                      {/* Prominent Guarantors */}
                      <div className="due-info-line">
                        <span className="due-info-tag">الضامن:</span>
                        <span className="due-info-val">
                          {activeGuarantors.length > 0 ? (
                            activeGuarantors.map((g, gIdx) => (
                              <span key={gIdx} className="inline-block ml-2">
                                <span className="due-guarantor-strong">{g!.name}</span>
                                {g!.phone && <span className="due-guarantor-phone"> ({g!.phone})</span>}
                              </span>
                            ))
                          ) : (
                            <span className="text-slate-400">لا يوجد ضامن مسجل</span>
                          )}
                        </span>
                      </div>

                      {/* Customer Address */}
                      <div className="due-info-line">
                        <span className="due-info-tag">العنوان:</span>
                        <span className="due-info-val">{firstRow.customerAddress || '---'}</span>
                      </div>

                      {/* Installments strip */}
                      <div className="due-installments-strip">
                        <span>{dueDateStr}</span>
                        <span>المندوب: <b>{firstRow.salesRepName || 'غير محدد'}</b></span>
                      </div>
                    </div>

                    {/* Footer: Notes on Right (no box, no line, open space), Last Payment on Left */}
                    <div className="due-card-footer">
                      <div className="due-notes-area">
                        <span className="due-notes-label">ملاحظات:</span>
                      </div>
                      <div className="due-lastpay-area">
                        <span>آخر سداد: <b>{lastPayment}</b></span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Overall Report Footer */}
          <div className="mt-6 pt-3 border-t border-slate-400 flex justify-between items-center text-xs font-bold">
            <div>
              <p>عدد العملاء المستحقين: <span className="text-slate-900 font-black">{groupedDueRows.length} عميل</span></p>
              <p className="mt-0.5">إجمالي الأقساط المطلوبة: <span className="text-red-700 font-black text-sm">{formatCurrency(dueTotalInPeriod)}</span></p>
            </div>
            {settings.invoiceFooter && (
              <div className="text-left text-[10px] text-slate-500 font-normal">
                <p>{settings.invoiceFooter}</p>
                <p className="mt-0.5">تم الاستخراج من نظام {settings.companyName}</p>
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
      <div className="print-container w-full">
        {/* Header */}
        <div className="flex justify-between items-start border-b-2 border-slate-900 pb-3 mb-4">
          <div>
            <h1 className="text-2xl font-black text-slate-900 mb-1">{settings.companyName}</h1>
            <p className="text-slate-600 text-xs">{settings.companyAddress}</p>
            <p className="text-slate-700 font-bold text-xs">{settings.companyPhone}</p>
          </div>
          <div className="text-left">
            <h2 className="text-xl font-bold text-slate-900 border-b-2 border-slate-800 pb-1 mb-1 inline-block">كشف حساب عميل</h2>
            <p className="text-slate-600 font-bold text-xs">تاريخ الطباعة: {formatDateDisplay(new Date())}</p>
            <p className="text-slate-600 font-bold text-xs">رقم الفاتورة: {invoice.invoiceNumber}</p>
            {invoice.salesRepName && (
              <p className="text-sky-700 font-bold text-xs">المندوب: {invoice.salesRepName}</p>
            )}
          </div>
        </div>

        {/* Customer & Guarantor Info */}
        <div className="flex flex-col gap-2 mb-4">
          <div className="border border-slate-300 p-3 rounded-lg bg-slate-50/70">
            <h3 className="font-bold text-sm mb-2 text-slate-800 border-b border-slate-200 pb-1">بيانات العميل</h3>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <p><span className="font-bold text-slate-600 inline-block ml-1">اسم العميل:</span> {invoice.customerName}</p>
              <p><span className="font-bold text-slate-600 inline-block ml-1">رقم الهاتف:</span> {invoice.customerPhone}</p>
              {invoice.customerAddress && (
                <p className="col-span-2"><span className="font-bold text-slate-600 inline-block ml-1">العنوان:</span> {invoice.customerAddress}</p>
              )}
            </div>
            {hasGuarantor && (
              <div className="border-t border-slate-200 pt-2 mt-2 text-xs">
                <span className="font-bold text-slate-700 inline-block ml-1">بيانات الضامن:</span>
                <span className="text-slate-800 font-medium">
                  {invoice.guarantors
                    .filter((g) => g && g.name)
                    .map((g) => `${g!.name} (${g!.phone || 'بدون هاتف'}${g!.nationalId ? ` - رقم قومي: ${g!.nationalId}` : ''})`)
                    .join(' | ')}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Financial Summary */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="border-2 border-slate-800 p-2 text-center rounded-lg bg-slate-50">
            <p className="text-slate-600 font-bold mb-1 text-xs">إجمالي الفاتورة</p>
            <p className="text-lg font-black text-slate-900">{formatCurrency(invoice.total)}</p>
          </div>
          <div className="border-2 border-emerald-700 p-2 text-center rounded-lg bg-emerald-50">
            <p className="text-emerald-700 font-bold mb-1 text-xs">إجمالي المسدد</p>
            <p className="text-lg font-black text-emerald-800">{formatCurrency(invoice.paid)}</p>
          </div>
          <div className="border-2 border-red-700 p-2 text-center rounded-lg bg-red-50">
            <p className="text-red-700 font-bold mb-1 text-xs">إجمالي المتبقي</p>
            <p className="text-lg font-black text-red-800">{formatCurrency(invoice.remaining)}</p>
          </div>
        </div>

        {/* Installments Table */}
        <div className="mb-4">
          <h3 className="font-bold text-sm mb-2 text-slate-900 border-b-2 border-slate-800 pb-1 inline-block">سجل الأقساط والدفعات التفصيلي</h3>
          <table className="w-full text-right border-collapse border border-slate-300 text-xs">
            <thead>
              <tr className="bg-slate-100 text-slate-900 font-bold">
                <th className="border border-slate-300 px-2 py-1.5 font-bold">البيان</th>
                <th className="border border-slate-300 px-2 py-1.5 font-bold text-center">الاستحقاق</th>
                <th className="border border-slate-300 px-2 py-1.5 font-bold text-center">تاريخ الدفع</th>
                <th className="border border-slate-300 px-2 py-1.5 font-bold text-center">المبلغ</th>
                <th className="border border-slate-300 px-2 py-1.5 font-bold text-center">المدفوع</th>
                <th className="border border-slate-300 px-2 py-1.5 font-bold text-center">المتبقي</th>
                <th className="border border-slate-300 px-2 py-1.5 font-bold text-center">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {invoice.schedules.map((schedule) => {
                const remaining = Math.max(schedule.amount - schedule.paidAmount, 0);
                const statusLabel = schedule.status === 'paid' ? 'مدفوع' : schedule.status === 'partial' ? 'جزئي' : 'غير مدفوع';
                return (
                  <tr key={schedule.id} className="even:bg-slate-50">
                    <td className="border border-slate-300 px-2 py-1.5 font-semibold text-xs">{schedule.label}</td>
                    <td className="border border-slate-300 px-2 py-1.5 whitespace-nowrap text-xs text-center">{formatDateDisplay(schedule.dueDate)}</td>
                    <td className="border border-slate-300 px-2 py-1.5 whitespace-nowrap text-xs text-center">{formatDateDisplay(schedule.paidAt)}</td>
                    <td className="border border-slate-300 px-2 py-1.5 text-center text-xs font-semibold">{formatCurrency(schedule.amount)}</td>
                    <td className="border border-slate-300 px-2 py-1.5 text-center text-emerald-700 font-bold text-xs">{formatCurrency(schedule.paidAmount)}</td>
                    <td className="border border-slate-300 px-2 py-1.5 text-center text-red-700 font-bold text-xs">{formatCurrency(remaining)}</td>
                    <td className="border border-slate-300 px-2 py-1.5 text-center font-bold text-xs">{statusLabel}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="mt-6 text-center text-xs text-slate-500 border-t border-slate-300 pt-3 pb-2">
          {settings.invoiceFooter && <p className="mb-1 font-bold">{settings.invoiceFooter}</p>}
          <p>تم استخراج هذا الكشف من نظام {settings.companyName} للتقسيط</p>
        </div>
      </div>
    </div>
  );
}

interface CustomerDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  customerGroup: DueCustomerRow[] | null;
  sales: Sale[];
  customerMap: Map<string, Customer>;
  settings: Setting;
  dueStatusFilter: 'unpaid' | 'paid' | 'all';
  onPrint?: (invoice: CollectionInvoiceView) => void;
}

function CustomerDetailsModal({
  isOpen,
  onClose,
  customerGroup,
  sales,
  customerMap,
  settings,
  dueStatusFilter,
  onPrint,
}: CustomerDetailsModalProps) {
  const [activeTab, setActiveTab] = useState<'period' | 'all'>('period');

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !customerGroup || customerGroup.length === 0) return null;

  const primaryRow = customerGroup[0];
  const matchedSale = sales.find((s) => s.id === primaryRow.saleId);
  const matchedCustomer = customerMap.get(primaryRow.customerId || matchedSale?.customerId || '');

  // Calculate totals
  const periodInstallments = customerGroup;
  const allSchedules = matchedSale?.financing?.schedules || customerGroup.map((r, i) => ({
    id: `${r.saleId}-${i}`,
    monthIndex: i + 1,
    dueDate: r.dueDate,
    amount: r.installmentAmount,
    paidAmount: r.paidAmount || (r.status === 'paid' ? r.installmentAmount : 0),
    remainingAmount: r.remainingAmount,
    status: r.status,
    paidAt: r.paidAt || r.lastPaymentDate,
    label: r.installmentLabel,
  }));

  const totalPeriodDue = periodInstallments.reduce((sum, r) => sum + r.remainingAmount, 0);
  const totalPeriodAmount = periodInstallments.reduce((sum, r) => sum + r.installmentAmount, 0);
  const totalPeriodPaid = periodInstallments.reduce((sum, r) => sum + (r.paidAmount || (r.status === 'paid' ? r.installmentAmount : 0)), 0);

  const contractTotal = matchedSale ? matchedSale.total : (primaryRow.totalInvoiceRemaining ? primaryRow.totalInvoiceRemaining + totalPeriodPaid : totalPeriodAmount);
  const contractRemaining = matchedSale ? matchedSale.remaining : (primaryRow.totalInvoiceRemaining ?? totalPeriodDue);
  const contractPaid = matchedSale ? matchedSale.paid : Math.max(0, contractTotal - contractRemaining);
  const contractProgressPct = contractTotal > 0 ? Math.min(100, Math.round((contractPaid / contractTotal) * 100)) : 0;

  // Guarantors
  const guarantors = ((matchedSale as any)?.guarantors && (matchedSale as any).guarantors.length > 0)
    ? (matchedSale as any).guarantors.filter(Boolean)
    : (primaryRow.guarantors && primaryRow.guarantors.length > 0)
      ? primaryRow.guarantors.filter(Boolean)
      : [];

  const items = matchedSale?.items || [];
  const displayedRows = activeTab === 'all' && matchedSale?.financing?.schedules ? allSchedules : periodInstallments;
  const formatCurrency = (amount: number) => formatWholeCurrency(amount, settings?.currency || 'جنيه');

  const isCustomerSued = Boolean(primaryRow.isSued || matchedCustomer?.isSued || (matchedSale as any)?.isSued);

  // Check if customer has old overdue installments (past due date and unpaid)
  const todayIso = new Date().toISOString().slice(0, 10);
  const customerSales = sales.filter((s) => s.customerId === (primaryRow.customerId || matchedSale?.customerId));
  const hasPastUnpaidInSales = customerSales.some((s) =>
    s.financing?.schedules?.some((sch) => {
      const isPast = sch.dueDate < todayIso;
      const isUnpaid = sch.status !== 'paid' && (sch.amount - (sch.paidAmount || 0)) > 1;
      return isPast && isUnpaid;
    })
  );

  const hasPastUnpaidInGroup = customerGroup.some((r) => {
    const isPast = r.dueDate < todayIso;
    const isUnpaid = r.status !== 'paid' && r.remainingAmount > 1;
    return isPast && isUnpaid;
  });

  const hasOldOverdue = hasPastUnpaidInSales || hasPastUnpaidInGroup;

  const printStatement = () => {
    if (!onPrint) return;
    const invoiceView: CollectionInvoiceView = {
      saleId: primaryRow.saleId,
      customerId: primaryRow.customerId,
      invoiceNumber: primaryRow.invoiceNumber,
      customerName: primaryRow.customerName,
      customerPhone: primaryRow.customerPhone,
      customerAddress: primaryRow.customerAddress,
      saleDate: matchedSale?.date || primaryRow.dueDate,
      total: contractTotal,
      paid: contractPaid,
      remaining: contractRemaining,
      paymentMethod: matchedSale?.financing?.paymentMethod || 'installment',
      salesRepId: primaryRow.salesRepId,
      salesRepName: primaryRow.salesRepName,
      schedules: (matchedSale?.financing?.schedules && matchedSale.financing.schedules.length > 0
        ? matchedSale.financing.schedules
        : customerGroup.map((r, idx) => ({
            id: `${r.saleId}-${idx}`,
            monthIndex: idx + 1,
            dueDate: r.dueDate,
            amount: r.installmentAmount,
            paidAmount: r.paidAmount || (r.status === 'paid' ? r.installmentAmount : 0),
            status: r.status,
            paidAt: r.paidAt || r.lastPaymentDate,
            label: r.installmentLabel,
          }))) as InstallmentSchedule[],
      guarantors: guarantors as (Guarantor | null)[],
      isSued: primaryRow.isSued,
      lastPaymentDate: primaryRow.lastPaymentDate,
      totalInvoiceRemaining: contractRemaining,
    };
    onPrint(invoiceView);
  };

  return (
    <div
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-5 animate-in fade-in duration-200 print:hidden"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col border border-slate-200 animate-in zoom-in-95 duration-200 text-right"
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-sky-800 via-sky-900 to-indigo-950 text-white p-4 sm:p-5 flex items-center justify-between shrink-0 shadow-md">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 shadow-inner ${isCustomerSued ? 'bg-red-500/20 text-red-300 border border-red-400/30' : 'bg-white/10 text-white border border-white/20'}`}>
              {isCustomerSued ? <Gavel size={22} /> : <User size={22} />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base sm:text-lg font-black text-white">{primaryRow.customerName}</h3>
                
                {/* Regularity Badge: عميل منتظم vs عميل غير منتظم */}
                {hasOldOverdue ? (
                  <span className="text-[10px] bg-amber-500/25 text-amber-100 border border-amber-400/40 font-black px-2.5 py-0.5 rounded-full inline-flex items-center gap-1 shadow-2xs">
                    <Clock3 size={11} className="text-amber-300" /> عميل غير منتظم
                  </span>
                ) : (
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-200 border border-emerald-400/30 font-bold px-2.5 py-0.5 rounded-full inline-flex items-center gap-1 shadow-2xs">
                    <CheckCircle2 size={11} className="text-emerald-300" /> عميل منتظم
                  </span>
                )}

                {/* Lawsuit Badge: يظهر في مكان مخصص لو هو محال للقضاء فقط */}
                {isCustomerSued && (
                  <span className="text-[10px] bg-red-600 text-white font-black px-2.5 py-0.5 rounded-full inline-flex items-center gap-1 shadow-xs border border-red-400 animate-pulse">
                    <Gavel size={11} /> محال للقضاء
                  </span>
                )}

                {primaryRow.customerNumber && (
                  <span className="text-[10px] bg-white/15 text-sky-100 font-mono px-2 py-0.5 rounded-md">
                    #{primaryRow.customerNumber}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-sky-100/80 mt-1 flex-wrap font-medium">
                <span className="flex items-center gap-1">
                  <Phone size={12} className="text-sky-300 shrink-0" />
                  <span dir="ltr" className="font-mono">{primaryRow.customerPhone || '---'}</span>
                </span>
                {primaryRow.salesRepName && (
                  <>
                    <span className="w-1 h-1 rounded-full bg-sky-300/40"></span>
                    <span className="flex items-center gap-1">
                      <Briefcase size={12} className="text-sky-300 shrink-0" />
                      <span>المندوب: {primaryRow.salesRepName}</span>
                    </span>
                  </>
                )}
              </div>
              {/* Full Address - No truncation, completely visible */}
              <div className="flex items-start gap-1.5 text-xs text-sky-100/95 mt-1.5 font-medium bg-black/15 px-2.5 py-1 rounded-lg border border-white/10 w-fit max-w-full">
                <MapPin size={13} className="text-sky-300 shrink-0 mt-0.5" />
                <span className="leading-relaxed break-words">{primaryRow.customerAddress || 'العنوان غير مسجل'}</span>
              </div>
            </div>
          </div>

          {/* Header Controls: فقط زر الإغلاق لمنع تكرار زر الطباعة */}
          <div className="flex items-center gap-2 mr-3 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-all border border-white/20 cursor-pointer"
              title="إغلاق (Esc)"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Scrollable Modal Content */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5 space-y-4">
          {/* Legal Case Alert Bar — يظهر في مكان خاص منفصل لو هو محال للقضاء فقط */}
          {isCustomerSued && (
            <div className="bg-red-50 border-2 border-red-300 rounded-xl p-3 flex items-center justify-between text-red-900 shadow-2xs">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center text-red-700 shrink-0">
                  <Gavel size={18} />
                </div>
                <div>
                  <span className="text-xs font-black block text-red-900">إجراء قضائي نشط: العميل محال للشئون القانونية (نزاع قضائي)</span>
                  <span className="text-[11px] text-red-700 block">هذا العقد مسجل كقضية لدى المحامي لمباشرة الإجراءات القانونية لوجود تعثر.</span>
                </div>
              </div>
              <span className="text-[10px] bg-red-600 text-white font-black px-2.5 py-1 rounded-lg shrink-0 shadow-2xs">
                نزاع قضائي
              </span>
            </div>
          )}
          {/* 4 Financial Metric Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {/* Invoice Info */}
            <div className="bg-sky-50/70 border border-sky-100 rounded-xl p-3 flex flex-col justify-between">
              <span className="text-[11px] font-bold text-sky-800">رقم الفاتورة والعقد</span>
              <span className="text-base font-black text-sky-950 font-mono mt-1">{primaryRow.invoiceNumber}</span>
              <span className="text-[10px] text-sky-600 font-semibold mt-1">
                تاريخ العقد: {matchedSale ? formatDateDisplay(matchedSale.date) : '---'}
              </span>
            </div>

            {/* Current Period Due */}
            <div className="bg-rose-50/70 border border-rose-100 rounded-xl p-3 flex flex-col justify-between">
              <span className="text-[11px] font-bold text-rose-800">المستحق لهذه الفترة</span>
              <span className="text-base font-black text-rose-600 mt-1">{formatCurrency(totalPeriodDue)}</span>
              <span className="text-[10px] text-rose-500 font-semibold mt-1">
                سُدد بالفترة: {formatCurrency(totalPeriodPaid)}
              </span>
            </div>

            {/* Total Contract Remaining */}
            <div className="bg-amber-50/70 border border-amber-100 rounded-xl p-3 flex flex-col justify-between">
              <span className="text-[11px] font-bold text-amber-800">إجمالي متبقي العقد</span>
              <span className="text-base font-black text-amber-700 mt-1">{formatCurrency(contractRemaining)}</span>
              <span className="text-[10px] text-amber-600 font-semibold mt-1">
                إجمالي العقد: {formatCurrency(contractTotal)}
              </span>
            </div>

            {/* Last Payment */}
            <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3 flex flex-col justify-between">
              <span className="text-[11px] font-bold text-slate-600">آخر سداد سابق</span>
              <span className="text-sm font-black text-slate-800 mt-1">
                {primaryRow.lastPaymentDate ? formatDateDisplay(primaryRow.lastPaymentDate) : 'لا يوجد سداد سابق'}
              </span>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="text-[10px] text-slate-400 font-bold">نسبة السداد:</span>
                <span className="text-[10px] font-black text-emerald-700 bg-emerald-50 px-1 rounded">{contractProgressPct}%</span>
              </div>
            </div>
          </div>

          {/* Guarantors Card */}
          <div className="bg-amber-50/60 border border-amber-200/80 rounded-xl p-3.5">
            <div className="flex items-center gap-2 mb-2 text-xs font-black text-amber-900">
              <Shield size={15} className="text-amber-600" />
              <span>بيانات الضامنين ({guarantors.length})</span>
            </div>
            {guarantors.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {guarantors.map((g: any, idx: number) => (
                  <div key={idx} className="bg-white border border-amber-200/60 rounded-xl p-2.5 flex flex-col gap-1 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-800 text-xs">{g.name || 'ضامن'}</span>
                      {g.relation && (
                        <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.2 rounded font-bold">
                          {g.relation}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-slate-600 flex-wrap">
                      {g.phone && (
                        <span className="flex items-center gap-1 font-mono text-slate-700 font-semibold" dir="ltr">
                          <Phone size={11} className="text-slate-400" />
                          {g.phone}
                        </span>
                      )}
                      {g.nationalId && (
                        <span className="text-slate-500">
                          الرقم القومي: <span className="font-mono">{g.nationalId}</span>
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-amber-800/80 font-medium">لا يوجد ضامنين مسجلين لهذا العقد.</p>
            )}
          </div>

          {/* Purchased Items Card (if available) */}
          {items.length > 0 && (
            <div className="bg-slate-50/80 border border-slate-200 rounded-xl p-3.5">
              <span className="text-xs font-black text-slate-700 block mb-2 flex items-center gap-1.5">
                <Package size={14} className="text-sky-600" />
                الأصناف والمشتريات المسجلة بالعقد ({items.length})
              </span>
              <div className="flex flex-wrap gap-2">
                {items.map((item: any, idx: number) => (
                  <div key={idx} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-bold shadow-2xs">
                    <span className="text-slate-900">{item.productName || item.name}</span>
                    <span className="text-[10px] text-slate-400 font-semibold">×{item.quantity}</span>
                    <span className="text-[11px] font-black text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">
                      {formatCurrency(item.total || (item.unitPrice * item.quantity))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Installments Table Card */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
            {/* Table Header and Scope Switcher */}
            <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                <CalendarRange size={14} className="text-sky-600" />
                جدول الأقساط
              </span>
              {matchedSale?.financing?.schedules && matchedSale.financing.schedules.length > 0 && (
                <div className="inline-flex h-7 items-center rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-[11px] font-bold">
                  <button
                    type="button"
                    onClick={() => setActiveTab('period')}
                    className={`h-full px-2.5 rounded-md transition-all ${
                      activeTab === 'period' ? 'bg-white text-sky-700 font-black shadow-2xs' : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    أقساط الفترة الحالية ({periodInstallments.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('all')}
                    className={`h-full px-2.5 rounded-md transition-all ${
                      activeTab === 'all' ? 'bg-white text-sky-700 font-black shadow-2xs' : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    كامل أقساط العقد ({matchedSale.financing.schedules.length})
                  </button>
                </div>
              )}
            </div>

            {/* Table */}
            <div className="overflow-x-auto max-h-60 overflow-y-auto">
              <table className="w-full text-right text-xs">
                <thead className="sticky top-0 bg-slate-50/95 backdrop-blur-xs text-slate-600 border-b border-slate-200 font-bold">
                  <tr>
                    <th className="px-3.5 py-2 text-right">القسط</th>
                    <th className="px-3 py-2 text-center">تاريخ الاستحقاق</th>
                    <th className="px-3 py-2 text-center">قيمة القسط</th>
                    <th className="px-3 py-2 text-center">المسدد</th>
                    <th className="px-3 py-2 text-center">المتبقي</th>
                    <th className="px-3 py-2 text-center">تاريخ آخر سداد</th>
                    <th className="px-3 py-2 text-center">الحالة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {displayedRows.map((row: any, idx: number) => {
                    const rowLabel = row.installmentLabel || row.label || `القسط ${row.monthIndex || idx + 1}`;
                    const rowAmount = row.installmentAmount || row.amount || 0;
                    const rowPaid = row.paidAmount || (row.status === 'paid' ? rowAmount : 0);
                    const rowRemaining = row.remainingAmount !== undefined ? row.remainingAmount : (row.status === 'paid' ? 0 : Math.max(0, rowAmount - rowPaid));
                    const isPaid = row.status === 'paid' || rowRemaining <= 1;
                    const rowStatus = isPaid ? 'paid' : (rowPaid > 0 ? 'partial' : row.status || 'unpaid');
                    const lastPayDate = row.paidAt || row.lastPaymentDate;

                    return (
                      <tr key={idx} className={`hover:bg-slate-50/50 transition-colors ${isPaid ? 'bg-emerald-50/20' : ''}`}>
                        <td className="px-3.5 py-2 font-bold text-slate-800">{rowLabel}</td>
                        <td className="px-3 py-2 text-center font-medium text-slate-600">
                          {formatDateDisplay(row.dueDate)}
                        </td>
                        <td className="px-3 py-2 text-center font-semibold text-slate-700">
                          {formatCurrency(rowAmount)}
                        </td>
                        <td className="px-3 py-2 text-center font-bold text-emerald-700">
                          {formatCurrency(rowPaid)}
                        </td>
                        <td className={`px-3 py-2 text-center font-black ${isPaid ? 'text-emerald-700' : 'text-rose-600'}`}>
                          {isPaid ? '0 جنيه' : formatCurrency(rowRemaining)}
                        </td>
                        <td className="px-3 py-2 text-center text-slate-500 font-medium text-[11px]">
                          {lastPayDate ? formatDateDisplay(lastPayDate) : '---'}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <MonthBadge status={rowStatus as any} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="bg-slate-50 border-t border-slate-200 px-5 py-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-600">
            <span>نسبة إنجاز العقد:</span>
            <div className="w-28 bg-slate-200 h-2 rounded-full overflow-hidden">
              <div className="bg-emerald-500 h-full rounded-full transition-all duration-300" style={{ width: `${contractProgressPct}%` }}></div>
            </div>
            <span className="text-emerald-700 font-black">{contractProgressPct}%</span>
          </div>

          <div className="flex items-center gap-2">
            {onPrint && (
              <button
                type="button"
                onClick={printStatement}
                className="h-8 px-3.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs shadow-2xs transition-all active:scale-95 cursor-pointer flex items-center gap-1.5"
                title="طباعة كشف حساب العميل"
              >
                <Printer size={13} />
                <span>طباعة كشف الحساب</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="h-8 px-5 rounded-xl bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs shadow-2xs transition-all active:scale-95 cursor-pointer"
            >
              إغلاق
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


