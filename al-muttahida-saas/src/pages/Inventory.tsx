import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Package, Search, ShoppingBasket, Warehouse } from 'lucide-react';
import { Product } from '../types';
import { getProducts } from '../lib/storage';
import { useAuth } from '../context/AuthContext';
import { formatWholeCurrency } from '../lib/utils';

export default function Inventory() {
  const { settings } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    setProducts(getProducts());
  }, []);

  const filteredProducts = useMemo(
    () =>
      products.filter((product) => {
        const search = searchTerm.toLowerCase();
        return (
          product.name.toLowerCase().includes(search) ||
          product.barcode.includes(searchTerm) ||
          product.category.toLowerCase().includes(search)
        );
      }),
    [products, searchTerm],
  );

  const stockedProducts = products.filter((product) => product.fulfillmentType === 'stocked');
  const onDemandProducts = products.filter((product) => product.fulfillmentType === 'on_demand');
  const lowStockProducts = stockedProducts.filter((product) => product.quantity <= product.minQuantity);

  const formatCurrency = (amount: number) => formatWholeCurrency(amount, settings.currency);

  const getStatus = (product: Product) => {
    if (product.fulfillmentType === 'on_demand') {
      return {
        label: product.quantity > 0 ? 'متاح للطلب' : 'حسب الطلب',
        className: 'bg-amber-100 text-amber-700',
      };
    }

    if (product.quantity <= 0) {
      return {
        label: 'نافد',
        className: 'bg-rose-100 text-rose-700',
      };
    }

    if (product.quantity <= product.minQuantity) {
      return {
        label: 'منخفض',
        className: 'bg-orange-100 text-orange-700',
      };
    }

    return {
      label: 'متوفر',
      className: 'bg-emerald-100 text-emerald-700',
    };
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">إدارة المخزون</h2>
        <p className="mt-1 text-sm text-slate-500">المخزن الآن يفرّق بين الأصناف المخزنية والأصناف التي تُشترى حسب طلب العميل.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <StatCard icon={<Package size={20} className="text-sky-600" />} label="كل الأصناف" value={String(products.length)} />
        <StatCard icon={<Warehouse size={20} className="text-emerald-600" />} label="أصناف مخزنية" value={String(stockedProducts.length)} />
        <StatCard icon={<ShoppingBasket size={20} className="text-amber-600" />} label="حسب الطلب" value={String(onDemandProducts.length)} />
        <StatCard icon={<AlertTriangle size={20} className="text-rose-600" />} label="منخفضة المخزون" value={String(lowStockProducts.length)} />
      </div>

      <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="relative">
          <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="ابحث في المخزون"
            className="input-ui pr-10"
          />
        </div>
      </div>

      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        الأصناف <strong>حسب الطلب</strong> لا تعتبر مشكلة مخزون بحد ذاتها. الفكرة المناسبة لنشاطك:
        أضف الصنف كـ "حسب الطلب"، ثم عند طلب العميل اشتريه من المشتريات وأدخله المخزن، وبعدها أكمل البيع.
      </div>

      <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px]">
            <thead className="bg-slate-100">
              <tr>
                <th className="px-4 py-4 text-right text-sm font-bold text-slate-700">الصنف</th>
                <th className="px-4 py-4 text-right text-sm font-bold text-slate-700">النوع</th>
                <th className="px-4 py-4 text-right text-sm font-bold text-slate-700">الكمية</th>
                <th className="px-4 py-4 text-right text-sm font-bold text-slate-700">دنى</th>
                <th className="px-4 py-4 text-right text-sm font-bold text-slate-700">قيمة المخزون</th>
                <th className="px-4 py-4 text-right text-sm font-bold text-slate-700">الحالة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredProducts.map((product) => {
                const status = getStatus(product);
                return (
                  <tr key={product.id} className="hover:bg-slate-50">
                    <td className="px-4 py-4">
                      <div>
                        <p className="font-semibold text-slate-800">{product.name}</p>
                        <p className="text-xs text-slate-500">{product.barcode}</p>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <span className={`rounded-full px-3 py-1 text-xs font-bold ${product.fulfillmentType === 'on_demand' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                        {product.fulfillmentType === 'on_demand' ? 'حسب الطلب' : 'مخزني'}
                      </span>
                    </td>
                    <td className="px-4 py-4 font-bold text-slate-800">
                      {product.quantity} <span className="text-xs font-normal text-slate-500">{product.unit}</span>
                    </td>
                    <td className="px-4 py-4 text-slate-600">
                      {product.fulfillmentType === 'on_demand' ? '-' : `${product.minQuantity} ${product.unit}`}
                    </td>
                    <td className="px-4 py-4 text-slate-700">{formatCurrency(product.quantity * product.purchasePrice)}</td>
                    <td className="px-4 py-4">
                      <span className={`rounded-full px-3 py-1 text-xs font-bold ${status.className}`}>{status.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-4">
        <div className="rounded-2xl bg-slate-100 p-3">{icon}</div>
        <div>
          <p className="text-sm text-slate-500">{label}</p>
          <p className="mt-1 text-xl font-bold text-slate-800">{value}</p>
        </div>
      </div>
    </div>
  );
}
