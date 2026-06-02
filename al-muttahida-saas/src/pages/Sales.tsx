import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Plus, Printer, Search, ShoppingBag, Trash2 } from 'lucide-react';
import { Customer, Product, Sale, SaleItem } from '../types';
import { createSale, getCustomers, getProducts, getSales } from '../lib/storage';
import { api, isApiMode } from '../lib/apiClient';
import { useAuth } from '../context/AuthContext';
import LegalDocumentsPrintModal from '../components/LegalDocumentsPrintModal';

export default function Sales() {
  const { settings, user } = useAuth();
  const [sales, setSales] = useState<Sale[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [formData, setFormData] = useState({
    customerId: '',
    customerName: '',
    notes: '',
  });
  const [saleItems, setSaleItems] = useState<SaleItem[]>([]);
  const [printingSale, setPrintingSale] = useState<Sale | null>(null);

  const mapApiSale = (row: any): Sale => ({
    id: row.id,
    invoiceNumber: row.invoice_number,
    customerId: row.customer_id,
    customerName: row.customer_name,
    items: [],
    subtotal: Number(row.total || 0),
    discount: 0,
    tax: 0,
    total: Number(row.total || 0),
    paid: Number(row.paid || 0),
    remaining: Number(row.remaining || 0),
    status: row.status,
    date: row.date,
    notes: undefined,
    createdBy: row.created_by || 'system',
    createdAt: row.created_at || new Date().toISOString(),
    version: row.version,
    locked: !!row.locked,
    lastEditedBy: row.last_edited_by || undefined,
    lastEditedAt: row.last_edited_at || undefined,
  });

  const loadData = async () => {
    setSales(isApiMode() ? (await api.listSales()).map(mapApiSale).reverse() : getSales().slice().reverse());
    setCustomers(getCustomers());
    setProducts(getProducts());
  };

  useEffect(() => {
    void loadData();
  }, []);

  const formatCurrency = (amount: number) =>
    `${new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(amount)} ${settings.currency}`;

  const calculateTotals = () => {
    const subtotal = saleItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    const totalDiscount = saleItems.reduce((sum, item) => sum + item.discount * item.quantity, 0);
    const totalTax = saleItems.reduce((sum, item) => sum + item.tax * item.quantity, 0);
    const total = subtotal - totalDiscount + totalTax;
    return { subtotal, totalDiscount, totalTax, total };
  };

  const addItem = (product: Product) => {
    if (product.fulfillmentType === 'on_demand' && product.quantity <= 0) {
      setMessage({
        type: 'error',
        text: `الصنف "${product.name}" مسجل كـ حسب الطلب ولم يدخل المخزن بعد. اشتره أولًا من المشتريات ثم أكمل البيع.`,
      });
      return;
    }

    const existingItem = saleItems.find((item) => item.productId === product.id);
    const nextQuantity = existingItem ? existingItem.quantity + 1 : 1;

    if (product.quantity < nextQuantity) {
      setMessage({
        type: 'error',
        text: `الكمية المتاحة من "${product.name}" هي ${product.quantity} فقط.`,
      });
      return;
    }

    if (existingItem) {
      setSaleItems((current) =>
        current.map((item) =>
          item.productId === product.id
            ? {
                ...item,
                quantity: nextQuantity,
                total: nextQuantity * item.unitPrice - nextQuantity * item.discount + nextQuantity * item.tax,
              }
            : item,
        ),
      );
    } else {
      const taxValue = (product.salePrice - product.discount) * (product.tax / 100);
      setSaleItems((current) => [
        ...current,
        {
          productId: product.id,
          productName: product.name,
          barcode: product.barcode,
          quantity: 1,
          unitPrice: product.salePrice,
          discount: product.discount,
          tax: taxValue,
          total: product.salePrice - product.discount + taxValue,
        },
      ]);
    }

    setMessage(null);
  };

  const updateItemQuantity = (productId: string, quantity: number) => {
    const product = products.find((entry) => entry.id === productId);
    if (!product) return;

    if (quantity <= 0) {
      setSaleItems((current) => current.filter((item) => item.productId !== productId));
      return;
    }

    if (quantity > product.quantity) {
      setMessage({
        type: 'error',
        text: `لا يمكن بيع ${quantity} من "${product.name}" لأن المتاح ${product.quantity} فقط.`,
      });
      return;
    }

    setSaleItems((current) =>
      current.map((item) =>
        item.productId === productId
          ? {
              ...item,
              quantity,
              total: quantity * item.unitPrice - quantity * item.discount + quantity * item.tax,
            }
          : item,
      ),
    );
    setMessage(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!formData.customerId) {
      setMessage({ type: 'error', text: 'اختر العميل أولاً.' });
      return;
    }

    if (saleItems.length === 0) {
      setMessage({ type: 'error', text: 'أضف صنفًا واحدًا على الأقل قبل الحفظ.' });
      return;
    }

    const hasStockProblem = saleItems.some((item) => {
      const product = products.find((entry) => entry.id === item.productId);
      return !product || product.quantity < item.quantity;
    });

    if (hasStockProblem) {
      setMessage({ type: 'error', text: 'يوجد صنف لا يملك كمية كافية. راجع المخزن أو نفذ شراء أولًا.' });
      return;
    }

    const totals = calculateTotals();
    if (isApiMode()) {
      await api.createSale({
        customerId: formData.customerId,
        customerName: formData.customerName,
        invoiceNumber: `INV-${Date.now()}`,
        total: totals.total,
        paid: 0,
        date: new Date().toISOString().slice(0, 10),
      });
      await loadData();
      setShowModal(false);
      setSaleItems([]);
      setFormData({ customerId: '', customerName: '', notes: '' });
      setMessage({ type: 'success', text: 'تم حفظ عملية البيع بنجاح.' });
      return;
    }
    createSale({
      customerId: formData.customerId,
      customerName: formData.customerName,
      items: saleItems,
      subtotal: totals.subtotal,
      discount: totals.totalDiscount,
      tax: totals.totalTax,
      total: totals.total,
      paid: 0,
      remaining: totals.total,
      status: 'pending',
      date: new Date().toISOString(),
      notes: formData.notes,
      createdBy: user?.name || 'مدير النظام',
    });

    await loadData();
    setShowModal(false);
    setSaleItems([]);
    setFormData({ customerId: '', customerName: '', notes: '' });
    setMessage({ type: 'success', text: 'تم حفظ عملية البيع بنجاح.' });
  };

  const filteredSales = useMemo(
    () =>
      sales.filter(
        (sale) =>
          sale.invoiceNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
          sale.customerName.toLowerCase().includes(searchTerm.toLowerCase()),
      ),
    [sales, searchTerm],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">المبيعات</h2>
          <p className="mt-1 text-sm text-slate-500">النظام يمنع الآن بيع الصنف حسب الطلب قبل إدخاله للمخزن.</p>
        </div>
        <button onClick={() => setShowModal(true)} className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-700">
          <Plus size={18} />
          إضافة عملية بيع
        </button>
      </div>

      {message && (
        <div className={`rounded-2xl border px-4 py-3 text-sm ${message.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>
          {message.text}
        </div>
      )}

      <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="relative">
          <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="بحث بالفاتورة أو العميل" className="input-ui pr-10" />
        </div>
      </div>

      <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px]">
            <thead className="bg-slate-100">
              <tr>
                <th className="px-4 py-4 text-right text-sm font-bold text-slate-700">رقم الفاتورة</th>
                <th className="px-4 py-4 text-right text-sm font-bold text-slate-700">العميل</th>
                <th className="px-4 py-4 text-right text-sm font-bold text-slate-700">التاريخ</th>
                <th className="px-4 py-4 text-right text-sm font-bold text-slate-700">الإجمالي</th>
                <th className="px-4 py-4 text-right text-sm font-bold text-slate-700">الحالة</th>
                <th className="px-4 py-4 text-right text-sm font-bold text-slate-700">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredSales.map((sale) => (
                <tr key={sale.id} className="hover:bg-slate-50">
                  <td className="px-4 py-4 font-mono font-bold text-sky-700">{sale.invoiceNumber}</td>
                  <td className="px-4 py-4 font-medium text-slate-800">{sale.customerName}</td>
                  <td className="px-4 py-4 text-slate-600">{new Date(sale.date).toLocaleDateString('ar-EG')}</td>
                  <td className="px-4 py-4 font-bold text-emerald-700">{formatCurrency(sale.total)}</td>
                  <td className="px-4 py-4">
                    <span className={`rounded-full px-3 py-1 text-xs font-bold ${sale.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                      {sale.status === 'completed' ? 'مكتملة' : 'معلقة'}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <button
                      onClick={() => setPrintingSale(sale)}
                      className="rounded-xl p-2 text-slate-600 hover:bg-slate-100"
                    >
                      <Printer size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-5xl rounded-[28px] bg-white shadow-2xl">
            <div className="rounded-t-[28px] bg-gradient-to-r from-emerald-600 to-green-600 p-6 text-white">
              <h3 className="text-xl font-bold">إضافة عملية بيع</h3>
            </div>

            <form onSubmit={handleSubmit} className="p-6">
              <div className="grid gap-6 lg:grid-cols-2">
                <div>
                  <h4 className="mb-4 flex items-center gap-2 font-bold text-slate-800">
                    <ShoppingBag size={18} className="text-emerald-600" />
                    الأصناف
                  </h4>
                  <div className="grid max-h-96 grid-cols-2 gap-3 overflow-y-auto">
                    {products.map((product) => (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => addItem(product)}
                        className="rounded-2xl border border-slate-200 p-3 text-right hover:border-emerald-400 hover:bg-emerald-50"
                      >
                        <p className="font-semibold text-slate-800">{product.name}</p>
                        <p className="text-xs text-slate-500">{product.barcode}</p>
                        <p className="mt-1 font-bold text-emerald-700">{formatCurrency(product.salePrice)}</p>
                        <div className="mt-2 flex items-center justify-between text-xs">
                          <span className={`rounded-full px-2 py-1 ${product.fulfillmentType === 'on_demand' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                            {product.fulfillmentType === 'on_demand' ? 'حسب الطلب' : 'مخزني'}
                          </span>
                          <span className="text-slate-500">المتاح: {product.quantity}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                    إذا كان الصنف "حسب الطلب" والكمية صفر، اشتره أولًا من شاشة المشتريات ليُسجَّل في المخزن، ثم أكمل البيع.
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-bold text-slate-700">العميل</label>
                    <select
                      value={formData.customerId}
                      onChange={(e) => {
                        const customer = customers.find((entry) => entry.id === e.target.value);
                        setFormData({ ...formData, customerId: e.target.value, customerName: customer?.name || '', notes: formData.notes });
                      }}
                      className="input-ui"
                    >
                      <option value="">اختر العميل</option>
                      {customers.map((customer) => (
                        <option key={customer.id} value={customer.id}>{customer.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <h4 className="mb-2 font-bold text-slate-800">الأصناف المختارة</h4>
                    <div className="space-y-2">
                      {saleItems.map((item) => (
                        <div key={item.productId} className="flex items-center gap-3 rounded-2xl bg-slate-50 p-3">
                          <div className="flex-1">
                            <p className="font-medium text-slate-800">{item.productName}</p>
                            <p className="text-xs text-slate-500">{formatCurrency(item.unitPrice)}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <button type="button" onClick={() => updateItemQuantity(item.productId, item.quantity - 1)} className="h-8 w-8 rounded bg-slate-200">-</button>
                            <span className="w-8 text-center">{item.quantity}</span>
                            <button type="button" onClick={() => updateItemQuantity(item.productId, item.quantity + 1)} className="h-8 w-8 rounded bg-slate-200">+</button>
                          </div>
                          <button type="button" onClick={() => setSaleItems((current) => current.filter((entry) => entry.productId !== item.productId))} className="rounded-lg p-1 text-rose-600 hover:bg-rose-50">
                            <Trash2 size={16} />
                          </button>
                          <span className="w-20 text-left font-bold text-emerald-700">{formatCurrency(item.total)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2 border-t border-slate-200 pt-4">
                    <div className="flex justify-between text-slate-600">
                      <span>المجموع الفرعي</span>
                      <span>{formatCurrency(calculateTotals().subtotal)}</span>
                    </div>
                    <div className="flex justify-between text-rose-600">
                      <span>الخصم</span>
                      <span>- {formatCurrency(calculateTotals().totalDiscount)}</span>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>الضريبة</span>
                      <span>{formatCurrency(calculateTotals().totalTax)}</span>
                    </div>
                    <div className="flex justify-between border-t border-slate-200 pt-2 text-xl font-bold text-emerald-700">
                      <span>الإجمالي</span>
                      <span>{formatCurrency(calculateTotals().total)}</span>
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-bold text-slate-700">ملاحظات</label>
                    <textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} rows={3} className="input-ui resize-none" />
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button type="button" onClick={() => { setShowModal(false); setSaleItems([]); }} className="flex-1 rounded-2xl border border-slate-300 px-4 py-3 text-slate-700 hover:bg-slate-50">
                      إلغاء
                    </button>
                    <button type="submit" className="flex-1 rounded-2xl bg-emerald-600 px-4 py-3 font-bold text-white hover:bg-emerald-700">
                      حفظ البيع
                    </button>
                  </div>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
      
      {printingSale && (
        <LegalDocumentsPrintModal
          isOpen={!!printingSale}
          onClose={() => setPrintingSale(null)}
          sale={printingSale}
        />
      )}
    </div>
  );
}
