import React, { useState } from 'react';
import { BarChart3, TrendingUp, DollarSign, ShoppingBag, ShoppingCart, PieChart as PieChartIcon } from 'lucide-react';
import { getSalesReport, getPurchasesReport, getProfitLossReport, getSettings } from '../lib/storage';

export default function Reports() {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const settings = getSettings();

  const salesReport = getSalesReport(startDate, endDate);
  const purchasesReport = getPurchasesReport(startDate, endDate);
  const profitLoss = getProfitLossReport(startDate, endDate);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ar-EG').format(amount) + ' ' + settings.currency;
  };

  const salesChartData = salesReport.slice(-7).map(s => ({
    date: new Date(s.date).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' }),
    amount: s.total,
  }));

  const pieData = [
    { name: 'المبيعات', value: profitLoss.totalSales, color: '#10b981', percent: profitLoss.totalSales > 0 ? (profitLoss.totalSales / (profitLoss.totalSales + profitLoss.totalPurchases + profitLoss.totalExpenses || 1) * 100).toFixed(0) : 0 },
    { name: 'المشتريات', value: profitLoss.totalPurchases, color: '#f97316', percent: profitLoss.totalPurchases > 0 ? (profitLoss.totalPurchases / (profitLoss.totalSales + profitLoss.totalPurchases + profitLoss.totalExpenses || 1) * 100).toFixed(0) : 0 },
    { name: 'المصروفات', value: profitLoss.totalExpenses, color: '#ef4444', percent: profitLoss.totalExpenses > 0 ? (profitLoss.totalExpenses / (profitLoss.totalSales + profitLoss.totalPurchases + profitLoss.totalExpenses || 1) * 100).toFixed(0) : 0 },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-800">التقارير والإحصائيات</h2>
        <p className="text-gray-500 text-sm mt-1">تحليل الأداء والمبيعات والمشتريات</p>
      </div>

      {/* Date Range */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">من تاريخ</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">إلى تاريخ</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            />
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
              <ShoppingBag size={24} className="text-green-600" />
            </div>
            <div>
              <p className="text-gray-500 text-sm">إجمالي المبيعات</p>
              <p className="text-xl font-bold text-green-600">{formatCurrency(profitLoss.totalSales)}</p>
              <p className="text-xs text-gray-500">{profitLoss.salesCount} فاتورة</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center">
              <ShoppingCart size={24} className="text-orange-600" />
            </div>
            <div>
              <p className="text-gray-500 text-sm">إجمالي المشتريات</p>
              <p className="text-xl font-bold text-orange-600">{formatCurrency(profitLoss.totalPurchases)}</p>
              <p className="text-xs text-gray-500">{profitLoss.purchasesCount} فاتورة</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-red-100 rounded-xl flex items-center justify-center">
              <DollarSign size={24} className="text-red-600" />
            </div>
            <div>
              <p className="text-gray-500 text-sm">إجمالي المصروفات</p>
              <p className="text-xl font-bold text-red-600">{formatCurrency(profitLoss.totalExpenses)}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${profitLoss.profit >= 0 ? 'bg-indigo-100' : 'bg-red-100'}`}>
              <TrendingUp size={24} className={profitLoss.profit >= 0 ? 'text-indigo-600' : 'text-red-600'} />
            </div>
            <div>
              <p className="text-gray-500 text-sm">صافي الربح/الخسارة</p>
              <p className={`text-xl font-bold ${profitLoss.profit >= 0 ? 'text-indigo-600' : 'text-red-600'}`}>
                {formatCurrency(profitLoss.profit)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Charts - Simple HTML/CSS based */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sales Chart */}
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
            <BarChart3 size={20} className="text-green-600" />
            مبيعات آخر 7 أيام
          </h3>
          <div className="space-y-3">
            {salesChartData.length === 0 ? (
              <p className="text-center text-gray-500 py-8">لا توجد بيانات</p>
            ) : (
              salesChartData.map((item, index) => {
                const maxAmount = Math.max(...salesChartData.map(d => d.amount), 1);
                const heightPercent = (item.amount / maxAmount * 100).toFixed(0);
                return (
                  <div key={index} className="flex items-center gap-3">
                    <span className="w-16 text-xs text-gray-500">{item.date}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-6 overflow-hidden">
                      <div
                        className="bg-green-500 h-full rounded-full flex items-center justify-end pr-2 transition-all duration-500"
                        style={{ width: `${heightPercent}%` }}
                      >
                        <span className="text-xs text-white font-bold">{formatCurrency(item.amount)}</span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Pie Chart - Simplified */}
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
            <PieChartIcon size={20} className="text-indigo-600" />
            توزيع الإيرادات والمصروفات
          </h3>
          <div className="space-y-4">
            {pieData.map((item, index) => (
              <div key={index}>
                <div className="flex justify-between items-center mb-1">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded" style={{ backgroundColor: item.color }} />
                    <span className="text-sm text-gray-700">{item.name}</span>
                  </div>
                  <span className="text-sm font-bold">{item.percent}%</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-4">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${item.percent}%`, backgroundColor: item.color }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-center text-gray-600 text-sm">
              الإجمالي: <span className="font-bold">{formatCurrency(profitLoss.totalSales + profitLoss.totalPurchases + profitLoss.totalExpenses)}</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
