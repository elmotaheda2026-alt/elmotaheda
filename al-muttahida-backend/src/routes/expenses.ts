import { Router } from 'express';
import { z } from 'zod';
import { dbPromise } from '../db.js';
import { requireAuth, requirePermission, type AuthedRequest } from '../middleware/auth.js';
import { audit } from '../audit.js';
import { uid, formatDate, parseDateInput } from '../utils.js';

const router = Router();
router.use(requireAuth);

const expenseSchema = z.object({
  category: z.string().min(1),
  description: z.string().min(1),
  amount: z.number().positive(),
  date: z.string().min(8),
  receipt: z.string().optional().nullable(),
});

// GET /expenses
router.get('/', requirePermission('payments:read'), async (_req, res) => {
  try {
    const db = await dbPromise;
    const rows = await db.all('SELECT * FROM expenses ORDER BY date DESC, created_at DESC');
    const mapped = rows.map((row: any) => ({
      id: row.id,
      category: row.category,
      description: row.description,
      amount: Number(row.amount),
      date: formatDate(row.date),
      receipt: row.receipt,
      createdBy: row.created_by,
      createdAt: formatDate(row.created_at),
    }));
    return res.json(mapped);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// POST /expenses
router.post('/', requirePermission('payments:write'), async (req: AuthedRequest, res) => {
  const parsed = expenseSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid expense payload', errors: parsed.error.format() });
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
    await db.run(
      `INSERT INTO expenses (
        id, category, description, amount, date, receipt, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      data.category,
      data.description,
      data.amount,
      data.date,
      data.receipt || null,
      req.user?.name || 'system',
      now,
    );

    await audit('expense.create', 'expense', id, req.user?.name || 'system', data);
    return res.status(201).json({ id });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// PUT /expenses/:id
router.put('/:id', requirePermission('payments:write'), async (req: AuthedRequest, res) => {
  const parsed = expenseSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid expense payload', errors: parsed.error.format() });
  }

  const data = parsed.data;
  // Parse date input (DD/MM/YYYY) to ISO
  try {
    data.date = parseDateInput(data.date);
  } catch (e) {
    return res.status(400).json({ message: e instanceof Error ? e.message : 'Invalid date format' });
  }

  try {
    const db = await dbPromise;
    const existing = await db.get('SELECT id FROM expenses WHERE id = ?', req.params.id);
    if (!existing) {
      return res.status(404).json({ message: 'Expense not found' });
    }

    await db.run(
      `UPDATE expenses
       SET category = ?, description = ?, amount = ?, date = ?, receipt = ?
       WHERE id = ?`,
      data.category,
      data.description,
      data.amount,
      data.date,
      data.receipt || null,
      req.params.id,
    );

    await audit('expense.update', 'expense', req.params.id, req.user?.name || 'system', data);
    return res.json({ message: 'Expense updated successfully' });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// DELETE /expenses/:id
router.delete('/:id', requirePermission('payments:write'), async (req: AuthedRequest, res) => {
  try {
    const db = await dbPromise;
    const existing = await db.get('SELECT id FROM expenses WHERE id = ?', req.params.id);
    if (!existing) {
      return res.status(404).json({ message: 'Expense not found' });
    }

    await db.run('DELETE FROM expenses WHERE id = ?', req.params.id);
    await audit('expense.delete', 'expense', req.params.id, req.user?.name || 'system', { id: req.params.id });
    return res.json({ message: 'Expense deleted successfully' });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

export default router;
