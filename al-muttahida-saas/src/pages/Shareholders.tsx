import React, { useState, useEffect, useRef } from 'react';
import { PieChart as PieChartIcon, ArrowDownToLine, ArrowUpFromLine, Users, Plus, TrendingUp, Wallet, Edit, Trash2, RefreshCw } from 'lucide-react';
import { Shareholder, ShareholderTransaction, Sale, Purchase, Expense, Product } from '../types';
import { getShareholders, createShareholder, updateShareholder, deleteShareholder, getShareholderTransactions, addShareholderTransaction, deleteShareholderTransaction, getSales, getPurchases, getExpenses, getProducts } from '../lib/storage';
import { api, isApiMode } from '../lib/apiClient';
import { useAuth } from '../context/AuthContext';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend } from 'recharts';
import { formatDateDisplay } from '../lib/dateUtils';
import { calculateNetProfit } from '../lib/accounting';
import { formatWholeCurrency } from '../lib/utils';

const TypedPieChart = PieChart as any;
const TypedPie = Pie as any;
const TypedCell = Cell as any;
const TypedResponsiveContainer = ResponsiveContainer as any;
const TypedTooltip = RechartsTooltip as any;
const TypedLegend = Legend as any;

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#3b82f6', '#14b8a6'];

interface LiveTradingMetrics {
  liveNetProfit: number;
  totalSalesRevenue: number;
  totalCogs: number;
  totalExpenses: number;
  totalCapital: number;
  systemLiveRoi: number;
  totalAvailableProfits: number;
}

