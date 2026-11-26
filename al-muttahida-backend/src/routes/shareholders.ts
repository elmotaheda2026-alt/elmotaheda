import { Router } from 'express';
import { formatDate, isPeriodClosed, parseDateInput } from '../utils.js';
import { z } from 'zod';
import { dbPromise } from '../db.js';
import { requireAdmin, requireAuth, requirePermission, type AuthedRequest } from '../middleware/auth.js';
import { audit } from '../audit.js';
import { uid } from '../utils.js';
import { createSystemNotification, financialMovementLabel, formatMoney } from '../financialNotifications.js';

const router = Router();
router.use(requireAuth);
router.use(requirePermission('shareholders:manage'));

const payoutPreferenceEnum = z.enum(['cash', 'capitalize', 'ask']);

const shareholderSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(1),
  sharePercentage: z.number().min(0).max(100).optional().default(0),
  managementFeePercentage: z.number().min(0).max(100).optional().default(0),
  capital: z.number().nonnegative().default(0),
  currentBalance: z.number().default(0),
  joinedDate: z.string().optional().nullable(),
  isFounder: z.boolean().optional().default(false),
  includeWarehouseProfit: z.boolean().optional().default(false),
  payoutPreference: payoutPreferenceEnum.optional().default('capitalize'),
  payoutCycleMonths: z.number().int().min(0).max(60).optional().default(3),
  payoutNoticeDays: z.number().int().min(0).max(180).optional().default(15),
  nextPayoutDate: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  isOpeningBalance: z.boolean().optional().default(false),
  affectsTreasury: z.boolean().optional().default(true),
  channel: z.string().trim().min(1).max(64).optional().default('cash'),
});

const payoutPreferenceSchema = z.object({
  payoutPreference: payoutPreferenceEnum,
  payoutCycleMonths: z.number().int().min(0).max(60).optional(),
  payoutNoticeDays: z.number().int().min(0).max(180).optional(),
  nextPayoutDate: z.string().optional().nullable(),
  requestedPayoutAmount: z.number().nonnegative().optional().nullable(),
});

const txSchema = z.object({
  shareholderId: z.string().min(1),
  type: z.enum(['capital_deposit', 'capital_withdrawal', 'profit_distribution', 'profit_withdrawal']),
  amount: z.number().positive(),
  date: z.string().min(8),
  description: z.string().min(1),
  affectsTreasury: z.boolean().optional().default(true),
  channel: z.string().trim().min(1).max(64).optional().default('cash'),
});

const settlePeriodSchema = z.object({
  periodFrom: z.string().optional().nullable(),
  periodTo: z.string().min(8),
  profitBasis: z.enum(['realized', 'accrual']).optional().default('realized'),
  notes: z.string().optional().nullable(),
});

const roundMoney = (val: unknown) => Number(Number(val || 0).toFixed(2));

function localTodayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toDatePart(dateStr?: string | null): string {
  if (!dateStr) return localTodayIso();
  const str = String(dateStr).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return localTodayIso();
}

function addDaysIso(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + days));
  return dt.toISOString().slice(0, 10);
}

