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
  notes: z.string().optional().nullable(),
});

const txSchema = z.object({
  shareholderId: z.string().min(1),
  type: z.enum(['capital_deposit', 'capital_withdrawal', 'profit_distribution', 'profit_withdrawal']),
  amount: z.number().positive(),
  date: z.string().min(8),
  description: z.string().min(1),
});

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

// GET /shareholders/live-trading
router.get('/live-trading', async (req, res) => {
  try {
    const db = await dbPromise;

    const startDate = req.query.periodFrom ? String(req.query.periodFrom) : (req.query.startDate ? String(req.query.startDate) : null);
    const endDate = req.query.periodTo ? String(req.query.periodTo) : (req.query.endDate ? String(req.query.endDate) : null);

    const salesFilter = buildDateFilter('date', startDate, endDate);
    const cogsFilter = buildDateFilter('s.date', startDate, endDate);
    const expensesFilter = buildDateFilter('date', startDate, endDate);

    const [salesRow, cogsRow, expensesRow, shareholdersRows, transactionsRows] = await Promise.all([
      db.get<{ total: number }>(`SELECT COALESCE(SUM(total), 0) AS total FROM sales WHERE status <> 'cancelled'${salesFilter.clause}`, ...salesFilter.args),
      db.get<{ total: number }>(`SELECT COALESCE(SUM(si.quantity * si.unit_cost), 0) AS total FROM sale_items si INNER JOIN sales s ON s.id = si.sale_id WHERE s.status <> 'cancelled'${cogsFilter.clause}`, ...cogsFilter.args),
      db.get<{ total: number }>(`SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE 1=1${expensesFilter.clause}`, ...expensesFilter.args),
      db.all<any>('SELECT * FROM shareholders ORDER BY created_at ASC'),
      db.all<any>('SELECT * FROM shareholder_transactions ORDER BY date DESC, created_at DESC'),
    ]);

    const totalSalesRevenue = Number(Number(salesRow?.total || 0).toFixed(2));
    const totalCogs = Number(Number(cogsRow?.total || 0).toFixed(2));
    const totalExpenses = Number(Number(expensesRow?.total || 0).toFixed(2));
    const liveNetProfit = Number((totalSalesRevenue - totalCogs - totalExpenses).toFixed(2));

    const totalCapital = Number(shareholdersRows.reduce((sum: number, s: any) => sum + Number(s.capital || 0), 0).toFixed(2));
    const systemLiveRoi = totalCapital > 0 ? Number((liveNetProfit / totalCapital).toFixed(4)) : 0;

    const liveShareholders = shareholdersRows.map((s: any) => {
      const capital = Number(s.capital || 0);
      const sharePercentage = Number(s.share_percentage || 0);
      const shareRatio = totalCapital > 0 ? (capital / totalCapital) : (sharePercentage / 100);

      const grossProfit = Number((liveNetProfit * shareRatio).toFixed(2));
      const managementFeePercentage = s.management_fee_percentage ? Number(s.management_fee_percentage) : 0;
      const mgmtFee = Number((grossProfit * (managementFeePercentage / 100)).toFixed(2));
      const netEntitlement = Number((grossProfit - mgmtFee).toFixed(2));

      const sTxs = transactionsRows.filter((t: any) => t.shareholder_id === s.id);
      const totalDeposited = Number(sTxs.filter((t: any) => t.type === 'capital_deposit').reduce((sum: number, t: any) => sum + Number(t.amount || 0), 0).toFixed(2));
      const totalCapitalWithdrawn = Number(sTxs.filter((t: any) => t.type === 'capital_withdrawal').reduce((sum: number, t: any) => sum + Number(t.amount || 0), 0).toFixed(2));
      const totalDistributed = Number(sTxs.filter((t: any) => t.type === 'profit_distribution').reduce((sum: number, t: any) => sum + Number(t.amount || 0), 0).toFixed(2));
      const totalWithdrawnProfits = Number(sTxs.filter((t: any) => t.type === 'profit_withdrawal').reduce((sum: number, t: any) => sum + Number(t.amount || 0), 0).toFixed(2));

      const currentBalanceFromTx = Number((totalDistributed - totalWithdrawnProfits).toFixed(2));
      const availableProfit = Math.max(0, Number((Math.max(netEntitlement, totalDistributed) - totalWithdrawnProfits).toFixed(2)));
      const totalNetValue = Number((capital + availableProfit).toFixed(2));

      return {
        id: s.id,
        name: s.name,
        phone: s.phone,
        sharePercentage,
        managementFeePercentage,
        capital,
        currentBalance: Number(s.current_balance || 0),
        notes: s.notes,
        createdAt: formatDate(s.created_at),
        updatedAt: s.updated_at,
        shareRatio: Number(shareRatio.toFixed(4)),
        grossProfit,
        mgmtFee,
        netEntitlement,
        totalDeposited,
        totalCapitalWithdrawn,
        totalDistributed,
        totalWithdrawnProfits,
        currentBalanceFromTx,
        availableProfit,
        totalNetValue,
      };
    });

    const totalAvailableProfits = Number(liveShareholders.reduce((sum: number, s: any) => sum + s.availableProfit, 0).toFixed(2));

    const mappedTransactions = transactionsRows.map((row: any) => ({
      id: row.id,
      shareholderId: row.shareholder_id,
      shareholderName: row.shareholder_name,
      type: row.type,
      amount: Number(row.amount),
      date: formatDate(row.date),
      description: row.description,
      createdBy: row.created_by,
      createdAt: formatDate(row.created_at),
    }));

    return res.json({
      liveNetProfit,
      totalSalesRevenue,
      totalCogs,
      totalExpenses,
      totalCapital,
      systemLiveRoi,
      totalAvailableProfits,
      shareholders: liveShareholders,
      transactions: mappedTransactions,
    });
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
      sharePercentage: Number(row.share_percentage),
      managementFeePercentage: row.management_fee_percentage ? Number(row.management_fee_percentage) : 0,
      capital: Number(row.capital),
      currentBalance: Number(row.current_balance),
      notes: row.notes,
      createdAt: formatDate(row.created_at),
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

  try {
    const db = await dbPromise;
    await db.run(
      `INSERT INTO shareholders (
        id, name, phone, share_percentage, management_fee_percentage, capital, current_balance, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      data.name,
      data.phone,
      data.sharePercentage,
      data.managementFeePercentage,
      data.capital,
      data.currentBalance,
      data.notes || null,
      now,
      now,
    );

    await audit('shareholder.create', 'shareholder', id, req.user?.name || 'system', data);
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
    const existing = await db.get('SELECT id FROM shareholders WHERE id = ?', req.params.id);
    if (!existing) {
      return res.status(404).json({ message: 'Shareholder not found' });
    }

    await db.run(
      `UPDATE shareholders
       SET name = ?, phone = ?, share_percentage = ?, management_fee_percentage = ?, capital = ?, current_balance = ?, notes = ?, updated_at = ?
       WHERE id = ?`,
      data.name,
      data.phone,
      data.sharePercentage,
      data.managementFeePercentage,
      data.capital,
      data.currentBalance,
      data.notes || null,
      now,
      req.params.id,
    );

    await audit('shareholder.update', 'shareholder', req.params.id, req.user?.name || 'system', data);
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
        await txDb.run('UPDATE shareholders SET capital = capital - ?, updated_at = ? WHERE id = ?', tx.amount, now, tx.shareholder_id);
      } else if (tx.type === 'capital_withdrawal') {
        await txDb.run('UPDATE shareholders SET capital = capital + ?, updated_at = ? WHERE id = ?', tx.amount, now, tx.shareholder_id);
      } else if (tx.type === 'profit_distribution') {
        await txDb.run('UPDATE shareholders SET current_balance = current_balance - ?, updated_at = ? WHERE id = ?', tx.amount, now, tx.shareholder_id);
      } else if (tx.type === 'profit_withdrawal') {
        await txDb.run('UPDATE shareholders SET current_balance = current_balance + ?, updated_at = ? WHERE id = ?', tx.amount, now, tx.shareholder_id);
      }

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

    await db.run('DELETE FROM shareholders WHERE id = ?', req.params.id);
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
      date: formatDate(row.date),
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
  // Parse date input (DD/MM/YYYY) to ISO
  try {
    data.date = parseDateInput(data.date);
  } catch (e) {
    return res.status(400).json({ message: e instanceof Error ? e.message : 'Invalid date format' });
  }
  const id = uid();
  const now = new Date().toISOString();

  try {
    const db = await dbPromise;
    let shareholderName = '';

    await db.withTransaction(async (txDb: any) => {
      const shareholder = await txDb.get(
        'SELECT name, capital, current_balance FROM shareholders WHERE id = ?',
        data.shareholderId,
      );

      if (!shareholder) {
        throw new Error('Shareholder not found');
      }
      shareholderName = shareholder.name;

      // Determine capital or balance change
      let balanceChangeQuery = '';
      if (data.type === 'capital_deposit') {
        balanceChangeQuery = 'UPDATE shareholders SET capital = capital + ?, updated_at = ? WHERE id = ?';
      } else if (data.type === 'capital_withdrawal') {
        balanceChangeQuery = 'UPDATE shareholders SET capital = capital - ?, updated_at = ? WHERE id = ?';
      } else if (data.type === 'profit_distribution') {
        balanceChangeQuery = 'UPDATE shareholders SET current_balance = current_balance + ?, updated_at = ? WHERE id = ?';
      } else if (data.type === 'profit_withdrawal') {
        balanceChangeQuery = 'UPDATE shareholders SET current_balance = current_balance - ?, updated_at = ? WHERE id = ?';
      }

      // Run balance update
      await txDb.run(balanceChangeQuery, data.amount, now, data.shareholderId);

      // Insert transaction
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

export default router;

