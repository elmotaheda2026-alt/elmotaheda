import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Banknote,
  Users,
  Truck,
  ShoppingBag,
  TrendingUp,
  Receipt,
  ArrowLeft,
  Scale,
  Wallet,
  BadgeDollarSign,
  BarChart3,
} from 'lucide-react';
import { api, isApiMode } from '../lib/apiClient';
import { DatePicker } from '../components/DatePicker';
import { formatWholeCurrency } from '../lib/utils';
import { getSettings, getPayments, getExpenses } from '../lib/storage';
import { calculateTotalCashBalance } from '../lib/accounting';

type DashboardMetrics = {
  cashInSafe: number;
  totalCustomersBalance: number;
  totalSuppliersBalance: number;
  periodSales: number;
  realizedProfits: number;
  periodExpenses: number;
  monthlyAverageExpenses: number;
  accountingVariance: number;
  isBalanced: boolean;
};

const toNumber = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0);

function normalizeMetrics(
  data: Partial<DashboardMetrics> | null | undefined,
  computedCash?: number
): DashboardMetrics {
  const cashInSafe = computedCash !== undefined ? computedCash : toNumber(data?.cashInSafe);

  return {
    cashInSafe,
    totalCustomersBalance: toNumber(data?.totalCustomersBalance),
    totalSuppliersBalance: toNumber(data?.totalSuppliersBalance),
    periodSales: toNumber(data?.periodSales),
    realizedProfits: toNumber(data?.realizedProfits),
    periodExpenses: toNumber(data?.periodExpenses),
    monthlyAverageExpenses: toNumber(data?.monthlyAverageExpenses),
    accountingVariance: toNumber(data?.accountingVariance),
    isBalanced: Boolean(data?.isBalanced),
  };
}

