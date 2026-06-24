import React, { useState, useMemo } from 'react';
import { TrendingUp, DollarSign, ShoppingBag, PieChart as PieChartIcon, Users, Activity, AlertTriangle, CheckCircle2, Calendar, Landmark, Percent } from 'lucide-react';
import { getSales, getExpenses, getSettings, getCustomers, getProducts, getAgingReport, getCollectionRateReport, getReceivablesReconciliationReport, getRealizedProfitReport } from '../lib/storage';
import { DatePicker } from '../components/DatePicker';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell, BarChart, Bar } from 'recharts';
import { calculateCostOfGoodsSold } from '../lib/accounting';
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
  const filteredExpenses = useMemo(() => allExpenses.filter(e => isWithinDateRange(e.date)), [allExpenses, startDate, endDate]);

  const totalSales = filteredSales.reduce((sum, s) => sum + s.total, 0);
  const totalExpenses = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);
  const costOfGoodsSold = calculateCostOfGoodsSold(filteredSales, allProducts);

  // Financial Margins for financing model (Markup / Profit Ratio)
  const marginRatio = useMemo(() => {
    return totalSales > 0 ? (totalSales - costOfGoodsSold) / totalSales : 0;
  }, [totalSales, costOfGoodsSold]);

  // Realized Profits from actual posted customer payments in the selected period.
  const realizedProfitReport = useMemo(() => {
    return getRealizedProfitReport(startDate, endDate);
  }, [startDate, endDate]);
  const realizedProfits = realizedProfitReport.netRealized;

  // Deferred Profits (Profit expected from remaining receivables)
  const deferredProfits = useMemo(() => {
    const remainingReceivables = filteredSales.reduce((sum, s) => sum + s.remaining, 0);
    return remainingReceivables * Math.max(0, marginRatio);
  }, [filteredSales, marginRatio]);

  // Receivables Reconciliation
  const reconciliation = useMemo(() => {
    return getReceivablesReconciliationReport(startDate, endDate);
  }, [startDate, endDate]);

  // Collection Rate Report
  const collectionReport = useMemo(() => {
    return getCollectionRateReport(startDate, endDate);
  }, [startDate, endDate]);

  // Future Cash Inflow Forecast (group future installments by month)
  const futureInstallments = useMemo(() => {
    const list: { dateStr: string; amount: number }[] = [];
    allSales.forEach(sale => {
      if (sale.financing?.schedules) {
        sale.financing.schedules.forEach(sched => {
          if (sched.status !== 'paid') {
            const [year, month] = sched.dueDate.split('-');
            if (year && month) {
              list.push({ dateStr: `${year}-${month}`, amount: sched.amount - sched.paidAmount });
            }
          }
        });
      }
    });
    
    const monthlyMap = new Map<string, number>();
    list.forEach(item => {
      const val = monthlyMap.get(item.dateStr) || 0;
      monthlyMap.set(item.dateStr, val + item.amount);
    });
    
    const arabicMonths: Record<string, string> = {
      '01': 'يناير', '02': 'فبراير', '03': 'مارس', '04': 'أبريل', '05': 'مايو', '06': 'يونيو',
      '07': 'يوليو', '08': 'أغسطس', '09': 'سبتمبر', '10': 'أكتوبر', '11': 'نوفمبر', '12': 'ديسمبر'
    };
    
    const now = new Date();
    const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    return Array.from(monthlyMap.entries())
      .filter(([dateStr]) => dateStr >= currentYearMonth) // only current/future months
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(0, 6) // next 6 months
      .map(([dateStr, amount]) => {
        const [, month] = dateStr.split('-');
        const monthName = arabicMonths[month] || month;
        return {
          month: monthName,
          المستحقات: Math.round(amount)
        };
      });
  }, [allSales]);

  // Aging Buckets and Total Overdue
  const { agingData, totalOverdue } = useMemo(() => {
    const report = getAgingReport(endDate || new Date().toISOString().slice(0, 10));
    const buckets = {
      '0-30': 0,
      '31-60': 0,
      '61-90': 0,
      '90+': 0
    };
    let sum = 0;
    report.forEach(item => {
      buckets[item.bucket as keyof typeof buckets] += item.remaining;
      sum += item.remaining;
    });
    return {
      agingData: [
        { name: '0-30 يوم', المبالغ: Math.round(buckets['0-30']) },
        { name: '31-60 يوم', المبالغ: Math.round(buckets['31-60']) },
        { name: '61-90 يوم', المبالغ: Math.round(buckets['61-90']) },
        { name: '90+ يوم', المبالغ: Math.round(buckets['90+']) },
      ],
      totalOverdue: sum
    };
  }, [endDate]);

  // Top Customers by total financing contract value
  const topCustomers = useMemo(() => {
    const custMap = new Map();
    filteredSales.forEach(sale => {
      const name = sale.customerName || 'عميل تمويلي';
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

  const formatCurrency = (amount: number) => formatWholeCurrency(amount, settings.currency);

  return (
    <div className="space-y-6 pb-10">
      {/* Header & Date Filter */}
      <div className="flex flex-col lg:flex-row gap-4 justify-between items-start lg:items-center bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">📊 لوحة إدارة التمويل والتدفقات النقدية (BI)</h2>
          <p className="text-slate-500 text-sm mt-1">تحليل حركة رأس المال الممول للأقساط، الأرباح الآجلة، والدورات النقدية</p>
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
            <p className="text-slate-500 text-xs font-medium">حجم المحفظة التمويلية</p>
            <p className="text-xl font-black text-slate-800">{formatCurrency(totalSales)}</p>
            <p className="text-xs text-slate-400 mt-1">{filteredSales.length} عقد تمويل نشط</p>
          </div>
        </div>
        
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 flex items-center gap-4 hover:shadow-md transition-shadow">
          <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center shrink-0">
            <Landmark size={24} className="text-emerald-600" />
          </div>
          <div>
            <p className="text-slate-500 text-xs font-medium">رأس المال الممول</p>
            <p className="text-xl font-black text-slate-800">{formatCurrency(costOfGoodsSold)}</p>
            <p className="text-xs text-slate-400 mt-1">كاش مدفوع للموردين</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 flex items-center gap-4 hover:shadow-md transition-shadow">
          <div className="w-12 h-12 bg-rose-100 rounded-xl flex items-center justify-center shrink-0">
            <AlertTriangle size={24} className={`text-rose-600 ${totalOverdue > 0 ? 'animate-pulse' : ''}`} />
          </div>
          <div>
            <p className="text-slate-500 text-xs font-medium">أقساط متأخرة (مجمدة)</p>
            <p className="text-xl font-black text-rose-600">{formatCurrency(totalOverdue)}</p>
            {suedCustomersCount > 0 ? (
              <p className="text-xs text-rose-500 font-semibold mt-1">منهم {suedCustomersCount} محال للقضاء</p>
            ) : (
              <p className="text-xs text-slate-400 mt-1">حسابات نشطة</p>
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 flex items-center gap-4 hover:shadow-md transition-shadow">
          <div className="w-12 h-12 bg-sky-100 rounded-xl flex items-center justify-center shrink-0">
            <Percent size={24} className="text-sky-600" />
          </div>
          <div>
            <p className="text-slate-500 text-xs font-medium">أرباح تمويل مرحّلة (آجلة)</p>
            <p className="text-xl font-black text-slate-800">{formatCurrency(deferredProfits)}</p>
            <p className="text-xs text-slate-400 mt-1">تُحصل مع الأقساط</p>
          </div>
        </div>

        <div className="bg-emerald-50 rounded-2xl p-5 shadow-sm border border-emerald-100 flex items-center gap-4 hover:shadow-md transition-shadow">
          <div className="w-12 h-12 bg-emerald-200 rounded-xl flex items-center justify-center shrink-0">
            <TrendingUp size={24} className="text-emerald-700" />
          </div>
          <div>
            <p className="text-emerald-800 text-xs font-bold">أرباح محصلة نقدياً</p>
            <p className={`text-xl font-black ${realizedProfits < 0 ? 'text-rose-700' : 'text-emerald-900'}`}>{formatCurrency(realizedProfits)}</p>
            <p className="text-xs text-emerald-600 mt-1">صافي أرباح كاش محققة</p>
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
                هناك تفاوت مالي في مديونيات العملاء الإجمالية بمقدار <span className="font-bold">{formatCurrency(Math.abs(reconciliation.variance))}</span>. يرجى مراجعة ترحيل الدفعات بالخزنة.
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
        {/* Expected Future Cash Inflows Area Chart */}
        <div className="lg:col-span-2 bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
          <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2">
            <Calendar size={20} className="text-indigo-600" />
            توقعات التدفقات النقدية القادمة من الأقساط (الـ 6 أشهر القادمة)
          </h3>
          <div className="h-[300px] w-full" dir="ltr">
            {futureInstallments.length > 0 ? (
              <TypedResponsiveContainer width="100%" height="100%">
                <TypedAreaChart data={futureInstallments} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorCashInflow" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <TypedXAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} dy={10} />
                  <TypedYAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} dx={-10} />
                  <TypedCartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <TypedTooltip 
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
                  <TypedArea type="monotone" dataKey="المستحقات" stroke="#6366f1" strokeWidth={3} fillOpacity={1} fill="url(#colorCashInflow)" />
                </TypedAreaChart>
              </TypedResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-400">لا توجد أقساط مستقبلية مستحقة</div>
            )}
          </div>
        </div>

        {/* Receivables Aging Bar Chart */}
        <div className="lg:col-span-1 bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex flex-col">
          <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2">
            <Activity size={20} className="text-rose-500" />
            توزيع الديون المتأخرة للعملاء (أعمار الديون)
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

        {/* Financing Portfolio Summary Statistics */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex flex-col">
          <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2">
            <Landmark size={20} className="text-indigo-600" />
            ملخص ومطابقة المحفظة التمويلية
          </h3>
          <div className="flex-1 space-y-4">
            <div className="flex justify-between border-b border-slate-100 pb-2">
              <span className="text-slate-500 text-sm">إجمالي عقود الآجل (مبيعات):</span>
              <span className="font-bold text-slate-800">{formatCurrency(reconciliation.totalDeferredSales)}</span>
            </div>
            <div className="flex justify-between border-b border-slate-100 pb-2">
              <span className="text-slate-500 text-sm">إجمالي المبالغ المحصلة كاش:</span>
              <span className="font-bold text-emerald-600">+{formatCurrency(reconciliation.totalCollected)}</span>
            </div>
            <div className="flex justify-between border-b border-slate-100 pb-2">
              <span className="text-slate-500 text-sm">إجمالي المستحقات المتبقية بالخارج:</span>
              <span className="font-bold text-sky-600">{formatCurrency(reconciliation.totalRemaining)}</span>
            </div>
            <div className="flex justify-between border-b border-slate-100 pb-2">
              <span className="text-slate-500 text-sm">الفروقات المالية المكتشفة:</span>
              <span className={`font-bold ${reconciliation.hasAlert ? 'text-rose-600' : 'text-slate-800'}`}>
                {formatCurrency(Math.abs(reconciliation.variance))}
              </span>
            </div>
            <div className="flex justify-between pt-2">
              <span className="text-slate-500 text-sm">معدل الفوائد/الربح المستهدف:</span>
              <span className="font-extrabold text-slate-800">
                {marginRatio > 0 ? `${Math.round(marginRatio * 100)}%` : '0%'}
              </span>
            </div>
          </div>
        </div>

        {/* Top Financed Customers */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
          <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2">
            <Users size={20} className="text-sky-500" />
            أكثر العملاء تمويلاً (Top Financed Customers)
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
                    <p className="text-xs text-slate-500">{cust.count} عقد تمويل</p>
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
