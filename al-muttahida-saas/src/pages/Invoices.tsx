import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays,
  Package,
  Plus,
  Save,
  ShoppingCart,
  Sparkles,
  Trash2,
  Search,
  Printer,
  FileSpreadsheet,
  Edit3,
  CalendarCheck,
  ArrowRight,
} from 'lucide-react';
import { Customer, Product, PurchaseItem, SaleItem, Supplier, SalesRep, Sale } from '../types';
import {
  createNotification,
  createPayment,
  createProduct,
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
  syncSales,
  syncCustomers,
  syncProducts,
  syncSuppliers,
  syncSalesReps,
} from '../lib/storage';
import { useAuth } from '../context/AuthContext';
import { isAdmin } from '../lib/permissions';
import LegalDocumentsPrintModal from '../components/LegalDocumentsPrintModal';
import { DatePicker } from '../components/DatePicker';
import { formatDateDisplay } from '../lib/dateUtils';
import { formatWholeCurrency } from '../lib/utils';
import { api, isApiMode } from '../lib/apiClient';

type PaymentMethod = 'cash' | 'card' | 'transfer' | 'installment';

interface DraftItem {
  productId: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  tax: number;
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
  const canDelete = isAdmin(user);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [salesReps, setSalesReps] = useState<SalesRep[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [selectedSalesRepId, setSelectedSalesRepId] = useState('');
  const [procurementSupplierId, setProcurementSupplierId] = useState('');
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
        (c.phone && c.phone.includes(term))
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
  const [editingSaleId, setEditingSaleId] = useState<string | null>(null);
  const [deferModalSale, setDeferModalSale] = useState<Sale | null>(null);
  const [deferInstallmentId, setDeferInstallmentId] = useState('');
  const [deferNewDueDate, setDeferNewDueDate] = useState('');
  const [deferStrategy, setDeferStrategy] = useState<'shift_subsequent' | 'merge_next'>('shift_subsequent');
  const [deferPenaltyFee, setDeferPenaltyFee] = useState<number>(0);
  const [deferPenaltyPaymentType, setDeferPenaltyPaymentType] = useState<'add_to_debt' | 'collect_cash'>('add_to_debt');
  const [deferLoading, setDeferLoading] = useState(false);
  const [deferMessage, setDeferMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
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

  const searchContracts = async (query: string) => {
    if (isApiMode()) {
      const results = await api.searchSales({ search: query.trim() || undefined, limit: 10, includeItems: true });
      setSales(sortSalesNewestFirst(results));
      return;
    }

    const normalizedQuery = query.trim().toLowerCase();
    const localResults = sortSalesNewestFirst(getSales()).filter(
      (sale) =>
        !normalizedQuery ||
        sale.invoiceNumber.toLowerCase().includes(normalizedQuery) ||
        sale.customerName.toLowerCase().includes(normalizedQuery),
    );
    setSales(localResults.slice(0, 10));
  };

  const openContractsSearch = () => {
    setModalSearchQuery('');
    setShowSearchModal(true);
  };

  useEffect(() => {
    if (!showSearchModal) return;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setModalSearchLoading(true);
      try {
        await searchContracts(modalSearchQuery);
      } catch (err: any) {
        if (!cancelled) {
          setMessage({
            type: 'error',
            text: err.message || 'حدث خطأ أثناء تحميل سجل التعاقدات.',
          });
        }
      } finally {
        if (!cancelled) setModalSearchLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [showSearchModal, modalSearchQuery]);

  const handleLoadForEdit = (sale: Sale) => {
    setEditingSaleId(sale.id);
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
      sale.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discount: item.discount,
        tax: item.tax,
      }))
    );

    window.scrollTo({ top: 0, behavior: 'smooth' });
    setMessage({
      type: 'success',
      text: `تم تحميل بيانات التعاقد رقم ${sale.invoiceNumber} للتعديل والمراجعة بنجاح. يمكنك الآن تعديل أي خانات أو أصناف ثم الحفظ.`,
    });
  };

