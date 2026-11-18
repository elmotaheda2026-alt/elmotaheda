import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays,
  Package,
  Plus,
  Save,
  ShoppingCart,
  Info,
  Trash2,
  Search,
  Printer,
  FileSpreadsheet,
  Edit3,
  Eye,
  CalendarCheck,
  ArrowRight,
  Loader2,
  RotateCcw,
} from 'lucide-react';
import { Customer, Product, PurchaseItem, SaleItem, Supplier, SalesRep, Sale } from '../types';
import {
  createNotification,
  createPayment,
  createProduct,
  deleteProduct,
  createPurchase,
  createSale,
  getCustomers,
  getNextSaleInvoiceNumber,
  getProducts,
  getSuppliers,
  getSalesReps,
  getSales,
  updateSale,
  deleteSale,
  returnSale,
  syncSales,
  syncCustomers,
  syncProducts,
  syncSuppliers,
  syncSalesReps,
} from '../lib/storage';
import { useAuth } from '../context/AuthContext';
import { useDialog } from '../context/DialogContext';
import { hasPermission, isAdmin } from '../lib/permissions';
import LegalDocumentsPrintModal from '../components/LegalDocumentsPrintModal';
import { DatePicker } from '../components/DatePicker';
import { formatDateDisplay } from '../lib/dateUtils';
import { formatWholeCurrency } from '../lib/utils';
import LoadingState from '../components/LoadingState';
import { api, isApiMode } from '../lib/apiClient';
import { useRealtimeSync } from '../lib/realtimeSync';

type PaymentMethod = 'cash' | 'card' | 'transfer' | 'installment';

interface DraftItem {
  productId: string;
  productName?: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  tax: number;
  supplierId?: string;
  sourceType?: 'warehouse' | 'on_demand';
  cost?: number;
}

interface QuickProductForm {
  name: string;
  purchasePrice: number;
  salePrice: number;
  supplierId: string;
}

const pad = (value: number) => String(value).padStart(2, '0');

const formatLocalDate = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const today = () => formatLocalDate(new Date());

const sortSalesNewestFirst = (entries: Sale[]) =>
  entries.slice().sort((a, b) => {
    const bTime = new Date(b.createdAt || b.date).getTime();
    const aTime = new Date(a.createdAt || a.date).getTime();
    return bTime - aTime;
  });

function addMonths(dateStr: string, months: number): string {
  if (!dateStr) return dateStr;

  let y: number, m: number, d: number;
  const ymd = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(dateStr.trim());
  if (ymd) {
    y = parseInt(ymd[1], 10);
    m = parseInt(ymd[2], 10) - 1;
    d = parseInt(ymd[3], 10);
  } else {
    const dmy = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(dateStr.trim());
    if (dmy) {
      y = parseInt(dmy[3], 10);
      m = parseInt(dmy[2], 10) - 1;
      d = parseInt(dmy[1], 10);
    } else {
      const parsed = new Date(dateStr);
      if (isNaN(parsed.getTime())) return dateStr;
      y = parsed.getFullYear();
      m = parsed.getMonth();
      d = parsed.getDate();
    }
  }

  const totalMonths = (y * 12 + m) + months;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = (totalMonths % 12) + 1;
  const daysInMonth = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  const finalDay = Math.min(d, daysInMonth);

  return `${targetYear}-${pad(targetMonth)}-${pad(finalDay)}`;
}

const normalizeArabic = (str: string): string => {
  if (!str) return '';
  return str
    .replace(/[أإآا]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[ىي]/g, 'ي')
    .trim()
    .toLowerCase();
};

