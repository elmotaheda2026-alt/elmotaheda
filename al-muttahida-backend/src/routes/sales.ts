import { Router } from 'express';
import { z } from 'zod';
import { dbPromise } from '../db.js';
import { requireAuth, requirePermission, type AuthedRequest } from '../middleware/auth.js';
import { audit } from '../audit.js';
import { uid } from '../utils.js';

const router = Router();
router.use(requireAuth);

router.get('/', requirePermission('sales:read'), async (_req, res) => {
  const db = await dbPromise;
  const rows = await db.all('SELECT * FROM sales ORDER BY created_at DESC');
  return res.json(rows);
});

router.post('/', requirePermission('sales:write'), async (req: AuthedRequest, res) => {
  const schema = z.object({
    customerId: z.string().min(1),
    customerName: z.string().min(1),
    invoiceNumber: z.string().min(1),
    total: z.number().positive(),
    paid: z.number().min(0),
    date: z.string().min(8),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid payload' });

  const remaining = Number((parsed.data.total - parsed.data.paid).toFixed(2));
  const status = remaining <= 0 ? 'completed' : 'pending';
  const id = uid();
  const now = new Date().toISOString();
  const db = await dbPromise;
  await db.run(
    `INSERT INTO sales (id, invoice_number, customer_id, customer_name, total, paid, remaining, status, date, version, locked, last_edited_by, last_edited_at, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?)`,
    id,
    parsed.data.invoiceNumber,
    parsed.data.customerId,
    parsed.data.customerName,
    parsed.data.total,
    parsed.data.paid,
    remaining,
    status,
    parsed.data.date,
    req.user?.name || 'system',
    now,
    req.user?.name || 'system',
    now,
  );
  await audit('sale.create', 'sale', id, req.user?.name || 'system', parsed.data);
  return res.status(201).json({ id });
});

router.put('/:id', requirePermission('sales:write'), async (req: AuthedRequest, res) => {
  const db = await dbPromise;
  const current = await db.get<{ id: string; paid: number; locked: number; version: number }>('SELECT id, paid, locked, version FROM sales WHERE id = ?', req.params.id);
  if (!current) return res.status(404).json({ message: 'Sale not found' });
  if (current.paid > 0 || current.locked === 1) return res.status(409).json({ message: 'Sale is locked and cannot be edited' });

  const schema = z.object({ total: z.number().positive(), paid: z.number().min(0), date: z.string().min(8) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid payload' });

  const remaining = Number((parsed.data.total - parsed.data.paid).toFixed(2));
  const status = remaining <= 0 ? 'completed' : 'pending';
  await db.run(
    `UPDATE sales
     SET total = ?, paid = ?, remaining = ?, status = ?, date = ?, version = ?, last_edited_by = ?, last_edited_at = ?
     WHERE id = ?`,
    parsed.data.total,
    parsed.data.paid,
    remaining,
    status,
    parsed.data.date,
    current.version + 1,
    req.user?.name || 'system',
    new Date().toISOString(),
    req.params.id,
  );
  await audit('sale.update', 'sale', req.params.id, req.user?.name || 'system', parsed.data);
  return res.json({ message: 'Updated' });
});

export default router;
