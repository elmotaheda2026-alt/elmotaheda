import React, { useState, useMemo } from 'react';
import { TrendingUp, DollarSign, ShoppingBag, ShoppingCart, PieChart as PieChartIcon, Users, Activity, Award, Gavel } from 'lucide-react';
import { getSales, getPurchases, getExpenses, getSettings, getCustomers } from '../lib/storage';
import { DatePicker } from '../components/DatePicker';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell } from 'recharts';
import { formatDateDisplay } from '../lib/dateUtils';

const TypedAreaChart = AreaChart as any;
const TypedArea = Area as any;
const TypedXAxis = XAxis as any;
const TypedYAxis = YAxis as any;
const TypedCartesianGrid = CartesianGrid as any;
const TypedTooltip = Tooltip as any;
const TypedResponsiveContainer = ResponsiveContainer as any;
const TypedPieChart = PieChart as any;
const TypedPie = Pie as any;
const TypedCell = Cell as any;
const TypedLegend = Legend as any;

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#3b82f6', '#14b8a6'];

export default function Reports() {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const settings = getSettings();

  const allSales = useMemo(() => getSales(), []);
  const allPurchases = useMemo(() => getPurchases(), []);
  const allExpenses = useMemo(() => getExpenses(), []);
  const allCustomers = useMemo(() => getCustomers(), []);
  const suedCustomersCount = useMemo(() => allCustomers.filter(c => c.isSued).length, [allCustomers]);

  // Filter Data
  const isWithinDateRange = (dateStr: string) => {
    if (!startDate && !endDate) return true;
    const date = new Date(dateStr).getTime();
    const start = startDate ? new Date(startDate).getTime() : 0;
    const end = endDate ? new Date(endDate).getTime() : Infinity;
    return date >= start && date <= (end + 86400000);
  };

  const filteredSales = useMemo(() => allSales.filter(s => isWithinDateRange(s.date)), [allSales, startDate, endDate]);
  const filteredPurchases = useMemo(() => allPurchases.filter(p => isWithinDateRange(p.date)), [allPurchases, startDate, endDate]);
  const filteredExpenses = useMemo(() => allExpenses.filter(e => isWithinDateRange(e.date)), [allExpenses, startDate, endDate]);

  const totalSales = filteredSales.reduce((sum, s) => sum + s.total, 0);
  const totalPurchases = filteredPurchases.reduce((sum, p) => sum + p.total, 0);
  const totalExpenses = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);
  const netProfit = totalSales - totalPurchases - totalExpenses;

  // Top Products
  const topProducts = useMemo(() => {
    const productMap = new Map();
    filteredSales.forEach(sale => {
      sale.items.forEach((item: any) => {
        const current = productMap.get(item.productName) || { name: item.productName, qty: 0, revenue: 0 };
        current.qty += item.quantity;
        current.revenue += item.total;
        productMap.set(item.productName, current);
      });
    });
    return Array.from(productMap.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  }, [filteredSales]);

  // Top Customers
  const topCustomers = useMemo(() => {
    const custMap = new Map();
    filteredSales.forEach(sale => {
      const name = sale.customerName || 'عميل نقدي';
      const current = custMap.get(name) || { name, count: 0, revenue: 0 };
      current.count += 1;
      current.revenue += sale.total;
      custMap.set(name, current);
    });
    return Array.from(custMap.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  }, [filteredSales]);

  // Expense Breakdown
  const expenseBreakdown = useMemo(() => {
    const expMap = new Map();
    filteredExpenses.forEach(exp => {
      const cat = (exp as any).category || (exp as any).description || 'مصروفات أخرى';
      const current = expMap.get(cat) || { name: cat, value: 0 };
      current.value += exp.amount;
      expMap.set(cat, current);
    });
    return Array.from(expMap.values()).sort((a, b) => b.value - a.value).slice(0, 5);
  }, [filteredExpenses]);

  // Daily Trend Chart Data (Last 7 Days or Period)
  const trendData = useMemo(() => {
    const datesMap = new Map();
    
    // Just map the days from filtered items
    filteredSales.forEach(sale => {
        const d = formatDateDisplay(sale.date);
        const current = datesMap.get(d) || { date: d, المبيعات: 0, المشتريات: 0 };
        current.المبيعات += sale.total;
        datesMap.set(d, current);
    });
    
    filteredPurchases.forEach(pur => {
        const d = formatDateDisplay(pur.date);
        const current = datesMap.get(d) || { date: d, المبيعات: 0, المشتريات: 0 };
        current.المشتريات += pur.total;
        datesMap.set(d, current);
    });

    // Sort by date ascending roughly (since keys are text, it might not be perfect chronological, 
    // but works fine for a simple dashboard). 
    // For a real production app we'd sort by parsed Date.
    return Array.from(datesMap.values());
  }, [filteredSales, filteredPurchases]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ar-EG').format(amount) + ' ' + settings.currency;
  };

  return (
    <div className="space-y-6 pb-10">
      {/* Header & Compact Date Filter */}
      <div className="flex flex-col lg:flex-row gap-4 justify-between items-start lg:items-center bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">التقارير وذكاء الأعمال (BI)</h2>
          <p className="text-slate-500 text-sm mt-1">تحليل الأداء التجاري والمبيعات والمشتريات</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-3 bg-indigo-50/50 p-2 rounded-xl border border-indigo-100/50">
          <div className="flex items-center gap-2">
            <label className="shrink-0 text-sm font-bold text-indigo-800">من:</label>
            <DatePicker value={startDate} onChange={setStartDate} className="h-12 w-44 shrink-0 border-indigo-200" />
          </div>
          <div className="flex items-center gap-2">
            <label className="shrink-0 text-sm font-bold text-indigo-800">إلى:</label>
            <DatePicker value={endDate} onChange={setEndDate} className="h-12 w-44 shrink-0 border-indigo-200" />
          </div>
          {(startDate || endDate) && (
            <button onClick={() => { setStartDate(''); setEndDate(''); }} className="text-xs text-rose-500 font-bold px-2 hover:underline">
              إلغاء الفلتر
            </button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex items-center gap-4 hover:shadow-md transition-shadow">
          <div className="w-14 h-14 bg-emerald-100 rounded-2xl flex items-center justify-center shrink-0">
            <ShoppingBag size={28} className="text-emerald-600" />
          </div>
          <div>
            <p className="text-slate-500 text-sm font-medium">إجمالي المبيعات</p>
            <p className="text-2xl font-black text-slate-800">{formatCurrency(totalSales)}</p>
            <p className="text-xs text-slate-400 mt-1">{filteredSales.length} فاتورة مسجلة</p>
          </div>
        </div>
        
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex items-center gap-4 hover:shadow-md transition-shadow">
          <div className="w-14 h-14 bg-amber-100 rounded-2xl flex items-center justify-center shrink-0">
            <ShoppingCart size={28} className="text-amber-600" />
          </div>
          <div>
            <p className="text-slate-500 text-sm font-medium">إجمالي المشتريات</p>
            <p className="text-2xl font-black text-slate-800">{formatCurrency(totalPurchases)}</p>
            <p className="text-xs text-slate-400 mt-1">{filteredPurchases.length} فاتورة مسجلة</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex items-center gap-4 hover:shadow-md transition-shadow">
          <div className="w-14 h-14 bg-rose-100 rounded-2xl flex items-center justify-center shrink-0">
            <DollarSign size={28} className="text-rose-600" />
          </div>
          <div>
            <p className="text-slate-500 text-sm font-medium">إجمالي المصروفات</p>
            <p className="text-2xl font-black text-slate-800">{formatCurrency(totalExpenses)}</p>
            <p className="text-xs text-slate-400 mt-1">{filteredExpenses.length} عملية صرف</p>
          </div>
        </div>

        <div className={`rounded-2xl p-6 shadow-sm border flex items-center gap-4 hover:shadow-md transition-shadow ${netProfit >= 0 ? 'bg-indigo-50 border-indigo-100' : 'bg-rose-50 border-rose-100'}`}>
          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 ${netProfit >= 0 ? 'bg-indigo-600' : 'bg-rose-600'}`}>
            <TrendingUp size={28} className="text-white" />
          </div>
          <div>
            <p className={`text-sm font-bold ${netProfit >= 0 ? 'text-indigo-600' : 'text-rose-600'}`}>صافي الأرباح (عن الفترة)</p>
            <p className={`text-2xl font-black ${netProfit >= 0 ? 'text-indigo-900' : 'text-rose-900'}`}>{formatCurrency(Math.abs(netProfit))}</p>
          </div>
        </div>

        <div className="bg-rose-50 rounded-2xl p-6 shadow-sm border border-rose-200 flex items-center gap-4 hover:shadow-md transition-shadow md:col-span-2 lg:col-span-1">
          <div className="w-14 h-14 bg-rose-200 rounded-2xl flex items-center justify-center shrink-0">
            <Gavel size={28} className="text-rose-700" />
          </div>
          <div>
            <p className="text-rose-700 text-sm font-bold">نزاعات قانونية</p>
            <p className="text-2xl font-black text-rose-900">{suedCustomersCount}</p>
            <p className="text-xs text-rose-600 mt-1">عميل محال للقضاء</p>
          </div>
        </div>
      </div>

      {/* Main Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Trend Area Chart */}
        <div className="lg:col-span-2 bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
          <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2">
            <Activity size={20} className="text-indigo-600" />
            اتجاهات المبيعات والمشتريات
          </h3>
          <div className="h-[300px] w-full" dir="ltr">
            {trendData.length > 0 ? (
              <TypedResponsiveContainer width="100%" height="100%">
                <TypedAreaChart data={trendData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorPurchases" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <TypedXAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} dy={10} />
                  <TypedYAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} dx={-10} />
                  <TypedCartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <TypedTooltip 
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
                  <TypedLegend wrapperStyle={{ paddingTop: '20px' }} />
                  <TypedArea type="monotone" dataKey="المبيعات" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#colorSales)" />
                  <TypedArea type="monotone" dataKey="المشتريات" stroke="#f59e0b" strokeWidth={3} fillOpacity={1} fill="url(#colorPurchases)" />
                </TypedAreaChart>
              </TypedResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-400">لا توجد بيانات متاحة لهذه الفترة</div>
            )}
          </div>
        </div>

        {/* Expenses Pie Chart */}
        <div className="lg:col-span-1 bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex flex-col">
          <h3 className="font-bold text-slate-800 mb-2 flex items-center gap-2">
            <PieChartIcon size={20} className="text-rose-500" />
            تحليل المصروفات
          </h3>
          <div className="flex-1 min-h-[250px]" dir="ltr">
             {expenseBreakdown.length > 0 ? (
                <TypedResponsiveContainer width="100%" height="100%">
                  <TypedPieChart>
                    <TypedPie
                      data={expenseBreakdown}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                      nameKey="name"
                    >
                      {expenseBreakdown.map((entry: any, index: number) => (
                        <TypedCell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </TypedPie>
                    <TypedTooltip formatter={(val: number) => formatCurrency(val)} />
                    <TypedLegend verticalAlign="bottom" height={36} />
                  </TypedPieChart>
                </TypedResponsiveContainer>
             ) : (
                 <div className="h-full flex items-center justify-center text-slate-400">لا توجد مصروفات مسجلة</div>
             )}
          </div>
        </div>
      </div>

      {/* Top Lists Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Products */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
          <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2">
            <Award size={20} className="text-amber-500" />
            أفضل المنتجات مبيعاً (Top Products)
          </h3>
          <div className="space-y-4">
            {topProducts.length > 0 ? topProducts.map((prod, idx) => (
              <div key={idx} className="flex items-center justify-between p-4 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center font-bold text-lg">
                    {idx + 1}
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-800">{prod.name}</h4>
                    <p className="text-xs text-slate-500">تم بيع {prod.qty} وحدة</p>
                  </div>
                </div>
                <div className="text-left">
                  <p className="font-black text-emerald-600">{formatCurrency(prod.revenue)}</p>
                </div>
              </div>
            )) : <p className="text-center text-slate-400 py-4">لا توجد مبيعات</p>}
          </div>
        </div>

        {/* Top Customers */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
          <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2">
            <Users size={20} className="text-blue-500" />
            أفضل العملاء (Top Customers)
          </h3>
          <div className="space-y-4">
            {topCustomers.length > 0 ? topCustomers.map((cust, idx) => (
              <div key={idx} className="flex items-center justify-between p-4 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-lg">
                    {idx + 1}
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-800">{cust.name}</h4>
                    <p className="text-xs text-slate-500">{cust.count} فاتورة شراء</p>
                  </div>
                </div>
                <div className="text-left">
                  <p className="font-black text-emerald-600">{formatCurrency(cust.revenue)}</p>
                </div>
              </div>
            )) : <p className="text-center text-slate-400 py-4">لا توجد مبيعات للعملاء</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
