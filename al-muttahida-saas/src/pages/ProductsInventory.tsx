import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Search, Package, Warehouse, ShoppingBasket, AlertTriangle } from 'lucide-react';
import { Product } from '../types';
import { getProducts, getSettings } from '../lib/storage';
import { formatWholeCurrency } from '../lib/utils';
import StatCard from '../components/StatCard';

// Reuse existing Inventory logic helpers
import { getAgingReport, getCollectionRateReport, getReceivablesReconciliationReport } from '../lib/storage'; // adjust if needed

export default function ProductsInventory() {
  const { settings } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<'products' | 'inventory'>('products');

  useEffect(() => {
    setProducts(getProducts());
  }, []);

  // ---------- Products ----------
  const filteredProducts = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return products.filter(p =>
      p.name.toLowerCase().includes(term) ||
      (p.barcode || '').includes(term) ||
      p.category.toLowerCase().includes(term)
    );
  }, [products, searchTerm]);

  // ---------- Inventory stats (copied from Inventory page) ----------


  const stockedProducts = useMemo(() => products.filter(p => p.fulfillmentType === 'stocked'), [products]);
  const onDemandProducts = useMemo(() => products.filter(p => p.fulfillmentType === 'on_demand'), [products]);
  const lowStockProducts = useMemo(() => stockedProducts.filter(p => p.quantity <= p.minQuantity), [stockedProducts]);

  const totalProducts = products.length;
  const totalStocked = stockedProducts.length;
  const totalOnDemand = onDemandProducts.length;
  const totalLow = lowStockProducts.length;

  // ---------- Helper ----------
  const formatCurrency = (amt: number) => formatWholeCurrency(amt, settings.currency);

  return (
    <div className="space-y-6 pb-10">
      {/* Header & tabs */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">دليل الأصناف وإدارة المخزون</h2>
          <p className="text-slate-500 text-sm mt-1">صفحة موحدة تجمع بين كتالوج الأصناف وإحصاءات المخزون.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('products')}
            className={`px-4 py-2 rounded-xl text-sm font-medium ${activeTab === 'products' ? 'bg-sky-600 text-white' : 'bg-slate-200 text-slate-800'}`}
          >
            الأصناف
          </button>
          <button
            onClick={() => setActiveTab('inventory')}
            className={`px-4 py-2 rounded-xl text-sm font-medium ${activeTab === 'inventory' ? 'bg-sky-600 text-white' : 'bg-slate-200 text-slate-800'}`}
          >
            المخزون
          </button>
        </div>
        <div className="flex flex-col sm:flex-row items-end gap-4 bg-indigo-50/50 p-2 rounded-xl border border-indigo-100/50">
          <div className="flex flex-col gap-2">
            <label className="text-center text-xs font-bold text-slate-500">بحث</label>
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="ابحث بالأصناف…"
              className="input-ui w-44 h-12"
            />
          </div>
        </div>
      </div>

      {/* Tab content */}
      {activeTab === 'products' && (
        <div className="space-y-6">
          {/* Product table */}
          <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px]">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="px-4 py-4 text-right text-sm font-bold text-slate-700">الصنف</th>
                    <th className="px-4 py-4 text-right text-sm font-bold text-slate-700">النوع</th>
                    <th className="px-4 py-4 text-right text-sm font-bold text-slate-700">الكمية</th>
                    <th className="px-4 py-4 text-right text-sm font-bold text-slate-700">سعر الشراء</th>
                    <th className="px-4 py-4 text-right text-sm font-bold text-slate-700">سعر البيع</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredProducts.map(product => (
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
                      <td className="px-4 py-4 font-mono text-sm text-slate-600">{product.quantity} <span className="mr-1 text-xs text-slate-500">{product.unit}</span></td>
                      <td className="px-4 py-4 text-slate-700">{formatCurrency(product.purchasePrice)}</td>
                      <td className="px-4 py-4 font-bold text-emerald-700">
                        {product.fulfillmentType === 'on_demand' ? '-' : formatCurrency(product.salePrice)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'inventory' && (
        <div className="space-y-6">
          {/* KPI cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard icon={<Package size={20} className="text-sky-600" />} label="كل الأصناف" value={totalProducts} />
            <StatCard icon={<Warehouse size={20} className="text-emerald-600" />} label="أصناف مخزنية" value={totalStocked} />
            <StatCard icon={<ShoppingBasket size={20} className="text-amber-600" />} label="حسب الطلب" value={totalOnDemand} />
            <StatCard icon={<AlertTriangle size={20} className="text-rose-600" />} label="منخفضة المخزون" value={totalLow} />
          </div>

          {/* Low stock notice */}
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            الأصناف <strong>حسب الطلب</strong> لا تُحسب ضمن المخزون الفعلي. استخدم شاشة المشتريات لتسجيل طلبية للعميل ثم أضف الصنف للمخزن.
          </div>

          {/* Detailed table (same as product table but with status column) */}
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
                  {filteredProducts.map(product => {
                    const status = product.fulfillmentType === 'on_demand'
                      ? { label: 'حسب الطلب', className: 'bg-amber-100 text-amber-700' }
                      : product.quantity <= 0
                        ? { label: 'نافد', className: 'bg-rose-100 text-rose-700' }
                        : product.quantity <= product.minQuantity
                          ? { label: 'منخفض', className: 'bg-orange-100 text-orange-700' }
                          : { label: 'متوفر', className: 'bg-emerald-100 text-emerald-700' };
                    return (
                      <tr key={product.id} className="hover:bg-slate-50">
                        <td className="px-4 py-4">
                          <div>
                            <p className="font-semibold text-slate-800">{product.name}</p>
                            <p className="text-xs text-slate-500">{product.category || '-'} </p>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <span className={`rounded-full px-3 py-1 text-xs font-bold ${product.fulfillmentType === 'on_demand' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                            {product.fulfillmentType === 'on_demand' ? 'حسب الطلب' : 'مخزني'}
                          </span>
                        </td>
                        <td className="px-4 py-4 font-bold text-slate-800">{product.quantity} <span className="text-xs font-normal text-slate-500">{product.unit}</span></td>
                        <td className="px-4 py-4 text-slate-600">{product.fulfillmentType === 'on_demand' ? '-' : `${product.minQuantity} ${product.unit}`}</td>
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
      )}
    </div>
  );
}
