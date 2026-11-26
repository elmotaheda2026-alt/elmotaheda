import { Router } from 'express';
import { dbPromise } from '../db.js';
import { requireAdmin, requireAuth, requirePermission } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requirePermission('reports:read'));

const dayMs = 86400000;

const cairoToday = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Cairo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

router.get('/aging', async (req, res, next) => {
  try {
    const referenceDate = String(req.query.date || cairoToday());
    const referenceTime = new Date(referenceDate).getTime();
    const db = await dbPromise;
    const schedules = await db.all<{
      sale_id: string;
      invoice_number: string;
      customer_name: string;
      due_date: string;
      amount: number;
      paid_amount: number;
    }>(
      `SELECT s.id as sale_id, s.invoice_number, s.customer_name, sch.due_date, sch.amount, sch.paid_amount
     FROM installment_schedules sch
     JOIN sales s ON s.id = sch.sale_id
     WHERE s.status NOT IN ('cancelled', 'completed', 'settled_early')
       AND sch.status NOT IN ('paid', 'settled_early')
       AND (sch.amount - sch.paid_amount) > 0`,
    );

    const scheduledRows = schedules
      .map((row) => {
        const dueTime = new Date(row.due_date).getTime();
        if (Number.isNaN(dueTime) || dueTime > referenceTime) return null;
        const dpd = Math.floor((referenceTime - dueTime) / dayMs);
        const bucket = dpd <= 30 ? '0-30' : dpd <= 60 ? '31-60' : dpd <= 90 ? '61-90' : '90+';
        return {
          saleId: row.sale_id,
          invoiceNumber: row.invoice_number,
          customerName: row.customer_name,
          remaining: Number((Number(row.amount || 0) - Number(row.paid_amount || 0)).toFixed(2)),
          dpd,
          bucket,
          dueDate: row.due_date,
        };
      })
      .filter(Boolean);

    const unscheduled = await db.all<{
      id: string;
      invoice_number: string;
      customer_name: string;
      remaining: number;
      date: string;
    }>(
      `SELECT s.id, s.invoice_number, s.customer_name, s.remaining, s.date
     FROM sales s
     WHERE s.remaining > 0
       AND NOT EXISTS (SELECT 1 FROM installment_schedules sch WHERE sch.sale_id = s.id)`,
    );

    const unscheduledRows = unscheduled
      .map((row) => {
        const dueTime = new Date(row.date).getTime();
        if (Number.isNaN(dueTime) || dueTime > referenceTime) return null;
        const dpd = Math.floor((referenceTime - dueTime) / dayMs);
        const bucket = dpd <= 30 ? '0-30' : dpd <= 60 ? '31-60' : dpd <= 90 ? '61-90' : '90+';
        return {
          saleId: row.id,
          invoiceNumber: row.invoice_number,
          customerName: row.customer_name,
          remaining: Number(row.remaining || 0),
          dpd,
          bucket,
          dueDate: row.date,
        };
      })
      .filter(Boolean);

    return res.json([...scheduledRows, ...unscheduledRows]);
  } catch (err) {
    return next(err);
  }
});

