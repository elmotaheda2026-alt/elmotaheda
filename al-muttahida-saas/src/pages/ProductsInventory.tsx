import React, { useEffect, useMemo, useState } from 'react';
import { Package, Search, Plus, Edit, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Product } from '../types';
import { getProducts, createProduct, updateProduct, deleteProduct, syncProducts } from '../lib/storage';
import { formatWholeCurrency } from '../lib/utils';

export default function ProductsInventory() {
  const { settings } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  
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
    try {
      await syncProducts();
    } catch (err) {
      console.error('Failed to sync products:', err);
    }
    setProducts(getProducts());
  };

  useEffect(() => {
    void loadData();
  }, []);

  const filteredProducts = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return products;

    return products.filter((product) =>
      product.name.toLowerCase().includes(term) ||
      (product.barcode || '').toLowerCase().includes(term) ||
      (product.category || '').toLowerCase().includes(term),
    );
  }, [products, searchTerm]);

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

  const handleEdit = (product: Product) => {
    setEditingProduct(product);
    setFormData({
      name: product.name,
      barcode: product.barcode || '',
      category: product.category || 'عام',
      unit: product.unit || 'قطعة',
      purchasePrice: product.purchasePrice,
      salePrice: product.salePrice,
      description: product.description || '',
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
    <div className="space-y-4 pb-10">
      {/* COMPACT HEADER & TOOLBAR */}
      <section className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-black text-slate-900 font-sans">كتالوج الأصناف</h2>
            <button
              onClick={() => {
                resetForm();
                setEditingProduct(null);
                setShowModal(true);
              }}
              className="flex items-center gap-1.5 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors text-sm font-bold shadow-sm"
            >
              <Plus size={16} />
              <span>إضافة صنف</span>
            </button>
          </div>
          <div className="w-full sm:w-80">
            <div className="relative">
              <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="بحث باسم الصنف، الكود، أو التصنيف..."
                className="input-ui h-10 pr-10 text-sm w-full"
              />
            </div>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px]">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-5 py-3.5 text-right text-sm font-black text-slate-700">الصنف / الكود</th>
                <th className="px-5 py-3.5 text-right text-sm font-black text-slate-700">التصنيف</th>
                <th className="px-5 py-3.5 text-right text-sm font-black text-slate-700">الوحدة</th>
                <th className="px-5 py-3.5 text-right text-sm font-black text-slate-700">تكلفة الشراء</th>
                <th className="px-5 py-3.5 text-right text-sm font-black text-slate-700">سعر البيع</th>
                <th className="px-5 py-3.5 text-center text-sm font-black text-slate-700">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-16 text-center">
                    <div className="mx-auto flex max-w-md flex-col items-center">
                      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                        <Package size={24} />
                      </div>
                      <p className="font-black text-slate-800">لا توجد أصناف مطابقة</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredProducts.map((product) => (
                  <tr key={product.id} className="transition hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-600">
                          <Package size={16} />
                        </div>
                        <div>
                          <p className="font-black text-slate-900 text-sm">{product.name}</p>
                          <p className="text-xs font-semibold text-slate-500">{product.barcode || 'بدون كود'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-sm font-bold text-slate-700">{product.category || 'عام'}</td>
                    <td className="px-5 py-3 text-sm font-bold text-slate-700">{product.unit || '-'}</td>
                    <td className="px-5 py-3 text-sm font-black text-slate-900">{formatCurrency(product.purchasePrice)}</td>
                    <td className="px-5 py-3 text-sm font-black text-slate-900">{formatCurrency(product.salePrice)}</td>
                    <td className="px-5 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => handleEdit(product)}
                          className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="تعديل"
                        >
                          <Edit size={15} />
                        </button>
                        <button
                          onClick={() => handleDelete(product.id)}
                          className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="حذف"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
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
