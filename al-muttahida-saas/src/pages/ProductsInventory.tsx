import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Package, Search, Plus, Edit, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { isAdmin } from '../lib/permissions';
import { Product } from '../types';
import { getProducts, createProduct, updateProduct, deleteProduct } from '../lib/storage';
import { formatWholeCurrency } from '../lib/utils';
import { api, isApiMode } from '../lib/apiClient';

const PRODUCT_RENDER_LIMIT = 100;

export default function ProductsInventory() {
  const { settings, user } = useAuth();
  const canDelete = isAdmin(user);
  const [products, setProducts] = useState<Product[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [visibleLimit, setVisibleLimit] = useState(PRODUCT_RENDER_LIMIT);
  const didLoadRef = useRef(false);
  const pendingRenderMeasureRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  
  const [formData, setFormData] = useState({
    name: '',
    barcode: '',
    category: 'عام',
    unit: 'قطعة',
    purchasePrice: 0,
    salePrice: 0,
    description: '',
  });

  const loadData = async () => {
    console.time('ProductsInventory.totalLoad');
    try {
      console.time('ProductsInventory.networkApiCall');
      const data = isApiMode() ? await api.listProducts() : getProducts();
      console.timeEnd('ProductsInventory.networkApiCall');
      const payloadBytes = new Blob([JSON.stringify(data)]).size;
      console.info(`ProductsInventory payload: ${payloadBytes} bytes for ${data.length} rows`);

      console.time('ProductsInventory.transformAndState');
      const normalized = data.map((product: Product) => ({
        ...product,
        fulfillmentType: product.fulfillmentType || 'stocked',
      }));
      pendingRenderMeasureRef.current = true;
      console.time('ProductsInventory.initialRenderCommit');
      setProducts(normalized);
      console.timeEnd('ProductsInventory.transformAndState');
    } catch (err) {
      console.error('Failed to load products:', err);
    } finally {
      console.timeEnd('ProductsInventory.totalLoad');
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
    requestAnimationFrame(() => {
      console.timeEnd('ProductsInventory.initialRenderCommit');
    });
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

  const filteredProducts = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return products;

    return products.filter((product) =>
      product.name.toLowerCase().includes(term) ||
      (product.barcode || '').toLowerCase().includes(term) ||
      (product.category || '').toLowerCase().includes(term),
    );
  }, [products, searchTerm]);

  const visibleProducts = useMemo(
    () => filteredProducts.slice(0, visibleLimit),
    [filteredProducts, visibleLimit],
  );

  const formatCurrency = (amount: number) => formatWholeCurrency(amount, settings.currency);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const productData = {
      name: formData.name.trim(),
      barcode: formData.barcode.trim() || undefined,
      category: formData.category.trim(),
      unit: formData.unit.trim(),
      purchasePrice: formData.purchasePrice,
      salePrice: formData.salePrice,
      fulfillmentType: 'on_demand' as const,
      quantity: 0,
      minQuantity: 0,
      discount: 0,
      tax: settings.taxRate,
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
    } catch (err) {
      console.error('Error saving product:', err);
      alert('حدث خطأ أثناء حفظ الصنف.');
    }
  };

  const handleEdit = async (product: Product) => {
    console.time('ProductsInventory.editDetailFetch');
    const fullProduct = isApiMode() ? await api.getProduct(product.id) as Product : product;
    console.timeEnd('ProductsInventory.editDetailFetch');
    setEditingProduct(fullProduct);
    setFormData({
      name: fullProduct.name,
      barcode: fullProduct.barcode || '',
      category: fullProduct.category || product.category || '',
      unit: fullProduct.unit || product.unit || '',
      purchasePrice: fullProduct.purchasePrice,
      salePrice: fullProduct.salePrice,
      description: fullProduct.description || '',
    });
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    if (confirm('هل أنت متأكد من حذف هذا الصنف؟')) {
      try {
        await deleteProduct(id);
        await loadData();
      } catch (err) {
        console.error('Error deleting product:', err);
        alert('حدث خطأ أثناء حذف الصنف.');
      }
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      barcode: '',
      category: 'عام',
      unit: 'قطعة',
      purchasePrice: 0,
      salePrice: 0,
      description: '',
    });
  };

  return (
    <div className="space-y-2 pb-10">
      {/* COMPACT HEADER & TOOLBAR */}
      <section className="erp-action-bar">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-black text-slate-900 shrink-0">كتالوج الأصناف</h2>
          <div className="relative flex-1 min-w-[240px] max-w-md">
            <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              ref={searchInputRef}
              autoFocus
              value={searchTerm}
              onChange={(event) => {
                setSearchTerm(event.target.value);
                setVisibleLimit(PRODUCT_RENDER_LIMIT);
              }}
              placeholder="بحث باسم الصنف، الكود، أو التصنيف..."
              className="input-ui h-9 w-full pr-9 pl-3 text-xs bg-white border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>
        </div>
        <button
          onClick={() => {
            resetForm();
            setEditingProduct(null);
            setShowModal(true);
          }}
          className="flex items-center gap-1.5 bg-blue-600 text-white px-3.5 py-1.5 rounded-lg hover:bg-blue-700 transition-colors text-xs font-bold shadow-xs"
        >
          <Plus size={15} />
          <span>+ إضافة صنف</span>
        </button>
      </section>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xs">
        <div className="overflow-auto h-[calc(100vh-210px)]">
          <table className="w-full min-w-[800px]">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="py-2.5 px-4 text-right text-xs font-bold text-slate-700 tracking-wider">الصنف / الكود</th>
                <th className="py-2.5 px-4 text-right text-xs font-bold text-slate-700 tracking-wider">التصنيف</th>
                <th className="py-2.5 px-4 text-right text-xs font-bold text-slate-700 tracking-wider">الوحدة</th>
                <th className="py-2.5 px-4 text-right text-xs font-bold text-slate-700 tracking-wider">تكلفة الشراء</th>
                <th className="py-2.5 px-4 text-right text-xs font-bold text-slate-700 tracking-wider">سعر البيع</th>
                <th className="py-2.5 px-4 text-center text-xs font-bold text-slate-700 tracking-wider">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 px-4 text-center text-slate-400 text-xs font-bold">
                    <Package size={36} className="mx-auto mb-2 text-slate-300" />
                    <p className="text-xs font-bold">لا توجد أصناف مطابقة</p>
                  </td>
                </tr>
              ) : (
                visibleProducts.map((product) => (
                  <tr
                    key={product.id}
                    onDoubleClick={() => handleEdit(product)}
                    title="انقر مرتين للتعديل"
                    className="group cursor-pointer hover:bg-slate-50 transition-colors"
                  >
                    <td className="py-2.5 px-4">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 border border-blue-100">
                          <Package size={14} />
                        </div>
                        <div>
                          <p className="font-bold text-slate-900 text-xs md:text-sm">{product.name}</p>
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-100 text-slate-600 font-semibold">
                            {product.barcode || 'بدون كود'}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 px-4 text-xs md:text-sm font-semibold text-slate-700">
                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-xs font-semibold">{product.category || 'عام'}</span>
                    </td>
                    <td className="py-2.5 px-4 text-xs md:text-sm text-slate-600">{product.unit || '-'}</td>
                    <td className="py-2.5 px-4 text-xs md:text-sm font-bold text-slate-800">{formatCurrency(product.purchasePrice)}</td>
                    <td className="py-2.5 px-4 text-xs md:text-sm font-bold text-blue-700">{formatCurrency(product.salePrice)}</td>
                    <td className="py-2.5 px-4 text-center">
                      <div className="erp-icon-actions">
                        <button
                          onClick={() => handleEdit(product)}
                          className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                          title="تعديل"
                        >
                          <Edit size={15} />
                        </button>
                        {canDelete && (
                        <button
                          onClick={() => handleDelete(product.id)}
                          className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-md transition-colors"
                          title="حذف"
                        >
                          <Trash2 size={15} />
                        </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {filteredProducts.length > visibleProducts.length && (
          <div className="border-t border-slate-100 bg-slate-50 px-4 py-2 text-center">
            <button
              type="button"
              onClick={() => setVisibleLimit((limit) => limit + PRODUCT_RENDER_LIMIT)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100"
            >
              عرض المزيد ({filteredProducts.length - visibleProducts.length})
            </button>
          </div>
        )}
        <div className="erp-status-bar">
          <span className="font-bold text-slate-700">إجمالي أصناف الكتالوج: <span className="text-blue-700 font-extrabold">{products.length}</span> (المعروض: {visibleProducts.length})</span>
          <span className="font-bold text-slate-700">تصفية نتائج البحث: <span className="text-slate-900 font-extrabold">{filteredProducts.length}</span> صنف</span>
        </div>
      </section>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="p-5 border-b border-gray-100 bg-slate-50">
              <h3 className="text-base font-black text-slate-800">
                {editingProduct ? 'تعديل الصنف' : 'إضافة صنف جديد'}
              </h3>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">اسم الصنف</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="input-ui text-sm h-10 w-full"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">الكود / الباركود (اختياري)</label>
                <input
                  type="text"
                  value={formData.barcode}
                  onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
                  className="input-ui text-sm h-10 w-full"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">التصنيف</label>
                  <input
                    type="text"
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    className="input-ui text-sm h-10 w-full"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">الوحدة</label>
                  <input
                    type="text"
                    value={formData.unit}
                    onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                    className="input-ui text-sm h-10 w-full"
                    required
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">تكلفة الشراء</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.purchasePrice === 0 ? '' : formData.purchasePrice}
                    onChange={(e) => setFormData({ ...formData, purchasePrice: parseFloat(e.target.value) || 0 })}
                    className="input-ui text-sm h-10 w-full"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">سعر البيع</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.salePrice === 0 ? '' : formData.salePrice}
                    onChange={(e) => setFormData({ ...formData, salePrice: parseFloat(e.target.value) || 0 })}
                    className="input-ui text-sm h-10 w-full"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">الوصف (اختياري)</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="input-ui text-sm w-full p-2"
                  rows={2}
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 text-sm font-bold"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-bold"
                >
                  حفظ
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
