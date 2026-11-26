import React, { useState, useEffect, useMemo } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Users,
  Plus,
  Wallet,
  Edit,
  Trash2,
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
  RefreshCw,
  AlertTriangle,
  BarChart3,
  CalendarClock,
  CheckCircle2,
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
import { formatDateDisplay } from '../lib/dateUtils';
import { calculateCostOfGoodsSold } from '../lib/accounting';
import { hasPermission } from '../lib/permissions';
import PaymentChannelSelector from '../components/PaymentChannelSelector';
import { DatePicker } from '../components/DatePicker';
import CurrencyText from '../components/CurrencyText';
import { formatWholeCurrency } from '../lib/utils';
import { escapeHtml } from '../lib/htmlUtils';
import type { TreasuryChannel } from '../lib/paymentChannels';

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

function localTodayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function toIsoDay(dateVal?: string | null): string {
  if (!dateVal) return localTodayIso();
  const s = String(dateVal).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return localTodayIso();
}

function endOfMonthAfterMonths(dateStr: string, monthsToAdd: number): string {
  const [y, m] = toIsoDay(dateStr).split('-').map(Number);
  const totalMonths = y * 12 + (m - 1) + monthsToAdd;
  const newYear = Math.floor(totalMonths / 12);
  const newMonth = (totalMonths % 12) + 1;
  const lastDay = new Date(Date.UTC(newYear, newMonth, 0)).getUTCDate();
  return `${newYear}-${String(newMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

function computeNextFutureCycleDate(baseDateStr?: string | null, cycleMonths?: number): string {
  const months = Number(cycleMonths || 1);
  const now = new Date();
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (months <= 0) return endOfMonthAfterMonths(baseDateStr || todayIso, 0);
  let candidate =
    months === 1
      ? endOfMonthAfterMonths(todayIso, 0)
      : endOfMonthAfterMonths(baseDateStr || todayIso, months);
  let guard = 0;
  while (candidate && candidate <= todayIso && guard < 120) {
    candidate = endOfMonthAfterMonths(candidate, months);
    guard++;
  }
  return candidate;
}

export default function Shareholders() {
  const { settings, user } = useAuth();
  const { confirmDialog, showToast } = useDialog();
  const [shareholders, setShareholders] = useState<any[]>([]);
  const [cashRequestDrafts, setCashRequestDrafts] = useState<Record<string, { amount: string; date: string; saving?: boolean }>>({});
  const [editingCashRequest, setEditingCashRequest] = useState<Record<string, boolean>>({});
  const [transactions, setTransactions] = useState<ShareholderTransaction[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  const [liveMetrics, setLiveMetrics] = useState<LiveTradingMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date>(new Date());

  const [activeTab, setActiveTab] = useState<'overview' | 'ledger' | 'report'>('overview');
  const [showTranchesDetails, setShowTranchesDetails] = useState<boolean>(false);
  const profitBasis = 'realized' as const;
  const [reportPeriodFrom, setReportPeriodFrom] = useState<string>('');
  const [reportPeriodTo, setReportPeriodTo] = useState<string>('');
  const isUserAdmin = user?.role === 'admin';
  const canManageShareholders = hasPermission(user, 'shareholders:manage');

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
    includeWarehouseProfit: false,
    payoutPreference: 'capitalize' as 'cash' | 'capitalize' | 'ask',
    payoutCycleMonths: 1,
    payoutNoticeDays: 15,
    nextPayoutDate: computeNextFutureCycleDate('', 1),
    sharePercentage: 50,
    managementFeePercentage: 50,
    capital: 0,
    joinedDate: localTodayIso(),
    notes: '',
    affectsTreasury: true,
    channel: 'cash' as TreasuryChannel,
  });

  const [transactionForm, setTransactionForm] = useState({
    amount: 0,
    date: localTodayIso(),
    description: '',
    affectsTreasury: true,
    channel: 'cash' as TreasuryChannel,
  });

  const formatCurrency = (amount: number) =>
    formatWholeCurrency(amount, settings.currency || 'جنيه');

  const formatNumberOnly = (amount: number) => {
    const num = Number(amount || 0);
    if (Math.abs(num) < 0.005 || Object.is(num, -0)) return '0';
    const rounded = Math.round(num);
    return new Intl.NumberFormat('en-US', {
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    }).format(Object.is(rounded, -0) ? 0 : rounded);
  };

  const formatWithdrawal = (amount?: number | null) => {
    const val = Math.round(Number(amount || 0));
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
      const totalGrossEquity = Number(liveMetrics.totalGrossEquity || (totalCapital + totalAvailableProfits));
      return {
        totalCapital,
        totalAvailableProfits,
        totalGrossEquity,
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

    // Compute auto-normalized founder percentages from capital (always summing to 100%)
    const offlineFounders = shareholders.filter((s: any) => Boolean(s.isFounder));
    const offlineTotalFoundersCap = offlineFounders.reduce(
      (sum: number, f: any) => sum + Math.max(0, Number(f.capital || 0)),
      0
    );
    const offlineFounderPctById = new Map<string, number>();
    let offlineRunningFounderPct = 0;
    offlineFounders.forEach((f: any, idx: number) => {
      let pct: number;
      if (idx === offlineFounders.length - 1) {
        pct = Number((100 - offlineRunningFounderPct).toFixed(2));
      } else if (offlineTotalFoundersCap > 0) {
        pct = Number(((Math.max(0, Number(f.capital || 0)) / offlineTotalFoundersCap) * 100).toFixed(2));
        offlineRunningFounderPct = Number((offlineRunningFounderPct + pct).toFixed(2));
      } else {
        pct = Number((100 / offlineFounders.length).toFixed(2));
        offlineRunningFounderPct = Number((offlineRunningFounderPct + pct).toFixed(2));
      }
      offlineFounderPctById.set(f.id, pct);
    });

    // PASS 1: Calculate active window, sales, cogs, expenses, and silent investors' returns (Model 1)
    const preparedStakeholders = shareholders.map((s: any) => {
      const currentCapital = Number(s.capital || 0);
      const isFounder = Boolean(s.isFounder);
      const sharePercentage = isFounder
        ? offlineFounderPctById.get(s.id) ?? 0
        : Number(s.sharePercentage || 0);
      const managementFeePercentage = isFounder
        ? 0
        : s.managementFeePercentage !== undefined
          ? Number(s.managementFeePercentage)
          : 100 - sharePercentage;

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
    const totalInvestorsMgmtFee = preparedStakeholders
      .filter((p) => !p.isFounder)
      .reduce((sum, p) => sum + p.mgmtFee, 0);

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
      let ownCapitalProfit = item.netEntitlement;
      let mgmtFeeEarned = 0;

      if (isFounder) {
        const foundersNetPool = Math.max(0, windowCompanyNetProfit - totalInvestorsProfit);
        const founderShareRatio =
          rawFoundersShareTotal > 0
            ? sharePercentage / rawFoundersShareTotal
            : 1 / (foundersList.length || 1);

        netEntitlement = Number((foundersNetPool * founderShareRatio).toFixed(2));
        grossProfit = netEntitlement;
        mgmtFee = 0;
        mgmtFeeEarned = Number(
          Math.min(netEntitlement, Math.max(0, totalInvestorsMgmtFee * founderShareRatio)).toFixed(2)
        );
        ownCapitalProfit = Number((netEntitlement - mgmtFeeEarned).toFixed(2));
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
        if (isFounder) {
          const mgmtPortion = Number(Math.min(Math.max(0, unallocated), Math.max(0, mgmtFeeEarned)).toFixed(2));
          const ownCapPortion = Number((unallocated - mgmtPortion).toFixed(2));
          if (Math.abs(ownCapPortion) >= 0.01) {
            runProf += ownCapPortion;
            ledger.push({
              id: `live-prof-${s.id}`,
              date: effectiveEnd,
              type: 'profit_allocation',
              description: `صافي ربح رأس المال المباشر بنسبة (${sharePercentage}%)`,
              amount: Math.abs(ownCapPortion),
              capitalDelta: 0,
              profitDelta: ownCapPortion,
              runningCapital: runCap,
              runningProfit: Math.max(0, runProf),
              runningTotalEquity: runCap + Math.max(0, runProf),
              createdBy: 'محرك الأرباح اللحظي',
              isSynthetic: true,
            });
          }
          if (mgmtPortion >= 0.01) {
            runProf += mgmtPortion;
            ledger.push({
              id: `live-mgmt-${s.id}`,
              date: effectiveEnd,
              type: 'profit_allocation',
              description: `عائد نسبة إدارة أموال المساهمين (حصته ${sharePercentage}% من أتعاب الإدارة)`,
              amount: mgmtPortion,
              capitalDelta: 0,
              profitDelta: mgmtPortion,
              runningCapital: runCap,
              runningProfit: Math.max(0, runProf),
              runningTotalEquity: runCap + Math.max(0, runProf),
              createdBy: 'محرك الأرباح اللحظي',
              isSynthetic: true,
            });
          }
        } else {
          runProf += unallocated;
          ledger.push({
            id: `live-prof-${s.id}`,
            date: effectiveEnd,
            type: 'profit_allocation',
            description: `صافي حصة أرباح التمويل (${sharePercentage}%) بعد خصم نسبة الإدارة للشركاء (${managementFeePercentage}%)`,
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
      }

      return {
        ...s,
        sharePercentage,
        managementFeePercentage,
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
        ownCapitalProfit,
        mgmtFeeEarned,
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
    const totalGrossEquity = Number(liveMetrics?.totalGrossEquity || (totalCapital + totalAvailableProfits));

    return {
      totalCapital,
      totalAvailableProfits,
      totalGrossEquity,
      liveShareholders,
      filteredTransactions,
    };
  }, [isLoading, liveMetrics, shareholders, transactions, sales, expenses, products, profitBasis]);

  const {
    totalCapital,
    totalAvailableProfits,
    totalGrossEquity,
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

    const rawFoundersShare = Number(
      founders
        .reduce((sum: number, s: any) => sum + Number(s.sharePercentage || 0), 0)
        .toFixed(2)
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

  // Auto-Capitalization & Liquidity Planning Summary
  const payoutPlanSummary = useMemo(() => {
    let cashReadyAmount = 0;
    let cashReadyCount = 0;
    let capitalizeAmount = 0;
    let capitalizeCount = 0;
    const cycleCounts = new Map<number, number>();

    for (const s of liveShareholders) {
      const avail = Math.max(0, Number(s.realizedAvailableProfit ?? s.availableProfit ?? 0));
      const requested = Math.max(0, Number(s.requestedPayoutAmount || 0));
      const pref = s.payoutPreference === 'cash' ? 'cash' : 'capitalize';
      if (pref === 'cash') {
        cashReadyAmount += requested > 0 ? requested : avail;
        cashReadyCount++;
      } else {
        capitalizeAmount += avail;
        capitalizeCount++;
      }
      const cyc = Number(s.payoutCycleMonths ?? 1);
      if ([1, 3, 6, 12].includes(cyc)) {
        cycleCounts.set(cyc, (cycleCounts.get(cyc) || 0) + 1);
      }
    }

    let currentCycleMonths = 1;
    let maxCycleVotes = 0;
    for (const [cyc, votes] of cycleCounts.entries()) {
      if (votes > maxCycleVotes) {
        maxCycleVotes = votes;
        currentCycleMonths = cyc;
      }
    }

    return {
      cashReadyAmount: Number(cashReadyAmount.toFixed(2)),
      cashReadyCount,
      capitalizeAmount: Number(capitalizeAmount.toFixed(2)),
      capitalizeCount,
      currentCycleMonths,
    };
  }, [liveShareholders]);

  const handleQuickPayoutPreference = async (partner: any, nextPref: 'cash' | 'capitalize' | 'ask') => {
    const curPref = partner.payoutPreference === 'cash' ? 'cash' : 'capitalize';
    if (!canManageShareholders || curPref === nextPref) return;
    const todayIso = localTodayIso();
    const partnerCycle = Number(partner.payoutCycleMonths ?? payoutPlanSummary.currentCycleMonths);
    const nextDate =
      nextPref === 'capitalize'
        ? partnerCycle > 0
          ? computeNextFutureCycleDate(partner.joinedDate || partner.createdAt, partnerCycle)
          : partner.nextPayoutDate && toIsoDay(partner.nextPayoutDate) > todayIso
            ? toIsoDay(partner.nextPayoutDate)
            : computeNextFutureCycleDate(partner.joinedDate || partner.createdAt, payoutPlanSummary.currentCycleMonths)
        : partner.nextPayoutDate || '';
    try {
      setShareholders((prev) =>
        prev.map((s) =>
          s.id === partner.id
            ? { ...s, payoutPreference: nextPref, ...(nextDate ? { nextPayoutDate: nextDate } : {}) }
            : s
        )
      );
      if (isApiMode()) {
        await api.updateShareholderPayoutPreference(partner.id, {
          payoutPreference: nextPref,
          ...(nextDate ? { nextPayoutDate: nextDate } : {}),
        });
      } else {
        await updateShareholder(partner.id, {
          ...partner,
          payoutPreference: nextPref,
          ...(nextDate ? { nextPayoutDate: nextDate } : {}),
        });
      }
      const label =
        nextPref === 'cash'
          ? 'طلب صرف نقدي (حدد المبلغ المطلوب وتاريخ الصرف ثم اضغط حفظ)'
          : 'رسملة تلقائية في الموعد';
      showToast(`تم تحديث ${partner.name}: ${label}`, 'success');
      await loadData();
    } catch (err: any) {
      showToast(err?.message || 'تعذر تحديث تفضيل الأرباح', 'error');
      await loadData();
    }
  };

  const handleSaveCashRequest = async (partner: any) => {
    if (!canManageShareholders) return;
    const draft = cashRequestDrafts[partner.id];
    const rawAmount = draft?.amount !== undefined ? draft.amount : (partner.requestedPayoutAmount ? String(partner.requestedPayoutAmount) : '');
    const rawDate = draft?.date !== undefined ? draft.date : (partner.nextPayoutDate || '');
    const parsedAmount = rawAmount.trim() !== '' ? Number(rawAmount) : null;
    if (parsedAmount !== null && (Number.isNaN(parsedAmount) || parsedAmount < 0)) {
      showToast('يرجى إدخال مبلغ صحيح لطلب الصرف النقدي.', 'warning');
      return;
    }
    const cleanDate = rawDate ? toIsoDay(rawDate) : '';
    setCashRequestDrafts((prev) => ({
      ...prev,
      [partner.id]: { amount: rawAmount, date: rawDate, saving: true },
    }));
    try {
      setShareholders((prev) =>
        prev.map((s) =>
          s.id === partner.id
            ? { ...s, payoutPreference: 'cash', nextPayoutDate: cleanDate || null, requestedPayoutAmount: parsedAmount }
            : s
        )
      );
      if (isApiMode()) {
        await api.updateShareholderPayoutPreference(partner.id, {
          payoutPreference: 'cash',
          nextPayoutDate: cleanDate || null,
          requestedPayoutAmount: parsedAmount,
        });
      } else {
        await updateShareholder(partner.id, {
          ...partner,
          payoutPreference: 'cash',
          nextPayoutDate: cleanDate || null,
          requestedPayoutAmount: parsedAmount,
        });
      }
      showToast(
        `تم حفظ طلب الصرف النقدي لـ ${partner.name}${parsedAmount ? ` بمبلغ ${formatCurrency(parsedAmount)}` : ''}${cleanDate ? ` بتاريخ ${formatDateDisplay(cleanDate)}` : ''}`,
        'success'
      );
      setEditingCashRequest((prev) => ({ ...prev, [partner.id]: false }));
      await loadData();
    } catch (err: any) {
      showToast(err?.message || 'تعذر حفظ بيانات طلب الصرف النقدي', 'error');
      await loadData();
    } finally {
      setCashRequestDrafts((prev) => ({
        ...prev,
        [partner.id]: { amount: rawAmount, date: rawDate, saving: false },
      }));
    }
  };

  const handleGlobalCycleChange = async (nextCycle: number) => {
    if (!canManageShareholders || ![1, 3, 6, 12].includes(nextCycle) || liveShareholders.length === 0) return;
    const nextDateForPartner = (s: any) =>
      s.payoutPreference === 'cash' && s.nextPayoutDate
        ? s.nextPayoutDate
        : computeNextFutureCycleDate(s.joinedDate || s.createdAt, nextCycle);
    try {
      setShareholders((prev) =>
        prev.map((s) => ({
          ...s,
          payoutCycleMonths: nextCycle,
          nextPayoutDate: nextDateForPartner(s),
        }))
      );
      if (isApiMode()) {
        await Promise.all(
          liveShareholders.map((s: any) =>
            api.updateShareholderPayoutPreference(s.id, {
              payoutPreference: s.payoutPreference === 'cash' ? 'cash' : 'capitalize',
              payoutCycleMonths: nextCycle,
              nextPayoutDate: nextDateForPartner(s),
            })
          )
        );
      } else {
        for (const s of liveShareholders) {
          await updateShareholder(s.id, {
            ...s,
            payoutCycleMonths: nextCycle,
            nextPayoutDate: nextDateForPartner(s),
          });
        }
      }
      const cycleLabel =
        nextCycle === 1
          ? 'كل نهاية شهر'
          : nextCycle === 3
            ? 'كل 3 شهور (نهاية الشهر)'
            : nextCycle === 6
              ? 'كل 6 شهور (نهاية الشهر)'
              : 'كل سنة (نهاية السنة)';
      showToast(`تم ضبط الرسملة التلقائية لجميع الشركاء: ${cycleLabel}`, 'success');
      await loadData();
    } catch (err: any) {
      showToast(err?.message || 'تعذر تحديث مدة الرسملة التلقائية', 'error');
      await loadData();
    }
  };

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

  const visibleFounders = useMemo(
    () => visibleShareholders.filter((s: any) => Boolean(s.isFounder)),
    [visibleShareholders]
  );

  const visibleInvestors = useMemo(
    () => visibleShareholders.filter((s: any) => !s.isFounder),
    [visibleShareholders]
  );

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

  const estimatedFounderSharePct = useMemo(() => {
    const otherFounders = liveShareholders.filter(
      (s: any) => Boolean(s.isFounder) && s.id !== editingShareholder?.id
    );
    const otherFoundersCap = otherFounders.reduce(
      (sum: number, s: any) => sum + Math.max(0, Number(s.capital || 0)),
      0
    );
    const enteredCap = Math.max(0, Number(shareholderForm.capital || 0));
    const totalWithNew = otherFoundersCap + enteredCap;
    if (totalWithNew > 0) {
      return Number(((enteredCap / totalWithNew) * 100).toFixed(2));
    }
    return otherFounders.length === 0 ? 100 : Number((100 / (otherFounders.length + 1)).toFixed(2));
  }, [liveShareholders, editingShareholder, shareholderForm.capital]);

  const [isSavingShareholder, setIsSavingShareholder] = useState(false);
  const [isSavingTransaction, setIsSavingTransaction] = useState(false);

  const handleShareholderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingShareholder) return;
    setIsSavingShareholder(true);
    try {
      const isFounder = Boolean(shareholderForm.isFounder);
      const sharePercentage = isFounder
        ? estimatedFounderSharePct || 100
        : Number(shareholderForm.sharePercentage || 0);
      const managementFeePercentage = isFounder
        ? 0
        : Number(shareholderForm.managementFeePercentage || Math.max(0, 100 - sharePercentage));

      if (!isFounder && (sharePercentage <= 0 || sharePercentage > 100)) {
        showToast('الرجاء إدخال نسبة ربح صحيحة للمساهم بين 1% و 100%.', 'warning');
        return;
      }

      const finalForm = {
        ...shareholderForm,
        isFounder,
        includeWarehouseProfit: isFounder ? true : Boolean(shareholderForm.includeWarehouseProfit),
        sharePercentage,
        managementFeePercentage,
        affectsTreasury: Boolean(shareholderForm.affectsTreasury),
        isOpeningBalance: !shareholderForm.affectsTreasury,
        channel: shareholderForm.channel,
      };

      if (!editingShareholder) {
        const cap = Number(shareholderForm.capital || 0);
        if (!cap || cap <= 0) {
          showToast('الرجاء إدخال رأس المال الأساسي للشريك ويجب أن يكون أكبر من صفر.', 'warning');
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
          capital: shareholderForm.capital !== undefined && String(shareholderForm.capital) !== ''
            ? Number(shareholderForm.capital)
            : Number(editingShareholder.capital || 0),
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
      showToast(err?.message || 'حدث خطأ أثناء حفظ بيانات الشريك.', 'error');
    } finally {
      setIsSavingShareholder(false);
    }
  };

  const handleTransactionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingTransaction) return;
    if (!selectedShareholderId || transactionForm.amount <= 0) return;
    const selectedPartner: any = liveShareholders.find((s: any) => s.id === selectedShareholderId);
    if (!selectedPartner) return;

    const realizedAvailable = Number(selectedPartner.realizedAvailableProfit ?? selectedPartner.availableProfit ?? 0);
    const accrualAvailable = Number(selectedPartner.accrualAvailableProfit ?? realizedAvailable);
    const deferredProfit = Math.max(0, Number((accrualAvailable - realizedAvailable).toFixed(2)));
    const capital = Number(selectedPartner.capital || 0);
    const requestedAmount = Number(transactionForm.amount || 0);

    // Strict separation between Profit Withdrawal and Capital Withdrawal
    if (transactionType === 'profit_withdrawal') {
      if (realizedAvailable <= 0) {
        showToast(
          deferredProfit > 0
            ? `لا توجد أرباح محققة متاحة للسحب حالياً (يوجد ${formatCurrency(deferredProfit)} أرباح بيع مؤجلة لحين تحصيل الأقساط).`
            : 'لا توجد أرباح متاحة للسحب لهذا الشريك حالياً.',
          'warning',
        );
        return;
      }
      if (requestedAmount > realizedAvailable + 0.01) {
        showToast(
          `المبلغ المطلوب (${formatCurrency(requestedAmount)}) أكبر من الأرباح المحققة المتاحة للسحب من الأقساط (${formatCurrency(realizedAvailable)}). باقي أرباح البيع مؤجلة لحين التحصيل.`,
          'warning',
        );
        return;
      }
    } else if (transactionType === 'capital_withdrawal') {
      if (requestedAmount > capital + 0.01) {
        showToast(
          `المبلغ المطلوب سحبه من رأس المال (${formatCurrency(requestedAmount)}) أكبر من رأس المال الفعلي للشريك (${formatCurrency(capital)}). لسحب الأرباح يرجى استخدام زر "سحب أرباح".`,
          'warning',
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
      date: transactionForm.date || localTodayIso(),
      description: transactionForm.description.trim() || defaultDesc,
      affectsTreasury: transactionForm.affectsTreasury !== false,
      channel: transactionForm.channel,
      createdBy: user?.name || 'النظام',
    };

    setIsSavingTransaction(true);
    try {
      if (isApiMode()) {
        await api.createShareholderTransaction(txPayload);
      } else {
        await addShareholderTransaction(txPayload);
      }
      await loadData();
      setShowTransactionModal(false);
      setTransactionForm({ amount: 0, date: localTodayIso(), description: '', affectsTreasury: true, channel: 'cash' });
    } catch (err: any) {
      showToast(err?.message || 'حدث خطأ أثناء تنفيذ الحركة المالية.', 'error');
    } finally {
      setIsSavingTransaction(false);
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
      date: localTodayIso(),
      description: '',
      affectsTreasury: true,
      channel: 'cash',
    });
    setShowTransactionModal(true);
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
          <td><strong>${escapeHtml(s.name)}</strong><br/><span style="font-size:10px;color:#475569;">${s.isFounder ? 'شريك مؤسس' : 'مساهم بالتمويل'}</span></td>
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
  <title>التقرير المحاسبي لتوزيع أرباح الشركاء والمساهمين - ${escapeHtml(settings.companyName || 'شركة المتحدة')}</title>
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
        <th>المتاح للصرف</th>
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

  const renderPartnerCard = (shareholder: any) => {
    const isF = Boolean(shareholder.isFounder);
    const mgmtPct = Number(
      shareholder.managementFeePercentage ?? Math.max(0, 100 - Number(shareholder.sharePercentage || 0))
    );

    return (
      <div
        key={shareholder.id}
        className="bg-white rounded-2xl border border-slate-200/90 shadow-xs hover:shadow-md transition-all flex flex-col justify-between overflow-hidden"
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
                {!isF && (
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-black/20 text-white/95 border border-white/15">
                    {shareholder.includeWarehouseProfit ? 'تقسيط + مخزن' : 'أرباح التقسيط فقط'}
                  </span>
                )}
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
              {canManageShareholders && (
                <button
                  type="button"
                  onClick={() => {
                    const jDate = toIsoDay(shareholder.joinedDate || shareholder.createdAt);
                    const cycle = Number(shareholder.payoutCycleMonths ?? 1);
                    const noticeDays = Number(shareholder.payoutNoticeDays ?? 15);
                    setEditingShareholder(shareholder);
                    setShareholderForm({
                      name: shareholder.name,
                      phone: shareholder.phone,
                      isFounder: isF,
                      includeWarehouseProfit: isF ? true : Boolean(shareholder.includeWarehouseProfit),
                      payoutPreference: (shareholder.payoutPreference === 'cash' ? 'cash' : 'capitalize') as 'cash' | 'capitalize' | 'ask',
                      payoutCycleMonths: cycle || 1,
                      payoutNoticeDays: noticeDays,
                      nextPayoutDate: shareholder.nextPayoutDate ? toIsoDay(shareholder.nextPayoutDate) : computeNextFutureCycleDate(jDate, cycle || 1),
                      sharePercentage: shareholder.sharePercentage || 0,
                      managementFeePercentage: isF ? 0 : (shareholder.managementFeePercentage ?? 50),
                      capital: shareholder.capital,
                      joinedDate: jDate,
                      notes: shareholder.notes || '',
                      affectsTreasury: true,
                      channel: 'cash',
                    });
                    setShowShareholderModal(true);
                  }}
                  className="p-1.5 text-white/75 hover:text-white hover:bg-white/15 rounded-lg transition-colors cursor-pointer"
                  title="تعديل بيانات الشريك / تاريخ الانضمام"
                >
                  <Edit size={13} />
                </button>
              )}
              {isUserAdmin && (
                <button
                  type="button"
                  onClick={() => handleDeleteShareholder(shareholder.id, shareholder.name)}
                  className="p-1.5 text-white/75 hover:text-rose-200 hover:bg-rose-500/25 rounded-lg transition-colors cursor-pointer"
                  title="حذف الشريك"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          </div>

          {/* Card Body */}
          <div className="p-4 pb-3 space-y-2.5">
            {/* 3 Clean Metric Pillars */}
            <div className="grid grid-cols-3 divide-x divide-x-reverse divide-slate-200/80 bg-slate-50/70 rounded-xl border border-slate-200/80 py-2.5 px-1 text-center">
              <div className="px-1.5 min-w-0">
                <span className="text-[10px] font-semibold text-slate-500 block leading-tight">
                  {isF ? 'رأس المال' : 'مبلغ التمويل'}
                </span>
                <span className="text-xs sm:text-sm font-black text-slate-900 block mt-1">
                  <CurrencyText value={formatCurrency(shareholder.capital)} />
                </span>
              </div>
              <div className="px-1.5 min-w-0">
                <span className="text-[10px] font-semibold text-slate-500 block leading-tight">
                  أرباح البيع
                </span>
                <span className="text-xs sm:text-sm font-black text-emerald-700 block mt-1">
                  <CurrencyText value={`+${formatCurrency(shareholder.accrualAvailableProfit ?? shareholder.availableProfit)}`} />
                </span>
              </div>
              <div className="px-1.5 min-w-0">
                <span className="text-[10px] font-semibold text-slate-500 block leading-tight">
                  إجمالي المستحق
                </span>
                <span className="text-xs sm:text-sm font-black text-[#0f1f4a] block mt-1">
                  <CurrencyText
                    value={formatCurrency(
                      Number(shareholder.capital || 0) +
                        Number(shareholder.accrualAvailableProfit ?? shareholder.availableProfit ?? 0),
                    )}
                  />
                </span>
              </div>
            </div>

            {/* 1 Concise Secondary Row */}
            <div className="flex items-center justify-between gap-2 text-[11px] px-1 text-slate-500 font-medium">
              <span className="truncate">
                متاح للسحب الآن:{' '}
                <strong className="text-emerald-700 tabular-nums">
                  +{formatNumberOnly(shareholder.realizedAvailableProfit ?? shareholder.availableProfit)}
                </strong>
              </span>
              <span className="truncate">
                تم صرفه:{' '}
                <strong
                  className={`tabular-nums ${
                    Number(shareholder.totalWithdrawnProfits) > 0 ? 'text-amber-700' : 'text-slate-700'
                  }`}
                >
                  {Math.round(Number(shareholder.totalWithdrawnProfits || 0)) > 0
                    ? `-${formatNumberOnly(shareholder.totalWithdrawnProfits)}`
                    : '0'}
                </strong>
              </span>
            </div>

            {/* Silent Investor Financing Return / Mgmt Fee Strip */}
            {!isF && (
              <div className="text-[10px] px-2.5 py-1.5 rounded-lg bg-slate-100/80 text-slate-600 flex items-center justify-between gap-2">
                <span className="truncate">
                  عائد التمويل: <strong className="text-slate-800 tabular-nums">{formatNumberOnly(shareholder.grossProfit || 0)}</strong>
                </span>
                <span className="truncate">
                  حصة الإدارة (%{mgmtPct}): <strong className="text-slate-800 tabular-nums">{formatNumberOnly(shareholder.mgmtFee || 0)}</strong>
                </span>
              </div>
            )}

            {/* Simple Auto-Rollover Toggle + Inline Cash Date + WhatsApp */}
            {(() => {
              const pref = shareholder.payoutPreference === 'cash' ? 'cash' : 'capitalize';
              return (
                <div
                  className={`rounded-xl border p-2 space-y-1.5 ${
                    pref === 'cash'
                      ? 'border-amber-200 bg-amber-50/50'
                      : 'border-slate-200/80 bg-slate-50/70'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1.5 text-[10px]">
                    <span
                      className={`inline-flex items-center gap-1 font-bold min-w-0 ${
                        pref === 'cash' ? 'text-amber-700' : 'text-indigo-700'
                      }`}
                    >
                      <CalendarClock size={11} className="shrink-0" />
                      <span className="truncate">
                        {pref === 'cash'
                          ? (shareholder.requestedPayoutAmount || shareholder.nextPayoutDate
                              ? `طلب صرف نقدي${shareholder.requestedPayoutAmount ? `: ${formatCurrency(shareholder.requestedPayoutAmount)}` : ''}${shareholder.nextPayoutDate ? ` — يوم ${formatDateDisplay(shareholder.nextPayoutDate)}` : ''}`
                              : 'مجدول للصرف النقدي')
                          : shareholder.nextPayoutDate
                            ? `تُرسمل تلقائياً يوم: ${formatDateDisplay(shareholder.nextPayoutDate)}`
                            : 'رسملة تلقائية حسب الدورة'}
                      </span>
                    </span>
                  </div>
                  {canManageShareholders && (
                    <div className="grid grid-cols-2 gap-1 bg-white p-0.5 rounded-lg border border-slate-200/80">
                      <button
                        type="button"
                        onClick={() => handleQuickPayoutPreference(shareholder, 'capitalize')}
                        className={`py-1 rounded-md text-[10px] font-bold transition-all cursor-pointer ${
                          pref === 'capitalize'
                            ? 'bg-indigo-600 text-white shadow-2xs'
                            : 'text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        رسملة تلقائية
                      </button>
                      <button
                        type="button"
                        onClick={() => handleQuickPayoutPreference(shareholder, 'cash')}
                        className={`py-1 rounded-md text-[10px] font-bold transition-all cursor-pointer ${
                          pref === 'cash'
                            ? 'bg-amber-500 text-white shadow-2xs'
                            : 'text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        طلب صرف نقدي
                      </button>
                    </div>
                  )}
                  {pref === 'cash' && (() => {
                    const draft = cashRequestDrafts[shareholder.id];
                    const amountVal =
                      draft?.amount !== undefined
                        ? draft.amount
                        : shareholder.requestedPayoutAmount
                          ? String(shareholder.requestedPayoutAmount)
                          : '';
                    const dateVal =
                      draft?.date !== undefined
                        ? draft.date
                        : shareholder.nextPayoutDate || '';
                    const isSaving = Boolean(draft?.saving);
                    const hasSavedRequest = Boolean(shareholder.requestedPayoutAmount && Number(shareholder.requestedPayoutAmount) > 0);
                    const isEditing = editingCashRequest[shareholder.id] ?? !hasSavedRequest;
                    return (
                      <div className="pt-1.5 border-t border-amber-200/70 space-y-1.5">
                        {canManageShareholders && isEditing ? (
                          <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-1.5">
                            <div className="min-w-0">
                              <label className="block text-[9px] font-bold text-amber-800 mb-0.5">المبلغ المطلوب</label>
                              <input
                                type="number"
                                min="0"
                                step="1"
                                value={amountVal}
                                onChange={(e) =>
                                  setCashRequestDrafts((prev) => ({
                                    ...prev,
                                    [shareholder.id]: { amount: e.target.value, date: dateVal },
                                  }))
                                }
                                placeholder="المبلغ..."
                                className="w-full h-7 px-2 rounded-lg border border-amber-300 bg-white text-[11px] font-bold text-slate-900 outline-none focus:border-amber-500"
                              />
                            </div>
                            <div className="min-w-0">
                              <label className="block text-[9px] font-bold text-amber-800 mb-0.5">تاريخ الصرف</label>
                              <DatePicker
                                value={dateVal}
                                onChange={(val) =>
                                  setCashRequestDrafts((prev) => ({
                                    ...prev,
                                    [shareholder.id]: { amount: amountVal, date: val },
                                  }))
                                }
                                placeholder="اختر التاريخ"
                                className="w-full h-7 text-[11px] font-bold border-amber-300 bg-white"
                              />
                            </div>
                            <button
                              type="button"
                              disabled={isSaving}
                              onClick={() => handleSaveCashRequest(shareholder)}
                              className="h-7 px-2.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-bold transition-colors cursor-pointer disabled:opacity-50 shrink-0"
                            >
                              {isSaving ? '...' : 'حفظ'}
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-2.5 py-1.5 text-[10.5px]">
                            <div className="flex items-center gap-1.5 text-emerald-800 font-bold min-w-0">
                              <CheckCircle2 size={13} className="text-emerald-600 shrink-0" />
                              <span className="truncate">
                                محفوظ: {shareholder.requestedPayoutAmount ? formatCurrency(shareholder.requestedPayoutAmount) : 'غير محدد'}
                                {shareholder.nextPayoutDate ? ` — يوم ${formatDateDisplay(shareholder.nextPayoutDate)}` : ''}
                              </span>
                            </div>
                            {canManageShareholders && (
                              <button
                                type="button"
                                onClick={() => setEditingCashRequest((prev) => ({ ...prev, [shareholder.id]: true }))}
                                className="px-2 py-0.5 rounded-md bg-white hover:bg-emerald-100 text-emerald-800 border border-emerald-300 text-[10px] font-bold transition-colors cursor-pointer shrink-0"
                              >
                                تعديل
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              );
            })()}
          </div>
        </div>

        {/* Balanced 2x2 Action Footer */}
        <div className="px-3.5 py-2.5 border-t border-slate-200/70 bg-slate-50/50 space-y-1.5 mt-auto">
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => openTxModal(shareholder.id, 'profit_withdrawal')}
              className={`h-8 px-2.5 text-white rounded-lg text-xs font-bold shadow-2xs transition-all flex items-center justify-center gap-1 active:scale-95 cursor-pointer whitespace-nowrap ${
                isF ? 'bg-[#1e3a8a] hover:bg-[#0f1f4a]' : 'bg-[#0f766e] hover:bg-[#115e59]'
              }`}
            >
              <DollarSign size={13} />
              <span>{isF ? 'سحب أرباح' : 'صرف أرباح'}</span>
            </button>
            <button
              type="button"
              onClick={() => setInspectingPartnerId(shareholder.id)}
              className="h-8 px-2.5 bg-white hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-bold transition-all border border-slate-300/80 flex items-center justify-center gap-1 active:scale-95 cursor-pointer whitespace-nowrap"
              title="كشف الحساب التفصيلي"
            >
              <FileText size={13} />
              <span>كشف الحساب</span>
            </button>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => openTxModal(shareholder.id, 'capital_deposit')}
              className="h-8 px-2.5 bg-white hover:bg-slate-100 text-slate-700 rounded-lg text-[11px] font-bold transition-all border border-slate-300/80 flex items-center justify-center gap-1 active:scale-95 cursor-pointer whitespace-nowrap"
              title={isF ? 'زيادة رأس المال' : 'زيادة مبلغ التمويل'}
            >
              <ArrowDownToLine size={12} />
              <span>إيداع</span>
            </button>
            <button
              type="button"
              onClick={() => openTxModal(shareholder.id, 'capital_withdrawal')}
              className="h-8 px-2.5 bg-white hover:bg-rose-50 text-rose-700 rounded-lg text-[11px] font-bold transition-all border border-rose-200 flex items-center justify-center gap-1 active:scale-95 cursor-pointer whitespace-nowrap"
              title={isF ? 'سحب من رأس المال' : 'رد جزء أو كل مبلغ التمويل'}
            >
              <ArrowUpFromLine size={12} />
              <span>{isF ? 'سحب رأس مال' : 'سحب تمويل'}</span>
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full flex-1 min-h-0 space-y-2.5">
      {/* TIER 1: Single-Row Compact Action Header */}
      <section className="bg-white rounded-2xl px-4 py-2.5 border border-slate-200/90 shadow-2xs flex flex-wrap lg:flex-nowrap items-center justify-between gap-2.5 shrink-0">
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-8 h-8 rounded-xl bg-slate-100 border border-slate-200/80 flex items-center justify-center text-[#0f1f4a] shrink-0">
            <Landmark size={16} />
          </div>
          <h2 className="text-sm lg:text-base font-black text-slate-900 leading-tight whitespace-nowrap">
            الشركاء والمساهمين
          </h2>
        </div>

        {/* Action Controls & View Switcher */}
        <div className="flex flex-wrap lg:flex-nowrap items-center gap-1.5 flex-1 justify-end min-w-0">
          {/* Compact Search Input */}
          <div className="relative w-36 sm:w-44 max-w-[170px] shrink">
            <Search size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="بحث باسم الشريك..."
              className="input-ui h-8 w-full pr-8 pl-2 text-xs bg-slate-50/70 border-slate-200 focus:bg-white"
            />
          </div>

          {/* 3 Clean Tabs */}
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
              <Users size={12} className={activeTab === 'overview' ? 'text-[#1e40af]' : ''} />
              <span>الشركاء ({liveShareholders.length})</span>
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
              <span>سجل الحركات ({displayedTransactions.length})</span>
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
              <span>ملخص الأرباح</span>
            </button>
          </div>

          {/* Icon-Only Refresh Button */}
          <button
            type="button"
            onClick={loadData}
            disabled={isLoading}
            className="h-8 w-8 flex items-center justify-center bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-xl text-xs font-bold transition-all active:scale-95 disabled:opacity-50 cursor-pointer shrink-0"
            title={`تحديث • آخر مزامنة: ${lastSynced.toLocaleTimeString('ar-EG')}`}
            aria-label="تحديث"
          >
            <RefreshCw size={13} className={isLoading ? 'animate-spin text-[#1e40af]' : ''} />
          </button>

          {canManageShareholders && (
            <button
              type="button"
              onClick={() => {
                const defaultFounder = liveShareholders.filter((s: any) => Boolean(s.isFounder)).length === 0;
                const todayIso = localTodayIso();
                const defaultCycle = payoutPlanSummary.currentCycleMonths || 1;
                setEditingShareholder(null);
                setShareholderForm({
                  name: '',
                  phone: '',
                  isFounder: defaultFounder,
                  includeWarehouseProfit: false,
                  payoutPreference: 'capitalize',
                  payoutCycleMonths: defaultCycle,
                  payoutNoticeDays: 15,
                  nextPayoutDate: computeNextFutureCycleDate(todayIso, defaultCycle),
                  sharePercentage: defaultFounder ? 100 : 20,
                  managementFeePercentage: defaultFounder ? 0 : 80,
                  capital: 0,
                  joinedDate: todayIso,
                  notes: '',
                  affectsTreasury: true,
                  channel: 'cash',
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

      {/* TIER 2: 4 Honest Financial KPI Cards */}
      <section className="grid grid-cols-1 sm:grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3 shrink-0">
        {/* KPI 1: Total Capital */}
        <div className="bg-gradient-to-br from-[#f8fafc] via-white to-white rounded-xl px-4 py-3 border border-slate-200/90 shadow-xs flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <span className="text-[11px] font-bold text-slate-600 block">إجمالي رأس المال</span>
            <span className="text-xl font-black text-slate-900 block leading-tight mt-0.5">
              <CurrencyText value={formatCurrency(totalCapital)} />
            </span>
            <div className="text-[10px] text-slate-500 mt-1 font-medium leading-snug flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <span className="whitespace-nowrap">مؤسسون: {formatNumberOnly(foundersSummary.foundersCapital)}</span>
              <span className="text-slate-300">•</span>
              <span className="whitespace-nowrap">مساهمون: {formatNumberOnly(foundersSummary.investorsCapital)}</span>
            </div>
          </div>
          <div className="w-9 h-9 bg-slate-500/10 rounded-xl flex items-center justify-center text-slate-700 shrink-0">
            <Wallet size={16} />
          </div>
        </div>

        {/* KPI 2: Available Profits */}
        <div className="bg-gradient-to-br from-[#ecfdf5] via-[#f4fbf8] to-white rounded-xl px-4 py-3 border border-emerald-200/80 shadow-xs flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <span className="text-[11px] font-bold text-emerald-900 block">الأرباح المتاحة للصرف</span>
            <span className="text-xl font-black text-emerald-700 block leading-tight mt-0.5">
              <CurrencyText value={formatCurrency(totalAvailableProfits)} />
            </span>
            <span className="text-[10px] text-emerald-800/75 block mt-1 font-medium leading-snug truncate">
              صافي ربح الفترة: {formatNumberOnly(liveMetrics?.liveNetProfit || 0)}
            </span>
          </div>
          <div className="w-9 h-9 bg-emerald-600/10 rounded-xl flex items-center justify-center text-emerald-700 shrink-0">
            <DollarSign size={16} />
          </div>
        </div>

        {/* KPI 3: Total Withdrawn Profits */}
        <div className="bg-gradient-to-br from-[#fffbeb] via-[#fffdf5] to-white rounded-xl px-4 py-3 border border-amber-200/80 shadow-xs flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <span className="text-[11px] font-bold text-amber-900 block">إجمالي ما تم صرفه</span>
            <span className="text-xl font-black text-amber-700 block leading-tight mt-0.5">
              <CurrencyText value={formatCurrency(liveMetrics?.totalWithdrawnProfits || 0)} />
            </span>
            <span className="text-[10px] text-amber-800/75 block mt-1 font-medium leading-snug">
              مسحوبات أرباح سابقة
            </span>
          </div>
          <div className="w-9 h-9 bg-amber-500/10 rounded-xl flex items-center justify-center text-amber-700 shrink-0">
            <ArrowUpFromLine size={16} />
          </div>
        </div>

        {/* KPI 4: Total Gross Equity */}
        <div className="bg-gradient-to-br from-[#eef2ff] via-[#f6f8ff] to-white rounded-xl px-4 py-3 border border-indigo-200/70 shadow-xs flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <span className="text-[11px] font-bold text-slate-600 block">إجمالي حقوق الشركاء</span>
            <span className="text-xl font-black text-[#0f1f4a] block leading-tight mt-0.5">
              <CurrencyText value={formatCurrency(totalGrossEquity)} />
            </span>
            <div className="text-[10px] text-slate-500 mt-1 font-medium leading-snug flex flex-wrap items-center gap-x-1.5">
              <span>{foundersSummary.foundersCount} مؤسس (%{foundersSummary.rawFoundersShare})</span>
              <span className="text-slate-300">•</span>
              <span>{foundersSummary.investorsCount} مساهم</span>
            </div>
          </div>
          <div className="w-9 h-9 bg-[#1e3a8a]/10 rounded-xl flex items-center justify-center text-[#1e3a8a] shrink-0">
            <Users size={16} />
          </div>
        </div>
      </section>

      {/* TIER 3: Flexible & Contained Main Content Area */}
      {activeTab === 'overview' ? (
        <section className="flex-1 min-h-0 flex flex-col rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
          {liveShareholders.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
              <div className="w-14 h-14 rounded-2xl bg-blue-50 border border-blue-200/80 text-[#1e40af] flex items-center justify-center mb-3">
                <Users size={26} />
              </div>
              <h3 className="text-base font-black text-slate-900">
                لا يوجد شركاء أو مساهمون مسجلون حتى الآن
              </h3>
              <p className="text-xs text-slate-500 max-w-md mt-1.5 leading-relaxed">
                أضف الشركاء المؤسسين أو مساهمي التمويل لبدء متابعة رأس المال وحصص الأرباح المحققة بدقة، ويمكنك أيضاً ضبط الأرصدة المنقولة من{' '}
                <strong className="text-slate-700">الإعدادات ← الأرصدة الافتتاحية</strong>.
              </p>
              {canManageShareholders && (
                <button
                  type="button"
                  onClick={() => {
                    const todayIso = localTodayIso();
                    const defaultCycle = payoutPlanSummary.currentCycleMonths || 1;
                    setEditingShareholder(null);
                    setShareholderForm({
                      name: '',
                      phone: '',
                      isFounder: true,
                      includeWarehouseProfit: false,
                      payoutPreference: 'capitalize',
                      payoutCycleMonths: defaultCycle,
                      payoutNoticeDays: 15,
                      nextPayoutDate: computeNextFutureCycleDate(todayIso, defaultCycle),
                      sharePercentage: 100,
                      managementFeePercentage: 0,
                      capital: 0,
                      joinedDate: todayIso,
                      notes: '',
                      affectsTreasury: true,
                      channel: 'cash',
                    });
                    setShowShareholderModal(true);
                  }}
                  className="mt-4 h-9 inline-flex items-center gap-1.5 bg-[#1e40af] hover:bg-[#1d4ed8] text-white px-4 rounded-xl text-xs font-bold shadow-xs active:scale-95 cursor-pointer"
                >
                  <Plus size={15} />
                  <span>إضافة أول شريك</span>
                </button>
              )}
            </div>
          ) : visibleShareholders.length === 0 ? (
            <div className="py-16 text-center text-slate-400">
              <Users size={40} className="mx-auto mb-2 text-slate-300" />
              <p className="text-sm font-bold text-slate-600">لا يوجد شركاء أو مساهمون مطابقون للبحث</p>
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto p-4 bg-[#eef2f6] space-y-5">
              {liveMetrics?.accountantReport &&
                Number(liveMetrics.accountantReport.totalOverDistributedDelta || 0) > 0.05 && (
                  <div className="bg-rose-50 border border-rose-200 rounded-xl px-3.5 py-2.5 flex items-start gap-2.5 text-xs text-rose-900 shadow-2xs">
                    <AlertTriangle size={16} className="text-rose-600 shrink-0 mt-0.5" />
                    <div className="leading-relaxed">
                      <strong className="font-black">تنبيه:</strong> يوجد أرباح موزعة مسبقاً تزيد بمقدار{' '}
                      <strong className="font-mono">{formatCurrency(liveMetrics.accountantReport.totalOverDistributedDelta)}</strong> عن الأرباح المحققة حالياً.
                    </div>
                  </div>
                )}

              {/* Simple Auto-Capitalization Cycle & Liquidity Strip */}
              <div className="bg-white border border-slate-200/90 rounded-2xl p-3.5 shadow-2xs space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2">
                    <CalendarClock size={16} className="text-[#1e40af] shrink-0" />
                    <div>
                      <h3 className="text-xs font-black text-slate-900">
                        الرسملة التلقائية للأرباح
                      </h3>
                      <p className="text-[10.5px] text-slate-500">
                        تُضاف الأرباح المحققة لرأس المال تلقائياً في موعدها، إلا إذا اخترت للشريك «طلب صرف نقدي».
                      </p>
                    </div>
                  </div>
                  <label className="inline-flex items-center gap-1.5 bg-slate-100/90 border border-slate-200 rounded-xl px-2.5 py-1 text-xs font-bold text-slate-700">
                    <span>تتم كل:</span>
                    <select
                      value={payoutPlanSummary.currentCycleMonths}
                      disabled={!canManageShareholders || liveShareholders.length === 0}
                      onChange={(e) => handleGlobalCycleChange(Number(e.target.value))}
                      className="bg-white border border-slate-200 rounded-lg h-7 px-2 text-xs font-black text-[#1e40af] cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#1e40af] disabled:opacity-60"
                    >
                      <option value={1}>كل نهاية شهر</option>
                      <option value={3}>كل 3 شهور (نهاية الشهر)</option>
                      <option value={6}>كل 6 شهور (نهاية الشهر)</option>
                      <option value={12}>كل سنة (نهاية السنة)</option>
                    </select>
                  </label>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-2.5 text-xs">
                  <div className="rounded-xl border border-indigo-200/80 bg-indigo-50/70 px-3.5 py-2 flex items-center justify-between gap-2 min-w-0">
                    <div className="min-w-0">
                      <span className="text-[11px] font-bold text-indigo-900 block">تُضاف لرأس المال تلقائياً</span>
                      <span className="text-[10px] text-indigo-700/80">{payoutPlanSummary.capitalizeCount} شريك/مساهم</span>
                    </div>
                    <strong className="text-sm font-black text-indigo-800 max-w-[48%] text-left">
                      <CurrencyText value={formatCurrency(payoutPlanSummary.capitalizeAmount)} />
                    </strong>
                  </div>
                  <div className="rounded-xl border border-amber-200/80 bg-amber-50/70 px-3.5 py-2 flex items-center justify-between gap-2 min-w-0">
                    <div className="min-w-0">
                      <span className="text-[11px] font-bold text-amber-900 block">مطلوب تجهيزه للصرف النقدي</span>
                      <span className="text-[10px] text-amber-700/80">{payoutPlanSummary.cashReadyCount} شريك/مساهم</span>
                    </div>
                    <strong className="text-sm font-black text-amber-800 max-w-[48%] text-left">
                      <CurrencyText value={formatCurrency(payoutPlanSummary.cashReadyAmount)} />
                    </strong>
                  </div>
                </div>
              </div>

              {/* Section 1: Founding Partners */}
              {visibleFounders.length > 0 && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#1e3a8a]" />
                      <h3 className="text-sm font-black text-[#0f1f4a]">
                        الشركاء المؤسسون ({visibleFounders.length})
                      </h3>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] font-bold">
                      <span className="px-2.5 py-0.5 rounded-lg bg-white border border-slate-200 text-slate-700">
                        رأس المال: {formatCurrency(foundersSummary.foundersCapital)}
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-[repeat(auto-fit,minmax(310px,1fr))] gap-4">
                    {visibleFounders.map(renderPartnerCard)}
                  </div>
                </div>
              )}

              {/* Section 2: Silent Financing Investors */}
              {visibleInvestors.length > 0 && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#0f766e]" />
                      <h3 className="text-sm font-black text-[#115e59]">
                        مساهمو التمويل ({visibleInvestors.length})
                      </h3>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] font-bold">
                      <span className="px-2.5 py-0.5 rounded-lg bg-white border border-slate-200 text-slate-700">
                        إجمالي التمويل: {formatCurrency(foundersSummary.investorsCapital)}
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-[repeat(auto-fit,minmax(310px,1fr))] gap-4">
                    {visibleInvestors.map(renderPartnerCard)}
                  </div>
                </div>
              )}
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
                الأرباح المتاحة للصرف: <strong className="text-emerald-700 font-extrabold">{formatCurrency(totalAvailableProfits)}</strong>
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
            <div className="flex-1 max-w-3xl grid grid-cols-1 sm:grid-cols-2 gap-3 items-center min-w-0">
              {/* Filter 1: تصفية الشريك والمساهم */}
              <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-200 shadow-2xs min-w-0">
                <Users size={14} className="text-blue-600 shrink-0" />
                <label className="text-xs font-bold text-slate-600 shrink-0 whitespace-nowrap">
                  الشريك / المساهم:
                </label>
                <select
                  value={ledgerPartnerFilter}
                  onChange={(e) => setLedgerPartnerFilter(e.target.value)}
                  className="flex-1 min-w-0 text-xs bg-transparent border-none font-bold text-slate-800 outline-none cursor-pointer"
                >
                  <option value="all">الكل ({liveShareholders.length})</option>
                  {liveShareholders.map((s: any) => (
                    <option key={s.id} value={s.id}>
                      {s.name} {s.isFounder ? '(شريك أساسي)' : '(مساهم تمويل)'}
                    </option>
                  ))}
                </select>
              </div>

              {/* Filter 2: أنواع الحركات */}
              <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-200 shadow-2xs min-w-0">
                <Filter size={14} className="text-blue-600 shrink-0" />
                <label className="text-xs font-bold text-slate-600 shrink-0 whitespace-nowrap">
                  أنواع الحركات:
                </label>
                <select
                  value={ledgerTypeFilter}
                  onChange={(e) => setLedgerTypeFilter(e.target.value)}
                  className="flex-1 min-w-0 text-xs bg-transparent border-none font-bold text-slate-800 outline-none cursor-pointer"
                >
                  <option value="all">كل الحركات</option>
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

          <div className="hidden md:block flex-1 min-h-0 overflow-y-auto overflow-x-auto">
            <table className="min-w-[820px] w-full border-collapse text-xs">
              <thead className="desktop-sticky-header">
                <tr>
                  <th className="py-2.5 px-3 text-right w-[10%] whitespace-nowrap">التاريخ</th>
                  <th className="py-2.5 px-3 text-right w-[16%] whitespace-nowrap">الشريك / المساهم</th>
                  <th className="py-2.5 px-3 text-right w-[14%] whitespace-nowrap">نوع الحركة</th>
                  <th className="py-2.5 px-3 text-right w-[14%] whitespace-nowrap">المبلغ</th>
                  <th className="py-2.5 px-3 text-right w-[12%] whitespace-nowrap" title="رأس المال بعد الحركة">رأس المال</th>
                  <th className="py-2.5 px-3 text-right w-[10%] whitespace-nowrap" title="الأرباح بعد الحركة">الأرباح</th>
                  <th className="py-2.5 px-3 text-right w-[18%] whitespace-nowrap">البيان</th>
                  <th className="py-2.5 px-3 text-center w-[6%] whitespace-nowrap">إجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {displayedTransactions.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-16 px-4 text-center text-slate-400">
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
                        <td className="py-2.5 px-3 text-[11px] font-mono text-slate-600 whitespace-nowrap">
                          {formatDateDisplay(tx.date)}
                        </td>
                        <td className="py-2.5 px-3 text-xs font-bold text-slate-900">
                          <button
                            type="button"
                            onClick={() => setInspectingPartnerId(tx.shareholderId)}
                            className="hover:text-indigo-600 text-right inline-flex items-center gap-1.5 group cursor-pointer max-w-full min-w-0"
                            title={`${partnerName} (${isFounder ? 'شريك أساسي' : 'مساهم تمويل'})`}
                          >
                            <span className="font-black group-hover:underline text-slate-900 group-hover:text-indigo-600 whitespace-nowrap">
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
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          {tx.type === 'capital_deposit' && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                              <ArrowDownToLine size={11} className="text-indigo-600 shrink-0" />
                              <span>إيداع رأس مال</span>
                            </span>
                          )}
                          {tx.type === 'capital_withdrawal' && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                              <ArrowUpFromLine size={11} className="text-rose-600 shrink-0" />
                              <span>سحب رأس مال</span>
                            </span>
                          )}
                          {tx.type === 'profit_distribution' && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <DollarSign size={11} className="text-emerald-600 shrink-0" />
                              <span>توزيع أرباح</span>
                            </span>
                          )}
                          {tx.type === 'profit_withdrawal' && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                              <Wallet size={11} className="text-amber-600 shrink-0" />
                              <span>صرف أرباح</span>
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-0.5 px-2.5 py-0.5 rounded-lg text-xs font-mono font-black tabular-nums border ${
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
                        <td className="py-2.5 px-3 text-xs font-bold text-slate-800 tabular-nums whitespace-nowrap font-mono">
                          {tx.runningCapital !== undefined ? formatCurrency(tx.runningCapital) : '-'}
                        </td>
                        <td className="py-2.5 px-3 text-xs font-bold text-emerald-700 tabular-nums whitespace-nowrap font-mono">
                          {tx.runningAvailableProfit !== undefined ? formatCurrency(tx.runningAvailableProfit) : '-'}
                        </td>
                        <td className="py-2.5 px-3 text-xs text-slate-700 leading-snug">
                          <span className="block break-words">{tx.description}</span>
                          <span className="block text-[10px] text-slate-400 mt-0.5">
                            بواسطة: {tx.createdBy || 'المدير العام'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-center whitespace-nowrap">
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
        /* TAB 3: Simplified Profits & Partners Distribution Summary */
        <section className="flex-1 min-h-0 flex flex-col rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
          {/* Control Strip: Realized Basis Indicator, Arabic DatePickers & Print */}
          <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2.5 shrink-0">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50/80 px-3 text-xs font-bold text-emerald-900">
                <ShieldCheck size={14} className="text-emerald-600 shrink-0" />
                <span>الأساس المعتمد: الأرباح المحصلة كاش</span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 bg-white px-2.5 py-1 rounded-xl border border-slate-200 text-xs">
                <span className="font-bold text-slate-500">من:</span>
                <DatePicker
                  value={reportPeriodFrom}
                  onChange={setReportPeriodFrom}
                  placeholder="يوم/شهر/سنة"
                  className="w-32 py-1 text-xs font-bold border-slate-200"
                />
                <span className="font-bold text-slate-400">إلى:</span>
                <DatePicker
                  value={reportPeriodTo}
                  onChange={setReportPeriodTo}
                  placeholder="يوم/شهر/سنة"
                  className="w-32 py-1 text-xs font-bold border-slate-200"
                />
                {(reportPeriodFrom || reportPeriodTo) && (
                  <button
                    type="button"
                    onClick={() => {
                      setReportPeriodFrom('');
                      setReportPeriodTo('');
                    }}
                    className="text-rose-600 hover:text-rose-700 font-bold text-[11px] px-1.5 cursor-pointer whitespace-nowrap"
                    title="عرض كل الفترات"
                  >
                    الكل
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePrintAccountantReport}
                className="h-8 flex items-center gap-1.5 bg-[#1e40af] hover:bg-[#1d4ed8] text-white px-3.5 rounded-xl text-xs font-bold transition-all shadow-xs active:scale-95 cursor-pointer whitespace-nowrap"
              >
                <Printer size={13} />
                <span>طباعة التقرير للمحاسب</span>
              </button>
            </div>
          </div>

          {/* Scrollable Summary Content */}
          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
            {!liveMetrics?.accountantReport ? (
              <div className="py-12 text-center text-slate-400 text-sm font-bold">
                التقرير المحاسبي التفصيلي متاح عند الاتصال بالسيرفر الرئيسي.
              </div>
            ) : (
              (() => {
                const rpt = liveMetrics.accountantReport;
                const hasEarlyDiscount = Math.abs(Number(rpt.totalEarlySettlementDiscounts || 0)) >= 0.01;
                const hasPreCapital = Math.abs(Number(rpt.preCapitalProfit || 0)) >= 0.01;
                const hasUnclaimedPool = Math.abs(Number(rpt.companyUnclaimedRetainedPool || 0)) >= 0.01;
                const showMgmtFeesRow =
                  Math.abs(Number(rpt.totalMgmtFees || 0)) >= 0.01 || foundersSummary.investorsCount > 0;

                return (
                  <>
                    {/* Calm Note if Pre-Join Profits Exist */}
                    {Number(rpt.totalOverDistributedDelta || 0) > 0.05 && (
                      <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 flex items-start gap-2.5 text-xs text-rose-900">
                        <AlertTriangle size={16} className="text-rose-600 shrink-0 mt-0.5" />
                        <div className="leading-relaxed">
                          <strong className="font-black">تنبيه:</strong> توجد توزيعات معتمدة مسبقاً تزيد بمقدار{' '}
                          <strong className="font-mono">{formatCurrency(rpt.totalOverDistributedDelta)}</strong> عن الأرباح المحققة حالياً.
                        </div>
                      </div>
                    )}

                    {/* Section 1 + 2 Side-by-Side: Income Bridge & Zero-Variance Reconciliation */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {/* Card A: Income & Realization Bridge */}
                      <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
                        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                          <h3 className="text-xs font-black text-[#0f1f4a] flex items-center gap-1.5">
                            <BarChart3 size={14} className="text-[#1e40af]" />
                            <span>1. ملخص أرباح الشركة (المحصّل مقابل المؤجل)</span>
                          </h3>
                          <span className="text-[10px] font-bold text-slate-500">
                            تحصيل: {formatCurrency(rpt.periodCashCollections ?? rpt.totalCollectedOnSales)} | متبقي: {formatCurrency(rpt.totalDeferredReceivables)}
                          </span>
                        </div>
                        <table className="w-full table-fixed text-xs">
                          <tbody className="divide-y divide-slate-100">
                            <tr>
                              <td className="py-2 px-3 text-slate-600 font-semibold">إجمالي عقود المبيعات</td>
                              <td className="py-2 px-3 w-[135px] text-left font-mono font-bold text-slate-900 whitespace-nowrap" dir="ltr">
                                {formatCurrency(rpt.totalContractGrossRevenue)}
                              </td>
                            </tr>
                            {hasEarlyDiscount && (
                              <tr>
                                <td className="py-2 px-3 text-slate-500">(-) خصومات السداد المبكر الممنوحة</td>
                                <td className="py-2 px-3 text-left font-mono font-bold text-rose-600 whitespace-nowrap" dir="ltr">
                                  -{formatCurrency(rpt.totalEarlySettlementDiscounts)}
                                </td>
                              </tr>
                            )}
                            <tr className="bg-slate-50/60">
                              <td className="py-2 px-3 text-slate-800 font-bold">(=) صافي المبيعات الفعلية</td>
                              <td className="py-2 px-3 text-left font-mono font-black text-slate-900 whitespace-nowrap" dir="ltr">
                                {formatCurrency(rpt.totalEffectiveRevenue)}
                              </td>
                            </tr>
                            <tr>
                              <td className="py-2 px-3 text-slate-600">
                                (-) تكلفة البضاعة وأصل العقود
                                <span className="block text-[10px] text-slate-400">
                                  بنود ({rpt.costedByItemsCount}): {formatCurrency(rpt.totalCogsFromItems)} • عقود ({rpt.costedBySubtotalFallbackCount}): {formatCurrency(rpt.totalCogsFromSubtotalFallback)}
                                </span>
                              </td>
                              <td className="py-2 px-3 text-left font-mono font-bold text-rose-600 whitespace-nowrap" dir="ltr">
                                -{formatCurrency(rpt.totalCogs)}
                              </td>
                            </tr>
                            <tr className="bg-blue-50/40">
                              <td className="py-2 px-3 text-slate-800 font-bold">(=) مجمل ربح العقود (قبل التحصيل)</td>
                              <td className="py-2 px-3 text-left font-mono font-black text-[#1e40af] whitespace-nowrap" dir="ltr">
                                {formatCurrency(rpt.accrualGrossProfit)}
                              </td>
                            </tr>
                            <tr>
                              <td className="py-2 px-3 text-amber-800 font-semibold">(-) أرباح مؤجلة بأقساط غير محصلة</td>
                              <td className="py-2 px-3 text-left font-mono font-bold text-amber-700 whitespace-nowrap" dir="ltr">
                                -{formatCurrency(rpt.deferredProfits)}
                              </td>
                            </tr>
                            {rpt.isFilteredPeriod && Number(rpt.realizedFromPriorSales || 0) !== 0 && (
                              <tr>
                                <td className="py-2 px-3 text-emerald-800 font-semibold">(+) أرباح محققة من تحصيل فواتير سابقة</td>
                                <td className="py-2 px-3 text-left font-mono font-bold text-emerald-700 whitespace-nowrap" dir="ltr">
                                  +{formatCurrency(rpt.realizedFromPriorSales)}
                                </td>
                              </tr>
                            )}
                            <tr className="bg-emerald-50/40">
                              <td className="py-2 px-3 text-emerald-900 font-bold">
                                (=) الأرباح المحققة نقداً (من {formatCurrency(rpt.periodCashCollections ?? rpt.totalCollectedOnSales)})
                                {Math.abs(Number(rpt.realizedWarehouseProfit || 0)) >= 0.01 && (
                                  <span className="block text-[10px] font-medium text-emerald-800/80 mt-0.5">
                                    فوائد تقسيط: {formatCurrency(rpt.realizedFinancingProfit || 0)} • أرباح مخزن: {formatCurrency(rpt.realizedWarehouseProfit || 0)}
                                  </span>
                                )}
                              </td>
                              <td className="py-2 px-3 text-left font-mono font-black text-emerald-700 whitespace-nowrap" dir="ltr">
                                {formatCurrency(rpt.realizedGrossProfit)}
                              </td>
                            </tr>
                            <tr>
                              <td className="py-2 px-3 text-slate-600">(-) المصروفات التشغيلية</td>
                              <td className="py-2 px-3 text-left font-mono font-bold text-rose-600 whitespace-nowrap" dir="ltr">
                                -{formatCurrency(rpt.totalExpenses)}
                              </td>
                            </tr>
                            <tr className="bg-[#0f1f4a]/[0.04]">
                              <td className="py-2.5 px-3 text-[#0f1f4a] font-black">(=) صافي الربح للتوزيع (المحصّل كاش)</td>
                              <td className="py-2.5 px-3 text-left font-mono font-black text-sm text-[#0f1f4a] whitespace-nowrap" dir="ltr">
                                {formatCurrency(rpt.selectedNetProfit)}
                              </td>
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
                            <span
                              className={`px-2 py-0.5 rounded-md text-[10px] font-bold border shrink-0 ${
                                rpt.isReconciled
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : 'bg-rose-50 text-rose-700 border-rose-200'
                              }`}
                            >
                              {rpt.isReconciled ? 'متطابق 100%' : 'يوجد فارق'}
                            </span>
                          </div>
                          <table className="w-full table-fixed text-xs">
                            <tbody className="divide-y divide-slate-100">
                              <tr>
                                <td className="py-2.5 px-3 text-slate-700 font-semibold">نصيب المساهمين بالتمويل (المستحق لهم)</td>
                                <td className="py-2.5 px-3 w-[135px] text-left font-mono font-bold text-[#1e40af] whitespace-nowrap" dir="ltr">
                                  {formatCurrency(rpt.totalInvestorsNet)}
                                </td>
                              </tr>
                              {showMgmtFeesRow && (
                                <tr>
                                  <td className="py-2.5 px-3 text-slate-500">
                                    حصة الإدارة المحصلة من عوائد المساهمين
                                    <span className="block text-[10px] text-slate-400">تُضاف تلقائياً لحصة أصحاب الشركة أدناه</span>
                                  </td>
                                  <td className="py-2.5 px-3 text-left font-mono font-bold text-slate-700 whitespace-nowrap" dir="ltr">
                                    {formatCurrency(rpt.totalMgmtFees)}
                                  </td>
                                </tr>
                              )}
                              <tr>
                                <td className="py-2.5 px-3 text-slate-700 font-semibold">نصيب أصحاب الشركة / الشركاء المؤسسين</td>
                                <td className="py-2.5 px-3 text-left font-mono font-bold text-emerald-700 whitespace-nowrap" dir="ltr">
                                  {formatCurrency(rpt.totalFoundersNet)}
                                </td>
                              </tr>
                              {hasPreCapital && (
                                <tr>
                                  <td className="py-2.5 px-3 text-amber-800">أرباح قبل تاريخ انضمام الشركاء المسجل</td>
                                  <td className="py-2.5 px-3 text-left font-mono font-bold text-amber-700 whitespace-nowrap" dir="ltr">
                                    {formatCurrency(rpt.preCapitalProfit)}
                                  </td>
                                </tr>
                              )}
                              {hasUnclaimedPool && (
                                <tr>
                                  <td className="py-2.5 px-3 text-slate-500">احتياطي غير مخصص (فترات بدون شريك مؤسس)</td>
                                  <td className="py-2.5 px-3 text-left font-mono font-bold text-slate-700 whitespace-nowrap" dir="ltr">
                                    {formatCurrency(rpt.companyUnclaimedRetainedPool)}
                                  </td>
                                </tr>
                              )}
                              <tr className="bg-blue-50/40">
                                <td className="py-2.5 px-3 text-slate-900 font-black">(=) إجمالي الموزع والمطابق</td>
                                <td className="py-2.5 px-3 text-left font-mono font-black text-slate-900 whitespace-nowrap" dir="ltr">
                                  {formatCurrency(rpt.allocatedSum)}
                                </td>
                              </tr>
                              <tr className="bg-emerald-50/40">
                                <td className="py-2.5 px-3 text-emerald-900 font-black">فارق المطابقة</td>
                                <td className="py-2.5 px-3 text-left font-mono font-black text-emerald-700 whitespace-nowrap" dir="ltr">
                                  {formatCurrency(rpt.reconciliationVariance)}
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                        <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 text-[11px] text-slate-500 leading-relaxed">
                          <strong>طريقة الحساب:</strong> كل مساهم يأخذ عائداً بنسبة أمواله من إجمالي رأس المال مضروبة في نسبته المتفق عليها، والباقي مع رسوم الإدارة يُقسم بين الشركاء المؤسسين حسب نسب الملكية بعد خصم المصروفات.
                        </div>
                      </div>
                    </div>

                    {/* Section 3: Clean 6-Column Partner Distribution Statement */}
                    <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
                      <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-xs font-black text-[#0f1f4a]">
                          3. نصيب كل شريك ومساهم
                        </h3>
                        <span className="text-[11px] font-bold text-slate-500">
                          عدد الشركاء: {liveShareholders.length}
                        </span>
                      </div>

                      {liveShareholders.length === 0 ? (
                        <div className="py-8 px-4 text-center text-xs text-slate-400 font-bold">
                          لا يوجد شركاء أو مساهمون مسجلون حالياً
                        </div>
                      ) : (
                        <>
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
                                  <span className="text-[10px] font-mono text-slate-500">
                                    من: {formatDateDisplay(s.joinedDate)}
                                  </span>
                                </div>
                                <div className="grid grid-cols-2 gap-2 bg-slate-50 rounded-lg p-2">
                                  <div>
                                    <span className="text-[10px] text-slate-400 block">رأس المال</span>
                                    <strong className="font-mono">{formatCurrency(s.capital)}</strong>
                                  </div>
                                  <div>
                                    <span className="text-[10px] text-slate-400 block">نصيب الفترة</span>
                                    <strong className="font-mono text-emerald-700">
                                      {formatCurrency(s.netEntitlement)} (%{s.sharePercentage})
                                    </strong>
                                  </div>
                                  <div>
                                    <span className="text-[10px] text-slate-400 block">المسحوبات</span>
                                    <strong className="font-mono text-amber-700">{formatWithdrawal(s.totalWithdrawnProfits)}</strong>
                                  </div>
                                  <div>
                                    <span className="text-[10px] text-slate-400 block">المتاح للصرف</span>
                                    <strong className="font-mono text-[#1e40af]">{formatCurrency(s.availableProfit)}</strong>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>

                          {/* Desktop 6-Column Fixed-Layout Table */}
                          <div className="hidden md:block overflow-x-hidden">
                            <table className="w-full table-fixed text-xs text-right border-collapse">
                              <thead className="bg-slate-50/90 border-b border-slate-200 text-slate-600 font-bold">
                                <tr>
                                  <th className="py-2.5 px-3 w-[24%] whitespace-nowrap">الشريك / المساهم</th>
                                  <th className="py-2.5 px-3 w-[16%] whitespace-nowrap">رأس المال</th>
                                  <th className="py-2.5 px-3 w-[16%] whitespace-nowrap">نصيب الفترة</th>
                                  <th className="py-2.5 px-3 w-[14%] whitespace-nowrap">حصة الإدارة</th>
                                  <th className="py-2.5 px-3 w-[14%] whitespace-nowrap">المسحوبات</th>
                                  <th className="py-2.5 px-3 w-[16%] whitespace-nowrap">المتاح للصرف</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {liveShareholders.map((s: any) => (
                                  <tr key={`rpt-${s.id}`} className="hover:bg-slate-50/70">
                                    <td className="py-2.5 px-3">
                                      <button
                                        type="button"
                                        onClick={() => setInspectingPartnerId(s.id)}
                                        className="font-black text-slate-900 hover:text-[#1e40af] block text-right cursor-pointer truncate max-w-full"
                                      >
                                        {s.name}
                                      </button>
                                      <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                                        <span
                                          className={`inline-block px-1.5 py-0.2 rounded text-[10px] font-bold border ${
                                            s.isFounder
                                              ? 'bg-[#0f1f4a]/[0.07] text-[#0f1f4a] border-[#0f1f4a]/15'
                                              : 'bg-blue-50 text-[#1e40af] border-blue-200'
                                          }`}
                                        >
                                          {s.isFounder ? 'شريك مؤسس' : 'مساهم'} (%{s.sharePercentage})
                                        </span>
                                        <span className="text-[10px] font-mono text-slate-400">
                                          {formatDateDisplay(s.joinedDate)}
                                        </span>
                                      </div>
                                    </td>
                                    <td className="py-2.5 px-3 font-mono font-bold text-slate-900 whitespace-nowrap">
                                      {formatCurrency(s.capital)}
                                    </td>
                                    <td className="py-2.5 px-3 font-mono font-black text-emerald-700 whitespace-nowrap">
                                      {formatCurrency(s.netEntitlement)}
                                    </td>
                                    <td className="py-2.5 px-3 font-mono text-slate-600 text-[11px] whitespace-nowrap">
                                      {s.isFounder ? '—' : `${formatCurrency(s.mgmtFee)} (%${s.managementFeePercentage})`}
                                    </td>
                                    <td className="py-2.5 px-3 font-mono text-amber-700 whitespace-nowrap">
                                      {formatWithdrawal(s.totalWithdrawnProfits)}
                                    </td>
                                    <td className="py-2.5 px-3 font-mono font-black text-[#1e40af] whitespace-nowrap">
                                      {formatCurrency(s.availableProfit)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </>
                      )}
                    </div>

                    {/* Section 4: Collapsible Technical Tranches Audit */}
                    <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
                      <button
                        type="button"
                        onClick={() => setShowTranchesDetails((v) => !v)}
                        className="w-full px-4 py-2.5 bg-slate-50 hover:bg-slate-100/80 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-2 text-right cursor-pointer transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <h3 className="text-xs font-black text-[#0f1f4a]">
                            4. تفاصيل الشرائح الزمنية وعائد الجنيه (للمحاسب) ({(rpt.tranches || []).length})
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
                                    <span className="font-black text-[#0f1f4a]">
                                      #{idx + 1} • {formatDateDisplay(tr.fromDate)} ← {formatDateDisplay(tr.toDate)}
                                    </span>
                                    <span className="text-[11px] font-mono text-slate-500">{tr.days} يوم</span>
                                  </div>
                                  <div className="grid grid-cols-2 gap-2 bg-slate-50 rounded-lg p-2">
                                    <div>
                                      <span className="text-[10px] text-slate-400 block">رأس المال العامل</span>
                                      <strong className="font-mono">{formatCurrency(tr.totalActiveCapital)}</strong>
                                    </div>
                                    <div>
                                      <span className="text-[10px] text-slate-400 block">عائد الجنيه</span>
                                      <strong className="font-mono text-[#1e40af]" dir="ltr">
                                        {Number(tr.roiPerEgp || 0).toFixed(4)} ({(Number(tr.roiPerEgp || 0) * 100).toFixed(2)}%)
                                      </strong>
                                    </div>
                                    <div>
                                      <span className="text-[10px] text-slate-400 block">صافي الشريحة</span>
                                      <strong className="font-mono text-slate-900">{formatCurrency(tr.netProfit)}</strong>
                                    </div>
                                    <div>
                                      <span className="text-[10px] text-slate-400 block">المساهمين / المؤسسين</span>
                                      <strong className="font-mono text-emerald-700">
                                        {formatCurrency(tr.investorsShare)} / {formatCurrency(tr.foundersShare)}
                                      </strong>
                                    </div>
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
                                      <td className="py-2 px-2 font-mono font-bold text-slate-900 text-[11px]">
                                        {formatCurrency(tr.totalActiveCapital)}
                                      </td>
                                      <td className="py-2 px-2 font-mono text-emerald-700 text-[11px]">
                                        {formatCurrency(tr.grossProfit)}
                                      </td>
                                      <td className="py-2 px-2 font-mono text-rose-600 text-[11px]">
                                        -{formatCurrency(tr.expenses)}
                                      </td>
                                      <td className="py-2 px-2 font-mono font-black text-[#0f1f4a] text-[11px]">
                                        {formatCurrency(tr.netProfit)}
                                      </td>
                                      <td className="py-2 px-2 font-mono font-black text-[#1e40af] text-[11px] leading-tight" dir="ltr">
                                        <span className="block">{Number(tr.roiPerEgp || 0).toFixed(4)}</span>
                                        <span className="block text-[10px] text-slate-500 font-bold">
                                          ({(Number(tr.roiPerEgp || 0) * 100).toFixed(2)}%)
                                        </span>
                                      </td>
                                      <td className="py-2 px-2 font-mono font-bold text-blue-700 text-[11px]">
                                        {formatCurrency(tr.investorsShare)}
                                      </td>
                                      <td className="py-2 px-2 font-mono font-bold text-emerald-700 text-[11px]">
                                        {formatCurrency(tr.foundersShare)}
                                      </td>
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
          <div className="bg-white rounded-2xl w-full max-w-6xl max-h-[88vh] shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
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

              {/* Card 4: Available Profits (Realized) */}
              <div className="p-3.5 rounded-xl bg-white border border-emerald-200 shadow-2xs flex items-center justify-between gap-2.5">
                <div className="min-w-0">
                  <span className="text-[11px] font-bold text-emerald-800 block mb-0.5 truncate">المتاح للسحب الآن (محقق)</span>
                  <span className="text-base md:text-lg font-black text-emerald-700 tabular-nums block leading-tight truncate">
                    {formatCurrency(inspectingPartner.realizedAvailableProfit ?? inspectingPartner.availableProfit)}
                  </span>
                  {Number(inspectingPartner.deferredProfit || 0) > 0 && (
                    <span className="text-[10px] font-bold text-indigo-700 block mt-0.5 truncate">
                      مؤجل تحت التحصيل: {formatCurrency(inspectingPartner.deferredProfit)}
                    </span>
                  )}
                </div>
                <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center shrink-0">
                  <DollarSign size={16} />
                </div>
              </div>
            </div>

            {/* Sales Profit vs Realized Profit vs Deferred Profit Breakdown */}
            <div className="px-4 py-2 bg-indigo-50/60 border-b border-indigo-100 shrink-0 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
              <div className="rounded-lg bg-white border border-indigo-100 px-3 py-1.5 flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold text-indigo-800">أرباح البيع (عند التعاقد)</span>
                <strong className="font-black text-indigo-900 tabular-nums">
                  {formatCurrency(inspectingPartner.accrualAvailableProfit ?? inspectingPartner.availableProfit)}
                </strong>
              </div>
              <div className="rounded-lg bg-white border border-emerald-100 px-3 py-1.5 flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold text-emerald-800">المتاح للسحب الآن (من الأقساط)</span>
                <strong className="font-black text-emerald-700 tabular-nums">
                  {formatCurrency(inspectingPartner.realizedAvailableProfit ?? inspectingPartner.availableProfit)}
                </strong>
              </div>
              <div className="rounded-lg bg-white border border-amber-100 px-3 py-1.5 flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold text-amber-800">أرباح مؤجلة (تحت التحصيل)</span>
                <strong className="font-black text-amber-700 tabular-nums">
                  {formatCurrency(inspectingPartner.deferredProfit || 0)}
                </strong>
              </div>
            </div>

            {/* Profit Composition Breakdown Bar (Direct Return vs. Management Fee) */}
            {(() => {
              const netEarned = Number(inspectingPartner.netEntitlement || 0);
              const mgmtBonus = Number(inspectingPartner.mgmtFeeEarned || 0);
              const ownProfit =
                inspectingPartner.ownCapitalProfit !== undefined
                  ? Number(inspectingPartner.ownCapitalProfit)
                  : Number((netEarned - mgmtBonus).toFixed(2));
              const mgmtDeducted = Number(inspectingPartner.mgmtFee || 0);
              const mgmtRatePct = Number(
                inspectingPartner.managementFeePercentage ??
                  Math.max(0, 100 - Number(inspectingPartner.sharePercentage || 0))
              );

              return (
                <div className="px-4 py-2.5 bg-white border-b border-slate-200/80 shrink-0">
                  {inspectingPartner.isFounder ? (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                      <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-1.5 flex items-center justify-between gap-2">
                        <span className="text-[11px] font-bold text-slate-600">ربح رأس المال المباشر</span>
                        <strong className="font-black text-slate-900 tabular-nums">
                          {formatCurrency(ownProfit)}
                        </strong>
                      </div>
                      <div className="rounded-lg border border-indigo-200 bg-indigo-50/70 px-3 py-1.5 flex items-center justify-between gap-2">
                        <span className="text-[11px] font-bold text-indigo-800">
                          + عائده من نسبة إدارة المساهمين ({inspectingPartner.sharePercentage}%)
                        </span>
                        <strong className="font-black text-indigo-700 tabular-nums">
                          +{formatCurrency(mgmtBonus)}
                        </strong>
                      </div>
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-1.5 flex items-center justify-between gap-2">
                        <span className="text-[11px] font-bold text-emerald-900">= إجمالي الأرباح المكتسبة</span>
                        <strong className="font-black text-emerald-700 tabular-nums">
                          {formatCurrency(netEarned)}
                        </strong>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                      <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-1.5 flex items-center justify-between gap-2">
                        <span className="text-[11px] font-bold text-slate-600">إجمالي ربح مبلغ التمويل</span>
                        <strong className="font-black text-slate-900 tabular-nums">
                          {formatCurrency(inspectingPartner.grossProfit || 0)}
                        </strong>
                      </div>
                      <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-1.5 flex items-center justify-between gap-2">
                        <span className="text-[11px] font-bold text-amber-800">
                          - خصم نسبة الإدارة للشركاء ({mgmtRatePct}%)
                        </span>
                        <strong className="font-black text-amber-700 tabular-nums">
                          -{formatCurrency(mgmtDeducted)}
                        </strong>
                      </div>
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-1.5 flex items-center justify-between gap-2">
                        <span className="text-[11px] font-bold text-emerald-900">
                          = صافي ربح المساهم ({inspectingPartner.sharePercentage}%)
                        </span>
                        <strong className="font-black text-emerald-700 tabular-nums">
                          {formatCurrency(netEarned)}
                        </strong>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

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

            <div className="hidden md:block flex-1 min-h-0 overflow-y-auto overflow-x-auto">
              <table className="w-full table-auto border-collapse text-xs">
                <thead className="desktop-sticky-header">
                  <tr>
                    <th className="py-2.5 px-3 text-right whitespace-nowrap">التاريخ</th>
                    <th className="py-2.5 px-3 text-right whitespace-nowrap">نوع القيد</th>
                    <th className="py-2.5 px-3 text-right min-w-[240px]">البيان والتفاصيل</th>
                    <th className="py-2.5 px-3 text-right whitespace-nowrap">حركة رأس المال</th>
                    <th className="py-2.5 px-3 text-right whitespace-nowrap">حركة الأرباح</th>
                    <th className="py-2.5 px-3 text-right whitespace-nowrap">رصيد رأس المال</th>
                    <th className="py-2.5 px-3 text-right whitespace-nowrap">رصيد الأرباح المتاحة</th>
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
                        <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                          {formatDateDisplay(entry.date)}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${
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
                        <td className="py-2.5 px-3 text-slate-700 font-medium leading-relaxed">
                          {entry.description}
                        </td>
                        <td
                          className={`py-2.5 px-3 font-bold tabular-nums text-right whitespace-nowrap ${
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
                          className={`py-2.5 px-3 font-bold tabular-nums text-right whitespace-nowrap ${
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
                        <td className="py-2.5 px-3 font-bold text-slate-900 tabular-nums text-right whitespace-nowrap">
                          {formatCurrency(entry.runningCapital)}
                        </td>
                        <td className="py-2.5 px-3 font-bold text-emerald-700 tabular-nums text-right whitespace-nowrap">
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
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl overflow-hidden border border-slate-200">
            <div className="p-5 border-b border-slate-100 bg-slate-50 flex items-center justify-between shrink-0">
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
            <form onSubmit={handleShareholderSubmit} className="flex-1 min-h-0 flex flex-col overflow-hidden">
              <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-3.5">
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
                    onChange={(e) => {
                      const nextJoined = e.target.value;
                      setShareholderForm({
                        ...shareholderForm,
                        joinedDate: nextJoined,
                        nextPayoutDate:
                          !editingShareholder && shareholderForm.payoutCycleMonths > 0
                            ? computeNextFutureCycleDate(nextJoined, shareholderForm.payoutCycleMonths)
                            : shareholderForm.nextPayoutDate,
                      });
                    }}
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
                        includeWarehouseProfit: isF ? true : false,
                        sharePercentage: isF ? 100 : 20,
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
                  <div className="p-3 bg-blue-50/90 border border-blue-200 rounded-xl space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                        <ShieldCheck size={15} className="text-blue-600 shrink-0" />
                        <span>نسبة الملكية المحسوبة تلقائياً:</span>
                      </span>
                      <span className="px-2.5 py-0.5 rounded-lg bg-[#1e40af] text-white font-black text-xs tabular-nums">
                        %{estimatedFounderSharePct}
                      </span>
                    </div>
                    <p className="text-[11px] text-blue-950/85 leading-relaxed">
                      تُحسب نسبة كل شريك مؤسس تلقائياً من رأس ماله بحيث يظل مجموع ملكية الشركاء المؤسسين 100% دائماً ولا يتأثر بمساهمي التمويل.
                    </p>
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
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-xs font-bold text-slate-800 block">المشاركة في أرباح المخزن</span>
                      <span className="text-[10.5px] text-slate-500 block leading-snug">
                        {shareholderForm.includeWarehouseProfit
                          ? 'يشارك في أرباح التقسيط + أرباح بيع بضاعة المخزن معاً'
                          : 'يشارك في أرباح التقسيط (الفوائد) فقط — لا يشارك في ربح بيع بضاعة المخزن'}
                      </span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer shrink-0">
                      <input
                        type="checkbox"
                        checked={Boolean(shareholderForm.includeWarehouseProfit)}
                        onChange={(e) =>
                          setShareholderForm({
                            ...shareholderForm,
                            includeWarehouseProfit: e.target.checked,
                          })
                        }
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-slate-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#0f766e]"></div>
                    </label>
                  </div>
                  <p className="text-[11px] text-purple-800 bg-purple-50 p-2 rounded-lg border border-purple-200 leading-relaxed">
                    مساهم بالتمويل فقط — لا يأخذ حصة من ملكية الشركاء المؤسسين (100%). يحصل على هذه النسبة من عائد تشغيل مبلغ تمويله فقط والباقي حصة إدارة للشركاء المؤسسين.
                  </p>
                </div>
              )}

              {/* Clear 2-Option Selector: Actual Treasury Cash Deposit vs Book Opening Balance */}
              {!editingShareholder && (
                <div className="space-y-2.5">
                  <label className="block text-xs font-bold text-slate-700">نوع تسجيل رأس المال</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setShareholderForm({ ...shareholderForm, affectsTreasury: true })}
                      className={`p-2.5 rounded-xl border text-right transition-all cursor-pointer ${
                        shareholderForm.affectsTreasury
                          ? 'bg-emerald-50 border-emerald-500 ring-1 ring-emerald-500/30 shadow-2xs'
                          : 'bg-white border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <span className="block text-xs font-black text-emerald-950">إيداع فعلي بالخزينة</span>
                      <span className="block text-[10px] text-emerald-700 mt-0.5 leading-snug">
                        أموال جديدة دخلت الخزينة اليوم (يُصدر سند قبض ويزيد رصيد الخزينة)
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShareholderForm({ ...shareholderForm, affectsTreasury: false })}
                      className={`p-2.5 rounded-xl border text-right transition-all cursor-pointer ${
                        !shareholderForm.affectsTreasury
                          ? 'bg-blue-50 border-[#1e40af] ring-1 ring-[#1e40af]/30 shadow-2xs'
                          : 'bg-white border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <span className="block text-xs font-black text-[#0f1f4a]">رصيد افتتاحي / قيد دفتري</span>
                      <span className="block text-[10px] text-slate-600 mt-0.5 leading-snug">
                        شريك قائم أو رصيد مرحّل من نظام قديم (لا يؤثر على رصيد الخزينة)
                      </span>
                    </button>
                  </div>
                  {shareholderForm.affectsTreasury && (
                    <PaymentChannelSelector
                      compact
                      label="خزنة إيداع رأس المال"
                      value={shareholderForm.channel}
                      onChange={(channel) => setShareholderForm({ ...shareholderForm, channel })}
                    />
                  )}
                </div>
              )}

              {/* Simplified Auto-Rollover & Cash Date Selection */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <CalendarClock size={14} className="text-[#1e40af]" />
                    <span>موعد الرسملة التلقائية أو الصرف</span>
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  {[
                    { id: 'capitalize', label: 'رسملة تلقائية (سياسة الشركة)', desc: 'تُضاف الأرباح المحققة لرأس المال تلقائياً حسب دورة الشركة' },
                    { id: 'cash', label: 'طلب صرف نقدي', desc: 'إيقاف الرسملة التلقائية وتحديد موعد الصرف' },
                  ].map((opt) => {
                    const isSelected = (shareholderForm.payoutPreference === 'cash' ? 'cash' : 'capitalize') === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          const nextPref = opt.id as 'cash' | 'capitalize';
                          const companyCycle = payoutPlanSummary.currentCycleMonths || 1;
                          setShareholderForm({
                            ...shareholderForm,
                            payoutPreference: nextPref,
                            payoutCycleMonths: companyCycle,
                            nextPayoutDate:
                              nextPref === 'capitalize'
                                ? computeNextFutureCycleDate(
                                    shareholderForm.joinedDate || localTodayIso(),
                                    companyCycle
                                  )
                                : shareholderForm.nextPayoutDate,
                          });
                        }}
                        className={`p-2.5 rounded-xl border text-right transition-all cursor-pointer ${
                          isSelected
                            ? opt.id === 'cash'
                              ? 'bg-amber-50/70 border-amber-500 ring-1 ring-amber-400/40 shadow-2xs'
                              : 'bg-indigo-50/60 border-[#1e40af] ring-1 ring-[#1e40af]/30 shadow-2xs'
                            : 'bg-white border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <span className="block text-xs font-black text-slate-900">{opt.label}</span>
                        <span className="block text-[10px] text-slate-500 mt-0.5 leading-snug">{opt.desc}</span>
                      </button>
                    );
                  })}
                </div>
                {shareholderForm.payoutPreference === 'cash' && (
                  <div>
                    <label className="block text-[11px] font-bold text-amber-800 mb-1">تاريخ الصرف المطلوب</label>
                    <DatePicker
                      value={shareholderForm.nextPayoutDate || ''}
                      onChange={(val) => setShareholderForm({ ...shareholderForm, nextPayoutDate: val })}
                      placeholder="يوم/شهر/سنة"
                      className="w-full h-9 text-xs font-bold border-amber-300 bg-white"
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">ملاحظات (اختياري)</label>
                <textarea
                  value={shareholderForm.notes}
                  onChange={(e) => setShareholderForm({ ...shareholderForm, notes: e.target.value })}
                  className="input-ui w-full text-xs p-2.5"
                  rows={2}
                />
              </div>
              </div>

              <div className="shrink-0 flex gap-2 px-5 py-3.5 border-t border-slate-100 bg-white">
                <button
                  type="button"
                  onClick={() => setShowShareholderModal(false)}
                  className="flex-1 px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 text-xs font-bold"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isSavingShareholder}
                  className="flex-1 px-4 py-2 bg-[#1e40af] text-white rounded-lg hover:bg-[#1d4ed8] text-xs font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSavingShareholder ? 'جاري الحفظ...' : editingShareholder ? 'حفظ التعديلات' : 'إضافة الشريك'}
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
                const salesProfit = Number(partner.accrualAvailableProfit ?? partner.availableProfit ?? 0);
                const realizedAvail = Number(partner.realizedAvailableProfit ?? partner.availableProfit ?? 0);
                const deferred = Math.max(0, Number(partner.deferredProfit ?? (salesProfit - realizedAvail)));
                return (
                  <div className="grid grid-cols-2 gap-2 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                    <div>
                      <span className="text-slate-500 block">رأس المال الفعلي:</span>
                      <strong className="text-slate-900 font-black">{formatCurrency(partner.capital)}</strong>
                    </div>
                    <div>
                      <span className="text-indigo-700 block">أرباح البيع (إجمالي):</span>
                      <strong className="text-indigo-800 font-black">{formatCurrency(salesProfit)}</strong>
                    </div>
                    <div>
                      <span className="text-emerald-700 block font-bold">المتاح للسحب الآن (من الأقساط):</span>
                      <strong className="text-emerald-700 font-black">{formatCurrency(realizedAvail)}</strong>
                    </div>
                    <div>
                      <span className="text-amber-700 block">أرباح مؤجلة (تحت التحصيل):</span>
                      <strong className="text-amber-700 font-black">{formatCurrency(deferred)}</strong>
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
              <div className="space-y-2.5">
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
                        ? 'توريد فعلي بالخزينة (توليد سند قبض مالي)'
                        : 'صرف فعلي من الخزينة (توليد سند صرف مالي)'}
                    </span>
                    <span className="block text-[10px] text-slate-500">
                      {transactionType === 'capital_deposit'
                        ? 'مفعل: تم استلام المبلغ بالخزينة المختارة | غير مفعل: تسوية دفتيرية فقط'
                        : 'مفعل: تم تسليم المبلغ للشريك من الخزينة المختارة | غير مفعل: تسوية دفتيرية'}
                    </span>
                  </div>
                </label>
                {transactionType !== 'profit_distribution' && transactionForm.affectsTreasury !== false && (
                  <PaymentChannelSelector
                    compact
                    label={transactionType === 'capital_deposit' ? 'خزنة الإيداع' : 'خزنة الصرف'}
                    value={transactionForm.channel}
                    onChange={(channel) => setTransactionForm({ ...transactionForm, channel })}
                  />
                )}
              </div>

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
                  disabled={isSavingTransaction}
                  className="flex-1 px-4 py-2 bg-[#1e40af] text-white rounded-lg hover:bg-[#1d4ed8] text-xs font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSavingTransaction ? 'جاري التنفيذ...' : 'تأكيد وتنفيذ الحركة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
