import React, { useState, useMemo } from 'react';
import { TrendingUp, DollarSign, ShoppingBag, ShoppingCart, PieChart as PieChartIcon, Users, Activity, Award, Gavel, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { getSales, getPurchases, getExpenses, getSettings, getCustomers, getProducts, getAgingReport, getCollectionRateReport, getReceivablesReconciliationReport } from '../lib/storage';
import { DatePicker } from '../components/DatePicker';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell, BarChart, Bar } from 'recharts';
import { formatDateDisplay } from '../lib/dateUtils';
import { calculateCostOfGoodsSold, calculateNetProfit } from '../lib/accounting';
import { formatWholeCurrency } from '../lib/utils';

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
const TypedBarChart = BarChart as any;
const TypedBar = Bar as any;

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#3b82f6', '#14b8a6'];

export default function Reports() {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const settings = getSettings();

  const allSales = useMemo(() => getSales(), []);
  const allPurchases = useMemo(() => getPurchases(), []);
  const allExpenses = useMemo(() => getExpenses(), []);
  const allCustomers = useMemo(() => getCustomers(), []);
  const allProducts = useMemo(() => getProducts(), []);
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
  const costOfGoodsSold = calculateCostOfGoodsSold(filteredSales, allProducts);
  const netProfit = calculateNetProfit(filteredSales, allProducts, filteredExpenses);

  // Installments & Collection rates
  const collectionReport = useMemo(() => {
    return getCollectionRateReport(startDate, endDate);
  }, [startDate, endDate]);

  // Receivables Reconciliation
  const reconciliation = useMemo(() => {
    return getReceivablesReconciliationReport();
  }, []);

  // Aging Buckets Data
  const agingData = useMemo(() => {
    const report = getAgingReport();
    const buckets = {
      '0-30': 0,
      '31-60': 0,
      '61-90': 0,
      '90+': 0
    };
    report.forEach(item => {
      buckets[item.bucket as keyof typeof buckets] += item.remaining;
    });
    return [
      { name: '0-30 يوم', المبالغ: Math.round(buckets['0-30']) },
      { name: '31-60 يوم', المبالغ: Math.round(buckets['31-60']) },
      { name: '61-90 يوم', المبالغ: Math.round(buckets['61-90']) },
      { name: '90+ يوم', المبالغ: Math.round(buckets['90+']) },
    ];
  }, []);

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

  // Daily Trend Chart Data
  const trendData = useMemo(() => {
    const datesMap = new Map();
    
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

    return Array.from(datesMap.values());
  }, [filteredSales, filteredPurchases]);

  const formatCurrency = (amount: number) => formatWholeCurrency(amount, settings.currency);

  return (
    <div className="space-y-6 pb-10">
      {/* Header & Date Filter */}
      <div className="flex flex-col lg:flex-row gap-4 justify-between items-start lg:items-center bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">التقارير وذكاء الأعمال (BI)</h2>
          <p className="text-slate-500 text-sm mt-1">تحليل الأداء المالي، المبيعات الآجلة، الديون، ومعدلات التحصيل اللحظية</p>
        </div>
        
        <div className="flex flex-wrap items-end gap-4 bg-indigo-50/50 p-2 rounded-xl border border-indigo-100/50">
          <div className="flex flex-col gap-2">
            <label className="text-center text-xs font-bold text-slate-500">من تاريخ</label>
            <DatePicker value={startDate} onChange={setStartDate} className="h-12 w-44 shrink-0 border-indigo-200" />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-center text-xs font-bold text-slate-500">إلى تاريخ</label>
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
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 flex items-center gap-4 hover:shadow-md transition-shadow">
          <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center shrink-0">
            <ShoppingBag size={24} className="text-indigo-600" />
          </div>
          <div>
            <p className="text-slate-500 text-xs font-medium">إجمالي المبيعات الآجلة</p>
            <p className="text-xl font-black text-slate-800">{formatCurrency(totalSales)}</p>
            <p className="text-xs text-slate-400 mt-1">{filteredSales.length} تعاقد مسجل</p>
          </div>
        </div>
        
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 flex items-center gap-4 hover:shadow-md transition-shadow">
          <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center shrink-0">
            <TrendingUp size={24} className="text-emerald-600" />
          </div>
          <div>
            <p className="text-slate-500 text-xs font-medium">المحصل الفعلي</p>
            <p className="text-xl font-black text-emerald-600">{formatCurrency(collectionReport.collected)}</p>
            <p className="text-xs text-slate-400 mt-1">مدفوعات داخل الخزينة</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 flex items-center gap-4 hover:shadow-md transition-shadow">
          <div className="w-12 h-12 bg-sky-100 rounded-xl flex items-center justify-center shrink-0">
            <PieChartIcon size={24} className="text-sky-600" />
          </div>
          <div>
            <p className="text-slate-500 text-xs font-medium">معدل التحصيل</p>
            <p className="text-xl font-black text-sky-600">{collectionReport.collectionRate}%</p>
            <p className="text-xs text-slate-400 mt-1">من المبيعات المستهدفة</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 flex items-center gap-4 hover:shadow-md transition-shadow">
          <div className="w-12 h-12 bg-rose-100 rounded-xl flex items-center justify-center shrink-0">
            <DollarSign size={24} className="text-rose-600" />
          </div>
          <div>
            <p className="text-slate-500 text-xs font-medium">إجمالي المصروفات</p>
            <p className="text-xl font-black text-slate-800">{formatCurrency(totalExpenses)}</p>
            <p className="text-xs text-slate-400 mt-1">{filteredExpenses.length} إيصال مصروفات</p>
          </div>
        </div>

        <div className="bg-rose-50 rounded-2xl p-5 shadow-sm border border-rose-100 flex items-center gap-4 hover:shadow-md transition-shadow">
          <div className="w-12 h-12 bg-rose-200 rounded-xl flex items-center justify-center shrink-0">
            <Gavel size={24} className="text-rose-700" />
          </div>
          <div>
            <p className="text-rose-700 text-xs font-bold">نزاعات قانونية</p>
            <p className="text-xl font-black text-rose-900">{suedCustomersCount}</p>
            <p className="text-xs text-rose-600 mt-1">عملاء محالين للقضاء</p>
          </div>
        </div>
      </div>

      {/* Reconciliation Alert Banner */}
      {reconciliation.hasAlert ? (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-amber-50 border border-amber-200 rounded-2xl p-4 shadow-sm text-right">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 text-amber-800 rounded-xl shrink-0">
              <AlertTriangle size={20} />
            </div>
            <div>
              <h4 className="font-bold text-amber-900 text-sm sm:text-base">تنبيه مطابقة حسابات المدينين!</h4>
              <p className="text-xs sm:text-sm text-amber-700 mt-0.5">
                هناك تفاوت مالي في المديونيات بمقدار <span className="font-bold">{formatCurrency(Math.abs(reconciliation.variance))}</span>. يرجى مراجعة عمليات ترحيل الفواتير أو الدفعات الملغاة.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-emerald-50/70 border border-emerald-100 rounded-2xl p-4 shadow-sm text-right">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-100 text-emerald-800 rounded-xl shrink-0">
              <CheckCircle2 size={20} className="text-emerald-600" />
            </div>
            <div>
              <h4 className="font-bold text-emerald-950 text-sm sm:text-base">مطابقة الحسابات سليمة</h4>
              <p className="text-xs sm:text-sm text-emerald-700 mt-0.5">
                تطابق الحسابات 100% بين المبيعات الآجلة والمبالغ المحصلة والذمم المتبقية. الفروقات المالية: <span className="font-bold">0 جنيه</span>.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Charts Row */}
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

        {/* Receivables Aging Bar Chart */}
        <div className="lg:col-span-1 bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex flex-col">
          <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2">
            <PieChartIcon size={20} className="text-rose-500" />
            أعمار ديون العملاء المتأخرة (Receivables Aging)
          </h3>
          <div className="flex-1 min-h-[250px]" dir="ltr">
            {agingData.some(b => b.المبالغ > 0) ? (
              <TypedResponsiveContainer width="100%" height="100%">
                <TypedBarChart data={agingData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <TypedCartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <TypedXAxis dataKey="name" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} dy={5} />
                  <TypedYAxis tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} dx={-10} />
                  <TypedTooltip 
                    formatter={(val: number) => formatCurrency(val)} 
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
                  <TypedBar dataKey="المبالغ" fill="#f43f5e" radius={[6, 6, 0, 0]} barSize={32} />
                </TypedBarChart>
              </TypedResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-400 text-center">
                لا توجد مديونيات متأخرة حالياً. الحسابات نظيفة! 🎉
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Row 3: Lists & Expenses Pie Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Expenses Pie Chart */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex flex-col">
          <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2">
            <PieChartIcon size={20} className="text-amber-500" />
            تحليل المصروفات التشغيلية
          </h3>
          <div className="flex-1 min-h-[220px]" dir="ltr">
             {expenseBreakdown.length > 0 ? (
                <TypedResponsiveContainer width="100%" height="100%">
                  <TypedPieChart>
                    <TypedPie
                      data={expenseBreakdown}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={75}
                      paddingAngle={4}
                      dataKey="value"
                      nameKey="name"
                    >
                      {expenseBreakdown.map((entry: any, index: number) => (
                        <TypedCell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </TypedPie>
                    <TypedTooltip formatter={(val: number) => formatCurrency(val)} />
                    <TypedLegend verticalAlign="bottom" height={36} iconType="circle" />
                  </TypedPieChart>
                </TypedResponsiveContainer>
             ) : (
                  <div className="h-full flex items-center justify-center text-slate-400">لا توجد مصروفات مسجلة</div>
             )}
          </div>
        </div>

        {/* Top Products */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
          <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2">
            <Award size={20} className="text-indigo-600" />
            أفضل المنتجات مبيعاً (Top Products)
          </h3>
          <div className="space-y-3.5">
            {topProducts.length > 0 ? topProducts.map((prod, idx) => (
              <div key={idx} className="flex items-center justify-between p-3.5 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-sm">
                    {idx + 1}
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-800 text-sm">{prod.name}</h4>
                    <p className="text-xs text-slate-500">تم بيع {prod.qty} وحدة</p>
                  </div>
                </div>
                <div className="text-left">
                  <p className="font-black text-slate-800 text-sm">{formatCurrency(prod.revenue)}</p>
                </div>
              </div>
            )) : <p className="text-center text-slate-400 py-4">لا توجد مبيعات</p>}
          </div>
        </div>

        {/* Top Customers */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
          <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2">
            <Users size={20} className="text-sky-500" />
            أفضل العملاء (Top Customers)
          </h3>
          <div className="space-y-3.5">
            {topCustomers.length > 0 ? topCustomers.map((cust, idx) => (
              <div key={idx} className="flex items-center justify-between p-3.5 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-sky-100 text-sky-600 flex items-center justify-center font-bold text-sm">
                    {idx + 1}
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-800 text-sm">{cust.name}</h4>
                    <p className="text-xs text-slate-500">{cust.count} فاتورة شراء</p>
                  </div>
                </div>
                <div className="text-left">
                  <p className="font-black text-slate-800 text-sm">{formatCurrency(cust.revenue)}</p>
                </div>
              </div>
            )) : <p className="text-center text-slate-400 py-4">لا توجد مبيعات للعملاء</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
