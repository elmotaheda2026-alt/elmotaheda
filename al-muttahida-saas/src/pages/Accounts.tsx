import React, { useState, useMemo, useCallback } from 'react';
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
  BarChart3,
  CalendarDays,
  RefreshCw,
  Package,
  Warehouse,
} from 'lucide-react';
import { api, isApiMode } from '../lib/apiClient';
import { useRealtimeSync } from '../lib/realtimeSync';
import { DatePicker } from '../components/DatePicker';
import { formatWholeCurrency } from '../lib/utils';
import { calculateTotalCashBalance } from '../lib/accounting';
import { getSettings, getPayments, getExpenses, getOpeningBalances } from '../lib/storage';
import LoadingState from '../components/LoadingState';
import CurrencyText from '../components/CurrencyText';

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────
type DashboardMetrics = {
  cashInSafe: number;
  totalCustomersBalance: number;
  totalSuppliersBalance: number;
  periodGrossSales: number;
  periodEarlySettlementDiscounts: number;
  periodSales: number;
  periodCostOfGoodsSold: number;
  periodGrossProfit: number;
  periodWarehouseProfit: number;
  periodFinancingProfit: number;
  periodOperatingNetProfit: number;
  warehouseProfit: number;
  realizedCashCollections: number;
  realizedSaleMargin: number;
  realizedProfits: number;
  periodExpenses: number;
  allTimeExpenses: number;
  monthlyAverageExpenses: number;
  accountingVariance: number;
  isBalanced: boolean;
};

type PresetKey = 'today' | 'week' | 'month' | 'quarter' | 'year' | 'custom';

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────
const toNumber = (value: unknown): number =>
  Number.isFinite(Number(value)) ? Number(value) : 0;

const pad = (n: number) => String(n).padStart(2, '0');

function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Compute { startDate, endDate } for each quick-filter preset */
function getPresetRange(key: PresetKey): { startDate: string; endDate: string } {
  const now = new Date();
  const today = toISO(now);

  switch (key) {
    case 'today':
      return { startDate: today, endDate: today };

    case 'week': {
      const dayOfWeek = now.getDay();
      const diff = dayOfWeek === 6 ? 0 : dayOfWeek + 1;
      const start = new Date(now);
      start.setDate(now.getDate() - diff);
      return { startDate: toISO(start), endDate: today };
    }

    case 'month': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { startDate: toISO(start), endDate: today };
    }

    case 'quarter': {
      const qMonth = Math.floor(now.getMonth() / 3) * 3;
      const start = new Date(now.getFullYear(), qMonth, 1);
      return { startDate: toISO(start), endDate: today };
    }

    case 'year': {
      const start = new Date(now.getFullYear(), 0, 1);
      return { startDate: toISO(start), endDate: today };
    }

    default:
      return { startDate: '', endDate: '' };
  }
}

function normalizeMetrics(
  data: Partial<DashboardMetrics> | null | undefined,
  computedCash?: number,
  computedAllTimeExpenses?: number
): DashboardMetrics {
  const cashInSafe = computedCash !== undefined ? computedCash : toNumber(data?.cashInSafe);

  return {
    cashInSafe,
    totalCustomersBalance: toNumber(data?.totalCustomersBalance),
    totalSuppliersBalance: toNumber(data?.totalSuppliersBalance),
    periodGrossSales: toNumber(data?.periodGrossSales ?? data?.periodSales),
    periodEarlySettlementDiscounts: toNumber(data?.periodEarlySettlementDiscounts),
    periodSales: toNumber(data?.periodSales),
    periodCostOfGoodsSold: toNumber(data?.periodCostOfGoodsSold),
    periodGrossProfit: toNumber(data?.periodGrossProfit ?? data?.warehouseProfit),
    periodWarehouseProfit: toNumber(data?.periodWarehouseProfit),
    periodFinancingProfit: toNumber(data?.periodFinancingProfit),
    periodOperatingNetProfit: toNumber(data?.periodOperatingNetProfit),
    warehouseProfit: toNumber(data?.warehouseProfit),
    realizedCashCollections: toNumber(data?.realizedCashCollections),
    realizedSaleMargin: toNumber(data?.realizedSaleMargin),
    realizedProfits: toNumber(data?.realizedProfits),
    periodExpenses: toNumber(data?.periodExpenses),
    allTimeExpenses: computedAllTimeExpenses !== undefined ? computedAllTimeExpenses : toNumber(data?.allTimeExpenses),
    monthlyAverageExpenses: toNumber(data?.monthlyAverageExpenses),
    accountingVariance: toNumber(data?.accountingVariance),
    isBalanced: Boolean(data?.isBalanced),
  };
}

