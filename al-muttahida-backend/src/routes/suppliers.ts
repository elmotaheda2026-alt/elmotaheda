import { Router } from 'express';
import { formatDate } from '../utils.js';
import { z } from 'zod';
import { dbPromise } from '../db.js';
import { requireAuth, requirePermission, type AuthedRequest } from '../middleware/auth.js';
import { audit } from '../audit.js';
import { uid } from '../utils.js';

const router = Router();
router.use(requireAuth);

const supplierSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().email().optional().nullable().or(z.literal('')),
  address: z.string().optional().or(z.literal('')),
  balance: z.number().default(0),
  notes: z.string().optional().nullable(),
});

// GET /suppliers
router.get('/', requirePermission('sales:read'), async (_req, res) => {
  try {
    const db = await dbPromise;
    const rows = await db.all('SELECT * FROM suppliers ORDER BY created_at DESC');
    const mapped = rows.map((row: any) => ({
      ...row,
      balance: Number(row.balance),
      createdAt: formatDate(row.created_at),
      updatedAt: row.updated_at,
    }));
    return res.json(mapped);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// POST /suppliers
router.post('/', requirePermission('sales:write'), async (req: AuthedRequest, res) => {
  const parsed = supplierSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid supplier payload', errors: parsed.error.format() });
  }

  const data = parsed.data;
  const id = uid();
  const now = new Date().toISOString();

  try {
    const db = await dbPromise;
    await db.run(
      `INSERT INTO suppliers (id, name, phone, email, address, balance, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      data.name,
      data.phone,
      data.email || null,
      data.address,
      data.balance,
      data.notes || null,
      now,
      now,
    );

    await audit('supplier.create', 'supplier', id, req.user?.name || 'system', data);
    return res.status(201).json({ id });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// PUT /suppliers/:id
router.put('/:id', requirePermission('sales:write'), async (req: AuthedRequest, res) => {
  const parsed = supplierSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid supplier payload', errors: parsed.error.format() });
  }

  const data = parsed.data;
  const now = new Date().toISOString();

  try {
    const db = await dbPromise;
    const existing = await db.get('SELECT id FROM suppliers WHERE id = ?', req.params.id);
    if (!existing) {
      return res.status(404).json({ message: 'Supplier not found' });
    }

    await db.run(
      `UPDATE suppliers
       SET name = ?, phone = ?, email = ?, address = ?, balance = ?, notes = ?, updated_at = ?
       WHERE id = ?`,
      data.name,
      data.phone,
      data.email || null,
      data.address,
      data.balance,
      data.notes || null,
      now,
      req.params.id,
    );

    await audit('supplier.update', 'supplier', req.params.id, req.user?.name || 'system', data);
    return res.json({ message: 'Supplier updated successfully' });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// DELETE /suppliers/:id
router.delete('/:id', requirePermission('users:manage'), async (req: AuthedRequest, res) => {
  try {
    const db = await dbPromise;
    const existing = await db.get('SELECT id FROM suppliers WHERE id = ?', req.params.id);
    if (!existing) {
      return res.status(404).json({ message: 'Supplier not found' });
    }

    await db.run('DELETE FROM suppliers WHERE id = ?', req.params.id);
    await audit('supplier.delete', 'supplier', req.params.id, req.user?.name || 'system', { id: req.params.id });
    return res.json({ message: 'Supplier deleted successfully' });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

export default router;
