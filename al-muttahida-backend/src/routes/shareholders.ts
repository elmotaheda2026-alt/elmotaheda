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

const roundMoney = (val: unknown) => Number(Number(val || 0).toFixed(2));

function toDatePart(dateStr?: string | null): string {
  if (!dateStr) return new Date().toISOString().slice(0, 10);
  const str = String(dateStr).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
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
      `SELECT receipt_number FROM payments WHERE receipt_number LIKE 'RCPT-SH-%' ORDER BY created_at DESC`
    );
    if (row?.receipt_number) {
      const num = parseInt(String(row.receipt_number).replace('RCPT-SH-', ''), 10);
      if (!isNaN(num)) return `RCPT-SH-${num + 1}`;
    }
  } catch (_) {}
  return `RCPT-SH-${Date.now().toString().slice(-6)}`;
}

/**
 * Helper to compute time-weighted shareholder metrics & comprehensive ledger
 */
async function computeShareholdersEngine(
  db: any,
  periodFrom: string | null,
  periodTo: string | null
) {
  const [salesRows, saleItemsRows, expensesRows, shareholdersRows, transactionsRows, suppliersDebtRow] = await Promise.all([
    db.all(`SELECT id, date, total, status FROM sales WHERE status <> 'cancelled'`),
    db.all(
      `SELECT si.sale_id, si.quantity, si.unit_cost, s.date AS sale_date
       FROM sale_items si
       INNER JOIN sales s ON s.id = si.sale_id
       WHERE s.status <> 'cancelled'`
    ),
    db.all(`SELECT id, date, amount, category, description FROM expenses`),
    db.all(`SELECT * FROM shareholders ORDER BY created_at ASC`),
    db.all(`SELECT * FROM shareholder_transactions ORDER BY date ASC, created_at ASC`),
    db.get(`SELECT COALESCE(SUM(balance), 0) AS total_debt FROM suppliers`),
  ]);

  const totalSupplierDebt = roundMoney(Number(suppliersDebtRow?.total_debt || 0));

  // Pre-group COGS by sale_id for fast lookup
  const cogsBySaleId = new Map<string, number>();
  for (const item of saleItemsRows) {
    const cost = Number(item.quantity || 0) * Number(item.unit_cost || 0);
    cogsBySaleId.set(item.sale_id, (cogsBySaleId.get(item.sale_id) || 0) + cost);
  }

  // Global company totals within the selected filter window [periodFrom, periodTo]
  const filteredCompanySales = salesRows.filter((s: any) => isWithinRange(s.date, periodFrom, periodTo));
  const filteredCompanyExpenses = expensesRows.filter((e: any) => isWithinRange(e.date, periodFrom, periodTo));

  const totalSalesRevenue = roundMoney(
    filteredCompanySales.reduce((sum: number, s: any) => sum + Number(s.total || 0), 0)
  );
  const totalCogs = roundMoney(
    filteredCompanySales.reduce((sum: number, s: any) => sum + (cogsBySaleId.get(s.id) || 0), 0)
  );
  const totalExpenses = roundMoney(
    filteredCompanyExpenses.reduce((sum: number, e: any) => sum + Number(e.amount || 0), 0)
  );
  const liveNetProfit = roundMoney(totalSalesRevenue - totalCogs - totalExpenses);

  const totalCapital = roundMoney(
    shareholdersRows.reduce((sum: number, s: any) => sum + Number(s.capital || 0), 0)
  );

  const foundersRows = shareholdersRows.filter((s: any) => Boolean(s.is_founder));
  const rawFoundersShareTotal = foundersRows.reduce(
    (sum: number, s: any) => sum + Number(s.share_percentage || 0),
    0
  ) || 100;

  const systemLiveRoi = totalCapital > 0 ? Number((liveNetProfit / totalCapital).toFixed(4)) : 0;

  // PASS 1: Calculate active window, sales, cogs, expenses, windowCompanyNetProfit, and investors' returns
  const preparedStakeholders = shareholdersRows.map((s: any) => {
    const currentCapital = roundMoney(s.capital);
    const sharePercentage = Number(s.share_percentage || 0);
    const isFounder = Boolean(s.is_founder);
    const managementFeePercentage = s.management_fee_percentage !== null && s.management_fee_percentage !== undefined
      ? Number(s.management_fee_percentage)
      : (100 - sharePercentage);

    const rawJoinedDate = s.joined_date || s.created_at;
    const joinedDate = toDatePart(rawJoinedDate);

    const effectiveStart = periodFrom && periodFrom > joinedDate ? periodFrom : joinedDate;
    const effectiveEnd = periodTo || toDatePart(new Date().toISOString());

    const windowValid = effectiveStart <= effectiveEnd;
    const activeSales = windowValid
      ? salesRows.filter((sale: any) => isWithinRange(sale.date, effectiveStart, effectiveEnd))
      : [];
    const activeExpenses = windowValid
      ? expensesRows.filter((exp: any) => isWithinRange(exp.date, effectiveStart, effectiveEnd))
      : [];

    const windowSalesRevenue = roundMoney(
      activeSales.reduce((sum: number, sale: any) => sum + Number(sale.total || 0), 0)
    );
    const windowCogs = roundMoney(
      activeSales.reduce((sum: number, sale: any) => sum + (cogsBySaleId.get(sale.id) || 0), 0)
    );
    const windowExpenses = roundMoney(
      activeExpenses.reduce((sum: number, exp: any) => sum + Number(exp.amount || 0), 0)
    );
    const windowCompanyNetProfit = roundMoney(windowSalesRevenue - windowCogs - windowExpenses);

    const activePeersCapital = roundMoney(
      shareholdersRows
        .filter((peer: any) => toDatePart(peer.joined_date || peer.created_at) <= effectiveEnd)
        .reduce((sum: number, peer: any) => sum + Number(peer.capital || 0), 0)
    );

    const capitalWeightRatio = activePeersCapital > 0
      ? Number((currentCapital / activePeersCapital).toFixed(6))
      : totalCapital > 0
        ? Number((currentCapital / totalCapital).toFixed(6))
        : 0;

    let grossProfit = 0;
    let netEntitlement = 0;
    let mgmtFee = 0;

    // Model 1 for Silent Investors (مساهم بالتمويل):
    // The investor receives their sharePercentage from the return generated by their capital
    if (!isFounder) {
      if (windowCompanyNetProfit > 0 && capitalWeightRatio > 0) {
        grossProfit = roundMoney(windowCompanyNetProfit * capitalWeightRatio);
        const investorShareRatio = Number((Math.min(100, Math.max(0, sharePercentage)) / 100).toFixed(6));
        netEntitlement = roundMoney(grossProfit * investorShareRatio);
        mgmtFee = roundMoney(grossProfit - netEntitlement);
      } else {
        grossProfit = 0;
        netEntitlement = 0;
        mgmtFee = 0;
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
      activePeersCapital,
      capitalWeightRatio,
      grossProfit,
      netEntitlement,
      mgmtFee,
    };
  });

  // Total net profit distributed to all silent investors
  const totalInvestorsProfit = roundMoney(
    preparedStakeholders
      .filter((p: any) => !p.isFounder)
      .reduce((sum: number, p: any) => sum + p.netEntitlement, 0)
  );

  // PASS 2: Primary Partners (Founders) receive their agreed % of the remaining Partners Pool
  const liveShareholders = preparedStakeholders.map((item: any) => {
    const s = item.s;
    const currentCapital = item.currentCapital;
    const sharePercentage = item.sharePercentage;
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

    if (item.isFounder) {
      // Net profit pool remaining for primary partners after silent investors receive their return
      const foundersNetPool = roundMoney(windowCompanyNetProfit - totalInvestorsProfit);
      const founderShareRatio = rawFoundersShareTotal > 0
        ? Number((sharePercentage / rawFoundersShareTotal).toFixed(6))
        : (1 / (foundersRows.length || 1));

      netEntitlement = roundMoney(foundersNetPool * founderShareRatio);
      grossProfit = netEntitlement;
      mgmtFee = 0;
    }

    // Partner transactions (all-time and period-filtered)
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

    // Reconstruct Original Capital (before subsequent deposits/withdrawals, or initial deposit)
    const netTxCapitalChange = roundMoney(totalDeposited - totalCapitalWithdrawn);
    const initialBaselineCapital = roundMoney(Math.max(0, currentCapital - netTxCapitalChange));
    const originalCapital = initialBaselineCapital > 0 ? initialBaselineCapital : currentCapital;

    // Available Profits / Retained Earnings separation
    const earnedProfitsPool = Math.max(netEntitlement, totalDistributed);
    const availableProfit = roundMoney(Math.max(0, earnedProfitsPool - totalWithdrawnProfits));
    const retainedProfits = availableProfit; // Profits remaining in company compounding into cash flow
    const currentBalanceFromTx = roundMoney(totalDistributed - totalWithdrawnProfits);
    const totalNetValue = roundMoney(currentCapital + availableProfit);

    // Build chronological ledger for this shareholder
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

    // 1. Initial Capital Entry if baseline > 0
    if (initialBaselineCapital > 0) {
      runCap = roundMoney(runCap + initialBaselineCapital);
      ledgerEntries.push({
        id: `init-cap-${s.id}`,
        date: joinedDate,
        type: 'initial_capital',
        description: 'رأس المال الأساسي عند انضمام الشريك',
        amount: initialBaselineCapital,
        capitalDelta: initialBaselineCapital,
        profitDelta: 0,
        runningCapital: runCap,
        runningProfit: runProf,
        runningTotalEquity: roundMoney(runCap + runProf),
        createdBy: 'النظام',
        isSynthetic: true,
      });
    }

    // 2. Real transactions sorted chronologically
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

    // 3. Periodic / Time-Weighted Unallocated Profit Entry
    const unallocatedProfit = roundMoney(netEntitlement - totalDistributed);
    if (Math.abs(unallocatedProfit) >= 0.01) {
      runProf = roundMoney(runProf + unallocatedProfit);
      ledgerEntries.push({
        id: `live-prof-${s.id}`,
        date: effectiveEnd,
        type: 'profit_allocation',
        description: `صافي حصة الأرباح المحققة عن الفترة (${effectiveStart} إلى ${effectiveEnd}) بنسبة مشاركة (${sharePercentage}%)`,
        amount: Math.abs(unallocatedProfit),
        capitalDelta: 0,
        profitDelta: unallocatedProfit,
        runningCapital: runCap,
        runningProfit: Math.max(0, runProf),
        runningTotalEquity: roundMoney(runCap + Math.max(0, runProf)),
        createdBy: 'محرك الأرباح اللحظي',
        isSynthetic: true,
      });
    }

    return {
      id: s.id,
      name: s.name,
      phone: s.phone,
      isFounder: Boolean(s.is_founder),
      sharePercentage,
      managementFeePercentage,
      capital: currentCapital,
      originalCapital,
      currentBalance: roundMoney(s.current_balance),
      joinedDate,
      effectiveStartDate: effectiveStart,
      effectiveEndDate: effectiveEnd,
      notes: s.notes,
      createdAt: formatDate(s.created_at) || joinedDate,
      updatedAt: s.updated_at,
      shareRatio: Number((sharePercentage / 100).toFixed(4)),
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
      currentBalanceFromTx,
      availableProfit,
      retainedProfits,
      totalNetValue,
      partnerShareOfDebt: roundMoney(
        totalSupplierDebt * (item.isFounder
          ? (rawFoundersShareTotal > 0 ? (sharePercentage / rawFoundersShareTotal) : (1 / (foundersRows.length || 1)))
          : 0)
      ),
      partnerNetFreeCapital: roundMoney(
        Math.max(
          0,
          totalNetValue -
            (totalSupplierDebt * (item.isFounder
              ? (rawFoundersShareTotal > 0 ? (sharePercentage / rawFoundersShareTotal) : (1 / (foundersRows.length || 1)))
              : 0))
        )
      ),
      periodTransactionsCount: periodPartnerTxs.length,
      ledger: ledgerEntries.reverse(), // newest first for UI display
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
  const totalGrossEquity = roundMoney(totalCapital + totalAvailableProfits);
  const netFreeCapital = roundMoney(Math.max(0, totalGrossEquity - totalSupplierDebt));

  // Build global transactions list (filtered by period if specified, with running balances attached)
  const runningByShareholder = new Map<string, { cap: number; prof: number }>();
  for (const s of shareholdersRows) {
    const sTxs = transactionsRows.filter((t: any) => t.shareholder_id === s.id);
    const dep = sTxs.filter((t: any) => t.type === 'capital_deposit').reduce((sum: number, t: any) => sum + Number(t.amount || 0), 0);
    const wit = sTxs.filter((t: any) => t.type === 'capital_withdrawal').reduce((sum: number, t: any) => sum + Number(t.amount || 0), 0);
    const baseCap = Math.max(0, Number(s.capital || 0) - (dep - wit));
    const liveS = liveShareholders.find((ls: any) => ls.id === s.id);
    const unalloc = liveS ? Math.max(0, liveS.netEntitlement - liveS.totalDistributed) : 0;
    runningByShareholder.set(s.id, { cap: roundMoney(baseCap), prof: roundMoney(unalloc) });
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
      state.prof = roundMoney(Math.max(0, state.prof - amt));
    }
    runningByShareholder.set(row.shareholder_id, state);

    return {
      id: row.id,
      shareholderId: row.shareholder_id,
      shareholderName: row.shareholder_name,
      type: row.type,
      amount: amt,
      date: toDatePart(row.date),
      displayDate: formatDate(row.date) || toDatePart(row.date),
      description: row.description,
      createdBy: row.created_by,
      createdAt: formatDate(row.created_at),
      runningCapital: state.cap,
      runningAvailableProfit: state.prof,
      runningTotalEquity: roundMoney(state.cap + state.prof),
    };
  });

  const filteredTransactions = enrichedAscTransactions
    .filter((tx: any) => isWithinRange(tx.date, periodFrom, periodTo))
    .reverse();

  return {
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

    const result = await computeShareholdersEngine(db, startDate, endDate);
    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
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
    const existing = await db.get<any>('SELECT id, joined_date, is_founder, created_at FROM shareholders WHERE id = ?', req.params.id);
    if (!existing) {
      return res.status(404).json({ message: 'Shareholder not found' });
    }

    const joinedDate = data.joinedDate
      ? toDatePart(data.joinedDate)
      : toDatePart(existing.joined_date || existing.created_at);
    const isFounder = data.isFounder !== undefined ? (data.isFounder ? 1 : 0) : (existing.is_founder ? 1 : 0);

    await db.run(
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
    const todayStr = toDatePart(now);
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
