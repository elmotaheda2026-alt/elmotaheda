import { Router } from 'express';
import { dbPromise } from '../db.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requirePermission('reports:read'));

router.get('/aging', async (_req, res) => {
  const db = await dbPromise;
  const rows = await db.all<{
    id: string;
    invoice_number: string;
    customer_name: string;
    remaining: number;
    date: string;
  }>('SELECT id, invoice_number, customer_name, remaining, date FROM sales WHERE remaining > 0');
  const today = Date.now();
  const result = rows.map((row) => {
    const diffDays = Math.max(0, Math.floor((today - new Date(row.date).getTime()) / 86400000));
    const bucket = diffDays <= 30 ? '0-30' : diffDays <= 60 ? '31-60' : diffDays <= 90 ? '61-90' : '90+';
    return { ...row, dpd: diffDays, bucket };
  });
  return res.json(result);
});

router.get('/collection-rate', async (_req, res) => {
  const db = await dbPromise;
  const billed = await db.get<{ total: number }>('SELECT COALESCE(SUM(total),0) as total FROM sales');
  const collected = await db.get<{ total: number }>("SELECT COALESCE(SUM(amount),0) as total FROM payments WHERE type='in' AND status='posted'");
  const billedValue = billed?.total || 0;
  const collectedValue = collected?.total || 0;
  return res.json({
    billed: billedValue,
    collected: collectedValue,
    rate: billedValue > 0 ? Number(((collectedValue / billedValue) * 100).toFixed(2)) : 0,
  });
});

router.get('/daily-cash', async (req, res) => {
  const date = String(req.query.date || new Date().toISOString().slice(0, 10));
  const db = await dbPromise;
  const incoming = await db.get<{ total: number }>("SELECT COALESCE(SUM(amount),0) as total FROM payments WHERE type='in' AND status='posted' AND date = ?", date);
  const outgoing = await db.get<{ total: number }>("SELECT COALESCE(SUM(amount),0) as total FROM payments WHERE type='out' AND status='posted' AND date = ?", date);
  const cashIn = incoming?.total || 0;
  const cashOut = outgoing?.total || 0;
  return res.json({ date, cashIn, cashOut, net: cashIn - cashOut });
});

export default router;