export default function Invoices() {
  const { settings, user } = useAuth();
  const { confirmDialog, showToast } = useDialog();
  const canDelete = isAdmin(user);
  const canWriteSale = hasPermission(user, 'sales:write');
  const [cashPaidManuallyEdited, setCashPaidManuallyEdited] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [salesReps, setSalesReps] = useState<SalesRep[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [selectedSalesRepId, setSelectedSalesRepId] = useState('');
  const [procurementSupplierId, setProcurementSupplierId] = useState('');
  const [autoProcureEnabled, setAutoProcureEnabled] = useState(true);
  const [quickProduct, setQuickProduct] = useState<QuickProductForm>({
    name: '',
    purchasePrice: 0,
    salePrice: 0,
    supplierId: '',
  });
  const [customerSearchTerm, setCustomerSearchTerm] = useState('');
  const [showCustomerSuggestions, setShowCustomerSuggestions] = useState(false);

  const customerSuggestions = useMemo(() => {
    const term = normalizeArabic(customerSearchTerm);
    if (term.length < 1) return [];
    return customers.filter(
      (c) =>
        normalizeArabic(c.name).includes(term) ||
        (c.phone && c.phone.includes(term)) ||
        (c.nationalId && c.nationalId.includes(term))
    );
  }, [customers, customerSearchTerm]);

  useEffect(() => {
    const customer = customers.find((c) => c.id === selectedCustomerId);
    if (customer) {
      if (customerSearchTerm !== customer.name) {
        setCustomerSearchTerm(customer.name);
      }
    } else {
      if (!showCustomerSuggestions && customerSearchTerm !== '') {
        setCustomerSearchTerm('');
      }
    }
  }, [selectedCustomerId, customers, showCustomerSuggestions]);

  // Autocomplete for Sales Representative
  const [salesRepSearchTerm, setSalesRepSearchTerm] = useState('');
  const [showSalesRepSuggestions, setShowSalesRepSuggestions] = useState(false);

  const salesRepSuggestions = useMemo(() => {
    const term = normalizeArabic(salesRepSearchTerm);
    if (term.length < 1) return [];
    return salesReps.filter((r) => normalizeArabic(r.name).includes(term));
  }, [salesReps, salesRepSearchTerm]);

  useEffect(() => {
    const rep = salesReps.find((r) => r.id === selectedSalesRepId);
    if (rep) {
      if (salesRepSearchTerm !== rep.name) {
        setSalesRepSearchTerm(rep.name);
      }
    } else {
      if (!showSalesRepSuggestions && salesRepSearchTerm !== '') {
        setSalesRepSearchTerm('');
      }
    }
  }, [selectedSalesRepId, salesReps, showSalesRepSuggestions]);

  // Autocomplete for Supplier
  const [supplierSearchTerm, setSupplierSearchTerm] = useState('');
  const [showSupplierSuggestions, setShowSupplierSuggestions] = useState(false);

  const supplierSuggestions = useMemo(() => {
    const term = normalizeArabic(supplierSearchTerm);
    if (term.length < 1) return [];
    return suppliers.filter((s) => normalizeArabic(s.name).includes(term));
  }, [suppliers, supplierSearchTerm]);

  useEffect(() => {
    const supplier = suppliers.find((s) => s.id === procurementSupplierId);
    if (supplier) {
      if (supplierSearchTerm !== supplier.name) {
        setSupplierSearchTerm(supplier.name);
      }
    } else {
      if (!showSupplierSuggestions && supplierSearchTerm !== '') {
        setSupplierSearchTerm('');
      }
    }
  }, [procurementSupplierId, suppliers, showSupplierSuggestions]);

  // Auto-select single supplier if available
  useEffect(() => {
    if (suppliers.length === 1 && !procurementSupplierId) {
      setProcurementSupplierId(suppliers[0].id);
      setSupplierSearchTerm(suppliers[0].name);
    }
  }, [suppliers, procurementSupplierId]);

  // Autocomplete for Quick Product Supplier (On-demand)
  const [quickSupplierSearchTerm, setQuickSupplierSearchTerm] = useState('');
  const [showQuickSupplierSuggestions, setShowQuickSupplierSuggestions] = useState(false);

  const quickSupplierSuggestions = useMemo(() => {
    const term = normalizeArabic(quickSupplierSearchTerm);
    if (term.length < 1) return [];
    return suppliers.filter((s) => normalizeArabic(s.name).includes(term));
  }, [suppliers, quickSupplierSearchTerm]);

  useEffect(() => {
    if (!quickProduct.supplierId && !showQuickSupplierSuggestions && quickSupplierSearchTerm !== '') {
      setQuickSupplierSearchTerm('');
    }
  }, [quickProduct.supplierId, showQuickSupplierSuggestions, quickSupplierSearchTerm]);

  // Dual-mode item addition (Warehouse vs On-Demand)
  const [itemSourceMode, setItemSourceMode] = useState<'warehouse' | 'on_demand'>('warehouse');

  // Warehouse item state
  const [warehouseSearchTerm, setWarehouseSearchTerm] = useState('');
  const [showWarehouseSuggestions, setShowWarehouseSuggestions] = useState(false);
  const [selectedWarehouseProductId, setSelectedWarehouseProductId] = useState('');
  const [warehouseQuantity, setWarehouseQuantity] = useState<number | ''>(1);
  const [warehouseTax, setWarehouseTax] = useState<number | ''>('');
  const [warehouseSalePrice, setWarehouseSalePrice] = useState<number | ''>('');
  const warehouseSearchContainerRef = useRef<HTMLDivElement>(null);

  // On-demand item state
  const [onDemandName, setOnDemandName] = useState('');
  const [onDemandPurchasePrice, setOnDemandPurchasePrice] = useState<number | ''>('');
  const [onDemandSalePrice, setOnDemandSalePrice] = useState<number | ''>('');
  const [onDemandSupplierId, setOnDemandSupplierId] = useState('');
  const [onDemandSupplierSearchTerm, setOnDemandSupplierSearchTerm] = useState('');
  const [showOnDemandSupplierSuggestions, setShowOnDemandSupplierSuggestions] = useState(false);

  const onDemandSupplierSuggestions = useMemo(() => {
    const term = normalizeArabic(onDemandSupplierSearchTerm);
    if (term.length < 1) return [];
    return suppliers.filter((s) => normalizeArabic(s.name).includes(term));
  }, [suppliers, onDemandSupplierSearchTerm]);

  useEffect(() => {
    const sup = suppliers.find((s) => s.id === onDemandSupplierId);
    if (sup) {
      if (onDemandSupplierSearchTerm !== sup.name) {
        setOnDemandSupplierSearchTerm(sup.name);
      }
    } else if (!showOnDemandSupplierSuggestions && onDemandSupplierSearchTerm !== '') {
      setOnDemandSupplierSearchTerm('');
    }
  }, [onDemandSupplierId, suppliers, showOnDemandSupplierSuggestions]);
  const [onDemandQuantity, setOnDemandQuantity] = useState<number | ''>(1);
  const [onDemandTax, setOnDemandTax] = useState<number | ''>('');

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        warehouseSearchContainerRef.current &&
        !warehouseSearchContainerRef.current.contains(event.target as Node)
      ) {
        setShowWarehouseSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(today());
  const [paymentDate, setPaymentDate] = useState(today());
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('installment');
  const [paidAmount, setPaidAmount] = useState(0);
  const [installmentMonths, setInstallmentMonths] = useState(12);
  const [invoiceNotes, setInvoiceNotes] = useState('');
  const [lineProductId, setLineProductId] = useState('');
  const [lineQuantity, setLineQuantity] = useState<number | ''>('');
  const [lineDiscount, setLineDiscount] = useState<number | ''>('');
  const [lineTax, setLineTax] = useState<number | ''>('');
  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);
  const [showQuickProduct, setShowQuickProduct] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [savedSaleForPrinting, setSavedSaleForPrinting] = useState<Sale | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [modalSearchQuery, setModalSearchQuery] = useState('');
  const [modalSearchLoading, setModalSearchLoading] = useState(false);
  const [modalContracts, setModalContracts] = useState<Sale[]>([]);
  const [modalPage, setModalPage] = useState(1);
  const [modalTotalPages, setModalTotalPages] = useState(1);
  const [modalTotalCount, setModalTotalCount] = useState(0);
  const [editingSaleId, setEditingSaleId] = useState<string | null>(null);
  const [deferModalSale, setDeferModalSale] = useState<Sale | null>(null);
  const [deferInstallmentId, setDeferInstallmentId] = useState('');
  const [deferNewDueDate, setDeferNewDueDate] = useState('');
  const [deferStrategy, setDeferStrategy] = useState<'shift_subsequent' | 'merge_next'>('shift_subsequent');
  const [deferPenaltyFee, setDeferPenaltyFee] = useState<number>(0);
  const [deferPenaltyPaymentType, setDeferPenaltyPaymentType] = useState<'add_to_debt' | 'collect_cash'>('add_to_debt');
  const [deferLoading, setDeferLoading] = useState(false);
  const [deferMessage, setDeferMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [rescheduleModalSale, setRescheduleModalSale] = useState<Sale | null>(null);
  const [rescheduleMonths, setRescheduleMonths] = useState<number>(6);
  const [rescheduleExtraInterest, setRescheduleExtraInterest] = useState<number>(0);
  const [rescheduleStartDate, setRescheduleStartDate] = useState<string>('');
  const [rescheduleReason, setRescheduleReason] = useState<string>('');
  const [rescheduleLoading, setRescheduleLoading] = useState(false);
  const [rescheduleMessage, setRescheduleMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [detailsModalSale, setDetailsModalSale] = useState<Sale | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const customerInputRef = useRef<HTMLInputElement>(null);
  const productSelectRef = useRef<HTMLSelectElement>(null);
  const quantityInputRef = useRef<HTMLInputElement>(null);
  const addLineButtonRef = useRef<HTMLButtonElement>(null);

  const refreshSalesList = async () => {
    await syncSales();
    const refreshedSales = sortSalesNewestFirst(getSales());
    setSales(refreshedSales);
    return refreshedSales;
  };

  const searchContracts = async (query: string, cancelledRef: { current: boolean }, targetPage = modalPage) => {
    const q = query.trim();
    const limit = 20;
    if (isApiMode()) {
      const res = await api.listSalesPaged({ search: q || undefined, page: targetPage, limit, includeItems: true });
      if (!cancelledRef.current) {
        setModalContracts(sortSalesNewestFirst(res.sales || []));
        setModalTotalCount(res.total || 0);
        setModalTotalPages(Math.max(1, Math.ceil((res.total || 0) / limit)));
      }
      return;
    }

    const normalizedQuery = q.toLowerCase();
    const localResults = sortSalesNewestFirst(getSales()).filter(
      (sale) =>
        !normalizedQuery ||
        sale.invoiceNumber.toLowerCase().includes(normalizedQuery) ||
        sale.customerName.toLowerCase().includes(normalizedQuery),
    );
    if (!cancelledRef.current) {
      setModalTotalCount(localResults.length);
      setModalTotalPages(Math.max(1, Math.ceil(localResults.length / limit)));
      const start = (targetPage - 1) * limit;
      setModalContracts(localResults.slice(start, start + limit));
    }
  };

  const openContractsSearch = () => {
    setModalPage(1);
    setModalSearchQuery('');
    setShowSearchModal(true);
  };

  useEffect(() => {
    if (!showSearchModal) return;

    const cancelledRef = { current: false };
    const query = modalSearchQuery.trim();

    const timer = window.setTimeout(async () => {
      setModalSearchLoading(true);
      try {
        await searchContracts(query, cancelledRef, modalPage);
      } catch (err: any) {
        if (!cancelledRef.current) {
          setMessage({
            type: 'error',
            text: err.message || 'حدث خطأ أثناء تحميل سجل التعاقدات.',
          });
        }
      } finally {
        if (!cancelledRef.current) setModalSearchLoading(false);
      }
    }, 250);

    return () => {
      cancelledRef.current = true;
      window.clearTimeout(timer);
    };
  }, [showSearchModal, modalSearchQuery, modalPage]);

  const handleLoadForEdit = (sale: Sale) => {
    if (sale.status === 'cancelled') {
      setMessage({ type: 'error', text: 'لا يمكن تعديل تعاقد ملغى أو مرتجع.' });
      return;
    }
    if (sale.locked || Number(sale.paid || 0) > 0) {
      setMessage({ type: 'error', text: 'هذا التعاقد مقفل لوجود مدفوعات مسددة عليه. يرجى عكس السدادات أولاً أو عمل مرتجع.' });
      return;
    }

    setEditingSaleId(sale.id);
    setCashPaidManuallyEdited(true);
    setSelectedCustomerId(sale.customerId);
    setSelectedSalesRepId(sale.financing?.salesRepId || '');
    setInvoiceNumber(sale.invoiceNumber);
    setInvoiceDate(sale.date ? sale.date.substring(0, 10) : today());
    const isInstallment =
      sale.financing?.paymentMethod === 'installment' ||
      (sale.financing?.schedules && sale.financing.schedules.length > 0) ||
      Boolean(sale.financing?.installmentMonths && sale.financing.installmentMonths > 0);
    setPaymentMethod(isInstallment ? 'installment' : (sale.financing?.paymentMethod as any) || 'installment');
    setPaidAmount(sale.financing?.upfrontAmount || sale.paid);
    setInstallmentMonths(
      sale.financing?.installmentMonths
      || sale.financing?.schedules?.length
      || 12
    );
    setInvoiceNotes(sale.notes || '');

    setDraftItems(
      (sale.items || []).map((item) => {
        const matchedProd = products.find((p) => p.id === item.productId);
        const inferredSource: 'warehouse' | 'on_demand' =
          item.fulfillmentType === 'on_demand' || matchedProd?.fulfillmentType === 'on_demand'
            ? 'on_demand'
            : 'warehouse';
        return {
          productId: item.productId,
          productName: item.productName,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount,
          tax: item.tax,
          sourceType: inferredSource,
          cost: item.unitCost || matchedProd?.purchasePrice || item.unitPrice,
        };
      })
    );

    window.scrollTo({ top: 0, behavior: 'smooth' });
    setMessage({
      type: 'success',
      text: `تم تحميل بيانات التعاقد رقم ${sale.invoiceNumber} للتعديل والمراجعة بنجاح. يمكنك الآن تعديل أي خانات أو أصناف ثم الحفظ.`,
    });
  };

  const handleReturnContract = async (sale: Sale) => {
    const isConfirmed = await confirmDialog({
      title: 'تأكيد مرتجع وإلغاء التعاقد',
      message: `هل أنت متأكد من عمل مرتجع وإلغاء للتعاقد رقم ${sale.invoiceNumber}؟`,
      subMessage: sale.paid > 0
        ? `سيتم رد مبلغ ${formatCurrency(sale.paid)} للعميل من الخزينة، وإرجاع البضاعة للمخزون، وإسقاط المديونية المتبقية.`
        : 'سيتم إرجاع البضاعة للمخزون وإسقاط المديونية المتبقية مع الاحتفاظ بسجل العملية.',
      confirmText: 'نعم، تأكيد المرتجع',
      cancelText: 'تراجع',
      type: 'danger',
    });
    if (!isConfirmed) return;

    try {
      const res = await returnSale(sale.id, {
        reason: 'مرتجع فاتورة من سجل التعاقدات',
        returnDate: today(),
        refundAmount: Number(sale.paid || 0),
      });
      await refreshSalesList();
      setModalContracts((current) =>
        current.map((entry) =>
          entry.id === sale.id
            ? { ...entry, status: 'cancelled', remaining: 0 }
            : entry,
        ),
      );
      showToast(res.message || 'تم تسجيل المرتجع وإلغاء التعاقد بنجاح', 'success');
      setMessage({ type: 'success', text: res.message || `تم تسجيل مرتجع التعاقد ${sale.invoiceNumber} بنجاح.` });
      if (editingSaleId === sale.id) {
        resetForm();
      }
    } catch (err: any) {
      showToast(err?.message || 'حدث خطأ أثناء تنفيذ المرتجع.', 'error');
      setMessage({ type: 'error', text: err?.message || 'حدث خطأ أثناء تنفيذ المرتجع.' });
    }
  };

  const handleDeleteContract = async (sale: Sale) => {
    const isConfirmed = await confirmDialog({
      title: 'تأكيد حذف التعاقد',
      message: `هل أنت متأكد من حذف التعاقد رقم ${sale.invoiceNumber}؟`,
      subMessage: 'سيتم حذف التعاقد والأقساط والمدفوعات والحسابات المرتبطة به من النظام نهائياً.',
      confirmText: 'نعم، حذف التعاقد',
      cancelText: 'إلغاء',
      type: 'danger',
    });
    if (!isConfirmed) return;

    try {
      await deleteSale(sale.id, user?.name || 'system');
      setSales((current) => current.filter((entry) => entry.id !== sale.id));
      setModalContracts((current) => current.filter((entry) => entry.id !== sale.id));
      setMessage({
        type: 'success',
        text: `تم حذف التعاقد رقم ${sale.invoiceNumber} وكل الحسابات المرتبطة به بنجاح.`,
      });

      if (editingSaleId === sale.id) {
        resetForm();
      }
    } catch (err: any) {
      setMessage({
        type: 'error',
        text: err.message || 'حدث خطأ أثناء حذف التعاقد.',
      });
    }
  };

  const handleDeferInstallment = async () => {
    if (!deferModalSale || !deferInstallmentId || !deferNewDueDate) {
      setDeferMessage({ type: 'error', text: 'يرجى تحديد القسط وتاريخ التأجيل الجديد.' });
      return;
    }

    const cleanPenaltyFee = Number(deferPenaltyFee) > 0 ? Number(deferPenaltyFee) : 0;

    // Handle draft new contract locally without making an API call to a non-existent sale ID
    if (deferModalSale.id === 'draft-new-contract') {
      const targetMonthIndex = parseInt(deferInstallmentId.replace('inst-', ''), 10);
      if (isNaN(targetMonthIndex)) {
        setDeferMessage({ type: 'error', text: 'معرف القسط غير صالح.' });
        return;
      }

      setDeferMessage({ type: 'success', text: 'تم تحديث خطة الأقساط المسودة بنجاح.' });
      setTimeout(() => {
        setDeferModalSale(null);
        setDeferInstallmentId('');
        setDeferNewDueDate('');
        setDeferPenaltyFee(0);
        setDeferMessage(null);
      }, 1000);
      return;
    }

    setDeferLoading(true);
    setDeferMessage(null);
    try {
      const payload: {
        installmentId: string;
        newDueDate: string;
        strategy: 'shift_subsequent' | 'merge_next';
        penaltyFee?: number;
        penaltyPaymentType?: 'add_to_debt' | 'collect_cash';
      } = {
        installmentId: deferInstallmentId,
        newDueDate: deferNewDueDate,
        strategy: deferStrategy,
        penaltyFee: cleanPenaltyFee,
      };

      if (cleanPenaltyFee > 0) {
        payload.penaltyPaymentType = deferPenaltyPaymentType;
      }

      const result = await api.deferInstallment(deferModalSale.id, payload);

      // Refresh the sale data with updated schedules from the response
      if (result.sale) {
        setDeferModalSale(result.sale);
      } else {
        const refreshed = await api.getSale(deferModalSale.id);
        setDeferModalSale(refreshed);
      }
      await refreshSalesList();
      setDeferInstallmentId('');
      setDeferNewDueDate('');
      setDeferPenaltyFee(0);
      setDeferMessage({ type: 'success', text: result.message || 'تم ترحيل القسط بنجاح.' });
    } catch (err: any) {
      console.error('Error deferring installment:', err);
      const errorText = err?.message || 'حدث خطأ أثناء ترحيل القسط. يرجى مراجعة البيانات والمحاولة مجددًا.';
      setDeferMessage({ type: 'error', text: errorText });
    } finally {
      setDeferLoading(false);
    }
  };

  const handleUndoDeferInstallment = async (saleId: string, installmentId: string) => {
    const confirmed = await confirmDialog({
      title: 'التراجع عن ترحيل القسط',
      message: 'هل أنت متأكد من إلغاء الترحيل وإعادة جدول الأقساط والغرامات المرتبطة به لحالته السابقة؟',
      confirmText: 'نعم، تراجع عن الترحيل',
      cancelText: 'إلغاء',
      type: 'warning',
    });
    if (!confirmed) return;

    setDeferLoading(true);
    setDeferMessage(null);
    try {
      const result = await api.undoDeferInstallment(saleId, installmentId);
      if (result.sale && deferModalSale?.id === saleId) {
        setDeferModalSale(result.sale);
      } else if (deferModalSale?.id === saleId) {
        setDeferModalSale(await api.getSale(saleId));
      }
      await refreshSalesList();
      showToast(result.message || 'تم التراجع عن الترحيل بنجاح', 'success');
      setDeferMessage({ type: 'success', text: result.message || 'تم التراجع عن الترحيل بنجاح.' });
    } catch (err: any) {
      const errorText = err?.message || 'تعذر التراجع عن ترحيل القسط.';
      showToast(errorText, 'error');
      setDeferMessage({ type: 'error', text: errorText });
    } finally {
      setDeferLoading(false);
    }
  };

  const openDetailsModal = async (sale: Sale) => {
    setDetailsModalSale(sale);
    setShowSearchModal(false);
    if (isApiMode() && (!sale.items || sale.items.length === 0)) {
      setDetailsLoading(true);
      try {
        const fullSale = await api.getSale(sale.id);
        if (fullSale) setDetailsModalSale(fullSale);
      } catch (err) {
        console.error('Failed to load full sale details:', err);
      } finally {
        setDetailsLoading(false);
      }
    }
  };

  const openRescheduleModal = (sale: Sale) => {
    const unpaidSchedules = (sale.financing?.schedules ?? []).filter(
      (s) => s.status !== 'paid' && s.status !== 'settled_early',
    );
    const defaultMonths = Math.max(2, unpaidSchedules.length + 3);
    const firstPendingDate = unpaidSchedules[0]?.dueDate || addMonths(today(), 1);
    setRescheduleModalSale(sale);
    setRescheduleMonths(defaultMonths);
    setRescheduleExtraInterest(0);
    setRescheduleStartDate(firstPendingDate.includes('T') ? firstPendingDate.split('T')[0] : firstPendingDate);
    setRescheduleReason('');
    setRescheduleMessage(null);
    setShowSearchModal(false);
  };

  const handleRescheduleSubmit = async () => {
    if (!rescheduleModalSale) return;
    if (!rescheduleMonths || rescheduleMonths < 1) {
      setRescheduleMessage({ type: 'error', text: 'يرجى تحديد عدد الأقساط الجديدة (1 على الأقل).' });
      return;
    }
    if (!rescheduleStartDate) {
      setRescheduleMessage({ type: 'error', text: 'يرجى تحديد تاريخ بداية أول قسط جديد.' });
      return;
    }

    setRescheduleLoading(true);
    setRescheduleMessage(null);
    try {
      const result = await api.rescheduleSale(rescheduleModalSale.id, {
        newInstallmentCount: Math.max(1, Math.round(rescheduleMonths)),
        extraInterestPercent: Math.max(0, Number(rescheduleExtraInterest || 0)),
        firstNewDueDate: rescheduleStartDate,
        reason: rescheduleReason.trim(),
      });
      await refreshSalesList();
      if (result.sale) {
        setModalContracts((prev) =>
          prev.map((item) => (item.id === result.sale.id ? result.sale : item)),
        );
      }
      showToast(result.message || 'تمت إعادة جدولة المتبقي بنجاح', 'success');
      setRescheduleModalSale(null);
      setRescheduleMessage(null);
    } catch (err: any) {
      const errorText = err?.message || 'تعذر إعادة جدولة الأقساط.';
      setRescheduleMessage({ type: 'error', text: errorText });
    } finally {
      setRescheduleLoading(false);
    }
  };

  const loadData = async () => {
    await Promise.all([
      syncSales(),
      syncCustomers(),
      syncProducts(),
      syncSuppliers(),
      syncSalesReps(),
    ]);

    const loadedCustomers = getCustomers();
    const loadedProducts = getProducts();
    const loadedSuppliers = getSuppliers();
    const loadedSalesReps = getSalesReps();
    const loadedSales = getSales();

    setCustomers(loadedCustomers);
    setProducts(loadedProducts);
    setSuppliers(loadedSuppliers);
    setSalesReps(loadedSalesReps);
    setSales(sortSalesNewestFirst(loadedSales));
    setInvoiceNumber(getNextSaleInvoiceNumber());
  };

  useEffect(() => {
    void loadData();
  }, []);

  useRealtimeSync(['sales', 'payments', 'customers', 'products', 'suppliers'], () => {
    void loadData();
  });

  useEffect(() => {
    customerInputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F2') {
        event.preventDefault();
        resetForm();
        customerInputRef.current?.focus();
      }
      if (event.key === 'F5') {
        event.preventDefault();
        void refreshSalesList();
      }
      if (event.key === 'Escape') {
        if (showSearchModal) setShowSearchModal(false);
        if (savedSaleForPrinting) setSavedSaleForPrinting(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showSearchModal, savedSaleForPrinting, suppliers]);

  const selectedCustomer = customers.find((customer) => customer.id === selectedCustomerId) || null;
  const selectedProduct = products.find((product) => product.id === lineProductId) || null;
  const selectedProcurementSupplier =
    suppliers.find((supplier) => supplier.id === procurementSupplierId) || null;

  const stockedProducts = useMemo(() => {
    return products.filter((p) => p.fulfillmentType === 'stocked');
  }, [products]);

  const warehouseSuggestions = useMemo(() => {
    const term = normalizeArabic(warehouseSearchTerm);
    if (!term) return stockedProducts.slice(0, 15);
    return stockedProducts
      .filter(
        (p) =>
          normalizeArabic(p.name).includes(term) ||
          (p.barcode && normalizeArabic(p.barcode).includes(term))
      )
      .slice(0, 15);
  }, [stockedProducts, warehouseSearchTerm]);

  const selectedWarehouseProduct = useMemo(() => {
    return products.find((p) => p.id === selectedWarehouseProductId) || null;
  }, [products, selectedWarehouseProductId]);

  const handleSelectWarehouseProduct = (product: Product) => {
    setSelectedWarehouseProductId(product.id);
    setWarehouseSearchTerm(product.name);
    setShowWarehouseSuggestions(false);
    setWarehouseQuantity(1);
    setWarehouseTax(product.tax || settings.taxRate || '');
    setWarehouseSalePrice(product.salePrice > 0 ? product.salePrice : product.purchasePrice);
  };

  const rawSubtotal = draftItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const rawDiscountAmount = draftItems.reduce(
    (sum, item) => sum + (item.quantity * item.unitPrice * item.discount) / 100,
    0,
  );
  const preTaxTotal = rawSubtotal - rawDiscountAmount;
  const upfrontAgainstItems = Math.min(Math.max(paidAmount, 0), Math.max(preTaxTotal, 0));

  const draftRows = useMemo(() => {
    return draftItems.map((item) => {
      const product = products.find((entry) => entry.id === item.productId);
      const rowSupplierId = item.supplierId || procurementSupplierId;
      const supplier = suppliers.find((entry) => entry.id === rowSupplierId);
      const subtotal = item.unitPrice * item.quantity;
      const discountValue = (subtotal * item.discount) / 100;
      const amountBeforeTax = subtotal - discountValue;
      const paidShare = preTaxTotal > 0 ? (amountBeforeTax / preTaxTotal) * upfrontAgainstItems : 0;
      const taxableAmount = Math.max(amountBeforeTax - paidShare, 0);
      const taxValue = (taxableAmount * item.tax) / 100;
      const availableStock = product?.quantity || 0;
      const isStocked = item.sourceType === 'warehouse' || product?.fulfillmentType === 'stocked';
      const needsProcurement = !isStocked;
      const shortageQuantity = needsProcurement
        ? item.quantity
        : Math.max(item.quantity - availableStock, 0);

      return {
        ...item,
        product,
        productName: item.productName || product?.name || 'صنف غير معروف',
        barcode: product?.barcode || '',
        fulfillmentType: isStocked ? ('stocked' as const) : ('on_demand' as const),
        supplierId: rowSupplierId,
        supplierName: supplier?.name || '',
        availableStock,
        needsProcurement,
        shortageQuantity,
        total: amountBeforeTax + taxValue,
      };
    });
  }, [draftItems, products, suppliers, procurementSupplierId, preTaxTotal, upfrontAgainstItems]);

  const items: SaleItem[] = draftRows.map((item) => ({
    productId: item.productId,
    productName: item.productName,
    barcode: item.barcode,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    unitCost: item.cost || Number(item.product?.purchasePrice || item.unitPrice || 0),
    discount: item.discount,
    tax: item.tax,
    total: item.total,
  }));

  const procurementRows = draftRows.filter((item) => item.needsProcurement && item.shortageQuantity > 0);
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const discountAmount = items.reduce((sum, item) => sum + (item.quantity * item.unitPrice * item.discount) / 100, 0);
  const taxAmount = items.reduce((sum, item) => sum + (item.total - (item.quantity * item.unitPrice - (item.quantity * item.unitPrice * item.discount) / 100)), 0);
  const total = subtotal - discountAmount + taxAmount;
  const paid = Math.min(Math.max(paidAmount, 0), total);
  const remaining = Math.max(total - paid, 0);
  const firstInstallmentDate = addMonths(invoiceDate, 1);
  const effectiveMonths = paymentMethod === 'installment' ? Math.max(1, installmentMonths) : 0;
  const roundedRemaining = Math.round(remaining);
  const monthlyInstallment = effectiveMonths > 0 ? Math.round(roundedRemaining / effectiveMonths) : 0;
  const installmentPreview = Array.from({ length: effectiveMonths }, (_, index) => ({
    monthIndex: index + 1,
    dueDate: addMonths(firstInstallmentDate, index),
    amount:
      index === effectiveMonths - 1
        ? roundedRemaining - (monthlyInstallment * index)
        : monthlyInstallment,
  }));

  const procurementSubtotal = procurementRows.reduce(
    (sum, item) => sum + item.shortageQuantity * (item.product?.purchasePrice || item.cost || 0),
    0,
  );

  useEffect(() => {
    if (!editingSaleId && paymentMethod !== 'installment' && !cashPaidManuallyEdited) {
      setPaidAmount(Number(total.toFixed(2)));
    }
  }, [paymentMethod, total, editingSaleId, cashPaidManuallyEdited]);

  const formatCurrency = (amount: number) => formatWholeCurrency(amount, settings.currency);

  const editingSale = useMemo(() => {
    if (!editingSaleId) return null;
    return sales.find((s) => s.id === editingSaleId) || null;
  }, [editingSaleId, sales]);

  const resetForm = () => {
    setEditingSaleId(null);
    setCashPaidManuallyEdited(false);
    setInvoiceNumber(getNextSaleInvoiceNumber());
    setInvoiceDate(today());
    setPaymentDate(today());
    setPaymentMethod('installment');
    setPaidAmount(0);
    setInstallmentMonths(12);
    setInvoiceNotes('');
    setLineProductId('');
    setLineQuantity('');
    setLineDiscount('');
    setLineTax('');
    setDraftItems([]);
    setSelectedSalesRepId('');
    setShowQuickProduct(false);
    setQuickProduct({
      name: '',
      purchasePrice: 0,
      salePrice: 0,
      supplierId: '',
    });
    setQuickSupplierSearchTerm('');
    setSelectedWarehouseProductId('');
    setWarehouseSearchTerm('');
    setShowWarehouseSuggestions(false);
    setWarehouseQuantity(1);
    setWarehouseTax('');
    setWarehouseSalePrice('');
    setOnDemandName('');
    setOnDemandPurchasePrice('');
    setOnDemandSalePrice('');
    setOnDemandQuantity(1);
    setOnDemandTax(settings.taxRate || '');
  };

  const addWarehouseItem = async () => {
    if (!selectedWarehouseProduct) {
      setMessage({ type: 'error', text: 'يرجى اختيار صنف من بضاعة المخزن أولاً.' });
      return;
    }

    const qty = Number(warehouseQuantity) || 0;
    if (qty <= 0) {
      setMessage({ type: 'error', text: 'الكمية يجب أن تكون أكبر من صفر.' });
      return;
    }

    const availableStock = selectedWarehouseProduct.quantity || 0;
    if (qty > availableStock) {
      const confirmExceed = await confirmDialog({
        title: 'تجاوز رصيد المخزن',
        message: `الكمية المطلوبة (${qty}) تتجاوز الرصيد المتوفر في المخزن (${availableStock}).`,
        subMessage: 'هل تريد المتابعة وإضافة الصنف على أية حال؟',
        confirmText: 'متابعة وإضافة',
        cancelText: 'إلغاء',
        type: 'warning',
      });
      if (!confirmExceed) return;
    }

    const unitPrice =
      Number(warehouseSalePrice) > 0
        ? Number(warehouseSalePrice)
        : selectedWarehouseProduct.salePrice > 0
          ? selectedWarehouseProduct.salePrice
          : selectedWarehouseProduct.purchasePrice;
    const discount = 0;
    const tax = Number(warehouseTax) || 0;

    setDraftItems((current) => {
      const existingIndex = current.findIndex(
        (item) => item.productId === selectedWarehouseProduct.id && item.sourceType === 'warehouse'
      );
      if (existingIndex !== -1) {
        return current.map((item, index) =>
          index === existingIndex
            ? {
              ...item,
              quantity: item.quantity + qty,
              unitPrice,
              discount,
              tax,
            }
            : item
        );
      }

      return [
        ...current,
        {
          productId: selectedWarehouseProduct.id,
          quantity: qty,
          unitPrice,
          discount,
          tax,
          sourceType: 'warehouse',
        },
      ];
    });

    setSelectedWarehouseProductId('');
    setWarehouseSearchTerm('');
    setShowWarehouseSuggestions(false);
    setWarehouseQuantity(1);
    setWarehouseTax('');
    setWarehouseSalePrice('');
    setMessage({
      type: 'success',
      text: `تمت إضافة الصنف "${selectedWarehouseProduct.name}" من المخزن بنجاح.`,
    });
  };

  const addOnDemandItem = () => {
    const trimmedName = onDemandName.trim();
    if (!trimmedName) {
      setMessage({ type: 'error', text: 'يرجى إدخال اسم الصنف.' });
      return;
    }
    if (
      selectedCustomer &&
      normalizeArabic(trimmedName) === normalizeArabic(selectedCustomer.name)
    ) {
      setMessage({
        type: 'error',
        text: 'اسم الصنف مطابق لاسم العميل المختار! يرجى كتابة اسم الصنف الفعلي وليس اسم العميل.',
      });
      return;
    }
    const cost = Number(onDemandPurchasePrice) || 0;
    if (cost <= 0) {
      setMessage({ type: 'error', text: 'يرجى إدخال سعر الشراء.' });
      return;
    }
    if (!onDemandSupplierId || !onDemandSupplierId.trim()) {
      setMessage({ type: 'error', text: 'يجب تحديد المورد أولاً قبل إضافة الصنف.' });
      return;
    }
    const qty = Number(onDemandQuantity) || 1;
    if (qty <= 0) {
      setMessage({ type: 'error', text: 'الكمية يجب أن تكون 1 أو أكثر.' });
      return;
    }

    const tempId = `temp_ondemand_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const sup = suppliers.find((s) => s.id === onDemandSupplierId);
    const cashSellPrice = Number(onDemandSalePrice) > 0 ? Number(onDemandSalePrice) : cost;

    setDraftItems((current) => [
      ...current,
      {
        productId: tempId,
        productName: onDemandName.trim(),
        quantity: qty,
        unitPrice: cashSellPrice,
        cost: cost,
        discount: 0,
        tax: Number(onDemandTax) || 0,
        supplierId: onDemandSupplierId,
        sourceType: 'on_demand',
      },
    ]);

    setProcurementSupplierId(onDemandSupplierId);

    setOnDemandName('');
    setOnDemandPurchasePrice('');
    setOnDemandSalePrice('');
    setOnDemandQuantity(1);
    setOnDemandTax(settings.taxRate || '');
    setOnDemandSupplierId('');

    setMessage({
      type: 'success',
      text: `تمت إضافة الصنف "${onDemandName.trim()}" إلى الفاتورة، وسيتم حفظه وربط مديونية المورد ${sup ? sup.name : ''} عند حفظ الفاتورة.`,
    });
  };

  const addLine = () => {
    if (!selectedProduct) {
      setMessage({ type: 'error', text: 'اختر الصنف أولًا أو أنشئ صنفًا سريعًا.' });
      return;
    }

    const qty = Number(lineQuantity) || 0;
    if (qty <= 0) {
      setMessage({ type: 'error', text: 'الكمية يجب أن تكون أكبر من صفر.' });
      return;
    }

    const unitPrice = selectedProduct.salePrice > 0 ? selectedProduct.salePrice : selectedProduct.purchasePrice;
    const discount = Number(lineDiscount) || 0;
    const tax = Number(lineTax) || 0;

    setDraftItems((current) => {
      const existingIndex = current.findIndex((item) => item.productId === selectedProduct.id);
      if (existingIndex !== -1) {
        return current.map((item, index) =>
          index === existingIndex
            ? {
              ...item,
              quantity: item.quantity + qty,
              unitPrice,
              discount: discount,
              tax: tax,
            }
            : item,
        );
      }

      return [
        ...current,
        {
          productId: selectedProduct.id,
          quantity: qty,
          unitPrice,
          discount: discount,
          tax: tax,
        },
      ];
    });

    setLineProductId('');
    setLineQuantity('');
    setLineDiscount('');
    setLineTax('');
    setMessage(null);
  };

  const updateLine = (index: number, next: Partial<DraftItem>) => {
    setDraftItems((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...next } : item)));
  };

  const handleQuickProductSave = async () => {
    const trimmedQuickName = quickProduct.name.trim();
    if (!trimmedQuickName) {
      setMessage({ type: 'error', text: 'أدخل اسم الصنف السريع.' });
      return;
    }
    if (
      selectedCustomer &&
      normalizeArabic(trimmedQuickName) === normalizeArabic(selectedCustomer.name)
    ) {
      setMessage({
        type: 'error',
        text: 'اسم الصنف مطابق لاسم العميل المختار! يرجى كتابة اسم الصنف الفعلي وليس اسم العميل.',
      });
      return;
    }

    if (quickProduct.purchasePrice <= 0) {
      setMessage({ type: 'error', text: 'أدخل سعر شراء صحيح.' });
      return;
    }

    const createdProduct = await createProduct({
      name: quickProduct.name.trim(),
      barcode: null,
      category: 'حسب الطلب',
      fulfillmentType: 'on_demand',
      unit: 'قطعة',
      purchasePrice: quickProduct.purchasePrice,
      salePrice: quickProduct.purchasePrice,
      discount: 0,
      tax: settings.taxRate,
      quantity: 0,
      minQuantity: 0,
      description: 'تم إنشاؤه سريعًا من شاشة الفواتير',
    });

    const refreshedProducts = getProducts();
    setProducts(refreshedProducts);
    setLineProductId(createdProduct.id);
    setLineTax(createdProduct.tax || '');
    if (quickProduct.supplierId) {
      setProcurementSupplierId(quickProduct.supplierId);
    }
    setQuickProduct({
      name: '',
      purchasePrice: 0,
      salePrice: 0,
      supplierId: '',
    });
    setQuickSupplierSearchTerm('');
    setShowQuickProduct(false);
    setMessage({ type: 'success', text: `تم إنشاء الصنف ${createdProduct.name} ويمكن إضافته مباشرة للفاتورة.` });
  };

  const ensureOnDemandProductsMap = async (): Promise<{
    idMap: Map<string, string>;
    createdProductIds: string[];
  }> => {
    const idMap = new Map<string, string>();
    const createdProductIds: string[] = [];
    for (const dItem of draftItems) {
      if (dItem.sourceType === 'on_demand' && dItem.productId.startsWith('temp_ondemand_')) {
        const cost = dItem.cost || dItem.unitPrice;
        const created = await createProduct({
          name: dItem.productName || 'صنف حسب الطلب',
          barcode: null,
          category: 'حسب الطلب',
          fulfillmentType: 'on_demand',
          unit: 'قطعة',
          purchasePrice: cost,
          salePrice: dItem.unitPrice,
          discount: 0,
          tax: dItem.tax,
          quantity: 0,
          minQuantity: 0,
          description: 'صنف حسب الطلب',
        });
        idMap.set(dItem.productId, created.id);
        createdProductIds.push(created.id);
      }
    }
    return { idMap, createdProductIds };
  };

  const buildFinalSaleItems = (idMap: Map<string, string>): SaleItem[] =>
    draftRows.map((item) => {
      const realProductId = idMap.get(item.productId) || item.productId;
      const prod = products.find((p) => p.id === realProductId);
      return {
        productId: realProductId,
        productName: item.productName,
        barcode: prod?.barcode || '',
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        unitCost: item.cost || Number(prod?.purchasePrice || item.unitPrice || 0),
        discount: item.discount,
        tax: item.tax,
        total: item.total,
        fulfillmentType: item.sourceType === 'warehouse' ? 'stocked' : 'on_demand',
      };
    });

  const createAutoPurchasesForSale = async (
    targetInvoiceNumber: string,
    customerName: string,
    idMap: Map<string, string>,
  ): Promise<string> => {
    let autoPurchaseNumber = '';
    if (!autoProcureEnabled || procurementRows.length === 0) return autoPurchaseNumber;

    const supplierGroups = new Map<string, typeof procurementRows>();
    for (const row of procurementRows) {
      const sId = row.supplierId || procurementSupplierId || selectedProcurementSupplier?.id;
      if (!sId) continue;
      const group = supplierGroups.get(sId) || [];
      group.push(row);
      supplierGroups.set(sId, group);
    }

    if (supplierGroups.size === 0 && selectedProcurementSupplier) {
      supplierGroups.set(selectedProcurementSupplier.id, procurementRows);
    }

    for (const [sId, groupRows] of supplierGroups.entries()) {
      const targetSupplier = suppliers.find((s) => s.id === sId) || selectedProcurementSupplier;
      if (!targetSupplier) continue;

      const purchaseItems: PurchaseItem[] = groupRows.map((item) => {
        const realProductId = idMap.get(item.productId) || item.productId;
        const unitPrice = item.product?.purchasePrice || item.cost || item.unitPrice || 0;
        const taxPerUnit = unitPrice * ((item.product?.tax || 0) / 100);

        return {
          productId: realProductId,
          productName: item.productName,
          barcode: item.barcode,
          quantity: item.shortageQuantity,
          unitPrice,
          discount: 0,
          tax: taxPerUnit,
          total: item.shortageQuantity * unitPrice + item.shortageQuantity * taxPerUnit,
        };
      });

      const purchaseSubtotal = purchaseItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
      const purchaseTax = purchaseItems.reduce((sum, item) => sum + item.quantity * item.tax, 0);
      const purchaseTotal = purchaseSubtotal + purchaseTax;

      const createdPurchase = await createPurchase({
        supplierId: targetSupplier.id,
        supplierName: targetSupplier.name,
        items: purchaseItems,
        subtotal: purchaseSubtotal,
        discount: 0,
        tax: purchaseTax,
        total: purchaseTotal,
        paid: 0,
        remaining: purchaseTotal,
        status: 'pending',
        date: invoiceDate,
        notes: `شراء تلقائي مرتبط بالفاتورة ${targetInvoiceNumber} للعميل ${customerName}`,
        createdBy: user?.name || 'مدير النظام',
      });

      autoPurchaseNumber = createdPurchase.invoiceNumber;

      createNotification({
        type: 'info',
        title: 'شراء تلقائي وتحديث مديونية المورد',
        message: `تم إنشاء فاتورة شراء ${createdPurchase.invoiceNumber} وتحديث مديونية المورد ${targetSupplier.name} بمبلغ ${formatCurrency(purchaseTotal)}`,
      });
    }

    return autoPurchaseNumber;
  };

  const saveInvoice = async () => {
    setMessage(null);
    if (!selectedCustomer) {
      setMessage({ type: 'error', text: 'اختر العميل قبل حفظ الفاتورة.' });
      return;
    }

    if (items.length === 0) {
      setMessage({ type: 'error', text: 'أضف صنفًا واحدًا على الأقل.' });
      return;
    }

    if (items.some((item) => !item.productId || item.quantity <= 0 || item.unitPrice < 0 || item.total < 0)) {
      setMessage({ type: 'error', text: 'راجع أصناف الفاتورة: يجب اختيار صنف وكمية صحيحة لكل بند.' });
      return;
    }

    if (total <= 0) {
      setMessage({ type: 'error', text: 'إجمالي الفاتورة يجب أن يكون أكبر من صفر.' });
      return;
    }

    if (autoProcureEnabled && procurementRows.some((r) => !r.supplierId && !procurementSupplierId)) {
      setMessage({ type: 'error', text: 'لا يمكن إتمام العملية: يجب تحديد المورد لكل صنف حسب الطلب.' });
      return;
    }

    if (editingSaleId) {
      let createdOnDemandIds: string[] = [];
      try {
        const { idMap, createdProductIds } = await ensureOnDemandProductsMap();
        createdOnDemandIds = createdProductIds;
        const finalSaleItems = buildFinalSaleItems(idMap);
        const updatedSale = await updateSale(editingSaleId, {
          customerId: selectedCustomer.id,
          customerName: selectedCustomer.name,
          items: finalSaleItems,
          subtotal,
          discount: discountAmount,
          tax: taxAmount,
          total,
          paid,
          remaining,
          status: remaining > 0 ? 'pending' : 'completed',
          date: invoiceDate,
          notes: invoiceNotes,
          createdBy: user?.name || 'مدير النظام',
          replaceAutoPurchases: true,
          financing: {
            paymentMethod,
            salesRepId: selectedSalesRepId || undefined,
            salesRepName: salesReps.find((r) => r.id === selectedSalesRepId)?.name,
            installmentMonths: paymentMethod === 'installment' ? effectiveMonths : 0,
            installmentStartDate: paymentMethod === 'installment' ? firstInstallmentDate : undefined,
            upfrontAmount: paid,
            monthlyInstallmentAmount: paymentMethod === 'installment' ? monthlyInstallment : undefined,
          },
        } as any);

        await createAutoPurchasesForSale(updatedSale.invoiceNumber, selectedCustomer.name, idMap);

        createNotification({
          type: 'success',
          title: 'تعديل تعاقد سابق',
          message: `تم تعديل وحفظ التعاقد رقم ${updatedSale.invoiceNumber} للعميل ${selectedCustomer.name} بنجاح`,
        });

        await syncProducts();
        setProducts(getProducts());
        setSales(sortSalesNewestFirst(getSales()));

        setMessage({
          type: 'success',
          text: `تم تعديل وحفظ التعاقد رقم ${updatedSale.invoiceNumber} بنجاح.`,
        });

        setSavedSaleForPrinting(updatedSale);
        setEditingSaleId(null);
        resetForm();
      } catch (err: any) {
        for (const prodId of createdOnDemandIds) {
          try {
            await deleteProduct(prodId);
          } catch (prodRollbackErr) {
            console.error('[Invoices] Product rollback cleanup failed:', prodRollbackErr);
          }
        }
        if (createdOnDemandIds.length > 0) {
          try {
            await syncProducts();
            setProducts(getProducts());
          } catch (syncErr) {
            console.error('[Invoices] Product sync after rollback failed:', syncErr);
          }
        }
        setMessage({ type: 'error', text: err.message || 'حدث خطأ أثناء تعديل التعاقد' });
      }
      return;
    }

    let createdSaleId: string | null = null;
    let createdOnDemandIds: string[] = [];
    try {
      const { idMap, createdProductIds } = await ensureOnDemandProductsMap();
      createdOnDemandIds = createdProductIds;
      const finalSaleItems = buildFinalSaleItems(idMap);

      const createdSale = await createSale({
        customerId: selectedCustomer.id,
        customerName: selectedCustomer.name,
        items: finalSaleItems,
        subtotal,
        discount: discountAmount,
        tax: taxAmount,
        total,
        paid,
        remaining,
        status: remaining > 0 ? 'pending' : 'completed',
        date: invoiceDate,
        notes: invoiceNotes,
        createdBy: user?.name || 'مدير النظام',
        financing: {
          paymentMethod,
          salesRepId: selectedSalesRepId || undefined,
          salesRepName: salesReps.find(r => r.id === selectedSalesRepId)?.name,
          installmentMonths: paymentMethod === 'installment' ? effectiveMonths : 0,
          installmentStartDate: paymentMethod === 'installment' ? firstInstallmentDate : undefined,
          upfrontAmount: paid,
          monthlyInstallmentAmount: paymentMethod === 'installment' ? monthlyInstallment : undefined,
        },
      });
      createdSaleId = createdSale.id;

      const autoPurchaseNumber = await createAutoPurchasesForSale(
        createdSale.invoiceNumber,
        selectedCustomer.name,
        idMap,
      );

      if (paid > 0) {
        if (isApiMode()) {
          await api.createPayment({
            type: 'in',
            amount: paid,
            saleId: createdSale.id,
            customerId: selectedCustomer.id,
            invoiceNumber: createdSale.invoiceNumber,
            description: `دفعة مقدمة للفاتورة ${createdSale.invoiceNumber}`,
            date: paymentDate,
            channel: 'cash',
            affectsCustomerBalance: false,
          });
        } else {
          await createPayment({
            type: 'in',
            amount: paid,
            referenceId: createdSale.id,
            referenceType: 'sale',
            description: `دفعة مقدمة للفاتورة ${createdSale.invoiceNumber}`,
            date: paymentDate,
            createdBy: user?.name || 'مدير النظام',
            customerId: selectedCustomer.id,
            saleId: createdSale.id,
            invoiceNumber: createdSale.invoiceNumber,
            affectsCustomerBalance: false,
          });
        }
      }

      createNotification({
        type: 'success',
        title: 'فاتورة جديدة',
        message:
          procurementRows.length > 0 && autoPurchaseNumber
            ? `تم حفظ الفاتورة ${createdSale.invoiceNumber} وإنشاء شراء تلقائي ${autoPurchaseNumber}`
            : `تم حفظ الفاتورة ${createdSale.invoiceNumber} للعميل ${selectedCustomer.name}`,
      });

      await syncProducts();
      const refreshedProducts = getProducts();
      setProducts(refreshedProducts);

      setSales(sortSalesNewestFirst(getSales()));

      setMessage({
        type: 'success',
        text:
          procurementRows.length > 0 && autoPurchaseNumber
            ? `تم حفظ الفاتورة ${createdSale.invoiceNumber} وإنشاء شراء تلقائي ${autoPurchaseNumber} من نفس الشاشة.`
            : `تم حفظ الفاتورة ${createdSale.invoiceNumber} بنجاح.`,
      });

      // Set for printing
      setSavedSaleForPrinting(createdSale);
      resetForm();
    } catch (err: any) {
      console.error('[Invoices] Failed to save invoice', err);
      if (createdSaleId) {
        try {
          await deleteSale(createdSaleId, user?.name || 'system');
        } catch (rollbackErr) {
          console.error('[Invoices] Rollback cleanup failed:', rollbackErr);
        }
      }
      for (const prodId of createdOnDemandIds) {
        try {
          await deleteProduct(prodId);
        } catch (prodRollbackErr) {
          console.error('[Invoices] Product rollback cleanup failed:', prodRollbackErr);
        }
      }
      if (createdOnDemandIds.length > 0) {
        try {
          await syncProducts();
          setProducts(getProducts());
        } catch (syncErr) {
          console.error('[Invoices] Product sync after rollback failed:', syncErr);
        }
      }
      setMessage({ type: 'error', text: err.message || 'تعذر حفظ الفاتورة. راجع البيانات وحاول مرة أخرى.' });
    }
  };

  return (
    <div className="flex flex-col h-full flex-1 min-h-0 overflow-hidden">
      {/* Fixed Header */}
      <div className="shrink-0 space-y-2 mb-2">
        <section className="erp-action-bar">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex-1">
              <h2 className="text-2xl font-bold text-slate-900">{editingSaleId ? 'تعديل تعاقد قائم' : 'إصدار فاتورة بيع'}</h2>
              <p className="mt-1 text-sm text-slate-500 leading-relaxed max-w-2xl">
                {editingSaleId ? 'أنت في وضع التعديل الآن. سيتم تحديث الكميات وحسابات العملاء تلقائياً عند الحفظ.' : 'شاشة واحدة تجمع العميل والصنف والتقسيط والشراء التلقائي عند الحاجة.'}
              </p>
              <div className="mt-1 flex items-center gap-2">
                <button
                  type="button"
                  onClick={openContractsSearch}
                  className="inline-flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 hover:bg-blue-100 text-blue-700 font-bold rounded-lg text-sm transition-all shadow-2xs active:scale-95 cursor-pointer"
                >
                  <Search size={16} />
                  <span>البحث في سجل التعاقدات</span>
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              <QuickCard label="رقم الفاتورة" value={invoiceNumber || '-'} />
              <QuickCard label="الإجمالي" value={formatCurrency(total)} tone="emerald" />
              <QuickCard
                label="أصناف تحتاج شراء"
                value={String(procurementRows.length)}
                tone={procurementRows.length > 0 ? 'amber' : 'slate'}
              />
            </div>
          </div>
        </section>

        {editingSaleId && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-center justify-between shadow-sm animate-pulse">
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-base">⚠️ وضع تعديل التعاقد:</span>
              <span>أنت تقوم الآن بتعديل بيانات التعاقد رقم <b>{invoiceNumber}</b>. يمكنك تعديل العملاء أو الأصناف أو شروط الدفع والضغط على "تعديل وحفظ التغييرات" باليسار.</span>
            </div>
            <button
              type="button"
              onClick={resetForm}
              className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm"
            >
              إلغاء التعديل والعودة للإنشاء
            </button>
          </div>
        )}

        {message && (
          <div
            className={`rounded-2xl border px-4 py-3 text-sm ${message.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-rose-200 bg-rose-50 text-rose-700'
              }`}
          >
            {message.text}
          </div>
        )}
      </div>

      {/* Scrollable Form Content */}
      <div className="flex-1 min-h-0 overflow-y-auto pr-1 pl-1 pb-10">
        <div className="grid grid-cols-1 gap-2 2xl:grid-cols-[minmax(0,1.7fr)_360px]">
          <div className="space-y-2">
            <Panel title="1. بيانات العميل والفاتورة" icon={<CalendarDays size={18} className="text-sky-600" />}>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <Field label="العميل">
                  <div className="relative w-full">
                    <input
                      ref={customerInputRef}
                      autoFocus
                      autoComplete="off"
                      value={customerSearchTerm}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          productSelectRef.current?.focus();
                        }
                      }}
                      onChange={(e) => {
                        setCustomerSearchTerm(e.target.value);
                        setShowCustomerSuggestions(true);
                        if (e.target.value.trim() === '') {
                          setSelectedCustomerId('');
                        }
                      }}
                      onFocus={() => setShowCustomerSuggestions(true)}
                      onBlur={() => setTimeout(() => setShowCustomerSuggestions(false), 200)}
                      className="input-ui w-full"
                      placeholder="اكتب اسم العميل للبحث..."
                    />
                    {showCustomerSuggestions && customerSuggestions.length > 0 && (
                      <div className="absolute right-0 left-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-50 max-h-60 overflow-y-auto divide-y divide-slate-100">
                        {customerSuggestions.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => {
                              setSelectedCustomerId(c.id);
                              setCustomerSearchTerm(c.name);
                              setShowCustomerSuggestions(false);
                            }}
                            className="w-full text-right px-4 py-2.5 text-sm text-slate-700 hover:bg-sky-50 hover:text-sky-700 font-medium transition-colors"
                          >
                            <span>{c.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </Field>

                <Field label="مندوب المبيعات">
                  <div className="relative w-full">
                    <input
                      value={salesRepSearchTerm}
                      onChange={(e) => {
                        setSalesRepSearchTerm(e.target.value);
                        setShowSalesRepSuggestions(true);
                        if (e.target.value.trim() === '') {
                          setSelectedSalesRepId('');
                        }
                      }}
                      onFocus={() => setShowSalesRepSuggestions(true)}
                      onBlur={() => setTimeout(() => setShowSalesRepSuggestions(false), 200)}
                      className="input-ui w-full"
                      placeholder="اكتب اسم المندوب..."
                    />
                    {showSalesRepSuggestions && salesRepSuggestions.length > 0 && (
                      <div className="absolute right-0 left-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-50 max-h-60 overflow-y-auto divide-y divide-slate-100">
                        {salesRepSuggestions.map((rep) => (
                          <button
                            key={rep.id}
                            type="button"
                            onClick={() => {
                              setSelectedSalesRepId(rep.id);
                              setSalesRepSearchTerm(rep.name);
                              setShowSalesRepSuggestions(false);
                            }}
                            className="w-full text-right px-4 py-2.5 text-sm text-slate-700 hover:bg-sky-50 hover:text-sky-700 font-medium transition-colors"
                          >
                            <span>{rep.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </Field>

                <Field label="تاريخ الفاتورة">
                  <DatePicker value={invoiceDate} onChange={setInvoiceDate} className="w-full border-slate-200 px-4 py-2" />
                </Field>

                <Field label="طريقة الدفع">
                  <select
                    value={paymentMethod}
                    onChange={(e) => {
                      const nextMethod = e.target.value as PaymentMethod;
                      setPaymentMethod(nextMethod);
                      setCashPaidManuallyEdited(false);
                      if (nextMethod === 'installment') {
                        if (!editingSaleId) setPaidAmount(0);
                      } else if (!editingSaleId) {
                        setPaidAmount(Number(total.toFixed(2)));
                      }
                    }}
                    className="input-ui"
                  >
                    <option value="cash">نقدي</option>
                    <option value="card">بطاقة</option>
                    <option value="transfer">تحويل</option>
                    <option value="installment">تقسيط</option>
                  </select>
                </Field>

                <Field label={paymentMethod === 'installment' ? 'المقدم المتفق عليه (ج.م)' : 'المبلغ المدفوع (ج.م)'}>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0"
                    value={paidAmount === 0 ? '' : paidAmount}
                    onChange={(e) => {
                      setCashPaidManuallyEdited(true);
                      setPaidAmount(Number(e.target.value) || 0);
                    }}
                    className="input-ui font-black text-slate-800"
                    onKeyDown={(e) => ['e', 'E', '+', '-'].includes(e.key) && e.preventDefault()}
                  />
                </Field>

                {paymentMethod === 'installment' && (
                  <>
                    <Field label="مدة التقسيط بالأشهر">
                      <input
                        type="number"
                        min="1"
                        value={installmentMonths === 0 ? '' : installmentMonths}
                        onChange={(e) => setInstallmentMonths(Math.max(1, Number(e.target.value) || 1))}
                        className="input-ui"
                        onKeyDown={(e) => ['e', 'E', '+', '-'].includes(e.key) && e.preventDefault()}
                      />
                    </Field>
                    <Field label="تاريخ أول قسط">
                      <div className="input-ui flex items-center">{formatDateDisplay(firstInstallmentDate)}</div>
                    </Field>
                  </>
                )}

                <div className="md:col-span-2 xl:col-span-4">
                  <Field label="ملاحظات">
                    <textarea
                      value={invoiceNotes}
                      onChange={(e) => setInvoiceNotes(e.target.value)}
                      rows={2}
                      className="input-ui resize-none"
                      placeholder="اختياري"
                    />
                  </Field>
                </div>
              </div>
            </Panel>

            <Panel title="2. إضافة الأصناف" icon={<Package size={18} className="text-sky-600" />}>
              {/* Dual Mode Switch (Warehouse vs On-Demand) */}
              <div className="flex flex-wrap items-center gap-2 p-1.5 bg-slate-100 rounded-2xl w-fit mb-5 border border-slate-200">
                <button
                  type="button"
                  onClick={() => setItemSourceMode('warehouse')}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-black transition-all ${itemSourceMode === 'warehouse'
                    ? 'bg-white text-blue-700 shadow-sm border border-slate-200'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
                    }`}
                >
                  <Package size={17} />
                  من المخزن
                </button>
                <button
                  type="button"
                  onClick={() => setItemSourceMode('on_demand')}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-black transition-all ${itemSourceMode === 'on_demand'
                    ? 'bg-white text-amber-700 shadow-sm border border-slate-200'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
                    }`}
                >
                  <ShoppingCart size={17} />
                  على حسب الطلب
                </button>
              </div>

              {/* Mode 1: Warehouse Stocked Items */}
              {itemSourceMode === 'warehouse' && (
                <div className="rounded-2xl border border-blue-100 bg-blue-50/20 p-4 space-y-4">
                  <div ref={warehouseSearchContainerRef} className="relative">
                    <Field label="البحث في بضاعة المخزن (بالاسم أو الكود)">
                      <div className="relative">
                        <input
                          type="text"
                          placeholder="اكتب اسم الصنف أو كود الباركود للبحث في بضاعة المخزن..."
                          value={warehouseSearchTerm}
                          onChange={(e) => {
                            setWarehouseSearchTerm(e.target.value);
                            setShowWarehouseSuggestions(true);
                          }}
                          onFocus={() => setShowWarehouseSuggestions(true)}
                          className="input-ui pr-10 font-bold text-slate-800"
                        />
                        <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                      </div>
                    </Field>

                    {/* Autocomplete Dropdown */}
                    {showWarehouseSuggestions && (
                      <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
                        {warehouseSuggestions.length === 0 ? (
                          <div className="px-4 py-3 text-center text-xs text-slate-500 font-medium">
                            {stockedProducts.length === 0
                              ? 'لا توجد أصناف مسجلة في المخزن حاليًا.'
                              : 'لا توجد نتائج مطابقة لبحثك في المخزن.'}
                          </div>
                        ) : (
                          warehouseSuggestions.map((prod) => (
                            <button
                              key={prod.id}
                              type="button"
                              onClick={() => handleSelectWarehouseProduct(prod)}
                              className="w-full flex items-center justify-between p-2.5 rounded-lg hover:bg-blue-50 text-right transition-colors"
                            >
                              <div>
                                <p className="font-bold text-slate-800 text-sm">{prod.name}</p>
                                <p className="text-xs text-slate-500 mt-0.5">كود: {prod.barcode || 'تلقائي'}</p>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
                                  المتوفر: {prod.quantity || 0} {prod.unit || 'قطعة'}
                                </span>
                                <span className="font-bold text-slate-700 text-xs">
                                  {formatCurrency(prod.salePrice)}
                                </span>
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>

                  {/* Selected warehouse product details and add row */}
                  {selectedWarehouseProduct ? (
                    <div className="bg-white p-4 rounded-xl border border-blue-200 shadow-2xs space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                          <span className="font-black text-slate-800 text-base">{selectedWarehouseProduct.name}</span>
                          {selectedWarehouseProduct.barcode && (
                            <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                              {selectedWarehouseProduct.barcode}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs">
                          <span className="font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                            الرصيد بالمخزن: {selectedWarehouseProduct.quantity || 0} {selectedWarehouseProduct.unit || 'قطعة'}
                          </span>
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 items-end">
                        <Field label="الكمية المطلوبة">
                          <input
                            type="number"
                            min="1"
                            value={warehouseQuantity}
                            onChange={(e) => setWarehouseQuantity(e.target.value === '' ? '' : Math.max(1, Number(e.target.value)))}
                            className="input-ui font-black text-slate-800"
                          />
                        </Field>

                        <Field label="سعر البيع الكاش">
                          <input
                            type="number"
                            min="0"
                            value={warehouseSalePrice}
                            onChange={(e) => setWarehouseSalePrice(e.target.value === '' ? '' : Number(e.target.value))}
                            className="input-ui font-bold text-emerald-700"
                          />
                        </Field>

                        <Field label="الفائدة %">
                          <input
                            type="number"
                            min="0"
                            max="100"
                            value={warehouseTax}
                            onChange={(e) => setWarehouseTax(e.target.value === '' ? '' : Number(e.target.value))}
                            className="input-ui font-semibold text-slate-700"
                          />
                        </Field>

                        <div>
                          <button
                            type="button"
                            onClick={addWarehouseItem}
                            className="w-full inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#1e40af] px-4 font-black text-white hover:bg-[#1d4ed8] transition-colors shadow-2xs"
                          >
                            <Plus size={18} />
                            إضافة للفاتورة
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-white p-3.5 text-center text-xs text-slate-500 font-semibold">
                      {stockedProducts.length === 0
                        ? 'لا توجد بضاعة مسجلة بالمخزن حالياً. يمكنك تسجيل أصناف المخزن من شاشة الأصناف والمخزون، أو التبديل إلى "على حسب الطلب".'
                        : 'اختر صنفاً من قائمة البحث أعلاه لإضافته إلى الفاتورة.'}
                    </div>
                  )}
                </div>
              )}

              {/* Mode 2: On-Demand Items */}
              {itemSourceMode === 'on_demand' && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50/20 p-4">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-12 items-end">
                    <div className="lg:col-span-2">
                      <Field label="اسم الصنف">
                        <input
                          type="text"
                          autoComplete="off"
                          placeholder="اكتب اسم الصنف..."
                          value={onDemandName}
                          onChange={(e) => setOnDemandName(e.target.value)}
                          className="input-ui font-bold text-slate-800"
                        />
                      </Field>
                    </div>

                    <div className="lg:col-span-2">
                      <Field label="سعر الشراء">
                        <input
                          type="number"
                          min="0"
                          placeholder="0"
                          value={onDemandPurchasePrice}
                          onChange={(e) => setOnDemandPurchasePrice(e.target.value === '' ? '' : Number(e.target.value))}
                          className="input-ui font-black text-slate-800"
                        />
                      </Field>
                    </div>

                    <div className="lg:col-span-2">
                      <Field label="سعر البيع الكاش">
                        <input
                          type="number"
                          min="0"
                          placeholder={onDemandPurchasePrice ? String(onDemandPurchasePrice) : '0'}
                          value={onDemandSalePrice}
                          onChange={(e) => setOnDemandSalePrice(e.target.value === '' ? '' : Number(e.target.value))}
                          className="input-ui font-black text-emerald-700"
                        />
                      </Field>
                    </div>

                    <div className="lg:col-span-2">
                      <Field label="المورد *">
                        <div className="relative w-full">
                          <input
                            type="text"
                            value={onDemandSupplierSearchTerm}
                            onChange={(e) => {
                              const val = e.target.value;
                              setOnDemandSupplierSearchTerm(val);
                              setShowOnDemandSupplierSuggestions(true);
                              if (onDemandSupplierId) {
                                setOnDemandSupplierId('');
                              }
                            }}
                            onFocus={() => setShowOnDemandSupplierSuggestions(true)}
                            onBlur={() => setTimeout(() => setShowOnDemandSupplierSuggestions(false), 200)}
                            className="input-ui w-full font-bold text-slate-800"
                            placeholder="اكتب اسم المورد..."
                          />
                          {showOnDemandSupplierSuggestions && onDemandSupplierSuggestions.length > 0 && (
                            <div className="absolute right-0 left-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-50 max-h-60 overflow-y-auto divide-y divide-slate-100">
                              {onDemandSupplierSuggestions.map((s) => (
                                <button
                                  key={s.id}
                                  type="button"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => {
                                    setOnDemandSupplierId(s.id);
                                    setOnDemandSupplierSearchTerm(s.name);
                                    setShowOnDemandSupplierSuggestions(false);
                                  }}
                                  className="w-full text-right px-4 py-2.5 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-700 font-medium transition-colors cursor-pointer"
                                >
                                  <span>{s.name}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </Field>
                    </div>

                    <div className="lg:col-span-1">
                      <Field label="الكمية">
                        <input
                          type="number"
                          min="1"
                          value={onDemandQuantity}
                          onChange={(e) => setOnDemandQuantity(e.target.value === '' ? '' : Math.max(1, Number(e.target.value)))}
                          className="input-ui font-black text-slate-800"
                        />
                      </Field>
                    </div>

                    <div className="lg:col-span-1">
                      <Field label="الفائدة %">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          placeholder="0"
                          value={onDemandTax}
                          onChange={(e) => setOnDemandTax(e.target.value === '' ? '' : Number(e.target.value))}
                          className="input-ui font-black text-slate-800"
                        />
                      </Field>
                    </div>

                    <div className="lg:col-span-2">
                      <button
                        type="button"
                        onClick={addOnDemandItem}
                        className="w-full inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 font-black text-white hover:bg-amber-700 transition-colors shadow-2xs cursor-pointer"
                      >
                        <Plus size={18} />
                        إضافة الصنف
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Draft Items Table (Desktop) & Cards (Mobile) */}
              <div className="mt-5 overflow-hidden rounded-xl border border-slate-200 shadow-xs">
                {/* Mobile Draft Item Cards (< md) */}
                <div className="md:hidden p-2.5 space-y-2.5 bg-white">
                  {draftRows.length === 0 ? (
                    <div className="px-4 py-8 text-center text-xs text-slate-500 font-bold">
                      لا توجد أصناف مضافة بعد. اختر صنفاً من المخزن أو أضف صنفاً حسب الطلب أعلاه.
                    </div>
                  ) : (
                    draftRows.map((item, index) => {
                      const isStocked = item.fulfillmentType === 'stocked';
                      return (
                        <div key={`mob-draft-${item.productId}-${index}`} className="border border-slate-200 rounded-xl p-3 space-y-2 bg-slate-50/40">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-black text-slate-900 text-sm break-words">{item.productName}</p>
                              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                {isStocked ? (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-blue-50 text-blue-800 border border-blue-200">
                                    من المخزن ({item.availableStock} متاح)
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                                    حسب الطلب {item.supplierName ? `• ${item.supplierName}` : ''}
                                  </span>
                                )}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => setDraftItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                              className="p-1.5 rounded-lg bg-rose-50 text-rose-600 shrink-0"
                              title="حذف البند"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>

                          <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-200/70 text-xs">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-500">الكمية:</span>
                              <input
                                type="number"
                                min="1"
                                value={item.quantity === 0 ? '' : item.quantity}
                                onChange={(e) => updateLine(index, { quantity: Math.max(1, Number(e.target.value) || 1) })}
                                className="w-16 rounded-lg border border-slate-300 bg-white px-2 py-1 text-center font-black text-slate-800"
                              />
                            </div>
                            <div className="text-left">
                              <span className="text-[10px] text-slate-400 block font-bold">السعر: {formatCurrency(item.unitPrice)}</span>
                              <span className="font-black text-emerald-700 text-sm">{formatCurrency(item.total)}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full min-w-[850px] bg-white">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="py-2.5 px-4 text-right text-xs font-black text-slate-700 tracking-wider">الصنف</th>
                        <th className="py-2.5 px-4 text-right text-xs font-black text-slate-700 tracking-wider">المصدر / النوع</th>
                        <th className="py-2.5 px-4 text-right text-xs font-black text-slate-700 tracking-wider">الكمية</th>
                        <th className="py-2.5 px-4 text-right text-xs font-black text-slate-700 tracking-wider">المتاح بالمخزن</th>
                        <th className="py-2.5 px-4 text-right text-xs font-black text-slate-700 tracking-wider">حالة التوريد والمديونية</th>
                        <th className="py-2.5 px-4 text-right text-xs font-black text-slate-700 tracking-wider">سعر البيع</th>
                        <th className="py-2.5 px-4 text-right text-xs font-black text-slate-700 tracking-wider">الإجمالي</th>
                        <th className="py-2.5 px-4 text-center text-xs font-black text-slate-700 tracking-wider">إجراءات</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {draftRows.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-500 font-bold">
                            لا توجد أصناف مضافة بعد. اختر صنفاً من المخزن أو أضف صنفاً حسب الطلب أعلاه.
                          </td>
                        </tr>
                      ) : (
                        draftRows.map((item, index) => {
                          const isStocked = item.fulfillmentType === 'stocked';
                          return (
                            <tr key={`${item.productId}-${index}`} className="hover:bg-slate-50/80 transition-colors">
                              <td className="px-4 py-3.5">
                                <p className="font-black text-slate-900 text-sm">{item.productName}</p>
                                <p className="mt-0.5 text-xs text-slate-500">{item.barcode ? `كود: ${item.barcode}` : 'صنف مباشر'}</p>
                              </td>
                              <td className="px-4 py-3.5">
                                {isStocked ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-black bg-blue-50 text-blue-800 border border-blue-200">
                                    من المخزن
                                  </span>
                                ) : (
                                  <div>
                                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-black bg-amber-50 text-amber-800 border border-amber-200">
                                      حسب الطلب
                                    </span>
                                    {item.supplierName && (
                                      <p className="text-[11px] font-bold text-slate-600 mt-1">
                                        المورد: {item.supplierName}
                                      </p>
                                    )}
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-3.5">
                                <input
                                  type="number"
                                  min="1"
                                  value={item.quantity === 0 ? '' : item.quantity}
                                  onChange={(e) =>
                                    updateLine(index, { quantity: Math.max(1, Number(e.target.value) || 1) })
                                  }
                                  className="w-20 rounded-xl border border-slate-300 px-3 py-1.5 text-center font-black text-slate-800"
                                />
                              </td>
                              <td className="px-4 py-3.5 text-xs font-bold text-slate-700">
                                {isStocked ? `${item.availableStock} قطعة` : 'غير مخزني'}
                              </td>
                              <td className="px-4 py-3.5">
                                {isStocked ? (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                    جاهز من المخزون
                                  </span>
                                ) : (
                                  <div className="space-y-0.5">
                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-black bg-amber-50 text-amber-800 border border-amber-200">
                                      مديونية للمورد
                                    </span>
                                    <p className="text-[11px] text-slate-600 font-semibold">
                                      {item.supplierName ? `يضاف لحساب ${item.supplierName}` : 'شراء فوري'}
                                    </p>
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-3.5 font-bold text-slate-800 text-sm">
                                {formatCurrency(item.unitPrice)}
                              </td>
                              <td className="px-4 py-3.5 font-black text-emerald-700 text-sm">
                                {formatCurrency(item.total)}
                              </td>
                              <td className="px-4 py-3.5 text-center">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDraftItems((current) => current.filter((_, itemIndex) => itemIndex !== index))
                                  }
                                  className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100 hover:text-rose-700 transition-colors"
                                  title="حذف البند"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </Panel>

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
                          const isDeferred = sch.deferred || Boolean(sch.notes?.includes('مرحّل') || sch.notes?.includes('مدمج'));

                          return (
                            <tr key={sch.id} className="hover:bg-slate-50/70">
                              <td className="py-2.5 px-3 font-bold text-slate-800">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span>{sch.label}</span>
                                  {isDeferred && (
                                    <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                                      مرحّل
                                    </span>
                                  )}
                                </div>
                                {sch.notes && (
                                  <p className="text-[10px] text-slate-500 font-normal mt-0.5">{sch.notes}</p>
                                )}
                              </td>
                              <td className="py-2.5 px-3 text-slate-600 font-medium">{formatDateDisplay(sch.dueDate)}</td>
                              <td className="py-2.5 px-3 font-bold text-slate-800">{formatCurrency(sch.amount)}</td>
                              <td className="py-2.5 px-3 font-semibold text-emerald-600">{formatCurrency(sch.paidAmount)}</td>
                              <td className="py-2.5 px-3 font-bold text-rose-600">{formatCurrency(rem)}</td>
                              <td className="py-2.5 px-3 text-center">
                                <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${sch.status === 'paid' ? 'bg-emerald-100 text-emerald-700'
                                  : sch.status === 'settled_early' ? 'bg-sky-100 text-sky-700'
                                    : sch.status === 'partial' ? 'bg-amber-100 text-amber-700'
                                      : 'bg-slate-100 text-slate-700'
                                  }`}>
                                  {sch.status === 'paid' ? 'مدفوع' : sch.status === 'settled_early' ? 'تكييش' : sch.status === 'partial' ? 'جزئي' : 'معلق'}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-center">
                                <div className="inline-flex items-center justify-center gap-1.5 flex-wrap">
                                  {canDelete && !isPaid && (
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
                                  )}
                                  {canDelete && isDeferred && isApiMode() && (
                                    <button
                                      type="button"
                                      onClick={() => handleUndoDeferInstallment(editingSale.id, sch.id)}
                                      disabled={deferLoading}
                                      className="inline-flex items-center gap-1 px-2 py-1 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-lg text-[11px] font-bold transition-all"
                                    >
                                      <RotateCcw size={12} />
                                      تراجع
                                    </button>
                                  )}
                                  {(!canDelete || (isPaid && !isDeferred)) && (
                                    <span className="text-slate-400 text-[10px]">-</span>
                                  )}
                                </div>
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

            {procurementRows.length > 0 && (
              <Panel
                title="3. مديونيات المشتريات المرتبطة بالموردين (للأصناف حسب الطلب)"
                icon={<ShoppingCart size={18} className="text-amber-600" />}
                action={
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200 select-none">
                    <input
                      type="checkbox"
                      checked={autoProcureEnabled}
                      onChange={(e) => setAutoProcureEnabled(e.target.checked)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
                    />
                    <span>تفعيل إثبات المديونية وإنشاء فواتير الشراء تلقائيًا</span>
                  </label>
                }
              >
                {autoProcureEnabled ? (
                  <div className="space-y-4">
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 leading-relaxed font-semibold">
                      إثبات مديونيات الموردين: عند حفظ الفاتورة، سيقوم النظام تلقائياً بإنشاء فواتير شراء للأصناف حسب الطلب وإضافة قيمتها كمديونية مستحقة للمورد المحدد.
                    </div>

                    <div className="overflow-hidden rounded-xl border border-slate-200 shadow-2xs">
                      {/* Mobile Procurement Cards (< md) */}
                      <div className="md:hidden p-2.5 space-y-2 bg-white">
                        {procurementRows.map((item, idx) => {
                          const unitCost = item.product?.purchasePrice || item.unitPrice || 0;
                          return (
                            <div key={`mob-proc-${item.productId}-${idx}`} className="border border-slate-200 rounded-xl p-3 space-y-1.5 text-xs">
                              <div className="flex items-start justify-between gap-2">
                                <p className="font-black text-slate-800 break-words">{item.productName}</p>
                                <span className="font-black text-amber-700 shrink-0">{formatCurrency(item.shortageQuantity * unitCost)}</span>
                              </div>
                              <p className="text-slate-600 font-bold">المورد: {item.supplierName || 'المورد الافتراضي'}</p>
                              <div className="flex items-center justify-between text-slate-500 pt-1 border-t border-slate-100">
                                <span>الكمية: <strong className="text-slate-800">{item.shortageQuantity}</strong></span>
                                <span>التكلفة: <strong className="text-slate-800">{formatCurrency(unitCost)}</strong></span>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div className="hidden md:block overflow-x-auto">
                        <table className="w-full min-w-[620px] bg-white">
                          <thead className="bg-slate-50 text-slate-700 border-b border-slate-200 text-xs">
                            <tr>
                              <th className="px-4 py-2.5 text-right font-black">الصنف</th>
                              <th className="px-4 py-2.5 text-right font-black">المورد المستحق له المديونية</th>
                              <th className="px-4 py-2.5 text-right font-black">الكمية</th>
                              <th className="px-4 py-2.5 text-right font-black">تكلفة الشراء</th>
                              <th className="px-4 py-2.5 text-right font-black">إجمالي مديونية المورد</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 text-xs">
                            {procurementRows.map((item, idx) => {
                              const unitCost = item.product?.purchasePrice || item.cost || item.unitPrice || 0;
                              return (
                                <tr key={`procurement-${item.productId}-${idx}`} className="hover:bg-slate-50">
                                  <td className="px-4 py-3 font-black text-slate-800">{item.productName}</td>
                                  <td className="px-4 py-3 font-bold text-slate-700">
                                    {item.supplierName || 'المورد الافتراضي'}
                                  </td>
                                  <td className="px-4 py-3 font-bold text-slate-800">{item.shortageQuantity}</td>
                                  <td className="px-4 py-3 font-bold text-slate-700">
                                    {formatCurrency(unitCost)}
                                  </td>
                                  <td className="px-4 py-3 font-black text-amber-700">
                                    {formatCurrency(item.shortageQuantity * unitCost)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-600 leading-relaxed font-medium">
                    تم إلغاء الشراء التلقائي. لن يتم قيد مديونيات على حساب الموردين عند حفظ هذه الفاتورة.
                  </div>
                )}
              </Panel>
            )}
          </div>

          <div className="space-y-6">
            <Panel title="ملخص الحركة" icon={<Save size={18} className="text-emerald-600" />}>
              <div className="space-y-3">
                <SummaryRow label="العميل" value={selectedCustomer?.name || 'غير محدد'} />
                <SummaryRow label="إجمالي الأصناف" value={formatCurrency(subtotal)} />
                <SummaryRow label="المقدم / المدفوع" value={formatCurrency(paid)} />
                <SummaryRow
                  label="المبلغ المموَّل (أصل التمويل)"
                  value={formatCurrency(Math.max(preTaxTotal - upfrontAgainstItems, 0))}
                  tone="blue"
                  strong
                />
                <SummaryRow label="إجمالي الفائدة" value={formatCurrency(taxAmount)} />
                <SummaryRow label="صافي الفاتورة" value={formatCurrency(total)} tone="green" strong />
                <SummaryRow label="المتبقي" value={formatCurrency(remaining)} tone="amber" strong />
                <SummaryRow label="شراء مطلوب" value={formatCurrency(procurementSubtotal)} tone="slate" />
              </div>

              <div className="mt-5 grid gap-3">
                {!canWriteSale ? (
                  <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl text-xs font-bold text-center">
                    حساب عرض فقط (ليس لديك صلاحية إصدار أو تعديل الفواتير)
                  </div>
                ) : (
                  <button
                    onClick={saveInvoice}
                    className={`inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 font-bold text-white transition-all cursor-pointer ${editingSaleId ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-600 hover:bg-emerald-700'
                      }`}
                  >
                    <Save size={18} />
                    {editingSaleId ? 'تعديل وحفظ التغييرات' : 'حفظ الفاتورة'}
                  </button>
                )}
                {editingSaleId ? (
                  <button
                    type="button"
                    onClick={resetForm}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-rose-50 hover:bg-rose-100 px-4 py-3 font-bold text-rose-700 border border-rose-200 transition-all"
                  >
                    إلغاء التعديل والعودة للإنشاء
                  </button>
                ) : (
                  <button
                    onClick={resetForm}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-100 px-4 py-3 font-bold text-slate-700 hover:bg-slate-200"
                  >
                    <CalendarDays size={18} />
                    فاتورة جديدة
                  </button>
                )}
              </div>
            </Panel>

            {/* Installment Plan Preview (Displayed only when creating a new contract, to avoid duplicating the active management table in edit mode) */}
            {paymentMethod === 'installment' && !editingSale && (
              <Panel title="خطة الأقساط" icon={<CalendarDays size={18} className="text-violet-600" />}>
                <div className="space-y-3">
                  {installmentPreview.map((entry) => {
                    const correspondingSchedule = editingSale?.financing?.schedules?.find(
                      (s, idx) => s.id === `inst-${entry.monthIndex}` || s.monthIndex === entry.monthIndex || idx === entry.monthIndex - 1
                    );
                    const scheduleId = correspondingSchedule?.id || `inst-${entry.monthIndex}`;
                    const isPaid = correspondingSchedule?.status === 'paid' || correspondingSchedule?.status === 'settled_early';
                    const displayDate = correspondingSchedule?.dueDate || entry.dueDate;
                    const displayAmount = correspondingSchedule ? correspondingSchedule.amount : entry.amount;
                    const isDeferred = correspondingSchedule?.deferred || Boolean(correspondingSchedule?.notes?.includes('مرحّل') || correspondingSchedule?.notes?.includes('مدمج'));

                    return (
                      <div
                        key={entry.monthIndex}
                        className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                      >
                        <div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="font-semibold text-slate-800">القسط {entry.monthIndex}</p>
                            {isDeferred && (
                              <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                                مرحّل
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500">{formatDateDisplay(displayDate)}</p>
                          {correspondingSchedule?.notes && (
                            <p className="text-[10px] text-amber-700 font-medium mt-0.5">{correspondingSchedule.notes}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-bold text-violet-700">{formatCurrency(displayAmount)}</span>
                          {Boolean(editingSale) && (!correspondingSchedule || !isPaid) && (
                            <button
                              type="button"
                              onClick={() => {
                                if (editingSale) {
                                  setDeferModalSale(editingSale);
                                  setDeferInstallmentId(scheduleId);
                                  setDeferNewDueDate(addMonths(displayDate, 1));
                                  setDeferPenaltyFee(0);
                                  setDeferStrategy('shift_subsequent');
                                  setDeferPenaltyPaymentType('add_to_debt');
                                  setDeferMessage(null);
                                }
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-violet-700 hover:text-white bg-violet-50 hover:bg-violet-600 border border-violet-200 hover:border-violet-600 rounded-xl transition-all shadow-xs cursor-pointer"
                              title="ترحيل القسط وتعديل تاريخ الاستحقاق"
                            >
                              <CalendarCheck size={13} />
                              ترحيل
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Panel>
            )}

            <Panel title="ماذا سيحدث عند الحفظ؟" icon={<Info size={18} className="text-blue-600" />}>
              <div className="space-y-3 text-sm leading-6 text-slate-600">
                <p>1. يتم حفظ الفاتورة للعميل مباشرة.</p>
                <p>2. إذا كان هناك صنف غير متوفر، يتم إنشاء شراء تلقائي من نفس الشاشة.</p>
                <p>3. إذا كان هناك مبلغ مقدم، يتم تسجيل دفعة تلقائيًا على الفاتورة.</p>
                <p>4. في حالة التقسيط، يتم إنشاء خطة الأقساط الشهرية تلقائيًا.</p>
              </div>
            </Panel>
          </div>
        </div>
      </div>

      {/* High-Performance Contracts Search Modal */}
      {showSearchModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
          onClick={() => setShowSearchModal(false)}
        >
          <div
            className="w-full max-w-4xl h-[85vh] max-h-[680px] rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="bg-gradient-to-l from-slate-900 via-[#1e40af] to-[#1d4ed8] px-5 py-3.5 text-white flex items-center justify-between shrink-0 border-b border-slate-800/70">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center text-sky-300 shrink-0 shadow-xs">
                  <Search size={17} />
                </div>
                <div>
                  <h3 className="text-base font-black text-white text-right">
                    البحث في سجل التعاقدات
                  </h3>
                  <p className="text-[11px] text-slate-300 mt-0.5 text-right font-medium">
                    اكتب اسم العميل أو رقم العقد للبحث الفوري، ثم اختر الإجراء المطلوب.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowSearchModal(false)}
                className="text-slate-300 hover:text-white hover:bg-white/10 rounded-lg text-2xl font-light w-8 h-8 flex items-center justify-center leading-none transition-colors outline-none cursor-pointer"
                title="إغلاق النافذة"
              >
                &times;
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-4 overflow-y-auto flex-1 min-h-0 flex flex-col bg-slate-50/60">
              {/* Big Search Input */}
              <div className="relative mb-3 shrink-0">
                <Search className="absolute right-3.5 top-1/2 -translate-y-1/2 text-blue-500 pointer-events-none" size={18} />
                <input
                  type="text"
                  autoFocus
                  value={modalSearchQuery}
                  onChange={(e) => {
                    setModalSearchQuery(e.target.value);
                    setModalPage(1);
                  }}
                  placeholder="اكتب اسم العميل المشتري أو رقم العقد للبحث الفوري..."
                  className="w-full rounded-xl border border-blue-200 focus:border-blue-600 bg-white py-2.5 pr-10 pl-10 text-sm font-semibold outline-none transition-colors shadow-xs focus:ring-2 focus:ring-blue-500/20"
                />
                {modalSearchLoading && (
                  <Loader2 size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-blue-600 animate-spin pointer-events-none" />
                )}
              </div>

              {/* List of Results */}
              <div className={`space-y-2.5 flex-1 min-h-0 overflow-y-auto pr-0.5 transition-opacity duration-150 ${modalSearchLoading && modalContracts.length > 0 ? 'opacity-70' : 'opacity-100'}`}>
                {modalSearchLoading && modalContracts.length === 0 ? (
                  <LoadingState size="sm" minHeight="140px" />
                ) : modalContracts.length === 0 ? (
                  <div className="py-16 text-center text-slate-400 font-bold text-xs">
                    لا توجد تعاقدات سابقة مسجلة أو مطابقة لبحثك الحالي.
                  </div>
                ) : (
                  modalContracts.map((sale) => {
                    const hasPayments = Number(sale.paid || 0) > 0;
                    const isLocked = Boolean(sale.locked || hasPayments);
                    const hasRemainingInstallments =
                      sale.financing?.paymentMethod === 'installment' &&
                      (sale.financing?.schedules?.length ?? 0) > 0 &&
                      Number(sale.remaining || 0) > 0;

                    return (
                      <div
                        key={sale.id}
                        className="p-4 rounded-2xl border border-slate-200/90 hover:border-blue-400 hover:shadow-md transition-all bg-white"
                      >
                        {/* Top Info Row */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-right">
                          <div className="space-y-1.5 min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono font-black text-blue-700 bg-blue-50 border border-blue-200/80 px-2.5 py-0.5 rounded-lg text-xs sm:text-sm">
                                {sale.invoiceNumber}
                              </span>
                              <span className="text-[11px] px-2.5 py-0.5 rounded-lg bg-slate-100 text-slate-700 font-bold whitespace-nowrap">
                                {formatDateDisplay(sale.date)}
                              </span>
                              <span
                                className={`text-[11px] px-2.5 py-0.5 rounded-lg font-bold whitespace-nowrap ${sale.financing?.paymentMethod === 'installment'
                                  ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                                  : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                  }`}
                              >
                                {sale.financing?.paymentMethod === 'installment' ? 'تقسيط' : 'نقدي'}
                              </span>
                              {sale.status === 'cancelled' && (
                                <span className="text-[11px] px-2.5 py-0.5 rounded-lg font-bold bg-rose-50 text-rose-700 border border-rose-200 whitespace-nowrap">
                                  ملغى / مرتجع
                                </span>
                              )}
                            </div>
                            <p className="font-extrabold text-slate-900 text-sm sm:text-base truncate">
                              {sale.customerName}
                            </p>
                          </div>

                          <div className="flex items-center gap-2 shrink-0 flex-wrap">
                            <div className="px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200/80 text-xs whitespace-nowrap">
                              <span className="text-slate-500">الإجمالي: </span>
                              <b className="text-slate-900 font-black">{formatCurrency(sale.total)}</b>
                            </div>
                            {Number(sale.subtotal || 0) > 0 && (
                              <div className="px-3 py-1.5 rounded-xl bg-indigo-50/70 border border-indigo-200/80 text-xs whitespace-nowrap">
                                <span className="text-indigo-700">المموَّل: </span>
                                <b className="text-indigo-900 font-black">
                                  {formatCurrency(
                                    Math.max(
                                      Number(sale.subtotal || 0) - Number(sale.financing?.upfrontAmount || 0),
                                      0,
                                    ),
                                  )}
                                </b>
                              </div>
                            )}
                            <div
                              className={`px-3 py-1.5 rounded-xl border text-xs whitespace-nowrap ${sale.remaining > 0
                                ? 'bg-rose-50/70 border-rose-200/80'
                                : 'bg-emerald-50/70 border-emerald-200/80'
                                }`}
                            >
                              <span className="text-slate-600">المتبقي: </span>
                              <b className={`font-black ${sale.remaining > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                                {formatCurrency(sale.remaining)}
                              </b>
                            </div>
                          </div>
                        </div>

                        {/* Clean Actions Row */}
                        <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2 flex-wrap">
                            <button
                              type="button"
                              onClick={() => void openDetailsModal(sale)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 rounded-xl text-xs font-bold transition-all active:scale-95 cursor-pointer whitespace-nowrap"
                              title="عرض كافة تفاصيل العقد والأصناف والأقساط (للقراءة فقط)"
                            >
                              <Eye size={13} />
                              <span>عرض التفاصيل</span>
                            </button>
                            {sale.status !== 'cancelled' && (
                              <>
                                {canWriteSale && !isLocked && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      handleLoadForEdit(sale);
                                      setShowSearchModal(false);
                                    }}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200 rounded-xl text-xs font-bold transition-all active:scale-95 cursor-pointer whitespace-nowrap"
                                  >
                                    <Edit3 size={13} />
                                    <span>تعديل البيانات</span>
                                  </button>
                                )}

                                {canDelete && hasPayments && (
                                  <button
                                    type="button"
                                    onClick={() => handleReturnContract(sale)}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-orange-50 hover:bg-orange-100 text-orange-700 border border-orange-200 rounded-xl text-xs font-bold transition-all active:scale-95 cursor-pointer whitespace-nowrap"
                                    title="تسجيل مرتجع وإلغاء التعاقد مع استرداد المدفوع وإرجاع المخزون"
                                  >
                                    <RotateCcw size={13} />
                                    <span>مرتجع / إلغاء</span>
                                  </button>
                                )}

                                {canDelete && !hasPayments && (
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteContract(sale)}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-bold transition-all active:scale-95 cursor-pointer whitespace-nowrap"
                                    title="حذف الفاتورة نهائياً لعدم وجود أي مدفوعات مسجلة عليها"
                                  >
                                    <Trash2 size={13} />
                                    <span>حذف التعاقد</span>
                                  </button>
                                )}

                                {canDelete && hasRemainingInstallments && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setDeferModalSale(sale);
                                        setDeferInstallmentId('');
                                        setDeferNewDueDate('');
                                        setDeferPenaltyFee(0);
                                        setDeferStrategy('shift_subsequent');
                                        setDeferPenaltyPaymentType('add_to_debt');
                                        setDeferMessage(null);
                                        setShowSearchModal(false);
                                      }}
                                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-xl text-xs font-bold transition-all active:scale-95 cursor-pointer whitespace-nowrap"
                                    >
                                      <CalendarCheck size={13} />
                                      <span>ترحيل قسط</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => openRescheduleModal(sale)}
                                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 rounded-xl text-xs font-bold transition-all active:scale-95 cursor-pointer whitespace-nowrap"
                                      title="تمديد أو تعديل عدد الأقساط المتبقية بدون المساس بالأقساط المدفوعة أو الخزينة"
                                    >
                                      <CalendarDays size={13} />
                                      <span>إعادة جدولة المتبقي</span>
                                    </button>
                                  </>
                                )}
                              </>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              setSavedSaleForPrinting(sale);
                              setShowSearchModal(false);
                            }}
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-gradient-to-r from-blue-600 to-indigo-700 hover:from-blue-700 hover:to-indigo-800 text-white rounded-xl text-xs font-bold transition-all shadow-xs active:scale-95 cursor-pointer whitespace-nowrap mr-auto"
                          >
                            <Printer size={13} />
                            <span>طباعة المستندات</span>
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="bg-slate-50 px-4 py-2.5 border-t border-slate-200 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2">
                {modalTotalCount > 0 && (
                  <span className="text-xs font-bold text-slate-600">
                    الإجمالي: {modalTotalCount}
                  </span>
                )}
                {modalTotalPages > 1 && (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={modalPage <= 1}
                      onClick={() => setModalPage((p) => Math.max(1, p - 1))}
                      className="px-2 py-1 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 font-bold rounded text-xs disabled:opacity-40 cursor-pointer"
                    >
                      السابق
                    </button>
                    <span className="text-xs font-bold text-slate-600 tabular-nums">
                      صفحة {modalPage} من {modalTotalPages}
                    </span>
                    <button
                      type="button"
                      disabled={modalPage >= modalTotalPages}
                      onClick={() => setModalPage((p) => Math.min(modalTotalPages, p + 1))}
                      className="px-2 py-1 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 font-bold rounded text-xs disabled:opacity-40 cursor-pointer"
                    >
                      التالي
                    </button>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowSearchModal(false)}
                className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-lg text-xs transition-colors cursor-pointer"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {savedSaleForPrinting && (
        <LegalDocumentsPrintModal
          isOpen={!!savedSaleForPrinting}
          onClose={() => {
            setSavedSaleForPrinting(null);
          }}
          sale={savedSaleForPrinting}
        />
      )}

      {/* ─── Defer Installment Modal (Admin Only) ────────────────── */}
      {deferModalSale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-3xl rounded-[28px] bg-white shadow-2xl border border-slate-100 overflow-hidden flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="bg-gradient-to-r from-violet-600 to-violet-700 p-6 text-white flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-xl font-bold flex items-center gap-2">
                  <CalendarCheck size={22} />
                  ترحيل قسط تعاقد - {deferModalSale.invoiceNumber}
                </h3>
                <p className="text-xs text-violet-100 mt-1">اختر القسط المراد ترحيله وحدد التاريخ الجديد واستراتيجية الترحيل.</p>
              </div>
              <button
                type="button"
                onClick={() => { setDeferModalSale(null); setDeferMessage(null); }}
                className="text-white/80 hover:text-white text-3xl font-light p-1 leading-none"
              >&times;</button>
            </div>

            {/* Content */}
            <div className="p-6 overflow-y-auto flex-1 space-y-5">
              {/* Contract Summary */}
              <div className="flex items-center gap-4 flex-wrap text-sm">
                <span className="font-bold text-slate-700">عميل: <span className="text-sky-700">{deferModalSale.customerName}</span></span>
                <span className="font-bold text-slate-700">إجمالي: <span className="text-emerald-700">{formatCurrency(deferModalSale.total)}</span></span>
                <span className="font-bold text-slate-700">المتبقي: <span className="text-rose-700">{formatCurrency(deferModalSale.remaining)}</span></span>
              </div>

              {/* Schedule Table */}
              <div className="overflow-hidden rounded-2xl border border-slate-200">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-4 py-3 text-right font-bold">القسط</th>
                        <th className="px-4 py-3 text-right font-bold">تاريخ الاستحقاق</th>
                        <th className="px-4 py-3 text-right font-bold">المبلغ</th>
                        <th className="px-4 py-3 text-right font-bold">مدفوع</th>
                        <th className="px-4 py-3 text-right font-bold">المتبقي</th>
                        <th className="px-4 py-3 text-right font-bold">الحالة</th>
                        <th className="px-4 py-3 text-center font-bold">إجراء</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(deferModalSale.financing?.schedules ?? []).map((sch) => {
                        const isPaid = sch.status === 'paid' || sch.status === 'settled_early';
                        const remaining = Math.max(sch.amount - sch.paidAmount, 0);
                        const isDeferred = sch.deferred || Boolean(sch.notes?.includes('مرحّل') || sch.notes?.includes('مدمج'));
                        return (
                          <tr
                            key={sch.id}
                            className={`transition-colors ${deferInstallmentId === sch.id ? 'bg-violet-50' : 'bg-white hover:bg-slate-50'
                              } ${isPaid ? 'opacity-50' : ''}`}
                          >
                            <td className="px-4 py-3 font-semibold text-slate-800">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span>{sch.label}</span>
                                {isDeferred && (
                                  <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                                    مرحّل
                                  </span>
                                )}
                              </div>
                              {sch.notes && (
                                <p className="text-[10px] text-slate-500 font-normal mt-0.5">{sch.notes}</p>
                              )}
                            </td>
                            <td className="px-4 py-3 text-slate-600">{formatDateDisplay(sch.dueDate)}</td>
                            <td className="px-4 py-3 text-slate-700">{formatCurrency(sch.amount)}</td>
                            <td className="px-4 py-3 text-emerald-700">{formatCurrency(sch.paidAmount)}</td>
                            <td className="px-4 py-3 text-rose-600 font-bold">{formatCurrency(remaining)}</td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${sch.status === 'paid' ? 'bg-emerald-100 text-emerald-700'
                                : sch.status === 'settled_early' ? 'bg-sky-100 text-sky-700'
                                  : sch.status === 'partial' ? 'bg-amber-100 text-amber-700'
                                    : 'bg-slate-100 text-slate-700'
                                }`}>
                                {sch.status === 'paid' ? 'مدفوع' : sch.status === 'settled_early' ? 'تكييش' : sch.status === 'partial' ? 'جزئي' : 'معلق'}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <div className="inline-flex items-center justify-center gap-1.5 flex-wrap">
                                {!isPaid && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setDeferInstallmentId(sch.id);
                                      const suggestedDate = addMonths(sch.dueDate, 1);
                                      setDeferNewDueDate(suggestedDate);
                                      setDeferMessage(null);
                                    }}
                                    className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all ${deferInstallmentId === sch.id
                                      ? 'bg-violet-600 text-white'
                                      : 'bg-violet-50 text-violet-700 hover:bg-violet-100'
                                      }`}
                                  >
                                    <ArrowRight size={12} />
                                    ترحيل
                                  </button>
                                )}
                                {isDeferred && canDelete && deferModalSale?.id !== 'draft-new-contract' && isApiMode() && (
                                  <button
                                    type="button"
                                    onClick={() => handleUndoDeferInstallment(deferModalSale.id, sch.id)}
                                    disabled={deferLoading}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-amber-100 text-amber-800 hover:bg-amber-200 transition-all"
                                  >
                                    <RotateCcw size={12} />
                                    تراجع
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Defer Settings - shown when installment is selected */}
              {deferInstallmentId && (
                <>
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <h4 className="font-bold text-violet-800 text-sm">إعدادات الترحيل</h4>
                    {(() => {
                      const selSch = deferModalSale?.financing?.schedules?.find((s) => s.id === deferInstallmentId);
                      return selSch ? (
                        <span className="text-xs font-bold text-violet-800 bg-violet-100 border border-violet-200 px-3 py-1 rounded-xl">
                          {selSch.label} | {formatCurrency(selSch.amount)} (الاستحقاق: {formatDateDisplay(selSch.dueDate)})
                        </span>
                      ) : null;
                    })()}
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">تاريخ الاستحقاق الجديد</label>
                      <DatePicker
                        value={deferNewDueDate}
                        onChange={setDeferNewDueDate}
                        className="w-full border-slate-200 px-4 py-2"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">استراتيجية الترحيل</label>
                      <select
                        value={deferStrategy}
                        onChange={(e) => setDeferStrategy(e.target.value as 'shift_subsequent' | 'merge_next')}
                        className="input-ui"
                      >
                        <option value="shift_subsequent">إزاحة الأقساط التالية شهرًا للأمام</option>
                        <option value="merge_next">دمج مع القسط التالي</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">غرامة الترحيل (اختياري)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={deferPenaltyFee === 0 ? '' : deferPenaltyFee}
                        onChange={(e) => setDeferPenaltyFee(Number(e.target.value) || 0)}
                        className="input-ui"
                        placeholder="0"
                        onKeyDown={(e) => ['e', 'E', '+', '-'].includes(e.key) && e.preventDefault()}
                      />
                    </div>

                    {deferPenaltyFee > 0 && (
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">طريقة تحصيل الغرامة</label>
                        <select
                          value={deferPenaltyPaymentType}
                          onChange={(e) => setDeferPenaltyPaymentType(e.target.value as 'add_to_debt' | 'collect_cash')}
                          className="input-ui"
                        >
                          <option value="add_to_debt">إضافة للرصيد المستحق</option>
                          <option value="collect_cash">تحصيل نقدًا الآن</option>
                        </select>
                      </div>
                    )}
                  </div>

                  {deferMessage && (
                    <div className={`rounded-xl px-4 py-2.5 text-xs font-bold ${deferMessage.type === 'success'
                      ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                      : 'bg-rose-50 border border-rose-200 text-rose-700'
                      }`}>
                      {deferMessage.text}
                    </div>
                  )}

                  <div className="flex justify-end gap-3 pt-1">
                    <button
                      type="button"
                      onClick={() => { setDeferInstallmentId(''); setDeferNewDueDate(''); setDeferPenaltyFee(0); setDeferMessage(null); }}
                      className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 font-bold text-sm hover:bg-slate-50"
                    >
                      إلغاء
                    </button>
                    <button
                      type="button"
                      disabled={deferLoading || !deferNewDueDate}
                      onClick={handleDeferInstallment}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white font-bold text-sm transition-all"
                    >
                      {deferLoading ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <CalendarCheck size={16} />
                      )}
                      تأكيد ترحيل القسط
                    </button>
                  </div>
                </>
              )}

              {!deferInstallmentId && deferMessage && (
                <div className={`rounded-xl px-4 py-2.5 text-xs font-bold ${deferMessage.type === 'success'
                  ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                  : 'bg-rose-50 border border-rose-200 text-rose-700'
                  }`}>
                  {deferMessage.text}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="bg-slate-50 p-4 border-t border-slate-100 flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => { setDeferModalSale(null); setDeferMessage(null); }}
                className="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-xl text-sm transition-colors"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Reschedule Remaining Installments Modal (Admin Only) ────────── */}
      {rescheduleModalSale && (() => {
        const currentRemaining = Number(rescheduleModalSale.remaining || 0);
        const safeExtraPct = Math.max(0, Number(rescheduleExtraInterest || 0));
        const extraAmount = Math.round(((currentRemaining * safeExtraPct) / 100) * 100) / 100;
        const newRemainingPreview = Math.round((currentRemaining + extraAmount) * 100) / 100;
        const safeCount = Math.max(1, Math.round(Number(rescheduleMonths || 1)));
        const monthlyPreview = Math.round(newRemainingPreview / safeCount);
        const paidCount = (rescheduleModalSale.financing?.schedules ?? []).filter(
          (s) => s.status === 'paid' || s.status === 'settled_early' || Number(s.paidAmount || 0) > 0,
        ).length;

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="w-full max-w-2xl rounded-[28px] bg-white shadow-2xl border border-slate-100 overflow-hidden flex flex-col max-h-[90vh]">
              {/* Header */}
              <div className="bg-gradient-to-r from-indigo-600 to-blue-700 p-6 text-white flex items-center justify-between shrink-0">
                <div>
                  <h3 className="text-xl font-bold flex items-center gap-2">
                    <CalendarDays size={22} />
                    إعادة جدولة المتبقي - {rescheduleModalSale.invoiceNumber}
                  </h3>
                  <p className="text-xs text-indigo-100 mt-1">
                    تُحفظ الأقساط المدفوعة وإيصالات الخزينة كما هي تماماً، ويُعاد توزيع المبلغ المتبقي فقط على عدد الأشهر الجديد.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => { setRescheduleModalSale(null); setRescheduleMessage(null); }}
                  className="text-white/80 hover:text-white text-3xl font-light p-1 leading-none cursor-pointer"
                >&times;</button>
              </div>

              {/* Body */}
              <div className="p-6 overflow-y-auto flex-1 space-y-5">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <p className="text-slate-500 mb-0.5">العميل</p>
                    <p className="font-bold text-slate-900 truncate">{rescheduleModalSale.customerName}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <p className="text-slate-500 mb-0.5">المسدد (محمي)</p>
                    <p className="font-black text-emerald-700">{formatCurrency(rescheduleModalSale.paid)}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-rose-50/70 border border-rose-200">
                    <p className="text-rose-700 mb-0.5">المتبقي الحالي</p>
                    <p className="font-black text-rose-700">{formatCurrency(currentRemaining)}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200">
                    <p className="text-emerald-700 mb-0.5">أقساط محمية</p>
                    <p className="font-black text-emerald-800">{paidCount} قسط</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1.5">عدد الأقساط الجديدة للمتبقي *</label>
                    <input
                      type="number"
                      min={1}
                      max={120}
                      value={rescheduleMonths}
                      onChange={(e) => setRescheduleMonths(Math.max(1, Number(e.target.value) || 1))}
                      className="input-ui font-black text-indigo-700"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1.5">فائدة تمديد إضافية % (اختياري)</label>
                    <input
                      type="number"
                      min={0}
                      max={200}
                      step="0.5"
                      value={rescheduleExtraInterest}
                      onChange={(e) => setRescheduleExtraInterest(Math.max(0, Number(e.target.value) || 0))}
                      className="input-ui font-bold text-slate-800"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1.5">تاريخ بداية أول قسط جديد *</label>
                    <DatePicker
                      value={rescheduleStartDate}
                      onChange={setRescheduleStartDate}
                      className="w-full border-slate-200 px-3 py-2"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">ملاحظة / سبب إعادة الجدولة (اختياري)</label>
                  <input
                    type="text"
                    value={rescheduleReason}
                    onChange={(e) => setRescheduleReason(e.target.value)}
                    placeholder="مثال: طلب العميل تمديد المدة لتخفيف قيمة القسط الشهري"
                    className="input-ui text-xs"
                  />
                </div>

                {/* Live Preview Box */}
                <div className="p-4 rounded-2xl bg-indigo-50/70 border border-indigo-200 grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
                  <div>
                    <p className="text-[11px] text-indigo-700 font-semibold">المتبقي الجديد</p>
                    <p className="text-base font-black text-indigo-950">{formatCurrency(newRemainingPreview)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-indigo-700 font-semibold">قيمة القسط الشهري الجديد</p>
                    <p className="text-base font-black text-emerald-700">{formatCurrency(monthlyPreview)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-indigo-700 font-semibold">ينتهي السداد في</p>
                    <p className="text-sm font-black text-slate-800">
                      {rescheduleStartDate ? formatDateDisplay(addMonths(rescheduleStartDate, safeCount - 1)) : '-'}
                    </p>
                  </div>
                </div>

                {rescheduleMessage && (
                  <div className={`rounded-xl px-4 py-2.5 text-xs font-bold ${rescheduleMessage.type === 'success'
                    ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                    : 'bg-rose-50 border border-rose-200 text-rose-700'
                    }`}>
                    {rescheduleMessage.text}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="bg-slate-50 p-4 border-t border-slate-100 flex items-center justify-end gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => { setRescheduleModalSale(null); setRescheduleMessage(null); }}
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-xl text-xs transition-colors cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  onClick={handleRescheduleSubmit}
                  disabled={rescheduleLoading}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-xs transition-all cursor-pointer"
                >
                  {rescheduleLoading ? <Loader2 size={14} className="animate-spin" /> : <CalendarDays size={14} />}
                  <span>تأكيد إعادة الجدولة</span>
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ─── Read-Only Contract Details Modal ──────────────────────── */}
      {detailsModalSale && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setDetailsModalSale(null)}
        >
          <div
            className="w-full max-w-5xl max-h-[90vh] rounded-[24px] bg-white shadow-2xl border border-slate-200 overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="bg-gradient-to-l from-slate-900 via-[#1e40af] to-[#1d4ed8] px-6 py-4 text-white flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-xl font-black flex items-center gap-2.5">
                  <Eye size={22} />
                  <span>تفاصيل التعاقد — {detailsModalSale.invoiceNumber}</span>
                  {detailsModalSale.status === 'cancelled' && (
                    <span className="text-xs px-3 py-0.5 rounded-full bg-rose-500/90 text-white font-bold">
                      ملغى / مرتجع
                    </span>
                  )}
                </h3>
                <p className="text-xs sm:text-sm text-blue-100 mt-1">
                  عرض شامل لبيانات العقد والأصناف وجدول الأقساط (وضع القراءة فقط لحماية الحسابات)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailsModalSale(null)}
                className="text-white/80 hover:text-white text-3xl font-light p-1 leading-none cursor-pointer"
              >
                &times;
              </button>
            </div>

            {/* Body */}
            <div className="p-6 overflow-y-auto flex-1 space-y-5 bg-slate-50/60 custom-scrollbar">
              {/* Top Info Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                <div className="p-3.5 rounded-2xl bg-white border border-slate-200/90 shadow-2xs">
                  <p className="text-xs font-semibold text-slate-500 mb-1">العميل</p>
                  <p className="text-sm sm:text-[15px] font-black text-slate-900 leading-snug">{detailsModalSale.customerName}</p>
                </div>
                <div className="p-3.5 rounded-2xl bg-white border border-slate-200/90 shadow-2xs">
                  <p className="text-xs font-semibold text-slate-500 mb-1">تاريخ التعاقد</p>
                  <p className="text-sm sm:text-[15px] font-bold text-slate-900">{formatDateDisplay(detailsModalSale.date)}</p>
                </div>
                <div className="p-3.5 rounded-2xl bg-white border border-slate-200/90 shadow-2xs">
                  <p className="text-xs font-semibold text-slate-500 mb-1">طريقة السداد</p>
                  <p className="text-sm sm:text-[15px] font-bold text-indigo-700">
                    {detailsModalSale.financing?.paymentMethod === 'installment'
                      ? `تقسيط (${detailsModalSale.financing?.installmentMonths || detailsModalSale.financing?.schedules?.length || 0} شهر)`
                      : detailsModalSale.financing?.paymentMethod === 'card'
                        ? 'بطاقة'
                        : detailsModalSale.financing?.paymentMethod === 'transfer'
                          ? 'تحويل'
                          : 'نقدي'}
                  </p>
                </div>
                <div className="p-3.5 rounded-2xl bg-white border border-slate-200/90 shadow-2xs">
                  <p className="text-xs font-semibold text-slate-500 mb-1">مندوب المبيعات</p>
                  <p className="text-sm sm:text-[15px] font-bold text-slate-900">
                    {detailsModalSale.financing?.salesRepName || 'غير محدد'}
                  </p>
                </div>
              </div>

              {/* Financial Summary */}
              {(() => {
                const upfront = Math.max(Number(detailsModalSale.financing?.upfrontAmount || 0), 0);
                const financedPrincipal = Math.max(
                  Number(detailsModalSale.subtotal || 0) - upfront,
                  0,
                );
                const effectiveInterest =
                  Number(detailsModalSale.tax || 0) > 0
                    ? Number(detailsModalSale.tax)
                    : Math.max(
                      0,
                      Number(detailsModalSale.total || 0) -
                      Number(detailsModalSale.subtotal || 0) +
                      Number(detailsModalSale.discount || 0),
                    );
                return (
                  <div className="space-y-2.5">
                    {/* Row 1: Contract Breakdown */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      <div className="p-3.5 rounded-2xl bg-white border border-slate-200/90 shadow-2xs text-center">
                        <p className="text-xs font-bold text-slate-500 mb-1">قيمة الأصناف</p>
                        <p className="text-base sm:text-lg font-black text-slate-800 whitespace-nowrap">{formatCurrency(detailsModalSale.subtotal)}</p>
                      </div>
                      <div className="p-3.5 rounded-2xl bg-amber-50/70 border border-amber-200 shadow-2xs text-center">
                        <p className="text-xs font-bold text-amber-700 mb-1">المقدم</p>
                        <p className="text-base sm:text-lg font-black text-amber-800 whitespace-nowrap">{formatCurrency(upfront)}</p>
                      </div>
                      <div className="p-3.5 rounded-2xl bg-indigo-50/80 border border-indigo-200 shadow-2xs text-center">
                        <p className="text-xs font-bold text-indigo-700 mb-1">المبلغ المموَّل</p>
                        <p className="text-base sm:text-lg font-black text-indigo-900 whitespace-nowrap">{formatCurrency(financedPrincipal)}</p>
                      </div>
                      <div className="p-3.5 rounded-2xl bg-white border border-slate-200/90 shadow-2xs text-center">
                        <p className="text-xs font-bold text-slate-500 mb-1">الفائدة</p>
                        <p className="text-base sm:text-lg font-black text-slate-800 whitespace-nowrap">{formatCurrency(effectiveInterest)}</p>
                      </div>
                    </div>

                    {/* Row 2: Totals & Settlement */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      <div className="p-3.5 rounded-2xl bg-blue-50/80 border border-blue-200 shadow-2xs text-center">
                        <p className="text-xs font-bold text-blue-700 mb-1">صافي العقد</p>
                        <p className="text-base sm:text-lg font-black text-blue-900 whitespace-nowrap">{formatCurrency(detailsModalSale.total)}</p>
                      </div>
                      <div className="p-3.5 rounded-2xl bg-emerald-50/80 border border-emerald-200 shadow-2xs text-center">
                        <p className="text-xs font-bold text-emerald-700 mb-1">المدفوع</p>
                        <p className="text-base sm:text-lg font-black text-emerald-800 whitespace-nowrap">{formatCurrency(detailsModalSale.paid)}</p>
                      </div>
                      <div className="p-3.5 rounded-2xl bg-rose-50/80 border border-rose-200 shadow-2xs text-center">
                        <p className="text-xs font-bold text-rose-700 mb-1">المتبقي</p>
                        <p className="text-base sm:text-lg font-black text-rose-700 whitespace-nowrap">{formatCurrency(detailsModalSale.remaining)}</p>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {detailsModalSale.notes && (
                <div className="p-4 rounded-2xl bg-amber-50/70 border border-amber-200 text-sm text-amber-950 whitespace-pre-line leading-relaxed">
                  <strong className="block mb-1 text-amber-900">ملاحظات العقد:</strong>
                  {detailsModalSale.notes}
                </div>
              )}

              {/* Items Table */}
              <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 text-sm font-black text-slate-800">
                  الأصناف المدرجة في العقد
                </div>
                {detailsLoading ? (
                  <div className="py-10 text-center text-sm text-slate-500 font-bold flex items-center justify-center gap-2">
                    <Loader2 size={18} className="animate-spin text-blue-600" />
                    <span>جاري تحميل تفاصيل الأصناف...</span>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50/80 text-slate-600 border-b border-slate-200 text-xs sm:text-sm">
                        <tr>
                          <th className="px-4 py-3 text-right font-bold">الصنف</th>
                          <th className="px-4 py-3 text-center font-bold">الكمية</th>
                          <th className="px-4 py-3 text-right font-bold">سعر الوحدة</th>
                          <th className="px-4 py-3 text-center font-bold">الخصم %</th>
                          <th className="px-4 py-3 text-center font-bold">الفائدة %</th>
                          <th className="px-4 py-3 text-right font-bold">الإجمالي</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {(detailsModalSale.items ?? []).length === 0 ? (
                          <tr>
                            <td colSpan={6} className="px-4 py-7 text-center text-slate-400 font-semibold text-sm">
                              لا توجد أصناف مسجلة لهذا العقد.
                            </td>
                          </tr>
                        ) : (
                          (detailsModalSale.items ?? []).map((item, idx) => (
                            <tr key={`${item.productId}-${idx}`} className="hover:bg-slate-50/70">
                              <td className="px-4 py-3 font-bold text-slate-900">{item.productName}</td>
                              <td className="px-4 py-3 text-center font-bold text-slate-700">{item.quantity}</td>
                              <td className="px-4 py-3 font-semibold text-slate-700">{formatCurrency(item.unitPrice)}</td>
                              <td className="px-4 py-3 text-center text-slate-600">{item.discount || 0}%</td>
                              <td className="px-4 py-3 text-center text-slate-600">{item.tax || 0}%</td>
                              <td className="px-4 py-3 font-black text-blue-700">{formatCurrency(item.total)}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Installments Schedule Table */}
              {(detailsModalSale.financing?.schedules ?? []).length > 0 && (
                <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
                  <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 text-sm font-black text-slate-800">
                    جدول الأقساط ({detailsModalSale.financing?.schedules?.length || 0} قسط)
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50/80 text-slate-600 border-b border-slate-200 text-xs sm:text-sm">
                        <tr>
                          <th className="px-4 py-3 text-right font-bold">القسط</th>
                          <th className="px-4 py-3 text-right font-bold">تاريخ الاستحقاق</th>
                          <th className="px-4 py-3 text-right font-bold">القيمة</th>
                          <th className="px-4 py-3 text-right font-bold">المدفوع</th>
                          <th className="px-4 py-3 text-right font-bold">المتبقي</th>
                          <th className="px-4 py-3 text-center font-bold">الحالة</th>
                          <th className="px-4 py-3 text-right font-bold">ملاحظات</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {(detailsModalSale.financing?.schedules ?? []).map((sch) => {
                          const rem = Math.max(0, Number(sch.amount || 0) - Number(sch.paidAmount || 0));
                          const isPaid = sch.status === 'paid' || sch.status === 'settled_early';
                          return (
                            <tr key={sch.id} className="hover:bg-slate-50/70">
                              <td className="px-4 py-3 font-bold text-slate-900">القسط {sch.monthIndex}</td>
                              <td className="px-4 py-3 font-semibold text-slate-700">{formatDateDisplay(sch.dueDate)}</td>
                              <td className="px-4 py-3 font-bold text-slate-800">{formatCurrency(sch.amount)}</td>
                              <td className="px-4 py-3 font-bold text-emerald-700">{formatCurrency(sch.paidAmount || 0)}</td>
                              <td className="px-4 py-3 font-bold text-rose-700">{formatCurrency(rem)}</td>
                              <td className="px-4 py-3 text-center">
                                <span
                                  className={`px-2.5 py-1 rounded-full text-xs font-bold ${isPaid
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : sch.status === 'partial'
                                      ? 'bg-amber-100 text-amber-800'
                                      : 'bg-slate-100 text-slate-700'
                                    }`}
                                >
                                  {isPaid ? 'مسدد' : sch.status === 'partial' ? 'جزئي' : 'مستحق'}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-slate-500 text-xs sm:text-sm">{sch.notes || '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="bg-slate-50 px-6 py-4 border-t border-slate-200 flex items-center justify-between gap-2 flex-wrap shrink-0">
              <button
                type="button"
                onClick={() => {
                  setDetailsModalSale(null);
                  setShowSearchModal(true);
                }}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 font-bold rounded-xl text-sm transition-colors cursor-pointer"
              >
                <ArrowRight size={15} />
                <span>العودة لسجل التعاقدات</span>
              </button>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    const target = detailsModalSale;
                    setDetailsModalSale(null);
                    setSavedSaleForPrinting(target);
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-700 hover:from-blue-700 hover:to-indigo-800 text-white font-bold rounded-xl text-sm transition-all cursor-pointer"
                >
                  <Printer size={15} />
                  <span>طباعة المستندات</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDetailsModalSale(null)}
                  className="px-4 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-xl text-sm transition-colors cursor-pointer"
                >
                  إغلاق
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Panel({
  title,
  children,
  icon,
  action,
}: {
  title: string;
  children: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition-all focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:border-blue-200">
      <div className="mb-3 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="text-sm font-bold text-slate-800">{title}</h3>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold text-slate-700">{label}</span>
      {children}
    </label>
  );
}

function QuickCard({
  label,
  value,
  tone = 'slate',
}: {
  label: string;
  value: string;
  tone?: 'slate' | 'emerald' | 'amber';
}) {
  const toneClass = {
    slate: 'bg-slate-900 text-white',
    emerald: 'bg-emerald-500 text-white',
    amber: 'bg-amber-500 text-white',
  }[tone];

  return (
    <div className={`rounded-xl px-3 py-2 shrink-0 flex flex-col justify-center min-w-[100px] text-center shadow-sm border border-white/10 ${toneClass}`}>
      <p className="text-[10px] uppercase tracking-tighter opacity-90 font-bold mb-0.5">{label}</p>
      <p className="text-sm font-black leading-none">{value}</p>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  tone = 'slate',
  strong = false,
}: {
  label: string;
  value: string;
  tone?: 'slate' | 'green' | 'red' | 'amber' | 'blue';
  strong?: boolean;
}) {
  const toneClass = {
    slate: 'bg-slate-50 text-slate-700',
    green: 'bg-emerald-50 text-emerald-700',
    red: 'bg-rose-50 text-rose-700',
    amber: 'bg-amber-50 text-amber-700',
    blue: 'bg-blue-50 text-blue-800',
  }[tone];

  return (
    <div className={`flex items-center justify-between rounded-2xl px-4 py-3 ${toneClass}`}>
      <span className="text-sm">{label}</span>
      <span className={strong ? 'text-base font-extrabold' : 'font-bold'}>{value}</span>
    </div>
  );
}

function StatusPill({ label, tone }: { label: string; tone: 'slate' | 'green' | 'amber' | 'rose' }) {
  const toneClass = {
    slate: 'bg-slate-100 text-slate-700',
    green: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-700',
    rose: 'bg-rose-100 text-rose-700',
  }[tone];

  return <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${toneClass}`}>{label}</span>;
}