function endOfMonthAfterMonths(dateStr: string, monthsToAdd: number): string {
  const [y, m] = toDatePart(dateStr).split('-').map(Number);
  const totalMonths = (y * 12 + (m - 1)) + monthsToAdd;
  const newYear = Math.floor(totalMonths / 12);
  const newMonth = (totalMonths % 12) + 1;
  const lastDay = new Date(Date.UTC(newYear, newMonth, 0)).getUTCDate();
  return `${newYear}-${String(newMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

function computeNextCycleEndDate(todayOrBaseStr: string, cycleMonths: number): string {
  const months = Number(cycleMonths || 1);
  if (months <= 0) return endOfMonthAfterMonths(todayOrBaseStr, 0);
  const todayStr = localTodayIso();
  // For monthly (1), target end of current month first; if today is already >= end of current month, advance by 1 month.
  // For multi-month (3, 6, 12), target end of month after (months) from base/today.
  let candidate = months === 1
    ? endOfMonthAfterMonths(todayStr, 0)
    : endOfMonthAfterMonths(todayOrBaseStr || todayStr, months);
  let guard = 0;
  while (candidate <= todayStr && guard < 120) {
    candidate = endOfMonthAfterMonths(candidate, months);
    guard++;
  }
  return candidate;
}

function diffDaysInclusive(fromDate: string, toDate: string): number {
  const start = new Date(`${fromDate}T00:00:00Z`).getTime();
  const end = new Date(`${toDate}T00:00:00Z`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;
  return Math.floor((end - start) / 86400000) + 1;
}

function isWithinRange(dateStr: string, startDate: string | null, endDate: string | null): boolean {
  const day = toDatePart(dateStr);
  if (startDate && day < startDate) return false;
  if (endDate && day > endDate) return false;
  return true;
}

async function generateReceiptNumber(txDb: any): Promise<string> {
  try {
    const row = await txDb.get(
      `SELECT TOP 1 receipt_number FROM payments WITH (UPDLOCK, HOLDLOCK) WHERE receipt_number LIKE 'RCPT-SH-%' ORDER BY created_at DESC`
    );
    if (row?.receipt_number) {
      const num = parseInt(String(row.receipt_number).replace('RCPT-SH-', ''), 10);
      if (!isNaN(num)) return `RCPT-SH-${num + 1}`;
    }
  } catch (_) {}
  return `RCPT-SH-${Date.now().toString().slice(-6)}`;
}

type ProfitEvent = {
  date: string;
  saleDate: string;
  realizedProfit: number;
  realizedFinancingProfit: number;
  realizedWarehouseProfit: number;
  accrualProfit: number;
  accrualFinancingProfit: number;
  accrualWarehouseProfit: number;
  cashAmount?: number;
  fromPeriodSale?: boolean;
};

type CapitalEvent = {
  shareholderId: string;
  date: string;
  delta: number;
};

type StakeholderModel = {
  row: any;
  id: string;
  name: string;
  isFounder: boolean;
  includeWarehouseProfit: boolean;
  sharePercentage: number;
  managementFeePercentage: number;
  currentCapital: number;
  joinedDate: string;
  initialBaselineCapital: number;
  capitalTxs: Array<{ date: string; delta: number }>;
};

function getPartnerCapitalOnDate(partner: StakeholderModel, dateStr: string): number {
  if (dateStr < partner.joinedDate) return 0;
  let cap = partner.initialBaselineCapital;
  for (const tx of partner.capitalTxs) {
    if (tx.date <= dateStr) {
      cap = Math.max(0, cap + tx.delta);
    }
  }
  return roundMoney(cap);
}

/**
 * Runs chronological Time-Weighted Capital Tranche profit allocation over [evalStart, evalEnd].
 * Guarantees 0.00 variance between company net profit and sum of partner entitlements + pre-capital pool.
 */
function runTrancheAllocation(params: {
  partners: StakeholderModel[];
  profitEvents: ProfitEvent[];
  expenseEvents: Array<{ date: string; amount: number }>;
  profitBasis: 'realized' | 'accrual';
  evalStart: string | null;
  evalEnd: string;
}) {
  const { partners, profitEvents, expenseEvents, profitBasis, evalStart, evalEnd } = params;

  const getProfitValue = (ev: ProfitEvent) =>
    profitBasis === 'realized' ? ev.realizedProfit : ev.accrualProfit;
  const getFinancingProfitValue = (ev: ProfitEvent) =>
    profitBasis === 'realized' ? ev.realizedFinancingProfit : ev.accrualFinancingProfit;
  const getWarehouseProfitValue = (ev: ProfitEvent) =>
    profitBasis === 'realized' ? ev.realizedWarehouseProfit : ev.accrualWarehouseProfit;

  const relevantProfits = profitEvents.filter((ev) => ev.date <= evalEnd && (!evalStart || ev.date >= evalStart));
  const relevantExpenses = expenseEvents.filter((ex) => ex.date <= evalEnd && (!evalStart || ex.date >= evalStart));

  const candidateStarts: string[] = [];
  const candidateEnds: string[] = [evalEnd];
  if (evalStart) {
    candidateStarts.push(evalStart);
  }
  for (const p of relevantProfits) {
    candidateStarts.push(p.saleDate || p.date);
    candidateStarts.push(p.date);
    if (p.saleDate) candidateEnds.push(p.saleDate);
  }
  for (const ex of relevantExpenses) candidateStarts.push(ex.date);
  if (!evalStart) {
    for (const partner of partners) candidateStarts.push(partner.joinedDate);
  }

  candidateStarts.sort();
  candidateEnds.sort();
  const windowStart = candidateStarts[0] || evalEnd;
  const windowEnd = candidateEnds[candidateEnds.length - 1] || evalEnd;
  const displayWindowStart = evalStart || windowStart;

  const trancheAudit: Array<{
    fromDate: string;
    toDate: string;
    days: number;
    displayDays: number;
    totalActiveCapital: number;
    financingGross: number;
    warehouseGross: number;
    grossProfit: number;
    expenses: number;
    netProfit: number;
    financingNetProfit: number;
    roiPerEgp: number;
    isPreCapital: boolean;
    investorsShare: number;
    foundersShare: number;
    companyUnclaimedShare: number;
    partnerCaps: Record<string, number>;
  }> = [];

  if (windowStart <= windowEnd) {
    const splitDatesSet = new Set<string>();
    for (const partner of partners) {
      if (partner.joinedDate > windowStart && partner.joinedDate <= windowEnd) {
        splitDatesSet.add(partner.joinedDate);
      }
      for (const tx of partner.capitalTxs) {
        if (tx.date > windowStart && tx.date <= windowEnd) {
          splitDatesSet.add(tx.date);
        }
      }
    }

    const splitDates = Array.from(splitDatesSet).sort();
    const ranges: Array<{ fromDate: string; toDate: string }> = [];

    if (splitDates.length === 0) {
      ranges.push({ fromDate: windowStart, toDate: windowEnd });
    } else {
      ranges.push({ fromDate: windowStart, toDate: addDaysIso(splitDates[0], -1) });
      for (let i = 0; i < splitDates.length; i++) {
        const start = splitDates[i];
        const end = i + 1 < splitDates.length ? addDaysIso(splitDates[i + 1], -1) : windowEnd;
        if (start <= end) {
          ranges.push({ fromDate: start, toDate: end });
        }
      }
    }

    for (const range of ranges) {
      if (range.fromDate > range.toDate) continue;
      const days = diffDaysInclusive(range.fromDate, range.toDate);
      const overlapStart = displayWindowStart > range.fromDate ? displayWindowStart : range.fromDate;
      const overlapEnd = evalEnd < range.toDate ? evalEnd : range.toDate;
      const displayDays = overlapStart <= overlapEnd ? diffDaysInclusive(overlapStart, overlapEnd) : 0;

      const partnerCaps: Record<string, number> = {};
      let totalActiveCapital = 0;

      for (const partner of partners) {
        const cap = getPartnerCapitalOnDate(partner, range.fromDate);
        partnerCaps[partner.id] = cap;
        totalActiveCapital = roundMoney(totalActiveCapital + cap);
      }

      // Vintage attribution: profit collected in the active report window is attributed to the capital tranche on its contract saleDate.
      const trancheEvents = relevantProfits.filter((ev) => {
        const attrDate = ev.saleDate || ev.date;
        return attrDate >= range.fromDate && attrDate <= range.toDate;
      });
      const financingGross = roundMoney(
        trancheEvents.reduce((sum, ev) => sum + getFinancingProfitValue(ev), 0)
      );
      const warehouseGross = roundMoney(
        trancheEvents.reduce((sum, ev) => sum + getWarehouseProfitValue(ev), 0)
      );
      const grossProfit = roundMoney(financingGross + warehouseGross);
      const expenses = roundMoney(
        relevantExpenses
          .filter((ex) => ex.date >= range.fromDate && ex.date <= range.toDate)
          .reduce((sum, ex) => sum + ex.amount, 0)
      );
      const netProfit = roundMoney(grossProfit - expenses);
      const financingNetProfit = roundMoney(financingGross - expenses);

      if (displayDays === 0 && financingGross === 0 && warehouseGross === 0 && expenses === 0) {
        continue;
      }

      const hasActivePartners = partners.some((p) => range.fromDate >= p.joinedDate);
      const isPreCapital = totalActiveCapital <= 0 && !hasActivePartners;

      trancheAudit.push({
        fromDate: range.fromDate,
        toDate: range.toDate,
        days,
        displayDays,
        totalActiveCapital,
        financingGross,
        warehouseGross,
        grossProfit,
        expenses,
        netProfit,
        financingNetProfit,
        roiPerEgp: totalActiveCapital > 0 ? Number((netProfit / totalActiveCapital).toFixed(6)) : 0,
        isPreCapital,
        investorsShare: 0,
        foundersShare: 0,
        companyUnclaimedShare: 0,
        partnerCaps,
      });
    }
  }

  // Pass 1: Accumulate each Silent Investor's signed return across tranches where they held capital
  const investorAccum = new Map<
    string,
    { gross: number; weightedCapDays: number; activeDays: number; net: number; mgmtFee: number }
  >();
  for (const p of partners) {
    investorAccum.set(p.id, { gross: 0, weightedCapDays: 0, activeDays: 0, net: 0, mgmtFee: 0 });
  }

  for (const tranche of trancheAudit) {
    for (const p of partners) {
      if (tranche.fromDate < p.joinedDate) continue;
      const acc = investorAccum.get(p.id)!;
      const cap = tranche.partnerCaps[p.id] || 0;
      if (tranche.displayDays > 0) {
        acc.activeDays += tranche.displayDays;
        acc.weightedCapDays += cap * tranche.displayDays;
      }

      if (!p.isFounder && !tranche.isPreCapital && tranche.totalActiveCapital > 0 && cap > 0) {
        const eligibleProfit = p.includeWarehouseProfit ? tranche.netProfit : tranche.financingNetProfit;
        acc.gross += eligibleProfit * (cap / tranche.totalActiveCapital);
      }
    }
  }

  // Finalize silent investors' net entitlement & management fees (Mudarabah: investor bears 0 profit if net period <= 0)
  for (const p of partners) {
    if (p.isFounder) continue;
    const acc = investorAccum.get(p.id)!;
    const roundedGross = roundMoney(acc.gross);
    if (roundedGross > 0) {
      const shareRatio = Math.min(100, Math.max(0, p.sharePercentage)) / 100;
      acc.gross = roundedGross;
      acc.net = roundMoney(roundedGross * shareRatio);
      acc.mgmtFee = roundMoney(roundedGross - acc.net);
    } else {
      acc.gross = roundedGross; // Preserve negative/zero for CPA transparency
      acc.net = 0;
      acc.mgmtFee = 0;
    }
  }

  // Pass 2: Allocate remaining tranche profit to active Founders inside each tranche
  // First track raw fractional founder share, then reconcile exact rounding against tranche net
  const founderNetById = new Map<string, number>();
  const founderMgmtBonusById = new Map<string, number>();
  for (const p of partners) {
    if (p.isFounder) {
      founderNetById.set(p.id, 0);
      founderMgmtBonusById.set(p.id, 0);
    }
  }

  let preCapitalProfit = 0;
  let companyUnclaimedRetainedPool = 0;
  let distributedInvestorMgmtFee = 0;

  // Also calculate investor exact take-home per tranche so Pass 1 + Pass 2 sums cleanly to tranche net
  const investorRemainingToDistribute = new Map<string, number>();
  for (const p of partners) {
    if (!p.isFounder) {
      investorRemainingToDistribute.set(p.id, investorAccum.get(p.id)!.net);
    }
  }

  // Compute exact unrounded tranche takes proportional to positive tranche contribution when investor overall net > 0
  const trancheInvestorTake = trancheAudit.map((tranche) => {
    const takes = new Map<string, number>();
    let totalTake = 0;
    let totalMgmtFee = 0;
    if (!tranche.isPreCapital && tranche.totalActiveCapital > 0) {
      for (const p of partners) {
        if (p.isFounder) continue;
        const acc = investorAccum.get(p.id)!;
        const cap = tranche.partnerCaps[p.id] || 0;
        if (acc.net > 0 && cap > 0) {
          const eligibleProfit = p.includeWarehouseProfit ? tranche.netProfit : tranche.financingNetProfit;
          const shareRatio = Math.min(100, Math.max(0, p.sharePercentage)) / 100;
          const rawGross = eligibleProfit * (cap / tranche.totalActiveCapital);
          const take = roundMoney(rawGross * shareRatio);
          const fee = Math.max(0, roundMoney(roundMoney(rawGross) - take));
          takes.set(p.id, take);
          totalTake = roundMoney(totalTake + take);
          totalMgmtFee = roundMoney(totalMgmtFee + fee);
        }
      }
    }
    return { takes, totalTake, totalMgmtFee };
  });

  trancheAudit.forEach((tranche, idx) => {
    if (tranche.isPreCapital || (tranche.totalActiveCapital <= 0 && !partners.some((p) => p.isFounder && tranche.fromDate >= p.joinedDate))) {
      preCapitalProfit = roundMoney(preCapitalProfit + tranche.netProfit);
      return;
    }

    const activeFounders = partners.filter((p) => p.isFounder && tranche.fromDate >= p.joinedDate);
    const invSum = trancheInvestorTake[idx].totalTake;
    const trancheMgmtFee = trancheInvestorTake[idx].totalMgmtFee;
    tranche.investorsShare = invSum;

    const poolAfterInvestors = roundMoney(tranche.netProfit - invSum);
    if (activeFounders.length === 0) {
      companyUnclaimedRetainedPool = roundMoney(companyUnclaimedRetainedPool + poolAfterInvestors);
      tranche.companyUnclaimedShare = poolAfterInvestors;
      return;
    }

    const totalActiveFoundersCapital = activeFounders.reduce(
      (sum, f) => sum + Math.max(0, tranche.partnerCaps[f.id] || 0),
      0
    );
    let distributedToFoundersInTranche = 0;
    let distributedMgmtFeeInTranche = 0;

    activeFounders.forEach((founder, fIdx) => {
      const founderCapInTranche = Math.max(0, tranche.partnerCaps[founder.id] || 0);
      const ratio = totalActiveFoundersCapital > 0
        ? founderCapInTranche / totalActiveFoundersCapital
        : 1 / activeFounders.length;
      const portion =
        fIdx === activeFounders.length - 1
          ? roundMoney(poolAfterInvestors - distributedToFoundersInTranche)
          : roundMoney(poolAfterInvestors * ratio);
      const mgmtPortion =
        fIdx === activeFounders.length - 1
          ? roundMoney(trancheMgmtFee - distributedMgmtFeeInTranche)
          : roundMoney(trancheMgmtFee * ratio);
      distributedToFoundersInTranche = roundMoney(distributedToFoundersInTranche + portion);
      distributedMgmtFeeInTranche = roundMoney(distributedMgmtFeeInTranche + mgmtPortion);
      founderNetById.set(founder.id, roundMoney((founderNetById.get(founder.id) || 0) + portion));
      founderMgmtBonusById.set(founder.id, roundMoney((founderMgmtBonusById.get(founder.id) || 0) + mgmtPortion));
    });

    distributedInvestorMgmtFee = roundMoney(distributedInvestorMgmtFee + distributedMgmtFeeInTranche);
    tranche.foundersShare = poolAfterInvestors;
  });

  // Ensure exact zero-variance consistency between investor sum and tranche sums regardless of tranche count
  let totalInvestorsMgmtFeeTarget = 0;
  for (const p of partners) {
    if (!p.isFounder) {
      const acc = investorAccum.get(p.id)!;
      const sumTrancheTakes = roundMoney(
        trancheInvestorTake.reduce((s, item) => s + (item.takes.get(p.id) || 0), 0)
      );
      if (acc.net > 0) {
        acc.net = sumTrancheTakes;
        acc.mgmtFee = roundMoney(acc.gross - acc.net);
      }
      totalInvestorsMgmtFeeTarget = roundMoney(totalInvestorsMgmtFeeTarget + acc.mgmtFee);
    }
  }

  // Reconcile 1-piaster rounding difference in distributed management fees when no unclaimed pool exists
  const activeFoundersList = partners.filter((p) => p.isFounder);
  if (activeFoundersList.length > 0 && Math.abs(companyUnclaimedRetainedPool) < 0.01) {
    const mgmtDelta = roundMoney(totalInvestorsMgmtFeeTarget - distributedInvestorMgmtFee);
    if (Math.abs(mgmtDelta) > 0 && Math.abs(mgmtDelta) <= 0.5) {
      const lastFounder = activeFoundersList[activeFoundersList.length - 1];
      const fNetLast = roundMoney(founderNetById.get(lastFounder.id) || 0);
      const adjustedLast = roundMoney(
        Math.min(fNetLast, Math.max(0, (founderMgmtBonusById.get(lastFounder.id) || 0) + mgmtDelta))
      );
      founderMgmtBonusById.set(lastFounder.id, adjustedLast);
    }
  }

  const perPartnerResult = new Map<
    string,
    {
      grossProfit: number;
      netEntitlement: number;
      mgmtFee: number;
      ownCapitalProfit: number;
      mgmtFeeEarned: number;
      weightedAvgCapital: number;
      activeDays: number;
    }
  >();

  for (const p of partners) {
    const acc = investorAccum.get(p.id)!;
    const weightedAvgCapital = acc.activeDays > 0 ? roundMoney(acc.weightedCapDays / acc.activeDays) : p.currentCapital;
    if (p.isFounder) {
      const fNet = roundMoney(founderNetById.get(p.id) || 0);
      const mgmtFeeEarned = fNet > 0
        ? Math.min(fNet, Math.max(0, roundMoney(founderMgmtBonusById.get(p.id) || 0)))
        : 0;
      const ownCapitalProfit = roundMoney(fNet - mgmtFeeEarned);
      perPartnerResult.set(p.id, {
        grossProfit: fNet,
        netEntitlement: fNet,
        mgmtFee: 0,
        ownCapitalProfit,
        mgmtFeeEarned,
        weightedAvgCapital,
        activeDays: acc.activeDays,
      });
    } else {
      perPartnerResult.set(p.id, {
        grossProfit: roundMoney(acc.gross),
        netEntitlement: roundMoney(acc.net),
        mgmtFee: roundMoney(acc.mgmtFee),
        ownCapitalProfit: roundMoney(acc.net),
        mgmtFeeEarned: 0,
        weightedAvgCapital,
        activeDays: acc.activeDays,
      });
    }
  }

  const periodCompanyRevenueProfit = roundMoney(relevantProfits.reduce((s, ev) => s + getProfitValue(ev), 0));
  const periodExpenses = roundMoney(relevantExpenses.reduce((s, ex) => s + ex.amount, 0));
  const periodNetProfit = roundMoney(periodCompanyRevenueProfit - periodExpenses);

  return {
    perPartnerResult,
    trancheAudit,
    preCapitalProfit,
    companyUnclaimedRetainedPool,
    periodCompanyNetProfit: periodNetProfit,
    periodExpenses,
  };
}

/**
 * Recalculates and persists each founder's ownership percentage strictly from their current capital
 * so active founders always sum to 100.00%, completely independent of silent financing investors.
 */
async function recalculateFoundersPercentages(txDb: any): Promise<void> {
  const founders = await txDb.all(
    `SELECT id, capital FROM shareholders WHERE is_founder = 1 ORDER BY created_at ASC, id ASC`
  );
  if (!founders || founders.length === 0) return;

  const totalCap = founders.reduce((sum: number, f: any) => sum + Math.max(0, roundMoney(f.capital)), 0);
  const now = new Date().toISOString();
  let runningSum = 0;

  for (let i = 0; i < founders.length; i++) {
    const f = founders[i];
    let pct: number;
    if (i === founders.length - 1) {
      pct = roundMoney(100 - runningSum);
    } else if (totalCap > 0) {
      pct = roundMoney((Math.max(0, roundMoney(f.capital)) / totalCap) * 100);
      runningSum = roundMoney(runningSum + pct);
    } else {
      pct = roundMoney(100 / founders.length);
      runningSum = roundMoney(runningSum + pct);
    }

    await txDb.run(
      'UPDATE shareholders SET share_percentage = ?, management_fee_percentage = 0, updated_at = ? WHERE id = ?',
      pct,
      now,
      f.id
    );
  }
}

/**
 * Computes full CPA-grade time-weighted shareholder metrics, realized vs accrual reconciliation, & ledger.
 */
export async function computeShareholdersEngine(
  db: any,
  periodFrom: string | null,
  periodTo: string | null,
  profitBasis: 'realized' | 'accrual' = 'realized',
  evalCeilingDate: string | null = null
) {
  const [salesRows, saleItemsRows, salePaymentsRows, rescheduleRows, expensesRows, shareholdersRows, transactionsRows, suppliersDebtRow, settlementsRows] = await Promise.all([
    db.all(`SELECT id, invoice_number, date, subtotal, discount, tax, total, paid, remaining, status, payment_method, upfront_amount FROM sales WHERE status <> 'cancelled'`),
    db.all(
      `SELECT si.sale_id, si.quantity, si.unit_price, si.discount, si.fulfillment_type,
              COALESCE(NULLIF(si.unit_cost, 0), pr.purchase_price, 0) AS unit_cost, s.date AS sale_date
       FROM sale_items si
       INNER JOIN sales s ON s.id = si.sale_id
       LEFT JOIN products pr ON pr.id = si.product_id
       WHERE s.status <> 'cancelled'`
    ),
    db.all(
      `SELECT id, sale_id, invoice_number, type, amount, date, status, void_ref, description
       FROM payments
       WHERE status IN ('posted', 'voided')
         AND (sale_id IS NOT NULL OR reference_type = 'sale' OR invoice_number IS NOT NULL)`
    ),
    db.all(
      `SELECT sale_id, paid_before_reschedule, extra_interest_amount, requested_at
       FROM reschedule_requests
       WHERE status = 'approved' AND COALESCE(extra_interest_amount, 0) > 0
       ORDER BY requested_at ASC, id ASC`
    ).catch(() => []),
    db.all(`SELECT id, date, amount, category, description FROM expenses`),
    db.all(`SELECT * FROM shareholders ORDER BY created_at ASC, id ASC`),
    db.all(`SELECT * FROM shareholder_transactions ORDER BY date ASC, created_at ASC`),
    db.get(`SELECT COALESCE(SUM(balance), 0) AS total_debt FROM suppliers`),
    db.all(`SELECT * FROM closing_periods WHERE period_type = 'shareholders_settlement' ORDER BY period_date DESC`),
  ]);

  const reschedulesBySaleId = new Map<string, Array<{ paidBefore: number; extraInterest: number }>>();
  for (const r of rescheduleRows as any[]) {
    const sid = String(r.sale_id || '').trim();
    const extraInterest = roundMoney(r.extra_interest_amount);
    if (!sid || extraInterest <= 0) continue;
    const list = reschedulesBySaleId.get(sid) || [];
    list.push({
      paidBefore: roundMoney(r.paid_before_reschedule),
      extraInterest,
    });
    reschedulesBySaleId.set(sid, list);
  }

  const totalSupplierDebt = roundMoney(Number(suppliersDebtRow?.total_debt || 0));

  const saleIdByInvoiceNumber = new Map<string, string>();
  for (const s of salesRows) {
    if (s.invoice_number) {
      saleIdByInvoiceNumber.set(String(s.invoice_number).trim(), s.id);
    }
  }

  // Pre-group COGS and Cash Selling Base by sale_id
  const cogsBySaleId = new Map<string, number>();
  const cashBaseBySaleId = new Map<string, number>();
  const itemCountBySaleId = new Map<string, number>();
  for (const item of saleItemsRows) {
    const qty = Number(item.quantity || 0);
    const cost = qty * Number(item.unit_cost || 0);
    const discPct = Math.max(0, Math.min(100, Number(item.discount || 0)));
    const itemCashBase = qty * Number(item.unit_price || 0) * (1 - discPct / 100);
    cogsBySaleId.set(item.sale_id, (cogsBySaleId.get(item.sale_id) || 0) + cost);
    cashBaseBySaleId.set(item.sale_id, (cashBaseBySaleId.get(item.sale_id) || 0) + itemCashBase);
    itemCountBySaleId.set(item.sale_id, (itemCountBySaleId.get(item.sale_id) || 0) + 1);
  }

  // Group sale payments by sale_id while ignoring voided rows and their matching reversal counter-entries
  const voidedPaymentIds = new Set<string>();
  for (const p of salePaymentsRows) {
    if (p.status === 'voided' && p.id) {
      voidedPaymentIds.add(String(p.id));
    }
  }

  const paymentsBySaleId = new Map<string, Array<{ date: string; signedAmount: number }>>();
  for (const p of salePaymentsRows) {
    if (p.status !== 'posted') continue;
    const isVoidReversalOut =
      p.type === 'out' &&
      ((p.void_ref && voidedPaymentIds.has(String(p.void_ref))) ||
        String(p.description || '').startsWith('Reverse of '));
    if (isVoidReversalOut) continue;

    const targetSaleId =
      p.sale_id ||
      (p.invoice_number ? saleIdByInvoiceNumber.get(String(p.invoice_number).trim()) : null);
    if (!targetSaleId) continue;

    const list = paymentsBySaleId.get(targetSaleId) || [];
    const amt = Number(p.amount || 0);
    list.push({
      date: toDatePart(p.date),
      signedAmount: p.type === 'in' ? amt : -amt,
    });
    paymentsBySaleId.set(targetSaleId, list);
  }

  // Build exact Profit Events (splitting Financing Interest vs Warehouse Margin; Downpayment realizes 0 Financing Interest)
  const allProfitEvents: ProfitEvent[] = [];
  let totalContractGrossRevenue = 0;
  let totalEarlySettlementDiscounts = 0;
  let totalEffectiveRevenue = 0;
  let totalCogsFromItems = 0;
  let totalCogsFromSubtotalFallback = 0;
  let costedByItemsCount = 0;
  let costedBySubtotalFallbackCount = 0;
  let totalCollectedOnSales = 0;
  let totalDeferredReceivables = 0;
  let allTimeAccrualGrossProfit = 0;
  let allTimeRealizedGrossProfit = 0;

  for (const s of salesRows) {
    const saleDate = toDatePart(s.date);
    const inSalePeriod = isWithinRange(saleDate, periodFrom, periodTo);
    const rawTotal = roundMoney(s.total);
    const paidAmt = Math.max(0, roundMoney(s.paid));
    const isSettledEarly = s.status === 'settled_early';
    const effectiveTotal = isSettledEarly ? paidAmt : rawTotal;
    const earlyDiscount = isSettledEarly ? Math.max(0, roundMoney(rawTotal - effectiveTotal)) : 0;

    const itemCogs = roundMoney(cogsBySaleId.get(s.id) || 0);
    const itemsCountForSale = itemCountBySaleId.get(s.id) || 0;
    let effectiveCost = 0;
    if (itemCogs > 0) {
      effectiveCost = itemCogs;
      if (inSalePeriod) {
        totalCogsFromItems = roundMoney(totalCogsFromItems + effectiveCost);
        costedByItemsCount++;
      }
    } else {
      // Fallback for legacy/imported contracts without sale_items rows: use principal subtotal
      const sub = Number(s.subtotal || 0);
      const disc = Number(s.discount || 0);
      const tax = Number(s.tax || 0);
      const lineDiscMatchesTotal = disc > 0 && Math.abs(sub - disc + tax - rawTotal) <= 1;
      const principal = Math.max(0, lineDiscMatchesTotal ? sub - disc : sub);
      effectiveCost = principal > 0 ? roundMoney(principal) : effectiveTotal;
      if (inSalePeriod) {
        totalCogsFromSubtotalFallback = roundMoney(totalCogsFromSubtotalFallback + effectiveCost);
        costedBySubtotalFallbackCount++;
      }
    }

    const contractProfit = roundMoney(effectiveTotal - effectiveCost);
    const collectedCash = Math.min(effectiveTotal, paidAmt);

    // Split contractProfit into Warehouse Profit (cash selling price - COGS) + Financing Profit (installment interest)
    const rawCashBase = itemsCountForSale > 0
      ? Math.min(rawTotal, roundMoney(cashBaseBySaleId.get(s.id) || 0))
      : effectiveCost;
    const warehouseProfit = Math.max(
      0,
      Math.min(Math.max(0, contractProfit), roundMoney(rawCashBase - effectiveCost))
    );
    const financingProfit = roundMoney(contractProfit - warehouseProfit);
    const effectiveCashBase = Math.min(effectiveTotal, roundMoney(effectiveCost + warehouseProfit));

    const rawUpfront = s.upfront_amount !== null && s.upfront_amount !== undefined ? roundMoney(s.upfront_amount) : 0;
    const contractUpfront = rawUpfront > 0 ? Math.min(effectiveTotal, effectiveCashBase, rawUpfront) : 0;
    const installmentTotal = Math.max(0, roundMoney(effectiveTotal - contractUpfront));

    const warehouseRatioOnCashBase = effectiveCashBase > 0 ? warehouseProfit / effectiveCashBase : 0;
    const warehouseOnFullUpfront = roundMoney(contractUpfront * warehouseRatioOnCashBase);
    const warehouseInInstallments = roundMoney(warehouseProfit - warehouseOnFullUpfront);
    const finRatioPerInst = installmentTotal > 0 ? financingProfit / installmentTotal : 0;
    const whRatioPerInst = installmentTotal > 0 ? warehouseInInstallments / installmentTotal : 0;

    if (inSalePeriod) {
      totalContractGrossRevenue = roundMoney(totalContractGrossRevenue + rawTotal);
      totalEarlySettlementDiscounts = roundMoney(totalEarlySettlementDiscounts + earlyDiscount);
      totalEffectiveRevenue = roundMoney(totalEffectiveRevenue + effectiveTotal);
      totalCollectedOnSales = roundMoney(totalCollectedOnSales + collectedCash);
      totalDeferredReceivables = roundMoney(totalDeferredReceivables + Math.max(0, effectiveTotal - collectedCash));
      allTimeAccrualGrossProfit = roundMoney(allTimeAccrualGrossProfit + contractProfit);
    }

    // Accrual event on sale date
    allProfitEvents.push({
      date: saleDate,
      saleDate,
      accrualProfit: contractProfit,
      accrualFinancingProfit: financingProfit,
      accrualWarehouseProfit: warehouseProfit,
      realizedProfit: 0,
      realizedFinancingProfit: 0,
      realizedWarehouseProfit: 0,
      cashAmount: 0,
      fromPeriodSale: inSalePeriod,
    });

    const saleReschedules = reschedulesBySaleId.get(s.id) || [];
    const instSegments: Array<{ start: number; end: number; finRate: number; whRate: number }> = [];

    if (saleReschedules.length === 0) {
      instSegments.push({
        start: contractUpfront,
        end: Math.max(contractUpfront, effectiveTotal),
        finRate: finRatioPerInst,
        whRate: whRatioPerInst,
      });
    } else {
      // Piecewise segments: extra interest added by a reschedule applies strictly to collections AFTER that reschedule
      const totalExtraInterest = roundMoney(saleReschedules.reduce((sum, r) => sum + r.extraInterest, 0));
      const origRawTotal = roundMoney(Math.max(effectiveCashBase, rawTotal - totalExtraInterest));
      const rawFinancingBeforeReschedules = roundMoney(Math.max(0, origRawTotal - effectiveCost - warehouseProfit));

      let segStart = contractUpfront;
      let currTotal = origRawTotal;
      let remFin = rawFinancingBeforeReschedules;
      let remWh = warehouseInInstallments;
      let finRealizedPrior = 0;
      let whRealizedPrior = 0;

      for (const r of saleReschedules) {
        let cut = Math.max(segStart, Math.min(currTotal, r.paidBefore));
        if (isSettledEarly) {
          cut = Math.min(cut, effectiveTotal);
        }
        const remCash = Math.max(0, roundMoney(currTotal - segStart));
        const finRate = remCash > 0 ? remFin / remCash : 0;
        const whRate = remCash > 0 ? remWh / remCash : 0;

        if (cut > segStart) {
          instSegments.push({ start: segStart, end: cut, finRate, whRate });
        }

        const segLen = Math.max(0, cut - segStart);
        const segFin = segLen * finRate;
        const segWh = segLen * whRate;
        finRealizedPrior += segFin;
        whRealizedPrior += segWh;

        remFin = remFin - segFin + r.extraInterest;
        remWh = remWh - segWh;
        currTotal = roundMoney(currTotal + r.extraInterest);
        segStart = cut;
      }

      const finalEnd = Math.max(segStart, effectiveTotal);
      const finalRemCash = Math.max(0, roundMoney(finalEnd - segStart));
      const finalRemFin = isSettledEarly ? roundMoney(financingProfit - finRealizedPrior) : remFin;
      const finalRemWh = isSettledEarly ? roundMoney(warehouseInInstallments - whRealizedPrior) : remWh;
      instSegments.push({
        start: segStart,
        end: finalEnd,
        finRate: finalRemCash > 0 ? finalRemFin / finalRemCash : 0,
        whRate: finalRemCash > 0 ? finalRemWh / finalRemCash : 0,
      });
    }

    const calcSegmentTotals = (fromCum: number, toCum: number) => {
      let fin = 0;
      let wh = 0;
      for (const seg of instSegments) {
        const overlap = Math.max(0, Math.min(seg.end, toCum) - Math.max(seg.start, fromCum));
        if (overlap > 0) {
          fin += overlap * seg.finRate;
          wh += overlap * seg.whRate;
        }
      }
      return { fin, wh };
    };

    // Realize cash slices chronologically: downpayment portion yields ZERO financing profit;
    // installment & settlement collections above contractUpfront realize financing interest proportionally by segment.
    const realizeSlice = (cashDelta: number, cumulativeBefore: number) => {
      if (cashDelta >= 0) {
        const nextCum = cumulativeBefore + cashDelta;
        const downPart = Math.max(0, Math.min(contractUpfront, nextCum) - Math.min(contractUpfront, cumulativeBefore));
        const { fin, wh } = calcSegmentTotals(Math.max(contractUpfront, cumulativeBefore), nextCum);
        const rFin = roundMoney(fin);
        const rWh = roundMoney(downPart * warehouseRatioOnCashBase + wh);
        return {
          realizedFinancingProfit: rFin,
          realizedWarehouseProfit: rWh,
          realizedProfit: roundMoney(rFin + rWh),
          nextCum,
        };
      } else {
        const prevCum = Math.max(0, cumulativeBefore + cashDelta);
        const downRev = Math.max(0, Math.min(contractUpfront, cumulativeBefore) - Math.min(contractUpfront, prevCum));
        const { fin, wh } = calcSegmentTotals(Math.max(contractUpfront, prevCum), cumulativeBefore);
        const rFin = -roundMoney(fin);
        const rWh = -roundMoney(downRev * warehouseRatioOnCashBase + wh);
        return {
          realizedFinancingProfit: rFin,
          realizedWarehouseProfit: rWh,
          realizedProfit: roundMoney(rFin + rWh),
          nextCum: prevCum,
        };
      }
    };

    const linked = (paymentsBySaleId.get(s.id) || []).slice().sort((a, b) => a.date.localeCompare(b.date));
    const sumLinkedNet = roundMoney(linked.reduce((acc, p) => acc + p.signedAmount, 0));
    const linkedClamped = Math.min(collectedCash, Math.max(0, sumLinkedNet));
    const upfrontCash = roundMoney(Math.max(0, collectedCash - linkedClamped));

    const saleRealizedEvents: ProfitEvent[] = [];
    let cumPaid = 0;

    if (upfrontCash > 0.001) {
      const sliced = realizeSlice(upfrontCash, cumPaid);
      cumPaid = sliced.nextCum;
      saleRealizedEvents.push({
        date: saleDate,
        saleDate,
        accrualProfit: 0,
        accrualFinancingProfit: 0,
        accrualWarehouseProfit: 0,
        realizedProfit: sliced.realizedProfit,
        realizedFinancingProfit: sliced.realizedFinancingProfit,
        realizedWarehouseProfit: sliced.realizedWarehouseProfit,
        cashAmount: upfrontCash,
        fromPeriodSale: inSalePeriod,
      });
    }

    if (linked.length > 0 && Math.abs(sumLinkedNet) > 0.001) {
      const scale = sumLinkedNet > 0 ? linkedClamped / sumLinkedNet : 1;
      for (const p of linked) {
        const cashPart = roundMoney(p.signedAmount * scale);
        const sliced = realizeSlice(cashPart, cumPaid);
        cumPaid = sliced.nextCum;
        saleRealizedEvents.push({
          date: p.date,
          saleDate,
          accrualProfit: 0,
          accrualFinancingProfit: 0,
          accrualWarehouseProfit: 0,
          realizedProfit: sliced.realizedProfit,
          realizedFinancingProfit: sliced.realizedFinancingProfit,
          realizedWarehouseProfit: sliced.realizedWarehouseProfit,
          cashAmount: cashPart,
          fromPeriodSale: inSalePeriod,
        });
      }
    } else if ((contractProfit !== 0 || collectedCash > 0) && upfrontCash === 0 && collectedCash > 0) {
      const sliced = realizeSlice(collectedCash, cumPaid);
      cumPaid = sliced.nextCum;
      saleRealizedEvents.push({
        date: saleDate,
        saleDate,
        accrualProfit: 0,
        accrualFinancingProfit: 0,
        accrualWarehouseProfit: 0,
        realizedProfit: sliced.realizedProfit,
        realizedFinancingProfit: sliced.realizedFinancingProfit,
        realizedWarehouseProfit: sliced.realizedWarehouseProfit,
        cashAmount: collectedCash,
        fromPeriodSale: inSalePeriod,
      });
    }

    // Reconcile any +/-0.01 multi-installment rounding difference when a contract is 100% paid
    if (effectiveTotal > 0 && Math.abs(collectedCash - effectiveTotal) < 0.01 && saleRealizedEvents.length > 0) {
      const sumFin = roundMoney(saleRealizedEvents.reduce((acc, ev) => acc + ev.realizedFinancingProfit, 0));
      const sumWh = roundMoney(saleRealizedEvents.reduce((acc, ev) => acc + ev.realizedWarehouseProfit, 0));
      const diffFin = roundMoney(financingProfit - sumFin);
      const diffWh = roundMoney(warehouseProfit - sumWh);
      if (Math.abs(diffFin) > 0 || Math.abs(diffWh) > 0) {
        const lastEv = saleRealizedEvents[saleRealizedEvents.length - 1];
        lastEv.realizedFinancingProfit = roundMoney(lastEv.realizedFinancingProfit + diffFin);
        lastEv.realizedWarehouseProfit = roundMoney(lastEv.realizedWarehouseProfit + diffWh);
        lastEv.realizedProfit = roundMoney(lastEv.realizedFinancingProfit + lastEv.realizedWarehouseProfit);
      }
    }

    for (const ev of saleRealizedEvents) {
      allProfitEvents.push(ev);
    }
  }

  const periodCashProfitEvents = allProfitEvents.filter((ev) => isWithinRange(ev.date, periodFrom, periodTo));
  allTimeRealizedGrossProfit = roundMoney(
    periodCashProfitEvents.reduce((sum, ev) => sum + ev.realizedProfit, 0)
  );
  const realizedFinancingProfit = roundMoney(
    periodCashProfitEvents.reduce((sum, ev) => sum + ev.realizedFinancingProfit, 0)
  );
  const realizedWarehouseProfit = roundMoney(
    periodCashProfitEvents.reduce((sum, ev) => sum + ev.realizedWarehouseProfit, 0)
  );
  const periodCashCollections = roundMoney(
    periodCashProfitEvents.reduce((sum, ev) => sum + Number(ev.cashAmount || 0), 0)
  );
  const realizedFromPeriodSales = roundMoney(
    periodCashProfitEvents
      .filter((ev) => ev.fromPeriodSale)
      .reduce((sum, ev) => sum + ev.realizedProfit, 0)
  );
  const realizedFromPriorSales = roundMoney(
    periodCashProfitEvents
      .filter((ev) => !ev.fromPeriodSale)
      .reduce((sum, ev) => sum + ev.realizedProfit, 0)
  );

  const allExpenseEvents = expensesRows.map((e: any) => ({
    date: toDatePart(e.date),
    amount: roundMoney(e.amount),
  }));

  const filteredExpensesTotal = roundMoney(
    allExpenseEvents
      .filter((e: any) => isWithinRange(e.date, periodFrom, periodTo))
      .reduce((sum: number, e: any) => sum + e.amount, 0)
  );

  const totalCogs = roundMoney(totalCogsFromItems + totalCogsFromSubtotalFallback);
  const totalSalesRevenue = totalEffectiveRevenue;
  const totalExpenses = filteredExpensesTotal;

  const isFilteredPeriod = Boolean(periodFrom || periodTo);
  const accrualNetProfit = roundMoney(allTimeAccrualGrossProfit - totalExpenses);
  const realizedNetProfit = roundMoney(allTimeRealizedGrossProfit - totalExpenses);
  const deferredOnPeriodSales = roundMoney(allTimeAccrualGrossProfit - realizedFromPeriodSales);
  const deferredProfits = isFilteredPeriod
    ? deferredOnPeriodSales
    : roundMoney(allTimeAccrualGrossProfit - allTimeRealizedGrossProfit);
  const liveNetProfit = profitBasis === 'realized' ? realizedNetProfit : accrualNetProfit;

  const totalCapital = roundMoney(
    shareholdersRows.reduce((sum: number, s: any) => sum + Number(s.capital || 0), 0)
  );

  const foundersRows = shareholdersRows.filter((s: any) => Boolean(s.is_founder));
  const totalFoundersCurrentCapital = foundersRows.reduce(
    (sum: number, s: any) => sum + Math.max(0, roundMoney(s.capital)),
    0
  );
  const liveFounderPctById = new Map<string, number>();
  let runningFounderPct = 0;
  foundersRows.forEach((f: any, idx: number) => {
    let pct: number;
    if (idx === foundersRows.length - 1) {
      pct = roundMoney(100 - runningFounderPct);
    } else if (totalFoundersCurrentCapital > 0) {
      pct = roundMoney((Math.max(0, roundMoney(f.capital)) / totalFoundersCurrentCapital) * 100);
      runningFounderPct = roundMoney(runningFounderPct + pct);
    } else {
      pct = roundMoney(100 / foundersRows.length);
      runningFounderPct = roundMoney(runningFounderPct + pct);
    }
    liveFounderPctById.set(f.id, pct);
  });

  const systemLiveRoi = totalCapital > 0 ? Number((liveNetProfit / totalCapital).toFixed(4)) : 0;

  // Prepare stakeholder models with exact initial baseline capital & dated capital txs
  const stakeholderModels: StakeholderModel[] = shareholdersRows.map((s: any) => {
    const currentCapital = roundMoney(s.capital);
    const isFounder = Boolean(s.is_founder);
    const includeWarehouseProfit = isFounder ? true : Boolean(s.include_warehouse_profit);
    const sharePercentage = isFounder
      ? liveFounderPctById.get(s.id) ?? 0
      : Number(s.share_percentage || 0);
    const managementFeePercentage = isFounder
      ? 0
      : s.management_fee_percentage !== null && s.management_fee_percentage !== undefined
        ? Number(s.management_fee_percentage)
        : 100 - sharePercentage;
    const joinedDate = toDatePart(s.joined_date || s.created_at);

    const partnerTxs = transactionsRows.filter((t: any) => t.shareholder_id === s.id);
    const capitalTxs = partnerTxs
      .filter((t: any) => t.type === 'capital_deposit' || t.type === 'capital_withdrawal')
      .map((t: any) => ({
        date: toDatePart(t.date),
        delta: t.type === 'capital_deposit' ? roundMoney(t.amount) : -roundMoney(t.amount),
      }))
      .sort((a: any, b: any) => a.date.localeCompare(b.date));

    const netTxCapitalChange = roundMoney(
      capitalTxs.reduce((sum: number, t: { date: string; delta: number }) => sum + t.delta, 0)
    );
    const initialBaselineCapital = roundMoney(Math.max(0, currentCapital - netTxCapitalChange));

    return {
      row: s,
      id: s.id,
      name: s.name,
      isFounder,
      includeWarehouseProfit,
      sharePercentage,
      managementFeePercentage,
      currentCapital,
      joinedDate,
      initialBaselineCapital,
      capitalTxs,
    };
  });

  const todayStr = localTodayIso();
  const effectivePeriodEnd = periodTo || todayStr;
  const lifetimeEnd = evalCeilingDate || todayStr;

  // 1) Run Tranche Engine for the selected filter window (for reporting/period breakdown)
  const periodAllocation = runTrancheAllocation({
    partners: stakeholderModels,
    profitEvents: allProfitEvents,
    expenseEvents: allExpenseEvents,
    profitBasis,
    evalStart: periodFrom,
    evalEnd: effectivePeriodEnd,
  });

  // 2) Run Lifetime Tranche Engine up to lifetimeEnd (today for live UI, or settleDate for period closing)
  const lifetimeAllocation =
    !periodFrom && !periodTo && !evalCeilingDate
      ? periodAllocation
      : runTrancheAllocation({
          partners: stakeholderModels,
          profitEvents: allProfitEvents,
          expenseEvents: allExpenseEvents,
          profitBasis,
          evalStart: null,
          evalEnd: lifetimeEnd,
        });

  // Assemble enriched stakeholder output
  const liveShareholders = stakeholderModels.map((model) => {
    const s = model.row;
    const periodRes = periodAllocation.perPartnerResult.get(model.id) || {
      grossProfit: 0,
      netEntitlement: 0,
      mgmtFee: 0,
      ownCapitalProfit: 0,
      mgmtFeeEarned: 0,
      weightedAvgCapital: model.currentCapital,
      activeDays: 0,
    };
    const lifetimeRes = lifetimeAllocation.perPartnerResult.get(model.id) || periodRes;

    const allPartnerTxs = transactionsRows.filter((t: any) => t.shareholder_id === s.id);
    const periodPartnerTxs = allPartnerTxs.filter((t: any) => isWithinRange(t.date, periodFrom, periodTo));

    const totalDeposited = roundMoney(
      allPartnerTxs
        .filter((t: any) => t.type === 'capital_deposit')
        .reduce((sum: number, t: any) => sum + Number(t.amount || 0), 0)
    );
    const totalCapitalWithdrawn = roundMoney(
      allPartnerTxs
        .filter((t: any) => t.type === 'capital_withdrawal')
        .reduce((sum: number, t: any) => sum + Number(t.amount || 0), 0)
    );
    const totalDistributed = roundMoney(
      allPartnerTxs
        .filter((t: any) => t.type === 'profit_distribution')
        .reduce((sum: number, t: any) => sum + Number(t.amount || 0), 0)
    );
    const totalWithdrawnProfits = roundMoney(
      allPartnerTxs
        .filter((t: any) => t.type === 'profit_withdrawal')
        .reduce((sum: number, t: any) => sum + Number(t.amount || 0), 0)
    );

    const originalCapital = model.initialBaselineCapital > 0 ? model.initialBaselineCapital : model.currentCapital;
    const capitalWeightRatio = totalCapital > 0 ? Number((model.currentCapital / totalCapital).toFixed(6)) : 0;

    // Available Profit uses LIFETIME earned entitlement (never wiped by period filtering or year boundary)
    const earnedRaw = Math.max(0, roundMoney(lifetimeRes.netEntitlement));
    const overDistributedDelta = totalDistributed > earnedRaw + 0.05 ? roundMoney(totalDistributed - earnedRaw) : 0;
    const earnedProfitsPool = roundMoney(Math.max(earnedRaw, totalDistributed));
    const availableProfit = roundMoney(Math.max(0, earnedProfitsPool - totalWithdrawnProfits));
    const retainedProfits = availableProfit;
    const currentBalanceFromTx = roundMoney(totalDistributed - totalWithdrawnProfits);
    const totalNetValue = roundMoney(model.currentCapital + availableProfit);

    // Chronological ledger for this shareholder
    const ledgerEntries: Array<{
      id: string;
      date: string;
      type: 'initial_capital' | 'capital_deposit' | 'capital_withdrawal' | 'profit_allocation' | 'profit_distribution' | 'profit_withdrawal';
      description: string;
      amount: number;
      capitalDelta: number;
      profitDelta: number;
      runningCapital: number;
      runningProfit: number;
      runningTotalEquity: number;
      createdBy: string;
      isSynthetic?: boolean;
    }> = [];

    let runCap = 0;
    let runProf = 0;

    if (model.initialBaselineCapital > 0) {
      runCap = roundMoney(runCap + model.initialBaselineCapital);
      ledgerEntries.push({
        id: `init-cap-${s.id}`,
        date: model.joinedDate,
        type: 'initial_capital',
        description: 'رأس المال الأساسي عند انضمام الشريك',
        amount: model.initialBaselineCapital,
        capitalDelta: model.initialBaselineCapital,
        profitDelta: 0,
        runningCapital: runCap,
        runningProfit: runProf,
        runningTotalEquity: roundMoney(runCap + runProf),
        createdBy: 'النظام',
        isSynthetic: true,
      });
    }

    for (const tx of allPartnerTxs) {
      const amt = roundMoney(tx.amount);
      let capDelta = 0;
      let profDelta = 0;

      if (tx.type === 'capital_deposit') {
        capDelta = amt;
        runCap = roundMoney(runCap + amt);
      } else if (tx.type === 'capital_withdrawal') {
        capDelta = -amt;
        runCap = roundMoney(Math.max(0, runCap - amt));
      } else if (tx.type === 'profit_distribution') {
        profDelta = amt;
        runProf = roundMoney(runProf + amt);
      } else if (tx.type === 'profit_withdrawal') {
        profDelta = -amt;
        runProf = roundMoney(runProf - amt);
      }

      ledgerEntries.push({
        id: tx.id,
        date: toDatePart(tx.date),
        type: tx.type,
        description: tx.description,
        amount: amt,
        capitalDelta: capDelta,
        profitDelta: profDelta,
        runningCapital: runCap,
        runningProfit: runProf,
        runningTotalEquity: roundMoney(runCap + Math.max(0, runProf)),
        createdBy: tx.created_by || 'النظام',
        isSynthetic: false,
      });
    }

    const unallocatedProfit = roundMoney(Math.max(0, lifetimeRes.netEntitlement) - totalDistributed);
    const effectiveEnd = effectivePeriodEnd;
    if (Math.abs(unallocatedProfit) >= 0.01) {
      if (model.isFounder) {
        const mgmtBonusPortion = roundMoney(
          Math.min(Math.max(0, unallocatedProfit), Math.max(0, lifetimeRes.mgmtFeeEarned || 0))
        );
        const ownCapPortion = roundMoney(unallocatedProfit - mgmtBonusPortion);

        if (Math.abs(ownCapPortion) >= 0.01) {
          runProf = roundMoney(runProf + ownCapPortion);
          ledgerEntries.push({
            id: `live-prof-${s.id}`,
            date: todayStr,
            type: 'profit_allocation',
            description: `صافي ربح رأس المال المباشر (${profitBasis === 'realized' ? 'محقق نقداً' : 'تعاقدي'}) بنسبة (${model.sharePercentage}%)`,
            amount: Math.abs(ownCapPortion),
            capitalDelta: 0,
            profitDelta: ownCapPortion,
            runningCapital: runCap,
            runningProfit: Math.max(0, runProf),
            runningTotalEquity: roundMoney(runCap + Math.max(0, runProf)),
            createdBy: 'محرك الأرباح المحاسبي',
            isSynthetic: true,
          });
        }

        if (mgmtBonusPortion >= 0.01) {
          runProf = roundMoney(runProf + mgmtBonusPortion);
          ledgerEntries.push({
            id: `live-mgmt-${s.id}`,
            date: todayStr,
            type: 'profit_allocation',
            description: `عائد نسبة إدارة أموال المساهمين (حصته ${model.sharePercentage}% من أتعاب الإدارة)`,
            amount: mgmtBonusPortion,
            capitalDelta: 0,
            profitDelta: mgmtBonusPortion,
            runningCapital: runCap,
            runningProfit: Math.max(0, runProf),
            runningTotalEquity: roundMoney(runCap + Math.max(0, runProf)),
            createdBy: 'محرك الأرباح المحاسبي',
            isSynthetic: true,
          });
        }
      } else {
        runProf = roundMoney(runProf + unallocatedProfit);
        ledgerEntries.push({
          id: `live-prof-${s.id}`,
          date: todayStr,
          type: 'profit_allocation',
          description: `صافي حصة أرباح التمويل (${model.sharePercentage}%) بعد خصم نسبة الإدارة للشركاء (${model.managementFeePercentage}%)`,
          amount: Math.abs(unallocatedProfit),
          capitalDelta: 0,
          profitDelta: unallocatedProfit,
          runningCapital: runCap,
          runningProfit: Math.max(0, runProf),
          runningTotalEquity: roundMoney(runCap + Math.max(0, runProf)),
          createdBy: 'محرك الأرباح المحاسبي',
          isSynthetic: true,
        });
      }
    }

    const partnerShareOfDebt = 0;

    const pref = s.payout_preference === 'cash' ? 'cash' : 'capitalize';
    const cycleMonths = s.payout_cycle_months !== null && s.payout_cycle_months !== undefined ? Number(s.payout_cycle_months) : 1;
    const noticeDays = s.payout_notice_days !== null && s.payout_notice_days !== undefined ? Number(s.payout_notice_days) : 15;
    const rawNextPay = s.next_payout_date ? toDatePart(s.next_payout_date) : null;
    const nextPay = pref === 'capitalize' && !rawNextPay
      ? computeNextCycleEndDate(localTodayIso(), cycleMonths || 1)
      : rawNextPay;
    const noticeDeadline = nextPay ? addDaysIso(nextPay, -noticeDays) : null;

    return {
      id: s.id,
      name: s.name,
      phone: s.phone,
      isFounder: model.isFounder,
      includeWarehouseProfit: model.includeWarehouseProfit,
      payoutPreference: pref as 'cash' | 'capitalize' | 'ask',
      payoutCycleMonths: cycleMonths,
      payoutNoticeDays: noticeDays,
      nextPayoutDate: nextPay,
      noticeDeadlineDate: noticeDeadline,
      requestedPayoutAmount:
        s.requested_payout_amount !== null && s.requested_payout_amount !== undefined
          ? roundMoney(s.requested_payout_amount)
          : null,
      sharePercentage: model.sharePercentage,
      managementFeePercentage: model.managementFeePercentage,
      capital: model.currentCapital,
      originalCapital,
      weightedAvgCapital: periodRes.weightedAvgCapital,
      activeDays: periodRes.activeDays,
      currentBalance: roundMoney(s.current_balance),
      joinedDate: model.joinedDate,
      effectiveStartDate: periodFrom && periodFrom > model.joinedDate ? periodFrom : model.joinedDate,
      effectiveEndDate: effectiveEnd,
      notes: s.notes,
      createdAt: formatDate(s.created_at) || model.joinedDate,
      updatedAt: s.updated_at,
      shareRatio: Number((model.sharePercentage / 100).toFixed(4)),
      capitalWeightRatio: Number(capitalWeightRatio.toFixed(4)),
      windowSalesRevenue: totalEffectiveRevenue,
      windowCogs: totalCogs,
      windowExpenses: totalExpenses,
      windowCompanyNetProfit: liveNetProfit,
      grossProfit: periodRes.grossProfit,
      mgmtFee: periodRes.mgmtFee,
      ownCapitalProfit: periodRes.ownCapitalProfit,
      mgmtFeeEarned: periodRes.mgmtFeeEarned,
      netEntitlement: periodRes.netEntitlement,
      lifetimeNetEntitlement: lifetimeRes.netEntitlement,
      totalDeposited,
      totalCapitalWithdrawn,
      totalDistributed,
      totalWithdrawnProfits,
      overDistributedDelta,
      currentBalanceFromTx,
      availableProfit,
      retainedProfits,
      totalNetValue,
      partnerShareOfDebt,
      partnerNetFreeCapital: totalNetValue,
      periodTransactionsCount: periodPartnerTxs.length,
      ledger: ledgerEntries.reverse(),
    };
  });

  const totalAvailableProfits = roundMoney(
    liveShareholders.reduce((sum: number, s: any) => sum + s.availableProfit, 0)
  );
  const totalWithdrawnProfitsAll = roundMoney(
    liveShareholders.reduce((sum: number, s: any) => sum + s.totalWithdrawnProfits, 0)
  );
  const totalNetEntitlementAll = roundMoney(
    liveShareholders.reduce((sum: number, s: any) => sum + s.netEntitlement, 0)
  );
  const totalInvestorsNetAll = roundMoney(
    liveShareholders.filter((s: any) => !s.isFounder).reduce((sum: number, s: any) => sum + s.netEntitlement, 0)
  );
  const totalFoundersNetAll = roundMoney(
    liveShareholders.filter((s: any) => s.isFounder).reduce((sum: number, s: any) => sum + s.netEntitlement, 0)
  );
  const totalMgmtFeesAll = roundMoney(
    liveShareholders.filter((s: any) => !s.isFounder).reduce((sum: number, s: any) => sum + s.mgmtFee, 0)
  );
  const totalOverDistributedDelta = roundMoney(
    liveShareholders.reduce((sum: number, s: any) => sum + Number(s.overDistributedDelta || 0), 0)
  );

  const totalGrossEquity = roundMoney(totalCapital + totalAvailableProfits);
  const netFreeCapital = totalGrossEquity;

  // Reconciliation check for Accountant Statement
  const allocatedSum = roundMoney(
    totalNetEntitlementAll + periodAllocation.preCapitalProfit + periodAllocation.companyUnclaimedRetainedPool
  );
  const reconciliationVariance = roundMoney(liveNetProfit - allocatedSum);

  // Build global transactions list chronologically using actual booked movements (without injecting future live profits at start)
  const partnerNameById = new Map<string, string>(
    liveShareholders.map((ls: any) => [ls.id, ls.name])
  );
  const runningByShareholder = new Map<string, { cap: number; prof: number }>();
  for (const model of stakeholderModels) {
    runningByShareholder.set(model.id, { cap: roundMoney(model.initialBaselineCapital), prof: 0 });
  }

  const enrichedAscTransactions = transactionsRows.map((row: any) => {
    const state = runningByShareholder.get(row.shareholder_id) || { cap: 0, prof: 0 };
    const amt = roundMoney(row.amount);
    if (row.type === 'capital_deposit') {
      state.cap = roundMoney(state.cap + amt);
    } else if (row.type === 'capital_withdrawal') {
      state.cap = roundMoney(Math.max(0, state.cap - amt));
    } else if (row.type === 'profit_distribution') {
      state.prof = roundMoney(state.prof + amt);
    } else if (row.type === 'profit_withdrawal') {
      state.prof = roundMoney(state.prof - amt);
    }
    runningByShareholder.set(row.shareholder_id, state);

    return {
      id: row.id,
      shareholderId: row.shareholder_id,
      shareholderName: partnerNameById.get(row.shareholder_id) || row.shareholder_name,
      type: row.type,
      amount: amt,
      date: toDatePart(row.date),
      displayDate: formatDate(row.date) || toDatePart(row.date),
      description: row.description,
      createdBy: row.created_by,
      createdAt: formatDate(row.created_at),
      runningCapital: state.cap,
      runningAvailableProfit: state.prof,
      runningTotalEquity: roundMoney(state.cap + Math.max(0, state.prof)),
    };
  });

  const filteredTransactions = enrichedAscTransactions
    .filter((tx: any) => isWithinRange(tx.date, periodFrom, periodTo))
    .reverse();

  return {
    profitBasis,
    liveNetProfit,
    totalSalesRevenue,
    totalCogs,
    totalExpenses,
    totalCapital,
    systemLiveRoi,
    totalAvailableProfits,
    totalWithdrawnProfits: totalWithdrawnProfitsAll,
    totalNetEntitlement: totalNetEntitlementAll,
    totalSupplierDebt,
    totalGrossEquity,
    netFreeCapital,
    periodFrom: periodFrom || null,
    periodTo: periodTo || null,
    accountantReport: {
      profitBasis,
      isFilteredPeriod,
      totalContractGrossRevenue,
      totalEarlySettlementDiscounts,
      totalEffectiveRevenue,
      totalCogs,
      totalCogsFromItems,
      totalCogsFromSubtotalFallback,
      costedByItemsCount,
      costedBySubtotalFallbackCount,
      totalCollectedOnSales,
      periodCashCollections,
      totalDeferredReceivables,
      accrualGrossProfit: allTimeAccrualGrossProfit,
      realizedGrossProfit: allTimeRealizedGrossProfit,
      realizedFinancingProfit,
      realizedWarehouseProfit,
      realizedFromPeriodSales,
      realizedFromPriorSales,
      deferredOnPeriodSales,
      deferredProfits,
      totalExpenses,
      accrualNetProfit,
      realizedNetProfit,
      selectedNetProfit: liveNetProfit,
      preCapitalProfit: periodAllocation.preCapitalProfit,
      companyUnclaimedRetainedPool: periodAllocation.companyUnclaimedRetainedPool,
      totalInvestorsNet: totalInvestorsNetAll,
      totalMgmtFees: totalMgmtFeesAll,
      totalFoundersNet: totalFoundersNetAll,
      totalOverDistributedDelta,
      allocatedSum,
      reconciliationVariance,
      isReconciled: Math.abs(reconciliationVariance) <= 0.05,
      tranches: periodAllocation.trancheAudit.filter((t) => !t.isPreCapital),
      preCapitalTranchesCount: periodAllocation.trancheAudit.filter((t) => t.isPreCapital).length,
      settledPeriods: settlementsRows.map((cp: any) => ({
        id: cp.id,
        periodDate: cp.period_date,
        closedBy: cp.closed_by,
        closedAt: cp.closed_at,
        notes: cp.notes,
      })),
    },
    shareholders: liveShareholders,
    transactions: filteredTransactions,
  };
}

let autoCapitalizePromise: Promise<void> | null = null;

/**
 * Automatically rolls realized available profits into capital for due rollover cycles
 * unless the partner opted out by requesting a cash payout prior to the cycle deadline.
 */
async function autoCapitalizeDueShareholders(db: any): Promise<void> {
  if (autoCapitalizePromise) {
    return autoCapitalizePromise;
  }

  autoCapitalizePromise = (async () => {
    const todayStr = localTodayIso();
    const dueRows = await db.all(
      `SELECT id, name, payout_cycle_months, next_payout_date, payout_preference
       FROM shareholders
       WHERE (payout_preference IS NULL OR payout_preference IN ('capitalize', 'ask'))
         AND next_payout_date IS NOT NULL
         AND LTRIM(RTRIM(next_payout_date)) <> ''
         AND LEFT(LTRIM(RTRIM(next_payout_date)), 10) <= ?
       ORDER BY LEFT(LTRIM(RTRIM(next_payout_date)), 10) ASC, created_at ASC`,
      todayStr
    );

    if (!dueRows || dueRows.length === 0) return;

    for (const row of dueRows) {
      const dueDate = toDatePart(row.next_payout_date);
      if (!dueDate || dueDate > todayStr) continue;
      const cycleMonths = Number(row.payout_cycle_months ?? 1) || 1;

      let nextDueDate: string | null = null;
      if (cycleMonths > 0) {
        nextDueDate = endOfMonthAfterMonths(dueDate, cycleMonths);
        let guard = 0;
        while (nextDueDate <= todayStr && guard < 120) {
          nextDueDate = endOfMonthAfterMonths(nextDueDate, cycleMonths);
          guard++;
        }
      }

      const evalState = await computeShareholdersEngine(db, null, dueDate, 'realized', dueDate);
      const partnerState = evalState.shareholders.find((s: any) => s.id === row.id);
      const available = partnerState ? roundMoney(Math.max(0, partnerState.availableProfit)) : 0;
      const now = new Date().toISOString();

      if (available >= 0.01) {
        let didCapitalize = false;
        await db.withTransaction(async (txDb: any) => {
          const locked = await txDb.get(
            `SELECT id, name, payout_preference, next_payout_date
             FROM shareholders WITH (UPDLOCK, ROWLOCK)
             WHERE id = ?`,
            row.id
          );
          if (!locked) return;
          const lockedDue = locked.next_payout_date ? toDatePart(locked.next_payout_date) : '';
          if (!lockedDue || lockedDue > todayStr || locked.payout_preference === 'cash') return;

          await txDb.run(
            `UPDATE shareholders
             SET capital = capital + ?, payout_preference = 'capitalize', next_payout_date = ?, updated_at = ?
             WHERE id = ?`,
            available,
            nextDueDate,
            now,
            row.id
          );

          await txDb.run(
            `INSERT INTO shareholder_transactions (
              id, shareholder_id, shareholder_name, type, amount, date, description, created_by, created_at
            ) VALUES (?, ?, ?, 'capital_deposit', ?, ?, ?, ?, ?)`,
            uid(),
            row.id,
            locked.name,
            available,
            dueDate,
            `رسملة تلقائية لدورة الأرباح المستحقة بتاريخ ${dueDate}`,
            'النظام التلقائي',
            now
          );

          await txDb.run(
            `INSERT INTO shareholder_transactions (
              id, shareholder_id, shareholder_name, type, amount, date, description, created_by, created_at
            ) VALUES (?, ?, ?, 'profit_withdrawal', ?, ?, ?, ?, ?)`,
            uid(),
            row.id,
            locked.name,
            available,
            dueDate,
            `تحويل ورسملة تلقائية للأرباح إلى رأس المال`,
            'النظام التلقائي',
            now
          );

          await recalculateFoundersPercentages(txDb);
          didCapitalize = true;
        });

        if (didCapitalize) {
          await audit('shareholder.auto_capitalize', 'shareholder', row.id, 'system', {
            name: row.name,
            dueDate,
            amount: available,
            nextDueDate,
          });
          await createSystemNotification(
            'success',
            'رسملة تلقائية لدورة الأرباح',
            `تمت رسملة أرباح ${row.name} تلقائياً بقيمة ${formatMoney(available)} وإضافتها لرأس المال اعتباراً من ${dueDate}`
          ).catch(() => {});
        }
      } else {
        await db.run(
          `UPDATE shareholders SET next_payout_date = ?, updated_at = ? WHERE id = ?`,
          nextDueDate,
          now,
          row.id
        );
      }
    }
  })().finally(() => {
    autoCapitalizePromise = null;
  });

  return autoCapitalizePromise;
}

// GET /shareholders/live-trading
router.get('/live-trading', async (req, res) => {
  try {
    const db = await dbPromise;
    await autoCapitalizeDueShareholders(db);

    const startDate = req.query.periodFrom
      ? String(req.query.periodFrom).slice(0, 10)
      : req.query.startDate
        ? String(req.query.startDate).slice(0, 10)
        : null;
    const endDate = req.query.periodTo
      ? String(req.query.periodTo).slice(0, 10)
      : req.query.endDate
        ? String(req.query.endDate).slice(0, 10)
        : null;
    const profitBasis = req.query.profitBasis === 'accrual' ? 'accrual' : 'realized';

    const [result, counterpart] = await Promise.all([
      computeShareholdersEngine(db, startDate, endDate, profitBasis),
      computeShareholdersEngine(db, startDate, endDate, profitBasis === 'realized' ? 'accrual' : 'realized'),
    ]);

    const realizedEngine = profitBasis === 'realized' ? result : counterpart;
    const accrualEngine = profitBasis === 'accrual' ? result : counterpart;
    const realizedById = new Map<string, any>(realizedEngine.shareholders.map((p: any) => [p.id, p]));
    const accrualById = new Map<string, any>(accrualEngine.shareholders.map((p: any) => [p.id, p]));

    const enrichedShareholders = result.shareholders.map((p: any) => {
      const r = realizedById.get(p.id);
      const a = accrualById.get(p.id);
      const realizedAvailableProfit = roundMoney(Math.max(0, Number(r?.availableProfit ?? p.availableProfit ?? 0)));
      const accrualNetEntitlement = roundMoney(Number(a?.netEntitlement ?? p.netEntitlement ?? 0));
      const accrualAvailableProfit = roundMoney(Math.max(0, Number(a?.availableProfit ?? p.availableProfit ?? 0)));
      const deferredProfit = roundMoney(Math.max(0, accrualAvailableProfit - realizedAvailableProfit));
      return {
        ...p,
        realizedAvailableProfit,
        accrualNetEntitlement,
        accrualAvailableProfit,
        deferredProfit,
      };
    });

    return res.json({
      ...result,
      shareholders: enrichedShareholders,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// POST /shareholders/settle-period — Officially locks unallocated period profits up to periodTo into shareholder_transactions
router.post('/settle-period', async (req: AuthedRequest, res) => {
  const parsed = settlePeriodSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'بيانات إقفال التسوية غير صالحة', errors: parsed.error.format() });
  }

  const { periodFrom, periodTo, notes } = parsed.data;
  const profitBasis = 'realized' as const;
  const now = new Date().toISOString();
  const settleDate = toDatePart(periodTo);

  try {
    const db = await dbPromise;
    // Evaluate entitlements strictly up to settleDate so post-cutoff days never leak into this settlement
    const state = await computeShareholdersEngine(db, null, settleDate, profitBasis, settleDate);

    let settledCount = 0;
    let totalSettledAmount = 0;
    const settlementId = uid();

    await db.withTransaction(async (txDb: any) => {
      for (const s of state.shareholders) {
        const unallocated = roundMoney(Math.max(0, s.lifetimeNetEntitlement) - s.totalDistributed);
        if (unallocated < 0.01) continue;

        await txDb.run(
          'UPDATE shareholders SET current_balance = current_balance + ?, updated_at = ? WHERE id = ?',
          unallocated,
          now,
          s.id
        );

        await txDb.run(
          `INSERT INTO shareholder_transactions (
            id, shareholder_id, shareholder_name, type, amount, date, description, created_by, created_at
          ) VALUES (?, ?, ?, 'profit_distribution', ?, ?, ?, ?, ?)`,
          uid(),
          s.id,
          s.name,
          unallocated,
          settleDate,
          notes || `اعتماد وإقفال تسوية أرباح حتى ${settleDate} (${profitBasis === 'realized' ? 'محقق نقداً' : 'تعاقدي'})`,
          req.user?.name || 'النظام',
          now
        );

        settledCount++;
        totalSettledAmount = roundMoney(totalSettledAmount + unallocated);
      }

      if (settledCount > 0) {
        await txDb.run(
          `INSERT INTO closing_periods (id, period_type, period_date, status, closed_by, closed_at, notes)
           VALUES (?, 'shareholders_settlement', ?, 'closed', ?, ?, ?)`,
          settlementId,
          settleDate,
          req.user?.name || 'المدير العام',
          now,
          notes || `اعتماد أرباح (${settledCount}) شريك/مساهم حتى ${settleDate} (${profitBasis === 'realized' ? 'محقق نقداً' : 'تعاقدي'}) بإجمالي ${formatMoney(totalSettledAmount)}`
        );
      }
    });

    if (settledCount === 0) {
      return res.status(400).json({ message: 'لا توجد أرباح غير معتمدة مستحقة للتسوية حتى هذا التاريخ.' });
    }

    await audit('shareholders.settle_period', 'shareholders', settleDate, req.user?.name || 'system', {
      settlementId,
      periodFrom,
      periodTo: settleDate,
      profitBasis,
      settledCount,
      totalSettledAmount,
    });

    return res.json({
      success: true,
      settlementId,
      settledCount,
      totalSettledAmount,
      message: `تم اعتماد وتثبيت أرباح (${settledCount}) شريك/مساهم بإجمالي ${formatMoney(totalSettledAmount)}.`,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// DELETE /shareholders/settlements/:id — Undoes an approved settlement period and removes its booked profit_distribution rows
router.delete('/settlements/:id', requireAdmin, async (req: AuthedRequest, res) => {
  try {
    const db = await dbPromise;
    let deletedPeriod: any = null;
    let reversedTxCount = 0;

    await db.withTransaction(async (txDb: any) => {
      const cp = await txDb.get(
        `SELECT * FROM closing_periods WHERE id = ? AND period_type = 'shareholders_settlement'`,
        req.params.id
      );
      if (!cp) {
        const err: any = new Error('سجل التسوية غير موجود');
        err.statusCode = 404;
        throw err;
      }
      deletedPeriod = cp;

      const distRows = await txDb.all(
        `SELECT * FROM shareholder_transactions WHERE type = 'profit_distribution' AND created_at = ?`,
        cp.closed_at
      );

      const now = new Date().toISOString();
      for (const tx of distRows) {
        await txDb.run(
          'UPDATE shareholders SET current_balance = CASE WHEN current_balance - ? < 0 THEN 0 ELSE current_balance - ? END, updated_at = ? WHERE id = ?',
          tx.amount,
          tx.amount,
          now,
          tx.shareholder_id
        );
        await txDb.run('DELETE FROM shareholder_transactions WHERE id = ?', tx.id);
        reversedTxCount++;
      }

      await txDb.run('DELETE FROM closing_periods WHERE id = ?', req.params.id);
    });

    await audit('shareholders.unsettle_period', 'shareholders', req.params.id, req.user?.name || 'system', {
      deletedPeriod,
      reversedTxCount,
    });

    return res.json({
      success: true,
      reversedTxCount,
      message: `تم فك وإلغاء التسوية بنجاح وعكس (${reversedTxCount}) قيد توزيع أرباح.`,
    });
  } catch (error: any) {
    return res.status(error?.statusCode || 500).json({ message: error.message || 'Database error' });
  }
});

// GET /shareholders
router.get('/', async (_req, res) => {
  try {
    const db = await dbPromise;
    const rows = await db.all('SELECT * FROM shareholders ORDER BY created_at DESC');
    const mapped = rows.map((row: any) => {
      const cycleMonths = row.payout_cycle_months !== null && row.payout_cycle_months !== undefined ? Number(row.payout_cycle_months) : 3;
      const noticeDays = row.payout_notice_days !== null && row.payout_notice_days !== undefined ? Number(row.payout_notice_days) : 15;
      const nextPay = row.next_payout_date ? toDatePart(row.next_payout_date) : null;
      return {
        id: row.id,
        name: row.name,
        phone: row.phone,
        isFounder: Boolean(row.is_founder),
        includeWarehouseProfit: Boolean(row.is_founder) || Boolean(row.include_warehouse_profit),
        payoutPreference: row.payout_preference === 'cash' ? 'cash' : 'capitalize',
        payoutCycleMonths: cycleMonths,
        payoutNoticeDays: noticeDays,
        nextPayoutDate: nextPay,
        noticeDeadlineDate: nextPay ? addDaysIso(nextPay, -noticeDays) : null,
        sharePercentage: Number(row.share_percentage),
        managementFeePercentage: row.management_fee_percentage ? Number(row.management_fee_percentage) : 0,
        capital: Number(row.capital),
        currentBalance: Number(row.current_balance),
        joinedDate: toDatePart(row.joined_date || row.created_at),
        notes: row.notes,
        createdAt: formatDate(row.created_at) || toDatePart(row.created_at),
        updatedAt: row.updated_at,
      };
    });
    return res.json(mapped);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// POST /shareholders
router.post('/', async (req: AuthedRequest, res) => {
  const parsed = shareholderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid shareholder payload', errors: parsed.error.format() });
  }

  const data = parsed.data;
  const id = uid();
  const now = new Date().toISOString();
  const joinedDate = data.joinedDate ? toDatePart(data.joinedDate) : now.slice(0, 10);
  const isFounder = data.isFounder ? 1 : 0;
  const includeWarehouseProfit = isFounder ? 1 : data.includeWarehouseProfit ? 1 : 0;
  const payoutPreference = data.payoutPreference === 'cash' ? 'cash' : 'capitalize';
  const payoutCycleMonths = Number.isFinite(data.payoutCycleMonths) ? Number(data.payoutCycleMonths) : 1;
  const payoutNoticeDays = Number.isFinite(data.payoutNoticeDays) ? Number(data.payoutNoticeDays) : 15;
  const nextPayoutDate = payoutPreference === 'cash'
    ? (data.nextPayoutDate && String(data.nextPayoutDate).trim() ? toDatePart(data.nextPayoutDate) : null)
    : payoutCycleMonths > 0
      ? computeNextCycleEndDate(joinedDate, payoutCycleMonths)
      : (data.nextPayoutDate && String(data.nextPayoutDate).trim()
          ? toDatePart(data.nextPayoutDate)
          : computeNextCycleEndDate(joinedDate, 1));

  try {
    const db = await dbPromise;
    await db.withTransaction(async (txDb: any) => {
      await txDb.run(
        `INSERT INTO shareholders (
          id, name, phone, share_percentage, management_fee_percentage, capital, current_balance, joined_date, is_founder, include_warehouse_profit, payout_preference, payout_cycle_months, payout_notice_days, next_payout_date, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        data.name,
        data.phone,
        data.sharePercentage,
        data.managementFeePercentage,
        data.capital,
        data.currentBalance,
        joinedDate,
        isFounder,
        includeWarehouseProfit,
        payoutPreference,
        payoutCycleMonths,
        payoutNoticeDays,
        nextPayoutDate,
        data.notes || null,
        now,
        now,
      );

      // Record initial capital in shareholder ledger for audit
      // If isOpeningBalance is true or affectsTreasury is false, it's purely a book-entry founding partner (no payments inserted).
      // If it's a regular new partner added during operations with affectsTreasury=true, record cash inflow in payments!
      if (data.capital > 0) {
        const txId = uid();
        const isOpening = Boolean(data.isOpeningBalance);
        const affectsTreasury = data.affectsTreasury !== false && !isOpening;
        const txDesc = isOpening
          ? 'رأس مال تأسيسي (رصيد افتتاحي دفتري)'
          : 'إيداع رأس مال شريك جديد';

        await txDb.run(
          `INSERT INTO shareholder_transactions (
            id, shareholder_id, shareholder_name, type, amount, date, description, created_by, created_at
          ) VALUES (?, ?, ?, 'capital_deposit', ?, ?, ?, ?, ?)`,
          txId,
          id,
          data.name,
          data.capital,
          joinedDate,
          txDesc,
          req.user?.name || 'system',
          now,
        );

        if (affectsTreasury) {
          const payId = uid();
          const receiptNumber = await generateReceiptNumber(txDb);
          await txDb.run(
            `INSERT INTO payments (
              id, type, amount, description, date, receipt_number, status, channel,
              reference_id, reference_type, affects_customer_balance, created_by, created_at
            ) VALUES (?, 'in', ?, ?, ?, ?, 'posted', ?, ?, 'other', 0, ?, ?)`,
            payId,
            data.capital,
            `إيداع رأس مال شريك جديد - ${data.name}`,
            joinedDate,
            receiptNumber,
            data.channel || 'cash',
            txId,
            req.user?.name || 'system',
            now,
          );
        }
      }

      await recalculateFoundersPercentages(txDb);
    });

    await audit('shareholder.create', 'shareholder', id, req.user?.name || 'system', { ...data, joinedDate });
    if (data.capital > 0 && !data.isOpeningBalance && data.affectsTreasury !== false) {
      await createSystemNotification(
        'success',
        'إيداع رأس مال شريك جديد',
        `تم توريد مبلغ ${formatMoney(data.capital)} بالخزينة لحساب رأس مال الشريك: ${data.name}`,
      );
    }
    return res.status(201).json({ id });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// PUT /shareholders/:id
