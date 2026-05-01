import React, { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  Package,
  Plus,
  Save,
  ShoppingCart,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { Customer, Product, PurchaseItem, SaleItem, Supplier, SalesRep } from '../types';
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
} from '../lib/storage';
import { useAuth } from '../context/AuthContext';

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
  barcode: string;
  purchasePrice: number;
  salePrice: number;
  supplierId: string;
}

const pad = (value: number) => String(value).padStart(2, '0');

const formatLocalDate = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const today = () => formatLocalDate(new Date());

function addMonths(dateStr: string, months: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) {
    return dateStr;
  }

  const monthIndex = month - 1 + months;
  const targetYear = year + Math.floor(monthIndex / 12);
  const normalizedMonthIndex = ((monthIndex % 12) + 12) % 12;
  const targetMonth = normalizedMonthIndex + 1;
  const lastDayInTargetMonth = new Date(targetYear, targetMonth, 0).getDate();
  const safeDay = Math.min(day, lastDayInTargetMonth);

  return `${targetYear}-${pad(targetMonth)}-${pad(safeDay)}`;
}

export default function Invoices() {
  const { settings, user } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [salesReps, setSalesReps] = useState<SalesRep[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [selectedSalesRepId, setSelectedSalesRepId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(today());
  const [paymentDate, setPaymentDate] = useState(today());
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [paidAmount, setPaidAmount] = useState(0);
  const [installmentMonths, setInstallmentMonths] = useState(12);
  const [invoiceNotes, setInvoiceNotes] = useState('');
  const [lineProductId, setLineProductId] = useState('');
  const [lineQuantity, setLineQuantity] = useState(1);
  const [lineDiscount, setLineDiscount] = useState(0);
  const [lineTax, setLineTax] = useState(settings.taxRate);
  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);
  const [procurementSupplierId, setProcurementSupplierId] = useState('');
  const [showQuickProduct, setShowQuickProduct] = useState(false);
  const [quickProduct, setQuickProduct] = useState<QuickProductForm>({
    name: '',
    barcode: '',
    purchasePrice: 0,
    salePrice: 0,
    supplierId: '',
  });
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const loadedCustomers = getCustomers();
    const loadedProducts = getProducts();
    const loadedSuppliers = getSuppliers();
    const loadedSalesReps = getSalesReps();

    setCustomers(loadedCustomers);
    setProducts(loadedProducts);
    setSuppliers(loadedSuppliers);
    setSalesReps(loadedSalesReps);
    setInvoiceNumber(getNextSaleInvoiceNumber());

    if (loadedCustomers.length > 0) {
      setSelectedCustomerId(loadedCustomers[0].id);
    }

    if (loadedSuppliers.length > 0) {
      setProcurementSupplierId(loadedSuppliers[0].id);
      setQuickProduct((current) => ({ ...current, supplierId: current.supplierId || loadedSuppliers[0].id }));
    }
  }, []);

  const selectedCustomer = customers.find((customer) => customer.id === selectedCustomerId) || null;
  const selectedProduct = products.find((product) => product.id === lineProductId) || null;
  const selectedProcurementSupplier =
    suppliers.find((supplier) => supplier.id === procurementSupplierId) || null;

  const draftRows = useMemo(() => {
    return draftItems.map((item) => {
      const product = products.find((entry) => entry.id === item.productId);
      const subtotal = item.unitPrice * item.quantity;
      const discountValue = (subtotal * item.discount) / 100;
      const taxableAmount = subtotal - discountValue;
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
        total: taxableAmount + taxValue,
      };
    });
  }, [draftItems, products]);

  const items: SaleItem[] = draftRows.map((item) => ({
    productId: item.productId,
    productName: item.productName,
    barcode: item.barcode,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    discount: item.discount,
    tax: item.tax,
    total: item.total,
  }));

  const procurementRows = draftRows.filter((item) => item.needsProcurement && item.shortageQuantity > 0);
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const discountAmount = items.reduce((sum, item) => sum + (item.quantity * item.unitPrice * item.discount) / 100, 0);
  const taxAmount = items.reduce(
    (sum, item) =>
      sum + ((item.quantity * item.unitPrice - (item.quantity * item.unitPrice * item.discount) / 100) * item.tax) / 100,
    0,
  );
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

  const formatCurrency = (amount: number) =>
    `${new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(amount)} ${settings.currency}`;

  const resetForm = () => {
    setInvoiceNumber(getNextSaleInvoiceNumber());
    setInvoiceDate(today());
    setPaymentDate(today());
    setPaymentMethod('cash');
    setPaidAmount(0);
    setInstallmentMonths(12);
    setInvoiceNotes('');
    setLineProductId('');
    setLineQuantity(1);
    setLineDiscount(0);
    setLineTax(settings.taxRate);
    setDraftItems([]);
    setSelectedSalesRepId('');
    setShowQuickProduct(false);
    setQuickProduct({
      name: '',
      barcode: '',
      purchasePrice: 0,
      salePrice: 0,
      supplierId: suppliers[0]?.id || '',
    });
  };

  const addLine = () => {
    if (!selectedProduct) {
      setMessage({ type: 'error', text: 'اختر الصنف أولًا أو أنشئ صنفًا سريعًا.' });
      return;
    }

    if (lineQuantity <= 0) {
      setMessage({ type: 'error', text: 'الكمية يجب أن تكون أكبر من صفر.' });
      return;
    }

    setDraftItems((current) => {
      const existingIndex = current.findIndex((item) => item.productId === selectedProduct.id);
      if (existingIndex !== -1) {
        return current.map((item, index) =>
          index === existingIndex
            ? {
                ...item,
                quantity: item.quantity + lineQuantity,
                unitPrice: selectedProduct.salePrice,
                discount: lineDiscount,
                tax: lineTax,
              }
            : item,
        );
      }

      return [
        ...current,
        {
          productId: selectedProduct.id,
          quantity: lineQuantity,
          unitPrice: selectedProduct.salePrice,
          discount: lineDiscount,
          tax: lineTax,
        },
      ];
    });

    setLineProductId('');
    setLineQuantity(1);
    setLineDiscount(0);
    setLineTax(settings.taxRate);
    setMessage(null);
  };

  const updateLine = (index: number, next: Partial<DraftItem>) => {
    setDraftItems((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...next } : item)));
  };

  const handleQuickProductSave = () => {
    if (!quickProduct.name.trim()) {
      setMessage({ type: 'error', text: 'أدخل اسم الصنف السريع.' });
      return;
    }

    if (quickProduct.purchasePrice <= 0 || quickProduct.salePrice <= 0) {
      setMessage({ type: 'error', text: 'أدخل سعر شراء وسعر بيع صحيحين.' });
      return;
    }

    const createdProduct = createProduct({
      name: quickProduct.name.trim(),
      barcode: quickProduct.barcode.trim() || `OD-${Date.now()}`,
      category: 'حسب الطلب',
      fulfillmentType: 'on_demand',
      unit: 'قطعة',
      purchasePrice: quickProduct.purchasePrice,
      salePrice: quickProduct.salePrice,
      discount: 0,
      tax: settings.taxRate,
      quantity: 0,
      minQuantity: 0,
      description: 'تم إنشاؤه سريعًا من شاشة الفواتير',
    });

    const refreshedProducts = getProducts();
    setProducts(refreshedProducts);
    setLineProductId(createdProduct.id);
    setLineTax(createdProduct.tax);
    setProcurementSupplierId(quickProduct.supplierId || procurementSupplierId);
    setQuickProduct({
      name: '',
      barcode: '',
      purchasePrice: 0,
      salePrice: 0,
      supplierId: quickProduct.supplierId || suppliers[0]?.id || '',
    });
    setShowQuickProduct(false);
    setMessage({ type: 'success', text: `تم إنشاء الصنف ${createdProduct.name} ويمكن إضافته مباشرة للفاتورة.` });
  };

  const saveInvoice = () => {
    if (!selectedCustomer) {
      setMessage({ type: 'error', text: 'اختر العميل قبل حفظ الفاتورة.' });
      return;
    }

    if (items.length === 0) {
      setMessage({ type: 'error', text: 'أضف صنفًا واحدًا على الأقل.' });
      return;
    }

    if (procurementRows.length > 0 && !selectedProcurementSupplier) {
      setMessage({ type: 'error', text: 'اختر المورد ليتم إنشاء شراء تلقائي للأصناف غير المتوفرة.' });
      return;
    }

    let autoPurchaseNumber = '';

    if (procurementRows.length > 0 && selectedProcurementSupplier) {
      const purchaseItems: PurchaseItem[] = procurementRows.map((item) => {
        const unitPrice = item.product?.purchasePrice || 0;
        const discount = item.product?.discount || 0;
        const taxPerUnit = (unitPrice - discount) * ((item.product?.tax || 0) / 100);

        return {
          productId: item.productId,
          productName: item.productName,
          barcode: item.barcode,
          quantity: item.shortageQuantity,
          unitPrice,
          discount,
          tax: taxPerUnit,
          total: item.shortageQuantity * unitPrice - item.shortageQuantity * discount + item.shortageQuantity * taxPerUnit,
        };
      });

      const purchaseSubtotal = purchaseItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
      const purchaseDiscount = purchaseItems.reduce((sum, item) => sum + item.quantity * item.discount, 0);
      const purchaseTax = purchaseItems.reduce((sum, item) => sum + item.quantity * item.tax, 0);
      const purchaseTotal = purchaseSubtotal - purchaseDiscount + purchaseTax;

      const createdPurchase = createPurchase({
        supplierId: selectedProcurementSupplier.id,
        supplierName: selectedProcurementSupplier.name,
        items: purchaseItems,
        subtotal: purchaseSubtotal,
        discount: purchaseDiscount,
        tax: purchaseTax,
        total: purchaseTotal,
        paid: 0,
        remaining: purchaseTotal,
        status: 'pending',
        date: invoiceDate,
        notes: `شراء تلقائي مرتبط بالفاتورة ${invoiceNumber} للعميل ${selectedCustomer.name}`,
        createdBy: user?.name || 'مدير النظام',
      });

      autoPurchaseNumber = createdPurchase.invoiceNumber;

      createNotification({
        type: 'info',
        title: 'شراء تلقائي',
        message: `تم إنشاء فاتورة شراء ${createdPurchase.invoiceNumber} تلقائيًا لتجهيز طلب العميل ${selectedCustomer.name}`,
      });
    }

    const createdSale = createSale({
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

    if (paid > 0) {
      createPayment({
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
    setMessage({
      type: 'success',
      text:
        procurementRows.length > 0 && autoPurchaseNumber
          ? `تم حفظ الفاتورة ${createdSale.invoiceNumber} وإنشاء شراء تلقائي ${autoPurchaseNumber} من نفس الشاشة.`
          : `تم حفظ الفاتورة ${createdSale.invoiceNumber} بنجاح.`,
    });
    resetForm();
  };

  return (
    <div className="space-y-6">
      <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex-1">
            <h2 className="text-2xl font-bold text-slate-900">فاتورة بيع ذكية</h2>
            <p className="mt-1 text-sm text-slate-500 leading-relaxed max-w-2xl">
              شاشة واحدة تجمع العميل والصنف والتقسيط والشراء التلقائي عند الحاجة.
            </p>
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

      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1.7fr)_420px]">
        <div className="space-y-6">
          <Panel title="1. بيانات العميل والفاتورة" icon={<CalendarDays size={18} className="text-sky-600" />}>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Field label="العميل">
                <select value={selectedCustomerId} onChange={(e) => setSelectedCustomerId(e.target.value)} className="input-ui">
                  <option value="">اختر العميل</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="مندوب المبيعات">
                <select value={selectedSalesRepId} onChange={(e) => setSelectedSalesRepId(e.target.value)} className="input-ui">
                  <option value="">بدون مندوب</option>
                  {salesReps.map((rep) => (
                    <option key={rep.id} value={rep.id}>
                      {rep.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="تاريخ الفاتورة">
                <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="input-ui" />
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
                  value={paidAmount}
                  onChange={(e) => setPaidAmount(Number(e.target.value) || 0)}
                  className="input-ui"
                />
              </Field>

              {paymentMethod === 'installment' && (
                <>
                  <Field label="مدة التقسيط بالأشهر">
                    <input
                      type="number"
                      min="1"
                      value={installmentMonths}
                      onChange={(e) => setInstallmentMonths(Math.max(1, Number(e.target.value) || 1))}
                      className="input-ui"
                    />
                  </Field>
                  <Field label="تاريخ أول قسط">
                    <input
                      type="date"
                      value={firstInstallmentDate}
                      readOnly
                      className="input-ui"
                    />
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
                    value={lineProductId}
                    onChange={(e) => {
                      const product = products.find((entry) => entry.id === e.target.value);
                      setLineProductId(e.target.value);
                      setLineTax(product?.tax ?? settings.taxRate);
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
                    type="number"
                    min="1"
                    value={lineQuantity}
                    onChange={(e) => setLineQuantity(Math.max(1, Number(e.target.value) || 1))}
                    className="input-ui"
                  />
                </Field>

                <Field label="الخصم %">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={lineDiscount}
                    onChange={(e) => setLineDiscount(Number(e.target.value) || 0)}
                    className="input-ui"
                  />
                </Field>

                <Field label="الضريبة %">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={lineTax}
                    onChange={(e) => setLineTax(Number(e.target.value) || 0)}
                    className="input-ui"
                  />
                </Field>

                <div className="flex items-end">
                  <button
                    onClick={addLine}
                    className="inline-flex h-[50px] items-center gap-2 rounded-2xl bg-sky-600 px-4 font-bold text-white hover:bg-sky-700"
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
                  {showQuickProduct ? 'إخفاء الصنف السريع' : 'إضافة صنف سريع من نفس الشاشة'}
                </button>
                <span className="text-sm text-slate-500">
                  إذا الصنف غير موجود، أنشئه هنا وسيتم اعتباره حسب الطلب تلقائيًا.
                </span>
              </div>

              {showQuickProduct && (
                <div className="mt-4 rounded-[24px] border border-dashed border-sky-300 bg-white p-4">
                  <div className="mb-4">
                    <h4 className="font-bold text-slate-800">إدخال صنف سريع</h4>
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
                    <Field label="الباركود">
                      <input
                        type="text"
                        value={quickProduct.barcode}
                        onChange={(e) => setQuickProduct((current) => ({ ...current, barcode: e.target.value }))}
                        className="input-ui"
                        placeholder="اختياري"
                      />
                    </Field>
                    <Field label="سعر الشراء">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={quickProduct.purchasePrice}
                        onChange={(e) =>
                          setQuickProduct((current) => ({ ...current, purchasePrice: Number(e.target.value) || 0 }))
                        }
                        className="input-ui"
                      />
                    </Field>
                    <Field label="سعر البيع">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={quickProduct.salePrice}
                        onChange={(e) =>
                          setQuickProduct((current) => ({ ...current, salePrice: Number(e.target.value) || 0 }))
                        }
                        className="input-ui"
                      />
                    </Field>
                    <Field label="المورد المتوقع">
                      <select
                        value={quickProduct.supplierId}
                        onChange={(e) => setQuickProduct((current) => ({ ...current, supplierId: e.target.value }))}
                        className="input-ui"
                      >
                        <option value="">اختر المورد</option>
                        {suppliers.map((supplier) => (
                          <option key={supplier.id} value={supplier.id}>
                            {supplier.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>

                  <div className="mt-4 flex justify-end">
                    <button
                      type="button"
                      onClick={handleQuickProductSave}
                      className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2 font-bold text-white hover:bg-slate-800"
                    >
                      <Plus size={16} />
                      حفظ الصنف السريع
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-5 overflow-hidden rounded-[24px] border border-slate-200">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] bg-white">
                  <thead className="bg-slate-100 text-slate-700">
                    <tr>
                      <th className="px-4 py-3 text-right">الصنف</th>
                      <th className="px-4 py-3 text-right">النوع</th>
                      <th className="px-4 py-3 text-right">الكمية</th>
                      <th className="px-4 py-3 text-right">المتاح</th>
                      <th className="px-4 py-3 text-right">حالة التوريد</th>
                      <th className="px-4 py-3 text-right">الإجمالي</th>
                      <th className="px-4 py-3 text-right">إجراءات</th>
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
                              value={item.quantity}
                              onChange={(e) =>
                                updateLine(index, { quantity: Math.max(1, Number(e.target.value) || 1) })
                              }
                              className="w-24 rounded-xl border border-slate-200 px-3 py-2"
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

          {procurementRows.length > 0 && (
            <Panel title="3. شراء تلقائي من نفس الشاشة" icon={<ShoppingCart size={18} className="text-amber-600" />}>
              <div className="grid gap-5 xl:grid-cols-[260px_minmax(0,1fr)]">
                <div className="space-y-4">
                  <Field label="المورد الذي سيُنشأ له الشراء">
                    <select
                      value={procurementSupplierId}
                      onChange={(e) => setProcurementSupplierId(e.target.value)}
                      className="input-ui"
                    >
                      <option value="">اختر المورد</option>
                      {suppliers.map((supplier) => (
                        <option key={supplier.id} value={supplier.id}>
                          {supplier.name}
                        </option>
                      ))}
                    </select>
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
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 font-bold text-white hover:bg-emerald-700"
              >
                <Save size={18} />
                حفظ الفاتورة
              </button>
              <button
                onClick={resetForm}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-100 px-4 py-3 font-bold text-slate-700 hover:bg-slate-200"
              >
                <CalendarDays size={18} />
                فاتورة جديدة
              </button>
            </div>
          </Panel>

          {paymentMethod === 'installment' && (
            <Panel title="خطة الأقساط" icon={<CalendarDays size={18} className="text-violet-600" />}>
              <div className="space-y-3">
                {installmentPreview.map((entry) => (
                  <div
                    key={entry.monthIndex}
                    className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                  >
                    <div>
                      <p className="font-semibold text-slate-800">القسط {entry.monthIndex}</p>
                      <p className="text-xs text-slate-500">{entry.dueDate}</p>
                    </div>
                    <span className="font-bold text-violet-700">{formatCurrency(entry.amount)}</span>
                  </div>
                ))}
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
    <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-5 flex items-center gap-3">
        {icon}
        <h3 className="text-lg font-bold text-slate-800">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-bold text-slate-700">{label}</span>
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