export default function Shareholders() {
  const AUTO_DISTRIBUTE_ENABLED = false; // feature flag
  const { settings, user } = useAuth();
  const [shareholders, setShareholders] = useState<Shareholder[]>([]);
  const [transactions, setTransactions] = useState<ShareholderTransaction[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  // Live database metrics from SQL Server
  const [liveMetrics, setLiveMetrics] = useState<LiveTradingMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date>(new Date());
  
  const [activeTab, setActiveTab] = useState<'overview' | 'transactions'>('overview');
  
  // Modals state
  const [showShareholderModal, setShowShareholderModal] = useState(false);
  const [editingShareholder, setEditingShareholder] = useState<Shareholder | null>(null);
  
  const [showTransactionModal, setShowTransactionModal] = useState(false);
  const [transactionType, setTransactionType] = useState<'capital_deposit' | 'capital_withdrawal' | 'profit_withdrawal'>('capital_deposit');
  const [selectedShareholderId, setSelectedShareholderId] = useState<string>('');

  // Period filter (YYYY-MM-DD)
  const [periodFrom, setPeriodFrom] = useState<string>('');
  const [periodTo, setPeriodTo] = useState<string>('');

  // Forms state
  const [shareholderForm, setShareholderForm] = useState({
    name: '', phone: '', sharePercentage: 0, managementFeePercentage: 50, capital: 0, notes: ''
  });
  
  const [transactionForm, setTransactionForm] = useState({
    amount: 0, description: ''
  });
  const [showDebug, setShowDebug] = useState(false);

  const toDayStart = (d: Date) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
  const toDayEnd = (d: Date) => { const x = new Date(d); x.setHours(23,59,59,999); return x; };

  const loadData = async () => {
    setIsLoading(true);
    try {
      if (isApiMode()) {
        const liveData = await api.getShareholdersLiveTrading({ periodFrom, periodTo });
        if (liveData) {
          setLiveMetrics({
            liveNetProfit: Number(liveData.liveNetProfit || 0),
            totalSalesRevenue: Number(liveData.totalSalesRevenue || 0),
            totalCogs: Number(liveData.totalCogs || 0),
            totalExpenses: Number(liveData.totalExpenses || 0),
            totalCapital: Number(liveData.totalCapital || 0),
            systemLiveRoi: Number(liveData.systemLiveRoi || 0),
            totalAvailableProfits: Number(liveData.totalAvailableProfits || 0),
          });
          setShareholders(liveData.shareholders || []);
          setTransactions(liveData.transactions || []);
          setLastSynced(new Date());
        }
      } else {
        setShareholders(getShareholders());
        setTransactions(getShareholderTransactions());
        setSales(getSales());
        setPurchases(getPurchases());
        setExpenses(getExpenses());
        setProducts(getProducts());
        setLastSynced(new Date());
      }
    } catch (err) {
      console.error('Failed to load shareholders live trading data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [periodFrom, periodTo]);

  // Periodic background synchronization and on-focus real-time refresh
  useEffect(() => {
    const handleFocus = () => {
      loadData();
    };
    window.addEventListener('focus', handleFocus);
    const interval = setInterval(loadData, 15000);
    return () => {
      window.removeEventListener('focus', handleFocus);
      clearInterval(interval);
    };
  }, [periodFrom, periodTo]);

  const computeAllocations = () => {
    const allocations: Array<{ id: string; amount: number }> = [];
    for (const s of shareholders) {
      const totalCapitalForAlloc = shareholders.reduce((sum, sh) => sum + Number(sh.capital || 0), 0);
      const shareRatioForAlloc = totalCapitalForAlloc ? (Number(s.capital || 0) / totalCapitalForAlloc) : ((s.sharePercentage || 0) / 100);
      const startDate = periodFrom ? toDayStart(new Date(periodFrom)) : (s.createdAt ? new Date(s.createdAt) : new Date(0));
      const endDate = periodTo ? toDayEnd(new Date(periodTo)) : toDayEnd(new Date());
      const periodSales = sales.filter(sale => {
        const d = new Date(sale.date);
        return d >= startDate && d <= endDate;
      });
      const periodExpenses = expenses.filter(exp => {
        const d = new Date(exp.date);
        return d >= startDate && d <= endDate;
      });
      const netProfitSinceJoin = calculateNetProfit(periodSales, products, periodExpenses);
      const grossProfit = netProfitSinceJoin * shareRatioForAlloc;
      const mgmtFee = grossProfit * ((s.managementFeePercentage || 0) / 100);
      const netEntitlement = grossProfit - mgmtFee;
      const shareholderTxs = transactions.filter(t => t.shareholderId === s.id);
      const totalDistributed = shareholderTxs
        .filter(t => t.type === 'profit_distribution')
        .reduce((sum, t) => sum + Number(t.amount || 0), 0);
      const undistributed = Math.max(0, netEntitlement - totalDistributed);
      if (undistributed > 0.009) allocations.push({ id: s.id, amount: Number(undistributed.toFixed(2)) });
    }
    return allocations;
  };

  // Auto-distribute once per session if feature enabled
  const hasAutoDistributed = useRef(false);

  useEffect(() => {
    if (!AUTO_DISTRIBUTE_ENABLED) return;
    if (hasAutoDistributed.current) return;
    if (!shareholders.length && !sales.length && !expenses.length) return;

    (async () => {
      const allocations = computeAllocations();
      if (allocations.length > 0) {
        for (const a of allocations) {
          try {
            await addShareholderTransaction({
              shareholderId: a.id,
              shareholderName: shareholders.find(s => s.id === a.id)?.name || '',
              type: 'profit_distribution',
              amount: a.amount,
              description: 'توزيع أرباح تلقائي عند التحميل',
              createdBy: user?.name || 'النظام'
            });
          } catch (err) {
            console.error('[auto-distribute] failed to create tx for', a, err);
          }
        }
        await loadData();
      }
      hasAutoDistributed.current = true;
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareholders, sales, expenses, transactions, products, periodFrom, periodTo]);

  const formatCurrency = (amount: number) => formatWholeCurrency(amount, settings.currency);

  const handleShareholderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingShareholder) {
      const cap = Number(shareholderForm.capital || 0);
      if (!cap || cap <= 0) {
        window.alert('الرجاء إدخال الرصيد الافتتاحي للمساهم ويجب أن يكون أكبر من صفر.');
        return;
      }
      if (isApiMode()) {
        await api.createShareholder(shareholderForm);
      } else {
        await createShareholder(shareholderForm);
      }
    } else {
      if (isApiMode()) {
        await api.updateShareholder(editingShareholder.id, shareholderForm);
      } else {
        await updateShareholder(editingShareholder.id, shareholderForm);
      }
    }
    await loadData();
    setShowShareholderModal(false);
  };

  const handleTransactionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedShareholderId || transactionForm.amount <= 0) return;
    const selectedShareholder: any = liveShareholders.find(s => s.id === selectedShareholderId);
    if (!selectedShareholder) return;

    const availableProfit = Number(selectedShareholder.availableProfit || 0);
    const capital = Number(selectedShareholder.capital || 0);

    // Validation: prevent withdrawing more than available
    if (transactionType === 'profit_withdrawal') {
      if (availableProfit <= 0) {
        window.alert('لا توجد أرباح متاحة للسحب لهذا المساهم.');
        return;
      }
      if (Number(transactionForm.amount) > availableProfit) {
        window.alert('المبلغ أكبر من الأرباح المتاحة. الرجاء إدخال مبلغ أقل أو مساوي.');
        return;
      }
    }

    if (transactionType === 'capital_withdrawal') {
      const requested = Number(transactionForm.amount || 0);
      const maxCap = capital;
      const maxTotal = capital + availableProfit;
      if (requested > maxTotal) {
        window.alert('المبلغ أكبر من إجمالي الأموال المتاحة (رأس المال + الأرباح المتاحة). الرجاء إدخال مبلغ أقل أو مساوي.');
        return;
      }
      if (requested > maxCap) {
        const withdrawTotal = requested;
        let remaining = withdrawTotal;
        const profitPart = Math.min(availableProfit, remaining);
        if (profitPart > 0) {
          const payload = {
            shareholderId: selectedShareholderId,
            shareholderName: selectedShareholder.name,
            type: 'profit_withdrawal' as const,
            amount: Number(profitPart),
            date: new Date().toISOString().split('T')[0],
            description: transactionForm.description || 'سحب أرباح أثناء سحب رأس مال',
            createdBy: user?.name || 'النظام'
          };
          if (isApiMode()) {
            await api.createShareholderTransaction(payload);
          } else {
            await addShareholderTransaction(payload);
          }
          remaining = Number((remaining - profitPart).toFixed(2));
        }
        if (remaining > 0) {
          const payload = {
            shareholderId: selectedShareholderId,
            shareholderName: selectedShareholder.name,
            type: 'capital_withdrawal' as const,
            amount: Number(remaining),
            date: new Date().toISOString().split('T')[0],
            description: transactionForm.description || 'سحب رأس مال (بجزء من سحب إجمالي)',
            createdBy: user?.name || 'النظام'
          };
          if (isApiMode()) {
            await api.createShareholderTransaction(payload);
          } else {
            await addShareholderTransaction(payload);
          }
        }

        await loadData();
        setShowTransactionModal(false);
        setTransactionForm({ amount: 0, description: '' });
        return;
      }
    }

    const txPayload = {
      shareholderId: selectedShareholderId,
      shareholderName: selectedShareholder.name,
      type: transactionType,
      amount: Number(transactionForm.amount || 0),
      date: new Date().toISOString().split('T')[0],
      description: transactionForm.description || (
        transactionType === 'capital_deposit' ? 'إيداع رأس مال' :
        transactionType === 'capital_withdrawal' ? 'سحب رأس مال' : 'سحب أرباح'
      ),
      createdBy: user?.name || 'النظام'
    };

    if (isApiMode()) {
      await api.createShareholderTransaction(txPayload);
    } else {
      await addShareholderTransaction(txPayload);
    }

    await loadData();
    setShowTransactionModal(false);
    setTransactionForm({ amount: 0, description: '' });
  };

  const handleDeleteTransaction = async (txId: string) => {
    if (!window.confirm('تأكيد: حذف/تراجع عن هذه الحركة؟')) return;
    try {
      if (isApiMode()) {
        await api.deleteShareholderTransaction(txId);
      } else {
        await deleteShareholderTransaction(txId);
      }
      alert('تم إزالة الحركة والتراجع عن أثرها بنجاح.');
      await loadData();
    } catch (err: any) {
      alert('فشل حذف الحركة: ' + (err.message || 'خطأ في النظام'));
    }
  };

  const handleDeleteShareholder = async (shareholderId: string, name: string) => {
    if (!window.confirm(`هل أنت متأكد من حذف المساهم "${name}"؟`)) return;
    try {
      if (isApiMode()) {
        await api.deleteShareholder(shareholderId);
      } else {
        await deleteShareholder(shareholderId);
      }
      alert('تم حذف المساهم بنجاح.');
      await loadData();
    } catch (err: any) {
      alert('فشل حذف المساهم: ' + (err.message || 'خطأ في النظام'));
    }
  };

  // Derive Live Financial Numbers:
  // If liveMetrics is available from backend API, use them directly as ground truth!
  const systemLiveNetProfit = liveMetrics ? liveMetrics.liveNetProfit : calculateNetProfit(sales, products, expenses);
  const totalCapital = liveMetrics ? liveMetrics.totalCapital : shareholders.reduce((sum, sh) => sum + Number(sh.capital || 0), 0);
  const systemLiveRoi = liveMetrics ? liveMetrics.systemLiveRoi : (totalCapital ? systemLiveNetProfit / totalCapital : 0);
  
  const liveShareholders = shareholders.map((s: any) => {
    // If backend already computed metrics, preserve them
    if (s.availableProfit !== undefined && s.grossProfit !== undefined) {
      return s;
    }

    const shareRatio = totalCapital ? (Number(s.capital || 0) / totalCapital) : ((s.sharePercentage || 0) / 100);
    const startDate = periodFrom ? toDayStart(new Date(periodFrom)) : (s.createdAt ? toDayStart(new Date(s.createdAt)) : new Date(0));
    const endDate = periodTo ? toDayEnd(new Date(periodTo)) : toDayEnd(new Date());

    const periodSales = sales.filter(sale => {
      const d = new Date(sale.date);
      return d >= startDate && d <= endDate;
    });
    const periodExpenses = expenses.filter(exp => {
      const d = new Date(exp.date);
      return d >= startDate && d <= endDate;
    });

    const netProfitSinceJoin = calculateNetProfit(periodSales, products, periodExpenses);
    const grossProfit = Number((netProfitSinceJoin * shareRatio) || 0);
    const mgmtFee = Number((grossProfit * ((s.managementFeePercentage || 0) / 100)) || 0);
    const netEntitlement = Number((grossProfit - mgmtFee) || 0);

    const shareholderTxs = transactions.filter(t => t.shareholderId === s.id);
    const totalDistributed = shareholderTxs
      .filter(t => t.type === 'profit_distribution')
      .reduce((sum, t) => sum + Number(t.amount || 0), 0);
    const totalWithdrawnProfits = shareholderTxs
      .filter(t => t.type === 'profit_withdrawal')
      .reduce((sum, t) => sum + Number(t.amount || 0), 0);

    const currentBalanceFromTx = totalDistributed - totalWithdrawnProfits;
    const undistributedEntitlement = Math.max(0, netEntitlement - totalDistributed);
    const availableProfit = Math.max(0, currentBalanceFromTx + undistributedEntitlement);
    const totalNetValue = Number(s.capital || 0) + availableProfit;

    return {
      ...s,
      grossProfit: Number(grossProfit || 0),
      mgmtFee: Number(mgmtFee || 0),
      netEntitlement,
      totalDistributed,
      totalWithdrawnProfits,
      currentBalanceFromTx,
      availableProfit,
      totalNetValue,
    };
  });

  const totalAvailableProfits = liveMetrics 
    ? liveMetrics.totalAvailableProfits 
    : liveShareholders.reduce((sum, s) => sum + (s.availableProfit || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold text-gray-800">شاشة تداول المساهمين اللحظية</h2>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>مزامنة مباشرة مع دفاتر النظام</span>
            </span>
          </div>
          <p className="text-gray-500 text-sm mt-1">
            ربط تلقائي مع سجلات المبيعات، تكلفة البضاعة المباعة والمصروفات لحساب الأرباح المحققة لحظياً.
            <span className="text-xs text-gray-400 mr-2">(آخر تحديث: {lastSynced.toLocaleTimeString('ar-EG')})</span>
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={loadData}
            disabled={isLoading}
            className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 px-3.5 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
            title="تحديث فوري من قاعدة البيانات"
          >
            <RefreshCw size={16} className={isLoading ? 'animate-spin text-indigo-600' : ''} />
            <span>تحديث لحظي</span>
          </button>

          <button
            onClick={() => {
              setEditingShareholder(null);
              setShareholderForm({ name: '', phone: '', sharePercentage: 0, managementFeePercentage: 50, capital: 0, notes: '' });
              setShowShareholderModal(true);
            }}
            className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors font-medium shadow-sm"
          >
            <Plus size={20} />
            <span>إضافة مساهم</span>
          </button>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Subscribed Capital */}
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center shrink-0">
              <Wallet size={24} className="text-indigo-600" />
            </div>
            <div>
              <p className="text-gray-500 text-xs font-medium">إجمالي رأس المال المكتتب</p>
              <p className="text-xl font-bold text-gray-800 mt-0.5">{formatCurrency(totalCapital)}</p>
            </div>
          </div>
        </div>

        {/* Card 2: Live Net Profit */}
        <div className="bg-gradient-to-br from-emerald-600 to-emerald-800 rounded-xl p-5 shadow-sm border border-emerald-600 text-white relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-15">
            <TrendingUp size={70} />
          </div>
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-1">
              <span className="bg-white/20 px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider">Live</span>
              <p className="text-emerald-50 text-xs font-medium">إجمالي أرباح الشركة الحية</p>
            </div>
            <p className="text-2xl font-black mb-1">{formatCurrency(systemLiveNetProfit)}</p>
            <div className="text-emerald-100 text-[11px] flex items-center gap-2 font-medium">
              <span>العائد (ROI): <strong className="text-white">{(systemLiveRoi * 100).toFixed(2)}%</strong></span>
              {liveMetrics && (
                <span className="border-r border-emerald-400/40 pr-2 mr-2">
                  مطابق لقائمة الدخل
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Card 3: Available Withdrawal Profits */}
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-sky-100 rounded-xl flex items-center justify-center shrink-0">
              <Wallet size={24} className="text-sky-600" />
            </div>
            <div>
              <p className="text-gray-500 text-xs font-medium">أرباح الشركاء المتاحة للسحب</p>
              <p className="text-xl font-bold text-emerald-600 mt-0.5">{formatCurrency(totalAvailableProfits)}</p>
            </div>
          </div>
        </div>

        {/* Card 4: Active Shareholders */}
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center shrink-0">
              <Users size={24} className="text-purple-600" />
            </div>
            <div>
              <p className="text-gray-500 text-xs font-medium">عدد المساهمين</p>
              <p className="text-xl font-bold text-gray-800 mt-0.5">{shareholders.length} مساهم</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs & Content */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="flex border-b border-gray-100">
          <button
            onClick={() => setActiveTab('overview')}
            className={`flex items-center gap-2 px-6 py-4 text-sm font-semibold transition-colors ${
              activeTab === 'overview' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50/50' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <PieChartIcon size={18} />
            <span>نظرة عامة والشركاء</span>
          </button>
          <button
            onClick={() => setActiveTab('transactions')}
            className={`flex items-center gap-2 px-6 py-4 text-sm font-semibold transition-colors ${
              activeTab === 'transactions' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50/50' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <ArrowDownToLine size={18} />
            <span>سجل المعاملات ({transactions.length})</span>
          </button>
        </div>

        <div className="p-6">
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Landscape Chart Banner */}
              <div className="bg-slate-50 rounded-xl p-6 border border-slate-100 flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="md:w-1/3 text-right">
                  <h3 className="text-lg font-bold text-slate-800">توزيع حصص رأس المال</h3>
                  <p className="text-xs text-slate-500 mt-1">يظهر هذا الرسم البياني نسبة مساهمة كل شريك بناءً على رأس المال الفعلي المدفوع حالياً في الشركة.</p>
                  {liveMetrics && (
                    <div className="mt-3 pt-3 border-t border-slate-200 text-xs text-slate-600 space-y-1">
                      <div className="flex justify-between">
                        <span>إجمالي المبيعات المحققة:</span>
                        <strong className="text-slate-800">{formatCurrency(liveMetrics.totalSalesRevenue)}</strong>
                      </div>
                      <div className="flex justify-between">
                        <span>تكلفة البضاعة المباعة (COGS):</span>
                        <strong className="text-slate-800">{formatCurrency(liveMetrics.totalCogs)}</strong>
                      </div>
                      <div className="flex justify-between">
                        <span>إجمالي المصروفات التشغيلية:</span>
                        <strong className="text-slate-800">{formatCurrency(liveMetrics.totalExpenses)}</strong>
                      </div>
                    </div>
                  )}
                </div>
                <div className="w-full md:w-2/3 h-48">
                  <TypedResponsiveContainer width="100%" height="100%">
                    <TypedPieChart>
                      <TypedPie
                        data={shareholders}
                        cx="50%"
                        cy="50%"
                        innerRadius={45}
                        outerRadius={65}
                        paddingAngle={5}
                        dataKey="capital"
                        nameKey="name"
                      >
                        {shareholders.map((entry: any, index: number) => (
                          <TypedCell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </TypedPie>
                      <TypedTooltip formatter={(value: number) => formatCurrency(value)} />
                      <TypedLegend layout="horizontal" align="center" verticalAlign="bottom" />
                    </TypedPieChart>
                  </TypedResponsiveContainer>
                </div>
              </div>

              {/* Period filter (from / to) */}
              <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-gray-50/70 rounded-lg border border-gray-200/60">
                <div className="text-xs font-medium text-gray-700">تصفية فترة الأرباح:</div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-600">من</label>
                  <input type="date" value={periodFrom} onChange={e => setPeriodFrom(e.target.value)} className="px-2 py-1 border rounded text-xs bg-white" />
                  <label className="text-xs text-gray-600">إلى</label>
                  <input type="date" value={periodTo} onChange={e => setPeriodTo(e.target.value)} className="px-2 py-1 border rounded text-xs bg-white" />
                  {(periodFrom || periodTo) && (
                    <button onClick={() => { setPeriodFrom(''); setPeriodTo(''); }} className="text-xs text-indigo-600 hover:underline font-semibold">إلغاء التصفية</button>
                  )}
                </div>
              </div>
              
              {/* Spacious Shareholders Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {liveShareholders.map((shareholder, index) => (
                  <div key={shareholder.id} className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden">
                    {/* Live indicator dot */}
                    <div className="absolute top-4 left-4 w-2 h-2 rounded-full bg-emerald-500 animate-pulse" title="مباشر"></div>
                    
                    <div className="flex justify-between items-start mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold" style={{ backgroundColor: COLORS[index % COLORS.length] }}>
                          {shareholder.name.charAt(0)}
                        </div>
                        <div>
                          <h4 className="font-bold text-gray-800">{shareholder.name}</h4>
                          <p className="text-xs text-gray-500 font-medium">الربح: {shareholder.sharePercentage}% | الإدارة: {shareholder.managementFeePercentage || 0}%</p>
                          <p className="text-xs text-gray-400">انضم: {formatDateDisplay(shareholder.createdAt)}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            setEditingShareholder(shareholder);
                            setShareholderForm({
                              name: shareholder.name, phone: shareholder.phone, sharePercentage: shareholder.sharePercentage, managementFeePercentage: shareholder.managementFeePercentage || 50, capital: shareholder.capital, notes: shareholder.notes || ''
                            });
                            setShowShareholderModal(true);
                          }}
                          className="text-gray-400 hover:text-indigo-600 transition-colors p-1"
                          title="تعديل بيانات المساهم"
                        >
                          <Edit size={16} />
                        </button>
                        <button
                          onClick={() => handleDeleteShareholder(shareholder.id, shareholder.name)}
                          className="text-gray-400 hover:text-rose-600 transition-colors p-1"
                          title="حذف المساهم"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                    
                    <div className="space-y-2 mb-4 bg-slate-50 p-3 rounded-lg border border-slate-100">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600 font-medium">رأس المال:</span>
                        <span className="font-bold text-gray-900">{formatCurrency(shareholder.capital)}</span>
                      </div>
                      <div className="flex justify-between text-sm border-t border-slate-200 pt-2 mt-2">
                        <span className="text-gray-600">الأرباح المستحقة (بعد الإدارة):</span>
                        <span className="font-bold text-slate-800">{formatCurrency(shareholder.netEntitlement)}</span>
                      </div>
                      <div className="flex justify-between text-xs text-gray-500">
                        <span>إجمالي الربح / رسوم الإدارة:</span>
                        <span className="font-semibold text-rose-500">{formatCurrency(shareholder.grossProfit)} / -{formatCurrency(shareholder.mgmtFee)}</span>
                      </div>
                      {shareholder.totalWithdrawnProfits > 0 && (
                        <div className="flex justify-between text-xs border-t border-slate-100 pt-1 mt-1 text-gray-500">
                          <span>أرباح تم سحبها مسبقاً:</span>
                          <span className="font-bold text-amber-600">-{formatCurrency(shareholder.totalWithdrawnProfits)}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-xs border-t border-slate-200 pt-1 mt-1">
                        <span className="text-emerald-700 font-bold">أرباح متاحة للسحب الآن:</span>
                        <span className="font-bold text-emerald-600">+{formatCurrency(shareholder.availableProfit)}</span>
                      </div>
                      <div className="flex justify-between text-sm border-t border-emerald-100 pt-2 mt-2 bg-emerald-50/50 -mx-3 -mb-3 p-3 rounded-b-lg">
                        <span className="text-emerald-800 font-bold">إجمالي أموال المساهم:</span>
                        <span className="font-black text-emerald-700">{formatCurrency(shareholder.totalNetValue)}</span>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-3 gap-2 pt-3 border-t border-gray-50">
                      <button
                        onClick={() => {
                          setSelectedShareholderId(shareholder.id);
                          setTransactionType('capital_deposit');
                          setShowTransactionModal(true);
                        }}
                        className="flex items-center justify-center gap-1 py-1.5 bg-slate-50 hover:bg-indigo-50 text-indigo-700 rounded text-xs font-semibold transition-colors"
                      >
                        <ArrowDownToLine size={14} />
                        <span>إيداع رأسمال</span>
                      </button>
                      <button
                        onClick={() => {
                          setSelectedShareholderId(shareholder.id);
                          setTransactionType('capital_withdrawal');
                          setShowTransactionModal(true);
                        }}
                        className="flex items-center justify-center gap-1 py-1.5 bg-slate-50 hover:bg-rose-50 text-rose-700 rounded text-xs font-semibold transition-colors"
                      >
                        <ArrowUpFromLine size={14} />
                        <span>سحب رأس مال</span>
                      </button>
                      <button
                        onClick={() => {
                          setSelectedShareholderId(shareholder.id);
                          setTransactionType('profit_withdrawal');
                          setShowTransactionModal(true);
                        }}
                        className="flex items-center justify-center gap-1 py-1.5 bg-slate-50 hover:bg-emerald-50 text-emerald-700 rounded text-xs font-semibold transition-colors"
                      >
                        <ArrowUpFromLine size={14} />
                        <span>سحب أرباح</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Debug panel toggle */}
              <div className="mt-6">
                <button onClick={() => setShowDebug(v => !v)} className="text-xs text-gray-500 hover:underline">
                  {showDebug ? 'إخفاء معلومات المطابقة الفنية' : 'عرض معلومات المطابقة الفنية'}
                </button>
                {showDebug && (
                  <div className="mt-2 p-3 bg-black/5 rounded text-xs font-mono max-h-64 overflow-auto">
                    <div className="mb-2">
                      <strong>liveMetrics:</strong>
                      <pre className="whitespace-pre-wrap">{JSON.stringify(liveMetrics, null, 2)}</pre>
                    </div>
                    <div className="mb-2">
                      <strong>liveShareholders count:</strong> {liveShareholders.length}
                    </div>
                    <div>
                      <strong>transactions count:</strong> {transactions.length}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'transactions' && (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 border-y border-gray-100">
                    <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">التاريخ</th>
                    <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">المساهم</th>
                    <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">نوع الحركة</th>
                    <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">المبلغ</th>
                    <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">البيان</th>
                    <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">بواسطة</th>
                    <th className="px-4 py-3 text-center text-sm font-semibold text-gray-600">إجراء</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {transactions.map(tx => (
                    <tr key={tx.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-4 py-3 text-sm text-gray-600">{formatDateDisplay(tx.date)}</td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-800">{tx.shareholderName}</td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          tx.type === 'capital_deposit' ? 'bg-indigo-100 text-indigo-700' :
                          tx.type === 'capital_withdrawal' ? 'bg-rose-100 text-rose-700' :
                          tx.type === 'profit_distribution' ? 'bg-emerald-100 text-emerald-700' :
                          'bg-amber-100 text-amber-700'
                        }`}>
                          {tx.type === 'capital_deposit' ? 'إيداع رأس مال' :
                           tx.type === 'capital_withdrawal' ? 'سحب رأس مال' :
                           tx.type === 'profit_distribution' ? 'توزيع أرباح' : 'سحب أرباح'}
                        </span>
                      </td>
                      <td className={`px-4 py-3 text-sm font-bold ${
                        tx.type === 'capital_deposit' || tx.type === 'profit_distribution' ? 'text-emerald-600' : 'text-rose-600'
                      }`}>
                        {formatCurrency(tx.amount)}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">{tx.description}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{tx.createdBy}</td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => handleDeleteTransaction(tx.id)}
                          className="text-rose-600 hover:text-rose-800 p-1"
                          title="حذف والتراجع عن الحركة"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {transactions.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                        لا توجد حركات مسجلة بعد
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Shareholder Modal */}
      {showShareholderModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-gray-100">
              <h3 className="text-xl font-bold text-gray-800">
                {editingShareholder ? 'تعديل بيانات المساهم' : 'إضافة مساهم جديد'}
              </h3>
            </div>
            <form onSubmit={handleShareholderSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">الاسم</label>
                  <input type="text" required value={shareholderForm.name} onChange={e => setShareholderForm({...shareholderForm, name: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">الهاتف</label>
                  <input type="tel" required value={shareholderForm.phone} onChange={e => setShareholderForm({...shareholderForm, phone: e.target.value.replace(/\D/g, '')})} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">نسبة ربح المساهم %</label>
                  <input 
                    type="number" step="0.01" min="0" max="100" required 
                    value={shareholderForm.sharePercentage === 0 ? '' : shareholderForm.sharePercentage} 
                    onChange={e => {
                      const val = Number(e.target.value);
                      setShareholderForm({
                        ...shareholderForm, 
                        sharePercentage: val,
                        managementFeePercentage: 100 - val
                      });
                    }} 
                    onKeyDown={(e) => ['e', 'E', '+', '-'].includes(e.key) && e.preventDefault()}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" 
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">نسبة ربح الشركة (الإدارة) %</label>
                  <input 
                    type="number" step="0.01" min="0" max="100" required 
                    value={shareholderForm.managementFeePercentage === 0 ? '' : shareholderForm.managementFeePercentage} 
                    onChange={e => {
                      const val = Number(e.target.value);
                      setShareholderForm({
                        ...shareholderForm, 
                        managementFeePercentage: val,
                        sharePercentage: 100 - val
                      });
                    }} 
                    onKeyDown={(e) => ['e', 'E', '+', '-'].includes(e.key) && e.preventDefault()}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none bg-indigo-50" 
                  />
                </div>
              </div>
              {!editingShareholder && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">رأس المال الافتتاحي</label>
                  <input 
                    type="number" min="0" required 
                    value={shareholderForm.capital === 0 ? '' : shareholderForm.capital} 
                    onChange={e => setShareholderForm({...shareholderForm, capital: Number(e.target.value)})} 
                    onKeyDown={(e) => ['e', 'E', '+', '-'].includes(e.key) && e.preventDefault()}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" 
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ملاحظات (اختياري)</label>
                <textarea value={shareholderForm.notes} onChange={e => setShareholderForm({...shareholderForm, notes: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" rows={2} />
              </div>
              <div className="flex gap-3 pt-4 border-t border-gray-50">
                <button type="button" onClick={() => setShowShareholderModal(false)} className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors">إلغاء</button>
                <button type="submit" className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">{editingShareholder ? 'حفظ التعديلات' : 'إضافة المساهم'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Transaction Modal */}
      {showTransactionModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-gray-100">
              <h3 className="text-xl font-bold text-gray-800">
                {transactionType === 'capital_deposit' ? 'إيداع رأس مال' : transactionType === 'capital_withdrawal' ? 'سحب رأس مال' : 'سحب أرباح'}
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                المساهم: <span className="font-bold text-indigo-600">{shareholders.find(s => s.id === selectedShareholderId)?.name}</span>
              </p>
            </div>
            <form onSubmit={handleTransactionSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">المبلغ</label>
                <input 
                  type="number" min="1" required 
                  value={transactionForm.amount === 0 ? '' : transactionForm.amount} 
                  onChange={e => setTransactionForm({...transactionForm, amount: Number(e.target.value)})} 
                  onKeyDown={(e) => ['e', 'E', '+', '-'].includes(e.key) && e.preventDefault()}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none text-lg font-bold text-indigo-700" 
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">البيان / ملاحظات</label>
                <input type="text" required value={transactionForm.description} onChange={e => setTransactionForm({...transactionForm, description: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" placeholder="مثال: تحويل بنكي، شيك نقدي..." />
              </div>
              <div className="bg-amber-50 text-amber-800 p-3 rounded-lg text-xs flex items-start gap-2">
                <Wallet size={16} className="mt-0.5 shrink-0" />
                <p>إتمام هذه العملية سيقوم تلقائياً بتوليد حركة في <strong>الخزينة اليومية</strong> لضمان مطابقة الحسابات.</p>
              </div>
              <div className="flex gap-3 pt-4 border-t border-gray-50">
                <button type="button" onClick={() => setShowTransactionModal(false)} className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors">إلغاء</button>
                <button type="submit" className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">تأكيد العملية</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
