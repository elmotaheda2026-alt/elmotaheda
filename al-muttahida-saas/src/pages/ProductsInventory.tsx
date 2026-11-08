import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Package,
  Search,
  Plus,
  Edit,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Boxes,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useDialog } from '../context/DialogContext';
import { isAdmin } from '../lib/permissions';
import { Product } from '../types';
import { getProducts, createProduct, updateProduct, deleteProduct, getSales } from '../lib/storage';
import { formatWholeCurrency } from '../lib/utils';
import { api, isApiMode } from '../lib/apiClient';

const PRODUCT_RENDER_LIMIT = 100;

export default function ProductsInventory() {
  const { settings, user } = useAuth();
  const { confirmDialog, showToast } = useDialog();
  const canDelete = isAdmin(user) && user?.role !== 'manager';
  const [products, setProducts] = useState<Product[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTypeFilter, setActiveTypeFilter] = useState<'all' | 'stocked' | 'on_demand' | 'low_stock'>('all');
  const [showModal, setShowModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [visibleLimit, setVisibleLimit] = useState(PRODUCT_RENDER_LIMIT);
  const didLoadRef = useRef(false);
  const pendingRenderMeasureRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState<{
    name: string;
    unit: string;
    quantity: number | '';
    purchasePrice: number | '';
    salePrice: number | '';
    description: string;
  }>({
    name: '',
    unit: 'قطعة',
    quantity: 1,
    purchasePrice: '',
    salePrice: '',
    description: '',
  });

  const loadData = async () => {
    try {
      const data = isApiMode() ? await api.listProducts() : getProducts();
      const normalized = data.map((product: Product) => ({
        ...product,
        fulfillmentType: product.fulfillmentType || 'on_demand',
      }));
      pendingRenderMeasureRef.current = true;
      setProducts(normalized);
    } catch (err) {
      console.error('Failed to load products:', err);
    }
  };

  useEffect(() => {
    if (didLoadRef.current) return;
    didLoadRef.current = true;
    void loadData();
  }, []);

  useEffect(() => {
    if (!pendingRenderMeasureRef.current) return;
    pendingRenderMeasureRef.current = false;
  });

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F2') {
        event.preventDefault();
        resetForm();
        setEditingProduct(null);
        setShowModal(true);
      }
      if (event.key === 'F5') {
        event.preventDefault();
        void loadData();
      }
      if (event.key === 'Escape' && showModal) {
        setShowModal(false);
        setEditingProduct(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showModal]);

  const stats = useMemo(() => {
    const total = products.length;
    const stocked = products.filter((p) => p.fulfillmentType === 'stocked').length;
    const onDemand = products.filter((p) => p.fulfillmentType === 'on_demand').length;
    const lowStock = products.filter(
      (p) => p.fulfillmentType === 'stocked' && Number(p.quantity || 0) <= 0,
    ).length;
    return { total, stocked, onDemand, lowStock };
  }, [products]);

  const filteredProducts = useMemo(() => {
    let list = products;

    if (activeTypeFilter === 'stocked') {
      list = list.filter((p) => p.fulfillmentType === 'stocked');
    } else if (activeTypeFilter === 'on_demand') {
      list = list.filter((p) => p.fulfillmentType === 'on_demand');
    } else if (activeTypeFilter === 'low_stock') {
      list = list.filter(
        (p) => p.fulfillmentType === 'stocked' && Number(p.quantity || 0) <= 0,
      );
    }

    const term = searchTerm.trim().toLowerCase();
    if (!term) return list;

    return list.filter(
      (product) =>
        product.name.toLowerCase().includes(term) ||
        (product.barcode || '').toLowerCase().includes(term),
    );
  }, [products, searchTerm, activeTypeFilter]);

  const visibleProducts = useMemo(
    () => filteredProducts.slice(0, visibleLimit),
    [filteredProducts, visibleLimit],
  );

  const formatCurrency = (amount: number) => formatWholeCurrency(amount, settings.currency);

  const numPurchasePrice = Number(formData.purchasePrice) || 0;
  const numSalePrice = Number(formData.salePrice) || 0;
  const numQuantity = Number(formData.quantity) || 0;

  const cashMargin = numSalePrice - numPurchasePrice;
  const cashMarginPercent =
    numPurchasePrice > 0 ? ((cashMargin / numPurchasePrice) * 100).toFixed(1) : '0';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      alert('يرجى كتابة اسم الصنف');
      return;
    }

    if (numSalePrice < numPurchasePrice && numPurchasePrice > 0) {
      alert(
        `سعر البيع (${numSalePrice} ج) لا يمكن أن يكون أقل من سعر الشراء والتكلفة (${numPurchasePrice} ج) للأصناف المخزنية لمنع البيع بخسارة.`,
      );
      return;
    }

    const productData = {
      name: formData.name.trim(),
      barcode: editingProduct?.barcode || undefined, // Auto-generated by backend if new
      category: editingProduct?.category || 'عام',
      unit: formData.unit.trim() || 'قطعة',
      fulfillmentType: 'stocked' as const, // Always stocked when added from this modal
      quantity: Math.max(0, numQuantity),
      minQuantity: 0,
      purchasePrice: numPurchasePrice,
      salePrice: numSalePrice,
      discount: 0,
      tax: settings.taxRate || 0,
      description: formData.description.trim() || undefined,
    };

    try {
      if (editingProduct) {
        await updateProduct(editingProduct.id, productData);
      } else {
        await createProduct(productData);
      }
      await loadData();
      setShowModal(false);
      setEditingProduct(null);
      resetForm();
    } catch (err: any) {
      console.error('Error saving product:', err);
      alert(err?.message || 'حدث خطأ أثناء حفظ الصنف في المخزن.');
    }
  };

  const handleEdit = async (product: Product) => {
    const fullProduct = isApiMode() ? ((await api.getProduct(product.id)) as Product) : product;
    setEditingProduct(fullProduct);
    setFormData({
      name: fullProduct.name,
      unit: fullProduct.unit || product.unit || 'قطعة',
      quantity: Number(fullProduct.quantity || product.quantity || 0),
      purchasePrice: Number(fullProduct.purchasePrice || 0) || '',
      salePrice: Number(fullProduct.salePrice || 0) || '',
      description: fullProduct.description || '',
    });
    setShowModal(true);
  };

  const productIdsWithActiveSales = useMemo(() => {
    const allSales = getSales();
    const idSet = new Set<string>();
    const nameSet = new Set<string>();
    for (const s of allSales) {
      if (s.status !== 'cancelled' && Array.isArray(s.items)) {
        for (const item of s.items) {
          if (item.productId) idSet.add(item.productId);
          if (item.productName) nameSet.add(item.productName.trim().toLowerCase());
        }
      }
    }
    return { idSet, nameSet };
  }, [products]);

  const handleDelete = async (id: string) => {
    const product = products.find(p => p.id === id);
    const allSales = getSales();
    const linkedSales = allSales.filter(
      (s) =>
        s.status !== 'cancelled' &&
        Array.isArray(s.items) &&
        s.items.some(
          (item) =>
            item.productId === id ||
            (product && item.productName?.trim().toLowerCase() === product.name?.trim().toLowerCase())
        )
    );

    if (linkedSales.length > 0) {
      await confirmDialog({
        title: 'لا يمكن حذف الصنف',
        message: `لا يمكن حذف الصنف "${product?.name || ''}" لوجود (${linkedSales.length}) فاتورة مبيعات سارية تتضمن هذا الصنف.`,
        subMessage: `منها فاتورة رقم (${linkedSales[0].invoiceNumber}). لحذف الصنف، يجب إلغاء أو حذف الفواتير السارية المرتبطة به أولاً لحماية سلامة المخزون والحسابات.`,
        confirmText: 'حسناً، فهمت',
        type: 'danger',
      });
      return;
    }

    const isConfirmed = await confirmDialog({
      title: 'تأكيد حذف الصنف',
      message: 'هل أنت متأكد من حذف هذا الصنف من المخزن؟',
      subMessage: 'سيتم مسح بيانات الصنف وتاريخ حركاته المخزنية نهائياً.',
      confirmText: 'نعم، حذف الصنف',
      cancelText: 'إلغاء',
      type: 'danger',
    });
    if (isConfirmed) {
      try {
        await deleteProduct(id);
        await loadData();
        showToast('تم حذف الصنف من المخزن بنجاح', 'success');
      } catch (err: any) {
        console.error('Error deleting product:', err);
        showToast(err?.message || 'حدث خطأ أثناء حذف الصنف.', 'error');
      }
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      unit: 'قطعة',
      quantity: 1,
      purchasePrice: '',
      salePrice: '',
      description: '',
    });
  };

  return (
    <div className="desktop-view-container">
      {/* COMPACT HEADER & TOOLBAR */}
      <section className="erp-action-bar shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-3 w-full">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-lg font-black text-slate-900 shrink-0">كتالوج الأصناف والمخزن</h2>
            <div className="relative min-w-[260px] max-w-sm">
              <Search size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="text"
                ref={searchInputRef}
                autoFocus
                value={searchTerm}
                onChange={(event) => {
                  setSearchTerm(event.target.value);
                  setVisibleLimit(PRODUCT_RENDER_LIMIT);
                }}
                placeholder="بحث باسم الصنف أو الكود..."
                className="input-ui h-10 w-full pr-10 pl-3.5 text-xs font-bold bg-white border-slate-300 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 text-slate-900 shadow-2xs placeholder:text-slate-400"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Filter Pills */}
            <div className="inline-flex rounded-xl bg-slate-100 p-1 text-xs font-bold border border-slate-200">
              <button
                type="button"
                onClick={() => {
                  setActiveTypeFilter('all');
                  setVisibleLimit(PRODUCT_RENDER_LIMIT);
                }}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  activeTypeFilter === 'all'
                    ? 'bg-white text-blue-700 shadow-2xs font-black'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                الكل ({stats.total})
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTypeFilter('stocked');
                  setVisibleLimit(PRODUCT_RENDER_LIMIT);
                }}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  activeTypeFilter === 'stocked'
                    ? 'bg-white text-blue-700 shadow-2xs font-black'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                أصناف المخزن ({stats.stocked})
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTypeFilter('on_demand');
                  setVisibleLimit(PRODUCT_RENDER_LIMIT);
                }}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  activeTypeFilter === 'on_demand'
                    ? 'bg-white text-blue-700 shadow-2xs font-black'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                حسب الطلب ({stats.onDemand})
              </button>
              {stats.lowStock > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setActiveTypeFilter('low_stock');
                    setVisibleLimit(PRODUCT_RENDER_LIMIT);
                  }}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    activeTypeFilter === 'low_stock'
                      ? 'bg-rose-600 text-white shadow-2xs font-black'
                      : 'text-rose-600 hover:text-rose-800'
                  }`}
                >
                  نواقص ({stats.lowStock})
                </button>
              )}
            </div>

            {user?.role !== 'manager' && (
              <button
                onClick={() => {
                  resetForm();
                  setEditingProduct(null);
                  setShowModal(true);
                }}
                className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl hover:bg-blue-700 transition-colors text-xs font-black shadow-sm cursor-pointer"
              >
                <Plus size={16} />
                <span>+ إضافة صنف للمخزن</span>
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Flexible & Scrollable Products Table Card */}
      <section className="desktop-table-card">
        <div className="desktop-table-scroll">
          <table className="w-full min-w-[750px] border-collapse">
            <thead className="desktop-sticky-header">
              <tr>
                <th className="py-3 px-4 text-right font-black text-slate-800">الصنف / الكود</th>
                <th className="py-3 px-4 text-right font-black text-slate-800">الوحدة</th>
                <th className="py-3 px-4 text-center font-black text-slate-800">المخزون</th>
                <th className="py-3 px-4 text-right font-black text-slate-800">تكلفة الشراء</th>
                <th className="py-3 px-4 text-right font-black text-slate-800">سعر البيع</th>
                <th className="py-3 px-4 text-center font-black text-slate-800">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-14 px-4 text-center text-slate-400 text-xs font-bold">
                    <Package size={40} className="mx-auto mb-2 text-slate-300" />
                    <p className="text-sm font-bold text-slate-600">لا توجد أصناف مطابقة للبحث أو الفلتر</p>
                  </td>
                </tr>
              ) : (
                visibleProducts.map((product) => {
                  const isStocked = product.fulfillmentType === 'stocked';
                  const qty = Number(product.quantity || 0);

                  return (
                    <tr
                      key={product.id}
                      onDoubleClick={() => user?.role !== 'manager' && handleEdit(product)}
                      title={user?.role !== 'manager' ? 'انقر مرتين للتعديل' : ''}
                      className="group cursor-pointer hover:bg-slate-50 transition-colors"
                    >
                      <td className="py-3 px-4">
                        <div>
                          <p className="font-black text-slate-900 text-xs sm:text-sm group-hover:text-blue-700 transition-colors">
                            {product.name}
                          </p>
                          <span className="text-[11px] font-mono text-slate-400 font-bold">
                            {product.barcode || '---'}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs font-semibold text-slate-700">
                        {product.unit || 'قطعة'}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {isStocked ? (
                          qty > 0 ? (
                            <span className="inline-flex items-center px-3 py-0.5 rounded-full text-xs font-black text-emerald-800 bg-emerald-100 border border-emerald-300 shadow-2xs">
                              {qty} {product.unit || 'قطعة'}
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-3 py-0.5 rounded-full text-xs font-black text-rose-800 bg-rose-100 border border-rose-300 shadow-2xs">
                              0 (نافد)
                            </span>
                          )
                        ) : (
                          <span className="text-slate-400 font-bold text-xs">
                            حسب الطلب
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs sm:text-sm font-black text-slate-800 whitespace-nowrap">
                        {formatCurrency(product.purchasePrice)}
                      </td>
                      <td className="py-3 px-4 text-xs sm:text-sm font-black text-blue-700 whitespace-nowrap">
                        {formatCurrency(product.salePrice)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="erp-icon-actions">
                          {user?.role !== 'manager' && (
                            <button
                              onClick={() => handleEdit(product)}
                              className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                              title="تعديل الصنف والمخزون"
                            >
                              <Edit size={16} />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              onClick={() => handleDelete(product.id)}
                              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                                productIdsWithActiveSales.idSet.has(product.id) || productIdsWithActiveSales.nameSet.has(product.name.trim().toLowerCase())
                                  ? 'text-slate-400 hover:text-rose-600 hover:bg-slate-100'
                                  : 'text-rose-600 hover:bg-rose-50'
                              }`}
                              title={
                                productIdsWithActiveSales.idSet.has(product.id) || productIdsWithActiveSales.nameSet.has(product.name.trim().toLowerCase())
                                  ? 'مرتبط بفواتير بيع سارية (لا يمكن الحذف)'
                                  : 'حذف الصنف'
                              }
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                          {user?.role === 'manager' && (
                            <span className="text-xs text-slate-400 font-bold">—</span>
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

        {/* Desktop Sticky Status & Pagination Banner */}
        <div className="erp-status-bar shrink-0">
          <div className="flex items-center gap-4 flex-wrap text-xs">
            <span className="font-bold text-slate-700">
              إجمالي الأصناف: <span className="text-blue-700 font-extrabold">{products.length}</span> (المعروض:{' '}
              {visibleProducts.length})
            </span>
            <span className="w-px h-3.5 bg-slate-300"></span>
            <span className="font-bold text-slate-700">
              أصناف بالمخزن: <span className="text-blue-700 font-extrabold">{stats.stocked}</span>
            </span>
            <span className="w-px h-3.5 bg-slate-300"></span>
            <span className="font-bold text-slate-700">
              حسب الطلب: <span className="text-slate-900 font-extrabold">{stats.onDemand}</span>
            </span>
            {stats.lowStock > 0 && (
              <>
                <span className="w-px h-3.5 bg-slate-300"></span>
                <span className="font-bold text-rose-600">
                  نواقص المخزن: <span className="font-extrabold">{stats.lowStock}</span>
                </span>
              </>
            )}
          </div>

          {filteredProducts.length > visibleProducts.length && (
            <button
              type="button"
              onClick={() => setVisibleLimit((limit) => limit + PRODUCT_RENDER_LIMIT)}
              className="rounded-lg border border-slate-200 bg-white px-3.5 py-1 text-xs font-bold text-slate-700 shadow-2xs hover:bg-slate-100 hover:text-blue-600 transition-colors"
            >
              عرض المزيد ({filteredProducts.length - visibleProducts.length})
            </button>
          )}
        </div>
      </section>

      {/* High-Contrast Dedicated Warehouse Product Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden border border-slate-300 animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-800 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-600/30 text-blue-400 border border-blue-500/30 flex items-center justify-center">
                  <Boxes size={22} />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-black text-white">
                    {editingProduct ? `تعديل صنف المخزن` : 'إضافة صنف جديد للمخزن'}
                  </h3>
                  <p className="text-xs text-slate-300 font-semibold mt-0.5">
                    {editingProduct && editingProduct.barcode
                      ? `كود الصنف: ${editingProduct.barcode}`
                      : 'الكود يتولد تلقائياً ويتسجل برصيد المستودع'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="w-8 h-8 rounded-lg bg-white/10 text-white hover:bg-white/20 flex items-center justify-center text-sm font-bold transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[85vh] overflow-y-auto text-right" dir="rtl">
              {/* Product Name */}
              <div>
                <label className="block text-sm font-black text-slate-900 mb-1.5">
                  اسم الصنف بالمخزن <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="اكتب اسم الصنف (مثال: شاشة 55 LG سمارت، توكتوك، هاتف سامسونج...)"
                  className="w-full h-11 px-3.5 text-sm font-bold text-slate-900 bg-white border border-slate-300 rounded-xl focus:border-blue-600 focus:ring-4 focus:ring-blue-100 transition-all placeholder:text-slate-400 shadow-2xs"
                  required
                  autoFocus
                />
              </div>

              {/* Quantity & Unit in a clean 2-column row */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-black text-slate-900 mb-1.5">
                    الكمية المتوفرة بالمخزن <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={formData.quantity}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        quantity: e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value, 10) || 0),
                      })
                    }
                    placeholder="1"
                    className="w-full h-11 px-3.5 text-base font-black text-blue-700 bg-blue-50/40 border border-blue-300 rounded-xl focus:border-blue-600 focus:ring-4 focus:ring-blue-100 transition-all shadow-2xs"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-black text-slate-900 mb-1.5">
                    الوحدة <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.unit}
                    onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                    placeholder="قطعة، كرتونة، جهاز..."
                    className="w-full h-11 px-3.5 text-sm font-bold text-slate-900 bg-white border border-slate-300 rounded-xl focus:border-blue-600 focus:ring-4 focus:ring-blue-100 transition-all shadow-2xs"
                    required
                  />
                </div>
              </div>

              {/* Pricing & Profit Section */}
              <div className="p-4.5 rounded-2xl bg-slate-50 border-2 border-slate-200/80 space-y-3.5">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <span className="text-sm font-black text-slate-900">أسعار التكلفة والبيع</span>
                  <span className="text-xs font-bold text-slate-500">بالجنيه المصري</span>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-black text-slate-700 mb-1.5">
                      تكلفة الشراء (التكلفة / الجملة) <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={formData.purchasePrice}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          purchasePrice: e.target.value === '' ? '' : parseFloat(e.target.value) || 0,
                        })
                      }
                      placeholder="0.00"
                      className="w-full h-11 px-3.5 text-sm font-black text-slate-900 bg-white border border-slate-300 rounded-xl focus:border-blue-600 focus:ring-4 focus:ring-blue-100 transition-all shadow-2xs"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-black text-slate-700 mb-1.5">
                      سعر البيع الكاش (الأساسي) <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={formData.salePrice}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          salePrice: e.target.value === '' ? '' : parseFloat(e.target.value) || 0,
                        })
                      }
                      placeholder="0.00"
                      className="w-full h-11 px-3.5 text-sm font-black text-blue-700 bg-white border border-slate-300 rounded-xl focus:border-blue-600 focus:ring-4 focus:ring-blue-100 transition-all shadow-2xs"
                      required
                    />
                  </div>
                </div>

                {/* Real-time Profit Margin Indicator */}
                {numPurchasePrice > 0 && numSalePrice > 0 && (
                  <div className="pt-1">
                    {cashMargin > 0 ? (
                      <div className="p-3 rounded-xl bg-emerald-100/70 border border-emerald-300 text-emerald-950 flex items-center justify-between">
                        <span className="text-xs font-black flex items-center gap-1.5">
                          <CheckCircle2 size={16} className="text-emerald-700" />
                          هامش الربح التجاري الكاش:
                        </span>
                        <span className="text-sm font-black text-emerald-800">
                          +{formatCurrency(cashMargin)} ({cashMarginPercent}%)
                        </span>
                      </div>
                    ) : cashMargin === 0 ? (
                      <div className="p-2.5 rounded-xl bg-amber-100/70 border border-amber-300 text-amber-950 text-xs font-bold flex items-center gap-2">
                        <AlertTriangle size={15} className="text-amber-700 shrink-0" />
                        <span>سعر البيع مساوٍ لسعر الشراء (هامش ربح الكاش = 0 ج).</span>
                      </div>
                    ) : (
                      <div className="p-2.5 rounded-xl bg-rose-100/80 border border-rose-300 text-rose-950 text-xs font-bold flex items-center gap-2">
                        <AlertTriangle size={15} className="text-rose-700 shrink-0" />
                        <span>تحذير: سعر البيع أقل من الشراء (خسارة {formatCurrency(Math.abs(cashMargin))})!</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  ملاحظات أو مواصفات (اختياري)
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="أي تفاصيل خاصة بالصنف، الموديل، اللون..."
                  className="w-full p-3 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-xl focus:border-blue-600 focus:ring-4 focus:ring-blue-100 transition-all"
                  rows={2}
                />
              </div>

              {/* Form Action Buttons */}
              <div className="flex items-center gap-3 pt-3 border-t border-slate-200">
                <button
                  type="submit"
                  className="flex-1 h-12 bg-blue-600 hover:bg-blue-700 text-white font-black text-sm rounded-xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <CheckCircle2 size={18} />
                  <span>{editingProduct ? 'حفظ تعديلات الصنف' : 'حفظ الصنف في المخزن'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-6 h-12 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm rounded-xl transition-all cursor-pointer"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
