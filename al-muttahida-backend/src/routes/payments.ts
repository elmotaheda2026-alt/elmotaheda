import { Router } from 'express';
import { z } from 'zod';
import { dbPromise } from '../db.js';
import { requireAuth, requirePermission, type AuthedRequest } from '../middleware/auth.js';
import { audit } from '../audit.js';
import { uid } from '../utils.js';

const router = Router();
router.use(requireAuth);

async function nextReceiptNumber() {
  const db = await dbPromise;
  const row = await db.get<{ c: number }>("SELECT COUNT(*) as c FROM payments");
  return `RCPT-${5000 + (row?.c || 0) + 1}`;
}

router.get('/', requirePermission('payments:read'), async (_req, res) => {
  const db = await dbPromise;
  const rows = await db.all('SELECT * FROM payments ORDER BY created_at DESC');
  return res.json(rows);
});

router.post('/', requirePermission('payments:write'), async (req: AuthedRequest, res) => {
  const schema = z.object({
    type: z.enum(['in', 'out']),
    amount: z.number().positive(),
    saleId: z.string().optional(),
    installmentId: z.string().optional(),
    description: z.string().min(1),
    date: z.string().min(8),
    channel: z.enum(['cash', 'card', 'transfer', 'wallet', 'other']).default('cash'),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid payload' });
  const db = await dbPromise;

  if (parsed.data.type === 'in' && parsed.data.saleId) {
    const sale = await db.get<{ id: string; paid: number; total: number }>('SELECT id, paid, total FROM sales WHERE id = ?', parsed.data.saleId);
    if (!sale) return res.status(404).json({ message: 'Sale not found' });
    await db.run(
      `UPDATE sales
       SET paid = paid + ?,
           remaining = CASE WHEN total - (paid + ?) < 0 THEN 0 ELSE total - (paid + ?) END,
           locked = 1,
           status = CASE WHEN (paid + ?) >= total THEN 'completed' ELSE 'pending' END
       WHERE id = ?`,
      parsed.data.amount,
      parsed.data.amount,
      parsed.data.amount,
      parsed.data.amount,
      parsed.data.saleId,
    );
  }

  const id = uid();
  const receiptNumber = await nextReceiptNumber();
  await db.run(
    `INSERT INTO payments (id, type, amount, sale_id, installment_id, description, date, receipt_number, status, channel, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?, ?)`,
    id,
    parsed.data.type,
    parsed.data.amount,
    parsed.data.saleId || null,
    parsed.data.installmentId || null,
    parsed.data.description,
    parsed.data.date,
    receiptNumber,
    parsed.data.channel,
    req.user?.name || 'system',
    new Date().toISOString(),
  );
  await audit('payment.create', 'payment', id, req.user?.name || 'system', parsed.data);
  return res.status(201).json({ id, receiptNumber });
});

router.post('/:id/reverse', requirePermission('payments:reverse'), async (req: AuthedRequest, res) => {
  const db = await dbPromise;
  const original = await db.get<{ id: string; type: 'in' | 'out'; amount: number; sale_id: string | null; status: string; description: string; date: string; channel: string | null }>(
    'SELECT id, type, amount, sale_id, status, description, date, channel FROM payments WHERE id = ?',
    req.params.id,
  );
  if (!original) return res.status(404).json({ message: 'Payment not found' });
  if (original.status === 'voided') return res.status(409).json({ message: 'Already voided' });

  if (original.sale_id && original.type === 'in') {
    await db.run(
      `UPDATE sales
       SET paid = CASE WHEN paid - ? < 0 THEN 0 ELSE paid - ? END,
           remaining = CASE WHEN remaining + ? > total THEN total ELSE remaining + ? END,
           status = CASE WHEN (paid - ?) <= 0 THEN 'pending' ELSE status END
       WHERE id = ?`,
      original.amount,
      original.amount,
      original.amount,
      original.amount,
      original.amount,
      original.sale_id,
    );
  }

  const reverseId = uid();
  const receiptNumber = await nextReceiptNumber();
  const reverseType = original.type === 'in' ? 'out' : 'in';
  await db.run(
    `INSERT INTO payments (id, type, amount, sale_id, description, date, receipt_number, status, void_ref, approved_by, channel, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?, ?, ?, ?)`,
    reverseId,
    reverseType,
    original.amount,
    original.sale_id,
    `Reverse of ${original.description}`,
    new Date().toISOString().slice(0, 10),
    receiptNumber,
    original.id,
    req.user?.name || 'system',
    original.channel || 'other',
    req.user?.name || 'system',
    new Date().toISOString(),
  );

  await db.run('UPDATE payments SET status = "voided", void_ref = ?, approved_by = ? WHERE id = ?', reverseId, req.user?.name || 'system', original.id);
  await audit('payment.reverse', 'payment', original.id, req.user?.name || 'system', { reverseId });
  return res.json({ message: 'Reversed', reverseId });
});

export default router;
