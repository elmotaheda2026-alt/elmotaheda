import React from 'react';
import { Banknote, Users, Truck, ShoppingBag, TrendingUp, Percent, Receipt } from 'lucide-react';
import { api } from '../lib/apiClient';
import { DatePicker } from '../components/DatePicker';
import { formatWholeCurrency } from '../lib/utils';
import { getSettings } from '../lib/storage';

type FinancialMetricTrace = {
  account: string;
  expectedDriver: string;
  amount: number;
};

type DashboardMetrics = {
  cashInSafe: number;
  totalCustomersBalance: number;
  totalSuppliersBalance: number;
  periodSales: number;
  realizedProfits: number;
  deferredProfits: number;
  periodExpenses: number;
  monthlyAverageExpenses: number;
  accountingVariance: number;
  isBalanced: boolean;
};

const fallbackMetrics: DashboardMetrics = {
  cashInSafe: 0,
  totalCustomersBalance: 0,
  totalSuppliersBalance: 0,
  periodSales: 0,
  realizedProfits: 0,
  deferredProfits: 0,
  periodExpenses: 0,
  monthlyAverageExpenses: 0,
  accountingVariance: 0,
  isBalanced: false,
};

const toNumber = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0);

function normalizeMetrics(data: Partial<DashboardMetrics> | null | undefined): DashboardMetrics {
  return {
    ...fallbackMetrics,
    ...data,
    cashInSafe: toNumber(data?.cashInSafe),
    totalCustomersBalance: toNumber(data?.totalCustomersBalance),
    totalSuppliersBalance: toNumber(data?.totalSuppliersBalance),
    periodSales: toNumber(data?.periodSales),
    realizedProfits: toNumber(data?.realizedProfits),
    deferredProfits: toNumber(data?.deferredProfits),
    periodExpenses: toNumber(data?.periodExpenses),
    monthlyAverageExpenses: toNumber(data?.monthlyAverageExpenses),
    accountingVariance: toNumber(data?.accountingVariance),
    isBalanced: Boolean(data?.isBalanced),
  };
}

export default function Accounts() {
  const [startDate, setStartDate] = React.useState('');
  const [endDate, setEndDate] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [metrics, setMetrics] = React.useState<DashboardMetrics>(fallbackMetrics);
  const settings = getSettings();

  React.useEffect(() => {
    let active = true;
    async function loadMetrics() {
      setLoading(true);
      setError(null);
      try {
        const data = await api.getDashboardMetrics({ startDate, endDate });
        if (!active) return;
        setMetrics(normalizeMetrics(data));
      } catch (err) {
        console.error('CEO dashboard metrics request failed:', err);
        if (!active) return;
        setError(err instanceof Error ? err.message : 'تعذر تحميل البيانات المالية');
        setMetrics(fallbackMetrics);
      } finally {
        if (active) setLoading(false);
      }
    }
    loadMetrics();
    return () => {
      active = false;
    };
  }, [startDate, endDate]);

  const m = metrics ?? fallbackMetrics;
  const formatCurrency = (amount: number) => formatWholeCurrency(toNumber(amount), settings?.currency || 'جنيه');

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-slate-50 p-6">
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-5 text-center shadow-sm">
          <div className="mx-auto mb-3 animate-spin text-sky-600" style={{ fontSize: '24px' }}>⏳</div>
          <p className="font-black text-slate-800">جاري تحميل البيانات المالية…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 bg-slate-50/50">
      {/* Header */}
      <div className="flex flex-col gap-4 rounded-xl border border-slate-100 bg-white p-6 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-2xl font-black text-slate-800">لوحة التقارير المالية</h2>
          <p className="mt-1 text-xs font-semibold text-slate-500">ملخص المؤشرات الأساسية للسيولة والأرباح</p>
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
        <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-right shadow-sm">
          <svg className="mt-1 shrink-0 text-rose-600" viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 0C5.372 0 0 5.372 0 12s5.372 12 12 12 12-5.372 12-12S18.628 0 12 0zm0 22c-5.514 0-10-4.486-10-10S6.486 2 12 2s10 4.486 10 10-4.486 10-10 10zm-1-5h2v2h-2v-2zm0-10h2v8h-2V7z"/></svg>
          <div>
            <h4 className="text-sm font-black text-rose-900">خطأ في تحميل البيانات</h4>
            <p className="mt-1 text-xs font-bold text-rose-700">{error}</p>
          </div>
        </div>
      )}

      {/* Liquidity Section */}
      <div>
        <h3 className="mb-3 text-sm font-black text-slate-600">السيولة والأرصدة الجارية</h3>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          <MetricCard
            title="النقدية في الخزينة"
            value={formatCurrency(toNumber(m.cashInSafe))}
            hint="إجمالي المبالغ المتوفرة في الخزينة"
            icon={Banknote}
            tone="bg-emerald-50 text-emerald-600"
            valueClass="text-emerald-600"
          />
          <MetricCard
            title="مستحقات العملاء"
            value={formatCurrency(toNumber(m.totalCustomersBalance))}
            hint="الأرصدة المتبقية للتحصيل من العملاء"
            icon={Users}
            tone="bg-sky-50 text-sky-600"
          />
          <MetricCard
            title="مستحقات الموردين"
            value={formatCurrency(toNumber(m.totalSuppliersBalance))}
            hint="الالتزامات المتوجبة للموردين"
            icon={Truck}
            tone="bg-rose-50 text-rose-600"
            valueClass="text-rose-600"
          />
        </div>
      </div>

      {/* Financial Performance Section */}
      <div>
        <h3 className="mb-3 text-sm font-black text-slate-600">الأداء المالي والأرباح {startDate || endDate ? '(للفترة المحددة)' : '(تراكمي)'}</h3>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="إجمالي المبيعات"
            value={formatCurrency(toNumber(m.periodSales))}
            hint="قيمة العقود المصدرة خلال الفترة"
            icon={ShoppingBag}
            tone="bg-indigo-50 text-indigo-600"
          />
          <MetricCard
            title="الأرباح المحصلة نقداً"
            value={formatCurrency(toNumber(m.realizedProfits))}
            hint="الأرباح التي تم تحصيلها فعلياً"
            icon={TrendingUp}
            tone="bg-emerald-50 text-emerald-600"
            valueClass="text-emerald-600"
          />
          <MetricCard
            title="الأرباح المؤجلة"
            value={formatCurrency(toNumber(m.deferredProfits))}
            hint="الأرباح المتوقعة من الأقساط المتبقية"
            icon={Percent}
            tone="bg-amber-50 text-amber-600"
          />
          <MetricCard
            title="المصروفات التشغيلية"
            value={formatCurrency(toNumber(m.periodExpenses))}
            hint={`متوسط شهري: ${formatCurrency(toNumber(m.monthlyAverageExpenses))}`}
            icon={Receipt}
            tone="bg-rose-50 text-rose-600"
            valueClass="text-rose-600"
          />
        </div>
      </div>
    </div>
  );
}

function MetricCard({ title, value, hint, icon: Icon, tone, valueClass = 'text-slate-900' }: { title: string; value: string; hint: string; icon: React.ElementType; tone: string; valueClass?: string; }) {
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white p-6 shadow-sm transition hover:shadow-md">
      <div className="flex justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-black text-slate-500">{title}</p>
          <h4 className={`mt-2 text-2xl font-black ${valueClass}`}>{value}</h4>
          <p className="mt-1 text-[10px] font-semibold leading-5 text-slate-400">{hint}</p>
        </div>
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${tone}`}>
          <Icon size={20} />
        </div>
      </div>
    </div>
  );
}

