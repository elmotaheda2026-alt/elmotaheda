import { Router } from 'express';
import { dbPromise } from '../db.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requirePermission('reports:read'));

const dayMs = 86400000;

const cairoToday = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Cairo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

router.get('/aging', async (req, res) => {
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
     WHERE (sch.amount - sch.paid_amount) > 0`,
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
});

router.get('/collection-rate', async (req, res) => {
  const startDate = req.query.startDate ? String(req.query.startDate) : null;
  const endDate = req.query.endDate ? String(req.query.endDate) : null;
  const db = await dbPromise;
  const filters: string[] = [];
  const args: string[] = [];
  if (startDate) {
    filters.push('date >= ?');
    args.push(startDate);
  }
  if (endDate) {
    filters.push('date <= ?');
    args.push(endDate);
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const billed = await db.get<{ total: number }>(`SELECT COALESCE(SUM(total),0) as total FROM sales ${where}`, ...args);
  const collected = await db.get<{ total: number }>(
    `SELECT COALESCE(SUM(p.amount),0) as total
     FROM payments p
     WHERE p.type='in'
       AND p.status='posted'
       AND (p.sale_id IS NOT NULL OR p.reference_type='sale' OR p.invoice_number IS NOT NULL)
       ${startDate ? 'AND p.date >= ?' : ''}
       ${endDate ? 'AND p.date <= ?' : ''}`,
    ...args,
  );
  const billedValue = billed?.total || 0;
  const collectedValue = collected?.total || 0;
  return res.json({
    billed: billedValue,
    collected: collectedValue,
    rate: billedValue > 0 ? Number(((collectedValue / billedValue) * 100).toFixed(2)) : 0,
  });
});

router.get('/daily-cash', async (req, res) => {
  const date = String(req.query.date || cairoToday());
  const db = await dbPromise;
  const incoming = await db.get<{ total: number }>("SELECT COALESCE(SUM(amount),0) as total FROM payments WHERE type='in' AND status='posted' AND date = ?", date);
  const outgoing = await db.get<{ total: number }>("SELECT COALESCE(SUM(amount),0) as total FROM payments WHERE type='out' AND status='posted' AND date = ?", date);
  const cashIn = incoming?.total || 0;
  const cashOut = outgoing?.total || 0;
  return res.json({ date, cashIn, cashOut, net: cashIn - cashOut });
});


type MetricRow = { total: number };

const money = (value: unknown) => Number(Number(value || 0).toFixed(2));

function buildDateFilter(column: string, startDate: string | null, endDate: string | null) {
  const filters: string[] = [];
  const args: string[] = [];
  if (startDate) {
    filters.push(`${column} >= ?`);
    args.push(startDate);
  }
  if (endDate) {
    filters.push(`${column} <= ?`);
    args.push(endDate);
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
  const salesPeriod = buildDateFilter('date', startDate, endDate);
  const joinedSalesPeriod = buildDateFilter('s.date', startDate, endDate);
  const paymentPeriod = buildDateFilter('p.date', startDate, endDate);
  const db = await dbPromise;

  const [settings, cashIn, cashOut, inventory, customers, suppliers, subscribedCapital, capitalDeposits, capitalWithdrawals, periodSales, periodCogs, periodExpenses, allTimeSales, allTimeCogs, allTimeExpenses, realizedCash] = await Promise.all([
    db.get<{ baseline_capital: number }>('SELECT TOP 1 baseline_capital FROM settings'),
    db.get<MetricRow>("SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE type = 'in' AND status = 'posted'"),
    db.get<MetricRow>("SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE type = 'out' AND status = 'posted'"),
    db.get<MetricRow>('SELECT COALESCE(SUM(quantity * purchase_price),0) AS total FROM products'),
    db.get<MetricRow>("SELECT COALESCE(SUM(remaining),0) AS total FROM sales WHERE status <> 'cancelled' AND remaining > 0"),
    db.get<MetricRow>("SELECT COALESCE(SUM(remaining),0) AS total FROM purchases WHERE status <> 'cancelled' AND remaining > 0"),
    db.get<MetricRow>('SELECT COALESCE(SUM(capital),0) AS total FROM shareholders'),
    db.get<MetricRow>("SELECT COALESCE(SUM(amount),0) AS total FROM shareholder_transactions WHERE type = 'capital_deposit'"),
    db.get<MetricRow>("SELECT COALESCE(SUM(amount),0) AS total FROM shareholder_transactions WHERE type = 'capital_withdrawal'"),
    db.get<MetricRow>(`SELECT COALESCE(SUM(total),0) AS total FROM sales WHERE status <> 'cancelled'${salesPeriod.clause}`, ...salesPeriod.args),
    db.get<MetricRow>(`SELECT COALESCE(SUM(si.quantity * si.unit_cost),0) AS total FROM sale_items si INNER JOIN sales s ON s.id = si.sale_id WHERE s.status <> 'cancelled'${joinedSalesPeriod.clause}`, ...joinedSalesPeriod.args),
    db.get<MetricRow>(`SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE 1 = 1${salesPeriod.clause}`, ...salesPeriod.args),
    db.get<MetricRow>("SELECT COALESCE(SUM(total),0) AS total FROM sales WHERE status <> 'cancelled'"),
    db.get<MetricRow>("SELECT COALESCE(SUM(si.quantity * si.unit_cost),0) AS total FROM sale_items si INNER JOIN sales s ON s.id = si.sale_id WHERE s.status <> 'cancelled'"),
    db.get<MetricRow>('SELECT COALESCE(SUM(amount),0) AS total FROM expenses'),
    db.get<MetricRow>(`SELECT COALESCE(SUM(p.amount),0) AS total FROM payments p WHERE p.type = 'in' AND p.status = 'posted' AND (p.sale_id IS NOT NULL OR p.reference_type = 'sale' OR p.invoice_number IS NOT NULL)${paymentPeriod.clause}`, ...paymentPeriod.args),
  ]);

  const subscribedCapitalValue = money(subscribedCapital?.total);
  const postedCapitalValue = money((capitalDeposits?.total || 0) - (capitalWithdrawals?.total || 0));
  const baselineCapital = money(settings?.baseline_capital || 8500000);
  const paidInCapital = subscribedCapitalValue > 0 ? subscribedCapitalValue : postedCapitalValue > 0 ? postedCapitalValue : baselineCapital;
  const capitalSource = subscribedCapitalValue > 0 ? 'shareholders' : postedCapitalValue > 0 ? 'posted_capital_transactions' : 'system_baseline';
  const allTimeNetProfit = money((allTimeSales?.total || 0) - (allTimeCogs?.total || 0) - (allTimeExpenses?.total || 0));
  const retainedEarnings = allTimeNetProfit;
  const shareholdersEquity = money(paidInCapital + retainedEarnings);
  const cashInSafe = money((cashIn?.total || 0) - (cashOut?.total || 0));
  const totalAssets = money(cashInSafe + (inventory?.total || 0) + (customers?.total || 0));
  const totalLiabilities = money(suppliers?.total);
  const totalEquity = shareholdersEquity;
  const accountingVariance = money(totalAssets - (totalLiabilities + totalEquity));
  const monthSpan = calculateMonthSpan(startDate, endDate);

  return res.json({
    capital: paidInCapital,
    capitalSource,
    baselineCapital,
    cashInSafe,
    inventoryValue: money(inventory?.total),
    totalCustomersBalance: money(customers?.total),
    totalSuppliersBalance: money(suppliers?.total),
    retainedEarnings,
    allTimeNetProfit,
    shareholdersEquity,
    totalAssets,
    totalLiabilities,
    totalEquity,
    accountingVariance,
    isBalanced: Math.abs(accountingVariance) <= 0.01,
    trace: Math.abs(accountingVariance) <= 0.01 ? [] : [
      { account: 'cash_in_safe', expectedDriver: 'posted payments plus shareholder cash movements', amount: cashInSafe },
      { account: 'inventory_at_cost', expectedDriver: 'products.quantity * products.purchase_price', amount: money(inventory?.total) },
      { account: 'receivables', expectedDriver: 'open non-cancelled sales.remaining', amount: money(customers?.total) },
      { account: 'payables', expectedDriver: 'open non-cancelled purchases.remaining', amount: money(suppliers?.total) },
      { account: 'paid_in_capital', expectedDriver: capitalSource, amount: paidInCapital },
      { account: 'retained_earnings', expectedDriver: 'all-time sales - COGS - expenses', amount: retainedEarnings },
    ],
    periodSales: money(periodSales?.total),
    periodCostOfGoodsSold: money(periodCogs?.total),
    periodExpenses: money(periodExpenses?.total),
    monthlyAverageExpenses: money((periodExpenses?.total || 0) / monthSpan),
    expenseMonthSpan: Number(monthSpan.toFixed(4)),
    realizedProfits: money((realizedCash?.total || 0) - (periodCogs?.total || 0) - (periodExpenses?.total || 0)),
    deferredProfits: money((customers?.total || 0) - (periodCogs?.total || 0)),
  });
});

// ── Cached Dashboard Metrics (fast boot endpoint — reads 1 row) ─────────

function mapCacheToResponse(cache: any) {
  const m = (v: unknown) => Number(Number(v || 0).toFixed(2));
  const cashInSafe = m(Number(cache.cash_in_total) - Number(cache.cash_out_total));
  const subscribedCapital = m(cache.subscribed_capital);
  const postedCapital = m(Number(cache.capital_deposits) - Number(cache.capital_withdrawals));
  const paidInCapital = subscribedCapital > 0 ? subscribedCapital : postedCapital > 0 ? postedCapital : 8500000;
  const capitalSource = subscribedCapital > 0 ? 'shareholders' : postedCapital > 0 ? 'posted_capital_transactions' : 'system_baseline';
  const allTimeNetProfit = m(Number(cache.all_time_sales) - Number(cache.all_time_cogs) - Number(cache.all_time_expenses));
  const totalAssets = m(cashInSafe + Number(cache.inventory_value) + Number(cache.customer_receivables));
  const totalLiabilities = m(cache.supplier_payables);
  const totalEquity = m(paidInCapital + allTimeNetProfit);

  return {
    capital: paidInCapital,
    capitalSource,
    cashInSafe,
    inventoryValue: m(cache.inventory_value),
    totalCustomersBalance: m(cache.customer_receivables),
    totalSuppliersBalance: m(cache.supplier_payables),
    retainedEarnings: allTimeNetProfit,
    allTimeNetProfit,
    shareholdersEquity: totalEquity,
    totalAssets,
    totalLiabilities,
    totalEquity,
    accountingVariance: m(totalAssets - (totalLiabilities + totalEquity)),
    isBalanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) <= 0.01,
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

    return res.json(mapCacheToResponse(cache));
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// POST /reports/dashboard/refresh-cache — Force refresh the dashboard cache
router.post('/dashboard/refresh-cache', async (_req, res) => {
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
