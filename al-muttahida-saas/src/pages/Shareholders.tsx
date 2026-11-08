import React, { useState, useEffect, useMemo } from 'react';
import {
  PieChart as PieChartIcon,
  ArrowDownToLine,
  ArrowUpFromLine,
  Users,
  Plus,
  Wallet,
  Edit,
  Trash2,
  RefreshCw,
  Calendar,
  FileText,
  Filter,
  Search,
  ChevronLeft,
  DollarSign,
  Landmark,
  ShieldCheck,
  X,
  Award,
  Table as TableIcon,
  LayoutGrid,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Shareholder, ShareholderTransaction, Sale, Expense, Product } from '../types';
import {
  getShareholders,
  createShareholder,
  updateShareholder,
  deleteShareholder,
  getShareholderTransactions,
  addShareholderTransaction,
  deleteShareholderTransaction,
  getSales,
  getExpenses,
  getProducts,
} from '../lib/storage';
import { api, isApiMode } from '../lib/apiClient';
import { useAuth } from '../context/AuthContext';
import { useDialog } from '../context/DialogContext';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend } from 'recharts';
import { formatDateDisplay } from '../lib/dateUtils';
import { calculateNetProfit, calculateCostOfGoodsSold } from '../lib/accounting';
import { formatWholeCurrency } from '../lib/utils';

const TypedPieChart = PieChart as any;
const TypedPie = Pie as any;
const TypedCell = Cell as any;
const TypedResponsiveContainer = ResponsiveContainer as any;
const TypedTooltip = RechartsTooltip as any;
const TypedLegend = Legend as any;

const COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#0284c7', '#14b8a6'];

interface LedgerEntry {
  id: string;
  date: string;
  type:
    | 'initial_capital'
    | 'capital_deposit'
    | 'capital_withdrawal'
    | 'profit_allocation'
    | 'profit_distribution'
    | 'profit_withdrawal';
  description: string;
  amount: number;
  capitalDelta: number;
  profitDelta: number;
  runningCapital: number;
  runningProfit: number;
  runningTotalEquity: number;
  createdBy: string;
  isSynthetic?: boolean;
}

interface LiveTradingMetrics {
  liveNetProfit: number;
  totalSalesRevenue: number;
  totalCogs: number;
  totalExpenses: number;
  totalCapital: number;
  systemLiveRoi: number;
  totalAvailableProfits: number;
  totalWithdrawnProfits?: number;
  totalNetEntitlement?: number;
}

