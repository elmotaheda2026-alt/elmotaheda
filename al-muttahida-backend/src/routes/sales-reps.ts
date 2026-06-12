import { Router } from 'express';
import { z } from 'zod';
import { dbPromise } from '../db.js';
import { requireAuth, requirePermission, type AuthedRequest } from '../middleware/auth.js';
import { audit } from '../audit.js';
import { uid } from '../utils.js';

const router = Router();
router.use(requireAuth);

const salesRepSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().email().optional().nullable().or(z.literal('')),
  address: z.string().default(''),
  area: z.string().default(''),
  target: z.number().nonnegative().default(0),
  achieved: z.number().nonnegative().default(0),
  commission: z.number().nonnegative().default(0),
  isActive: z.boolean().default(true),
});

// GET /sales-reps
router.get('/', async (_req, res) => {
  try {
    const db = await dbPromise;
    const rows = await db.all('SELECT * FROM sales_reps ORDER BY created_at DESC');
    const mapped = rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      phone: row.phone,
      email: row.email,
      address: row.address,
      area: row.area,
      target: Number(row.target),
      achieved: Number(row.achieved),
      commission: Number(row.commission),
      isActive: row.is_active === 1 || row.is_active === true,
      createdAt: row.created_at,
    }));
    return res.json(mapped);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// POST /sales-reps
router.post('/', requirePermission('users:manage'), async (req: AuthedRequest, res) => {
  const parsed = salesRepSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid sales rep payload', errors: parsed.error.format() });
  }

  const data = parsed.data;
  const id = uid();
  const now = new Date().toISOString();

  try {
    const db = await dbPromise;
    await db.run(
      `INSERT INTO sales_reps (
        id, name, phone, email, address, area, target, achieved, commission, is_active, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      data.name,
      data.phone,
      data.email || null,
      data.address,
      data.area,
      data.target,
      data.achieved,
      data.commission,
      data.isActive ? 1 : 0,
      now,
    );

    await audit('sales_rep.create', 'sales_rep', id, req.user?.name || 'system', data);
    return res.status(201).json({ id });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// PUT /sales-reps/:id
router.put('/:id', requirePermission('users:manage'), async (req: AuthedRequest, res) => {
  const parsed = salesRepSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid sales rep payload', errors: parsed.error.format() });
  }

  const data = parsed.data;

  try {
    const db = await dbPromise;
    const existing = await db.get('SELECT id FROM sales_reps WHERE id = ?', req.params.id);
    if (!existing) {
      return res.status(404).json({ message: 'Sales representative not found' });
    }

    await db.run(
      `UPDATE sales_reps
       SET name = ?, phone = ?, email = ?, address = ?, area = ?, target = ?, achieved = ?, commission = ?, is_active = ?
       WHERE id = ?`,
      data.name,
      data.phone,
      data.email || null,
      data.address,
      data.area,
      data.target,
      data.achieved,
      data.commission,
      data.isActive ? 1 : 0,
      req.params.id,
    );

    await audit('sales_rep.update', 'sales_rep', req.params.id, req.user?.name || 'system', data);
    return res.json({ message: 'Sales representative updated successfully' });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// DELETE /sales-reps/:id
router.delete('/:id', requirePermission('users:manage'), async (req: AuthedRequest, res) => {
  try {
    const db = await dbPromise;
    const existing = await db.get('SELECT id FROM sales_reps WHERE id = ?', req.params.id);
    if (!existing) {
      return res.status(404).json({ message: 'Sales representative not found' });
    }

    await db.run('DELETE FROM sales_reps WHERE id = ?', req.params.id);
    await audit('sales_rep.delete', 'sales_rep', req.params.id, req.user?.name || 'system', { id: req.params.id });
    return res.json({ message: 'Sales representative deleted successfully' });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

export default router;
