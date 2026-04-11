import React, { useState, useEffect } from 'react';
import { Package, AlertTriangle, Search, TrendingUp, TrendingDown } from 'lucide-react';
import { Product } from '../types';
import { getProducts, getInventoryReport } from '../lib/storage';
import { useAuth } from '../context/AuthContext';

export default function Inventory() {
  const [products, setProducts] = useState<Product[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const { settings } = useAuth();

  useEffect(() => {
    setProducts(getProducts());
  }, []);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ar-EG').format(amount) + ' ' + settings.currency;
  };

  const inventoryReport = getInventoryReport();
  const lowStock = inventoryReport.filter(p => p.status === 'منخفض');
  const inStock = inventoryReport.filter(p => p.status === 'متوفر');

  const totalValue = products.reduce((sum, p) => sum + (p.quantity * p.purchasePrice), 0);
  const totalRetailValue = products.reduce((sum, p) => sum + (p.quantity * p.salePrice), 0);

  const filteredProducts = products.filter(product =>
    product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    product.barcode.includes(searchTerm) ||
    product.category.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStockStatus = (product: Product) => {
    if (product.quantity <= 0) return { label: 'نفذ', color: 'bg-red-100 text-red-700', icon: AlertTriangle };
    if (product.quantity <= product.minQuantity) return { label: 'منخفض', color: 'bg-orange-100 text-orange-700', icon: TrendingDown };
    return { label: 'متوفر', color: 'bg-green-100 text-green-700', icon: TrendingUp };
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-800">إدارة المخزون</h2>
        <p className="text-gray-500 text-sm mt-1">عرض حالة المخزون الحالية</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center">
              <Package size={24} className="text-indigo-600" />
            </div>
            <div>
              <p className="text-gray-500 text-sm">إجمالي المنتجات</p>
              <p className="text-xl font-bold text-gray-800">{products.length}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
              <TrendingUp size={24} className="text-green-600" />
            </div>
            <div>
              <p className="text-gray-500 text-sm">متوفر</p>
              <p className="text-xl font-bold text-gray-800">{inStock.length}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center">
              <TrendingDown size={24} className="text-orange-600" />
            </div>
            <div>
              <p className="text-gray-500 text-sm">منخفض المخزون</p>
              <p className="text-xl font-bold text-orange-600">{lowStock.length}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-red-100 rounded-xl flex items-center justify-center">
              <AlertTriangle size={24} className="text-red-600" />
            </div>
            <div>
              <p className="text-gray-500 text-sm">قيمة المخزون</p>
              <p className="text-xl font-bold text-gray-800">{formatCurrency(totalValue)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <div className="relative">
          <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="بحث في المخزون..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pr-10 pl-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
          />
        </div>
      </div>

      {/* Inventory Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-indigo-50">
              <tr>
                <th className="px-4 py-4 text-right text-sm font-bold text-gray-700">المنتج</th>
                <th className="px-4 py-4 text-right text-sm font-bold text-gray-700">الباركود</th>
                <th className="px-4 py-4 text-right text-sm font-bold text-gray-700">الكمية</th>
                <th className="px-4 py-4 text-right text-sm font-bold text-gray-700">الحد الأدنى</th>
                <th className="px-4 py-4 text-right text-sm font-bold text-gray-700">سعر الشراء</th>
                <th className="px-4 py-4 text-right text-sm font-bold text-gray-700">قيمة المخزون</th>
                <th className="px-4 py-4 text-right text-sm font-bold text-gray-700">الحالة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredProducts.map(product => {
                const status = getStockStatus(product);
                const StatusIcon = status.icon;
                return (
                  <tr key={product.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
                          <Package size={20} className="text-indigo-600" />
                        </div>
                        <div>
                          <p className="font-medium text-gray-800">{product.name}</p>
                          <p className="text-xs text-gray-500">{product.category || 'عام'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 font-mono text-sm text-gray-600">{product.barcode}</td>
                    <td className="px-4 py-4">
                      <span className={`font-bold ${product.quantity <= product.minQuantity ? 'text-red-600' : 'text-gray-800'}`}>
                        {product.quantity}
                      </span>
                      <span className="text-xs text-gray-500 mr-1">{product.unit}</span>
                    </td>
                    <td className="px-4 py-4 text-gray-600">{product.minQuantity} {product.unit}</td>
                    <td className="px-4 py-4 text-gray-600">{formatCurrency(product.purchasePrice)}</td>
                    <td className="px-4 py-4 font-bold text-indigo-600">{formatCurrency(product.quantity * product.purchasePrice)}</td>
                    <td className="px-4 py-4">
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${status.color} flex items-center gap-1 w-fit`}>
                        <StatusIcon size={12} />
                        {status.label}
                      </span>
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