function toIsoDay(dateVal?: string | null): string {
  if (!dateVal) return new Date().toISOString().slice(0, 10);
  const s = String(dateVal).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

export default function Shareholders() {
  const { settings, user } = useAuth();
  const { confirmDialog, showToast } = useDialog();
  const [shareholders, setShareholders] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<ShareholderTransaction[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  const [liveMetrics, setLiveMetrics] = useState<LiveTradingMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date>(new Date());

  const [activeTab, setActiveTab] = useState<'overview' | 'ledger'>('overview');
  const [overviewDisplayMode, setOverviewDisplayMode] = useState<'table' | 'cards'>('table');
  const [showChartBanner, setShowChartBanner] = useState<boolean>(false);

  // Filters
  const [ledgerPartnerFilter, setLedgerPartnerFilter] = useState<string>('all');
  const [ledgerTypeFilter, setLedgerTypeFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Modals state
  const [showShareholderModal, setShowShareholderModal] = useState(false);
  const [editingShareholder, setEditingShareholder] = useState<any | null>(null);

  const [showTransactionModal, setShowTransactionModal] = useState(false);
  const [transactionType, setTransactionType] = useState<
    'capital_deposit' | 'capital_withdrawal' | 'profit_withdrawal' | 'profit_distribution'
  >('capital_deposit');
  const [selectedShareholderId, setSelectedShareholderId] = useState<string>('');

  // Detailed Partner Statement Modal
  const [inspectingPartnerId, setInspectingPartnerId] = useState<string | null>(null);

  // Forms state
  const [shareholderForm, setShareholderForm] = useState({
    name: '',
    phone: '',
    isFounder: false,
    sharePercentage: 50,
    managementFeePercentage: 50,
    capital: 0,
    joinedDate: new Date().toISOString().slice(0, 10),
    notes: '',
    affectsTreasury: true,
  });

  const [transactionForm, setTransactionForm] = useState({
    amount: 0,
    date: new Date().toISOString().slice(0, 10),
    description: '',
    affectsTreasury: true,
  });

  const formatCurrency = (amount: number) => formatWholeCurrency(amount, settings.currency);
  const formatWithdrawal = (amount?: number | null) => {
    const val = Math.round(Number(amount || 0));
    if (val <= 0) return formatCurrency(0);
    return `-${formatCurrency(val)}`;
  };

  const loadData = async () => {
    setIsLoading(true);
    try {
      if (isApiMode()) {
        const liveData = await api.getShareholdersLiveTrading();
        if (liveData) {
          setLiveMetrics({
            liveNetProfit: Number(liveData.liveNetProfit || 0),
            totalSalesRevenue: Number(liveData.totalSalesRevenue || 0),
            totalCogs: Number(liveData.totalCogs || 0),
            totalExpenses: Number(liveData.totalExpenses || 0),
            totalCapital: Number(liveData.totalCapital || 0),
            systemLiveRoi: Number(liveData.systemLiveRoi || 0),
            totalAvailableProfits: Number(liveData.totalAvailableProfits || 0),
            totalWithdrawnProfits: Number(liveData.totalWithdrawnProfits || 0),
            totalNetEntitlement: Number(liveData.totalNetEntitlement || 0),
          });
          setShareholders(liveData.shareholders || []);
          setTransactions(liveData.transactions || []);
          setLastSynced(new Date());
        }
      } else {
        setShareholders(getShareholders());
        setTransactions(getShareholderTransactions());
        setSales(getSales());
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
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleFocus = () => {
      void loadData();
    };
    window.addEventListener('focus', handleFocus);
    const interval = setInterval(() => {
      void loadData();
    }, 15000);
    return () => {
      window.removeEventListener('focus', handleFocus);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Compute time-weighted metrics locally or merge with backend metrics
  const computedState = useMemo(() => {
    if (isApiMode() && liveMetrics) {
      const totalCapital = liveMetrics.totalCapital;
      const totalAvailableProfits = liveMetrics.totalAvailableProfits;
      return {
        totalCapital,
        totalAvailableProfits,
        liveShareholders: shareholders,
        filteredTransactions: transactions,
      };
    }

    // Local Storage fallback time-weighted Model 1 engine
    const activeSalesGlobal = sales.filter((s) => s.status !== 'cancelled');
    const activeExpensesGlobal = expenses;

    const totalSalesRevenue = activeSalesGlobal.reduce((sum, s) => sum + Number(s.total || 0), 0);
    const totalCogs = calculateCostOfGoodsSold(activeSalesGlobal, products);
    const totalExpenses = activeExpensesGlobal.reduce((sum, e) => sum + Number(e.amount || 0), 0);
    const systemLiveNetProfit = calculateNetProfit(activeSalesGlobal, products, activeExpensesGlobal);
    const totalCapital = shareholders.reduce((sum, sh) => sum + Number(sh.capital || 0), 0);

    const ascTxs = [...transactions].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    // PASS 1: Calculate active window, sales, cogs, expenses, and silent investors' returns (Model 1)
    const preparedStakeholders = shareholders.map((s: any) => {
      const currentCapital = Number(s.capital || 0);
      const sharePercentage = Number(s.sharePercentage || 0);
      const isFounder = Boolean(s.isFounder);
      const managementFeePercentage =
        s.managementFeePercentage !== undefined ? Number(s.managementFeePercentage) : 100 - sharePercentage;

      const joinedDate = toIsoDay(s.joinedDate || s.createdAt);
      const effectiveStart = joinedDate;
      const effectiveEnd = toIsoDay(new Date().toISOString());

      const windowValid = effectiveStart <= effectiveEnd;
      const partnerWindowSales = windowValid
        ? sales.filter(
            (sale) => sale.status !== 'cancelled' && toIsoDay(sale.date) >= effectiveStart
          )
        : [];
      const partnerWindowExpenses = windowValid
        ? expenses.filter((exp) => toIsoDay(exp.date) >= effectiveStart)
        : [];

      const windowSalesRevenue = partnerWindowSales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
      const windowCogs = calculateCostOfGoodsSold(partnerWindowSales, products);
      const windowExpenses = partnerWindowExpenses.reduce((sum, exp) => sum + Number(exp.amount || 0), 0);
      const windowCompanyNetProfit = windowSalesRevenue - windowCogs - windowExpenses;

      const activePeersCapital = shareholders
        .filter((peer) => toIsoDay(peer.joinedDate || peer.createdAt) <= effectiveEnd)
        .reduce((sum, peer) => sum + Number(peer.capital || 0), 0);

      const capitalWeightRatio =
        activePeersCapital > 0
          ? currentCapital / activePeersCapital
          : totalCapital > 0
            ? currentCapital / totalCapital
            : 0;

      let grossProfit = 0;
      let netEntitlement = 0;
      let mgmtFee = 0;

      // Model 1 for Silent Investors:
      if (!isFounder) {
        if (windowCompanyNetProfit > 0 && capitalWeightRatio > 0) {
          grossProfit = Number((windowCompanyNetProfit * capitalWeightRatio).toFixed(2));
          const investorShareRatio = Math.min(100, Math.max(0, sharePercentage)) / 100;
          netEntitlement = Number((grossProfit * investorShareRatio).toFixed(2));
          mgmtFee = Number((grossProfit - netEntitlement).toFixed(2));
        }
      }

      return {
        s,
        currentCapital,
        sharePercentage,
        isFounder,
        managementFeePercentage,
        joinedDate,
        effectiveStart,
        effectiveEnd,
        windowSalesRevenue,
        windowCogs,
        windowExpenses,
        windowCompanyNetProfit,
        capitalWeightRatio,
        grossProfit,
        netEntitlement,
        mgmtFee,
      };
    });

    const totalInvestorsProfit = preparedStakeholders
      .filter((p) => !p.isFounder)
      .reduce((sum, p) => sum + p.netEntitlement, 0);

    const foundersList = preparedStakeholders.filter((p) => p.isFounder);
    const rawFoundersShareTotal =
      foundersList.reduce((sum, f) => sum + f.sharePercentage, 0) || 100;

    // PASS 2: Primary Partners (Founders) receive their agreed % of the remaining net profit pool
    const liveShareholders = preparedStakeholders.map((item) => {
      const s = item.s;
      const currentCapital = item.currentCapital;
      const sharePercentage = item.sharePercentage;
      const isFounder = item.isFounder;
      const managementFeePercentage = item.managementFeePercentage;
      const joinedDate = item.joinedDate;
      const effectiveStart = item.effectiveStart;
      const effectiveEnd = item.effectiveEnd;
      const windowSalesRevenue = item.windowSalesRevenue;
      const windowCogs = item.windowCogs;
      const windowExpenses = item.windowExpenses;
      const windowCompanyNetProfit = item.windowCompanyNetProfit;
      const capitalWeightRatio = item.capitalWeightRatio;

      let netEntitlement = item.netEntitlement;
      let grossProfit = item.grossProfit;
      let mgmtFee = item.mgmtFee;

      if (isFounder) {
        const foundersNetPool = Math.max(0, windowCompanyNetProfit - totalInvestorsProfit);
        const founderShareRatio =
          rawFoundersShareTotal > 0
            ? sharePercentage / rawFoundersShareTotal
            : 1 / (foundersList.length || 1);

        netEntitlement = Number((foundersNetPool * founderShareRatio).toFixed(2));
        grossProfit = netEntitlement;
        mgmtFee = 0;
      }

      const sTxs = ascTxs.filter((t) => t.shareholderId === s.id);
      const totalDeposited = sTxs
        .filter((t) => t.type === 'capital_deposit')
        .reduce((sum, t) => sum + Number(t.amount || 0), 0);
      const totalCapitalWithdrawn = sTxs
        .filter((t) => t.type === 'capital_withdrawal')
        .reduce((sum, t) => sum + Number(t.amount || 0), 0);
      const totalDistributed = sTxs
        .filter((t) => t.type === 'profit_distribution')
        .reduce((sum, t) => sum + Number(t.amount || 0), 0);
      const totalWithdrawnProfits = sTxs
        .filter((t) => t.type === 'profit_withdrawal')
        .reduce((sum, t) => sum + Number(t.amount || 0), 0);

      const netTxCapChange = totalDeposited - totalCapitalWithdrawn;
      const initialBaselineCapital = Math.max(0, currentCapital - netTxCapChange);
      const originalCapital = initialBaselineCapital > 0 ? initialBaselineCapital : currentCapital;

      const earnedPool = Math.max(netEntitlement, totalDistributed);
      const availableProfit = Math.max(0, Number((earnedPool - totalWithdrawnProfits).toFixed(2)));
      const totalNetValue = Number((currentCapital + availableProfit).toFixed(2));

      const ledger: LedgerEntry[] = [];
      let runCap = 0;
      let runProf = 0;

      if (initialBaselineCapital > 0) {
        runCap += initialBaselineCapital;
        ledger.push({
          id: `init-cap-${s.id}`,
          date: joinedDate,
          type: 'initial_capital',
          description: 'رأس المال الأساسي عند انضمام الشريك',
          amount: initialBaselineCapital,
          capitalDelta: initialBaselineCapital,
          profitDelta: 0,
          runningCapital: runCap,
          runningProfit: runProf,
          runningTotalEquity: runCap + runProf,
          createdBy: 'النظام',
          isSynthetic: true,
        });
      }

      for (const tx of sTxs) {
        const amt = Number(tx.amount || 0);
        let capD = 0;
        let profD = 0;
        if (tx.type === 'capital_deposit') {
          capD = amt;
          runCap += amt;
        } else if (tx.type === 'capital_withdrawal') {
          capD = -amt;
          runCap = Math.max(0, runCap - amt);
        } else if (tx.type === 'profit_distribution') {
          profD = amt;
          runProf += amt;
        } else if (tx.type === 'profit_withdrawal') {
          profD = -amt;
          runProf -= amt;
        }
        ledger.push({
          id: tx.id,
          date: toIsoDay(tx.date),
          type: tx.type,
          description: tx.description,
          amount: amt,
          capitalDelta: capD,
          profitDelta: profD,
          runningCapital: runCap,
          runningProfit: Math.max(0, runProf),
          runningTotalEquity: runCap + Math.max(0, runProf),
          createdBy: tx.createdBy || 'النظام',
          isSynthetic: false,
        });
      }

      const unallocated = Number((netEntitlement - totalDistributed).toFixed(2));
      if (Math.abs(unallocated) >= 0.01) {
        runProf += unallocated;
        ledger.push({
          id: `live-prof-${s.id}`,
          date: effectiveEnd,
          type: 'profit_allocation',
          description: isFounder
            ? `صافي أرباح الشريك الأساسي عن الفترة (${sharePercentage}% من محفظة أرباح الشركاء)`
            : `صافي عائد استثمار المساهم عن الفترة (${sharePercentage}% من أرباح رأس ماله بعد نسبة الإدارة)`,
          amount: Math.abs(unallocated),
          capitalDelta: 0,
          profitDelta: unallocated,
          runningCapital: runCap,
          runningProfit: Math.max(0, runProf),
          runningTotalEquity: runCap + Math.max(0, runProf),
          createdBy: 'محرك الأرباح اللحظي',
          isSynthetic: true,
        });
      }

      return {
        ...s,
        capital: currentCapital,
        originalCapital,
        joinedDate,
        effectiveStartDate: effectiveStart,
        effectiveEndDate: effectiveEnd,
        shareRatio: isFounder ? sharePercentage / 100 : sharePercentage / 100,
        capitalWeightRatio: Number(capitalWeightRatio.toFixed(4)),
        windowSalesRevenue,
        windowCogs,
        windowExpenses,
        windowCompanyNetProfit,
        grossProfit,
        mgmtFee,
        netEntitlement,
        totalDeposited,
        totalCapitalWithdrawn,
        totalDistributed,
        totalWithdrawnProfits,
        availableProfit,
        retainedProfits: availableProfit,
        totalNetValue,
        ledger: ledger.reverse(),
      };
    });

    const totalAvailableProfits = liveShareholders.reduce(
      (sum, s) => sum + Number(s.availableProfit || 0),
      0
    );

    const filteredTransactions = transactions;

    return {
      totalCapital,
      totalAvailableProfits,
      liveShareholders,
      filteredTransactions,
    };
  }, [isLoading, liveMetrics, shareholders, transactions, sales, expenses, products]);

  const {
    totalCapital,
    totalAvailableProfits,
    liveShareholders,
    filteredTransactions,
  } = computedState;

  // Calculate Founders' & Partners' Equity Summary
  const foundersSummary = useMemo(() => {
    const totalCount = liveShareholders.length;
    const founders = liveShareholders.filter((s: any) => Boolean(s.isFounder));
    const investors = liveShareholders.filter((s: any) => !s.isFounder);

    const foundersCount = founders.length;
    const investorsCount = investors.length;

    const rawFoundersShare = founders.reduce(
      (sum: number, s: any) => sum + Number(s.sharePercentage || 0),
      0
    );

    const totalInitialCapital = liveShareholders.reduce(
      (sum: number, s: any) => sum + Number(s.originalCapital || s.capital || 0),
      0
    );
    const totalNetEarnedProfits = liveShareholders.reduce(
      (sum: number, s: any) => sum + Number(s.netEntitlement || 0),
      0
    );
    const foundersCapital = founders.reduce(
      (sum: number, s: any) => sum + Number(s.capital || 0),
      0
    );
    const investorsCapital = investors.reduce(
      (sum: number, s: any) => sum + Number(s.capital || 0),
      0
    );

    return {
      rawFoundersShare,
      foundersTotalSharePct: rawFoundersShare,
      totalInitialCapital,
      totalNetEarnedProfits,
      foundersCount,
      partnersCount: investorsCount,
      investorsCount,
      foundersCapital,
      investorsCapital,
    };
  }, [liveShareholders]);

  // Capital Distribution Chart Data (sums to 100% of invested capital)
  const chartData = useMemo(() => {
    if (!liveShareholders.length) return [];
    const totalCap = liveShareholders.reduce(
      (sum: number, s: any) => sum + Number(s.capital || 0),
      0
    );

    return liveShareholders.map((s: any) => {
      let proportionalShare = 0;
      if (totalCap > 0) {
        proportionalShare = Number(((Number(s.capital || 0) / totalCap) * 100).toFixed(1));
      } else {
        proportionalShare = Number((100 / liveShareholders.length).toFixed(1));
      }

      return {
        ...s,
        proportionalShare,
        displayName: `${s.name} (${s.isFounder ? 'شريك أساسي' : 'مساهم تمويل'})`,
      };
    });
  }, [liveShareholders]);

  // Filtered shareholders by search
  const visibleShareholders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return liveShareholders;
    return liveShareholders.filter(
      (s: any) =>
        s.name?.toLowerCase().includes(q) ||
        s.phone?.toLowerCase().includes(q) ||
        s.notes?.toLowerCase().includes(q)
    );
  }, [liveShareholders, searchQuery]);

  // Comprehensive ledger rows across all or selected partner
  const displayedTransactions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return filteredTransactions.filter((tx) => {
      if (ledgerPartnerFilter !== 'all' && tx.shareholderId !== ledgerPartnerFilter) return false;
      if (ledgerTypeFilter !== 'all' && tx.type !== ledgerTypeFilter) return false;
      if (q) {
        const matchesName = tx.shareholderName?.toLowerCase().includes(q);
        const matchesDesc = tx.description?.toLowerCase().includes(q);
        return matchesName || matchesDesc;
      }
      return true;
    });
  }, [filteredTransactions, ledgerPartnerFilter, ledgerTypeFilter, searchQuery]);

  const inspectingPartner = useMemo(() => {
    if (!inspectingPartnerId) return null;
    return liveShareholders.find((s: any) => s.id === inspectingPartnerId) || null;
  }, [inspectingPartnerId, liveShareholders]);

  const handleShareholderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const isFounder = Boolean(shareholderForm.isFounder);
      const sharePercentage = Number(shareholderForm.sharePercentage || 0);
      const managementFeePercentage = isFounder
        ? 0
        : Number(shareholderForm.managementFeePercentage || Math.max(0, 100 - sharePercentage));

      if (sharePercentage <= 0 || sharePercentage > 100) {
        window.alert('الرجاء إدخال نسبة مشاركة صحيحة بين 1% و 100%.');
        return;
      }

      const finalForm = {
        ...shareholderForm,
        isFounder,
        sharePercentage,
        managementFeePercentage,
        affectsTreasury: Boolean(shareholderForm.affectsTreasury),
        isOpeningBalance: !shareholderForm.affectsTreasury,
      };

      if (!editingShareholder) {
        const cap = Number(shareholderForm.capital || 0);
        if (!cap || cap <= 0) {
          window.alert('الرجاء إدخال رأس المال الأساسي للشريك ويجب أن يكون أكبر من صفر.');
          return;
        }
        if (isApiMode()) {
          await api.createShareholder(finalForm);
        } else {
          await createShareholder(finalForm);
        }
      } else {
        const payload = {
          ...finalForm,
          capital: Number(shareholderForm.capital || editingShareholder.capital || 0),
          currentBalance: Number(editingShareholder.currentBalance || 0),
        };
        if (isApiMode()) {
          await api.updateShareholder(editingShareholder.id, payload);
        } else {
          await updateShareholder(editingShareholder.id, payload);
        }
      }
      await loadData();
      setShowShareholderModal(false);
    } catch (err: any) {
      window.alert(err?.message || 'حدث خطأ أثناء حفظ بيانات الشريك.');
    }
  };

  const handleTransactionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedShareholderId || transactionForm.amount <= 0) return;
    const selectedPartner: any = liveShareholders.find((s: any) => s.id === selectedShareholderId);
    if (!selectedPartner) return;

    const availableProfit = Number(selectedPartner.availableProfit || 0);
    const capital = Number(selectedPartner.capital || 0);
    const requestedAmount = Number(transactionForm.amount || 0);

    // Strict separation between Profit Withdrawal and Capital Withdrawal
    if (transactionType === 'profit_withdrawal') {
      if (availableProfit <= 0) {
        window.alert('لا توجد أرباح متاحة للسحب لهذا الشريك حالياً.');
        return;
      }
      if (requestedAmount > availableProfit + 0.01) {
        window.alert(
          `المبلغ المطلوب (${formatCurrency(requestedAmount)}) أكبر من الأرباح المتاحة للسحب (${formatCurrency(availableProfit)}).`
        );
        return;
      }
    } else if (transactionType === 'capital_withdrawal') {
      if (requestedAmount > capital + 0.01) {
        window.alert(
          `المبلغ المطلوب سحبه من رأس المال (${formatCurrency(requestedAmount)}) أكبر من رأس المال الفعلي للشريك (${formatCurrency(capital)}). لسحب الأرباح يرجى استخدام زر "سحب أرباح".`
        );
        return;
      }
    }

    const defaultDesc =
      transactionType === 'capital_deposit'
        ? 'إيداع زيادة رأس مال'
        : transactionType === 'capital_withdrawal'
          ? 'سحب وتخفيض من رأس المال'
          : transactionType === 'profit_distribution'
            ? 'تخصيص وتوزيع أرباح دورية'
            : 'سحب من الأرباح المحققة المتاحة';

    const txPayload = {
      shareholderId: selectedShareholderId,
      shareholderName: selectedPartner.name,
      type: transactionType,
      amount: requestedAmount,
      date: transactionForm.date || new Date().toISOString().slice(0, 10),
      description: transactionForm.description.trim() || defaultDesc,
      affectsTreasury: transactionForm.affectsTreasury !== false,
      createdBy: user?.name || 'النظام',
    };

    try {
      if (isApiMode()) {
        await api.createShareholderTransaction(txPayload);
      } else {
        await addShareholderTransaction(txPayload);
      }
      await loadData();
      setShowTransactionModal(false);
      setTransactionForm({ amount: 0, date: new Date().toISOString().slice(0, 10), description: '', affectsTreasury: true });
    } catch (err: any) {
      window.alert(err?.message || 'حدث خطأ أثناء تنفيذ الحركة المالية.');
    }
  };

  const handleDeleteTransaction = async (txId: string) => {
    const isConfirmed = await confirmDialog({
      title: 'تأكيد حذف الحركة المالية',
      message: 'هل أنت متأكد من حذف هذه الحركة المالية وعكس أثرها على رأس المال والأرباح والخزينة؟',
      confirmText: 'نعم، حذف الحركة',
      cancelText: 'إلغاء',
      type: 'danger',
    });
    if (!isConfirmed) return;
    try {
      if (isApiMode()) {
        await api.deleteShareholderTransaction(txId);
      } else {
        await deleteShareholderTransaction(txId);
      }
      await loadData();
      showToast('تم حذف الحركة المالية وعكس أثرها بنجاح', 'success');
    } catch (err: any) {
      showToast('فشل حذف الحركة: ' + (err.message || 'خطأ في النظام'), 'error');
    }
  };

  const handleDeleteShareholder = async (shareholderId: string, name: string) => {
    const isConfirmed = await confirmDialog({
      title: 'تأكيد حذف الشريك',
      message: `هل أنت متأكد من حذف الشريك "${name}" وكافة سجلاته وحصته من النظام؟`,
      confirmText: 'نعم، حذف الشريك',
      cancelText: 'إلغاء',
      type: 'danger',
    });
    if (!isConfirmed) return;
    try {
      if (isApiMode()) {
        await api.deleteShareholder(shareholderId);
      } else {
        await deleteShareholder(shareholderId);
      }
      if (inspectingPartnerId === shareholderId) setInspectingPartnerId(null);
      await loadData();
      showToast('تم حذف الشريك بنجاح', 'success');
    } catch (err: any) {
      showToast('فشل حذف الشريك: ' + (err.message || 'خطأ في النظام'), 'error');
    }
  };

  const openTxModal = (
    partnerId: string,
    type: 'capital_deposit' | 'capital_withdrawal' | 'profit_withdrawal' | 'profit_distribution'
  ) => {
    setSelectedShareholderId(partnerId);
    setTransactionType(type);
    setTransactionForm({
      amount: 0,
      date: new Date().toISOString().slice(0, 10),
      description: '',
      affectsTreasury: true,
    });
    setShowTransactionModal(true);
  };

  return (
    <div className="flex flex-col h-full flex-1 min-h-0 space-y-2">
      {/* TIER 1: Fixed Compact Action Header */}
      <section className="bg-white rounded-xl px-3 py-1.5 border border-slate-200 shadow-2xs flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-2xs shrink-0">
            <Landmark size={15} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h2 className="text-sm md:text-base font-black text-slate-900 leading-tight">
                حسابات الشركاء والمساهمين
              </h2>
            </div>
            <p className="text-[10px] text-slate-400 truncate">
              متابعة رؤوس الأموال وحصص الأرباح (آخر تحديث: {lastSynced.toLocaleTimeString('ar-EG')})
            </p>
          </div>
        </div>

        {/* Action Controls & View Switcher */}
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Search Input */}
          <div className="relative w-32 sm:w-40">
            <Search size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="بحث..."
              className="input-ui h-7 w-full pr-7 pl-2 text-xs bg-slate-50 border-slate-200 focus:bg-white"
            />
          </div>

          {/* Main Tabs Switcher */}
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-xs font-bold">
            <button
              type="button"
              onClick={() => setActiveTab('overview')}
              className={`flex items-center gap-1 px-2 py-0.5 rounded-md transition-all ${
                activeTab === 'overview'
                  ? 'bg-white text-blue-700 shadow-2xs font-extrabold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <PieChartIcon size={12} />
              <span>الحصص ({liveShareholders.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('ledger')}
              className={`flex items-center gap-1 px-2 py-0.5 rounded-md transition-all ${
                activeTab === 'ledger'
                  ? 'bg-white text-blue-700 shadow-2xs font-extrabold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileText size={12} />
              <span>المعاملات ({displayedTransactions.length})</span>
            </button>
          </div>

          {/* Chart Toggle Button */}
          {activeTab === 'overview' && liveShareholders.length > 0 && (
            <button
              type="button"
              onClick={() => setShowChartBanner(!showChartBanner)}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold transition-all border ${
                showChartBanner
                  ? 'bg-blue-50 border-blue-200 text-blue-700'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
              title="عرض أو إخفاء مخطط توزيع الحصص"
            >
              <PieChartIcon size={12} />
              <span>المخطط</span>
              {showChartBanner ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            </button>
          )}

          <button
            type="button"
            onClick={loadData}
            disabled={isLoading}
            className="flex items-center gap-1 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 px-2 py-1 rounded-lg text-xs font-bold transition-all shadow-2xs active:scale-95 disabled:opacity-50 cursor-pointer"
            title="تحديث لحظي من قاعدة البيانات"
          >
            <RefreshCw size={12} className={isLoading ? 'animate-spin text-blue-600' : ''} />
            <span className="hidden sm:inline">تحديث</span>
          </button>

          {user?.role !== 'manager' && (
            <button
              type="button"
              onClick={() => {
                setEditingShareholder(null);
                setShareholderForm({
                  name: '',
                  phone: '',
                  isFounder: false,
                  sharePercentage: 50,
                  managementFeePercentage: 50,
                  capital: 0,
                  joinedDate: new Date().toISOString().slice(0, 10),
                  notes: '',
                  affectsTreasury: true,
                });
                setShowShareholderModal(true);
              }}
              className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white px-2.5 py-1 rounded-lg transition-all text-xs font-bold shadow-xs active:scale-95 cursor-pointer whitespace-nowrap"
            >
              <Plus size={13} />
              <span>+ إضافة شريك</span>
            </button>
          )}
        </div>
      </section>

      {/* TIER 2: Streamlined 4-KPI Partner Summary Strip */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-2 shrink-0">
        {/* KPI 1: Total Active Capital */}
        <div className="bg-white rounded-xl px-3 py-2 border border-slate-200/80 shadow-2xs flex items-center justify-between gap-2">
          <div className="min-w-0">
            <span className="text-[11px] font-bold text-slate-500 block truncate">إجمالي رأس المال الفعلي</span>
            <span className="text-base font-black text-slate-900 tabular-nums block leading-tight mt-0.5">
              {formatCurrency(totalCapital)}
            </span>
            <span className="text-[10px] text-slate-400 block truncate mt-0.5">
              الافتتاحي: {formatCurrency(foundersSummary.totalInitialCapital)}
            </span>
          </div>
          <div className="w-7 h-7 bg-indigo-50 rounded-lg flex items-center justify-center text-indigo-600 shrink-0 border border-indigo-100">
            <Wallet size={15} />
          </div>
        </div>

        {/* KPI 2: Founders Ownership & Investors */}
        <div className="bg-white rounded-xl px-3 py-2 border border-slate-200/80 shadow-2xs flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <span className="text-[11px] font-bold text-slate-500 block truncate">ملكية المنشأة والتمويل</span>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              <span className="inline-flex items-center gap-1 text-[11px] font-black text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200/60 tabular-nums">
                الشركاء: %{foundersSummary.rawFoundersShare}
              </span>
              <span className="inline-flex items-center gap-1 text-[11px] font-black text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded border border-purple-200/60 tabular-nums">
                المساهمون: {foundersSummary.investorsCount} مساهم
              </span>
            </div>
          </div>
          <div className="w-7 h-7 bg-blue-50 rounded-lg flex items-center justify-center text-blue-600 shrink-0 border border-blue-100">
            <Award size={15} />
          </div>
        </div>

        {/* KPI 3: Available Profits for Withdrawal */}
        <div className="bg-white rounded-xl px-3 py-2 border border-slate-200/80 shadow-2xs flex items-center justify-between gap-2">
          <div className="min-w-0">
            <span className="text-[11px] font-bold text-slate-500 block truncate">الأرباح المتاحة للصرف</span>
            <span className="text-base font-black text-emerald-600 tabular-nums block leading-tight mt-0.5">
              +{formatCurrency(totalAvailableProfits)}
            </span>
            <span className="text-[10px] text-slate-400 block truncate mt-0.5">
              أرباح جاهزة للسحب الفوري
            </span>
          </div>
          <div className="w-7 h-7 bg-emerald-50 rounded-lg flex items-center justify-center text-emerald-600 shrink-0 border border-emerald-100">
            <DollarSign size={15} />
          </div>
        </div>

        {/* KPI 4: Active Partners Count */}
        <div className="bg-white rounded-xl px-3 py-2 border border-slate-200/80 shadow-2xs flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <span className="text-[11px] font-bold text-slate-500 block truncate">الشركاء والمساهمون</span>
            <span className="text-base font-black text-slate-900 tabular-nums block leading-tight mt-0.5">
              {liveShareholders.length} <span className="text-xs font-normal text-slate-500">نشط</span>
            </span>
            <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-bold mt-0.5">
              <span>{foundersSummary.foundersCount} شريك</span>
              <span>•</span>
              <span>{foundersSummary.partnersCount} مساهم</span>
            </div>
          </div>
          <div className="w-7 h-7 bg-purple-50 rounded-lg flex items-center justify-center text-purple-600 shrink-0 border border-purple-100">
            <Users size={15} />
          </div>
        </div>
      </section>

      {/* TIER 3: Flexible & Contained Main Content Area */}
      {activeTab === 'overview' ? (
        <section className="flex-1 min-h-0 flex flex-col rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
          {/* Optional Collapsible Equity Distribution Chart Banner */}
          {liveShareholders.length > 0 && showChartBanner && (
            <div className="bg-slate-50/90 p-3 border-b border-slate-200 grid grid-cols-1 lg:grid-cols-12 gap-3 items-center shrink-0 animate-in fade-in duration-200">
              <div className="lg:col-span-4 space-y-1">
                <h3 className="text-xs md:text-sm font-black text-slate-800 flex items-center gap-1.5">
                  <PieChartIcon size={14} className="text-indigo-600" />
                  <span>توزيع رؤوس الأموال وهيكل الملكية</span>
                </h3>
                <div className="flex items-center gap-2 pt-1 text-xs flex-wrap font-bold">
                  <span className="text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                    الشركاء الأساسيون: %{foundersSummary.rawFoundersShare} من ملكية المنشأة
                  </span>
                  <span className="text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-200">
                    المساهمون: {foundersSummary.investorsCount} مساهم بالتمويل
                  </span>
                </div>
              </div>

              <div className="lg:col-span-8 min-w-0 w-full h-28 flex items-center justify-center overflow-hidden">
                <TypedResponsiveContainer width="100%" height={110}>
                  <TypedPieChart margin={{ top: 0, right: 10, bottom: 0, left: 10 }}>
                    <TypedPie
                      data={chartData}
                      cx="50%"
                      cy="50%"
                      innerRadius={24}
                      outerRadius={42}
                      paddingAngle={3}
                      dataKey="proportionalShare"
                      nameKey="name"
                    >
                      {chartData.map((_: any, index: number) => (
                        <TypedCell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </TypedPie>
                    <TypedTooltip
                      formatter={(value: number, _name: string, entry: any) => [
                        `${Number(value).toFixed(1)}% (رأس المال: ${formatCurrency(entry.payload.capital)})`,
                        'الحصة',
                      ]}
                    />
                    <TypedLegend
                      layout="horizontal"
                      align="center"
                      verticalAlign="bottom"
                      formatter={(value: string) => {
                        const item = chartData.find((c) => c.name === value);
                        return `${value} (${item?.proportionalShare ?? 0}%)`;
                      }}
                      wrapperStyle={{ fontSize: '11px', paddingTop: '2px' }}
                    />
                  </TypedPieChart>
                </TypedResponsiveContainer>
              </div>
            </div>
          )}

          {/* Main Partners View: Cards Only */}
          {visibleShareholders.length === 0 ? (
            <div className="py-16 text-center text-slate-400">
              <Users size={40} className="mx-auto mb-2 text-slate-300" />
              <p className="text-sm font-bold text-slate-600">لا يوجد مساهمون مطابقون للبحث</p>
            </div>
          ) : (
            /* Streamlined Modern Cards View */
            <div className="flex-1 min-h-0 overflow-y-auto p-3.5">
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
                {visibleShareholders.map((shareholder: any, index: number) => {
                  const propShare =
                    chartData.find((c) => c.id === shareholder.id)?.proportionalShare ??
                    shareholder.sharePercentage ??
                    0;
                  return (
                    <div
                      key={shareholder.id}
                      className="bg-white rounded-xl p-3.5 border border-slate-200/90 shadow-2xs hover:shadow-md transition-all flex flex-col justify-between"
                    >
                      <div>
                        {/* Header */}
                        <div className="flex justify-between items-start gap-2 mb-2.5">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div
                              className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-black text-sm shrink-0 shadow-2xs"
                              style={{ backgroundColor: COLORS[index % COLORS.length] }}
                            >
                              {shareholder.name.charAt(0)}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <h4 className="font-black text-slate-900 text-sm truncate">{shareholder.name}</h4>
                                <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                                  shareholder.isFounder
                                    ? 'bg-purple-100 text-purple-700 border border-purple-200'
                                    : 'bg-slate-100 text-slate-600 border border-slate-200'
                                }`}>
                                  {shareholder.isFounder ? 'شريك' : 'مساهم'}
                                </span>
                              </div>
                              <div className="text-[10px] text-slate-400 font-medium mt-0.5">
                                انضم: {formatDateDisplay(shareholder.joinedDate || shareholder.createdAt)}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <div className="flex flex-col items-end">
                              <span className={`px-2 py-0.5 rounded-md font-black text-xs ${
                                shareholder.isFounder
                                  ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                  : 'bg-purple-50 text-purple-700 border border-purple-200'
                              }`}>
                                %{shareholder.sharePercentage}
                              </span>
                              <span className="text-[9px] text-slate-400 font-bold mt-0.5 whitespace-nowrap">
                                {shareholder.isFounder ? 'ملكية بالشركة' : 'عائد تمويل'}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                const isF = Boolean(shareholder.isFounder);
                                setEditingShareholder(shareholder);
                                setShareholderForm({
                                  name: shareholder.name,
                                  phone: shareholder.phone,
                                  isFounder: isF,
                                  sharePercentage: shareholder.sharePercentage || 0,
                                  managementFeePercentage: isF ? 0 : (shareholder.managementFeePercentage ?? 50),
                                  capital: shareholder.capital,
                                  joinedDate: toIsoDay(shareholder.joinedDate || shareholder.createdAt),
                                  notes: shareholder.notes || '',
                                  affectsTreasury: true,
                                });
                                setShowShareholderModal(true);
                              }}
                              className="p-1 text-slate-400 hover:text-indigo-600 transition-colors"
                              title="تعديل بيانات الشريك"
                            >
                              <Edit size={13} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteShareholder(shareholder.id, shareholder.name)}
                              className="p-1 text-slate-400 hover:text-rose-600 transition-colors"
                              title="حذف الشريك"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>

                        {/* 3 Clear Metric Pillars */}
                        <div className="grid grid-cols-3 gap-2 p-2 bg-slate-50/80 rounded-xl border border-slate-200/70 mb-2.5 text-center">
                          <div className="bg-white p-2 rounded-lg border border-slate-200/60 shadow-2xs">
                            <span className="text-[10px] font-bold text-slate-500 block leading-tight">رأس المال</span>
                            <span className="text-xs font-black text-slate-800 block mt-1">{formatCurrency(shareholder.capital)}</span>
                          </div>
                          <div className="bg-emerald-50/70 p-2 rounded-lg border border-emerald-200/60 shadow-2xs">
                            <span className="text-[10px] font-bold text-emerald-700 block leading-tight">الأرباح المتاحة</span>
                            <span className="text-xs font-black text-emerald-800 block mt-1">+{formatCurrency(shareholder.availableProfit)}</span>
                          </div>
                          <div className="bg-indigo-50/70 p-2 rounded-lg border border-indigo-200/60 shadow-2xs">
                            <span className="text-[10px] font-bold text-indigo-700 block leading-tight">إجمالي الرصيد</span>
                            <span className="text-xs font-black text-indigo-900 block mt-1">{formatCurrency(shareholder.totalNetValue)}</span>
                          </div>
                        </div>

                        {/* Compact Secondary Line */}
                        <div className="flex items-center justify-between text-[11px] px-2.5 py-1.5 rounded-lg bg-slate-100/70 border border-slate-200/60 text-slate-600 mb-2.5 font-semibold">
                          <span>أرباح مكتسبة: <strong className="text-blue-700">+{formatCurrency(shareholder.netEntitlement)}</strong></span>
                          <span>•</span>
                          <span>مسحوبات سابقة: <strong className={Number(shareholder.totalWithdrawnProfits) > 0 ? 'text-amber-700' : 'text-slate-600'}>{formatWithdrawal(shareholder.totalWithdrawnProfits)}</strong></span>
                        </div>
                      </div>

                      {/* Clean Action Buttons */}
                      <div className="pt-2 border-t border-slate-100 flex items-center gap-1.5 mt-auto">
                        <button
                          type="button"
                          onClick={() => openTxModal(shareholder.id, 'profit_withdrawal')}
                          className="flex-1 py-1.5 px-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-all shadow-xs flex items-center justify-center gap-1 active:scale-95"
                        >
                          <DollarSign size={13} />
                          <span>صرف أرباح</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => openTxModal(shareholder.id, 'capital_deposit')}
                          className="py-1.5 px-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold transition-all border border-slate-200 flex items-center justify-center gap-1 active:scale-95"
                          title="إيداع وزيادة رأس المال"
                        >
                          <ArrowDownToLine size={13} />
                          <span>إيداع</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setInspectingPartnerId(shareholder.id)}
                          className="py-1.5 px-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold transition-all border border-slate-200 flex items-center justify-center gap-1 active:scale-95"
                          title="كشف الحساب التفصيلي للشريك"
                        >
                          <FileText size={13} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Pinned Bottom Status Bar */}
          <div className="erp-status-bar shrink-0 py-1.5 px-3 text-[11px] min-h-9">
            <div className="flex items-center gap-4 flex-wrap">
              <span>
                عدد الشركاء والمساهمين: <strong className="text-blue-700 font-extrabold">{visibleShareholders.length}</strong>
              </span>
              <span>
                إجمالي رأس المال الفعلي: <strong className="text-slate-900 font-extrabold">{formatCurrency(totalCapital)}</strong>
              </span>
              <span>
                الأرباح المتاحة للسحب: <strong className="text-emerald-700 font-extrabold">{formatCurrency(totalAvailableProfits)}</strong>
              </span>
            </div>
            <div className="text-slate-500 text-[10px]">
              الأرباح مرجحة تلقائياً بتاريخ انضمام كل شريك ومساهم
            </div>
          </div>
        </section>
      ) : (
        /* TAB 2: Comprehensive Shareholder Ledger & Transaction History */
        <section className="flex-1 min-h-0 flex flex-col rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
          {/* Sub-toolbar for Ledger filtering */}
          <div className="px-3.5 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
            {/* Side-by-side filter controls container */}
            <div className="flex-1 max-w-2xl grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
              {/* Filter 1: تصفية الشريك والمساهم */}
              <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-200 shadow-2xs">
                <Users size={14} className="text-blue-600 shrink-0" />
                <label className="text-xs font-bold text-slate-600 shrink-0 whitespace-nowrap">
                  الشريك / المساهم:
                </label>
                <select
                  value={ledgerPartnerFilter}
                  onChange={(e) => setLedgerPartnerFilter(e.target.value)}
                  className="w-full text-xs bg-transparent border-none font-bold text-slate-800 outline-none cursor-pointer"
                >
                  <option value="all">جميع الشركاء والمساهمين ({liveShareholders.length})</option>
                  {liveShareholders.map((s: any) => (
                    <option key={s.id} value={s.id}>
                      {s.name} {s.isFounder ? '(شريك أساسي)' : '(مساهم تمويل)'}
                    </option>
                  ))}
                </select>
              </div>

              {/* Filter 2: أنواع الحركات */}
              <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-200 shadow-2xs">
                <Filter size={14} className="text-blue-600 shrink-0" />
                <label className="text-xs font-bold text-slate-600 shrink-0 whitespace-nowrap">
                  أنواع الحركات:
                </label>
                <select
                  value={ledgerTypeFilter}
                  onChange={(e) => setLedgerTypeFilter(e.target.value)}
                  className="w-full text-xs bg-transparent border-none font-bold text-slate-800 outline-none cursor-pointer"
                >
                  <option value="all">كل أنواع الحركات المالية</option>
                  <option value="capital_deposit">إيداع وزيادة رأس المال</option>
                  <option value="capital_withdrawal">سحب وتخفيض رأس المال</option>
                  <option value="profit_distribution">توزيع أرباح</option>
                  <option value="profit_withdrawal">صرف / سحب أرباح</option>
                </select>
              </div>
            </div>

            {/* Quick Action / Deep Statement Link */}
            {ledgerPartnerFilter !== 'all' && (
              <button
                type="button"
                onClick={() => setInspectingPartnerId(ledgerPartnerFilter)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl text-xs font-bold transition-all border border-indigo-200 active:scale-95 shrink-0 self-start md:self-auto cursor-pointer"
              >
                <FileText size={13} />
                <span>فتح كشف الحساب الكامل للشريك</span>
                <ChevronLeft size={13} />
              </button>
            )}
          </div>

          <div className="desktop-table-scroll">
            <table className="w-full min-w-[950px] border-collapse">
              <thead className="desktop-sticky-header">
                <tr>
                  <th className="py-2.5 px-4 text-right min-w-[110px]">التاريخ</th>
                  <th className="py-2.5 px-4 text-right min-w-[170px]">الشريك / المساهم</th>
                  <th className="py-2.5 px-4 text-right min-w-[140px]">نوع الحركة</th>
                  <th className="py-2.5 px-4 text-right min-w-[140px]">المبلغ</th>
                  <th className="py-2.5 px-4 text-right min-w-[150px]">رصيد رأس المال بعد الحركة</th>
                  <th className="py-2.5 px-4 text-right min-w-[150px]">الأرباح المتاحة بعد الحركة</th>
                  <th className="py-2.5 px-4 text-right min-w-[200px]">البيان / الملاحظات</th>
                  <th className="py-2.5 px-4 text-right min-w-[110px]">بواسطة</th>
                  <th className="py-2.5 px-4 text-center w-16">إجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {displayedTransactions.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-16 px-4 text-center text-slate-400">
                      <FileText size={36} className="mx-auto mb-2 text-slate-300" />
                      <p className="text-xs font-bold">لا توجد حركات مالية مسجلة مطابقة للفلتر</p>
                    </td>
                  </tr>
                ) : (
                  displayedTransactions.map((tx: any) => {
                    const isPositive = tx.type === 'capital_deposit' || tx.type === 'profit_distribution';
                    const partner = liveShareholders.find((s: any) => s.id === tx.shareholderId);
                    const partnerName = partner?.name || tx.shareholderName;
                    const isFounder = partner ? Boolean(partner.isFounder) : false;

                    return (
                      <tr key={tx.id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-2.5 px-4 text-xs font-mono text-slate-600 whitespace-nowrap">
                          {formatDateDisplay(tx.date)}
                        </td>
                        <td className="py-2.5 px-4 text-xs md:text-sm font-bold text-slate-900 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setInspectingPartnerId(tx.shareholderId)}
                            className="hover:text-indigo-600 text-right inline-flex items-center gap-1.5 group cursor-pointer"
                          >
                            <span className="font-black group-hover:underline text-slate-900 group-hover:text-indigo-600">
                              {partnerName}
                            </span>
                            {isFounder ? (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-black bg-blue-50 text-blue-700 border border-blue-200">
                                شريك أساسي
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
                                مساهم تمويل
                              </span>
                            )}
                          </button>
                        </td>
                        <td className="py-2.5 px-4 whitespace-nowrap">
                          {tx.type === 'capital_deposit' && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                              <ArrowDownToLine size={12} className="text-indigo-600" />
                              <span>إيداع رأس مال</span>
                            </span>
                          )}
                          {tx.type === 'capital_withdrawal' && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                              <ArrowUpFromLine size={12} className="text-rose-600" />
                              <span>سحب رأس مال</span>
                            </span>
                          )}
                          {tx.type === 'profit_distribution' && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <DollarSign size={12} className="text-emerald-600" />
                              <span>توزيع أرباح</span>
                            </span>
                          )}
                          {tx.type === 'profit_withdrawal' && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                              <Wallet size={12} className="text-amber-600" />
                              <span>صرف أرباح</span>
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs md:text-sm font-mono font-black tabular-nums border ${
                              isPositive
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : 'bg-rose-50 text-rose-700 border-rose-200'
                            }`}
                            dir="ltr"
                          >
                            <span>{isPositive ? '+' : '-'}</span>
                            <span>{formatCurrency(tx.amount)}</span>
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-xs font-bold text-slate-800 tabular-nums whitespace-nowrap font-mono">
                          {tx.runningCapital !== undefined ? formatCurrency(tx.runningCapital) : '-'}
                        </td>
                        <td className="py-2.5 px-4 text-xs font-bold text-emerald-700 tabular-nums whitespace-nowrap font-mono">
                          {tx.runningAvailableProfit !== undefined ? formatCurrency(tx.runningAvailableProfit) : '-'}
                        </td>
                        <td className="py-2.5 px-4 text-xs text-slate-600 max-w-xs truncate" title={tx.description}>
                          {tx.description}
                        </td>
                        <td className="py-2.5 px-4 text-xs text-slate-600 whitespace-nowrap">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-medium">
                            {tx.createdBy || 'المدير العام'}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-center whitespace-nowrap">
                          {user?.role !== 'manager' ? (
                            <button
                              type="button"
                              onClick={() => handleDeleteTransaction(tx.id)}
                              className="p-1.5 text-rose-600 hover:bg-rose-50 hover:text-rose-700 rounded-lg transition-colors border border-transparent hover:border-rose-200 cursor-pointer"
                              title="حذف وعكس أثر الحركة"
                            >
                              <Trash2 size={15} />
                            </button>
                          ) : (
                            <span className="text-xs text-slate-400 font-bold">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="erp-status-bar shrink-0 py-2 px-4 text-xs min-h-10 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-4 flex-wrap text-slate-700">
              <span className="inline-flex items-center gap-1.5">
                <span>إجمالي الحركات المعروضة:</span>
                <strong className="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 font-extrabold border border-indigo-200 font-mono">
                  {displayedTransactions.length}
                </strong>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span>إجمالي إيداعات رأس المال:</span>
                <strong className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 font-extrabold border border-emerald-200 font-mono">
                  {formatCurrency(
                    displayedTransactions
                      .filter((t) => t.type === 'capital_deposit')
                      .reduce((s, t) => s + Number(t.amount || 0), 0)
                  )}
                </strong>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span>إجمالي مسحوبات الأرباح:</span>
                <strong className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 font-extrabold border border-amber-200 font-mono">
                  {formatCurrency(
                    displayedTransactions
                      .filter((t) => t.type === 'profit_withdrawal')
                      .reduce((s, t) => s + Number(t.amount || 0), 0)
                  )}
                </strong>
              </span>
            </div>
            <span className="inline-flex items-center gap-1.5 text-slate-500 font-bold text-xs">
              <ShieldCheck size={14} className="text-emerald-600" />
              <span>مرتبط محاسبياً وتلقائياً بالخزينة</span>
            </span>
          </div>
        </section>
      )}

      {/* Detailed Partner Chronological Ledger Modal */}
      {inspectingPartner && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-5xl max-h-[88vh] shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between shrink-0">
              <div className="min-w-0">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold shrink-0 shadow-2xs">
                    <FileText size={16} />
                  </div>
                  <h3 className="text-base md:text-lg font-black text-slate-900 truncate">
                    كشف الحساب الشامل: {inspectingPartner.name}
                  </h3>
                  {inspectingPartner.isFounder ? (
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-black bg-blue-50 text-blue-700 border border-blue-200">
                      شريك
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                      مساهم
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-1 flex items-center gap-3">
                  <span>حصة الملكية: <strong className="text-blue-700 font-bold">{inspectingPartner.sharePercentage}%</strong></span>
                  <span>•</span>
                  <span>تاريخ الانضمام: <strong className="text-slate-800 font-bold">{formatDateDisplay(inspectingPartner.joinedDate || inspectingPartner.createdAt)}</strong></span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectingPartnerId(null)}
                className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-xl transition-colors shrink-0"
              >
                <X size={18} />
              </button>
            </div>

            {/* Standardized 4-KPI Summary Strip Inside Modal */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 bg-slate-50/50 border-b border-slate-200/80 shrink-0">
              {/* Card 1: Active Capital */}
              <div className="p-3.5 rounded-xl bg-white border border-slate-200/90 shadow-2xs flex items-center justify-between gap-2.5">
                <div className="min-w-0">
                  <span className="text-[11px] font-bold text-slate-500 block mb-0.5 truncate">رأس المال العامل</span>
                  <span className="text-base md:text-lg font-black text-slate-900 tabular-nums block leading-tight truncate">
                    {formatCurrency(inspectingPartner.capital)}
                  </span>
                </div>
                <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
                  <Wallet size={16} />
                </div>
              </div>

              {/* Card 2: Earned Profits */}
              <div className="p-3.5 rounded-xl bg-white border border-slate-200/90 shadow-2xs flex items-center justify-between gap-2.5">
                <div className="min-w-0">
                  <span className="text-[11px] font-bold text-slate-500 block mb-0.5 truncate">صافي الأرباح المكتسبة</span>
                  <span className="text-base md:text-lg font-black text-indigo-700 tabular-nums block leading-tight truncate">
                    {formatCurrency(inspectingPartner.netEntitlement)}
                  </span>
                </div>
                <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
                  <Award size={16} />
                </div>
              </div>

              {/* Card 3: Withdrawn Profits */}
              <div className="p-3.5 rounded-xl bg-white border border-amber-200 shadow-2xs flex items-center justify-between gap-2.5">
                <div className="min-w-0">
                  <span className="text-[11px] font-bold text-amber-800 block mb-0.5 truncate">مسحوبات الأرباح</span>
                  <span className="text-base md:text-lg font-black text-amber-700 tabular-nums block leading-tight truncate">
                    {formatWithdrawal(inspectingPartner.totalWithdrawnProfits)}
                  </span>
                </div>
                <div className="w-8 h-8 rounded-lg bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center shrink-0">
                  <ArrowUpFromLine size={16} />
                </div>
              </div>

              {/* Card 4: Available Profits */}
              <div className="p-3.5 rounded-xl bg-white border border-emerald-200 shadow-2xs flex items-center justify-between gap-2.5">
                <div className="min-w-0">
                  <span className="text-[11px] font-bold text-emerald-800 block mb-0.5 truncate">الأرباح المتاحة للسحب</span>
                  <span className="text-base md:text-lg font-black text-emerald-700 tabular-nums block leading-tight truncate">
                    {formatCurrency(inspectingPartner.availableProfit)}
                  </span>
                </div>
                <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center shrink-0">
                  <DollarSign size={16} />
                </div>
              </div>
            </div>

            {/* Scrollable Chronological Ledger Table (Strictly 100% Modal Width, No Horizontal Scrollbar) */}
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
              <table className="w-full table-fixed border-collapse text-xs">
                <thead className="desktop-sticky-header">
                  <tr>
                    <th className="py-2.5 px-3 text-right w-[13%] whitespace-nowrap">التاريخ</th>
                    <th className="py-2.5 px-3 text-right w-[14%] whitespace-nowrap">نوع القيد</th>
                    <th className="py-2.5 px-3 text-right w-[25%]">البيان والتفاصيل</th>
                    <th className="py-2.5 px-3 text-right w-[12%] whitespace-nowrap">حركة رأس المال</th>
                    <th className="py-2.5 px-3 text-right w-[12%] whitespace-nowrap">حركة الأرباح</th>
                    <th className="py-2.5 px-3 text-right w-[12%] whitespace-nowrap">رصيد رأس المال</th>
                    <th className="py-2.5 px-3 text-right w-[12%] whitespace-nowrap">رصيد الأرباح المتاحة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(!inspectingPartner.ledger || inspectingPartner.ledger.length === 0) ? (
                    <tr>
                      <td colSpan={7} className="py-12 px-4 text-center text-slate-400">
                        <FileText size={32} className="mx-auto mb-2 text-slate-300" />
                        <p className="text-xs font-bold">لا توجد حركات مسجلة في كشف حساب الشريك</p>
                      </td>
                    </tr>
                  ) : (
                    inspectingPartner.ledger.map((entry: LedgerEntry) => (
                      <tr
                        key={entry.id}
                        className={entry.isSynthetic ? 'bg-indigo-50/30 hover:bg-indigo-50/50' : 'hover:bg-slate-50 transition-colors'}
                      >
                        <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600 truncate whitespace-nowrap">
                          {formatDateDisplay(entry.date)}
                        </td>
                        <td className="py-2.5 px-3 truncate whitespace-nowrap">
                          <span
                            className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold truncate ${
                              entry.type === 'initial_capital' || entry.type === 'capital_deposit'
                                ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                                : entry.type === 'capital_withdrawal'
                                  ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                  : entry.type === 'profit_allocation' || entry.type === 'profit_distribution'
                                    ? 'bg-purple-50 text-purple-700 border border-purple-200'
                                    : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                            }`}
                          >
                            {entry.type === 'initial_capital'
                              ? 'رأس مال تأسيسي'
                              : entry.type === 'capital_deposit'
                                ? 'إيداع رأس مال'
                                : entry.type === 'capital_withdrawal'
                                  ? 'سحب رأس مال'
                                  : entry.type === 'profit_allocation'
                                    ? 'استحقاق أرباح'
                                    : entry.type === 'profit_distribution'
                                      ? 'توزيع أرباح'
                                      : 'سحب أرباح'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-700 font-medium truncate" title={entry.description}>
                          {entry.description}
                        </td>
                        <td
                          className={`py-2.5 px-3 font-bold tabular-nums text-right truncate whitespace-nowrap ${
                            entry.capitalDelta > 0
                              ? 'text-indigo-600'
                              : entry.capitalDelta < 0
                                ? 'text-rose-600'
                                : 'text-slate-400'
                          }`}
                        >
                          {entry.capitalDelta !== 0
                            ? `${entry.capitalDelta > 0 ? '+' : ''}${formatCurrency(entry.capitalDelta)}`
                            : '-'}
                        </td>
                        <td
                          className={`py-2.5 px-3 font-bold tabular-nums text-right truncate whitespace-nowrap ${
                            entry.profitDelta > 0
                              ? 'text-purple-600'
                              : entry.profitDelta < 0
                                ? 'text-amber-600'
                                : 'text-slate-400'
                          }`}
                        >
                          {entry.profitDelta !== 0
                            ? `${entry.profitDelta > 0 ? '+' : ''}${formatCurrency(entry.profitDelta)}`
                            : '-'}
                        </td>
                        <td className="py-2.5 px-3 font-bold text-slate-900 tabular-nums text-right truncate whitespace-nowrap">
                          {formatCurrency(entry.runningCapital)}
                        </td>
                        <td className="py-2.5 px-3 font-bold text-emerald-700 tabular-nums text-right truncate whitespace-nowrap">
                          {formatCurrency(entry.runningProfit)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Standardized Modal Footer with Distinct Action Buttons */}
            <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => openTxModal(inspectingPartner.id, 'capital_deposit')}
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs active:scale-95"
                >
                  <ArrowDownToLine size={13} />
                  <span>+ إيداع رأس مال</span>
                </button>
                <button
                  type="button"
                  onClick={() => openTxModal(inspectingPartner.id, 'profit_withdrawal')}
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs active:scale-95"
                >
                  <DollarSign size={13} />
                  <span>- سحب أرباح</span>
                </button>
                <button
                  type="button"
                  onClick={() => openTxModal(inspectingPartner.id, 'capital_withdrawal')}
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-bold transition-all active:scale-95"
                >
                  <ArrowUpFromLine size={13} />
                  <span>- سحب رأس مال</span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => setInspectingPartnerId(null)}
                className="px-5 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl text-xs font-bold transition-all active:scale-95 shadow-2xs"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Shareholder Create/Edit Modal */}
      {showShareholderModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden border border-slate-200">
            <div className="p-5 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <h3 className="text-base font-black text-slate-900">
                {editingShareholder ? 'تعديل بيانات الشريك / المساهم' : 'إضافة شريك أو مساهم جديد'}
              </h3>
              <button
                type="button"
                onClick={() => setShowShareholderModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleShareholderSubmit} className="p-5 space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">الاسم</label>
                  <input
                    type="text"
                    required
                    value={shareholderForm.name}
                    onChange={(e) => setShareholderForm({ ...shareholderForm, name: e.target.value })}
                    className="input-ui h-9 w-full text-xs px-3"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">رقم الهاتف</label>
                  <input
                    type="tel"
                    required
                    value={shareholderForm.phone}
                    onChange={(e) =>
                      setShareholderForm({ ...shareholderForm, phone: e.target.value.replace(/\D/g, '') })
                    }
                    className="input-ui h-9 w-full text-xs px-3"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">تاريخ الانضمام</label>
                  <input
                    type="date"
                    required
                    value={shareholderForm.joinedDate}
                    onChange={(e) => setShareholderForm({ ...shareholderForm, joinedDate: e.target.value })}
                    className="input-ui h-9 w-full text-xs px-3 font-bold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    {editingShareholder ? 'رأس المال الحالي' : 'رأس المال الافتتاحي'}
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    disabled={Boolean(editingShareholder)}
                    value={shareholderForm.capital === 0 ? '' : shareholderForm.capital}
                    onChange={(e) => setShareholderForm({ ...shareholderForm, capital: Number(e.target.value) })}
                    className="input-ui h-9 w-full text-xs px-3 font-bold disabled:bg-slate-100"
                  />
                </div>
              </div>

              {/* Founder Flag Toggle */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-slate-800 block">شريك رئيسي مؤسس (Partner)</span>
                  <span className="text-[11px] text-slate-500 block">
                    {shareholderForm.isFounder
                      ? 'شريك أساسي صاحب حصة ملكية في الشركة ويقتسم صافي أرباح المنشأة'
                      : 'مساهم بالتمويل يحصل على نسبة من عائد تشغيل رأس ماله فقط'}
                  </span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={shareholderForm.isFounder}
                    onChange={(e) => {
                      const isF = e.target.checked;
                      setShareholderForm({
                        ...shareholderForm,
                        isFounder: isF,
                        sharePercentage: isF ? 50 : 20,
                        managementFeePercentage: isF ? 0 : 80,
                      });
                    }}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              {/* Conditional Percentage Section */}
              {shareholderForm.isFounder ? (
                <div className="space-y-2">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      نسبة ملكية الشريك من المنشأة % (مجموع حصص الشركاء الأساسيين = 100%)
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        max="100"
                        required
                        value={shareholderForm.sharePercentage === 0 ? '' : shareholderForm.sharePercentage}
                        onChange={(e) => {
                          const val = Math.min(100, Math.max(0, Number(e.target.value)));
                          setShareholderForm({
                            ...shareholderForm,
                            sharePercentage: val,
                            managementFeePercentage: 0,
                          });
                        }}
                        className="input-ui h-9 w-full text-xs px-3 font-black text-blue-700 bg-blue-50/40"
                        placeholder="مثال: 50"
                      />
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">%</span>
                    </div>
                  </div>
                  <div className="p-2.5 bg-blue-50/80 border border-blue-200/80 rounded-xl flex items-center gap-2 text-xs text-blue-900">
                    <ShieldCheck size={16} className="text-blue-600 shrink-0" />
                    <span className="text-[11px] leading-relaxed">
                      الشركاء الأساسيون يقتسمون 100% من صافي أرباح المنشأة حسب نسبة ملكية كل شريك دون اقتطاع إدارة.
                    </span>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">نسبة ربح المساهم %</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        max="100"
                        required
                        value={shareholderForm.sharePercentage === 0 ? '' : shareholderForm.sharePercentage}
                        onChange={(e) => {
                          const val = Math.min(100, Math.max(0, Number(e.target.value)));
                          setShareholderForm({
                            ...shareholderForm,
                            sharePercentage: val,
                            managementFeePercentage: Number((100 - val).toFixed(2)),
                          });
                        }}
                        className="input-ui h-9 w-full text-xs px-3 font-black text-purple-700 bg-purple-50/40"
                        placeholder="مثال: 20"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">نسبة إدارة المنشأة %</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        value={
                          shareholderForm.managementFeePercentage === 0 ? '' : shareholderForm.managementFeePercentage
                        }
                        onChange={(e) => {
                          const val = Math.min(100, Math.max(0, Number(e.target.value)));
                          setShareholderForm({
                            ...shareholderForm,
                            managementFeePercentage: val,
                            sharePercentage: Number((100 - val).toFixed(2)),
                          });
                        }}
                        className="input-ui h-9 w-full text-xs px-3 font-bold bg-slate-100"
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-purple-700 bg-purple-50 p-2 rounded-lg border border-purple-200">
                    يحصل المساهم على هذه النسبة من عائد تشغيل رأس ماله فقط، والباقي يعود للمنشأة كنسبة إدارة ولا يمس ملكية الشركاء الأساسيين.
                  </p>
                </div>
              )}

              {/* Treasury Cash Inflow Checkbox (for daily operations) */}
              {!editingShareholder && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-start gap-3">
                  <input
                    type="checkbox"
                    id="affectsTreasuryNewPartner"
                    checked={shareholderForm.affectsTreasury}
                    onChange={(e) => setShareholderForm({ ...shareholderForm, affectsTreasury: e.target.checked })}
                    className="mt-1 w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500 cursor-pointer"
                  />
                  <label htmlFor="affectsTreasuryNewPartner" className="text-xs text-slate-700 cursor-pointer select-none">
                    <span className="font-bold block text-emerald-950">إيداع رأس المال نقداً بالخزينة (حركة نقدية فعلية)</span>
                    <span className="text-[11px] text-emerald-700 block mt-0.5">
                      {shareholderForm.affectsTreasury
                        ? 'سيتم تسجيل توريد نقدي فوري بالخزينة وإصدار سند قبض برأس المال.'
                        : 'قيد دفتري فقط (لن تتأثر الخزينة النقدية الفعلية).'}
                    </span>
                  </label>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">ملاحظات (اختياري)</label>
                <textarea
                  value={shareholderForm.notes}
                  onChange={(e) => setShareholderForm({ ...shareholderForm, notes: e.target.value })}
                  className="input-ui w-full text-xs p-2.5"
                  rows={2}
                />
              </div>

              <div className="flex gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowShareholderModal(false)}
                  className="flex-1 px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 text-xs font-bold"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-xs font-bold"
                >
                  {editingShareholder ? 'حفظ التعديلات' : 'إضافة الشريك'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Financial Transaction Modal */}
      {showTransactionModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden border border-slate-200">
            <div className="p-5 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <div>
                <h3 className="text-base font-black text-slate-900">
                  {transactionType === 'capital_deposit'
                    ? 'إيداع وزيادة رأس المال'
                    : transactionType === 'capital_withdrawal'
                      ? 'سحب وتخفيض من رأس المال'
                      : 'سحب من الأرباح المتاحة'}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  الشريك:{' '}
                  <strong className="text-indigo-700">
                    {liveShareholders.find((s: any) => s.id === selectedShareholderId)?.name}
                  </strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowTransactionModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleTransactionSubmit} className="p-5 space-y-4">
              {(() => {
                const partner = liveShareholders.find((s: any) => s.id === selectedShareholderId);
                if (!partner) return null;
                return (
                  <div className="grid grid-cols-2 gap-2 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                    <div>
                      <span className="text-slate-500 block">رأس المال الفعلي:</span>
                      <strong className="text-slate-900 font-black">{formatCurrency(partner.capital)}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block">الأرباح المتاحة للسحب:</span>
                      <strong className="text-emerald-600 font-black">
                        {formatCurrency(partner.availableProfit)}
                      </strong>
                    </div>
                  </div>
                );
              })()}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">المبلغ</label>
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    required
                    value={transactionForm.amount === 0 ? '' : transactionForm.amount}
                    onChange={(e) => setTransactionForm({ ...transactionForm, amount: Number(e.target.value) })}
                    className="input-ui h-10 w-full px-3 text-sm font-black text-indigo-700"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">تاريخ الحركة</label>
                  <input
                    type="date"
                    required
                    value={transactionForm.date}
                    onChange={(e) => setTransactionForm({ ...transactionForm, date: e.target.value })}
                    className="input-ui h-10 w-full px-3 text-xs font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">البيان / التفاصيل</label>
                <input
                  type="text"
                  required
                  value={transactionForm.description}
                  onChange={(e) => setTransactionForm({ ...transactionForm, description: e.target.value })}
                  className="input-ui h-9 w-full px-3 text-xs"
                  placeholder="مثال: سحب أرباح نقدي، زيادة حصة رأس المال..."
                />
              </div>

              {/* Treasury Integration Toggle */}
              <label className="flex items-center gap-2.5 p-3 rounded-xl border border-slate-200 bg-slate-50 cursor-pointer hover:bg-slate-100/80 transition-colors">
                <input
                  type="checkbox"
                  checked={transactionForm.affectsTreasury !== false}
                  onChange={(e) => setTransactionForm({ ...transactionForm, affectsTreasury: e.target.checked })}
                  className="w-4 h-4 text-blue-600 rounded border-slate-300 accent-blue-600"
                />
                <div className="text-right">
                  <span className="block text-xs font-bold text-slate-800">
                    {transactionType === 'capital_deposit'
                      ? 'إيداع نقدي بالخزينة (توليد سند قبض كاش بالدرج)'
                      : 'صرف نقدي من الخزينة (توليد سند صرف كاش بالدرج)'}
                  </span>
                  <span className="block text-[10px] text-slate-500">
                    {transactionType === 'capital_deposit'
                      ? 'مفعل: الفلوس أودعت كاش في درج الخزينة | غير مفعل: تسوية دفتيرية بدون كاش'
                      : 'مفعل: تم تسليم المبلغ للشريك كاش من الدرج | غير مفعل: تسوية دفتيرية'}
                  </span>
                </div>
              </label>

              <div
                className={`p-3 rounded-xl text-[11px] flex items-start gap-2.5 border ${
                  transactionType === 'profit_withdrawal'
                    ? 'bg-emerald-50/90 border-emerald-200 text-emerald-950'
                    : transactionType === 'capital_withdrawal'
                      ? 'bg-rose-50/90 border-rose-200 text-rose-950'
                      : 'bg-indigo-50/90 border-indigo-200 text-indigo-950'
                }`}
              >
                {transactionType === 'profit_withdrawal' ? (
                  <DollarSign size={16} className="mt-0.5 shrink-0 text-emerald-600" />
                ) : transactionType === 'capital_withdrawal' ? (
                  <ArrowUpFromLine size={16} className="mt-0.5 shrink-0 text-rose-600" />
                ) : (
                  <ArrowDownToLine size={16} className="mt-0.5 shrink-0 text-indigo-600" />
                )}
                <div className="leading-relaxed">
                  {transactionType === 'profit_withdrawal' && (
                    <p>
                      <strong className="font-extrabold text-emerald-800">سحب أرباح (حماية رأس المال):</strong> سيتم خصم هذا المبلغ حصرياً من رصيد الأرباح المتاحة للشريك دون أي مساس برأس المال التأسيسي، وتوليد سند صرف في الخزينة اليومية.
                    </p>
                  )}
                  {transactionType === 'capital_withdrawal' && (
                    <p>
                      <strong className="font-extrabold text-rose-800">سحب من رأس المال:</strong> تنبيه! سيتم خصم هذا المبلغ مباشرة من رأس المال العامل للشريك، مما يقلل وزنه النسبي في الشركة، وتوليد سند صرف في الخزينة اليومية.
                    </p>
                  )}
                  {transactionType === 'capital_deposit' && (
                    <p>
                      <strong className="font-extrabold text-indigo-800">إيداع رأس مال:</strong> سيتم إضافة هذا المبلغ إلى رأس المال العامل للشريك وزيادة وزنه النسبي، وتوليد سند قبض في الخزينة اليومية.
                    </p>
                  )}
                </div>
              </div>

              <div className="flex gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowTransactionModal(false)}
                  className="flex-1 px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 text-xs font-bold"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-xs font-bold"
                >
                  تأكيد وتنفيذ الحركة
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