router.put('/:id', async (req: AuthedRequest, res) => {
  const parsed = shareholderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid shareholder payload', errors: parsed.error.format() });
  }

  const data = parsed.data;
  const now = new Date().toISOString();

  try {
    const db = await dbPromise;
    const existing = await db.get<any>(
      'SELECT id, name, capital, joined_date, is_founder, payout_preference, payout_cycle_months, payout_notice_days, next_payout_date, created_at FROM shareholders WHERE id = ?',
      req.params.id
    );
    if (!existing) {
      return res.status(404).json({ message: 'Shareholder not found' });
    }

    const joinedDate = data.joinedDate
      ? toDatePart(data.joinedDate)
      : toDatePart(existing.joined_date || existing.created_at);
    const isFounder = data.isFounder !== undefined ? (data.isFounder ? 1 : 0) : (existing.is_founder ? 1 : 0);
    const includeWarehouseProfit = isFounder ? 1 : data.includeWarehouseProfit ? 1 : 0;
    const rawPref = req.body?.payoutPreference !== undefined ? data.payoutPreference : (existing.payout_preference || 'capitalize');
    const payoutPreference = rawPref === 'cash' ? 'cash' : 'capitalize';
    const payoutCycleMonths = req.body?.payoutCycleMonths !== undefined
      ? Number(data.payoutCycleMonths)
      : (existing.payout_cycle_months !== null && existing.payout_cycle_months !== undefined ? Number(existing.payout_cycle_months) : 1);
    const payoutNoticeDays = req.body?.payoutNoticeDays !== undefined
      ? Number(data.payoutNoticeDays)
      : (existing.payout_notice_days !== null && existing.payout_notice_days !== undefined ? Number(existing.payout_notice_days) : 15);
    const rawNextPayoutDate = req.body?.nextPayoutDate !== undefined
      ? (data.nextPayoutDate && String(data.nextPayoutDate).trim() ? toDatePart(data.nextPayoutDate) : null)
      : (existing.next_payout_date ? toDatePart(existing.next_payout_date) : null);
    const nextPayoutDate =
      payoutPreference === 'capitalize' && payoutCycleMonths > 0
        ? computeNextCycleEndDate(localTodayIso(), payoutCycleMonths)
        : rawNextPayoutDate;
    const capitalDelta = roundMoney(Number(data.capital || 0) - Number(existing.capital || 0));

    await db.withTransaction(async (txDb: any) => {
      await txDb.run(
        `UPDATE shareholders
         SET name = ?, phone = ?, share_percentage = ?, management_fee_percentage = ?, capital = ?, current_balance = ?, joined_date = ?, is_founder = ?, include_warehouse_profit = ?, payout_preference = ?, payout_cycle_months = ?, payout_notice_days = ?, next_payout_date = ?, notes = ?, updated_at = ?
         WHERE id = ?`,
        data.name,
        data.phone,
        data.sharePercentage,
        data.managementFeePercentage,
        data.capital,
        data.currentBalance,
        joinedDate,
        isFounder,
        includeWarehouseProfit,
        payoutPreference,
        payoutCycleMonths,
        payoutNoticeDays,
        nextPayoutDate,
        data.notes || null,
        now,
        req.params.id,
      );

      if (data.name !== existing.name) {
        await txDb.run(
          'UPDATE shareholder_transactions SET shareholder_name = ? WHERE shareholder_id = ?',
          data.name,
          req.params.id
        );
      }

      if (Math.abs(capitalDelta) >= 0.01) {
        await txDb.run(
          `INSERT INTO shareholder_transactions (
            id, shareholder_id, shareholder_name, type, amount, date, description, created_by, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          uid(),
          req.params.id,
          data.name,
          capitalDelta > 0 ? 'capital_deposit' : 'capital_withdrawal',
          Math.abs(capitalDelta),
          localTodayIso(),
          'تسوية/تعديل رصيد رأس المال دفترياً',
          req.user?.name || 'system',
          now,
        );
      }

      await recalculateFoundersPercentages(txDb);
    });

    await audit('shareholder.update', 'shareholder', req.params.id, req.user?.name || 'system', { ...data, joinedDate, payoutPreference, payoutCycleMonths, payoutNoticeDays, nextPayoutDate });
    return res.json({ message: 'Shareholder updated successfully' });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// PATCH /shareholders/:id/payout-preference — Fast 1-click election & review schedule update
router.patch('/:id/payout-preference', async (req: AuthedRequest, res) => {
  const parsed = payoutPreferenceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'بيانات تفضيل الأرباح غير صالحة', errors: parsed.error.format() });
  }

  const { payoutPreference, payoutCycleMonths, payoutNoticeDays, nextPayoutDate, requestedPayoutAmount } = parsed.data;
  const normalizedPref = payoutPreference === 'cash' ? 'cash' : 'capitalize';
  const now = new Date().toISOString();

  try {
    const db = await dbPromise;
    await db.run(
      "IF COL_LENGTH('shareholders', 'requested_payout_amount') IS NULL ALTER TABLE shareholders ADD requested_payout_amount DECIMAL(18, 2) NULL",
    );
    const existing = await db.get<any>(
      'SELECT id, name, payout_cycle_months, payout_notice_days, next_payout_date, requested_payout_amount FROM shareholders WHERE id = ?',
      req.params.id
    );
    if (!existing) {
      return res.status(404).json({ message: 'الشريك غير موجود' });
    }

    const effectiveCycle =
      payoutCycleMonths !== undefined
        ? payoutCycleMonths
        : existing.payout_cycle_months !== null && existing.payout_cycle_months !== undefined
          ? Number(existing.payout_cycle_months)
          : 1;
    const effectiveNoticeDays =
      payoutNoticeDays !== undefined
        ? payoutNoticeDays
        : existing.payout_notice_days !== null && existing.payout_notice_days !== undefined
          ? Number(existing.payout_notice_days)
          : 15;
    const rawNextDate =
      nextPayoutDate !== undefined
        ? (nextPayoutDate && String(nextPayoutDate).trim() ? toDatePart(nextPayoutDate) : null)
        : (existing.next_payout_date ? toDatePart(existing.next_payout_date) : null);
    const effectiveNextDate =
      normalizedPref === 'capitalize' && !rawNextDate
        ? computeNextCycleEndDate(localTodayIso(), effectiveCycle > 0 ? effectiveCycle : 1)
        : rawNextDate;
    const effectiveRequestedAmount =
      normalizedPref === 'capitalize'
        ? null
        : requestedPayoutAmount !== undefined
          ? (requestedPayoutAmount !== null && Number(requestedPayoutAmount) > 0 ? roundMoney(requestedPayoutAmount) : null)
          : (existing.requested_payout_amount !== null && existing.requested_payout_amount !== undefined
            ? roundMoney(existing.requested_payout_amount)
            : null);
    const noticeDeadlineDate = effectiveNextDate ? addDaysIso(effectiveNextDate, -effectiveNoticeDays) : null;

    await db.run(
      `UPDATE shareholders
       SET payout_preference = ?, payout_cycle_months = ?, payout_notice_days = ?, next_payout_date = ?, requested_payout_amount = ?, updated_at = ?
       WHERE id = ?`,
      normalizedPref,
      effectiveCycle,
      effectiveNoticeDays,
      effectiveNextDate,
      effectiveRequestedAmount,
      now,
      req.params.id
    );

    await audit('shareholder.payout_preference', 'shareholder', req.params.id, req.user?.name || 'system', {
      name: existing.name,
      payoutPreference: normalizedPref,
      payoutCycleMonths: effectiveCycle,
      payoutNoticeDays: effectiveNoticeDays,
      nextPayoutDate: effectiveNextDate,
      requestedPayoutAmount: effectiveRequestedAmount,
    });

    return res.json({
      message: 'تم تحديث تفضيل توزيع الأرباح بنجاح',
      payoutPreference: normalizedPref,
      payoutCycleMonths: effectiveCycle,
      payoutNoticeDays: effectiveNoticeDays,
      nextPayoutDate: effectiveNextDate,
      requestedPayoutAmount: effectiveRequestedAmount,
      noticeDeadlineDate,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// DELETE /shareholders/transactions/:id
router.delete('/transactions/:id', requireAdmin, async (req: AuthedRequest, res) => {
  try {
    const db = await dbPromise;
    let deletedTx: any = null;

    await db.withTransaction(async (txDb: any) => {
      const tx = await txDb.get('SELECT * FROM shareholder_transactions WHERE id = ?', req.params.id);
      if (!tx) {
        throw new Error('Transaction not found');
      }
      deletedTx = tx;

      const now = new Date().toISOString();
      if (tx.type === 'capital_deposit') {
        await txDb.run(
          'UPDATE shareholders SET capital = CASE WHEN capital - ? < 0 THEN 0 ELSE capital - ? END, updated_at = ? WHERE id = ?',
          tx.amount,
          tx.amount,
          now,
          tx.shareholder_id
        );
      } else if (tx.type === 'capital_withdrawal') {
        await txDb.run('UPDATE shareholders SET capital = capital + ?, updated_at = ? WHERE id = ?', tx.amount, now, tx.shareholder_id);
      } else if (tx.type === 'profit_distribution') {
        await txDb.run('UPDATE shareholders SET current_balance = current_balance - ?, updated_at = ? WHERE id = ?', tx.amount, now, tx.shareholder_id);
      } else if (tx.type === 'profit_withdrawal') {
        await txDb.run('UPDATE shareholders SET current_balance = current_balance + ?, updated_at = ? WHERE id = ?', tx.amount, now, tx.shareholder_id);
      }

      // Reverse associated treasury payment if present
      await txDb.run("DELETE FROM payments WHERE reference_id = ? AND reference_type = 'other'", req.params.id);
      await txDb.run('DELETE FROM shareholder_transactions WHERE id = ?', req.params.id);
      if (tx.type === 'capital_deposit' || tx.type === 'capital_withdrawal') {
        await recalculateFoundersPercentages(txDb);
      }
    });

    if (deletedTx) {
      await audit('shareholder_tx.delete', 'shareholder_transaction', req.params.id, req.user?.name || 'system', deletedTx);
    }
    return res.json({ message: 'Transaction deleted and reversed successfully' });
  } catch (error: any) {
    return res.status(error.message === 'Transaction not found' ? 404 : 500).json({ message: error.message || 'Database error' });
  }
});

// DELETE /shareholders/:id
router.delete('/:id', requireAdmin, async (req: AuthedRequest, res) => {
  try {
    const db = await dbPromise;
    const existing = await db.get('SELECT id FROM shareholders WHERE id = ?', req.params.id);
    if (!existing) {
      return res.status(404).json({ message: 'Shareholder not found' });
    }

    await db.withTransaction(async (txDb: any) => {
      const txRows = await txDb.all('SELECT id FROM shareholder_transactions WHERE shareholder_id = ?', req.params.id);
      for (const tx of txRows) {
        await txDb.run("DELETE FROM payments WHERE reference_id = ? AND reference_type = 'other'", tx.id);
      }
      await txDb.run('DELETE FROM shareholder_transactions WHERE shareholder_id = ?', req.params.id);
      await txDb.run('DELETE FROM shareholders WHERE id = ?', req.params.id);
      await recalculateFoundersPercentages(txDb);
    });

    await audit('shareholder.delete', 'shareholder', req.params.id, req.user?.name || 'system', { id: req.params.id });
    return res.json({ message: 'Shareholder deleted successfully' });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// GET /shareholders/transactions
router.get('/transactions', async (_req, res) => {
  try {
    const db = await dbPromise;
    const rows = await db.all('SELECT * FROM shareholder_transactions ORDER BY date DESC, created_at DESC');
    const mapped = rows.map((row: any) => ({
      id: row.id,
      shareholderId: row.shareholder_id,
      shareholderName: row.shareholder_name,
      type: row.type,
      amount: Number(row.amount),
      date: toDatePart(row.date),
      displayDate: formatDate(row.date) || toDatePart(row.date),
      description: row.description,
      createdBy: row.created_by,
      createdAt: formatDate(row.created_at),
    }));
    return res.json(mapped);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// POST /shareholders/transactions
router.post('/transactions', async (req: AuthedRequest, res) => {
  const parsed = txSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid transaction payload', errors: parsed.error.format() });
  }

  const data = parsed.data;
  try {
    const parsedIso = parseDateInput(data.date);
    data.date = toDatePart(parsedIso);
  } catch (e) {
    return res.status(400).json({ message: e instanceof Error ? e.message : 'Invalid date format' });
  }

  const id = uid();
  const now = new Date().toISOString();

  try {
    const db = await dbPromise;
    if (req.user?.role !== 'admin' && await isPeriodClosed(db, data.date)) {
      return res.status(403).json({ message: 'الفترة المالية مغلقة ولا يمكن تسجيل حركات شركاء فيها إلا بواسطة المدير.' });
    }
    let shareholderName = '';

    // Pre-calculate live trading engine to validate available profit/capital before withdrawal
    const engineState = await computeShareholdersEngine(db, null, null);
    const livePartner = engineState.shareholders.find((s: any) => s.id === data.shareholderId);

    if (!livePartner) {
      return res.status(404).json({ message: 'المساهم غير موجود' });
    }

    if (data.type === 'profit_withdrawal') {
      if (roundMoney(data.amount) > roundMoney(livePartner.availableProfit + 0.01)) {
        return res.status(400).json({
          message: `المبلغ المطلوب سحبه (${data.amount}) يتجاوز الأرباح المحققة المتاحة للسحب من الأقساط (${livePartner.availableProfit}). باقي أرباح البيع مؤجلة لحين تحصيل الأقساط.`,
        });
      }
    } else if (data.type === 'capital_withdrawal') {
      if (roundMoney(data.amount) > roundMoney(livePartner.capital + 0.01)) {
        return res.status(400).json({
          message: `المبلغ المطلوب سحبه من رأس المال (${data.amount}) يتجاوز رأس المال الفعلي (${livePartner.capital})`,
        });
      }
    }

    await db.withTransaction(async (txDb: any) => {
      const shareholder = await txDb.get(
        'SELECT name, capital, current_balance, payout_preference, payout_cycle_months, payout_notice_days, next_payout_date, requested_payout_amount FROM shareholders WITH (UPDLOCK, ROWLOCK) WHERE id = ?',
        data.shareholderId,
      );

      if (!shareholder) {
        throw new Error('Shareholder not found');
      }
      shareholderName = shareholder.name;

      // Re-verify withdrawal limits inside the locked transaction to prevent concurrent over-withdrawals
      if (data.type === 'capital_withdrawal') {
        const liveCapital = roundMoney(Number(shareholder.capital || 0));
        if (roundMoney(data.amount) > roundMoney(liveCapital + 0.01)) {
          const err: any = new Error(`المبلغ المطلوب سحبه من رأس المال (${data.amount}) يتجاوز رأس المال الفعلي (${liveCapital})`);
          err.statusCode = 400;
          throw err;
        }
      } else if (data.type === 'profit_withdrawal') {
        const liveWithdrawnRow = await txDb.get(
          "SELECT COALESCE(SUM(amount), 0) AS total FROM shareholder_transactions WHERE shareholder_id = ? AND type = 'profit_withdrawal'",
          data.shareholderId,
        );
        const alreadyWithdrawn = roundMoney(Number(liveWithdrawnRow?.total || 0));
        const liveAvailable = roundMoney(Math.max(0, livePartner.lifetimeNetEntitlement - alreadyWithdrawn));
        if (roundMoney(data.amount) > roundMoney(liveAvailable + 0.01)) {
          const err: any = new Error(`المبلغ المطلوب سحبه (${data.amount}) يتجاوز الأرباح المتاحة للسحب (${liveAvailable})`);
          err.statusCode = 400;
          throw err;
        }
      }

      // Strictly separate Capital vs Retained Profits / Balance mutations
      if (data.type === 'capital_deposit') {
        await txDb.run(
          'UPDATE shareholders SET capital = capital + ?, updated_at = ? WHERE id = ?',
          data.amount,
          now,
          data.shareholderId
        );
      } else if (data.type === 'capital_withdrawal') {
        await txDb.run(
          'UPDATE shareholders SET capital = CASE WHEN capital - ? < 0 THEN 0 ELSE capital - ? END, updated_at = ? WHERE id = ?',
          data.amount,
          data.amount,
          now,
          data.shareholderId
        );
      } else if (data.type === 'profit_distribution') {
        await txDb.run(
          'UPDATE shareholders SET current_balance = current_balance + ?, updated_at = ? WHERE id = ?',
          data.amount,
          now,
          data.shareholderId
        );
      } else if (data.type === 'profit_withdrawal') {
        const requestedAmt = roundMoney(Number(shareholder.requested_payout_amount || 0));
        const fulfilledRequest = requestedAmt > 0 && roundMoney(data.amount) >= roundMoney(requestedAmt - 0.01);
        const depletedAvailable = roundMoney(livePartner.availableProfit - data.amount) <= 1;
        const shouldResetToAuto =
          shareholder.payout_preference === 'cash' &&
          (fulfilledRequest || (requestedAmt <= 0 && depletedAvailable));
        let nextPayout = shareholder.next_payout_date ? toDatePart(shareholder.next_payout_date) : null;
        let nextRequestedAmount: number | null = requestedAmt > 0 ? requestedAmt : null;
        if (shouldResetToAuto) {
          const cycleMonths = Number(shareholder.payout_cycle_months ?? 1) || 1;
          nextPayout = computeNextCycleEndDate(localTodayIso(), cycleMonths);
          nextRequestedAmount = null;
        } else if (shareholder.payout_preference === 'cash' && requestedAmt > 0) {
          const remReq = roundMoney(Math.max(0, requestedAmt - data.amount));
          nextRequestedAmount = remReq > 0.01 ? remReq : null;
        }
        await txDb.run(
          `UPDATE shareholders
           SET current_balance = current_balance - ?,
               payout_preference = CASE WHEN ? = 1 THEN 'capitalize' ELSE payout_preference END,
               next_payout_date = CASE WHEN ? = 1 THEN ? ELSE next_payout_date END,
               requested_payout_amount = ?,
               updated_at = ?
           WHERE id = ?`,
          data.amount,
          shouldResetToAuto ? 1 : 0,
          shouldResetToAuto ? 1 : 0,
          nextPayout,
          nextRequestedAmount,
          now,
          data.shareholderId
        );
      }

      // Insert shareholder transaction record
      await txDb.run(
        `INSERT INTO shareholder_transactions (
          id, shareholder_id, shareholder_name, type, amount, date, description, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        data.shareholderId,
        shareholder.name,
        data.type,
        data.amount,
        data.date,
        data.description,
        req.user?.name || 'system',
        now,
      );

      if (data.type === 'capital_deposit' || data.type === 'capital_withdrawal') {
        await recalculateFoundersPercentages(txDb);
      }

      // Atomically sync cash flow with Daily Treasury (payments table) if affectsTreasury is true
      if (data.affectsTreasury !== false && (data.type === 'capital_deposit' || data.type === 'capital_withdrawal' || data.type === 'profit_withdrawal')) {
        const payId = uid();
        const receiptNumber = await generateReceiptNumber(txDb);
        const payType = data.type === 'capital_deposit' ? 'in' : 'out';
        const typeLabel =
          data.type === 'capital_deposit'
            ? 'إيداع رأس مال'
            : data.type === 'capital_withdrawal'
              ? 'سحب من رأس المال'
              : 'سحب أرباح محققة';

        await txDb.run(
          `INSERT INTO payments (
            id, type, amount, description, date, receipt_number, status, channel,
            reference_id, reference_type, affects_customer_balance, created_by, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'posted', ?, ?, 'other', 0, ?, ?)`,
          payId,
          payType,
          data.amount,
          `${typeLabel} - الشريك: ${shareholder.name} (${data.description})`,
          data.date,
          receiptNumber,
          data.channel || 'cash',
          id,
          req.user?.name || 'system',
          now,
        );
      }
    });

    await audit('shareholder_tx.create', 'shareholder_transaction', id, req.user?.name || 'system', data);
    if (data.type !== 'profit_distribution') {
      const movementType = data.type === 'capital_deposit' ? 'in' : 'out';
      await createSystemNotification(
        movementType === 'in' ? 'success' : 'warning',
        `حركة شريك ${financialMovementLabel(movementType)}`,
        `${financialMovementLabel(movementType)} ${formatMoney(data.amount)} - ${shareholderName}: ${data.description}`,
      );
    }
    return res.status(201).json({ id });
  } catch (error: any) {
    const status = error.statusCode || (error.message === 'Shareholder not found' ? 404 : 500);
    return res.status(status).json({ message: error.message || 'Database error' });
  }
});

// POST /shareholders/capitalize-profits
router.post('/capitalize-profits', async (req: AuthedRequest, res) => {
  try {
    const db = await dbPromise;
    const now = new Date().toISOString();
    const todayStr = localTodayIso();
    const targetShareholderId = req.body?.shareholderId;

    const engineState = await computeShareholdersEngine(db, null, null);

    // If targetShareholderId is 'all_elected', capitalize all partners with payoutPreference === 'capitalize' and availableProfit > 0.
    // Otherwise target a single partner or all founders when 'all' or omitted.
    const partnersToCapitalize = engineState.shareholders.filter((s: any) => {
      if (targetShareholderId === 'all_elected') {
        return s.payoutPreference === 'capitalize' && s.availableProfit > 0;
      }
      if (targetShareholderId && targetShareholderId !== 'all') {
        return s.id === targetShareholderId && s.availableProfit > 0;
      }
      return s.isFounder && s.availableProfit > 0;
    });

    if (partnersToCapitalize.length === 0) {
      return res.status(400).json({ message: 'لا توجد أرباح متاحة للرسملة حالياً لدى الشركاء المحددين.' });
    }

    let totalCapitalized = 0;
    const capitalizedDetails: { name: string; amount: number }[] = [];

    await db.withTransaction(async (txDb: any) => {
      for (const partner of partnersToCapitalize) {
        const profitToCapitalize = roundMoney(partner.availableProfit);
        if (profitToCapitalize <= 0) continue;

        const cycle = Number(partner.payoutCycleMonths || 0);
        const nextDate = cycle > 0 ? computeNextCycleEndDate(todayStr, cycle) : (partner.nextPayoutDate || null);

        // 1. Add profit to capital and advance review date if cyclic
        await txDb.run(
          'UPDATE shareholders SET capital = capital + ?, next_payout_date = ?, updated_at = ? WHERE id = ?',
          profitToCapitalize,
          nextDate,
          now,
          partner.id
        );

        // 2. Insert capital_deposit transaction
        const depId = uid();
        await txDb.run(
          `INSERT INTO shareholder_transactions (
            id, shareholder_id, shareholder_name, type, amount, date, description, created_by, created_at
          ) VALUES (?, ?, ?, 'capital_deposit', ?, ?, ?, ?, ?)`,
          depId,
          partner.id,
          partner.name,
          profitToCapitalize,
          todayStr,
          `رسملة وتدوير الأرباح المحققة وإضافتها رسمياً إلى رأس المال`,
          req.user?.name || 'مدير النظام',
          now
        );

        // 3. Insert profit_withdrawal transaction to offset availableProfit
        const withId = uid();
        await txDb.run(
          `INSERT INTO shareholder_transactions (
            id, shareholder_id, shareholder_name, type, amount, date, description, created_by, created_at
          ) VALUES (?, ?, ?, 'profit_withdrawal', ?, ?, ?, ?, ?)`,
          withId,
          partner.id,
          partner.name,
          profitToCapitalize,
          todayStr,
          `تحويل ورسملة الأرباح إلى رأس المال`,
          req.user?.name || 'مدير النظام',
          now
        );

        totalCapitalized = roundMoney(totalCapitalized + profitToCapitalize);
        capitalizedDetails.push({ name: partner.name, amount: profitToCapitalize });
      }

      await recalculateFoundersPercentages(txDb);
    });

    await audit('shareholders.capitalize', 'shareholders', 'all', req.user?.name || 'system', {
      totalCapitalized,
      capitalizedDetails,
    });

    await createSystemNotification(
      'success',
      'رسملة وتدوير الأرباح',
      `تمت رسملة أرباح الشركاء بنجاح وإضافتها لرأس المال بقيمة إجمالية ${formatMoney(totalCapitalized)}`
    );

    return res.json({
      success: true,
      totalCapitalized,
      capitalizedDetails,
      message: `تمت رسملة وتدوير الأرباح بنجاح وإضافتها لرأس المال بقيمة إجمالية ${formatMoney(totalCapitalized)}.`,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

export default router;
