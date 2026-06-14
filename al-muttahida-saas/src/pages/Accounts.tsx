import React, { useState, useEffect } from 'react';
import { Calculator, DollarSign, Users, Truck, CreditCard, Banknote, Package, Receipt, ArrowUpRight, ArrowDownRight, PieChart, Activity } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getCustomers, getSuppliers, getSales, getPurchases, getPayments, getProducts, getExpenses, getShareholders, getShareholderTransactions } from '../lib/storage';
import { DatePicker } from '../components/DatePicker';
import { formatDateTimeDisplay } from '../lib/dateUtils';
import { calculateCostOfGoodsSold, calculateInventoryValue, calculateNetProfit } from '../lib/accounting';
import { formatWholeCurrency } from '../lib/utils';

export default function Accounts() {
  const { settings } = useAuth();
  
  // Date filter states
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Data states
  const [customers, setCustomers] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [recentTransactions, setRecentTransactions] = useState<any[]>([]);
  
  const [summary, setSummary] = useState({
    totalCustomersBalance: 0,
    totalSuppliersBalance: 0,
    
    // Absolute Assets
    cashInSafe: 0,
    inventoryValue: 0,
    shareholdersEquity: 0,
    
    // Period Performance
    periodSales: 0,
    periodPurchases: 0,
    periodCostOfGoodsSold: 0,
    periodExpenses: 0,
    
    // Period Cash Flow
    periodPaymentsIn: 0,
    periodPaymentsOut: 0,
  });

  useEffect(() => {
    loadData();
  }, [startDate, endDate]);

  const loadData = () => {
    const allCustomers = getCustomers();
    const allSuppliers = getSuppliers();
    const allSales = getSales();
    const allPurchases = getPurchases();
    const allPayments = getPayments();
    const allProducts = getProducts();
    const allExpenses = getExpenses();
    const allShareholders = getShareholders();

    setCustomers(allCustomers);
    setSuppliers(allSuppliers);

    // 1. Calculate Absolute Assets (Not affected by date filter)
    const customerBalances = allCustomers.reduce((sum, cust) => sum + cust.balance, 0);
    const supplierBalances = allSuppliers.reduce((sum, sup) => sum + sup.balance, 0);
    
    const totalPaymentsIn = allPayments.filter(p => p.type === 'in').reduce((sum, p) => sum + p.amount, 0);
    const totalPaymentsOut = allPayments.filter(p => p.type === 'out').reduce((sum, p) => sum + p.amount, 0);
    const cashInSafe = totalPaymentsIn - totalPaymentsOut;
    
    const inventoryValue = calculateInventoryValue(allProducts);
    
    // Live shareholders equity calculation
    const allShareholderTx = getShareholderTransactions();
    const totalWithdrawnProfits = allShareholderTx
      .filter(tx => tx.type === 'profit_withdrawal')
      .reduce((sum, tx) => sum + tx.amount, 0);
    const systemLiveNetProfit = calculateNetProfit(allSales, allProducts, allExpenses);
    const totalCapital = allShareholders.reduce((sum, sh) => sum + sh.capital, 0);
    const shareholdersEquity = totalCapital + systemLiveNetProfit - totalWithdrawnProfits;

    // 2. Filter by Date for Period Performance
    const isWithinDateRange = (dateStr: string) => {
      if (!startDate && !endDate) return true;
      const date = new Date(dateStr).getTime();
      const start = startDate ? new Date(startDate).getTime() : 0;
      const end = endDate ? new Date(endDate).getTime() : Infinity;
      // For end date, we add 1 day to include the whole selected end day
      return date >= start && date <= (end + 86400000); 
    };

    const filteredSales = allSales.filter(s => isWithinDateRange(s.date));
    const filteredPurchases = allPurchases.filter(p => isWithinDateRange(p.date));
    const filteredExpenses = allExpenses.filter(e => isWithinDateRange(e.date));
    const periodSales = filteredSales.reduce((sum, sale) => sum + sale.total, 0);
    const periodPurchases = filteredPurchases.reduce((sum, pur) => sum + pur.total, 0);
    const periodCostOfGoodsSold = calculateCostOfGoodsSold(filteredSales, allProducts);
    const periodExpenses = filteredExpenses.reduce((sum, exp) => sum + exp.amount, 0);

    const periodPaymentsIn = allPayments.filter(p => p.type === 'in' && isWithinDateRange(p.date)).reduce((sum, p) => sum + p.amount, 0);
    const periodPaymentsOut = allPayments.filter(p => p.type === 'out' && isWithinDateRange(p.date)).reduce((sum, p) => sum + p.amount, 0);

    setSummary({
      totalCustomersBalance: customerBalances,
      totalSuppliersBalance: supplierBalances,
      cashInSafe,
      inventoryValue,
      shareholdersEquity,
      periodSales,
      periodPurchases,
      periodCostOfGoodsSold,
      periodExpenses,
      periodPaymentsIn,
      periodPaymentsOut,
    });

    // 3. Recent Transactions (Last 5 Payments)
    setRecentTransactions(
      allPayments
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 6)
    );
  };

  const formatCurrency = (amount: number) => formatWholeCurrency(amount, settings.currency);

  const periodNetProfit = summary.periodSales - summary.periodCostOfGoodsSold - summary.periodExpenses;

  return (
    <div className="space-y-8 pb-10">
      {/* Header & Date Filter */}
      <div className="flex flex-col lg:flex-row gap-4 justify-between items-start lg:items-center bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">لوحة الإدارة المالية (CFO)</h2>
          <p className="text-gray-500 text-sm mt-1">نظرة شاملة على الأصول، الخزينة والأداء المالي</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-3 bg-slate-50 p-2 rounded-xl border border-slate-100">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-600 px-2">من:</label>
            <DatePicker 
              value={startDate} 
              onChange={setStartDate}
              className="w-36 border-slate-200"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-600 px-2">إلى:</label>
            <DatePicker 
              value={endDate} 
              onChange={setEndDate}
              className="w-36 border-slate-200"
            />
          </div>
          {(startDate || endDate) && (
            <button 
              onClick={() => { setStartDate(''); setEndDate(''); }}
              className="text-xs text-rose-500 font-bold px-2 hover:underline"
            >
              إلغاء الفلتر
            </button>
          )}
        </div>
      </div>

      {/* Row 1: Assets & Liquidity (Absolute Numbers) */}
      <div>
        <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
          <Banknote size={20} className="text-emerald-600" />
          الأصول والسيولة المالية (الرصيد الفعلي الدائم)
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-2xl p-6 text-white shadow-lg relative overflow-hidden">
            <div className="absolute -left-6 -bottom-6 w-32 h-32 bg-white/10 rounded-full blur-2xl"></div>
            <div className="flex justify-between items-start relative z-10">
              <div>
                <p className="text-emerald-100 font-medium mb-1">الرصيد الفعلي بالخزينة</p>
                <h4 className="text-3xl font-black">{formatCurrency(summary.cashInSafe)}</h4>
              </div>
              <div className="bg-white/20 p-3 rounded-xl"><Banknote size={28} /></div>
            </div>
          </div>
          
          <div className="bg-gradient-to-br from-sky-500 to-blue-700 rounded-2xl p-6 text-white shadow-lg relative overflow-hidden">
            <div className="absolute -left-6 -bottom-6 w-32 h-32 bg-white/10 rounded-full blur-2xl"></div>
            <div className="flex justify-between items-start relative z-10">
              <div>
                <p className="text-sky-100 font-medium mb-1">قيمة المخزون (بالتكلفة)</p>
                <h4 className="text-3xl font-black">{formatCurrency(summary.inventoryValue)}</h4>
              </div>
              <div className="bg-white/20 p-3 rounded-xl"><Package size={28} /></div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-purple-500 to-indigo-700 rounded-2xl p-6 text-white shadow-lg relative overflow-hidden">
            <div className="absolute -left-6 -bottom-6 w-32 h-32 bg-white/10 rounded-full blur-2xl"></div>
            <div className="flex justify-between items-start relative z-10">
              <div>
                <p className="text-purple-100 font-medium mb-1">إجمالي حقوق الشركاء</p>
                <h4 className="text-3xl font-black">{formatCurrency(summary.shareholdersEquity)}</h4>
              </div>
              <div className="bg-white/20 p-3 rounded-xl"><PieChart size={28} /></div>
            </div>
          </div>
        </div>
      </div>

      {/* Row 2: Financial Performance (Period Based) */}
      <div>
        <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
          <Activity size={20} className="text-indigo-600" />
          الأداء المالي {startDate || endDate ? '(للفترة المحددة)' : '(الإجمالي)'}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm flex items-center gap-4">
            <div className="bg-green-100 p-3 rounded-xl text-green-600"><DollarSign size={24} /></div>
            <div>
              <p className="text-sm text-slate-500 font-medium">المبيعات</p>
              <p className="text-xl font-bold text-slate-800">{formatCurrency(summary.periodSales)}</p>
            </div>
          </div>
          
          <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm flex items-center gap-4">
            <div className="bg-orange-100 p-3 rounded-xl text-orange-600"><Truck size={24} /></div>
            <div>
              <p className="text-sm text-slate-500 font-medium">المشتريات</p>
              <p className="text-xl font-bold text-slate-800">{formatCurrency(summary.periodPurchases)}</p>
            </div>
          </div>

          <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm flex items-center gap-4">
            <div className="bg-sky-100 p-3 rounded-xl text-sky-600"><Package size={24} /></div>
            <div>
              <p className="text-sm text-slate-500 font-medium">تكلفة المباع</p>
              <p className="text-xl font-bold text-slate-800">{formatCurrency(summary.periodCostOfGoodsSold)}</p>
            </div>
          </div>

          <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm flex items-center gap-4">
            <div className="bg-rose-100 p-3 rounded-xl text-rose-600"><Receipt size={24} /></div>
            <div>
              <p className="text-sm text-slate-500 font-medium">المصروفات</p>
              <p className="text-xl font-bold text-slate-800">{formatCurrency(summary.periodExpenses)}</p>
            </div>
          </div>

          <div className={`border rounded-2xl p-5 shadow-sm flex items-center gap-4 ${periodNetProfit >= 0 ? 'bg-indigo-50 border-indigo-100' : 'bg-rose-50 border-rose-100'}`}>
            <div className={`${periodNetProfit >= 0 ? 'bg-indigo-600' : 'bg-rose-600'} p-3 rounded-xl text-white`}><Calculator size={24} /></div>
            <div>
              <p className={`text-sm font-bold ${periodNetProfit >= 0 ? 'text-indigo-700' : 'text-rose-700'}`}>
                {periodNetProfit >= 0 ? 'صافي الربح' : 'صافي الخسارة'}
              </p>
              <p className={`text-xl font-black ${periodNetProfit >= 0 ? 'text-indigo-900' : 'text-rose-900'}`}>
                {formatCurrency(Math.abs(periodNetProfit))}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Row 3: Balances Grids */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Customer Balances */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden flex flex-col h-[400px]">
          <div className="p-5 border-b border-slate-100 bg-emerald-50 flex justify-between items-center">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              <Users size={20} className="text-emerald-600" />
              أرصدة العملاء (لنا)
            </h3>
            <span className="font-black text-lg text-emerald-700">{formatCurrency(summary.totalCustomersBalance)}</span>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {customers.map(customer => (
              <div key={customer.id} className="p-3 mx-2 my-1 rounded-xl flex justify-between items-center hover:bg-slate-50 border border-transparent hover:border-slate-100 transition-colors">
                <div>
                  <p className="font-bold text-slate-700 text-sm">{customer.name}</p>
                </div>
                <p className={`font-bold text-sm ${customer.balance > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                  {formatCurrency(customer.balance)}
                </p>
              </div>
            ))}
            {customers.length === 0 && <div className="p-8 text-center text-slate-400">لا توجد أرصدة</div>}
          </div>
        </div>

        {/* Supplier Balances */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden flex flex-col h-[400px]">
          <div className="p-5 border-b border-slate-100 bg-amber-50 flex justify-between items-center">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              <Truck size={20} className="text-amber-600" />
              أرصدة الموردين (علينا)
            </h3>
            <span className="font-black text-lg text-amber-700">{formatCurrency(summary.totalSuppliersBalance)}</span>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {suppliers.map(supplier => (
              <div key={supplier.id} className="p-3 mx-2 my-1 rounded-xl flex justify-between items-center hover:bg-slate-50 border border-transparent hover:border-slate-100 transition-colors">
                <div>
                  <p className="font-bold text-slate-700 text-sm">{supplier.name}</p>
                </div>
                <p className={`font-bold text-sm ${supplier.balance > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                  {formatCurrency(supplier.balance)}
                </p>
              </div>
            ))}
            {suppliers.length === 0 && <div className="p-8 text-center text-slate-400">لا توجد أرصدة</div>}
          </div>
        </div>
      </div>

      {/* Row 4: Recent Journal / Cash Movements */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <h3 className="font-bold text-slate-800 flex items-center gap-2">
            <CreditCard size={20} className="text-indigo-600" />
            سجل حركة الخزينة (أحدث العمليات)
          </h3>
          <div className="flex gap-4 text-sm font-bold">
            <span className="text-emerald-600">وارد: {formatCurrency(summary.periodPaymentsIn)}</span>
            <span className="text-rose-600">صادر: {formatCurrency(summary.periodPaymentsOut)}</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-y border-slate-100">
                <th className="px-6 py-3 text-right text-xs font-bold text-slate-500 uppercase tracking-wider">التاريخ</th>
                <th className="px-6 py-3 text-right text-xs font-bold text-slate-500 uppercase tracking-wider">نوع الحركة</th>
                <th className="px-6 py-3 text-right text-xs font-bold text-slate-500 uppercase tracking-wider">البيان</th>
                <th className="px-6 py-3 text-right text-xs font-bold text-slate-500 uppercase tracking-wider">المبلغ</th>
                <th className="px-6 py-3 text-right text-xs font-bold text-slate-500 uppercase tracking-wider">بواسطة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {recentTransactions.map(tx => (
                <tr key={tx.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="px-6 py-4 text-sm text-slate-600">
                    {formatDateTimeDisplay(tx.date)}
                  </td>
                  <td className="px-6 py-4 text-sm">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${
                      tx.type === 'in' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                    }`}>
                      {tx.type === 'in' ? <ArrowDownRight size={14} /> : <ArrowUpRight size={14} />}
                      {tx.type === 'in' ? 'سند قبض' : 'سند صرف'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm font-medium text-slate-800">{tx.description}</td>
                  <td className={`px-6 py-4 text-sm font-black ${tx.type === 'in' ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {formatCurrency(tx.amount)}
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-500">{tx.createdBy}</td>
                </tr>
              ))}
              {recentTransactions.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-slate-400">
                    لا توجد حركات مالية مسجلة في الخزينة
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
