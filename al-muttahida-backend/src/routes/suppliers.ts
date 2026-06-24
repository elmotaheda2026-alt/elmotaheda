import { Router } from 'express';
import { formatDate } from '../utils.js';
import { z } from 'zod';
import { dbPromise } from '../db.js';
import { requireAuth, requirePermission, type AuthedRequest } from '../middleware/auth.js';
import { hasPermission } from '../permissions.js';
import type { Permission } from '../types.js';
import { audit } from '../audit.js';
import { uid } from '../utils.js';

const router = Router();
router.use(requireAuth);

function requireAnyPermission(...permissions: Permission[]) {
  return (req: AuthedRequest, res: any, next: any) => {
    if (!req.user) {
      req.user = { userId: 'dev-user-id', role: 'admin', name: 'Dev Admin' };
    }
    const granted = permissions.some((permission) => hasPermission(req.user!.role, permission, req.user!.permissions));
    if (!granted) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    return next();
  };
}

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
router.delete('/:id', requireAnyPermission('users:manage', 'purchases:manage'), async (req: AuthedRequest, res) => {
  const now = new Date().toISOString();

  try {
    const db = await dbPromise;
    const existing = await db.get<{ id: string; name: string; balance: number }>('SELECT id, name, balance FROM suppliers WHERE id = ?', req.params.id);
    if (!existing) {
      return res.status(404).json({ message: 'Supplier not found' });
    }

    if (Number(existing.balance || 0) !== 0) {
      return res.status(400).json({ message: 'لا يمكن حذف المورد لأن لديه رصيد مستحق' });
    }

    const purchases = await db.all<{ id: string; remaining: number }>(
      'SELECT id, remaining FROM purchases WHERE supplier_id = ?',
      req.params.id,
    );
    const purchaseIds = purchases.map((purchase) => purchase.id);

    if (purchaseIds.length) {
      const purchaseItems = await db.all<{ product_id: string; quantity: number }>(
        `SELECT product_id, quantity FROM purchase_items WHERE purchase_id IN (${purchaseIds.map(() => '?').join(',')})`,
        ...purchaseIds,
      );

      for (const item of purchaseItems) {
        await db.run(
          `UPDATE products
           SET quantity = CASE WHEN quantity - ? < 0 THEN 0 ELSE quantity - ? END,
               updated_at = ?
           WHERE id = ?`,
          item.quantity,
          item.quantity,
          now,
          item.product_id,
        );
      }

      await db.run(
        `DELETE FROM payments
         WHERE supplier_id = ?
            OR (reference_type = 'supplier' AND reference_id = ?)
            OR (reference_type = 'purchase' AND reference_id IN (${purchaseIds.map(() => '?').join(',')}))`,
        req.params.id,
        req.params.id,
        ...purchaseIds,
      );
      await db.run(
        `DELETE FROM purchase_items WHERE purchase_id IN (${purchaseIds.map(() => '?').join(',')})`,
        ...purchaseIds,
      );
      await db.run(
        `DELETE FROM purchases WHERE id IN (${purchaseIds.map(() => '?').join(',')})`,
        ...purchaseIds,
      );
    } else {
      await db.run(
        `DELETE FROM payments
         WHERE supplier_id = ?
            OR (reference_type = 'supplier' AND reference_id = ?)`,
        req.params.id,
        req.params.id,
      );
    }

    await db.run('DELETE FROM suppliers WHERE id = ?', req.params.id);
    await audit('supplier.delete', 'supplier', req.params.id, req.user?.name || 'system', {
      id: req.params.id,
      name: existing.name,
      deletedPurchaseIds: purchaseIds,
    });
    return res.json({ message: 'Supplier deleted successfully' });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

export default router;
