import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  TrendingUp,
  TrendingDown,
  Users,
  ShoppingCart,
  Package,
  DollarSign,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  Wallet,
  Receipt,
  Banknote,
  ShoppingBag,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getDashboardStats, getLowStockProducts, getSales, getPurchases } from '../lib/storage';

export default function Dashboard() {
  const { settings } = useAuth();
  const navigate = useNavigate();
  const stats = getDashboardStats();
  const lowStock = getLowStockProducts().slice(0, 5);
  const recentSales = getSales().slice(-5).reverse();
  const recentPurchases = getPurchases().slice(-5).reverse();

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ar-EG').format(amount) + ' ' + settings.currency;
  };

  const StatCard = ({ title, value, icon: Icon, trend, trendValue, color }: any) => (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-4">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${color}`}>
          <Icon size={24} className="text-white" />
        </div>
        {trend && (
          <div className={`flex items-center gap-1 text-sm ${trend === 'up' ? 'text-green-600' : 'text-red-600'}`}>
            {trend === 'up' ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
            {trendValue}
          </div>
        )}
      </div>
      <h3 className="text-gray-500 text-sm mb-1">{title}</h3>
      <p className="text-2xl font-bold text-gray-800">{formatCurrency(value)}</p>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Welcome Section */}
      <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-xl p-6 text-white">
        <h2 className="text-2xl font-bold mb-2">مرحباً بك في {settings.companyName}</h2>
        <p className="text-white/80">إليك ملخص نشاط شركتك اليوم</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="إجمالي المبيعات"
          value={stats.totalSales}
          icon={ShoppingBag}
          trend="up"
          trendValue="+12%"
          color="bg-green-500"
        />
        <StatCard
          title="إجمالي المشتريات"
          value={stats.totalPurchases}
          icon={ShoppingCart}
          trend="down"
          trendValue="-5%"
          color="bg-orange-500"
        />
        <StatCard
          title="إجمالي الأرباح"
          value={stats.totalProfit}
          icon={DollarSign}
          trend="up"
          trendValue="+8%"
          color="bg-blue-500"
        />
        <StatCard
          title="المدفوعات المستحقة"
          value={stats.pendingPayments}
          icon={Wallet}
          color="bg-red-500"
        />
      </div>

      {/* Second Row Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div
          onClick={() => navigate('/customers')}
          className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 hover:shadow-md transition-shadow cursor-pointer"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center">
              <Users size={24} className="text-indigo-600" />
            </div>
            <div>
              <p className="text-gray-500 text-sm">العملاء</p>
              <p className="text-2xl font-bold text-gray-800">{stats.totalCustomers}</p>
            </div>
          </div>
        </div>

        <div
          onClick={() => navigate('/suppliers')}
          className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 hover:shadow-md transition-shadow cursor-pointer"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center">
              <Package size={24} className="text-purple-600" />
            </div>
            <div>
              <p className="text-gray-500 text-sm">الموردين</p>
              <p className="text-2xl font-bold text-gray-800">{stats.totalSuppliers}</p>
            </div>
          </div>
        </div>

        <div
          onClick={() => navigate('/products')}
          className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 hover:shadow-md transition-shadow cursor-pointer"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-teal-100 rounded-xl flex items-center justify-center">
              <Receipt size={24} className="text-teal-600" />
            </div>
            <div>
              <p className="text-gray-500 text-sm">المنتجات</p>
              <p className="text-2xl font-bold text-gray-800">{stats.totalProducts}</p>
            </div>
          </div>
        </div>

        <div
          onClick={() => navigate('/inventory')}
          className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 hover:shadow-md transition-shadow cursor-pointer"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-red-100 rounded-xl flex items-center justify-center">
              <AlertTriangle size={24} className="text-red-600" />
            </div>
            <div>
              <p className="text-gray-500 text-sm">مخزون منخفض</p>
              <p className="text-2xl font-bold text-red-600">{stats.lowStockItems}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Charts and Tables Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Sales */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
          <div className="p-6 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-bold text-gray-800">آخر المبيعات</h3>
            <button
              onClick={() => navigate('/sales')}
              className="text-sm text-indigo-600 hover:text-indigo-700"
            >
              عرض الكل
            </button>
          </div>
          <div className="divide-y divide-gray-50">
            {recentSales.length === 0 ? (
              <div className="p-8 text-center text-gray-500">لا توجد مبيعات حديثة</div>
            ) : (
              recentSales.map(sale => (
                <div key={sale.id} className="p-4 flex items-center justify-between hover:bg-gray-50">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                      <Banknote size={18} className="text-green-600" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-800">{sale.customerName}</p>
                      <p className="text-xs text-gray-500">{sale.invoiceNumber}</p>
                    </div>
                  </div>
                  <div className="text-left">
                    <p className="font-bold text-green-600">{formatCurrency(sale.total)}</p>
                    <p className="text-xs text-gray-500">{new Date(sale.date).toLocaleDateString('ar-EG')}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Low Stock Alert */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
          <div className="p-6 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-bold text-gray-800 flex items-center gap-2">
              <AlertTriangle size={20} className="text-orange-500" />
              تنبيهات المخزون
            </h3>
            <button
              onClick={() => navigate('/inventory')}
              className="text-sm text-indigo-600 hover:text-indigo-700"
            >
              عرض الكل
            </button>
          </div>
          <div className="divide-y divide-gray-50">
            {lowStock.length === 0 ? (
              <div className="p-8 text-center text-gray-500">لا توجد تنبيهات</div>
            ) : (
              lowStock.map(product => (
                <div key={product.id} className="p-4 flex items-center justify-between hover:bg-gray-50">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center">
                      <Package size={18} className="text-orange-600" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-800">{product.name}</p>
                      <p className="text-xs text-gray-500">{product.barcode}</p>
                    </div>
                  </div>
                  <div className="text-left">
                    <p className="font-bold text-red-600">{product.quantity}</p>
                    <p className="text-xs text-gray-500">الكمية المتوفرة</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