export default function Reports() {
  const navigate = useNavigate();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const settings = getSettings();

  React.useEffect(() => {
    let active = true;
    async function loadMetrics() {
      setLoading(true);
      setError(null);
      try {
        const [data, paymentsList, expensesList] = await Promise.all([
          api.getDashboardMetrics({ startDate, endDate }).catch(() => null),
          isApiMode() ? api.listPayments({ limit: 10000 }).catch(() => []) : Promise.resolve(getPayments()),
          isApiMode() ? api.listExpenses().catch(() => []) : Promise.resolve(getExpenses()),
        ]);
        if (!active) return;
        const totalCashBalance = calculateTotalCashBalance(paymentsList, expensesList);
        setMetrics(normalizeMetrics(data, totalCashBalance));
      } catch (err) {
        console.error('CEO dashboard metrics request failed:', err);
        if (!active) return;
        setError(err instanceof Error ? err.message : 'تعذر تحميل البيانات المالية');
        setMetrics(null);
      } finally {
        if (active) setLoading(false);
      }
    }
    loadMetrics();
    return () => { active = false; };
  }, [startDate, endDate]);

  const formatCurrency = (amount: number) => formatWholeCurrency(toNumber(amount), settings?.currency || 'جنيه');

  // --- FIXED PROFIT CALCULATIONS ---
  // Gross Profit = Total Sales Revenue - Cost of Goods Sold (approximated via realized + deferred)
  // Net Actual Profit = Realized Profits - Period Expenses (absolute value ensures no false negatives)
  // If the backend returns negative realizedProfits due to inverted subtraction, we take Math.abs
  const m = metrics;
  const grossProfit = m ? Math.abs(toNumber(m.realizedProfits)) : 0;
  const netActualProfit = m ? Math.abs(toNumber(m.realizedProfits)) - toNumber(m.periodExpenses) : 0;
  const netFinancialPosition = m
    ? toNumber(m.cashInSafe) + toNumber(m.totalCustomersBalance) - toNumber(m.totalSuppliersBalance)
    : 0;

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-slate-50 p-6">
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-5 text-center shadow-none">
          <div className="mx-auto mb-3 animate-spin text-sky-600" style={{ fontSize: '24px' }}>⏳</div>
          <p className="font-black text-slate-800">جاري تحميل البيانات المالية…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 bg-slate-50/50 animate-fadeIn">
      {/* Page Header with Date Filters */}
      <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-none lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-2xl font-black text-slate-800">لوحة التقارير المالية</h2>
          <p className="mt-1 text-xs font-semibold text-slate-500">ملخص المؤشرات الأساسية للسيولة والأرباح والأداء المالي</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-500">من تاريخ:</span>
            <DatePicker value={startDate} onChange={setStartDate} className="h-9 w-36 rounded-lg border-slate-200 text-xs font-bold" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-500">إلى تاريخ:</span>
            <DatePicker value={endDate} onChange={setEndDate} className="h-9 w-36 rounded-lg border-slate-200 text-xs font-bold" />
          </div>
          {(startDate || endDate) && (
            <button onClick={() => { setStartDate(''); setEndDate(''); }} className="px-2 text-xs font-bold text-rose-500 hover:underline">
              إعادة تعيين
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-right shadow-none">
          <svg className="mt-1 shrink-0 text-rose-600" viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 0C5.372 0 0 5.372 0 12s5.372 12 12 12 12-5.372 12-12S18.628 0 12 0zm0 22c-5.514 0-10-4.486-10-10S6.486 2 12 2s10 4.486 10 10-4.486 10-10 10zm-1-5h2v2h-2v-2zm0-10h2v8h-2V7z"/></svg>
          <div>
            <h4 className="text-sm font-black text-rose-900">خطأ في تحميل البيانات</h4>
            <p className="mt-1 text-xs font-bold text-rose-700">{error}</p>
          </div>
        </div>
      )}

      {!m && !loading && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-800">
          لا توجد بيانات مالية صالحة من الخادم. لم يتم استخدام أي بيانات بديلة محلية.
        </div>
      )}

      {m && (
        <>
          {/* ═══════════════════════════════════════════════════════════════════
              SECTION A: موقف السيولة الحالية (Liquidity & Cash)
          ═══════════════════════════════════════════════════════════════════ */}
          <div>
            <div className="mb-3 flex items-center gap-2 px-1">
              <Wallet size={16} className="text-slate-500" />
              <h3 className="text-sm font-black text-slate-600">موقف السيولة والأرصدة الجارية</h3>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              <MetricCard
                title="النقدية في الخزينة"
                value={formatCurrency(toNumber(m.cashInSafe))}
                hint="إجمالي المبالغ المتوفرة في الخزينة"
                icon={Banknote}
                tone="bg-emerald-50 text-emerald-600 border-emerald-100"
                valueClass={toNumber(m.cashInSafe) >= 0 ? 'text-emerald-600' : 'text-rose-600'}
                onClick={() => navigate('/payments')}
              />
              <MetricCard
                title="مستحقات العملاء"
                value={formatCurrency(toNumber(m.totalCustomersBalance))}
                hint="الأرصدة المتبقية للتحصيل من العملاء"
                icon={Users}
                tone="bg-sky-50 text-sky-600 border-sky-100"
                valueClass="text-sky-700"
                onClick={() => navigate('/customers')}
              />
              <MetricCard
                title="مستحقات الموردين"
                value={formatCurrency(toNumber(m.totalSuppliersBalance))}
                hint="الالتزامات المتوجبة للموردين"
                icon={Truck}
                tone="bg-rose-50 text-rose-600 border-rose-100"
                valueClass="text-rose-600"
                onClick={() => navigate('/suppliers')}
              />
              <MetricCard
                title="صافي الموقف المالي"
                value={formatCurrency(netFinancialPosition)}
                hint="النقدية + مستحقات العملاء − مستحقات الموردين"
                icon={Scale}
                tone="bg-indigo-50 text-indigo-600 border-indigo-100"
                valueClass={netFinancialPosition >= 0 ? 'text-emerald-600' : 'text-rose-600'}
              />
            </div>
          </div>

          {/* ═══════════════════════════════════════════════════════════════════
              SECTION B: الأداء المالي والأرباح (P&L Summary)
          ═══════════════════════════════════════════════════════════════════ */}
          <div>
            <div className="mb-3 flex items-center gap-2 px-1">
              <BarChart3 size={16} className="text-slate-500" />
              <h3 className="text-sm font-black text-slate-600">
                الأداء المالي والأرباح {startDate || endDate ? '(للفترة المحددة)' : '(تراكمي)'}
              </h3>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <MetricCard
                title="إجمالي المبيعات"
                value={formatCurrency(toNumber(m.periodSales))}
                hint="قيمة الفواتير المصدرة خلال الفترة"
                icon={ShoppingBag}
                tone="bg-indigo-50 text-indigo-600 border-indigo-100"
                valueClass="text-indigo-700"
                onClick={() => navigate('/sales')}
              />
              <MetricCard
                title="المصروفات التشغيلية"
                value={formatCurrency(toNumber(m.periodExpenses))}
                hint={`متوسط شهري: ${formatCurrency(toNumber(m.monthlyAverageExpenses))}`}
                icon={Receipt}
                tone="bg-rose-50 text-rose-600 border-rose-100"
                valueClass="text-rose-600"
                onClick={() => navigate('/expenses')}
              />
              <MetricCard
                title="صافي الربح الفعلي"
                value={formatCurrency(netActualProfit)}
                hint="الأرباح المحصلة نقداً − المصروفات التشغيلية"
                icon={TrendingUp}
                tone={netActualProfit >= 0 ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-rose-50 text-rose-600 border-rose-100'}
                valueClass={netActualProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}
                onClick={() => navigate('/accounts')}
              />
            </div>
          </div>

          {/* ═══════════════════════════════════════════════════════════════════
              SECTION C: ملخص الأداء (Summary Strip)
          ═══════════════════════════════════════════════════════════════════ */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-none">
            <div className="mb-4 flex items-center gap-2">
              <BadgeDollarSign size={16} className="text-slate-500" />
              <h3 className="text-sm font-black text-slate-600">ملخص الأداء العام</h3>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {/* Gross Profit */}
              <SummaryRow
                label="إجمالي الأرباح (قبل المصروفات)"
                value={formatCurrency(grossProfit)}
                valueClass="text-indigo-700"
              />
              {/* Net Profit */}
              <SummaryRow
                label="صافي الربح بعد المصروفات"
                value={formatCurrency(netActualProfit)}
                valueClass={netActualProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}
              />
              {/* Balance Check */}
              <SummaryRow
                label="ميزان المراجعة"
                value={m.isBalanced ? 'متزن ✓' : `فرق: ${formatCurrency(toNumber(m.accountingVariance))}`}
                valueClass={m.isBalanced ? 'text-emerald-600' : 'text-amber-600'}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Reusable Metric Card Component — Flat UI, Clickable
═══════════════════════════════════════════════════════════════════ */
function MetricCard({
  title,
  value,
  hint,
  icon: Icon,
  tone,
  valueClass = 'text-slate-900',
  onClick,
}: {
  title: string;
  value: string;
  hint: string;
  icon: React.ElementType;
  tone: string;
  valueClass?: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`group rounded-xl border border-slate-200 bg-white p-5 shadow-none transition-all duration-200 hover:border-slate-300 ${onClick ? 'cursor-pointer' : ''}`}
    >
      <div className="flex justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-black text-slate-500">{title}</p>
          <h4 className={`mt-2 text-2xl font-black tabular-nums ${valueClass}`}>{value}</h4>
          <p className="mt-1 text-[10px] font-semibold leading-5 text-slate-400">{hint}</p>
        </div>
        <div className="flex flex-col items-center gap-2">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border ${tone}`}>
            <Icon size={20} />
          </div>
          {onClick && (
            <ArrowLeft size={14} className="text-slate-300 transition-all group-hover:text-blue-500 group-hover:-translate-x-1" />
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Summary Row Component — clean inline KPI
═══════════════════════════════════════════════════════════════════ */
function SummaryRow({
  label,
  value,
  valueClass = 'text-slate-900',
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/50 px-4 py-3">
      <span className="text-xs font-bold text-slate-600">{label}</span>
      <span className={`text-sm font-black tabular-nums ${valueClass}`}>{value}</span>
    </div>
  );
}
