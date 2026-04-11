import React, { useState, useEffect } from 'react';
import { Calculator, DollarSign, Users, Truck, CreditCard } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getCustomers, getSuppliers, getSales, getPurchases, getPayments } from '../lib/storage';

export default function Accounts() {
  const { settings } = useAuth();
  const [customers, setCustomers] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [summary, setSummary] = useState({
    totalCustomersBalance: 0,
    totalSuppliersBalance: 0,
    totalSalesRevenue: 0,
    totalPurchasesCost: 0,
    totalPaymentsIn: 0,
    totalPaymentsOut: 0,
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = () => {
    const c = getCustomers();
    const s = getSuppliers();
    const sales = getSales();
    const purchases = getPurchases();
    const payments = getPayments();

    setCustomers(c);
    setSuppliers(s);

    const customerBalances = c.reduce((sum, cust) => sum + cust.balance, 0);
    const supplierBalances = s.reduce((sum, sup) => sum + sup.balance, 0);
    const salesRevenue = sales.reduce((sum, sale) => sum + sale.total, 0);
    const purchasesCost = purchases.reduce((sum, pur) => sum + pur.total, 0);
    const paymentsIn = payments.filter(p => p.type === 'in').reduce((sum, p) => sum + p.amount, 0);
    const paymentsOut = payments.filter(p => p.type === 'out').reduce((sum, p) => sum + p.amount, 0);

    setSummary({
      totalCustomersBalance: customerBalances,
      totalSuppliersBalance: supplierBalances,
      totalSalesRevenue: salesRevenue,
      totalPurchasesCost: purchasesCost,
      totalPaymentsIn: paymentsIn,
      totalPaymentsOut: paymentsOut,
    });
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ar-EG').format(amount) + ' ' + settings.currency;
  };

  const netProfit = summary.totalSalesRevenue - summary.totalPurchasesCost;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-800">الحسابات الرئيسية</h2>
        <p className="text-gray-500 text-sm mt-1">ملخص مالي شامل</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl p-6 text-white shadow-lg">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
              <DollarSign size={24} />
            </div>
            <div>
              <p className="text-white/80 text-sm">إجمالي مبيعات</p>
              <p className="text-2xl font-bold">{formatCurrency(summary.totalSalesRevenue)}</p>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-orange-500 to-red-500 rounded-xl p-6 text-white shadow-lg">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
              <Truck size={24} />
            </div>
            <div>
              <p className="text-white/80 text-sm">إجمالي مشتريات</p>
              <p className="text-2xl font-bold">{formatCurrency(summary.totalPurchasesCost)}</p>
            </div>
          </div>
        </div>

        <div className={`bg-gradient-to-br ${netProfit >= 0 ? 'from-indigo-500 to-purple-600' : 'from-red-500 to-pink-600'} rounded-xl p-6 text-white shadow-lg`}>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
              <Calculator size={24} />
            </div>
            <div>
              <p className="text-white/80 text-sm">{netProfit >= 0 ? 'صافي الربح' : 'صافي الخسارة'}</p>
              <p className="text-2xl font-bold">{formatCurrency(Math.abs(netProfit))}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Balances Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Customer Balances */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-6 border-b border-gray-100 bg-green-50">
            <h3 className="font-bold text-gray-800 flex items-center gap-2">
              <Users size={20} className="text-green-600" />
              أرصدة العملاء
            </h3>
          </div>
          <div className="divide-y divide-gray-100 max-h-80 overflow-y-auto">
            {customers.map(customer => (
              <div key={customer.id} className="p-4 flex justify-between items-center hover:bg-gray-50">
                <div>
                  <p className="font-medium text-gray-800">{customer.name}</p>
                  <p className="text-xs text-gray-500">{customer.phone}</p>
                </div>
                <p className={`font-bold ${customer.balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {formatCurrency(customer.balance)}
                </p>
              </div>
            ))}
            {customers.length === 0 && (
              <div className="p-8 text-center text-gray-500">لا يوجد عملاء</div>
            )}
          </div>
          <div className="p-4 bg-gray-50 border-t">
            <div className="flex justify-between items-center">
              <span className="font-bold text-gray-800">الإجمالي</span>
              <span className="font-bold text-lg text-green-600">{formatCurrency(summary.totalCustomersBalance)}</span>
            </div>
          </div>
        </div>

        {/* Supplier Balances */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-6 border-b border-gray-100 bg-orange-50">
            <h3 className="font-bold text-gray-800 flex items-center gap-2">
              <Truck size={20} className="text-orange-600" />
              أرصدة الموردين
            </h3>
          </div>
          <div className="divide-y divide-gray-100 max-h-80 overflow-y-auto">
            {suppliers.map(supplier => (
              <div key={supplier.id} className="p-4 flex justify-between items-center hover:bg-gray-50">
                <div>
                  <p className="font-medium text-gray-800">{supplier.name}</p>
                  <p className="text-xs text-gray-500">{supplier.phone}</p>
                </div>
                <p className={`font-bold ${supplier.balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {formatCurrency(supplier.balance)}
                </p>
              </div>
            ))}
            {suppliers.length === 0 && (
              <div className="p-8 text-center text-gray-500">لا يوجد موردين</div>
            )}
          </div>
          <div className="p-4 bg-gray-50 border-t">
            <div className="flex justify-between items-center">
              <span className="font-bold text-gray-800">الإجمالي</span>
              <span className="font-bold text-lg text-red-600">{formatCurrency(summary.totalSuppliersBalance)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Payment Summary */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
          <CreditCard size={20} className="text-indigo-600" />
          ملخص المدفوعات
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 bg-green-50 rounded-lg">
            <p className="text-green-600 text-sm mb-1">المدفوعات الواردة</p>
            <p className="text-2xl font-bold text-green-600">{formatCurrency(summary.totalPaymentsIn)}</p>
          </div>
          <div className="p-4 bg-red-50 rounded-lg">
            <p className="text-red-600 text-sm mb-1">المدفوعات الصادرة</p>
            <p className="text-2xl font-bold text-red-600">{formatCurrency(summary.totalPaymentsOut)}</p>
          </div>
          <div className="p-4 bg-indigo-50 rounded-lg">
            <p className="text-indigo-600 text-sm mb-1">صافي الحركة</p>
            <p className="text-2xl font-bold text-indigo-600">{formatCurrency(summary.totalPaymentsIn - summary.totalPaymentsOut)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
