import { Router } from 'express';
import { formatDate, parseDateInput } from '../utils.js';
import { z } from 'zod';
import { dbPromise } from '../db.js';
import { requireAuth, requirePermission, type AuthedRequest } from '../middleware/auth.js';
import { audit } from '../audit.js';
import { uid } from '../utils.js';

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

// DELETE /shareholders/:id
router.delete('/:id', async (req: AuthedRequest, res) => {
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
    const shareholder = await db.get<{ name: string; capital: number; current_balance: number }>(
      'SELECT name, capital, current_balance FROM shareholders WHERE id = ?',
      data.shareholderId,
    );

    if (!shareholder) {
      return res.status(404).json({ message: 'Shareholder not found' });
    }

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
    await db.run(balanceChangeQuery, data.amount, now, data.shareholderId);

    // Insert transaction
    await db.run(
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

    await audit('shareholder_tx.create', 'shareholder_transaction', id, req.user?.name || 'system', data);
    return res.status(201).json({ id });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

export default router;
