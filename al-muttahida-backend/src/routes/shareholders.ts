import { Router } from 'express';
import { formatDate, parseDateInput } from '../utils.js';
import { z } from 'zod';
import { dbPromise } from '../db.js';
import { requireAdmin, requireAuth, requirePermission, type AuthedRequest } from '../middleware/auth.js';
import { audit } from '../audit.js';
import { uid } from '../utils.js';
import { createSystemNotification, financialMovementLabel, formatMoney } from '../financialNotifications.js';

const router = Router();
router.use(requireAuth);
router.use(requirePermission('shareholders:manage'));

const shareholderSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(1),
  sharePercentage: z.number().min(0).max(100),
  managementFeePercentage: z.number().min(0).max(100).optional().default(0),
  capital: z.number().nonnegative().default(0),
  currentBalance: z.number().default(0),
  joinedDate: z.string().optional().nullable(),
  isFounder: z.boolean().optional().default(false),
  notes: z.string().optional().nullable(),
  isOpeningBalance: z.boolean().optional().default(false),
  affectsTreasury: z.boolean().optional().default(true),
});

const txSchema = z.object({
  shareholderId: z.string().min(1),
  type: z.enum(['capital_deposit', 'capital_withdrawal', 'profit_distribution', 'profit_withdrawal']),
  amount: z.number().positive(),
  date: z.string().min(8),
  description: z.string().min(1),
  affectsTreasury: z.boolean().optional().default(true),
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
  realizedProfit: number;
  accrualProfit: number;
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

  const relevantProfits = profitEvents.filter((ev) => ev.date <= evalEnd && (!evalStart || ev.date >= evalStart));
  const relevantExpenses = expenseEvents.filter((ex) => ex.date <= evalEnd && (!evalStart || ex.date >= evalStart));

  const candidateStarts: string[] = [];
  if (evalStart) {
    candidateStarts.push(evalStart);
  } else {
    for (const p of relevantProfits) candidateStarts.push(p.date);
    for (const ex of relevantExpenses) candidateStarts.push(ex.date);
    for (const partner of partners) candidateStarts.push(partner.joinedDate);
  }

  candidateStarts.sort();
  const windowStart = candidateStarts[0] || evalEnd;

  const trancheAudit: Array<{
    fromDate: string;
    toDate: string;
    days: number;
    totalActiveCapital: number;
    grossProfit: number;
    expenses: number;
    netProfit: number;
    roiPerEgp: number;
    isPreCapital: boolean;
    investorsShare: number;
    foundersShare: number;
    companyUnclaimedShare: number;
    partnerCaps: Record<string, number>;
  }> = [];

  if (windowStart <= evalEnd) {
    const splitDatesSet = new Set<string>();
    for (const partner of partners) {
      if (partner.joinedDate > windowStart && partner.joinedDate <= evalEnd) {
        splitDatesSet.add(partner.joinedDate);
      }
      for (const tx of partner.capitalTxs) {
        if (tx.date > windowStart && tx.date <= evalEnd) {
          splitDatesSet.add(tx.date);
        }
      }
    }

    const splitDates = Array.from(splitDatesSet).sort();
    const ranges: Array<{ fromDate: string; toDate: string }> = [];

    if (splitDates.length === 0) {
      ranges.push({ fromDate: windowStart, toDate: evalEnd });
    } else {
      ranges.push({ fromDate: windowStart, toDate: addDaysIso(splitDates[0], -1) });
      for (let i = 0; i < splitDates.length; i++) {
        const start = splitDates[i];
        const end = i + 1 < splitDates.length ? addDaysIso(splitDates[i + 1], -1) : evalEnd;
        if (start <= end) {
          ranges.push({ fromDate: start, toDate: end });
        }
      }
    }

    for (const range of ranges) {
      if (range.fromDate > range.toDate) continue;
      const days = diffDaysInclusive(range.fromDate, range.toDate);
      const partnerCaps: Record<string, number> = {};
      let totalActiveCapital = 0;

      for (const partner of partners) {
        const cap = getPartnerCapitalOnDate(partner, range.fromDate);
        partnerCaps[partner.id] = cap;
        totalActiveCapital = roundMoney(totalActiveCapital + cap);
      }

      const grossProfit = roundMoney(
        relevantProfits
          .filter((ev) => ev.date >= range.fromDate && ev.date <= range.toDate)
          .reduce((sum, ev) => sum + getProfitValue(ev), 0)
      );
      const expenses = roundMoney(
        relevantExpenses
          .filter((ex) => ex.date >= range.fromDate && ex.date <= range.toDate)
          .reduce((sum, ex) => sum + ex.amount, 0)
      );
      const netProfit = roundMoney(grossProfit - expenses);

      const hasActivePartners = partners.some((p) => range.fromDate >= p.joinedDate);
      const isPreCapital = totalActiveCapital <= 0 && !hasActivePartners;

      trancheAudit.push({
        fromDate: range.fromDate,
        toDate: range.toDate,
        days,
        totalActiveCapital,
        grossProfit,
        expenses,
        netProfit,
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
      acc.activeDays += tranche.days;
      acc.weightedCapDays += cap * tranche.days;

      if (!p.isFounder && !tranche.isPreCapital && tranche.totalActiveCapital > 0 && cap > 0) {
        acc.gross += tranche.netProfit * (cap / tranche.totalActiveCapital);
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
  for (const p of partners) {
    if (p.isFounder) founderNetById.set(p.id, 0);
  }

  let preCapitalProfit = 0;
  let companyUnclaimedRetainedPool = 0;

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
    if (!tranche.isPreCapital && tranche.totalActiveCapital > 0) {
      for (const p of partners) {
        if (p.isFounder) continue;
        const acc = investorAccum.get(p.id)!;
        const cap = tranche.partnerCaps[p.id] || 0;
        if (acc.net > 0 && cap > 0) {
          const shareRatio = Math.min(100, Math.max(0, p.sharePercentage)) / 100;
          const take = roundMoney(tranche.netProfit * (cap / tranche.totalActiveCapital) * shareRatio);
          takes.set(p.id, take);
          totalTake = roundMoney(totalTake + take);
        }
      }
    }
    return { takes, totalTake };
  });

  trancheAudit.forEach((tranche, idx) => {
    if (tranche.isPreCapital || (tranche.totalActiveCapital <= 0 && !partners.some((p) => p.isFounder && tranche.fromDate >= p.joinedDate))) {
      preCapitalProfit = roundMoney(preCapitalProfit + tranche.netProfit);
      return;
    }

    const activeFounders = partners.filter((p) => p.isFounder && tranche.fromDate >= p.joinedDate);
    const invSum = trancheInvestorTake[idx].totalTake;
    tranche.investorsShare = invSum;

    const poolAfterInvestors = roundMoney(tranche.netProfit - invSum);
    if (activeFounders.length === 0) {
      companyUnclaimedRetainedPool = roundMoney(companyUnclaimedRetainedPool + poolAfterInvestors);
      tranche.companyUnclaimedShare = poolAfterInvestors;
      return;
    }

    const totalFounderSharePct = activeFounders.reduce((sum, f) => sum + Math.max(0, f.sharePercentage), 0);
    let distributedToFoundersInTranche = 0;

    activeFounders.forEach((founder, fIdx) => {
      const ratio = totalFounderSharePct > 0
        ? Math.max(0, founder.sharePercentage) / totalFounderSharePct
        : 1 / activeFounders.length;
      const portion =
        fIdx === activeFounders.length - 1
          ? roundMoney(poolAfterInvestors - distributedToFoundersInTranche)
          : roundMoney(poolAfterInvestors * ratio);
      distributedToFoundersInTranche = roundMoney(distributedToFoundersInTranche + portion);
      founderNetById.set(founder.id, roundMoney((founderNetById.get(founder.id) || 0) + portion));
    });

    tranche.foundersShare = poolAfterInvestors;
  });

  // Ensure exact zero-variance consistency between investor sum and tranche sums regardless of tranche count
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
    }
  }

  const perPartnerResult = new Map<
    string,
    {
      grossProfit: number;
      netEntitlement: number;
      mgmtFee: number;
      weightedAvgCapital: number;
      activeDays: number;
    }
  >();

  for (const p of partners) {
    const acc = investorAccum.get(p.id)!;
    const weightedAvgCapital = acc.activeDays > 0 ? roundMoney(acc.weightedCapDays / acc.activeDays) : p.currentCapital;
    if (p.isFounder) {
      const fNet = roundMoney(founderNetById.get(p.id) || 0);
      perPartnerResult.set(p.id, {
        grossProfit: fNet,
        netEntitlement: fNet,
        mgmtFee: 0,
        weightedAvgCapital,
        activeDays: acc.activeDays,
      });
    } else {
      perPartnerResult.set(p.id, {
        grossProfit: roundMoney(acc.gross),
        netEntitlement: roundMoney(acc.net),
        mgmtFee: roundMoney(acc.mgmtFee),
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
 * Computes full CPA-grade time-weighted shareholder metrics, realized vs accrual reconciliation, & ledger.
 */
export async function computeShareholdersEngine(
  db: any,
  periodFrom: string | null,
  periodTo: string | null,
  profitBasis: 'realized' | 'accrual' = 'realized',
  evalCeilingDate: string | null = null
) {
  const [salesRows, saleItemsRows, salePaymentsRows, expensesRows, shareholdersRows, transactionsRows, suppliersDebtRow, settlementsRows] = await Promise.all([
    db.all(`SELECT id, invoice_number, date, subtotal, discount, tax, total, paid, remaining, status FROM sales WHERE status <> 'cancelled'`),
    db.all(
      `SELECT si.sale_id, si.quantity, COALESCE(NULLIF(si.unit_cost, 0), pr.purchase_price, 0) AS unit_cost, s.date AS sale_date
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
    db.all(`SELECT id, date, amount, category, description FROM expenses`),
    db.all(`SELECT * FROM shareholders ORDER BY created_at ASC`),
    db.all(`SELECT * FROM shareholder_transactions ORDER BY date ASC, created_at ASC`),
    db.get(`SELECT COALESCE(SUM(balance), 0) AS total_debt FROM suppliers`),
    db.all(`SELECT * FROM closing_periods WHERE period_type = 'shareholders_settlement' ORDER BY period_date DESC`),
  ]);

  const totalSupplierDebt = roundMoney(Number(suppliersDebtRow?.total_debt || 0));

  const saleIdByInvoiceNumber = new Map<string, string>();
  for (const s of salesRows) {
    if (s.invoice_number) {
      saleIdByInvoiceNumber.set(String(s.invoice_number).trim(), s.id);
    }
  }

  // Pre-group COGS by sale_id
  const cogsBySaleId = new Map<string, number>();
  for (const item of saleItemsRows) {
    const cost = Number(item.quantity || 0) * Number(item.unit_cost || 0);
    cogsBySaleId.set(item.sale_id, (cogsBySaleId.get(item.sale_id) || 0) + cost);
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

  // Build exact Profit Events (both Realized Cash & Accrual Contract) + audit breakdown
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
    const profitRatio = effectiveTotal > 0 ? contractProfit / effectiveTotal : 0;
    const collectedCash = Math.min(effectiveTotal, paidAmt);
    const realizedOnSale = roundMoney(collectedCash * profitRatio);

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
      accrualProfit: contractProfit,
      realizedProfit: 0,
      cashAmount: 0,
      fromPeriodSale: inSalePeriod,
    });

    // Realized profit events attributed to exact cash collection dates
    const linked = paymentsBySaleId.get(s.id) || [];
    const sumLinkedNet = roundMoney(linked.reduce((acc, p) => acc + p.signedAmount, 0));
    const linkedClamped = Math.min(collectedCash, Math.max(0, sumLinkedNet));
    const upfrontCash = roundMoney(Math.max(0, collectedCash - linkedClamped));

    if (upfrontCash > 0.001) {
      allProfitEvents.push({
        date: saleDate,
        accrualProfit: 0,
        realizedProfit: Math.abs(profitRatio) > 0 ? roundMoney(upfrontCash * profitRatio) : 0,
        cashAmount: upfrontCash,
        fromPeriodSale: inSalePeriod,
      });
    }

    if (linked.length > 0 && Math.abs(sumLinkedNet) > 0.001) {
      const scale = sumLinkedNet > 0 ? linkedClamped / sumLinkedNet : 1;
      for (const p of linked) {
        const cashPart = roundMoney(p.signedAmount * scale);
        allProfitEvents.push({
          date: p.date,
          accrualProfit: 0,
          realizedProfit: Math.abs(profitRatio) > 0 ? roundMoney(cashPart * profitRatio) : 0,
          cashAmount: cashPart,
          fromPeriodSale: inSalePeriod,
        });
      }
    } else if ((realizedOnSale !== 0 || collectedCash > 0) && upfrontCash === 0 && collectedCash > 0) {
      allProfitEvents.push({
        date: saleDate,
        accrualProfit: 0,
        realizedProfit: realizedOnSale,
        cashAmount: collectedCash,
        fromPeriodSale: inSalePeriod,
      });
    }
  }

  const periodCashProfitEvents = allProfitEvents.filter((ev) => isWithinRange(ev.date, periodFrom, periodTo));
  allTimeRealizedGrossProfit = roundMoney(
    periodCashProfitEvents.reduce((sum, ev) => sum + ev.realizedProfit, 0)
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
  const rawFoundersShareTotal =
    foundersRows.reduce((sum: number, s: any) => sum + Number(s.share_percentage || 0), 0) || 100;

  const systemLiveRoi = totalCapital > 0 ? Number((liveNetProfit / totalCapital).toFixed(4)) : 0;

  // Prepare stakeholder models with exact initial baseline capital & dated capital txs
  const stakeholderModels: StakeholderModel[] = shareholdersRows.map((s: any) => {
    const currentCapital = roundMoney(s.capital);
    const sharePercentage = Number(s.share_percentage || 0);
    const isFounder = Boolean(s.is_founder);
    const managementFeePercentage =
      s.management_fee_percentage !== null && s.management_fee_percentage !== undefined
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
      runProf = roundMoney(runProf + unallocatedProfit);
      ledgerEntries.push({
        id: `live-prof-${s.id}`,
        date: todayStr,
        type: 'profit_allocation',
        description: `صافي حصة الأرباح (${profitBasis === 'realized' ? 'محقق نقداً' : 'تعاقدي'}) المرجحة زمنياً بنسبة (${model.sharePercentage}%)`,
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

    const founderDebtShare = model.isFounder
      ? rawFoundersShareTotal > 0
        ? model.sharePercentage / rawFoundersShareTotal
        : 1 / (foundersRows.length || 1)
      : 0;
    const partnerShareOfDebt = roundMoney(totalSupplierDebt * founderDebtShare);

    return {
      id: s.id,
      name: s.name,
      phone: s.phone,
      isFounder: model.isFounder,
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
      partnerNetFreeCapital: roundMoney(Math.max(0, totalNetValue - partnerShareOfDebt)),
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
  const netFreeCapital = roundMoney(Math.max(0, totalGrossEquity - totalSupplierDebt));

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

// GET /shareholders/live-trading
router.get('/live-trading', async (req, res) => {
  try {
    const db = await dbPromise;
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

    const result = await computeShareholdersEngine(db, startDate, endDate, profitBasis);
    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// POST /shareholders/settle-period — Officially locks unallocated period profits up to periodTo into shareholder_transactions
router.post('/settle-period', requireAdmin, async (req: AuthedRequest, res) => {
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
    const mapped = rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      phone: row.phone,
      isFounder: Boolean(row.is_founder),
      sharePercentage: Number(row.share_percentage),
      managementFeePercentage: row.management_fee_percentage ? Number(row.management_fee_percentage) : 0,
      capital: Number(row.capital),
      currentBalance: Number(row.current_balance),
      joinedDate: toDatePart(row.joined_date || row.created_at),
      notes: row.notes,
      createdAt: formatDate(row.created_at) || toDatePart(row.created_at),
      updatedAt: row.updated_at,
    }));
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

  try {
    const db = await dbPromise;
    await db.withTransaction(async (txDb: any) => {
      await txDb.run(
        `INSERT INTO shareholders (
          id, name, phone, share_percentage, management_fee_percentage, capital, current_balance, joined_date, is_founder, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        data.name,
        data.phone,
        data.sharePercentage,
        data.managementFeePercentage,
        data.capital,
        data.currentBalance,
        joinedDate,
        isFounder,
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
            ) VALUES (?, 'in', ?, ?, ?, ?, 'posted', 'cash', ?, 'other', 0, ?, ?)`,
            payId,
            data.capital,
            `إيداع رأس مال شريك جديد - ${data.name}`,
            joinedDate,
            receiptNumber,
            txId,
            req.user?.name || 'system',
            now,
          );
        }
      }
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
      'SELECT id, name, capital, joined_date, is_founder, created_at FROM shareholders WHERE id = ?',
      req.params.id
    );
    if (!existing) {
      return res.status(404).json({ message: 'Shareholder not found' });
    }

    const joinedDate = data.joinedDate
      ? toDatePart(data.joinedDate)
      : toDatePart(existing.joined_date || existing.created_at);
    const isFounder = data.isFounder !== undefined ? (data.isFounder ? 1 : 0) : (existing.is_founder ? 1 : 0);
    const capitalDelta = roundMoney(Number(data.capital || 0) - Number(existing.capital || 0));

    await db.withTransaction(async (txDb: any) => {
      await txDb.run(
        `UPDATE shareholders
         SET name = ?, phone = ?, share_percentage = ?, management_fee_percentage = ?, capital = ?, current_balance = ?, joined_date = ?, is_founder = ?, notes = ?, updated_at = ?
         WHERE id = ?`,
        data.name,
        data.phone,
        data.sharePercentage,
        data.managementFeePercentage,
        data.capital,
        data.currentBalance,
        joinedDate,
        isFounder,
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
    });

    await audit('shareholder.update', 'shareholder', req.params.id, req.user?.name || 'system', { ...data, joinedDate });
    return res.json({ message: 'Shareholder updated successfully' });
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
          message: `المبلغ المطلوب سحبه (${data.amount}) يتجاوز الأرباح المتاحة للسحب (${livePartner.availableProfit})`,
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
        'SELECT name, capital, current_balance FROM shareholders WHERE id = ?',
        data.shareholderId,
      );

      if (!shareholder) {
        throw new Error('Shareholder not found');
      }
      shareholderName = shareholder.name;

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
        await txDb.run(
          'UPDATE shareholders SET current_balance = current_balance - ?, updated_at = ? WHERE id = ?',
          data.amount,
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
          ) VALUES (?, ?, ?, ?, ?, ?, 'posted', 'cash', ?, 'other', 0, ?, ?)`,
          payId,
          payType,
          data.amount,
          `${typeLabel} - الشريك: ${shareholder.name} (${data.description})`,
          data.date,
          receiptNumber,
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
    return res.status(error.message === 'Shareholder not found' ? 404 : 500).json({ message: error.message || 'Database error' });
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

    // If targetShareholderId is specified and not 'all', capitalize only that partner
    // Otherwise, capitalize all founders who have available profits
    const partnersToCapitalize = engineState.shareholders.filter((s: any) => {
      if (targetShareholderId && targetShareholderId !== 'all') {
        return s.id === targetShareholderId && s.availableProfit > 0;
      }
      return s.isFounder && s.availableProfit > 0;
    });

    if (partnersToCapitalize.length === 0) {
      return res.status(400).json({ message: 'لا توجد أرباح متاحة للرسملة حالياً لدى الشركاء.' });
    }

    let totalCapitalized = 0;
    const capitalizedDetails: { name: string; amount: number }[] = [];

    await db.withTransaction(async (txDb: any) => {
      for (const partner of partnersToCapitalize) {
        const profitToCapitalize = roundMoney(partner.availableProfit);
        if (profitToCapitalize <= 0) continue;

        // 1. Add profit to capital
        await txDb.run(
          'UPDATE shareholders SET capital = capital + ?, updated_at = ? WHERE id = ?',
          profitToCapitalize,
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