  const handleDeleteContract = async (sale: Sale) => {
    const confirmed = window.confirm(
      `هل أنت متأكد من حذف التعاقد رقم ${sale.invoiceNumber}؟\nسيتم حذف التعاقد والأقساط والمدفوعات والحسابات المرتبطة به من النظام.`,
    );
    if (!confirmed) return;

    try {
      await deleteSale(sale.id, user?.name || 'system');
      setSales((current) => current.filter((entry) => entry.id !== sale.id));
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

  useEffect(() => {
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
    loadData();
  }, []);

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
      const subtotal = item.unitPrice * item.quantity;
      const discountValue = (subtotal * item.discount) / 100;
      const amountBeforeTax = subtotal - discountValue;
      const paidShare = preTaxTotal > 0 ? (amountBeforeTax / preTaxTotal) * upfrontAgainstItems : 0;
      const taxableAmount = Math.max(amountBeforeTax - paidShare, 0);
      const taxValue = (taxableAmount * item.tax) / 100;
      const availableStock = product?.quantity || 0;
      const needsProcurement =
        !!product && (product.fulfillmentType === 'on_demand' || item.quantity > availableStock);
      const shortageQuantity = !product
        ? 0
        : product.fulfillmentType === 'on_demand'
          ? item.quantity
          : Math.max(item.quantity - availableStock, 0);

      return {
        ...item,
        product,
        productName: product?.name || 'صنف غير معروف',
        barcode: product?.barcode || '',
        fulfillmentType: product?.fulfillmentType || 'stocked',
        availableStock,
        needsProcurement,
        shortageQuantity,
        total: amountBeforeTax + taxValue,
      };
    });
  }, [draftItems, products, preTaxTotal, upfrontAgainstItems]);

  const items: SaleItem[] = draftRows.map((item) => ({
    productId: item.productId,
    productName: item.productName,
    barcode: item.barcode,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    unitCost: Number(item.product?.purchasePrice || 0),
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
  const monthlyInstallment = effectiveMonths > 0 ? Number((remaining / effectiveMonths).toFixed(2)) : 0;
  const installmentPreview = Array.from({ length: effectiveMonths }, (_, index) => ({
    monthIndex: index + 1,
    dueDate: addMonths(firstInstallmentDate, index),
    amount:
      index === effectiveMonths - 1
        ? Number((remaining - monthlyInstallment * index).toFixed(2))
        : monthlyInstallment,
  }));

  const procurementSubtotal = procurementRows.reduce(
    (sum, item) => sum + item.shortageQuantity * (item.product?.purchasePrice || 0),
    0,
  );

  const formatCurrency = (amount: number) => formatWholeCurrency(amount, settings.currency);

  const filteredModalContracts = useMemo(() => sales.slice(0, 10), [sales]);

  const editingSale = useMemo(() => {
    if (!editingSaleId) return null;
    return sales.find((s) => s.id === editingSaleId) || null;
  }, [editingSaleId, sales]);

  const resetForm = () => {
    setEditingSaleId(null);
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
    if (!quickProduct.name.trim()) {
      setMessage({ type: 'error', text: 'أدخل اسم الصنف السريع.' });
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

    if (editingSaleId) {
      try {
        const updatedSale = await updateSale(editingSaleId, {
          customerId: selectedCustomer.id,
          customerName: selectedCustomer.name,
          items,
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
            salesRepName: salesReps.find((r) => r.id === selectedSalesRepId)?.name,
            installmentMonths: paymentMethod === 'installment' ? effectiveMonths : 0,
            installmentStartDate: paymentMethod === 'installment' ? firstInstallmentDate : undefined,
            upfrontAmount: paid,
            monthlyInstallmentAmount: paymentMethod === 'installment' ? monthlyInstallment : undefined,
          },
        });

        createNotification({
          type: 'success',
          title: 'تعديل تعاقد سابقى',
          message: `تم تعديل وحفظ التعاقد رقم ${updatedSale.invoiceNumber} للعميل ${selectedCustomer.name} بنجاح`,
        });

        const refreshedProducts = getProducts();
        setProducts(refreshedProducts);

        setSales(sortSalesNewestFirst(getSales()));

        setMessage({
          type: 'success',
          text: `تم تعديل وحفظ التعاقد رقم ${updatedSale.invoiceNumber} بنجاح.`,
        });

        setSavedSaleForPrinting(updatedSale);
        setEditingSaleId(null);
        resetForm();
      } catch (err: any) {
        setMessage({ type: 'error', text: err.message || 'حدث خطأ أثناء تعديل التعاقد' });
      }
      return;
    }

    if (procurementRows.length > 0 && !selectedProcurementSupplier) {
      setMessage({ type: 'error', text: 'اختر المورد ليتم إنشاء شراء تلقائي للأصناف غير المتوفرة.' });
      return;
    }

    try {
      let autoPurchaseNumber = '';

    const createdSale = await createSale({
      customerId: selectedCustomer.id,
      customerName: selectedCustomer.name,
      items,
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

    if (procurementRows.length > 0 && selectedProcurementSupplier) {
      const purchaseItems: PurchaseItem[] = procurementRows.map((item) => {
        const unitPrice = item.product?.purchasePrice || 0;
        const taxPerUnit = unitPrice * ((item.product?.tax || 0) / 100);

        return {
          productId: item.productId,
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
        supplierId: selectedProcurementSupplier.id,
        supplierName: selectedProcurementSupplier.name,
        items: purchaseItems,
        subtotal: purchaseSubtotal,
        discount: 0,
        tax: purchaseTax,
        total: purchaseTotal,
        paid: 0,
        remaining: purchaseTotal,
        status: 'pending',
        date: invoiceDate,
        notes: `شراء تلقائي مرتبط بالفاتورة ${createdSale.invoiceNumber} للعميل ${selectedCustomer.name}`,
        createdBy: user?.name || 'مدير النظام',
      });

      autoPurchaseNumber = createdPurchase.invoiceNumber;

      createNotification({
        type: 'info',
        title: 'شراء تلقائي',
        message: `تم إنشاء فاتورة شراء ${createdPurchase.invoiceNumber} تلقائيًا لتجهيز طلب العميل ${selectedCustomer.name}`,
      });
    }

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
      setMessage({ type: 'error', text: err.message || 'تعذر حفظ الفاتورة. راجع البيانات وحاول مرة أخرى.' });
    }
  };

  return (
    <div className="space-y-2 pb-9">
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
                className="inline-flex items-center gap-2 px-3 py-2 bg-sky-50 border border-sky-200 hover:bg-sky-100 text-sky-700 font-bold rounded-lg text-sm transition-all shadow-sm active:scale-95"
              >
                <Search size={16} />
                البحث في سجل التعاقدات
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
          className={`rounded-2xl border px-4 py-3 text-sm ${
            message.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-rose-200 bg-rose-50 text-rose-700'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 2xl:grid-cols-[minmax(0,1.7fr)_360px]">
        <div className="space-y-2">
          <Panel title="1. بيانات العميل والفاتورة" icon={<CalendarDays size={18} className="text-sky-600" />}>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Field label="العميل">
                <div className="relative w-full">
                  <input
                    ref={customerInputRef}
                    autoFocus
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
                <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)} className="input-ui">
                  <option value="cash">نقدي</option>
                  <option value="card">بطاقة</option>
                  <option value="transfer">تحويل</option>
                  <option value="installment">تقسيط</option>
                </select>
              </Field>

              <Field label="المدفوع الآن">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={paidAmount === 0 ? '' : paidAmount}
                  onChange={(e) => setPaidAmount(Number(e.target.value) || 0)}
                  className="input-ui"
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
            <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_110px_110px_110px_auto]">
                <Field label="الصنف">
                  <select
                    ref={productSelectRef}
                    value={lineProductId}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        quantityInputRef.current?.focus();
                      }
                    }}
                    onChange={(e) => {
                      const product = products.find((entry) => entry.id === e.target.value);
                      setLineProductId(e.target.value);
                      setLineTax(product?.tax || '');
                    }}
                    className="input-ui"
                  >
                    <option value="">اختر الصنف</option>
                    {products.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name} - {product.barcode}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="الكمية">
                  <input
                    ref={quantityInputRef}
                    type="number"
                    min="1"
                    value={lineQuantity}
                    onChange={(e) => setLineQuantity(e.target.value === '' ? '' : Number(e.target.value))}
                    className="input-ui"
                    onKeyDown={(e) => {
                      if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault();
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addLineButtonRef.current?.focus();
                      }
                    }}
                  />
                </Field>

                <Field label="الخصم %">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={lineDiscount}
                    onChange={(e) => setLineDiscount(e.target.value === '' ? '' : Number(e.target.value))}
                    className="input-ui"
                    onKeyDown={(e) => ['e', 'E', '+', '-'].includes(e.key) && e.preventDefault()}
                  />
                </Field>

                <Field label="الضريبة %">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={lineTax}
                    onChange={(e) => setLineTax(e.target.value === '' ? '' : Number(e.target.value))}
                    className="input-ui"
                    onKeyDown={(e) => ['e', 'E', '+', '-'].includes(e.key) && e.preventDefault()}
                  />
                </Field>

                <div className="flex items-end">
                  <button
                    ref={addLineButtonRef}
                    onClick={addLine}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addLine();
                        productSelectRef.current?.focus();
                      }
                    }}
                    className="inline-flex h-10 items-center gap-2 rounded-lg bg-sky-600 px-4 font-bold text-white hover:bg-sky-700"
                  >
                    <Plus size={18} />
                    إضافة
                  </button>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowQuickProduct((current) => !current)}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100"
                >
                  <Sparkles size={16} />
                  {showQuickProduct ? 'إخفاء صنف حسب الطلب' : 'إضافة صنف حسب الطلب'}
                </button>
                <span className="text-sm text-slate-500">
                  إذا الصنف غير موجود، أنشئه هنا وسيتم اعتباره حسب الطلب تلقائيًا.
                </span>
              </div>

              {showQuickProduct && (
                <div className="mt-4 rounded-[24px] border border-dashed border-sky-300 bg-white p-4">
                  <div className="mb-4">
                    <h4 className="font-bold text-slate-800">إدخال صنف حسب الطلب</h4>
                    <p className="mt-1 text-sm text-slate-500">
                      مناسب لحالة حضور العميل وطلب صنف جديد، بدون فتح شاشة الأصناف أو المشتريات.
                    </p>
                  </div>
                  <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-5">
                    <Field label="اسم الصنف">
                      <input
                        type="text"
                        value={quickProduct.name}
                        onChange={(e) => setQuickProduct((current) => ({ ...current, name: e.target.value }))}
                        className="input-ui"
                      />
                    </Field>
                    {/* barcode field removed from quick-add */}
                    <Field label="سعر الشراء">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={quickProduct.purchasePrice === 0 ? '' : quickProduct.purchasePrice}
                        onChange={(e) =>
                          setQuickProduct((current) => ({ ...current, purchasePrice: Number(e.target.value) || 0 }))
                        }
                        className="input-ui"
                        onKeyDown={(e) => ['e', 'E', '+', '-'].includes(e.key) && e.preventDefault()}
                      />
                    </Field>
                    {/* sale price removed for on_demand quick products */}
                    <Field label="المورد المتوقع">
                      <div className="relative w-full">
                        <input
                          value={quickSupplierSearchTerm}
                          onChange={(e) => {
                            setQuickSupplierSearchTerm(e.target.value);
                            setShowQuickSupplierSuggestions(true);
                            setQuickProduct((current) => ({ ...current, supplierId: '' }));
                          }}
                          onFocus={() => setShowQuickSupplierSuggestions(true)}
                          onBlur={() => setTimeout(() => setShowQuickSupplierSuggestions(false), 200)}
                          className="input-ui w-full"
                          placeholder="اكتب اسم المورد للبحث..."
                        />
                        {showQuickSupplierSuggestions && quickSupplierSuggestions.length > 0 && (
                          <div className="absolute right-0 left-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-50 max-h-40 overflow-y-auto divide-y divide-slate-100">
                            {quickSupplierSuggestions.map((s) => (
                              <button
                                key={s.id}
                                type="button"
                                onClick={() => {
                                  setQuickProduct((current) => ({ ...current, supplierId: s.id }));
                                  setQuickSupplierSearchTerm(s.name);
                                  setShowQuickSupplierSuggestions(false);
                                }}
                                className="w-full text-right px-4 py-2.5 text-sm text-slate-700 hover:bg-sky-50 hover:text-sky-700 font-medium transition-colors"
                              >
                                <span>{s.name}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </Field>
                  </div>

                  <div className="mt-4 flex justify-end">
                    <button
                      type="button"
                      onClick={handleQuickProductSave}
                      className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2 font-bold text-white hover:bg-slate-800"
                    >
                      <Plus size={16} />
                      حفظ الصنف
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-5 overflow-hidden rounded-xl border border-slate-200 shadow-xs">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[850px] bg-white">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-4 text-right text-xs font-bold text-slate-700 tracking-wider">الصنف</th>
                      <th className="py-2.5 px-4 text-right text-xs font-bold text-slate-700 tracking-wider">النوع</th>
                      <th className="py-2.5 px-4 text-right text-xs font-bold text-slate-700 tracking-wider">الكمية</th>
                      <th className="py-2.5 px-4 text-right text-xs font-bold text-slate-700 tracking-wider">المتاح بالمخزن</th>
                      <th className="py-2.5 px-4 text-right text-xs font-bold text-slate-700 tracking-wider">حالة التوريد</th>
                      <th className="py-2.5 px-4 text-right text-xs font-bold text-slate-700 tracking-wider">الإجمالي</th>
                      <th className="py-2.5 px-4 text-center text-xs font-bold text-slate-700 tracking-wider">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {draftRows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">
                          لا توجد أصناف مضافة بعد.
                        </td>
                      </tr>
                    ) : (
                      draftRows.map((item, index) => (
                        <tr key={`${item.productId}-${index}`} className="hover:bg-slate-50">
                          <td className="px-4 py-4">
                            <p className="font-semibold text-slate-800">{item.productName}</p>
                            <p className="mt-1 text-xs text-slate-500">{item.barcode || '-'}</p>
                          </td>
                          <td className="px-4 py-4">
                            <StatusPill
                              label={item.fulfillmentType === 'on_demand' ? 'حسب الطلب' : 'مخزني'}
                              tone={item.fulfillmentType === 'on_demand' ? 'amber' : 'slate'}
                            />
                          </td>
                          <td className="px-4 py-4">
                            <input
                              type="number"
                              min="1"
                              value={item.quantity === 0 ? '' : item.quantity}
                              onChange={(e) =>
                                updateLine(index, { quantity: Math.max(1, Number(e.target.value) || 1) })
                              }
                              className="w-24 rounded-xl border border-slate-200 px-3 py-2"
                              onKeyDown={(e) => ['e', 'E', '+', '-'].includes(e.key) && e.preventDefault()}
                            />
                          </td>
                          <td className="px-4 py-4 text-sm text-slate-600">{item.availableStock}</td>
                          <td className="px-4 py-4">
                            {item.needsProcurement ? (
                              <div className="space-y-1">
                                <StatusPill label={`شراء تلقائي ${item.shortageQuantity}`} tone="rose" />
                                <p className="text-xs text-slate-500">سيُنشأ شراء تلقائي عند الحفظ</p>
                              </div>
                            ) : (
                              <StatusPill label="جاهز من المخزون" tone="green" />
                            )}
                          </td>
                          <td className="px-4 py-4 font-bold text-emerald-700">{formatCurrency(item.total)}</td>
                          <td className="px-4 py-4">
                            <button
                              type="button"
                              onClick={() =>
                                setDraftItems((current) => current.filter((_, itemIndex) => itemIndex !== index))
                              }
                              className="inline-flex items-center rounded-xl bg-rose-50 p-2 text-rose-600 hover:bg-rose-100"
                            >
                              <Trash2 size={16} />
                            </button>
                          </td>
                        </tr>
                      ))
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
                              <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                sch.status === 'paid' ? 'bg-emerald-100 text-emerald-700'
                                : sch.status === 'settled_early' ? 'bg-sky-100 text-sky-700'
                                : sch.status === 'partial' ? 'bg-amber-100 text-amber-700'
                                : 'bg-slate-100 text-slate-700'
                              }`}>
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

          {procurementRows.length > 0 && (
            <Panel title="3. شراء تلقائي من نفس الشاشة" icon={<ShoppingCart size={18} className="text-amber-600" />}>
              <div className="grid gap-5 xl:grid-cols-[260px_minmax(0,1fr)]">
                <div className="space-y-4">
                  <Field label="المورد الذي سيُنشأ له الشراء">
                    <div className="relative w-full">
                      <input
                        value={supplierSearchTerm}
                        onChange={(e) => {
                          setSupplierSearchTerm(e.target.value);
                          setShowSupplierSuggestions(true);
                          if (e.target.value.trim() === '') {
                            setProcurementSupplierId('');
                          }
                        }}
                        onFocus={() => setShowSupplierSuggestions(true)}
                        onBlur={() => setTimeout(() => setShowSupplierSuggestions(false), 200)}
                        className="input-ui w-full"
                        placeholder="اكتب اسم المورد للبحث..."
                      />
                      {showSupplierSuggestions && supplierSuggestions.length > 0 && (
                        <div className="absolute right-0 left-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-50 max-h-40 overflow-y-auto divide-y divide-slate-100">
                          {supplierSuggestions.map((s) => (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => {
                                setProcurementSupplierId(s.id);
                                setSupplierSearchTerm(s.name);
                                setShowSupplierSuggestions(false);
                              }}
                              className="w-full text-right px-4 py-2.5 text-sm text-slate-700 hover:bg-sky-50 hover:text-sky-700 font-medium transition-colors"
                            >
                              <span>{s.name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </Field>

                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    سيتم تجهيز شراء تلقائي للأصناف غير المتوفرة عند حفظ الفاتورة، ثم تُخصم الكمية مباشرة من الشراء إلى البيع.
                  </div>
                </div>

                <div className="overflow-hidden rounded-[24px] border border-slate-200">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[620px]">
                      <thead className="bg-slate-50 text-slate-700">
                        <tr>
                          <th className="px-4 py-3 text-right">الصنف</th>
                          <th className="px-4 py-3 text-right">الكمية المطلوب شراؤها</th>
                          <th className="px-4 py-3 text-right">سعر الشراء</th>
                          <th className="px-4 py-3 text-right">الإجمالي التقريبي</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {procurementRows.map((item) => (
                          <tr key={`procurement-${item.productId}`}>
                            <td className="px-4 py-3 font-semibold text-slate-800">{item.productName}</td>
                            <td className="px-4 py-3 text-slate-700">{item.shortageQuantity}</td>
                            <td className="px-4 py-3 text-slate-700">
                              {formatCurrency(item.product?.purchasePrice || 0)}
                            </td>
                            <td className="px-4 py-3 font-bold text-amber-700">
                              {formatCurrency(item.shortageQuantity * (item.product?.purchasePrice || 0))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </Panel>
          )}
        </div>

        <div className="space-y-6">
          <Panel title="ملخص الحركة" icon={<Save size={18} className="text-emerald-600" />}>
            <div className="space-y-3">
              <SummaryRow label="العميل" value={selectedCustomer?.name || 'غير محدد'} />
              <SummaryRow label="الإجمالي قبل الخصم" value={formatCurrency(subtotal)} />
              <SummaryRow label="الخصم" value={formatCurrency(discountAmount)} tone="red" />
              <SummaryRow label="الضريبة" value={formatCurrency(taxAmount)} />
              <SummaryRow label="صافي الفاتورة" value={formatCurrency(total)} tone="green" strong />
              <SummaryRow label="المدفوع" value={formatCurrency(paid)} />
              <SummaryRow label="المتبقي" value={formatCurrency(remaining)} tone="amber" strong />
              <SummaryRow label="شراء مطلوب" value={formatCurrency(procurementSubtotal)} tone="slate" />
            </div>

            <div className="mt-5 grid gap-3">
              <button
                onClick={saveInvoice}
                className={`inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 font-bold text-white transition-all ${
                  editingSaleId ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                <Save size={18} />
                {editingSaleId ? 'تعديل وحفظ التغييرات' : 'حفظ الفاتورة'}
              </button>
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

          {paymentMethod === 'installment' && (
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
                        {(!correspondingSchedule || !isPaid) && (
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
                              } else {
                                // In new contract mode, launch defer modal with draft sale representation
                                const draftSaleObj: Sale = {
                                  id: 'draft-new-contract',
                                  invoiceNumber: 'فاتورة جديدة',
                                  customerId: selectedCustomerId,
                                  customerName: customers.find((c) => c.id === selectedCustomerId)?.name || 'العميل الحالي',
                                  date: invoiceDate,
                                  items: [],
                                  subtotal,
                                  discount: discountAmount,
                                  tax: taxAmount,
                                  total,
                                  paid,
                                  remaining,
                                  status: 'pending',
                                  createdAt: new Date().toISOString(),
                                  financing: {
                                    paymentMethod: 'installment',
                                    installmentMonths: effectiveMonths,
                                    installmentStartDate: firstInstallmentDate,
                                    monthlyInstallmentAmount: monthlyInstallment,
                                    schedules: installmentPreview.map((ip) => ({
                                      id: `inst-${ip.monthIndex}`,
                                      monthIndex: ip.monthIndex,
                                      label: `القسط ${ip.monthIndex}`,
                                      dueDate: ip.dueDate,
                                      amount: ip.amount,
                                      paidAmount: 0,
                                      status: 'unpaid' as const,
                                    })),
                                  },
                                };
                                setDeferModalSale(draftSaleObj);
                                setDeferInstallmentId(scheduleId);
                                setDeferNewDueDate(addMonths(entry.dueDate, 1));
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

          <Panel title="ماذا سيحدث عند الحفظ؟" icon={<Sparkles size={18} className="text-slate-700" />}>
            <div className="space-y-3 text-sm leading-6 text-slate-600">
              <p>1. يتم حفظ الفاتورة للعميل مباشرة.</p>
              <p>2. إذا كان هناك صنف غير متوفر، يتم إنشاء شراء تلقائي من نفس الشاشة.</p>
              <p>3. إذا كان هناك مبلغ مقدم، يتم تسجيل دفعة تلقائيًا على الفاتورة.</p>
              <p>4. في حالة التقسيط، يتم إنشاء خطة الأقساط الشهرية تلقائيًا.</p>
            </div>
          </Panel>
        </div>
      </div>

      {/* NEW: Gorgeous Advanced Floating Search Overlay Modal */}
      {showSearchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="w-full max-w-3xl rounded-[28px] bg-white shadow-2xl border border-slate-100 overflow-hidden transform transition-all duration-300 scale-100 flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-sky-600 to-sky-700 p-6 text-white flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-xl font-bold flex items-center gap-2 text-right">
                  <Search size={22} />
                  البحث الذكي في سجل التعاقدات
                </h3>
                <p className="text-xs text-sky-100 mt-1 text-right">اكتب اسم العميل أو رقم العقد، ثم اختر الإجراء (تعديل أو طباعة).</p>
              </div>
              <button
                type="button"
                onClick={() => setShowSearchModal(false)}
                className="text-white/80 hover:text-white text-3xl font-light p-1 leading-none transition-colors outline-none"
              >
                &times;
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 overflow-y-auto flex-1">
              {/* Big Search Input */}
              <div className="relative mb-6">
                <Search className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                <input
                  type="text"
                  autoFocus
                  value={modalSearchQuery}
                  onChange={(e) => setModalSearchQuery(e.target.value)}
                  placeholder="اكتب اسم العميل المشتري أو رقم العقد للبحث الفوري..."
                  className="w-full rounded-2xl border-2 border-sky-100 focus:border-sky-500 bg-slate-50 px-4 py-3.5 pr-12 text-base font-semibold outline-none transition-all shadow-inner"
                />
              </div>

              {/* List of Results */}
              <div className="space-y-3">
                {modalSearchLoading ? (
                  <div className="py-12 text-center text-slate-400 font-bold">
                    جاري تحميل سجل التعاقدات...
                  </div>
                ) : filteredModalContracts.length === 0 ? (
                  <div className="py-12 text-center text-slate-400 font-bold">
                    لا توجد تعاقدات سابقة مسجلة أو مطابقة لبحثك الحالي.
                  </div>
                ) : (
                  filteredModalContracts.map((sale) => (
                    <div
                      key={sale.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl border border-slate-100 hover:border-sky-200 hover:bg-sky-50/30 transition-all shadow-sm bg-white"
                    >
                      <div className="space-y-1 text-right">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-black text-sky-600">{sale.invoiceNumber}</span>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-bold">
                            {formatDateDisplay(sale.date)}
                          </span>
                          <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold ${
                            sale.financing?.paymentMethod === 'installment' ? 'bg-violet-50 text-violet-700' : 'bg-emerald-50 text-emerald-700'
                          }`}>
                            {sale.financing?.paymentMethod === 'installment' ? 'تقسيط' : 'نقدي'}
                          </span>
                        </div>
                        <p className="font-bold text-slate-800 text-base">{sale.customerName}</p>
                        <div className="flex items-center gap-4 text-xs text-slate-500 flex-wrap">
                          <span>الإجمالي: <b className="text-emerald-700">{formatCurrency(sale.total)}</b></span>
                          <span>المتبقي: <b className="text-red-600">{formatCurrency(sale.remaining)}</b></span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 shrink-0 justify-end sm:justify-start">
                        <button
                          type="button"
                          onClick={() => {
                            handleLoadForEdit(sale);
                            setShowSearchModal(false);
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold transition-all shadow-sm active:scale-95"
                        >
                          <Edit3 size={13} />
                          تعديل البيانات
                        </button>
                        {canDelete && (
                        <button
                          type="button"
                          onClick={() => handleDeleteContract(sale)}
                          className="inline-flex items-center gap-1.5 px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm active:scale-95"
                        >
                          <Trash2 size={13} />
                          حذف التعاقد
                        </button>
                        )}
                        {canDelete && sale.financing?.paymentMethod === 'installment' && (sale.financing?.schedules?.length ?? 0) > 0 && (
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
                            className="inline-flex items-center gap-1.5 px-3 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm active:scale-95"
                          >
                            <CalendarCheck size={13} />
                            ترحيل قسط
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setSavedSaleForPrinting(sale);
                            setShowSearchModal(false);
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all shadow-sm active:scale-95"
                        >
                          <Printer size={13} />
                          طباعة المستندات
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="bg-slate-50 p-4 border-t border-slate-100 flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setShowSearchModal(false)}
                className="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-xl text-sm transition-colors"
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
                            className={`transition-colors ${
                              deferInstallmentId === sch.id ? 'bg-violet-50' : 'bg-white hover:bg-slate-50'
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
                              <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${
                                sch.status === 'paid' ? 'bg-emerald-100 text-emerald-700'
                                : sch.status === 'settled_early' ? 'bg-sky-100 text-sky-700'
                                : sch.status === 'partial' ? 'bg-amber-100 text-amber-700'
                                : 'bg-slate-100 text-slate-700'
                              }`}>
                                {sch.status === 'paid' ? 'مدفوع' : sch.status === 'settled_early' ? 'تكييش' : sch.status === 'partial' ? 'جزئي' : 'معلق'}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-center">
                              {!isPaid && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setDeferInstallmentId(sch.id);
                                    const suggestedDate = addMonths(sch.dueDate, 1);
                                    setDeferNewDueDate(suggestedDate);
                                    setDeferMessage(null);
                                  }}
                                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                    deferInstallmentId === sch.id
                                      ? 'bg-violet-600 text-white'
                                      : 'bg-violet-50 text-violet-700 hover:bg-violet-100'
                                  }`}
                                >
                                  <ArrowRight size={12} />
                                  ترحيل
                                </button>
                              )}
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
                    <div className={`rounded-xl px-4 py-2.5 text-xs font-bold ${
                      deferMessage.type === 'success'
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
                        <span className="animate-spin">&#8987;</span>
                      ) : (
                        <CalendarCheck size={16} />
                      )}
                      تأكيد ترحيل القسط
                    </button>
                  </div>
                </>
              )}

              {!deferInstallmentId && deferMessage && (
                <div className={`rounded-xl px-4 py-2.5 text-xs font-bold ${
                  deferMessage.type === 'success'
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
    </div>
  );
}

function Panel({
  title,
  children,
  icon,
}: {
  title: string;
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition-all focus-within:ring-2 focus-within:ring-sky-500/20 focus-within:border-sky-200 focus-within:shadow-md">
      <div className="mb-3 flex items-center gap-2">
        {icon}
        <h3 className="text-sm font-bold text-slate-800">{title}</h3>
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
  tone?: 'slate' | 'green' | 'red' | 'amber';
  strong?: boolean;
}) {
  const toneClass = {
    slate: 'bg-slate-50 text-slate-700',
    green: 'bg-emerald-50 text-emerald-700',
    red: 'bg-rose-50 text-rose-700',
    amber: 'bg-amber-50 text-amber-700',
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
