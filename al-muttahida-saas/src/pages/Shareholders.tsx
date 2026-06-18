import React, { useState, useEffect, useRef } from 'react';
import { PieChart as PieChartIcon, ArrowDownToLine, ArrowUpFromLine, Users, Plus, TrendingUp, Calculator, Wallet, Search, Edit, Trash2 } from 'lucide-react';
import { Shareholder, ShareholderTransaction, Sale, Purchase, Expense, Product } from '../types';
import { getShareholders, createShareholder, updateShareholder, getShareholderTransactions, addShareholderTransaction, deleteShareholderTransaction, getSales, getPurchases, getExpenses, getProducts } from '../lib/storage';
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

export default function Shareholders() {
  const AUTO_DISTRIBUTE_ENABLED = false; // temporary: disable auto-distribute until algorithm is hardened
  const { settings, user } = useAuth();
  const [shareholders, setShareholders] = useState<Shareholder[]>([]);
  const [transactions, setTransactions] = useState<ShareholderTransaction[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  
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

  const computeAllocations = () => {
    const allocations: Array<{ id: string; amount: number }> = [];
    for (const s of shareholders) {
      const totalCapitalForAlloc = shareholders.reduce((sum, sh) => sum + Number(sh.capital || 0), 0);
      const shareRatioForAlloc = totalCapitalForAlloc ? (Number(s.capital || 0) / totalCapitalForAlloc) : ((s.sharePercentage || 0) / 100);
      const toDayStart = (d: Date) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
      const toDayEnd = (d: Date) => { const x = new Date(d); x.setHours(23,59,59,999); return x; };
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

  useEffect(() => {
    loadData();
  }, []);

  // Auto-distribute once per session if there are undistributed amounts
  const hasAutoDistributed = useRef(false);

  useEffect(() => {
    if (!AUTO_DISTRIBUTE_ENABLED) {
      console.debug('[auto-distribute] disabled by feature flag');
      return;
    }
    if (hasAutoDistributed.current) return;
    // only run after initial data loaded
    if (!shareholders.length && !sales.length && !expenses.length) return;

    console.debug('[auto-distribute] starting check for undistributed profits', {
      shareholdersCount: shareholders.length,
      salesCount: sales.length,
      expensesCount: expenses.length,
      productsCount: products.length,
      transactionsCount: transactions.length,
      periodFrom,
      periodTo
    });

    // run auto-distribute as async IIFE
    (async () => {
      const allocations: Array<{ id: string; amount: number }> = [];
      const totalCapitalForAuto = shareholders.reduce((sum, sh) => sum + Number(sh.capital || 0), 0);
      for (const s of shareholders) {
        const shareRatioForAuto = totalCapitalForAuto ? (Number(s.capital || 0) / totalCapitalForAuto) : ((s.sharePercentage || 0) / 100);
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
        const grossProfit = netProfitSinceJoin * shareRatioForAuto;
        const mgmtFee = grossProfit * ((s.managementFeePercentage || 0) / 100);
        const netEntitlement = grossProfit - mgmtFee;
        const shareholderTxs = transactions.filter(t => t.shareholderId === s.id);
        const totalDistributed = shareholderTxs
          .filter(t => t.type === 'profit_distribution')
          .reduce((sum, t) => sum + Number(t.amount || 0), 0);
        const undistributed = Math.max(0, netEntitlement - totalDistributed);
        console.debug('[auto-distribute] shareholder calc', { id: s.id, name: s.name, netEntitlement, totalDistributed, undistributed });
        if (undistributed > 0.009) allocations.push({ id: s.id, amount: Number(undistributed.toFixed(2)) });
      }

      console.debug('[auto-distribute] computed allocations', allocations);
      if (allocations.length > 0) {
        // perform distributions silently
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
            console.debug('[auto-distribute] created tx for', a.id);
          } catch (err) {
            console.error('[auto-distribute] failed to create tx for', a, err);
          }
        }
        loadData();
        console.debug('[auto-distribute] finished distributions and reloaded data');
        alert(`Auto-distributed profits to ${allocations.length} shareholders.`);
      } else {
        console.debug('[auto-distribute] no allocations to process');
      }

      hasAutoDistributed.current = true;
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareholders, sales, expenses, transactions, products, periodFrom, periodTo]);

  const loadData = () => {
    setShareholders(getShareholders());
    setTransactions(getShareholderTransactions());
    setSales(getSales());
    setPurchases(getPurchases());
    setExpenses(getExpenses());
    setProducts(getProducts());
  };

  const formatCurrency = (amount: number) => formatWholeCurrency(amount, settings.currency);

  const handleShareholderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Require a positive opening capital when adding a new shareholder
    if (!editingShareholder) {
      const cap = Number(shareholderForm.capital || 0);
      if (!cap || cap <= 0) {
        window.alert('الرجاء إدخال الرصيد الافتتاحي للمساهم ويجب أن يكون أكبر من صفر.');
        return;
      }
      await createShareholder(shareholderForm);
    } else {
      await updateShareholder(editingShareholder.id, shareholderForm);
    }
    loadData();
    setShowShareholderModal(false);
  };

  const handleTransactionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedShareholderId || transactionForm.amount <= 0) return;
    const selectedShareholder = shareholders.find(s => s.id === selectedShareholderId);
    if (!selectedShareholder) return;

    // compute selected shareholder availability using current data
    const computeAvailability = (s: Shareholder) => {
    const totalCapitalForAvail = shareholders.reduce((sum, sh) => sum + Number(sh.capital || 0), 0);
    const shareRatioForAvail = totalCapitalForAvail ? (Number(s.capital || 0) / totalCapitalForAvail) : ((s.sharePercentage || 0) / 100);
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
      const grossProfit = netProfitSinceJoin * shareRatioForAvail;
      const mgmtFee = grossProfit * ((s.managementFeePercentage || 0) / 100);
      const netEntitlement = grossProfit - mgmtFee;
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
      return { availableProfit, capital: Number(s.capital || 0), currentBalanceFromTx };
    };

    const availability = computeAvailability(selectedShareholder);

    // Validation: prevent withdrawing more than available
    if (transactionType === 'profit_withdrawal') {
      if (availability.availableProfit <= 0) {
        window.alert('لا توجد أرباح متاحة للسحب لهذا المساهم.');
        return;
      }
      if (Number(transactionForm.amount) > availability.availableProfit) {
        window.alert('المبلغ أكبر من الأرباح المتاحة. الرجاء إدخال مبلغ أقل أو مساوي.');
        return;
      }
    }

    if (transactionType === 'capital_withdrawal') {
      const requested = Number(transactionForm.amount || 0);
      const maxCap = availability.capital;
      const maxTotal = availability.capital + availability.availableProfit;
      if (requested > maxTotal) {
        window.alert('المبلغ أكبر من إجمالي الأموال المتاحة (رأس المال + الأرباح المتاحة). الرجاء إدخال مبلغ أقل أو مساوي.');
        return;
      }
      // If requested <= capital, proceed as capital withdrawal.
      // If requested > capital but <= capital+profits, we will withdraw available profits first, then withdraw remaining from capital.
      if (requested > maxCap) {
        const withdrawTotal = requested;
        let remaining = withdrawTotal;
        // Withdraw profits first
        const profitPart = Math.min(availability.availableProfit, remaining);
        if (profitPart > 0) {
          await addShareholderTransaction({
            shareholderId: selectedShareholderId,
            shareholderName: selectedShareholder.name,
            type: 'profit_withdrawal',
            amount: Number(profitPart),
            description: transactionForm.description || 'سحب أرباح أثناء سحب رأس مال',
            createdBy: user?.name || 'النظام'
          });
          remaining = Number((remaining - profitPart).toFixed(2));
        }
        // Withdraw remaining from capital
        if (remaining > 0) {
          await addShareholderTransaction({
            shareholderId: selectedShareholderId,
            shareholderName: selectedShareholder.name,
            type: 'capital_withdrawal',
            amount: Number(remaining),
            description: transactionForm.description || 'سحب رأس مال (بجزء من سحب إجمالي)',
            createdBy: user?.name || 'النظام'
          });
        }

        loadData();
        setShowTransactionModal(false);
        setTransactionForm({ amount: 0, description: '' });
        return;
      }
      // else requested <= maxCap -> allow single capital withdrawal
    }

    const txPayload = {
      shareholderId: selectedShareholderId,
      shareholderName: shareholders.find(s => s.id === selectedShareholderId)?.name || '',
      type: transactionType,
      amount: Number(transactionForm.amount || 0),
      description: transactionForm.description || (
        transactionType === 'capital_deposit' ? 'إيداع رأس مال' :
        transactionType === 'capital_withdrawal' ? 'سحب رأس مال' : 'سحب أرباح'
      ),
      createdBy: user?.name || 'النظام'
    };

    console.debug('[ui] addShareholderTransaction payload:', txPayload);

    await addShareholderTransaction(txPayload);

    loadData();
    setShowTransactionModal(false);
    setTransactionForm({ amount: 0, description: '' });
  };

    // Live Financial Calculation Engine
    const systemLiveNetProfit = calculateNetProfit(sales, products, expenses);
    const totalCapital = shareholders.reduce((sum, sh) => sum + Number(sh.capital || 0), 0);
    const systemLiveRoi = totalCapital ? systemLiveNetProfit / totalCapital : 0;
    const liveShareholders = shareholders.map(s => {
      const shareRatio = totalCapital ? (Number(s.capital || 0) / totalCapital) : ((s.sharePercentage || 0) / 100);
      // Determine period used for this shareholder: either the selected filter or their join date
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

      // Net profit for the period assigned to shareholders
      const netProfitSinceJoin = calculateNetProfit(periodSales, products, periodExpenses);

      // Shareholder's entitlement before fees (based on current capital share)
      const grossProfit = Number((netProfitSinceJoin * shareRatio) || 0);
      const mgmtFee = Number((grossProfit * ((s.managementFeePercentage || 0) / 100)) || 0);
      const netEntitlement = Number((grossProfit - mgmtFee) || 0);

      // Transactions summary for this shareholder (use transactions as the source of truth)
      const shareholderTxs = transactions.filter(t => t.shareholderId === s.id);
      const totalDistributed = shareholderTxs
        .filter(t => t.type === 'profit_distribution')
        .reduce((sum, t) => sum + Number(t.amount || 0), 0);
      const totalWithdrawnProfits = shareholderTxs
        .filter(t => t.type === 'profit_withdrawal')
        .reduce((sum, t) => sum + Number(t.amount || 0), 0);

      // current balance derived from distributions minus withdrawals
      const currentBalanceFromTx = totalDistributed - totalWithdrawnProfits;

      // undistributed entitlement = net entitlement not yet allocated to currentBalance
      const undistributedEntitlement = Math.max(0, netEntitlement - totalDistributed);

      // available profit = funds that can be withdrawn now
      const availableProfit = Math.max(0, currentBalanceFromTx + undistributedEntitlement);

      const totalNetValue = Number(s.capital || 0) + availableProfit;

      console.debug('[liveShareholder] calc', { id: s.id, name: s.name, grossProfit, mgmtFee, netEntitlement, totalDistributed, totalWithdrawnProfits, currentBalanceFromTx, availableProfit });
      return { ...s, grossProfit: Number(grossProfit || 0), mgmtFee: Number(mgmtFee || 0), netEntitlement, totalDistributed, totalWithdrawnProfits, currentBalanceFromTx, availableProfit, totalNetValue };
    });

    const totalAvailableProfits = liveShareholders.reduce((sum, s) => sum + (s.availableProfit || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">شاشة تداول المساهمين اللحظية</h2>
          <p className="text-gray-500 text-sm mt-1">تتصل هذه الشاشة بدفاتر المبيعات لتوليد وحساب الأرباح لحظياً.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setEditingShareholder(null);
              setShareholderForm({ name: '', phone: '', sharePercentage: 0, managementFeePercentage: 50, capital: 0, notes: '' });
              setShowShareholderModal(true);
            }}
            className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
          >
            <Plus size={20} />
            <span>إضافة مساهم</span>
          </button>
          <button
            onClick={async () => {
              if (!confirm('تأكيد: توزيع الأرباح غير الموزعة لكل المساهمين للفترة الحالية؟')) return;
              // compute and distribute
              const allocations: Array<{ id: string; amount: number }> = [];
              for (const s of shareholders) {
                const startDate = periodFrom ? new Date(periodFrom) : (s.createdAt ? new Date(s.createdAt) : new Date(0));
                const endDate = periodTo ? new Date(periodTo) : new Date();
                const periodSales = sales.filter(sale => {
                  const d = new Date(sale.date);
                  return d >= startDate && d <= endDate;
                });
                const periodExpenses = expenses.filter(exp => {
                  const d = new Date(exp.date);
                  return d >= startDate && d <= endDate;
                });
                const netProfitSinceJoin = calculateNetProfit(periodSales, products, periodExpenses);
                const grossProfit = netProfitSinceJoin * ((s.sharePercentage || 0) / 100);
                const mgmtFee = grossProfit * ((s.managementFeePercentage || 0) / 100);
                const netEntitlement = grossProfit - mgmtFee;
                const shareholderTxs = transactions.filter(t => t.shareholderId === s.id);
                const totalDistributed = shareholderTxs
                  .filter(t => t.type === 'profit_distribution')
                  .reduce((sum, t) => sum + Number(t.amount || 0), 0);
                const undistributed = Math.max(0, netEntitlement - totalDistributed);
                if (undistributed > 0.009) {
                  allocations.push({ id: s.id, amount: Number(undistributed.toFixed(2)) });
                }
              }
              for (const a of allocations) {
                addShareholderTransaction({
                  shareholderId: a.id,
                  shareholderName: shareholders.find(s => s.id === a.id)?.name || '',
                  type: 'profit_distribution',
                  amount: a.amount,
                  description: 'توزيع أرباح تلقائي للفترة',
                  createdBy: user?.name || 'النظام'
                });
              }
              if (allocations.length > 0) {
                loadData();
                alert(`تم توزيع الأرباح على ${allocations.length} مساهمين.`);
              } else {
                alert('لا يوجد مبالغ غير موزعة حالياً.');
              }
            }}
            className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 transition-colors"
          >
            <TrendingUp size={18} />
            <span>توزيع الأرباح الآن</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center">
              <Wallet size={24} className="text-indigo-600" />
            </div>
            <div>
              <p className="text-gray-500 text-sm">إجمالي رأس المال المكتتب</p>
              <p className="text-xl font-bold text-gray-800">{formatCurrency(totalCapital)}</p>
            </div>
          </div>
        </div>
        <div className="bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-xl p-6 shadow-sm border border-emerald-600 text-white relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-20">
            <TrendingUp size={80} />
          </div>
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-1">
              <span className="bg-white/20 px-2 py-1 rounded text-xs font-bold uppercase tracking-wider">Live</span>
              <p className="text-emerald-50 text-sm font-medium">إجمالي أرباح الشركة الحية (غير الموزعة)</p>
            </div>
            <p className="text-3xl font-black mb-1">{formatCurrency(systemLiveNetProfit)}</p>
            <p className="text-emerald-100 text-sm flex items-center gap-1 font-bold">
              معدل العائد (ROI): <span className="text-white">{(systemLiveRoi * 100).toFixed(2)}%</span>
            </p>
          </div>
        </div>
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-sky-100 rounded-xl flex items-center justify-center">
              <Wallet size={24} className="text-sky-600" />
            </div>
            <div>
              <p className="text-gray-500 text-sm">أرباح الشركاء المتاحة للسحب</p>
              <p className="text-xl font-bold text-gray-800">{formatCurrency(totalAvailableProfits)}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center">
              <Users size={24} className="text-purple-600" />
            </div>
            <div>
              <p className="text-gray-500 text-sm">عدد المساهمين</p>
              <p className="text-xl font-bold text-gray-800">{shareholders.length} مساهم</p>
            </div>
          </div>
        </div>
      </div>

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
            <span>سجل المعاملات</span>
          </button>
        </div>

        <div className="p-6">
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Landscape Chart Banner at the top */}
              <div className="bg-slate-50 rounded-xl p-6 border border-slate-100 flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="md:w-1/3 text-right">
                  <h3 className="text-lg font-bold text-slate-800">توزيع حصص رأس المال</h3>
                  <p className="text-xs text-slate-500 mt-1">يظهر هذا الرسم البياني نسبة مساهمة كل شريك بناءً على رأس المال الفعلي المدفوع حالياً في الشركة.</p>
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
              <div className="flex items-center justify-end gap-2">
                <label className="text-xs text-gray-600">من</label>
                <input type="date" value={periodFrom} onChange={e => setPeriodFrom(e.target.value)} className="px-2 py-1 border rounded text-sm" />
                <label className="text-xs text-gray-600">إلى</label>
                <input type="date" value={periodTo} onChange={e => setPeriodTo(e.target.value)} className="px-2 py-1 border rounded text-sm" />
                <button onClick={() => { setPeriodFrom(''); setPeriodTo(''); }} className="text-sm text-indigo-600 hover:underline">إعادة</button>
              </div>
              
              {/* Spacious 3-Column Shareholders Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {liveShareholders.map((shareholder, index) => (
                  <div key={shareholder.id} className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden">
                    {/* Live indicator dot */}
                    <div className="absolute top-4 left-4 w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                    
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
                      <button
                        onClick={() => {
                          setEditingShareholder(shareholder);
                          setShareholderForm({
                            name: shareholder.name, phone: shareholder.phone, sharePercentage: shareholder.sharePercentage, managementFeePercentage: shareholder.managementFeePercentage || 50, capital: shareholder.capital, notes: shareholder.notes || ''
                          });
                          setShowShareholderModal(true);
                        }}
                        className="text-gray-400 hover:text-indigo-600 transition-colors"
                      >
                        <Edit size={16} />
                      </button>
                    </div>
                    
                    <div className="space-y-2 mb-4 bg-slate-50 p-3 rounded-lg border border-slate-100">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600 font-medium">رأس المال:</span>
                        <span className="font-bold text-gray-900">{formatCurrency(shareholder.capital)}</span>
                      </div>
                      <div className="flex justify-between text-sm border-t border-slate-200 pt-2 mt-2">
                        <span className="text-gray-500">الأرباح اللحظية (بعد خصم الإدارة):</span>
                        <span className="font-bold text-slate-700">{formatCurrency(shareholder.netEntitlement)}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-500">تفصيل: إجمالي الربح / رسوم الإدارة</span>
                        <span className="font-bold text-rose-500">{formatCurrency(shareholder.grossProfit)} / -{formatCurrency(shareholder.mgmtFee)}</span>
                      </div>
                      {shareholder.totalWithdrawnProfits > 0 && (
                        <div className="flex justify-between text-xs border-t border-slate-100 pt-1 mt-1">
                          <span className="text-gray-500">أرباح تم سحبها مسبقاً:</span>
                          <span className="font-bold text-amber-600">-{formatCurrency(shareholder.totalWithdrawnProfits)}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-xs border-t border-slate-100 pt-1 mt-1">
                        <span className="text-gray-600 font-medium">أرباح متاحة للسحب:</span>
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

              {/* Debug panel for beginners (toggle) */}
              <div className="mt-6">
                <button onClick={() => setShowDebug(v => !v)} className="text-xs text-gray-600 underline">
                  {showDebug ? 'إخفاء معلومات التصحيح' : 'إظهار معلومات التصحيح'}
                </button>
                {showDebug && (
                  <div className="mt-2 p-3 bg-black/5 rounded text-xs font-mono max-h-64 overflow-auto">
                    <div className="mb-2">
                      <strong>liveShareholders:</strong>
                      <pre className="whitespace-pre-wrap">{JSON.stringify(liveShareholders, null, 2)}</pre>
                    </div>
                    <div className="mb-2">
                      <strong>computed allocations (undistributed):</strong>
                      <pre className="whitespace-pre-wrap">{JSON.stringify(computeAllocations(), null, 2)}</pre>
                    </div>
                    <div className="mb-2">
                      <strong>transactions (recent 20):</strong>
                      <pre className="whitespace-pre-wrap">{JSON.stringify(transactions.slice(0,20), null, 2)}</pre>
                    </div>
                    <div className="mb-2">
                      <strong>sales (recent 20):</strong>
                      <pre className="whitespace-pre-wrap">{JSON.stringify(sales.slice(0,20), null, 2)}</pre>
                    </div>
                    <div className="mb-2">
                      <strong>products (all):</strong>
                      <pre className="whitespace-pre-wrap">{JSON.stringify(products, null, 2)}</pre>
                    </div>
                    <div>
                      <strong>sales / expenses counts:</strong>
                      <div>sales: {sales.length} | expenses: {expenses.length} | products: {products.length}</div>
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
                      <td className="px-4 py-3 text-sm text-gray-500">
                        <button
                          onClick={async () => {
                            if (!confirm('تأكيد: حذف/تراجع عن هذه الحركة؟')) return;
                            const deleted = await deleteShareholderTransaction(tx.id);
                            if (deleted) {
                              alert('تم إزالة الحركة والتراجع عن تأثيرها.');
                              loadData();
                            } else {
                              alert('فشل حذف الحركة. الرجاء المحاولة لاحقاً.');
                            }
                          }}
                          className="text-rose-600 hover:text-rose-800"
                          title="حذف الحركة"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {transactions.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
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
                  <input type="text" required value={shareholderForm.phone} onChange={e => setShareholderForm({...shareholderForm, phone: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">نسبة ربح المساهم %</label>
                  <input 
                    type="number" step="0.01" min="0" max="100" required 
                    value={shareholderForm.sharePercentage} 
                    onChange={e => {
                      const val = Number(e.target.value);
                      setShareholderForm({
                        ...shareholderForm, 
                        sharePercentage: val,
                        managementFeePercentage: 100 - val
                      });
                    }} 
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" 
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">نسبة ربح الشركة (الإدارة) %</label>
                  <input 
                    type="number" step="0.01" min="0" max="100" required 
                    value={shareholderForm.managementFeePercentage} 
                    onChange={e => {
                      const val = Number(e.target.value);
                      setShareholderForm({
                        ...shareholderForm, 
                        managementFeePercentage: val,
                        sharePercentage: 100 - val
                      });
                    }} 
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none bg-indigo-50" 
                  />
                </div>
              </div>
              {!editingShareholder && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">رأس المال الافتتاحي</label>
                  <input type="number" min="0" required value={shareholderForm.capital} onChange={e => setShareholderForm({...shareholderForm, capital: Number(e.target.value)})} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" />
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
                <input type="number" min="1" required value={transactionForm.amount} onChange={e => setTransactionForm({...transactionForm, amount: Number(e.target.value)})} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none text-lg font-bold text-indigo-700" />
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

      {/* Distribute Profits Modal is removed in favor of Live NAV System */}
    </div>
  );
}
