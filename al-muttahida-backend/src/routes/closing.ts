import { Router } from 'express';
import { z } from 'zod';
import { dbPromise } from '../db.js';
import { requireAuth, requirePermission, type AuthedRequest } from '../middleware/auth.js';
import { uid } from '../utils.js';
import { audit } from '../audit.js';

const router = Router();
router.use(requireAuth);

router.post('/close', requirePermission('closing:write'), async (req: AuthedRequest, res) => {
  const schema = z.object({
    periodType: z.enum(['daily', 'monthly']),
    periodDate: z.string().min(7),
    notes: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid payload' });

  const db = await dbPromise;
  const existing = await db.get<{ id: string; status: string }>('SELECT id, status FROM closing_periods WHERE period_type = ? AND period_date = ?', parsed.data.periodType, parsed.data.periodDate);
  if (existing?.status === 'closed') return res.status(409).json({ message: 'Period already closed' });

  if (!existing) {
    await db.run(
      `INSERT INTO closing_periods (id, period_type, period_date, status, closed_by, closed_at, notes)
       VALUES (?, ?, ?, 'closed', ?, ?, ?)`,
      uid(),
      parsed.data.periodType,
      parsed.data.periodDate,
      req.user?.name || 'system',
      new Date().toISOString(),
      parsed.data.notes || null,
    );
  } else {
    await db.run(
      `UPDATE closing_periods
       SET status = 'closed', closed_by = ?, closed_at = ?, notes = ?
       WHERE id = ?`,
      req.user?.name || 'system',
      new Date().toISOString(),
      parsed.data.notes || null,
      existing.id,
    );
  }
  await audit('period.close', 'closing_period', existing?.id || 'new', req.user?.name || 'system', parsed.data);
  return res.json({ message: 'Closed' });
});

router.get('/', requirePermission('reports:read'), async (_req, res) => {
  try {
    const db = await dbPromise;
    const rows = await db.all('SELECT * FROM closing_periods ORDER BY period_date DESC');
    return res.json(rows);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

export default router;
