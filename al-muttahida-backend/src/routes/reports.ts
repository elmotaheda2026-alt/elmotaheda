import { Router } from 'express';
import { dbPromise } from '../db.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requirePermission('reports:read'));

const dayMs = 86400000;

const cairoToday = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Cairo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

router.get('/aging', async (req, res) => {
  const referenceDate = String(req.query.date || cairoToday());
  const referenceTime = new Date(referenceDate).getTime();
  const db = await dbPromise;
  const schedules = await db.all<{
    sale_id: string;
    invoice_number: string;
    customer_name: string;
    due_date: string;
    amount: number;
    paid_amount: number;
  }>(
    `SELECT s.id as sale_id, s.invoice_number, s.customer_name, sch.due_date, sch.amount, sch.paid_amount
     FROM installment_schedules sch
     JOIN sales s ON s.id = sch.sale_id
     WHERE (sch.amount - sch.paid_amount) > 0`,
  );

  const scheduledRows = schedules
    .map((row) => {
      const dueTime = new Date(row.due_date).getTime();
      if (Number.isNaN(dueTime) || dueTime > referenceTime) return null;
      const dpd = Math.floor((referenceTime - dueTime) / dayMs);
      const bucket = dpd <= 30 ? '0-30' : dpd <= 60 ? '31-60' : dpd <= 90 ? '61-90' : '90+';
      return {
        saleId: row.sale_id,
        invoiceNumber: row.invoice_number,
        customerName: row.customer_name,
        remaining: Number((Number(row.amount || 0) - Number(row.paid_amount || 0)).toFixed(2)),
        dpd,
        bucket,
        dueDate: row.due_date,
      };
    })
    .filter(Boolean);

  const unscheduled = await db.all<{
    id: string;
    invoice_number: string;
    customer_name: string;
    remaining: number;
    date: string;
  }>(
    `SELECT s.id, s.invoice_number, s.customer_name, s.remaining, s.date
     FROM sales s
     WHERE s.remaining > 0
       AND NOT EXISTS (SELECT 1 FROM installment_schedules sch WHERE sch.sale_id = s.id)`,
  );

  const unscheduledRows = unscheduled
    .map((row) => {
      const dueTime = new Date(row.date).getTime();
      if (Number.isNaN(dueTime) || dueTime > referenceTime) return null;
      const dpd = Math.floor((referenceTime - dueTime) / dayMs);
      const bucket = dpd <= 30 ? '0-30' : dpd <= 60 ? '31-60' : dpd <= 90 ? '61-90' : '90+';
      return {
        saleId: row.id,
        invoiceNumber: row.invoice_number,
        customerName: row.customer_name,
        remaining: Number(row.remaining || 0),
        dpd,
        bucket,
        dueDate: row.date,
      };
    })
    .filter(Boolean);

  return res.json([...scheduledRows, ...unscheduledRows]);
});

router.get('/collection-rate', async (req, res) => {
  const startDate = req.query.startDate ? String(req.query.startDate) : null;
  const endDate = req.query.endDate ? String(req.query.endDate) : null;
  const db = await dbPromise;
  const filters: string[] = [];
  const args: string[] = [];
  if (startDate) {
    filters.push('date >= ?');
    args.push(startDate);
  }
  if (endDate) {
    filters.push('date <= ?');
    args.push(endDate);
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const billed = await db.get<{ total: number }>(`SELECT COALESCE(SUM(total),0) as total FROM sales ${where}`, ...args);
  const collected = await db.get<{ total: number }>(
    `SELECT COALESCE(SUM(p.amount),0) as total
     FROM payments p
     WHERE p.type='in'
       AND p.status='posted'
       AND (p.sale_id IS NOT NULL OR p.reference_type='sale' OR p.invoice_number IS NOT NULL)
       ${startDate ? 'AND p.date >= ?' : ''}
       ${endDate ? 'AND p.date <= ?' : ''}`,
    ...args,
  );
  const billedValue = billed?.total || 0;
  const collectedValue = collected?.total || 0;
  return res.json({
    billed: billedValue,
    collected: collectedValue,
    rate: billedValue > 0 ? Number(((collectedValue / billedValue) * 100).toFixed(2)) : 0,
  });
});

router.get('/daily-cash', async (req, res) => {
  const date = String(req.query.date || cairoToday());
  const db = await dbPromise;
  const incoming = await db.get<{ total: number }>("SELECT COALESCE(SUM(amount),0) as total FROM payments WHERE type='in' AND status='posted' AND date = ?", date);
  const outgoing = await db.get<{ total: number }>("SELECT COALESCE(SUM(amount),0) as total FROM payments WHERE type='out' AND status='posted' AND date = ?", date);
  const cashIn = incoming?.total || 0;
  const cashOut = outgoing?.total || 0;
  return res.json({ date, cashIn, cashOut, net: cashIn - cashOut });
});

export default router;