router.get('/collection-rate', async (req, res, next) => {
  try {
    const startDate = req.query.startDate ? String(req.query.startDate) : null;
    const endDate = req.query.endDate ? String(req.query.endDate) : null;
    const db = await dbPromise;
    const saleFilter = buildDateFilter('date', startDate, endDate);
    const payFilter = buildDateFilter('p.date', startDate, endDate);
    const billed = await db.get<{ total: number }>(
      `SELECT COALESCE(SUM(CASE WHEN status = 'settled_early' THEN paid ELSE total END),0) as total FROM sales WHERE status <> 'cancelled'${saleFilter.clause}`,
      ...saleFilter.args,
    );
    const collected = await db.get<{ total: number }>(
      `SELECT COALESCE(SUM(p.amount),0) as total
     FROM payments p
     WHERE p.type='in'
       AND p.status='posted'
       AND (p.sale_id IS NOT NULL OR p.reference_type='sale' OR p.invoice_number IS NOT NULL)
       ${payFilter.clause}`,
      ...payFilter.args,
    );
    const billedValue = billed?.total || 0;
    const collectedValue = collected?.total || 0;
    return res.json({
      billed: billedValue,
      collected: collectedValue,
      rate: billedValue > 0 ? Number(((collectedValue / billedValue) * 100).toFixed(2)) : 0,
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/daily-cash', async (req, res, next) => {
  try {
    const date = String(req.query.date || cairoToday()).slice(0, 10);
    const db = await dbPromise;
    const dateExpr = normalizedSqlDate('date');
    const incoming = await db.get<{ total: number }>(
      `SELECT COALESCE(SUM(amount),0) as total FROM payments WHERE type='in' AND status='posted' AND COALESCE(reference_type, '') != 'internal_transfer' AND ${dateExpr} = TRY_CONVERT(DATE, ?)`,
      date,
    );
    const outgoing = await db.get<{ total: number }>(
      `SELECT COALESCE(SUM(amount),0) as total FROM payments WHERE type='out' AND status='posted' AND COALESCE(reference_type, '') != 'internal_transfer' AND ${dateExpr} = TRY_CONVERT(DATE, ?)`,
      date,
    );
    const cashIn = incoming?.total || 0;
    const cashOut = outgoing?.total || 0;
    return res.json({ date, cashIn, cashOut, net: cashIn - cashOut });
  } catch (err) {
    return next(err);
  }
});


type MetricRow = { total: number };

const money = (value: unknown) => Number(Number(value || 0).toFixed(2));

function normalizedSqlDate(column: string) {
  return `(CASE WHEN ${column} LIKE '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]%' THEN TRY_CONVERT(DATE, LEFT(${column}, 10)) ELSE TRY_CONVERT(DATE, ${column}) END)`;
}

function buildDateFilter(column: string, startDate: string | null, endDate: string | null) {
  const filters: string[] = [];
  const args: string[] = [];
  const expr = normalizedSqlDate(column);
  if (startDate) {
    filters.push(`${expr} >= TRY_CONVERT(DATE, ?)`);
    args.push(startDate.slice(0, 10));
  }
  if (endDate) {
    filters.push(`${expr} <= TRY_CONVERT(DATE, ?)`);
    args.push(endDate.slice(0, 10));
  }
  return { clause: filters.length ? ` AND ${filters.join(' AND ')}` : '', args };
}

function calculateMonthSpan(startDate: string | null, endDate: string | null) {
  if (!startDate || !endDate) return 12;
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 1;
  const inclusiveDays = Math.floor((end.getTime() - start.getTime()) / dayMs) + 1;
  return Math.max(1, inclusiveDays / 30.44);
}

router.get('/dashboard/metrics', async (req, res) => {
  const startDate = req.query.startDate ? String(req.query.startDate) : null;
  const endDate = req.query.endDate ? String(req.query.endDate) : null;
  const salesPeriod = buildDateFilter('s.date', startDate, endDate);
  const expensePeriod = buildDateFilter('date', startDate, endDate);
  const paymentPeriod = buildDateFilter('p.date', startDate, endDate);
  const db = await dbPromise;

  const saleCostCte = `
    WITH sale_costs AS (
      SELECT
        s.id,
        s.invoice_number,
        s.status,
        s.date,
        s.total,
        s.paid,
        CASE WHEN s.status = 'settled_early' THEN s.paid ELSE s.total END AS eff_total,
        COUNT(si.id) AS item_count,
        COALESCE(SUM(
          si.quantity * COALESCE(si.unit_price, 0) *
          (1.0 - (CASE WHEN COALESCE(si.discount, 0) < 0 THEN 0 WHEN COALESCE(si.discount, 0) > 100 THEN 100 ELSE COALESCE(si.discount, 0) END) / 100.0)
        ), 0) AS cash_base,
        CASE
          WHEN COUNT(si.id) > 0
            THEN SUM(si.quantity * COALESCE(NULLIF(si.unit_cost, 0), pr.purchase_price, 0))
          ELSE COALESCE(s.subtotal, 0)
        END AS sale_cost
      FROM sales s
      LEFT JOIN sale_items si ON si.sale_id = s.id
      LEFT JOIN products pr ON pr.id = si.product_id
      WHERE s.status <> 'cancelled'
      GROUP BY s.id, s.invoice_number, s.status, s.date, s.total, s.paid, s.subtotal
    )
  `;

  const [
    settings,
    cashIn,
    cashOut,
    inventory,
    customers,
    suppliers,
    subscribedCapital,
    capitalDeposits,
    capitalWithdrawals,
    periodSalesSummary,
    periodExpenses,
    allTimeSalesSummary,
    allTimeExpenses,
    realizedCashSummary,
    profitWithdrawals,
    standaloneExpenses,
    allTimeCashPenalties,
    allTimeCancelledRetainedFees,
    periodCashPenalties,
    periodCancelledRetainedFees,
  ] = await Promise.all([
    db.get<{
      baseline_capital: number;
      starting_cash_balance: number;
      starting_receivables: number;
      starting_payables: number;
      starting_inventory_value: number;
    }>('SELECT TOP 1 baseline_capital, starting_cash_balance, starting_receivables, starting_payables, starting_inventory_value FROM settings'),
    db.get<MetricRow>("SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE type = 'in' AND status = 'posted' AND COALESCE(reference_type, '') != 'internal_transfer'"),
    db.get<MetricRow>("SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE type = 'out' AND status = 'posted' AND COALESCE(reference_type, '') != 'internal_transfer'"),
    db.get<MetricRow>('SELECT COALESCE(SUM(quantity * purchase_price),0) AS total FROM products'),
    db.get<MetricRow>('SELECT COALESCE(SUM(balance),0) AS total FROM customers'),
    db.get<MetricRow>('SELECT COALESCE(SUM(balance),0) AS total FROM suppliers'),
    db.get<MetricRow>('SELECT COALESCE(SUM(capital),0) AS total FROM shareholders'),
    db.get<MetricRow>("SELECT COALESCE(SUM(amount),0) AS total FROM shareholder_transactions WHERE type = 'capital_deposit'"),
    db.get<MetricRow>("SELECT COALESCE(SUM(amount),0) AS total FROM shareholder_transactions WHERE type = 'capital_withdrawal'"),
    db.get<{ gross_sales: number; eff_sales: number; early_discounts: number; cogs: number; warehouse_profit: number }>(
      `${saleCostCte}
       SELECT
         COALESCE(SUM(total), 0) AS gross_sales,
         COALESCE(SUM(eff_total), 0) AS eff_sales,
         COALESCE(SUM(total - eff_total), 0) AS early_discounts,
         COALESCE(SUM(sale_cost), 0) AS cogs,
         COALESCE(SUM(
           CASE
             WHEN eff_total <= sale_cost THEN 0
             ELSE
               CASE
                 WHEN (CASE WHEN item_count > 0 THEN (CASE WHEN cash_base < total THEN cash_base ELSE total END) ELSE sale_cost END) <= sale_cost THEN 0
                 WHEN ((CASE WHEN item_count > 0 THEN (CASE WHEN cash_base < total THEN cash_base ELSE total END) ELSE sale_cost END) - sale_cost) < (eff_total - sale_cost)
                   THEN ((CASE WHEN item_count > 0 THEN (CASE WHEN cash_base < total THEN cash_base ELSE total END) ELSE sale_cost END) - sale_cost)
                 ELSE (eff_total - sale_cost)
               END
           END
         ), 0) AS warehouse_profit
       FROM sale_costs s
       WHERE 1 = 1${salesPeriod.clause}`,
      ...salesPeriod.args,
    ),
    db.get<MetricRow>(`SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE 1 = 1${expensePeriod.clause}`, ...expensePeriod.args),
    db.get<{ eff_sales: number; cogs: number }>(
      `${saleCostCte}
       SELECT
         COALESCE(SUM(eff_total), 0) AS eff_sales,
         COALESCE(SUM(sale_cost), 0) AS cogs
       FROM sale_costs`,
    ),
    db.get<MetricRow>('SELECT COALESCE(SUM(amount),0) AS total FROM expenses'),
    db.get<{ cash_collected: number; realized_margin: number }>(
      `${saleCostCte}
       SELECT
         COALESCE(SUM(p.amount), 0) AS cash_collected,
         COALESCE(SUM(
           CASE
             WHEN sc.id IS NOT NULL AND sc.eff_total > 0
               THEN p.amount * ((sc.eff_total - sc.sale_cost) / sc.eff_total)
             ELSE 0
           END
         ), 0) AS realized_margin
       FROM payments p
       LEFT JOIN sale_costs sc
         ON sc.id = p.sale_id
         OR (p.sale_id IS NULL AND p.invoice_number IS NOT NULL AND sc.invoice_number = p.invoice_number)
       WHERE p.type = 'in'
         AND p.status = 'posted'
         AND (p.sale_id IS NOT NULL OR p.reference_type = 'sale' OR p.invoice_number IS NOT NULL)
         ${paymentPeriod.clause}`,
      ...paymentPeriod.args,
    ),
    db.get<MetricRow>("SELECT COALESCE(SUM(amount),0) AS total FROM shareholder_transactions WHERE type = 'profit_withdrawal'"),
    db.get<MetricRow>(`
      SELECT COALESCE(SUM(e.amount), 0) AS total
      FROM expenses e
      WHERE NOT EXISTS (
        SELECT 1 FROM payments p
        WHERE p.type = 'out' AND p.status = 'posted'
          AND p.reference_type = 'expense' AND p.reference_id = e.id
      )
    `),
    db.get<MetricRow>(`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM payments
      WHERE type = 'in' AND status = 'posted'
        AND affects_customer_balance = 0
        AND reference_type = 'sale'
        AND description LIKE N'تحصيل غرامة%'
    `),
    db.get<MetricRow>(`
      SELECT COALESCE(SUM(paid), 0) AS total
      FROM sales
      WHERE status = 'cancelled' AND paid > 0
    `),
    db.get<MetricRow>(
      `SELECT COALESCE(SUM(p.amount), 0) AS total
       FROM payments p
       WHERE p.type = 'in' AND p.status = 'posted'
         AND p.affects_customer_balance = 0
         AND p.reference_type = 'sale'
         AND p.description LIKE N'تحصيل غرامة%'${paymentPeriod.clause}`,
      ...paymentPeriod.args,
    ),
    db.get<MetricRow>(
      `SELECT COALESCE(SUM(s.paid), 0) AS total
       FROM sales s
       WHERE s.status = 'cancelled' AND s.paid > 0${salesPeriod.clause}`,
      ...salesPeriod.args,
    ),
  ]);

  const subscribedCapitalValue = money(subscribedCapital?.total);
  const postedCapitalValue = money((capitalDeposits?.total || 0) - (capitalWithdrawals?.total || 0));
  const baselineCapital = money(settings?.baseline_capital || 8500000);
  const startingCashBalance = money(settings?.starting_cash_balance || 0);
  const startingReceivables = money(settings?.starting_receivables || 0);
  const startingPayables = money(settings?.starting_payables || 0);
  const startingInventoryValue = money(settings?.starting_inventory_value || 0);
  const paidInCapital = subscribedCapitalValue > 0 ? subscribedCapitalValue : postedCapitalValue > 0 ? postedCapitalValue : baselineCapital;
  const capitalSource = subscribedCapitalValue > 0 ? 'shareholders' : postedCapitalValue > 0 ? 'posted_capital_transactions' : 'system_baseline';
  const allTimeOtherOperatingIncome = money((allTimeCashPenalties?.total || 0) + (allTimeCancelledRetainedFees?.total || 0));
  const periodOtherOperatingIncome = money((periodCashPenalties?.total || 0) + (periodCancelledRetainedFees?.total || 0));
  const allTimeNetProfit = money((allTimeSalesSummary?.eff_sales || 0) + allTimeOtherOperatingIncome - (allTimeSalesSummary?.cogs || 0) - (allTimeExpenses?.total || 0));
  const retainedEarnings = money(allTimeNetProfit - (profitWithdrawals?.total || 0));
  const shareholdersEquity = money(paidInCapital + retainedEarnings);
  const cashInSafe = money(startingCashBalance + (cashIn?.total || 0) - (cashOut?.total || 0) - (standaloneExpenses?.total || 0));
  const inventoryValue = money(startingInventoryValue + (inventory?.total || 0));
  const totalCustomersBalance = money(startingReceivables + (customers?.total || 0));
  const totalSuppliersBalance = money(startingPayables + (suppliers?.total || 0));
  const totalAssets = money(cashInSafe + inventoryValue + totalCustomersBalance);
  const totalLiabilities = totalSuppliersBalance;
  const totalEquity = shareholdersEquity;
  const accountingVariance = money(totalAssets - (totalLiabilities + totalEquity));
  const monthSpan = calculateMonthSpan(startDate, endDate);

  const periodGrossSales = money(periodSalesSummary?.gross_sales);
  const periodEffSales = money(periodSalesSummary?.eff_sales);
  const periodEarlySettlementDiscounts = money(periodSalesSummary?.early_discounts);
  const periodCogs = money(periodSalesSummary?.cogs);
  const periodGrossProfit = money(periodEffSales - periodCogs);
  const periodWarehouseProfit = money(periodSalesSummary?.warehouse_profit);
  const periodFinancingProfit = money(Math.max(0, periodGrossProfit - periodWarehouseProfit));
  const periodExpensesTotal = money(periodExpenses?.total);
  const periodOperatingNetProfit = money(periodGrossProfit + periodOtherOperatingIncome - periodExpensesTotal);
  const realizedCashCollections = money(realizedCashSummary?.cash_collected);
  const realizedSaleMargin = money(realizedCashSummary?.realized_margin);
  const realizedNetProfit = money(realizedSaleMargin - periodExpensesTotal);

  return res.json({
    capital: paidInCapital,
    capitalSource,
    baselineCapital,
    cashInSafe,
    inventoryValue,
    totalCustomersBalance,
    totalSuppliersBalance,
    openingBalances: {
      startingCashBalance,
      startingReceivables,
      startingPayables,
      startingInventoryValue,
    },
    retainedEarnings,
    allTimeNetProfit,
    shareholdersEquity,
    totalAssets,
    totalLiabilities,
    totalEquity,
    accountingVariance,
    isBalanced: Math.abs(accountingVariance) <= 0.01,
    trace: Math.abs(accountingVariance) <= 0.01 ? [] : [
      { account: 'cash_in_safe', expectedDriver: 'starting cash + posted payments + shareholder cash movements', amount: cashInSafe },
      { account: 'inventory_at_cost', expectedDriver: 'starting inventory + products.quantity * products.purchase_price', amount: inventoryValue },
      { account: 'receivables', expectedDriver: 'starting receivables + customers.balance', amount: totalCustomersBalance },
      { account: 'payables', expectedDriver: 'starting payables + suppliers.balance', amount: totalSuppliersBalance },
      { account: 'paid_in_capital', expectedDriver: capitalSource, amount: paidInCapital },
      { account: 'retained_earnings', expectedDriver: 'all-time effective sales - COGS - expenses', amount: retainedEarnings },
    ],
    periodGrossSales,
    periodEarlySettlementDiscounts,
    periodSales: periodEffSales,
    periodCostOfGoodsSold: periodCogs,
    periodGrossProfit,
    periodWarehouseProfit,
    periodFinancingProfit,
    periodOperatingNetProfit,
    periodExpenses: periodExpensesTotal,
    monthlyAverageExpenses: money(periodExpensesTotal / monthSpan),
    expenseMonthSpan: Number(monthSpan.toFixed(4)),
    realizedCashCollections,
    realizedSaleMargin,
    realizedProfits: realizedNetProfit,
    deferredProfits: money((customers?.total || 0) - periodCogs),
    warehouseProfit: periodWarehouseProfit,
  });
});

// ── Cached Dashboard Metrics (fast boot endpoint — reads 1 row) ─────────

function mapCacheToResponse(cache: any, opening?: {
  starting_cash_balance?: number;
  starting_receivables?: number;
  starting_payables?: number;
  starting_inventory_value?: number;
}) {
  const m = (v: unknown) => Number(Number(v || 0).toFixed(2));
  const startingCash = m(opening?.starting_cash_balance);
  const startingRec = m(opening?.starting_receivables);
  const startingPay = m(opening?.starting_payables);
  const startingInv = m(opening?.starting_inventory_value);
  const cashInSafe = m(startingCash + Number(cache.cash_in_total) - Number(cache.cash_out_total));
  const inventoryValue = m(startingInv + Number(cache.inventory_value));
  const totalCustomersBalance = m(startingRec + Number(cache.customer_receivables));
  const totalSuppliersBalance = m(startingPay + Number(cache.supplier_payables));
  const subscribedCapital = m(cache.subscribed_capital);
  const postedCapital = m(Number(cache.capital_deposits) - Number(cache.capital_withdrawals));
  const paidInCapital = subscribedCapital > 0 ? subscribedCapital : postedCapital > 0 ? postedCapital : 8500000;
  const capitalSource = subscribedCapital > 0 ? 'shareholders' : postedCapital > 0 ? 'posted_capital_transactions' : 'system_baseline';
  const allTimeNetProfit = m(Number(cache.all_time_sales) - Number(cache.all_time_cogs) - Number(cache.all_time_expenses));
  const totalAssets = m(cashInSafe + inventoryValue + totalCustomersBalance);
  const totalLiabilities = totalSuppliersBalance;
  const totalEquity = m(paidInCapital + allTimeNetProfit);

  return {
    capital: paidInCapital,
    capitalSource,
    cashInSafe,
    inventoryValue,
    totalCustomersBalance,
    totalSuppliersBalance,
    retainedEarnings: allTimeNetProfit,
    allTimeNetProfit,
    shareholdersEquity: totalEquity,
    totalAssets,
    totalLiabilities,
    totalEquity,
    accountingVariance: m(totalAssets - (totalLiabilities + totalEquity)),
    isBalanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) <= 0.01,
    warehouseProfit: m(cache.warehouse_profit || 0),
    totalCustomers: cache.total_customers,
    totalProducts: cache.total_products,
    totalSuppliers: cache.total_suppliers,
    pendingInstallments: cache.pending_installments,
    overdueInstallments: cache.overdue_installments,
    lastRefreshedAt: cache.last_refreshed_at,
    isCached: true,
  };
}

router.get('/dashboard/metrics-cached', async (_req, res) => {
  try {
    const db = await dbPromise;

    let cache = await db.get<any>('SELECT * FROM dashboard_metrics_cache WHERE id = 1');
    if (!cache) {
      // Cache miss — refresh and return
      await db.run('EXEC sp_refresh_dashboard_metrics');
      cache = await db.get<any>('SELECT * FROM dashboard_metrics_cache WHERE id = 1');
      if (!cache) return res.status(500).json({ message: 'Failed to compute metrics' });
    }

    const opening = await db.get<any>(
      'SELECT TOP 1 starting_cash_balance, starting_receivables, starting_payables, starting_inventory_value FROM settings',
    );
    return res.json(mapCacheToResponse(cache, opening));
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// POST /reports/dashboard/refresh-cache — Force refresh the dashboard cache
router.post('/dashboard/refresh-cache', requireAdmin, async (_req, res) => {
  try {
    const db = await dbPromise;
    await db.run('EXEC sp_refresh_dashboard_metrics');
    const cache = await db.get<any>('SELECT * FROM dashboard_metrics_cache WHERE id = 1');
    return res.json({ message: 'Cache refreshed', lastRefreshedAt: cache?.last_refreshed_at });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

export default router;
