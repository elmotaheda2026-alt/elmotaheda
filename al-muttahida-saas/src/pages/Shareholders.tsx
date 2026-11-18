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
  ChevronDown,
  ChevronUp,
  Printer,
  Scale,
  CheckCircle2,
  AlertTriangle,
  BarChart3,
} from 'lucide-react';
import { Shareholder, ShareholderTransaction, Sale, Expense, Product } from '../types';
import { useRealtimeSync } from '../lib/realtimeSync';
import { printHtmlDocument } from '../lib/printHelper';
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
import { calculateCostOfGoodsSold } from '../lib/accounting';

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
  profitBasis?: 'realized' | 'accrual';
  liveNetProfit: number;
  totalSalesRevenue: number;
  totalCogs: number;
  totalExpenses: number;
  totalCapital: number;
  systemLiveRoi: number;
  totalAvailableProfits: number;
  totalWithdrawnProfits?: number;
  totalNetEntitlement?: number;
  totalSupplierDebt?: number;
  totalGrossEquity?: number;
  netFreeCapital?: number;
  accountantReport?: any;
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

  const [activeTab, setActiveTab] = useState<'overview' | 'ledger' | 'report'>('overview');
  const [showChartBanner, setShowChartBanner] = useState<boolean>(false);
  const [showTranchesDetails, setShowTranchesDetails] = useState<boolean>(false);
  const profitBasis = 'realized' as const;
  const [reportPeriodFrom, setReportPeriodFrom] = useState<string>('');
  const [reportPeriodTo, setReportPeriodTo] = useState<string>('');
  const [isSettlingPeriod, setIsSettlingPeriod] = useState<boolean>(false);
  const isUserAdmin = user?.role === 'admin';

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

  const formatCurrency = (amount: number) => {
    const num = Number(amount || 0);
    const cur = settings.currency || 'جنيه';
    if (Math.abs(num) < 0.005 || Object.is(num, -0)) return `0 ${cur}`;
    const rounded = Number(num.toFixed(2));
    return `${new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(rounded)} ${cur}`;
  };
  const formatWithdrawal = (amount?: number | null) => {
    const val = Number(Number(amount || 0).toFixed(2));
    if (val <= 0) return formatCurrency(0);
    return `-${formatCurrency(val)}`;
  };

  const loadData = async () => {
    setIsLoading(true);
    try {
      if (isApiMode()) {
        const liveData = await api.getShareholdersLiveTrading({
          periodFrom: reportPeriodFrom || undefined,
          periodTo: reportPeriodTo || undefined,
          profitBasis,
        });
        if (liveData) {
          setLiveMetrics({
            profitBasis: liveData.profitBasis || profitBasis,
            liveNetProfit: Number(liveData.liveNetProfit || 0),
            totalSalesRevenue: Number(liveData.totalSalesRevenue || 0),
            totalCogs: Number(liveData.totalCogs || 0),
            totalExpenses: Number(liveData.totalExpenses || 0),
            totalCapital: Number(liveData.totalCapital || 0),
            systemLiveRoi: Number(liveData.systemLiveRoi || 0),
            totalAvailableProfits: Number(liveData.totalAvailableProfits || 0),
            totalWithdrawnProfits: Number(liveData.totalWithdrawnProfits || 0),
            totalNetEntitlement: Number(liveData.totalNetEntitlement || 0),
            totalSupplierDebt: Number(liveData.totalSupplierDebt || 0),
            totalGrossEquity: Number(liveData.totalGrossEquity || 0),
            netFreeCapital: Number(liveData.netFreeCapital || 0),
            accountantReport: liveData.accountantReport || null,
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
  }, [profitBasis, reportPeriodFrom, reportPeriodTo]);

  useRealtimeSync(['shareholders', 'sales', 'payments', 'expenses', 'suppliers', 'products'], () => {
    void loadData();
  });

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
  }, [profitBasis, reportPeriodFrom, reportPeriodTo]);

  // Compute time-weighted metrics locally or merge with backend metrics
  const computedState = useMemo(() => {
    if (isApiMode() && liveMetrics) {
      const totalCapital = liveMetrics.totalCapital;
      const totalAvailableProfits = liveMetrics.totalAvailableProfits;
      const totalSupplierDebt = Number(liveMetrics.totalSupplierDebt || 0);
      const totalGrossEquity = Number(liveMetrics.totalGrossEquity || (totalCapital + totalAvailableProfits));
      const netFreeCapital = Number(liveMetrics.netFreeCapital || Math.max(0, totalGrossEquity - totalSupplierDebt));
      return {
        totalCapital,
        totalAvailableProfits,
        totalSupplierDebt,
        totalGrossEquity,
        netFreeCapital,
        liveShareholders: shareholders,
        filteredTransactions: transactions,
      };
    }

    // Local Storage fallback time-weighted Model 1 engine
    const activeSalesGlobal = sales.filter((s) => s.status !== 'cancelled');
    const activeExpensesGlobal = expenses;

    const getOfflineSaleEffectiveTotal = (sale: Sale) =>
      sale.status === 'settled_early' ? Math.max(0, Number(sale.paid || 0)) : Number(sale.total || 0);

    const getOfflineSaleEarnedGross = (sale: Sale) => {
      const effTotal = getOfflineSaleEffectiveTotal(sale);
      const cost = calculateCostOfGoodsSold([sale], products);
      const contractProfit = effTotal - cost;
      const ratio = effTotal > 0 ? Math.min(1, Math.max(0, Number(sale.paid || 0) / effTotal)) : 0;
      return Number((contractProfit * ratio).toFixed(2));
    };

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
        ? activeSalesGlobal.filter((sale) => toIsoDay(sale.date) >= effectiveStart)
        : [];
      const partnerWindowExpenses = windowValid
        ? activeExpensesGlobal.filter((exp) => toIsoDay(exp.date) >= effectiveStart)
        : [];

      const windowSalesRevenue = partnerWindowSales.reduce((sum, sale) => sum + getOfflineSaleEffectiveTotal(sale), 0);
      const windowCogs = calculateCostOfGoodsSold(partnerWindowSales, products);
      const windowExpenses = partnerWindowExpenses.reduce((sum, exp) => sum + Number(exp.amount || 0), 0);
      const windowGrossProfit = partnerWindowSales.reduce((sum, sale) => sum + getOfflineSaleEarnedGross(sale), 0);
      const windowCompanyNetProfit = Number((windowGrossProfit - windowExpenses).toFixed(2));

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
    const totalSupplierDebt = Number(liveMetrics?.totalSupplierDebt || 0);
    const totalGrossEquity = Number(liveMetrics?.totalGrossEquity || (totalCapital + totalAvailableProfits));
    const netFreeCapital = Number(liveMetrics?.netFreeCapital || Math.max(0, totalGrossEquity - totalSupplierDebt));

    return {
      totalCapital,
      totalAvailableProfits,
      totalSupplierDebt,
      totalGrossEquity,
      netFreeCapital,
      liveShareholders,
      filteredTransactions,
    };
  }, [isLoading, liveMetrics, shareholders, transactions, sales, expenses, products, profitBasis]);

  const {
    totalCapital,
    totalAvailableProfits,
    totalSupplierDebt,
    totalGrossEquity,
    netFreeCapital,
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

  const [isCapitalizing, setIsCapitalizing] = useState(false);

  const handleCapitalizeProfits = async (shareholderId?: string) => {
    const isSingle = typeof shareholderId === 'string';
    const targetName = isSingle
      ? liveShareholders.find((s: any) => s.id === shareholderId)?.name || 'الشريك'
      : 'كافة الشركاء الأساسيين';

    const isConfirmed = await confirmDialog({
      title: 'رسملة وتدوير الأرباح في رأس المال',
      message: `هل أنت متأكد من رسملة وإضافة الأرباح المتاحة لـ (${targetName}) إلى رأس المال الفعلي؟\n\n` +
        `• سيتم تحويل الأرباح القابلة للصرف إلى رأس مال فعلي دائم للشركة.\n` +
        `• ستزيد حصة الشريك الرأسمالية وقوة التمويل التشغيلي دون سحب سيولة نقدية من الخزينة.`,
      confirmText: 'نعم، رسملة الأرباح الآن',
      cancelText: 'إلغاء',
      type: 'info',
    });
    if (!isConfirmed) return;

    setIsCapitalizing(true);
    try {
      if (isApiMode()) {
        const res = await api.capitalizeProfits(shareholderId);
        showToast(res.message || 'تمت رسملة الأرباح وإضافتها لرأس المال بنجاح', 'success');
      } else {
        showToast('خاصية الرسملة تتطلب الاتصال بالنظام السحابي/الرئيسي', 'error');
      }
      await loadData();
    } catch (err: any) {
      showToast(err.message || 'فشل تنفيذ عملية رسملة الأرباح', 'error');
    } finally {
      setIsCapitalizing(false);
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

  const handleSettlePeriod = async () => {
    const targetTo = reportPeriodTo || new Date().toISOString().slice(0, 10);
    const isConfirmed = await confirmDialog({
      title: 'اعتماد وإقفال تسوية أرباح الفترة',
      message:
        `سيتم تثبيت واعتماد كافة الأرباح المستحقة غير الموزعة حتى تاريخ (${targetTo}) وفق أساس (${profitBasis === 'realized' ? 'الربح المحقق نقداً' : 'الربح التعاقدي'}) كقيود رسمية في سجل الشركاء وسجل الإقفالات.\n\nهل تريد المتابعة؟`,
      confirmText: 'نعم، اعتماد وتثبيت التسوية',
      cancelText: 'إلغاء',
      type: 'info',
    });
    if (!isConfirmed) return;

    setIsSettlingPeriod(true);
    try {
      if (!isApiMode()) {
        showToast('تثبيت تسوية الأرباح يتطلب الاتصال بالسيرفر الرئيسي', 'error');
        return;
      }
      const res = await api.settleShareholdersPeriod({
        periodFrom: reportPeriodFrom || null,
        periodTo: targetTo,
        profitBasis,
      });
      await loadData();
      showToast(res.message || 'تم اعتماد وتثبيت أرباح الشركاء بنجاح', 'success');
    } catch (err: any) {
      showToast(err.message || 'تعذر تنفيذ تسوية الأرباح', 'error');
    } finally {
      setIsSettlingPeriod(false);
    }
  };

  const handleDeleteSettlement = async (cp: any) => {
    const isConfirmed = await confirmDialog({
      title: 'فك وإلغاء تسوية معتمدة',
      message: `هل أنت متأكد من إلغاء تسوية الفترة حتى (${formatDateDisplay(cp.periodDate)}) وعكس قيود توزيع الأرباح المرتبطة بها؟`,
      confirmText: 'نعم، إلغاء التسوية',
      cancelText: 'تراجع',
      type: 'danger',
    });
    if (!isConfirmed) return;

    try {
      const res = await api.deleteShareholderSettlement(cp.id);
      await loadData();
      showToast(res.message || 'تم إلغاء التسوية وعكس قيودها بنجاح', 'success');
    } catch (err: any) {
      showToast(err.message || 'تعذر إلغاء التسوية', 'error');
    }
  };

  const handlePrintAccountantReport = () => {
    const rpt = liveMetrics?.accountantReport;
    if (!rpt) {
      showToast('بيانات التقرير المحاسبي غير متوفرة حالياً للطباعة', 'error');
      return;
    }

    const periodLabel = reportPeriodFrom || reportPeriodTo
      ? `من ${reportPeriodFrom || 'بداية النشاط'} إلى ${reportPeriodTo || 'اليوم'}`
      : 'الإجمالي التراكمي حتى تاريخه';

    const tranchesRowsHtml = (rpt.tranches || []).length === 0
      ? `<tr><td colspan="7" style="text-align:center;padding:10px;color:#64748b;">لا توجد شرائح زمنية برأس مال نشط في هذه الفترة</td></tr>`
      : (rpt.tranches || [])
          .map(
            (tr: any, idx: number) => `
          <tr>
            <td>${idx + 1}</td>
            <td>${formatDateDisplay(tr.fromDate)} ← ${formatDateDisplay(tr.toDate)}</td>
            <td>${tr.days} يوم</td>
            <td>${formatCurrency(tr.totalActiveCapital)}</td>
            <td>${formatCurrency(tr.netProfit)}</td>
            <td style="font-family:monospace;font-weight:700;direction:ltr;">${Number(tr.roiPerEgp || 0).toFixed(4)} (${(Number(tr.roiPerEgp || 0) * 100).toFixed(2)}%)</td>
            <td>${formatCurrency(tr.investorsShare)} / ${formatCurrency(tr.foundersShare)}</td>
          </tr>`
          )
          .join('');

    const partnerRowsHtml = liveShareholders
      .map(
        (s: any) => `
        <tr>
          <td><strong>${s.name}</strong><br/><span style="font-size:10px;color:#475569;">${s.isFounder ? 'شريك مؤسس' : 'مساهم بالتمويل'}</span></td>
          <td>${formatDateDisplay(s.joinedDate)}</td>
          <td>${formatCurrency(s.capital)}</td>
          <td>${formatCurrency(s.weightedAvgCapital ?? s.capital)}</td>
          <td>${formatCurrency(s.grossProfit)}</td>
          <td>%${s.sharePercentage}</td>
          <td style="color:#047857;font-weight:700;">${formatCurrency(s.netEntitlement)}</td>
          <td>${s.isFounder ? '—' : `${formatCurrency(s.mgmtFee)} (%${s.managementFeePercentage})`}</td>
          <td>${formatCurrency(s.totalWithdrawnProfits)}</td>
          <td style="color:#1e40af;font-weight:700;">${formatCurrency(s.availableProfit)}</td>
        </tr>`
      )
      .join('');

    const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8" />
  <title>التقرير المحاسبي لتوزيع أرباح الشركاء والمساهمين - ${settings.companyName || 'شركة المتحدة'}</title>
  <style>
    @page { size: A4 landscape; margin: 0; }
    * { box-sizing: border-box; font-family: 'Segoe UI', Tahoma, Arial, sans-serif; }
    body { margin: 0; padding: 12mm; color: #0f172a; font-size: 11px; line-height: 1.45; }
    .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0f1f4a; padding-bottom: 10px; margin-bottom: 14px; }
    .title h1 { margin: 0; font-size: 18px; color: #0f1f4a; }
    .title p { margin: 2px 0 0; font-size: 11px; color: #475569; }
    .meta { text-align: left; font-size: 11px; color: #334155; }
    .section-title { background: #f1f5f9; border-right: 4px solid #1e40af; padding: 6px 10px; font-weight: 800; font-size: 12px; color: #0f1f4a; margin: 12px 0 8px; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
    th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: right; }
    th { background: #f8fafc; color: #1e293b; font-weight: 700; font-size: 10.5px; }
    .num { font-family: monospace; font-weight: 700; text-align: left; direction: ltr; }
    .total-row { background: #eff6ff; font-weight: 800; }
    .badge-ok { background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; padding: 2px 8px; border-radius: 4px; font-weight: 700; }
    .sigs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 24px; text-align: center; font-size: 11px; color: #475569; }
    .sig-line { border-top: 1px dashed #94a3b8; margin-top: 32px; padding-top: 4px; }
    @media print { .no-print { display: none; } }
  </style>
</head>
<body>
  <div class="header">
    <div class="title">
      <h1>${settings.companyName || 'شركة المتحدة'} — التقرير المحاسبي التفصيلي لتوزيع أرباح الشركاء والمساهمين</h1>
      <p>الأساس المحاسبي: <strong>${rpt.profitBasis === 'realized' ? 'الربح المحقق المحصّل نقداً (البيع بالتقسيط)' : 'الربح التعاقدي الإجمالي (الاستحقاق)'}</strong> | الفترة: <strong>${periodLabel}</strong></p>
    </div>
    <div class="meta">
      <div>تاريخ الطباعة: ${new Date().toLocaleString('ar-EG')}</div>
      <div>أعده: ${user?.name || 'المدير العام'}</div>
    </div>
  </div>

  <div class="grid-2">
    <div>
      <div class="section-title">أولاً: بيان الدخل وجسر تحقق الأرباح</div>
      <table>
        <tr><td>إجمالي قيمة عقود المبيعات</td><td class="num">${formatCurrency(rpt.totalContractGrossRevenue)}</td></tr>
        <tr><td>(-) خصومات السداد المبكر</td><td class="num">-${formatCurrency(rpt.totalEarlySettlementDiscounts)}</td></tr>
        <tr><td>(=) صافي المبيعات التعاقدية الفعلية</td><td class="num">${formatCurrency(rpt.totalEffectiveRevenue)}</td></tr>
        <tr><td>(-) تكلفة البضاعة وأصل التمويل (بنود: ${rpt.costedByItemsCount} | أصل عقود: ${rpt.costedBySubtotalFallbackCount})</td><td class="num">-${formatCurrency(rpt.totalCogs)}</td></tr>
        <tr class="total-row"><td>(=) مجمل الربح التعاقدي الإجمالي</td><td class="num">${formatCurrency(rpt.accrualGrossProfit)}</td></tr>
        <tr><td>(-) أرباح مؤجلة بأقساط فواتير الفترة غير المحصلة (متبقي: ${formatCurrency(rpt.totalDeferredReceivables)})</td><td class="num">-${formatCurrency(rpt.deferredProfits)}</td></tr>
        ${
          rpt.isFilteredPeriod && Number(rpt.realizedFromPriorSales || 0) !== 0
            ? `<tr><td>(+) أرباح محققة خلال الفترة من تحصيل أقساط فواتير سابقة</td><td class="num">+${formatCurrency(rpt.realizedFromPriorSales)}</td></tr>`
            : ''
        }
        <tr><td>(=) مجمل الربح المحقق نقداً (من تحصيل فعلي ${formatCurrency(rpt.periodCashCollections ?? rpt.totalCollectedOnSales)})</td><td class="num">${formatCurrency(rpt.realizedGrossProfit)}</td></tr>
        <tr><td>(-) إجمالي المصروفات التشغيلية</td><td class="num">-${formatCurrency(rpt.totalExpenses)}</td></tr>
        <tr class="total-row"><td>(=) صافي الربح القابل للتوزيع (${rpt.profitBasis === 'realized' ? 'محقق نقداً' : 'تعاقدي'})</td><td class="num">${formatCurrency(rpt.selectedNetProfit)}</td></tr>
      </table>
    </div>
    <div>
      <div class="section-title">ثانياً: مطابقة التوزيع المحاسبية (Zero-Variance Audit)</div>
      <table>
        <tr><td>صافي حصة المساهمين بالتمويل</td><td class="num">${formatCurrency(rpt.totalInvestorsNet)}</td></tr>
        <tr><td>حصة الإدارة / الشركة من عوائد المساهمين</td><td class="num">${formatCurrency(rpt.totalMgmtFees)}</td></tr>
        <tr><td>صافي حصة الشركاء المؤسسين (شاملة رسوم الإدارة)</td><td class="num">${formatCurrency(rpt.totalFoundersNet)}</td></tr>
        <tr><td>أرباح تحققت قبل تاريخ انضمام الشركاء المسجل</td><td class="num">${formatCurrency(rpt.preCapitalProfit)}</td></tr>
        <tr><td>احتياطي غير مخصص لعدم وجود مؤسس بالشريحة</td><td class="num">${formatCurrency(rpt.companyUnclaimedRetainedPool)}</td></tr>
        <tr class="total-row"><td>إجمالي الأرباح الموزعة والمطابقة</td><td class="num">${formatCurrency(rpt.allocatedSum)}</td></tr>
        <tr><td>فارق المطابقة المحاسبية (Variance)</td><td class="num"><span class="badge-ok">${formatCurrency(rpt.reconciliationVariance)} ${rpt.isReconciled ? '— متطابق 100%' : ''}</span></td></tr>
      </table>
    </div>
  </div>

  <div class="section-title">ثالثاً: تفصيل الشرائح الزمنية وعائد الجنيه الواحد (Time-Weighted ROI)</div>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>الفترة الزمنية للشريحة</th>
        <th>المدة</th>
        <th>رأس المال العامل</th>
        <th>صافي ربح الشريحة</th>
        <th>ربح الجنيه الواحد (ROI)</th>
        <th>حصة المساهمين / المؤسسين</th>
      </tr>
    </thead>
    <tbody>${tranchesRowsHtml}</tbody>
  </table>

  <div class="section-title">رابعاً: كشف حساب وتوزيع أرباح الشركاء والمساهمين</div>
  <table>
    <thead>
      <tr>
        <th>الاسم والصفة</th>
        <th>تاريخ الانضمام</th>
        <th>رأس المال الحالي</th>
        <th>متوسط رأس المال المرجح</th>
        <th>إجمالي عائد أمواله</th>
        <th>نسبة الشريك</th>
        <th>صافي نصيب الفترة</th>
        <th>حصة الشركة (إدارة)</th>
        <th>المسحوبات السابقة</th>
        <th>المتاح للسحب/الرسملة</th>
      </tr>
    </thead>
    <tbody>${partnerRowsHtml}</tbody>
  </table>

  <div class="sigs">
    <div><div class="sig-line">المحاسب المالي</div></div>
    <div><div class="sig-line">المدير المالي</div></div>
    <div><div class="sig-line">اعتماد المدير العام / الشركاء</div></div>
  </div>

</body>
</html>`;

    void printHtmlDocument(html, {
      title: `التقرير المحاسبي - ${settings.companyName || 'شركة المتحدة'}`,
      width: 1050,
      height: 850,
      paperSize: 'a4-landscape',
    }).then((opened) => {
      if (!opened) {
        showToast('يرجى السماح بالنوافذ المنبثقة لطباعة التقرير', 'error');
      }
    });
  };

  return (
    <div className="flex flex-col h-full flex-1 min-h-0 space-y-2.5">
      {/* TIER 1: Single-Row Compact Action Header */}
      <section className="bg-white rounded-2xl px-4 py-2.5 border border-slate-200/90 shadow-2xs flex flex-wrap items-center justify-between gap-2.5 shrink-0">
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-8 h-8 rounded-xl bg-slate-100 border border-slate-200/80 flex items-center justify-center text-[#0f1f4a] shrink-0">
            <Landmark size={16} />
          </div>
          <div>
            <h2 className="text-base font-black text-slate-900 leading-tight whitespace-nowrap">
              حسابات الشركاء والمساهمين
            </h2>
          </div>
        </div>

        {/* Action Controls & View Switcher */}
        <div className="flex flex-wrap items-center gap-1.5 flex-1 justify-end min-w-0">
          {/* Search Input */}
          <div className="relative flex-1 min-w-[130px] max-w-[180px]">
            <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="بحث باسم الشريك..."
              className="input-ui h-8 w-full pr-9 pl-2.5 text-xs bg-slate-50/70 border-slate-200 focus:bg-white"
            />
          </div>

          {/* Main Tabs Switcher */}
          <div className="inline-flex h-8 items-center rounded-xl border border-slate-200/90 bg-slate-100/90 p-0.5 text-xs font-bold shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('overview')}
              className={`h-full flex items-center gap-1 px-2.5 rounded-lg transition-all whitespace-nowrap cursor-pointer ${
                activeTab === 'overview'
                  ? 'bg-white text-slate-900 shadow-2xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <PieChartIcon size={12} className={activeTab === 'overview' ? 'text-[#1e40af]' : ''} />
              <span>الحصص ({liveShareholders.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('ledger')}
              className={`h-full flex items-center gap-1 px-2.5 rounded-lg transition-all whitespace-nowrap cursor-pointer ${
                activeTab === 'ledger'
                  ? 'bg-white text-slate-900 shadow-2xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileText size={12} className={activeTab === 'ledger' ? 'text-[#1e40af]' : ''} />
              <span>المعاملات ({displayedTransactions.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('report')}
              className={`h-full flex items-center gap-1 px-2.5 rounded-lg transition-all whitespace-nowrap cursor-pointer ${
                activeTab === 'report'
                  ? 'bg-white text-slate-900 shadow-2xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Scale size={12} className={activeTab === 'report' ? 'text-[#1e40af]' : ''} />
              <span>تقرير المحاسب</span>
            </button>
          </div>

          {/* Chart Toggle Button */}
          {activeTab === 'overview' && liveShareholders.length > 0 && (
            <button
              type="button"
              onClick={() => setShowChartBanner(!showChartBanner)}
              className={`h-8 flex items-center gap-1 px-2.5 rounded-xl text-xs font-bold transition-all border whitespace-nowrap shrink-0 cursor-pointer ${
                showChartBanner
                  ? 'bg-blue-50 border-blue-200 text-[#1e40af]'
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
            className="h-8 flex items-center gap-1 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 px-2.5 rounded-xl text-xs font-bold transition-all active:scale-95 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
            title={`آخر تحديث: ${lastSynced.toLocaleTimeString('ar-EG')}`}
          >
            <RefreshCw size={12} className={isLoading ? 'animate-spin text-[#1e40af]' : ''} />
            <span className="hidden sm:inline">تحديث</span>
          </button>

          {isUserAdmin && (
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
              className="h-8 flex items-center gap-1 bg-[#1e40af] hover:bg-[#1d4ed8] text-white px-3 rounded-xl transition-all text-xs font-bold shadow-xs active:scale-95 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Plus size={14} />
              <span>إضافة شريك</span>
            </button>
          )}
        </div>
      </section>

      {/* TIER 2: Simple, Clear Financial Summary Strip */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 shrink-0">
        {/* KPI 1: Total Gross Equity */}
        <div className="bg-gradient-to-br from-[#eef2ff] via-[#f6f8ff] to-white rounded-xl px-4 py-3 border border-indigo-200/70 shadow-xs flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <span className="text-[11px] font-bold text-slate-600 block">إجمالي حقوق الشركاء</span>
            <span className="text-lg font-black text-[#0f1f4a] tabular-nums block leading-tight mt-0.5">
              {formatCurrency(totalGrossEquity)}
            </span>
            <div className="text-[10px] text-slate-500 mt-1 font-medium leading-snug flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <span className="whitespace-nowrap">رأس المال: {formatCurrency(totalCapital)}</span>
              <span className="text-slate-300">•</span>
              <span className="whitespace-nowrap">أرباح: {formatCurrency(totalAvailableProfits)}</span>
            </div>
          </div>
          <div className="w-9 h-9 bg-[#1e3a8a]/10 rounded-xl flex items-center justify-center text-[#1e3a8a] shrink-0">
            <Wallet size={16} />
          </div>
        </div>

        {/* KPI 2: Supplier Debt */}
        <div className="bg-gradient-to-br from-[#fff1f2] via-[#fff7f8] to-white rounded-xl px-4 py-3 border border-rose-200/70 shadow-xs flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <span className="text-[11px] font-bold text-slate-600 block">مستحقات الموردين</span>
            <span className="text-lg font-black text-rose-700 tabular-nums block leading-tight mt-0.5">
              -{formatCurrency(totalSupplierDebt)}
            </span>
            <span className="text-[10px] text-slate-500 block mt-0.5 font-medium leading-snug">
              ديون للموردين تُخصم من قيمة الشركة
            </span>
          </div>
          <div className="w-9 h-9 bg-rose-500/10 rounded-xl flex items-center justify-center text-rose-700 shrink-0">
            <FileText size={16} />
          </div>
        </div>

        {/* KPI 3: Net Free Capital */}
        <div className="bg-gradient-to-br from-[#ecfdf5] via-[#f4fbf8] to-white rounded-xl px-4 py-3 border border-emerald-200/80 shadow-xs flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <span className="text-[11px] font-bold text-emerald-900 block">صافي قيمة الشركة الفعلي</span>
            <span className="text-lg font-black text-emerald-700 tabular-nums block leading-tight mt-0.5">
              {formatCurrency(netFreeCapital)}
            </span>
            <span className="text-[10px] text-emerald-800/75 block mt-0.5 font-medium leading-snug">
              الحقوق الصافية بعد خصم الموردين
            </span>
          </div>
          <div className="w-9 h-9 bg-emerald-600/10 rounded-xl flex items-center justify-center text-emerald-700 shrink-0">
            <DollarSign size={16} />
          </div>
        </div>

        {/* KPI 4: Ownership & Active Partners */}
        <div className="bg-gradient-to-br from-[#f1f5f9] via-[#f8fafc] to-white rounded-xl px-4 py-3 border border-slate-200/90 shadow-xs flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <span className="text-[11px] font-bold text-slate-600 block">الشركاء والمساهمون</span>
            <span className="text-lg font-black text-slate-900 tabular-nums block leading-tight mt-0.5">
              {liveShareholders.length} <span className="text-xs font-semibold text-slate-500">نشط</span>
            </span>
            <div className="text-[10px] text-slate-500 mt-0.5 font-medium leading-snug flex flex-wrap items-center gap-x-1.5">
              <span>{foundersSummary.foundersCount} شريك (%{foundersSummary.rawFoundersShare})</span>
              <span className="text-slate-300">•</span>
              <span>{foundersSummary.partnersCount} مساهم</span>
            </div>
          </div>
          <div className="w-9 h-9 bg-slate-500/10 rounded-xl flex items-center justify-center text-slate-700 shrink-0">
            <Users size={16} />
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

          {/* Main Partners View: Simple, Role-Clarity Cards */}
          {visibleShareholders.length === 0 ? (
            <div className="py-16 text-center text-slate-400">
              <Users size={40} className="mx-auto mb-2 text-slate-300" />
              <p className="text-sm font-bold text-slate-600">لا يوجد مساهمون مطابقون للبحث</p>
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto p-4 bg-[#eef2f6] space-y-3">
              {/* Clear Owner Explanation if pre-join profits exist */}
              {liveMetrics?.accountantReport &&
                Math.abs(Number(liveMetrics.accountantReport.preCapitalProfit || 0)) > 0.01 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-2.5 flex items-start gap-2.5 text-xs text-amber-950 shadow-2xs">
                    <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                    <div className="leading-relaxed">
                      <strong className="font-black">توضيح بخصوص الأرباح السابقة:</strong> يوجد أرباح بقيمة{' '}
                      <strong className="font-mono">{formatCurrency(liveMetrics.accountantReport.preCapitalProfit)}</strong> تحققت قبل أقدم تاريخ انضمام مسجل للشركاء حالياً. لا تُحسب هذه الأرباح في الكروت إلا إذا عدّلت <strong>«تاريخ الانضمام»</strong> من زر التعديل (✏️) إلى التاريخ الفعلي لبداية الشراكة.
                    </div>
                  </div>
                )}

              {liveMetrics?.accountantReport &&
                Number(liveMetrics.accountantReport.totalOverDistributedDelta || 0) > 0.05 && (
                  <div className="bg-rose-50 border border-rose-200 rounded-xl px-3.5 py-2.5 flex items-start gap-2.5 text-xs text-rose-900 shadow-2xs">
                    <AlertTriangle size={16} className="text-rose-600 shrink-0 mt-0.5" />
                    <div className="leading-relaxed">
                      <strong className="font-black">تنبيه تسوية:</strong> يوجد أرباح مثبّتة من تسوية سابقة تزيد بمقدار{' '}
                      <strong className="font-mono">{formatCurrency(liveMetrics.accountantReport.totalOverDistributedDelta)}</strong> عن الأرباح الفعلية على الأساس المختار حالياً. يُرجى مراجعة تبويب «تقرير المحاسب والتسوية».
                    </div>
                  </div>
                )}

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {visibleShareholders.map((shareholder: any) => {
                  const isF = Boolean(shareholder.isFounder);
                  const mgmtPct = Number(
                    shareholder.managementFeePercentage ?? Math.max(0, 100 - Number(shareholder.sharePercentage || 0))
                  );
                  return (
                    <div
                      key={shareholder.id}
                      className="bg-[#f8fafd] rounded-2xl border border-slate-200/90 shadow-xs hover:shadow-md transition-all flex flex-col justify-between overflow-hidden"
                    >
                      <div>
                        {/* Clean Brand Header Strip */}
                        <div
                          className={`px-4 py-3 flex justify-between items-center gap-2 ${
                            isF
                              ? 'bg-gradient-to-l from-[#0f1f4a] to-[#1e3a8a] text-white'
                              : 'bg-gradient-to-l from-[#115e59] to-[#0f766e] text-white'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <h4 className="font-black text-white text-sm truncate">{shareholder.name}</h4>
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-white/15 text-white/95 border border-white/20">
                                {isF ? 'شريك مؤسس' : 'مساهم بالتمويل'}
                              </span>
                            </div>
                            <div className="text-[10px] text-white/75 font-medium mt-0.5">
                              يُحسب ربحه من: {formatDateDisplay(shareholder.joinedDate || shareholder.createdAt)}
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <div className="flex flex-col items-end ml-1">
                              <span className="px-2 py-0.5 rounded-lg font-black text-xs bg-white/20 text-white border border-white/25">
                                %{shareholder.sharePercentage}
                              </span>
                              <span className="text-[9px] text-white/75 font-bold mt-0.5 whitespace-nowrap">
                                {isF ? 'نسبة الملكية' : 'نسبته من ربح ماله'}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
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
                              className="p-1.5 text-white/70 hover:text-white hover:bg-white/15 rounded-lg transition-colors cursor-pointer"
                              title="تعديل بيانات الشريك / تاريخ الانضمام"
                            >
                              <Edit size={13} />
                            </button>
                            {isUserAdmin && (
                              <button
                                type="button"
                                onClick={() => handleDeleteShareholder(shareholder.id, shareholder.name)}
                                className="p-1.5 text-white/70 hover:text-rose-200 hover:bg-rose-500/25 rounded-lg transition-colors cursor-pointer"
                                title="حذف الشريك"
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Card Body */}
                        <div className="p-4 pb-2.5 space-y-2">
                          {/* 3 Clean Metric Pillars */}
                          <div className="grid grid-cols-3 divide-x divide-x-reverse divide-slate-200/80 bg-white rounded-xl border border-slate-200/80 shadow-2xs py-2.5 px-1 text-center">
                            <div className="px-1.5">
                              <span className="text-[10px] font-semibold text-slate-500 block leading-tight">
                                {isF ? 'رأس المال المدفوع' : 'مبلغ التمويل'}
                              </span>
                              <span className="text-xs font-black text-slate-900 block mt-1">{formatCurrency(shareholder.capital)}</span>
                            </div>
                            <div className="px-1.5">
                              <span className="text-[10px] font-semibold text-slate-500 block leading-tight">
                                {isF ? 'أرباح متاحة للسحب' : 'أرباح جاهزة للصرف'}
                              </span>
                              <span className="text-xs font-black text-emerald-700 block mt-1">+{formatCurrency(shareholder.availableProfit)}</span>
                            </div>
                            <div className="px-1.5">
                              <span className="text-[10px] font-semibold text-slate-500 block leading-tight">
                                {isF ? 'إجمالي رصيده' : 'إجمالي مستحقاته'}
                              </span>
                              <span className="text-xs font-black text-[#0f1f4a] block mt-1">
                                {formatCurrency(shareholder.totalNetValue)}
                              </span>
                            </div>
                          </div>

                          {/* Compact Secondary Lines */}
                          <div className="flex items-center justify-between text-[11px] px-1 text-slate-500 font-medium">
                            <span>إجمالي أرباحه: <strong className="text-slate-700">+{formatCurrency(shareholder.netEntitlement)}</strong></span>
                            <span>ما تم صرفه: <strong className={Number(shareholder.totalWithdrawnProfits) > 0 ? 'text-amber-700' : 'text-slate-700'}>{formatWithdrawal(shareholder.totalWithdrawnProfits)}</strong></span>
                          </div>

                          <div className="text-[10px] px-2 py-1.5 rounded-lg bg-slate-100/80 text-slate-600 flex items-center justify-between gap-2">
                            {isF ? (
                              Number(shareholder.partnerShareOfDebt || 0) > 0 ? (
                                <>
                                  <span>حصته من التزامات الموردين: <strong className="text-rose-700">-{formatCurrency(shareholder.partnerShareOfDebt)}</strong></span>
                                  <span>الصافي الحر: <strong className="text-[#0f1f4a]">{formatCurrency(shareholder.partnerNetFreeCapital ?? shareholder.totalNetValue)}</strong></span>
                                </>
                              ) : (
                                <span>يقتسم صافي ربح الشركة + حصة إدارة المساهمين بنسبة %{shareholder.sharePercentage}</span>
                              )
                            ) : (
                              <>
                                <span>نسبة الشركة للإدارة (%{mgmtPct}): <strong className="text-slate-800">{formatCurrency(shareholder.mgmtFee || 0)}</strong></span>
                                <span>عائد التمويل الإجمالي: <strong>{formatCurrency(shareholder.grossProfit || 0)}</strong></span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Cohesive Action Buttons */}
                      <div className="px-3.5 py-2.5 border-t border-slate-200/70 bg-white/80 flex flex-wrap items-center gap-1.5 mt-auto">
                        {!isF ? (
                          <button
                            type="button"
                            onClick={() => openTxModal(shareholder.id, 'profit_withdrawal')}
                            className="flex-1 min-w-[115px] h-8 px-2.5 bg-[#0f766e] hover:bg-[#115e59] text-white rounded-lg text-xs font-bold shadow-2xs transition-all flex items-center justify-center gap-1 active:scale-95 cursor-pointer"
                          >
                            <DollarSign size={13} />
                            <span>صرف أرباح</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openTxModal(shareholder.id, 'profit_withdrawal')}
                            className="flex-1 min-w-[105px] h-8 px-2.5 bg-[#1e3a8a] hover:bg-[#0f1f4a] text-white rounded-lg text-xs font-bold shadow-2xs transition-all flex items-center justify-center gap-1 active:scale-95 cursor-pointer"
                            title="سحب أرباح نقداً للشريك من الخزينة"
                          >
                            <DollarSign size={13} />
                            <span>سحب أرباح</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => openTxModal(shareholder.id, 'capital_deposit')}
                          className="h-8 px-2.5 bg-white hover:bg-slate-100 text-slate-700 rounded-lg text-[11px] font-bold transition-all border border-slate-300/80 flex items-center justify-center gap-1 active:scale-95 cursor-pointer"
                          title={isF ? 'زيادة رأس المال' : 'زيادة مبلغ التمويل'}
                        >
                          <ArrowDownToLine size={12} />
                          <span>إيداع</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => openTxModal(shareholder.id, 'capital_withdrawal')}
                          className="h-8 px-2.5 bg-white hover:bg-rose-50 text-rose-700 rounded-lg text-[11px] font-bold transition-all border border-rose-200 flex items-center justify-center gap-1 active:scale-95 cursor-pointer"
                          title={isF ? 'سحب من رأس المال' : 'رد جزء أو كل مبلغ التمويل'}
                        >
                          <ArrowUpFromLine size={12} />
                          <span>{isF ? 'رأس مال' : 'سحب تمويل'}</span>
                        </button>
                        {isF && isApiMode() && Number(shareholder.availableProfit || 0) >= 1 && (
                          <button
                            type="button"
                            disabled={isCapitalizing}
                            onClick={() => handleCapitalizeProfits(shareholder.id)}
                            className="h-8 px-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-[11px] font-bold transition-all border border-indigo-200 flex items-center justify-center gap-1 active:scale-95 cursor-pointer disabled:opacity-50"
                            title="تحويل الأرباح المتاحة وإضافتها رسمياً إلى رأس المال دون سحب كاش"
                          >
                            <span>رسملة</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setInspectingPartnerId(shareholder.id)}
                          className="h-8 px-2.5 bg-white hover:bg-slate-100 text-slate-600 rounded-lg text-xs font-bold transition-all border border-slate-300/80 flex items-center justify-center active:scale-95 cursor-pointer"
                          title="كشف الحساب التفصيلي"
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
              تُحسب الحصص تلقائياً حسب تاريخ انضمام كل شريك ومبلغ تمويله
            </div>
          </div>
        </section>
      ) : activeTab === 'ledger' ? (
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

          {/* Mobile Transactions Cards (< md) */}
          <div className="md:hidden flex-1 min-h-0 overflow-y-auto p-2.5 space-y-2.5 custom-scrollbar">
            {displayedTransactions.length === 0 ? (
              <div className="py-12 px-4 text-center text-slate-400">
                <FileText size={32} className="mx-auto mb-2 text-slate-300" />
                <p className="text-xs font-bold">لا توجد حركات مالية مسجلة مطابقة للفلتر</p>
              </div>
            ) : (
              displayedTransactions.map((tx: any) => {
                const isPositive = tx.type === 'capital_deposit' || tx.type === 'profit_distribution';
                const partner = liveShareholders.find((s: any) => s.id === tx.shareholderId);
                const partnerName = partner?.name || tx.shareholderName;
                return (
                  <div key={`mob-tx-${tx.id}`} className="bg-white border border-slate-200 rounded-2xl p-3.5 shadow-2xs space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <button
                          type="button"
                          onClick={() => setInspectingPartnerId(tx.shareholderId)}
                          className="font-black text-sm text-slate-900 hover:text-indigo-600 text-right block truncate"
                        >
                          {partnerName}
                        </button>
                        <span className="text-[11px] font-mono text-slate-500">{formatDateDisplay(tx.date)}</span>
                      </div>
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-mono font-black border shrink-0 ${
                          isPositive ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'
                        }`}
                        dir="ltr"
                      >
                        {isPositive ? '+' : '-'}{formatCurrency(tx.amount)}
                      </span>
                    </div>

                    {tx.description && (
                      <p className="text-xs text-slate-600 break-words">{tx.description}</p>
                    )}

                    <div className="grid grid-cols-2 gap-2 bg-slate-50 rounded-xl p-2 text-xs border border-slate-100">
                      <div>
                        <span className="text-[10px] text-slate-400 block font-bold">رأس المال بعد الحركة</span>
                        <span className="font-bold text-slate-800">{tx.runningCapital !== undefined ? formatCurrency(tx.runningCapital) : '-'}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 block font-bold">الأرباح بعد الحركة</span>
                        <span className="font-bold text-emerald-700">{tx.runningAvailableProfit !== undefined ? formatCurrency(tx.runningAvailableProfit) : '-'}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1 border-t border-slate-100 text-[11px] text-slate-500">
                      <span>بواسطة: {tx.createdBy || 'المدير العام'}</span>
                      {isUserAdmin && (
                        <button
                          type="button"
                          onClick={() => handleDeleteTransaction(tx.id)}
                          className="p-1 text-rose-600 bg-rose-50 rounded-lg"
                          title="حذف وعكس أثر الحركة"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="hidden md:block flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
            <table className="w-full table-fixed border-collapse text-xs">
              <thead className="desktop-sticky-header">
                <tr>
                  <th className="py-2.5 px-2 text-right w-[9.5%]">التاريخ</th>
                  <th className="py-2.5 px-2 text-right w-[15.5%]">الشريك / المساهم</th>
                  <th className="py-2.5 px-2 text-right w-[11.5%]">نوع الحركة</th>
                  <th className="py-2.5 px-2 text-right w-[11%]">المبلغ</th>
                  <th className="py-2.5 px-2 text-right w-[11.5%]">رأس المال بعد الحركة</th>
                  <th className="py-2.5 px-2 text-right w-[11%]">الأرباح بعد الحركة</th>
                  <th className="py-2.5 px-2 text-right w-[16%]">البيان / الملاحظات</th>
                  <th className="py-2.5 px-2 text-right w-[9%]">بواسطة</th>
                  <th className="py-2.5 px-2 text-center w-[5%]">إجراء</th>
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
                        <td className="py-2.5 px-2 text-[11px] font-mono text-slate-600 whitespace-nowrap truncate">
                          {formatDateDisplay(tx.date)}
                        </td>
                        <td className="py-2.5 px-2 text-xs font-bold text-slate-900">
                          <button
                            type="button"
                            onClick={() => setInspectingPartnerId(tx.shareholderId)}
                            className="hover:text-indigo-600 text-right inline-flex items-center gap-1.5 group cursor-pointer max-w-full min-w-0"
                            title={`${partnerName} (${isFounder ? 'شريك أساسي' : 'مساهم تمويل'})`}
                          >
                            <span className="font-black group-hover:underline text-slate-900 group-hover:text-indigo-600 truncate">
                              {partnerName}
                            </span>
                            {isFounder ? (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-black bg-blue-50 text-blue-700 border border-blue-200 shrink-0">
                                شريك
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200 shrink-0">
                                مساهم
                              </span>
                            )}
                          </button>
                        </td>
                        <td className="py-2.5 px-2 whitespace-nowrap">
                          {tx.type === 'capital_deposit' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 max-w-full truncate">
                              <ArrowDownToLine size={11} className="text-indigo-600 shrink-0" />
                              <span className="truncate">إيداع رأس مال</span>
                            </span>
                          )}
                          {tx.type === 'capital_withdrawal' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200 max-w-full truncate">
                              <ArrowUpFromLine size={11} className="text-rose-600 shrink-0" />
                              <span className="truncate">سحب رأس مال</span>
                            </span>
                          )}
                          {tx.type === 'profit_distribution' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 max-w-full truncate">
                              <DollarSign size={11} className="text-emerald-600 shrink-0" />
                              <span className="truncate">توزيع أرباح</span>
                            </span>
                          )}
                          {tx.type === 'profit_withdrawal' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200 max-w-full truncate">
                              <Wallet size={11} className="text-amber-600 shrink-0" />
                              <span className="truncate">صرف أرباح</span>
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-2 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-lg text-xs font-mono font-black tabular-nums border max-w-full truncate ${
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
                        <td className="py-2.5 px-2 text-xs font-bold text-slate-800 tabular-nums whitespace-nowrap font-mono truncate">
                          {tx.runningCapital !== undefined ? formatCurrency(tx.runningCapital) : '-'}
                        </td>
                        <td className="py-2.5 px-2 text-xs font-bold text-emerald-700 tabular-nums whitespace-nowrap font-mono truncate">
                          {tx.runningAvailableProfit !== undefined ? formatCurrency(tx.runningAvailableProfit) : '-'}
                        </td>
                        <td className="py-2.5 px-2 text-xs text-slate-600 truncate" title={tx.description}>
                          {tx.description}
                        </td>
                        <td className="py-2.5 px-2 text-[11px] text-slate-600 whitespace-nowrap">
                          <span
                            className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-medium max-w-full truncate"
                            title={tx.createdBy || 'المدير العام'}
                          >
                            {tx.createdBy || 'المدير العام'}
                          </span>
                        </td>
                        <td className="py-2.5 px-2 text-center whitespace-nowrap">
                          {isUserAdmin ? (
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
      ) : (
        /* TAB 3: Detailed CPA Accountant Financial Audit & Distribution Statement */
        <section className="flex-1 min-h-0 flex flex-col rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
          {/* Control Strip: Realized Basis Indicator, Period Filter, Settle & Print */}
          <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2.5 shrink-0">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50/80 px-3 text-xs font-bold text-emerald-900">
                <ShieldCheck size={14} className="text-emerald-600 shrink-0" />
                <span>الأساس المعتمد: الأرباح المحصلة كاش بالخزينة (الآمن)</span>
              </div>

              <div className="flex items-center gap-1.5 bg-white px-2.5 h-8 rounded-xl border border-slate-200 text-xs">
                <Calendar size={13} className="text-slate-400" />
                <span className="font-bold text-slate-500">من:</span>
                <input
                  type="date"
                  value={reportPeriodFrom}
                  onChange={(e) => setReportPeriodFrom(e.target.value)}
                  className="bg-transparent font-bold text-slate-800 outline-none text-xs"
                />
                <span className="font-bold text-slate-400">| إلى:</span>
                <input
                  type="date"
                  value={reportPeriodTo}
                  onChange={(e) => setReportPeriodTo(e.target.value)}
                  className="bg-transparent font-bold text-slate-800 outline-none text-xs"
                />
                {(reportPeriodFrom || reportPeriodTo) && (
                  <button
                    type="button"
                    onClick={() => {
                      setReportPeriodFrom('');
                      setReportPeriodTo('');
                    }}
                    className="text-rose-600 hover:text-rose-700 font-bold text-[11px] px-1 cursor-pointer"
                    title="عرض كل الفترات"
                  >
                    الكل
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {isUserAdmin && (
                <button
                  type="button"
                  onClick={handleSettlePeriod}
                  disabled={isSettlingPeriod}
                  className="h-8 flex items-center gap-1.5 bg-emerald-50 hover:bg-emerald-600 text-emerald-700 hover:text-white border border-emerald-200 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
                  title="اعتماد وتثبيت أرباح الشركاء المستحقة حتى هذا التاريخ في قيود رسمية"
                >
                  <CheckCircle2 size={13} />
                  <span>{isSettlingPeriod ? 'جاري التثبيت...' : 'اعتماد وتثبيت التسوية'}</span>
                </button>
              )}
              <button
                type="button"
                onClick={handlePrintAccountantReport}
                className="h-8 flex items-center gap-1.5 bg-[#1e40af] hover:bg-[#1d4ed8] text-white px-3.5 rounded-xl text-xs font-bold transition-all shadow-xs active:scale-95 cursor-pointer"
              >
                <Printer size={13} />
                <span>طباعة التقرير للمحاسب</span>
              </button>
            </div>
          </div>

          {/* Scrollable CPA Audit Report Content */}
          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
            {!liveMetrics?.accountantReport ? (
              <div className="py-12 text-center text-slate-400 text-sm font-bold">
                التقرير المحاسبي التفصيلي متاح عند الاتصال بالسيرفر الرئيسي.
              </div>
            ) : (
              (() => {
                const rpt = liveMetrics.accountantReport;
                return (
                  <>
                    {/* Alert if pre-capital profits exist due to joined_date */}
                    {Math.abs(Number(rpt.preCapitalProfit || 0)) > 0.01 && (
                      <div className="bg-amber-50/90 border border-amber-200 rounded-xl p-3 flex items-start gap-2.5 text-xs text-amber-900">
                        <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                        <div className="leading-relaxed">
                          <strong className="font-black">تنبيه بخصوص تاريخ الانضمام:</strong>{' '}
                          يوجد صافي ربح بقيمة <strong className="font-mono">{formatCurrency(rpt.preCapitalProfit)}</strong> تحقق قبل أقدم تاريخ انضمام مسجل للشركاء الحاليين ({liveShareholders.map((s: any) => `${s.name}: ${formatDateDisplay(s.joinedDate)}`).join(' • ')}).
                          لم يُوزع هذا المبلغ تلقائياً لأنه سابق لتاريخ دخولهم المسجل بالنظام؛ وإذا كانت الفواتير تخص الشركاء من تاريخ أقدم، عدّل <strong>«تاريخ الانضمام»</strong> للشريك من بطاقة التعديل ليُوزع فوراً.
                        </div>
                      </div>
                    )}

                    {Number(rpt.totalOverDistributedDelta || 0) > 0.05 && (
                      <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 flex items-start gap-2.5 text-xs text-rose-900">
                        <AlertTriangle size={16} className="text-rose-600 shrink-0 mt-0.5" />
                        <div className="leading-relaxed">
                          <strong className="font-black">تنبيه: تسويات مثبّتة تتجاوز الربح الفعلي الحالي:</strong>{' '}
                          توجد قيود توزيع أرباح معتمدة مسبقاً تزيد بمقدار <strong className="font-mono">{formatCurrency(rpt.totalOverDistributedDelta)}</strong> عن صافي الأرباح الفعلية وفق أساس الاحتساب المختار حالياً (غالباً بسبب تثبيت تسوية على أساس تعاقدي أو عكس دفعة/إضافة مصروف لاحقاً). يمكنك مراجعة سجل التسويات بالأسفل أو إلغاء التسوية غير المناسبة.
                        </div>
                      </div>
                    )}

                    {/* Section 1 + 2 Side-by-Side: Income Bridge & Zero-Variance Audit */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {/* Card A: Income & Realization Bridge */}
                      <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
                        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                          <h3 className="text-xs font-black text-[#0f1f4a] flex items-center gap-1.5">
                            <BarChart3 size={14} className="text-[#1e40af]" />
                            <span>1. ملخص أرباح الشركة (المحصّل مقابل المؤجل)</span>
                          </h3>
                          <span className="text-[10px] font-bold text-slate-500">
                            تحصيل نقدي: {formatCurrency(rpt.periodCashCollections ?? rpt.totalCollectedOnSales)} | متبقي عند العملاء: {formatCurrency(rpt.totalDeferredReceivables)}
                          </span>
                        </div>
                        <table className="w-full table-fixed text-xs">
                          <tbody className="divide-y divide-slate-100">
                            <tr>
                              <td className="py-2 px-3 text-slate-600 font-semibold">إجمالي عقود المبيعات</td>
                              <td className="py-2 px-3 w-[135px] text-left font-mono font-bold text-slate-900 whitespace-nowrap" dir="ltr">{formatCurrency(rpt.totalContractGrossRevenue)}</td>
                            </tr>
                            <tr>
                              <td className="py-2 px-3 text-slate-500">(-) خصومات السداد المبكر الممنوحة</td>
                              <td className="py-2 px-3 text-left font-mono font-bold text-rose-600 whitespace-nowrap" dir="ltr">-{formatCurrency(rpt.totalEarlySettlementDiscounts)}</td>
                            </tr>
                            <tr className="bg-slate-50/60">
                              <td className="py-2 px-3 text-slate-800 font-bold">(=) صافي المبيعات الفعلية</td>
                              <td className="py-2 px-3 text-left font-mono font-black text-slate-900 whitespace-nowrap" dir="ltr">{formatCurrency(rpt.totalEffectiveRevenue)}</td>
                            </tr>
                            <tr>
                              <td className="py-2 px-3 text-slate-600">
                                (-) تكلفة البضاعة المشتراة
                                <span className="block text-[10px] text-slate-400">
                                  بنود ({rpt.costedByItemsCount} فاتورة): {formatCurrency(rpt.totalCogsFromItems)} • عقود مستوردة ({rpt.costedBySubtotalFallbackCount} فاتورة): {formatCurrency(rpt.totalCogsFromSubtotalFallback)}
                                </span>
                              </td>
                              <td className="py-2 px-3 text-left font-mono font-bold text-rose-600 whitespace-nowrap" dir="ltr">-{formatCurrency(rpt.totalCogs)}</td>
                            </tr>
                            <tr className="bg-blue-50/40">
                              <td className="py-2 px-3 text-slate-800 font-bold">(=) مجمل ربح عقود الفترة (قبل التحصيل)</td>
                              <td className="py-2 px-3 text-left font-mono font-black text-[#1e40af] whitespace-nowrap" dir="ltr">{formatCurrency(rpt.accrualGrossProfit)}</td>
                            </tr>
                            <tr>
                              <td className="py-2 px-3 text-amber-800 font-semibold">(-) أرباح مؤجلة بأقساط غير محصلة بعد</td>
                              <td className="py-2 px-3 text-left font-mono font-bold text-amber-700 whitespace-nowrap" dir="ltr">-{formatCurrency(rpt.deferredProfits)}</td>
                            </tr>
                            {rpt.isFilteredPeriod && Number(rpt.realizedFromPriorSales || 0) !== 0 && (
                              <tr>
                                <td className="py-2 px-3 text-emerald-800 font-semibold">(+) أرباح محققة من تحصيل أقساط فواتير سابقة</td>
                                <td className="py-2 px-3 text-left font-mono font-bold text-emerald-700 whitespace-nowrap" dir="ltr">+{formatCurrency(rpt.realizedFromPriorSales)}</td>
                              </tr>
                            )}
                            <tr className="bg-emerald-50/40">
                              <td className="py-2 px-3 text-emerald-900 font-bold">(=) إجمالي الأرباح المحققة نقداً (من تحصيل {formatCurrency(rpt.periodCashCollections ?? rpt.totalCollectedOnSales)})</td>
                              <td className="py-2 px-3 text-left font-mono font-black text-emerald-700 whitespace-nowrap" dir="ltr">{formatCurrency(rpt.realizedGrossProfit)}</td>
                            </tr>
                            <tr>
                              <td className="py-2 px-3 text-slate-600">(-) المصروفات التشغيلية</td>
                              <td className="py-2 px-3 text-left font-mono font-bold text-rose-600 whitespace-nowrap" dir="ltr">-{formatCurrency(rpt.totalExpenses)}</td>
                            </tr>
                            <tr className="bg-[#0f1f4a]/[0.04]">
                              <td className="py-2.5 px-3 text-[#0f1f4a] font-black">
                                (=) صافي الربح للتوزيع ({profitBasis === 'realized' ? 'المحصّل كاش' : 'التعاقدي'})
                                <span className="block text-[10px] font-medium text-slate-500">
                                  للمقارنة — التعاقدي: {formatCurrency(rpt.accrualNetProfit)} | المحصّل كاش: {formatCurrency(rpt.realizedNetProfit)}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-left font-mono font-black text-sm text-[#0f1f4a] whitespace-nowrap" dir="ltr">{formatCurrency(rpt.selectedNetProfit)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>

                      {/* Card B: Reconciliation Audit */}
                      <div className="rounded-xl border border-slate-200 overflow-hidden bg-white flex flex-col justify-between">
                        <div>
                          <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                            <h3 className="text-xs font-black text-[#0f1f4a] flex items-center gap-1.5">
                              <ShieldCheck size={14} className="text-emerald-600" />
                              <span>2. مطابقة توزيع الأرباح</span>
                            </h3>
                            <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border shrink-0 ${
                              rpt.isReconciled
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : 'bg-rose-50 text-rose-700 border-rose-200'
                            }`}>
                              {rpt.isReconciled ? 'متطابق 100%' : 'يوجد فارق'}
                            </span>
                          </div>
                          <table className="w-full table-fixed text-xs">
                            <tbody className="divide-y divide-slate-100">
                              <tr>
                                <td className="py-2.5 px-3 text-slate-700 font-semibold">نصيب المساهمين بالتمويل (المستحق لهم)</td>
                                <td className="py-2.5 px-3 w-[135px] text-left font-mono font-bold text-[#1e40af] whitespace-nowrap" dir="ltr">{formatCurrency(rpt.totalInvestorsNet)}</td>
                              </tr>
                              <tr>
                                <td className="py-2.5 px-3 text-slate-500">
                                  حصة الإدارة المحصلة من عوائد المساهمين
                                  <span className="block text-[10px] text-slate-400">تُضاف تلقائياً لحصة أصحاب الشركة أدناه</span>
                                </td>
                                <td className="py-2.5 px-3 text-left font-mono font-bold text-slate-700 whitespace-nowrap" dir="ltr">{formatCurrency(rpt.totalMgmtFees)}</td>
                              </tr>
                              <tr>
                                <td className="py-2.5 px-3 text-slate-700 font-semibold">نصيب أصحاب الشركة / الشركاء المؤسسين</td>
                                <td className="py-2.5 px-3 text-left font-mono font-bold text-emerald-700 whitespace-nowrap" dir="ltr">{formatCurrency(rpt.totalFoundersNet)}</td>
                              </tr>
                              <tr>
                                <td className="py-2.5 px-3 text-amber-800">أرباح قبل تاريخ انضمام الشركاء المسجل</td>
                                <td className="py-2.5 px-3 text-left font-mono font-bold text-amber-700 whitespace-nowrap" dir="ltr">{formatCurrency(rpt.preCapitalProfit)}</td>
                              </tr>
                              <tr>
                                <td className="py-2.5 px-3 text-slate-500">احتياطي غير مخصص (فترات بدون شريك مؤسس)</td>
                                <td className="py-2.5 px-3 text-left font-mono font-bold text-slate-700 whitespace-nowrap" dir="ltr">{formatCurrency(rpt.companyUnclaimedRetainedPool)}</td>
                              </tr>
                              <tr className="bg-blue-50/40">
                                <td className="py-2.5 px-3 text-slate-900 font-black">(=) إجمالي الموزع والمطابق</td>
                                <td className="py-2.5 px-3 text-left font-mono font-black text-slate-900 whitespace-nowrap" dir="ltr">{formatCurrency(rpt.allocatedSum)}</td>
                              </tr>
                              <tr className="bg-emerald-50/40">
                                <td className="py-2.5 px-3 text-emerald-900 font-black">فارق المطابقة</td>
                                <td className="py-2.5 px-3 text-left font-mono font-black text-emerald-700 whitespace-nowrap" dir="ltr">{formatCurrency(rpt.reconciliationVariance)}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                        <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 text-[11px] text-slate-500 leading-relaxed">
                          <strong>طريقة الحساب:</strong> كل مساهم يأخذ عائداً بنسبة أمواله مضروبة في نسبته المتفق عليها، والباقي مع رسوم الإدارة يُقسم بين أصحاب الشركة حسب نسب الملكية بعد خصم المصروفات.
                        </div>
                      </div>
                    </div>

                    {/* Section 3: Partner-by-Partner CPA Distribution Statement */}
                    <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
                      <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-xs font-black text-[#0f1f4a]">
                          3. نصيب كل شريك ومساهم والمركز المالي
                        </h3>
                        <span className="text-[11px] font-bold text-slate-500">
                          عدد الشركاء: {liveShareholders.length}
                        </span>
                      </div>
                      {/* Mobile Cards (< md) */}
                      <div className="md:hidden divide-y divide-slate-100">
                        {liveShareholders.map((s: any) => (
                          <div key={`mob-rpt-${s.id}`} className="p-3 space-y-2 text-xs">
                            <div className="flex items-center justify-between">
                              <button
                                type="button"
                                onClick={() => setInspectingPartnerId(s.id)}
                                className="font-black text-slate-900 hover:text-[#1e40af]"
                              >
                                {s.name}
                              </button>
                              <span className="text-[10px] font-mono text-slate-500">من: {formatDateDisplay(s.joinedDate)}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-2 bg-slate-50 rounded-lg p-2">
                              <div><span className="text-[10px] text-slate-400 block">رأس المال (المرجح)</span><strong className="font-mono">{formatCurrency(s.capital)} ({formatCurrency(s.weightedAvgCapital ?? s.capital)})</strong></div>
                              <div><span className="text-[10px] text-slate-400 block">نصيب الفترة</span><strong className="font-mono text-emerald-700">{formatCurrency(s.netEntitlement)} (%{s.sharePercentage})</strong></div>
                              <div><span className="text-[10px] text-slate-400 block">المتاح للسحب</span><strong className="font-mono text-[#1e40af]">{formatCurrency(s.availableProfit)}</strong></div>
                              <div><span className="text-[10px] text-slate-400 block">الصافي بعد الموردين</span><strong className="font-mono text-slate-900">{formatCurrency(s.partnerNetFreeCapital ?? s.totalNetValue)}</strong></div>
                            </div>
                          </div>
                        ))}
                      </div>
                      {/* Desktop Fixed-Layout Table */}
                      <div className="hidden md:block overflow-x-hidden">
                        <table className="w-full table-fixed text-xs text-right border-collapse">
                          <thead className="bg-slate-50/90 border-b border-slate-200 text-slate-600 font-bold">
                            <tr>
                              <th className="py-2.5 px-2 w-[15%]">الشريك / المساهم</th>
                              <th className="py-2.5 px-2 w-[13%]">رأس المال (الحالي / المرجح)</th>
                              <th className="py-2.5 px-2 w-[13%]">عائد أمواله والاتفاق</th>
                              <th className="py-2.5 px-2 w-[12%]">نصيب الفترة</th>
                              <th className="py-2.5 px-2 w-[11%]">حصة الإدارة</th>
                              <th className="py-2.5 px-2 w-[11%]">المسحوبات</th>
                              <th className="py-2.5 px-2 w-[12%]">المتاح للسحب</th>
                              <th className="py-2.5 px-2 w-[13%]">الصافي بعد الموردين</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {liveShareholders.map((s: any) => (
                              <tr key={`rpt-${s.id}`} className="hover:bg-slate-50/70">
                                <td className="py-2.5 px-2">
                                  <button
                                    type="button"
                                    onClick={() => setInspectingPartnerId(s.id)}
                                    className="font-black text-slate-900 hover:text-[#1e40af] block text-right cursor-pointer truncate max-w-full"
                                  >
                                    {s.name}
                                  </button>
                                  <div className="flex items-center gap-1 flex-wrap mt-0.5">
                                    <span className={`inline-block px-1.5 py-0.2 rounded text-[10px] font-bold border ${
                                      s.isFounder
                                        ? 'bg-[#0f1f4a]/[0.07] text-[#0f1f4a] border-[#0f1f4a]/15'
                                        : 'bg-blue-50 text-[#1e40af] border-blue-200'
                                    }`}>
                                      {s.isFounder ? 'شريك مؤسس' : 'مساهم'}
                                    </span>
                                    <span className="text-[10px] font-mono text-slate-400">
                                      {formatDateDisplay(s.joinedDate)}
                                    </span>
                                  </div>
                                </td>
                                <td className="py-2.5 px-2 font-mono">
                                  <span className="block font-bold text-slate-900">{formatCurrency(s.capital)}</span>
                                  <span className="block text-[10px] text-slate-400">مرجح: {formatCurrency(s.weightedAvgCapital ?? s.capital)}</span>
                                </td>
                                <td className="py-2.5 px-2 font-mono">
                                  <span className="block font-bold text-slate-800">{formatCurrency(s.grossProfit)}</span>
                                  <span className="inline-block text-[10px] font-black text-[#1e40af]">الاتفاق: %{s.sharePercentage}</span>
                                </td>
                                <td className="py-2.5 px-2 font-mono font-black text-emerald-700">{formatCurrency(s.netEntitlement)}</td>
                                <td className="py-2.5 px-2 font-mono text-slate-600 text-[11px]">
                                  {s.isFounder ? '—' : (
                                    <>
                                      <span className="block font-bold">{formatCurrency(s.mgmtFee)}</span>
                                      <span className="block text-[10px] text-slate-400">(%{s.managementFeePercentage})</span>
                                    </>
                                  )}
                                </td>
                                <td className="py-2.5 px-2 font-mono text-amber-700">{formatWithdrawal(s.totalWithdrawnProfits)}</td>
                                <td className="py-2.5 px-2 font-mono font-black text-[#1e40af]">{formatCurrency(s.availableProfit)}</td>
                                <td className="py-2.5 px-2 font-mono">
                                  <span className="block font-black text-slate-900">{formatCurrency(s.partnerNetFreeCapital ?? s.totalNetValue)}</span>
                                  {Number(s.partnerShareOfDebt || 0) > 0 && (
                                    <span className="block text-[10px] text-rose-600">موردين: -{formatCurrency(s.partnerShareOfDebt)}</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Section 4: Approved Settlements Log */}
                    <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
                      <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-xs font-black text-[#0f1f4a] flex items-center gap-1.5">
                          <CheckCircle2 size={14} className="text-emerald-600" />
                          <span>4. سجل التسويات المعتمدة والمغلقة سابقاً ({(rpt.settledPeriods || []).length})</span>
                        </h3>
                        <span className="text-[11px] text-slate-500">
                          زر «اعتماد وتثبيت التسوية» يثبت الأرباح المستحقة حتى تاريخ الإغلاق في السجل الرسمي
                        </span>
                      </div>
                      {(rpt.settledPeriods || []).length === 0 ? (
                        <div className="py-5 px-4 text-center text-xs text-slate-400 font-bold">
                          لم يتم تثبيت تسويات مقفلة حتى الآن — الأرباح الحالية تُحسب بشكل لحظي ومباشر.
                        </div>
                      ) : (
                        <div className="divide-y divide-slate-100">
                          {(rpt.settledPeriods || []).map((cp: any) => (
                            <div key={cp.id} className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs hover:bg-slate-50/70">
                              <div className="min-w-0">
                                <span className="font-black text-slate-900">تسوية حتى {formatDateDisplay(cp.periodDate)}</span>
                                <span className="mx-2 text-slate-300">•</span>
                                <span className="text-slate-600 font-medium">{cp.notes || 'تسوية دورية'}</span>
                                <div className="text-[10px] text-slate-400 mt-0.5">
                                  اعتمدها: {cp.closedBy || 'المدير العام'} — {formatDateDisplay(cp.closedAt)}
                                </div>
                              </div>
                              {isUserAdmin && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteSettlement(cp)}
                                  className="px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-[11px] font-bold transition-colors cursor-pointer shrink-0"
                                >
                                  فك وإلغاء التسوية
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Section 5: Collapsible Technical Tranches Audit */}
                    <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
                      <button
                        type="button"
                        onClick={() => setShowTranchesDetails((v) => !v)}
                        className="w-full px-4 py-2.5 bg-slate-50 hover:bg-slate-100/80 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-2 text-right cursor-pointer transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <h3 className="text-xs font-black text-[#0f1f4a]">
                            5. تفاصيل الشرائح الزمنية وعائد الجنيه (للمحاسب) ({(rpt.tranches || []).length})
                          </h3>
                        </div>
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#1e40af]">
                          <span>{showTranchesDetails ? 'إخفاء التفاصيل' : 'عرض التفاصيل'}</span>
                          {showTranchesDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </span>
                      </button>

                      {showTranchesDetails && (
                        <>
                          {/* Mobile Cards (< md) */}
                          <div className="md:hidden divide-y divide-slate-100">
                            {(rpt.tranches || []).length === 0 ? (
                              <div className="py-6 text-center text-xs text-slate-400 font-bold">
                                لا توجد شرائح زمنية برأس مال نشط خلال الفترة المحددة
                              </div>
                            ) : (
                              (rpt.tranches || []).map((tr: any, idx: number) => (
                                <div key={`mob-tr-${tr.fromDate}-${tr.toDate}-${idx}`} className="p-3 space-y-2 text-xs">
                                  <div className="flex items-center justify-between">
                                    <span className="font-black text-[#0f1f4a]">#{idx + 1} • {formatDateDisplay(tr.fromDate)} ← {formatDateDisplay(tr.toDate)}</span>
                                    <span className="text-[11px] font-mono text-slate-500">{tr.days} يوم</span>
                                  </div>
                                  <div className="grid grid-cols-2 gap-2 bg-slate-50 rounded-lg p-2">
                                    <div><span className="text-[10px] text-slate-400 block">رأس المال العامل</span><strong className="font-mono">{formatCurrency(tr.totalActiveCapital)}</strong></div>
                                    <div><span className="text-[10px] text-slate-400 block">عائد الجنيه</span><strong className="font-mono text-[#1e40af]" dir="ltr">{Number(tr.roiPerEgp || 0).toFixed(4)} ({(Number(tr.roiPerEgp || 0) * 100).toFixed(2)}%)</strong></div>
                                    <div><span className="text-[10px] text-slate-400 block">صافي الشريحة</span><strong className="font-mono text-slate-900">{formatCurrency(tr.netProfit)}</strong></div>
                                    <div><span className="text-[10px] text-slate-400 block">المساهمين / المؤسسين</span><strong className="font-mono text-emerald-700">{formatCurrency(tr.investorsShare)} / {formatCurrency(tr.foundersShare)}</strong></div>
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                          {/* Desktop Fixed-Layout Table */}
                          <div className="hidden md:block overflow-x-hidden">
                            <table className="w-full table-fixed text-xs text-right border-collapse">
                              <thead className="bg-slate-50/90 border-b border-slate-200 text-slate-600 font-bold">
                                <tr>
                                  <th className="py-2 px-2 w-[4%]">#</th>
                                  <th className="py-2 px-2 w-[12%]">الفترة الزمنية</th>
                                  <th className="py-2 px-2 w-[6%]">الأيام</th>
                                  <th className="py-2 px-2 w-[12%]">رأس المال العامل</th>
                                  <th className="py-2 px-2 w-[11%]">ربح المبيعات</th>
                                  <th className="py-2 px-2 w-[10%]">المصروفات</th>
                                  <th className="py-2 px-2 w-[11%]">صافي الشريحة</th>
                                  <th className="py-2 px-2 w-[12%]">عائد الجنيه (ROI)</th>
                                  <th className="py-2 px-2 w-[11%]">حصة المساهمين</th>
                                  <th className="py-2 px-2 w-[11%]">حصة المؤسسين</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {(rpt.tranches || []).length === 0 ? (
                                  <tr>
                                    <td colSpan={10} className="py-6 text-center text-slate-400 font-bold">
                                      لا توجد شرائح زمنية برأس مال نشط خلال الفترة المحددة
                                    </td>
                                  </tr>
                                ) : (
                                  (rpt.tranches || []).map((tr: any, idx: number) => (
                                    <tr key={`${tr.fromDate}-${tr.toDate}-${idx}`} className="hover:bg-slate-50/70">
                                      <td className="py-2 px-2 font-mono text-slate-500">{idx + 1}</td>
                                      <td className="py-2 px-2 font-bold text-slate-800 text-[11px] leading-tight">
                                        <span className="block">{formatDateDisplay(tr.fromDate)}</span>
                                        <span className="block text-slate-400">← {formatDateDisplay(tr.toDate)}</span>
                                      </td>
                                      <td className="py-2 px-2 font-mono text-[11px]">{tr.days} يوم</td>
                                      <td className="py-2 px-2 font-mono font-bold text-slate-900 text-[11px]">{formatCurrency(tr.totalActiveCapital)}</td>
                                      <td className="py-2 px-2 font-mono text-emerald-700 text-[11px]">{formatCurrency(tr.grossProfit)}</td>
                                      <td className="py-2 px-2 font-mono text-rose-600 text-[11px]">-{formatCurrency(tr.expenses)}</td>
                                      <td className="py-2 px-2 font-mono font-black text-[#0f1f4a] text-[11px]">{formatCurrency(tr.netProfit)}</td>
                                      <td className="py-2 px-2 font-mono font-black text-[#1e40af] text-[11px] leading-tight" dir="ltr">
                                        <span className="block">{Number(tr.roiPerEgp || 0).toFixed(4)}</span>
                                        <span className="block text-[10px] text-slate-500 font-bold">({(Number(tr.roiPerEgp || 0) * 100).toFixed(2)}%)</span>
                                      </td>
                                      <td className="py-2 px-2 font-mono font-bold text-blue-700 text-[11px]">{formatCurrency(tr.investorsShare)}</td>
                                      <td className="py-2 px-2 font-mono font-bold text-emerald-700 text-[11px]">{formatCurrency(tr.foundersShare)}</td>
                                    </tr>
                                  ))
                                )}
                              </tbody>
                            </table>
                          </div>
                        </>
                      )}
                    </div>
                  </>
                );
              })()
            )}
          </div>
        </section>
      )}

      {/* Detailed Partner Chronological Ledger Modal */}
      {inspectingPartner && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
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

            {/* Scrollable Chronological Ledger Table (Desktop) & Cards (Mobile) */}
            <div className="md:hidden flex-1 min-h-0 overflow-y-auto p-2.5 space-y-2 custom-scrollbar">
              {(!inspectingPartner.ledger || inspectingPartner.ledger.length === 0) ? (
                <div className="py-10 text-center text-slate-400">
                  <FileText size={28} className="mx-auto mb-2 text-slate-300" />
                  <p className="text-xs font-bold">لا توجد حركات مسجلة في كشف حساب الشريك</p>
                </div>
              ) : (
                inspectingPartner.ledger.map((entry: LedgerEntry) => (
                  <div key={`mob-ldg-${entry.id}`} className="bg-white border border-slate-200 rounded-xl p-3 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] text-slate-500">{formatDateDisplay(entry.date)}</span>
                      <span className="font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded text-[10px]">
                        {entry.type === 'initial_capital' ? 'رأس مال تأسيسي' : entry.type === 'capital_deposit' ? 'إيداع رأس مال' : entry.type === 'capital_withdrawal' ? 'سحب رأس مال' : entry.type === 'profit_allocation' ? 'استحقاق أرباح' : entry.type === 'profit_distribution' ? 'توزيع أرباح' : 'سحب أرباح'}
                      </span>
                    </div>
                    <p className="text-slate-700 font-medium break-words">{entry.description}</p>
                    <div className="flex items-center justify-between pt-1 border-t border-slate-100 font-bold">
                      <span>رأس المال: {formatCurrency(entry.runningCapital)}</span>
                      <span className="text-emerald-700">الأرباح: {formatCurrency(entry.runningProfit)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="hidden md:block flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
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
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-[#1e40af] hover:bg-[#1d4ed8] text-white rounded-xl text-xs font-bold transition-all shadow-xs active:scale-95"
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
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
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
                  <label className="block text-xs font-bold text-slate-600 mb-1">تاريخ الانضمام (بداية الحساب)</label>
                  <input
                    type="date"
                    required
                    value={shareholderForm.joinedDate}
                    onChange={(e) => setShareholderForm({ ...shareholderForm, joinedDate: e.target.value })}
                    className="input-ui h-9 w-full text-xs px-3 font-bold"
                  />
                  <span className="block text-[10px] text-slate-400 mt-1">
                    تُحسب أرباح الشريك من الفواتير والتحصيلات اعتباراً من هذا التاريخ.
                  </span>
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
                  className="flex-1 px-4 py-2 bg-[#1e40af] text-white rounded-lg hover:bg-[#1d4ed8] text-xs font-bold"
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
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
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
                  className="flex-1 px-4 py-2 bg-[#1e40af] text-white rounded-lg hover:bg-[#1d4ed8] text-xs font-bold"
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