// ─────────────────────────────────────────────────────────────────
// Quick-filter Preset Config
// ─────────────────────────────────────────────────────────────────
const presets: { key: PresetKey; label: string }[] = [
  { key: 'today', label: 'اليوم' },
  { key: 'week', label: 'هذا الأسبوع' },
  { key: 'month', label: 'هذا الشهر' },
  { key: 'quarter', label: 'هذا الربع' },
  { key: 'year', label: 'السنة الحالية' },
  { key: 'custom', label: 'فترة مخصصة' },
];

// ─────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────
export default function Accounts() {
  const navigate = useNavigate();
  const settings = getSettings();

  // Date range state
  const [activePreset, setActivePreset] = useState<PresetKey>('month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  // Derive actual API dates from preset or custom inputs
  const { startDate, endDate } = useMemo(() => {
    if (activePreset === 'custom') {
      return { startDate: customStart, endDate: customEnd };
    }
    return getPresetRange(activePreset);
  }, [activePreset, customStart, customEnd]);

  // Data state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [syncTick, setSyncTick] = useState(0);

  useRealtimeSync(['sales', 'payments', 'expenses', 'customers', 'suppliers', 'shareholders'], () => {
    setSyncTick((t) => t + 1);
  });

  // Fetch metrics whenever dates change
  React.useEffect(() => {
    let active = true;
    async function loadMetrics() {
      setLoading(true);
      setError(null);
      try {
        const [data, paymentsList, expensesList] = await Promise.all([
          isApiMode() ? api.getDashboardMetrics({ startDate, endDate }) : Promise.resolve(null),
          isApiMode() ? api.listPayments({ limit: 10000 }) : Promise.resolve(getPayments()),
          isApiMode() ? api.listExpenses() : Promise.resolve(getExpenses()),
        ]);

        if (!active) return;

        // Cumulative Cash Balance (All historical cash inflows minus all historical cash outflows)
        const ob = getOpeningBalances();
        const totalCashBalance = calculateTotalCashBalance(paymentsList, expensesList, ob.startingCashBalance);
        const totalAllTimeExpenses = Array.isArray(expensesList)
          ? expensesList.reduce((sum, exp: any) => sum + (Number(exp?.amount) || 0), 0)
          : 0;

        setMetrics(normalizeMetrics(data, totalCashBalance, totalAllTimeExpenses));
      } catch (err) {
        console.error('Financial dashboard metrics request failed:', err);
        if (!active) return;
        setError(err instanceof Error ? err.message : 'تعذر تحميل البيانات المالية');
        setMetrics(null);
      } finally {
        if (active) setLoading(false);
      }
    }
    loadMetrics();
    return () => { active = false; };
  }, [startDate, endDate, syncTick]);

  const handlePresetClick = useCallback((key: PresetKey) => {
    setActivePreset(key);
    if (key !== 'custom') {
      setCustomStart('');
      setCustomEnd('');
    }
  }, []);

  const formatCurrency = useCallback(
    (amount: number) => formatWholeCurrency(toNumber(amount), settings?.currency || 'جنيه'),
    [settings?.currency],
  );

  // ═══════════════════════════════════════════════════════════════
  // UNIFIED LEDGER CALCULATIONS
  // ═══════════════════════════════════════════════════════════════
  const m = metrics;

  const sales = m ? toNumber(m.periodSales) : 0;
  const grossSales = m ? toNumber(m.periodGrossSales) : 0;
  const earlySettlementDiscounts = m ? toNumber(m.periodEarlySettlementDiscounts) : 0;
  const cogs = m ? toNumber(m.periodCostOfGoodsSold) : 0;
  const warehouseProfit = m ? toNumber(m.periodGrossProfit || m.warehouseProfit) : 0;
  const trueWarehouseProfit = m ? toNumber(m.periodWarehouseProfit) : 0;
  const financingProfit = m ? toNumber(m.periodFinancingProfit ?? Math.max(0, warehouseProfit - trueWarehouseProfit)) : 0;
  const expenses = m ? toNumber(m.periodExpenses) : 0;
  const rawRealizedProfits = m ? toNumber(m.realizedProfits) : 0;
  const realizedCashCollections = m ? toNumber(m.realizedCashCollections) : 0;
  const realizedSaleMargin = m ? toNumber(m.realizedSaleMargin) : 0;
  const receivables = m ? toNumber(m.totalCustomersBalance) : 0;

  // True operating profit of period = Period Gross Profit (Sales - COGS) - Operating Expenses
  const netPeriodResult = m
    ? (m.periodOperatingNetProfit !== undefined ? toNumber(m.periodOperatingNetProfit) : warehouseProfit - expenses)
    : -expenses;

  // Net Financial Position = Cash (already net of expenses) + Receivables - Payables
  const netFinancialPosition = m
    ? toNumber(m.cashInSafe) + receivables - toNumber(m.totalSuppliersBalance)
    : 0;

  // Period label for section headers
  const periodLabel = activePreset === 'custom'
    ? (startDate || endDate ? '(فترة مخصصة)' : '(تراكمي)')
    : `(${presets.find((p) => p.key === activePreset)?.label || ''})`;

  // ═══════════════════════════════════════════════════════════════
  // PERIOD BREAKDOWN BAR — used for the visual summary at bottom
  // ═══════════════════════════════════════════════════════════════
  const barTotal = Math.max(sales, expenses, warehouseProfit, trueWarehouseProfit, 1); // prevent division by zero
  const salesPct = Math.min((sales / barTotal) * 100, 100);
  const warehouseProfitPct = Math.min((warehouseProfit / barTotal) * 100, 100);
  const trueWarehouseProfitPct = Math.min((trueWarehouseProfit / barTotal) * 100, 100);
  const expensesPct = Math.min((expenses / barTotal) * 100, 100);

  // ───── Loading State ─────
  if (loading) {
    return <LoadingState size="lg" />;
  }

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* ═══════════════════════════════════════════════════════════════
          PAGE HEADER + QUICK DATE PRESET STRIP
      ═══════════════════════════════════════════════════════════════ */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-none">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-xl font-black text-slate-800">لوحة التقارير المالية</h2>
            <p className="mt-0.5 text-xs font-semibold text-slate-400">
              ملخص المؤشرات المالية — السيولة والأرباح والمصروفات
            </p>
          </div>

          {/* Quick Date Preset Buttons */}
          <div className="flex flex-wrap items-center gap-1.5">
            <CalendarDays size={15} className="text-slate-400 ml-1 shrink-0" />
            {presets.map((preset) => (
              <button
                key={preset.key}
                type="button"
                onClick={() => handlePresetClick(preset.key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-all duration-150 ${
                  activePreset === preset.key
                    ? 'bg-[#1e40af] text-white shadow-none'
                    : 'border border-slate-200 bg-slate-50 text-slate-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Custom Date Range Pickers */}
        {activePreset === 'custom' && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-slate-100 bg-slate-50/80 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-500">من تاريخ:</span>
              <DatePicker
                value={customStart}
                onChange={setCustomStart}
                className="h-9 w-40 rounded-lg border-slate-200 text-xs font-bold"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-500">إلى تاريخ:</span>
              <DatePicker
                value={customEnd}
                onChange={setCustomEnd}
                className="h-9 w-40 rounded-lg border-slate-200 text-xs font-bold"
              />
            </div>
            {(customStart || customEnd) && (
              <button
                type="button"
                onClick={() => { setCustomStart(''); setCustomEnd(''); }}
                className="text-xs font-bold text-rose-500 hover:underline"
              >
                مسح
              </button>
            )}
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          ERROR STATE
      ═══════════════════════════════════════════════════════════════ */}
      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-right shadow-none">
          <svg className="mt-0.5 shrink-0 text-rose-500" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M12 0C5.372 0 0 5.372 0 12s5.372 12 12 12 12-5.372 12-12S18.628 0 12 0zm0 22c-5.514 0-10-4.486-10-10S6.486 2 12 2s10 4.486 10 10-4.486 10-10 10zm-1-5h2v2h-2v-2zm0-10h2v8h-2V7z" />
          </svg>
          <div>
            <h4 className="text-sm font-black text-rose-800">خطأ في تحميل البيانات</h4>
            <p className="mt-0.5 text-xs font-semibold text-rose-600">{error}</p>
          </div>
        </div>
      )}

      {!m && !loading && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-800">
          لا توجد بيانات مالية متاحة للفترة المحددة.
        </div>
      )}

      {m && (
        <>
          {/* ═══════════════════════════════════════════════════════════
              GROUP A: موقف السيولة والأرصدة (Liquidity & Balances)
              These are CUMULATIVE balances — NOT filtered by date.
          ═══════════════════════════════════════════════════════════ */}
          <section>
            <div className="mb-3 flex items-center gap-2 px-1">
              <Wallet size={15} className="text-slate-400" />
              <h3 className="text-sm font-black text-slate-600">موقف السيولة والأرصدة</h3>
              <span className="mr-auto text-[10px] font-semibold text-slate-400">(أرصدة تراكمية)</span>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
              <KPICard
                title="النقدية بالخزينة"
                formula="إجمالي المقبوضات (الوارد) − إجمالي المدفوعات والمصروفات (الصادر)"
                value={formatCurrency(toNumber(m.cashInSafe))}
                icon={Banknote}
                iconTone="bg-emerald-50 text-emerald-600 border-emerald-100"
                valueColor={toNumber(m.cashInSafe) >= 0 ? 'text-emerald-600' : 'text-rose-600'}
                onClick={() => navigate('/payments')}
              />
              <KPICard
                title="مستحقات عند العملاء"
                formula="إجمالي أرصدة العملاء المتبقية"
                value={formatCurrency(receivables)}
                icon={Users}
                iconTone="bg-blue-50 text-blue-600 border-blue-100"
                valueColor="text-blue-700"
                onClick={() => navigate('/customers')}
              />
              <KPICard
                title="مستحقات للموردين"
                formula="إجمالي الالتزامات للموردين"
                value={formatCurrency(toNumber(m.totalSuppliersBalance))}
                icon={Truck}
                iconTone="bg-rose-50 text-rose-600 border-rose-100"
                valueColor="text-rose-600"
                onClick={() => navigate('/suppliers')}
              />
              <KPICard
                title="صافي الموقف المالي"
                formula="النقدية (بعد خصم المصروفات) + مستحقات العملاء − مستحقات الموردين"
                value={formatCurrency(netFinancialPosition)}
                icon={Scale}
                iconTone="bg-blue-50 text-blue-600 border-blue-100"
                valueColor={netFinancialPosition >= 0 ? 'text-emerald-600' : 'text-rose-600'}
              />
            </div>
          </section>

          {/* ═══════════════════════════════════════════════════════════
              GROUP B: الأداء المالي للفترة (Period P&L)
              ALL values in this section are strictly period-filtered.
          ═══════════════════════════════════════════════════════════ */}
          <section>
            <div className="mb-3 flex items-center gap-2 px-1">
              <BarChart3 size={15} className="text-slate-400" />
              <h3 className="text-sm font-black text-slate-600">
                الأداء المالي للفترة {periodLabel}
              </h3>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
              <KPICard
                title="صافي مبيعات الفترة"
                formula={
                  earlySettlementDiscounts > 0
                    ? `التعاقدي ${formatCurrency(grossSales)} − خصم سداد مبكر ${formatCurrency(earlySettlementDiscounts)}`
                    : 'مجموع الفواتير المصدرة خلال الفترة'
                }
                value={formatCurrency(sales)}
                icon={ShoppingBag}
                iconTone="bg-blue-50 text-blue-600 border-blue-100"
                valueColor="text-blue-700"
                onClick={() => navigate('/sales')}
              />
              <KPICard
                title="مجمل ربح مبيعات الفترة"
                formula={`صافي المبيعات − تكلفة البضاعة (${formatCurrency(cogs)})`}
                value={formatCurrency(warehouseProfit)}
                icon={Package}
                iconTone="bg-teal-50 text-teal-600 border-teal-100"
                valueColor="text-teal-700"
                onClick={() => navigate('/sales')}
              />
              <KPICard
                title="أرباح المخزن"
                formula={`هامش البيع النقدي − التكلفة (تقسيط: ${formatCurrency(financingProfit)})`}
                value={formatCurrency(trueWarehouseProfit)}
                icon={Warehouse}
                iconTone="bg-amber-50 text-amber-600 border-amber-100"
                valueColor="text-amber-700"
                onClick={() => navigate('/sales')}
              />
              <KPICard
                title="المصروفات التشغيلية"
                formula={`سندات الصرف للفترة · متوسط شهري: ${formatCurrency(toNumber(m.monthlyAverageExpenses))}`}
                value={formatCurrency(expenses)}
                icon={Receipt}
                iconTone="bg-rose-50 text-rose-600 border-rose-100"
                valueColor="text-rose-600"
                onClick={() => navigate('/expenses')}
              />
              <KPICard
                title="صافي الربح التشغيلي"
                formula="مجمل ربح مبيعات الفترة − المصروفات التشغيلية"
                value={formatCurrency(netPeriodResult)}
                icon={TrendingUp}
                iconTone={netPeriodResult >= 0
                  ? 'bg-emerald-50 text-emerald-600 border-emerald-100'
                  : 'bg-rose-50 text-rose-600 border-rose-100'}
                valueColor={netPeriodResult >= 0 ? 'text-emerald-600' : 'text-rose-600'}
                onClick={() => navigate('/sales')}
              />
            </div>
          </section>

          {/* ═══════════════════════════════════════════════════════════
              PERIOD RESULT BREAKDOWN — visual bar comparison
              Replaces the old "ملخص الأداء العام" duplicate bar.
          ═══════════════════════════════════════════════════════════ */}
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-none">
            <h3 className="mb-4 text-sm font-black text-slate-600">
              نتيجة الفترة {periodLabel}
            </h3>

            {/* Breakdown Table */}
            <div className="space-y-3">
              {/* Sales Row */}
              <div className="flex items-center gap-4">
                <span className="w-36 shrink-0 text-xs font-bold text-slate-500">صافي مبيعات الفترة</span>
                <div className="relative h-7 flex-1 overflow-hidden rounded-lg bg-slate-100">
                  <div
                    className="absolute inset-y-0 right-0 rounded-lg bg-blue-500/20 transition-all duration-500"
                    style={{ width: `${salesPct}%` }}
                  />
                  <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                    <span className="text-xs font-black tabular-nums text-blue-700">
                      {formatCurrency(sales)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Warehouse Profit Row */}
              <div className="flex items-center gap-4">
                <span className="w-36 shrink-0 text-xs font-bold text-slate-500">مجمل ربح المبيعات</span>
                <div className="relative h-7 flex-1 overflow-hidden rounded-lg bg-slate-100">
                  <div
                    className="absolute inset-y-0 right-0 rounded-lg bg-teal-500/20 transition-all duration-500"
                    style={{ width: `${warehouseProfitPct}%` }}
                  />
                  <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                    <span className="text-xs font-black tabular-nums text-teal-700">
                      {formatCurrency(warehouseProfit)}
                    </span>
                  </div>
                </div>
              </div>

              {/* True Warehouse Margin Row */}
              <div className="flex items-center gap-4">
                <span className="w-36 shrink-0 text-xs font-bold text-slate-500">أرباح المخزن</span>
                <div className="relative h-7 flex-1 overflow-hidden rounded-lg bg-slate-100">
                  <div
                    className="absolute inset-y-0 right-0 rounded-lg bg-amber-500/20 transition-all duration-500"
                    style={{ width: `${trueWarehouseProfitPct}%` }}
                  />
                  <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                    <span className="text-xs font-black tabular-nums text-amber-700">
                      {formatCurrency(trueWarehouseProfit)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Expenses Row */}
              <div className="flex items-center gap-4">
                <span className="w-36 shrink-0 text-xs font-bold text-slate-500">المصروفات التشغيلية</span>
                <div className="relative h-7 flex-1 overflow-hidden rounded-lg bg-slate-100">
                  <div
                    className="absolute inset-y-0 right-0 rounded-lg bg-rose-500/20 transition-all duration-500"
                    style={{ width: `${expensesPct}%` }}
                  />
                  <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                    <span className="text-xs font-black tabular-nums text-rose-600">
                      {formatCurrency(expenses)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Divider */}
              <div className="border-t border-dashed border-slate-200" />

              {/* Net Result Row */}
              <div className="flex items-center gap-4">
                <span className="w-36 shrink-0 text-xs font-bold text-slate-600">صافي نتيجة الفترة</span>
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <span className={`text-lg font-black tabular-nums ${netPeriodResult >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {formatCurrency(netPeriodResult)}
                    </span>
                    <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                      netPeriodResult > 0
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                        : netPeriodResult < 0
                          ? 'bg-rose-50 text-rose-700 border border-rose-100'
                          : 'bg-slate-50 text-slate-500 border border-slate-100'
                    }`}>
                      {netPeriodResult > 0 ? 'ربح' : netPeriodResult < 0 ? 'خسارة' : 'تعادل'}
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] font-semibold text-slate-400">
                    مجمل ربح المبيعات ({formatCurrency(warehouseProfit)}) − المصروفات ({formatCurrency(expenses)})
                    {realizedCashCollections > 0
                      ? ` · التحصيلات النقدية للعملاء: ${formatCurrency(realizedCashCollections)} (حصة الربح المحققة بعد المصروفات: ${formatCurrency(rawRealizedProfits)} من هامش ${formatCurrency(realizedSaleMargin)})`
                      : ''}
                  </p>
                </div>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// KPI Card — Flat UI, clickable drill-down, formula subtitle
// ─────────────────────────────────────────────────────────────────
function KPICard({
  title,
  formula,
  value,
  icon: Icon,
  iconTone,
  valueColor = 'text-slate-900',
  onClick,
}: {
  title: string;
  formula: string;
  value: string;
  icon: React.ElementType;
  iconTone: string;
  valueColor?: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter') onClick(); } : undefined}
      className={`group rounded-xl border border-slate-200 bg-white p-5 shadow-none transition-all duration-200 hover:border-slate-300 ${
        onClick ? 'cursor-pointer' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-black text-slate-500 leading-snug">{title}</p>
        <div className="flex items-center gap-1.5 shrink-0">
          {onClick && (
            <ArrowLeft
              size={13}
              className="text-slate-300 transition-all group-hover:text-blue-500 group-hover:-translate-x-1"
            />
          )}
          <div className={`flex h-9 w-9 items-center justify-center rounded-lg border ${iconTone}`}>
            <Icon size={17} />
          </div>
        </div>
      </div>
      <h4 className={`mt-2.5 text-2xl font-black tabular-nums leading-tight ${valueColor}`}>
        <CurrencyText value={value} />
      </h4>
      <p className="mt-1.5 text-[10px] font-semibold leading-4 text-slate-400">{formula}</p>
    </div>
  );
}
