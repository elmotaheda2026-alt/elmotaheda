import React, { useEffect, useMemo, useState } from 'react';
import { Package, Search, ShoppingBag, Tag, ClipboardList } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Product } from '../types';
import { getProducts } from '../lib/storage';
import { formatWholeCurrency } from '../lib/utils';

export default function ProductsInventory() {
  const { settings } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    setProducts(getProducts());
  }, []);

  const onDemandProducts = useMemo(
    () => products.filter((product) => product.fulfillmentType === 'on_demand'),
    [products],
  );

  const filteredProducts = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return onDemandProducts;

    return onDemandProducts.filter((product) =>
      product.name.toLowerCase().includes(term) ||
      (product.barcode || '').toLowerCase().includes(term) ||
      (product.category || '').toLowerCase().includes(term),
    );
  }, [onDemandProducts, searchTerm]);

  const categoriesCount = useMemo(() => {
    return new Set(onDemandProducts.map((product) => product.category || 'عام')).size;
  }, [onDemandProducts]);

  const formatCurrency = (amount: number) => formatWholeCurrency(amount, settings.currency);

  return (
    <div className="space-y-4 pb-10">
      {/* COMPACT HEADER & TOOLBAR */}
      <section className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div>
            <h2 className="text-xl font-black text-slate-900">الأصناف (حسب الطلب)</h2>
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
                <th className="px-5 py-3.5 text-right text-sm font-black text-slate-700">الصنف</th>
                <th className="px-5 py-3.5 text-right text-sm font-black text-slate-700">التصنيف</th>
                <th className="px-5 py-3.5 text-right text-sm font-black text-slate-700">الوحدة</th>
                <th className="px-5 py-3.5 text-right text-sm font-black text-slate-700">تكلفة الشراء</th>
                <th className="px-5 py-3.5 text-right text-sm font-black text-slate-700">حالة الصنف</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-16 text-center">
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
                    <td className="px-5 py-3">
                      <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-black text-amber-700">
                        حسب الطلب
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  tone: 'sky' | 'violet' | 'amber';
}) {
  const toneClass = {
    sky: 'bg-sky-50 text-sky-700 border-sky-100',
    violet: 'bg-violet-50 text-violet-700 border-violet-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
  }[tone];

  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${toneClass}`}>
        <Icon size={21} />
      </div>
      <div>
        <p className="text-sm font-bold text-slate-500">{label}</p>
        <p className="mt-0.5 text-xl font-black text-slate-900">{value}</p>
      </div>
    </div>
  );
}
