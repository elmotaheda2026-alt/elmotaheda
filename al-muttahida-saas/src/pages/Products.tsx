import React, { useEffect, useState } from 'react';
import { Edit, Package, Plus, Search, Trash2 } from 'lucide-react';
import { Product } from '../types';
import { createProduct, deleteProduct, getProducts, updateProduct } from '../lib/storage';
import { useAuth } from '../context/AuthContext';
import { formatWholeCurrency } from '../lib/utils';

type ProductForm = Omit<Product, 'id' | 'createdAt' | 'updatedAt'>;

const initialForm = (taxRate: number): ProductForm => ({
  name: '',
  category: '',
  fulfillmentType: 'stocked',
  unit: 'قطعة',
  purchasePrice: 0,
  salePrice: 0,
  discount: 0,
  tax: taxRate,
  quantity: 0,
  minQuantity: 10,
  description: '',
});

export default function Products() {
  const { settings } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [formData, setFormData] = useState<ProductForm>(initialForm(settings.taxRate));

  useEffect(() => {
    loadProducts();
  }, []);

  const loadProducts = () => {
    setProducts(getProducts());
  };

  const generateBarcode = () => {
    // barcode removed; no-op kept for compatibility
    return;
  };

  const resetForm = () => {
    setFormData(initialForm(settings.taxRate));
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    const payload: ProductForm = {
      ...formData,
      minQuantity: formData.fulfillmentType === 'on_demand' ? 0 : formData.minQuantity,
    };

    if (editingProduct) {
      updateProduct(editingProduct.id, payload);
    } else {
      createProduct(payload);
    }

    loadProducts();
    setShowModal(false);
    setEditingProduct(null);
    resetForm();
  };

  const handleEdit = (product: Product) => {
    setEditingProduct(product);
    setFormData({
      name: product.name,
      category: product.category,
      fulfillmentType: product.fulfillmentType || 'stocked',
      unit: product.unit,
      purchasePrice: product.purchasePrice,
      salePrice: product.salePrice,
      discount: product.discount,
      tax: product.tax,
      quantity: product.quantity,
      minQuantity: product.minQuantity,
      description: product.description || '',
    });
    setShowModal(true);
  };

  const filteredProducts = products.filter((product) => {
    const search = searchTerm.toLowerCase();
    return (
      product.name.toLowerCase().includes(search) ||
      (product.barcode || '').includes(searchTerm) ||
      product.category.toLowerCase().includes(search)
    );
  });

  const formatCurrency = (amount: number) => formatWholeCurrency(amount, settings.currency);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">إدارة الأصناف</h2>
          <p className="mt-1 text-sm text-slate-500">فرّق بين الصنف المخزني والصنف حسب الطلب حتى يتعامل النظام مع مخزونك بشكل صحيح.</p>
        </div>
        <button
          onClick={() => {
            resetForm();
            setEditingProduct(null);
            setShowModal(true);
          }}
          className="inline-flex items-center gap-2 rounded-2xl bg-sky-600 px-4 py-2 text-white hover:bg-sky-700"
        >
          <Plus size={18} />
          إضافة صنف
        </button>
      </div>

      <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="relative">
          <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="ابحث بالاسم أو التصنيف"
            className="input-ui pr-10"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px]">
            <thead className="bg-slate-100">
              <tr>
                <th className="px-4 py-4 text-right text-sm font-bold text-slate-700">الصنف</th>
                <th className="px-4 py-4 text-right text-sm font-bold text-slate-700">النوع</th>
                {/* barcode column removed */}
                <th className="px-4 py-4 text-right text-sm font-bold text-slate-700">الكمية</th>
                <th className="px-4 py-4 text-right text-sm font-bold text-slate-700">سعر الشراء</th>
                <th className="px-4 py-4 text-right text-sm font-bold text-slate-700">سعر البيع</th>
                <th className="px-4 py-4 text-right text-sm font-bold text-slate-700">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredProducts.map((product) => (
                <tr key={product.id} className="hover:bg-slate-50">
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-100">
                        <Package size={18} className="text-sky-600" />
                      </div>
                      <div>
                        <p className="font-semibold text-slate-800">{product.name}</p>
                        <p className="text-xs text-slate-500">{product.category || 'عام'}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <span className={`rounded-full px-3 py-1 text-xs font-bold ${product.fulfillmentType === 'on_demand' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                      {product.fulfillmentType === 'on_demand' ? 'حسب الطلب' : 'مخزني'}
                    </span>
                  </td>
                  <td className="px-4 py-4 font-mono text-sm text-slate-600">{product.barcode || '-'}</td>
                  <td className="px-4 py-4">
                    <span className="font-bold text-slate-800">{product.quantity}</span>
                    <span className="mr-1 text-xs text-slate-500">{product.unit}</span>
                  </td>
                  <td className="px-4 py-4 text-slate-700">{formatCurrency(product.purchasePrice)}</td>
                  <td className="px-4 py-4 font-bold text-emerald-700">{product.fulfillmentType === 'on_demand' ? '-' : formatCurrency(product.salePrice)}</td>
                  <td className="px-4 py-4">
                    <div className="flex gap-2">
                      <button onClick={() => handleEdit(product)} className="rounded-xl p-2 text-sky-600 hover:bg-sky-50">
                        <Edit size={18} />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm('هل تريد حذف هذا الصنف؟')) {
                            deleteProduct(product.id);
                            loadProducts();
                          }
                        }}
                        className="rounded-xl p-2 text-rose-600 hover:bg-rose-50"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-[20px] bg-white shadow-2xl">
            <div className="border-b border-slate-100 p-4">
              <h3 className="text-lg font-bold text-slate-900">{editingProduct ? 'تعديل الصنف' : 'إضافة صنف جديد'}</h3>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 p-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="اسم الصنف">
                  <input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="input-ui" required />
                </Field>

                <Field label="نوع الصنف">
                  <select
                    value={formData.fulfillmentType}
                    onChange={(e) =>
                      setFormData((current) => ({
                        ...current,
                        fulfillmentType: e.target.value as Product['fulfillmentType'],
                        minQuantity: e.target.value === 'on_demand' ? 0 : current.minQuantity || 10,
                      }))
                    }
                    className="input-ui"
                  >
                    <option value="stocked">مخزني</option>
                    <option value="on_demand">حسب الطلب</option>
                  </select>
                </Field>

                {/* barcode field removed */}

                <Field label="التصنيف">
                  <input value={formData.category} onChange={(e) => setFormData({ ...formData, category: e.target.value })} className="input-ui" />
                </Field>

                <Field label="الوحدة">
                  <input value={formData.unit} onChange={(e) => setFormData({ ...formData, unit: e.target.value })} className="input-ui" />
                </Field>

                <Field label="الكمية الحالية">
                  <input type="number" min="0" value={formData.quantity} onChange={(e) => setFormData({ ...formData, quantity: Number(e.target.value) || 0 })} className="input-ui" required />
                </Field>


                <Field label="سعر الشراء">
                  <input type="number" min="0" step="0.01" value={formData.purchasePrice} onChange={(e) => setFormData({ ...formData, purchasePrice: Number(e.target.value) || 0 })} className="input-ui" required />
                </Field>

                {formData.fulfillmentType !== 'on_demand' && (
                  <Field label="سعر البيع">
                    <input type="number" min="0" step="0.01" value={formData.salePrice} onChange={(e) => setFormData({ ...formData, salePrice: Number(e.target.value) || 0 })} className="input-ui" required />
                  </Field>
                )}

                {/* discount, tax, and minQuantity fields removed per design */}

                <div className="md:col-span-2">
                  <Field label="ملاحظات">
                    <textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} rows={1} className="input-ui resize-none" />
                  </Field>
                </div>
              </div>

              {formData.fulfillmentType === 'on_demand' && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  هذا الصنف يعتبر "حسب الطلب": لا يُعامل كنقص مخزون، والأفضل شراؤه أولًا من شاشة المشتريات ثم بيعه للعميل.
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setShowModal(false); setEditingProduct(null); }} className="flex-1 rounded-2xl border border-slate-300 px-4 py-3 text-slate-700 hover:bg-slate-50">
                  إلغاء
                </button>
                <button type="submit" className="flex-1 rounded-2xl bg-sky-600 px-4 py-3 font-bold text-white hover:bg-sky-700">
                  {editingProduct ? 'حفظ التعديل' : 'إضافة الصنف'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
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
