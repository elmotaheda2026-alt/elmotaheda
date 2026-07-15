import { Router } from 'express';
import { z } from 'zod';
import { dbPromise } from '../db.js';
import { requireAuth, requirePermission, type AuthedRequest } from '../middleware/auth.js';
import { audit } from '../audit.js';
import { uid, formatDate, parseDateInput } from '../utils.js';
import { createSystemNotification, financialMovementLabel, formatMoney } from '../financialNotifications.js';

const router = Router();
router.use(requireAuth);

async function nextReceiptNumber() {
  const db = await dbPromise;
  const row = await db.get<{ receipt_number: string }>(
    `SELECT TOP 1 receipt_number
     FROM payments
     WHERE receipt_number LIKE 'RCPT-%'
       AND TRY_CONVERT(INT, SUBSTRING(receipt_number, 6, 32)) IS NOT NULL
     ORDER BY TRY_CONVERT(INT, SUBSTRING(receipt_number, 6, 32)) DESC`
  );
  const maxNum = row ? parseInt(row.receipt_number.replace('RCPT-', ''), 10) : 5000;
  return `RCPT-${maxNum + 1}`;
}

const roundMoney = (value: number) => Number(Number(value || 0).toFixed(2));

async function isPeriodClosed(db: any, dateStr: string): Promise<boolean> {
  const day = dateStr.slice(0, 10);
  const month = dateStr.slice(0, 7);
  const closed = await db.get(
    `SELECT 1 FROM closing_periods 
     WHERE status = \'closed\' 
       AND ((period_type = \'daily\' AND period_date = ?) OR (period_type = \'monthly\' AND period_date = ?))`,
    day,
    month
  );
  return !!closed;
}

const paymentSchema = z.object({
  type: z.enum(['in', 'out']),
  amount: z.number().positive(),
  saleId: z.string().optional().nullable(),
  installmentId: z.string().optional().nullable(),
  customerId: z.string().optional().nullable(),
  supplierId: z.string().optional().nullable(),
  referenceId: z.string().optional().nullable(),
  referenceType: z.enum(['customer', 'supplier', 'sale', 'purchase', 'other']).default('other'),
  description: z.string().min(1),
  date: z.string().min(8),
  channel: z.enum(['cash', 'card', 'transfer', 'wallet', 'other']).default('cash'),
  invoiceNumber: z.string().optional().nullable(),
  affectsCustomerBalance: z.boolean().default(true),
});

// GET /payments
router.get('/', requirePermission('payments:read'), async (req, res) => {
  try {
    const db = await dbPromise;
    const date = typeof req.query.date === 'string' ? req.query.date.slice(0, 10) : '';
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const rawLimit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 200;
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 500) : 200;

    const where: string[] = [];
    const params: any[] = [];

    if (date) {
      where.push('CONVERT(date, p.date) = CONVERT(date, ?)');
      params.push(date);
    }

    if (search) {
      where.push(`(
        p.description LIKE ? OR
        p.receipt_number LIKE ? OR
        p.invoice_number LIKE ? OR
        c.name LIKE ? OR
        s.name LIKE ?
      )`);
      const like = `%${search}%`;
      params.push(like, like, like, like, like);
    }
    const rows = await db.all(
      `SELECT TOP (?) p.*
       FROM payments p
       LEFT JOIN customers c ON c.id = p.customer_id OR (p.reference_type = 'customer' AND c.id = p.reference_id)
       LEFT JOIN suppliers s ON s.id = p.supplier_id OR (p.reference_type = 'supplier' AND s.id = p.reference_id)
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY p.created_at DESC`,
      limit,
      ...params
    );
    const mapped = rows.map((row: any) => ({
      id: row.id,
      type: row.type,
      amount: Number(row.amount),
      saleId: row.sale_id,
      installmentId: row.installment_id,
      description: row.description,
      date: formatDate(row.date),
      receiptNumber: row.receipt_number,
      status: row.status,
      voidRef: row.void_ref,
      approvedBy: row.approved_by,
      channel: row.channel,
      createdBy: row.created_by,
      createdAt: formatDate(row.created_at),
      customerId: row.customer_id,
      supplierId: row.supplier_id,
      referenceId: row.reference_id,
      referenceType: row.reference_type || 'other',
      invoiceNumber: row.invoice_number,
      affectsCustomerBalance: row.affects_customer_balance === 1 || row.affects_customer_balance === true,
    }));
    return res.json(mapped);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// POST /payments
router.post('/', requirePermission('payments:write'), async (req: AuthedRequest, res) => {
  const parsed = paymentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid payment payload', errors: parsed.error.format() });
  }

  const data = parsed.data;
  // Parse date input (DD/MM/YYYY) to ISO
  try {
    data.date = parseDateInput(data.date);
  } catch (e) {
    return res.status(400).json({ message: e instanceof Error ? e.message : 'Invalid date format' });
  }
  const db = await dbPromise;
  const now = new Date().toISOString();
  const id = uid();
  const receiptNumber = await nextReceiptNumber();

  try {
    if (req.user?.role !== 'admin' && await isPeriodClosed(db, data.date)) {
      return res.status(400).json({ message: 'لا يمكن تسجيل عملية دفع في تاريخ مغلق مالياً' });
    }

    // Validate sale exists and amount before transaction
    let finalCustomerId = data.customerId || null;
    let finalSupplierId = data.supplierId || null;

    if (data.type === 'in' && data.saleId) {
      const sale = await db.get<{ id: string; customer_id: string; paid: number; remaining: number; total: number }>(
        'SELECT id, customer_id, paid, remaining, total FROM sales WHERE id = ?',
        data.saleId,
      );
      if (!sale) return res.status(404).json({ message: 'Sale invoice not found' });
      if (roundMoney(data.amount) > roundMoney(sale.remaining)) {
        return res.status(400).json({ message: 'Payment amount cannot exceed the remaining sale balance' });
      }
      finalCustomerId = sale.customer_id;
    }

    // Run all DB mutations inside a single transaction to avoid deadlocks
    await db.withTransaction(async (tx) => {
      // 1. If paying for a sale, update sales + installments
      if (data.type === 'in' && data.saleId) {
        await tx.run(
          `UPDATE sales
           SET paid = paid + ?,
               remaining = CASE WHEN total - (paid + ?) < 0 THEN 0 ELSE total - (paid + ?) END,
               locked = 1,
               status = CASE WHEN (paid + ?) >= total THEN 'completed' ELSE 'pending' END
           WHERE id = ?`,
          data.amount, data.amount, data.amount, data.amount, data.saleId,
        );

        if (data.installmentId) {
          const schedule = await tx.get(
            'SELECT id, amount, paid_amount FROM installment_schedules WHERE id = ?',
            data.installmentId,
          );
          if (schedule) {
            const nextPaid = Number((schedule.paid_amount + data.amount).toFixed(2));
            await tx.run(
              `UPDATE installment_schedules SET paid_amount = ?, status = ?, paid_at = ? WHERE id = ?`,
              nextPaid,
              nextPaid >= schedule.amount ? 'paid' : 'partial',
              data.date,
              data.installmentId,
            );
          }
        } else {
          const schedules = await tx.all(
            `SELECT id, amount, paid_amount FROM installment_schedules
             WHERE sale_id = ? AND status <> 'paid' ORDER BY month_index ASC`,
            data.saleId,
          );
          let remainingPayment = data.amount;
          for (const sch of schedules) {
            if (remainingPayment <= 0) break;
            const schRemaining = Number((sch.amount - sch.paid_amount).toFixed(2));
            const applied = Math.min(schRemaining, remainingPayment);
            const nextPaidAmount = Number((sch.paid_amount + applied).toFixed(2));
            remainingPayment = Number((remainingPayment - applied).toFixed(2));
            await tx.run(
              `UPDATE installment_schedules SET paid_amount = ?, status = ?, paid_at = ? WHERE id = ?`,
              nextPaidAmount,
              nextPaidAmount >= sch.amount ? 'paid' : 'partial',
              data.date,
              sch.id,
            );
          }
        }
      }

      // 2. Update Customer Balance
      if (data.type === 'in' && finalCustomerId && data.affectsCustomerBalance) {
        await tx.run(
          `UPDATE customers
           SET balance = CASE WHEN balance - ? < 0 THEN 0 ELSE balance - ? END, updated_at = ?
           WHERE id = ?`,
          data.amount, data.amount, now, finalCustomerId,
        );
      }

      // 3. Update Supplier Balance
      if (data.type === 'out' && finalSupplierId) {
        await tx.run(
          `UPDATE suppliers
           SET balance = CASE WHEN balance - ? < 0 THEN 0 ELSE balance - ? END, updated_at = ?
           WHERE id = ?`,
          data.amount, data.amount, now, finalSupplierId,
        );
      }

      // 4. Insert payment record
      await tx.run(
        `INSERT INTO payments (
          id, type, amount, sale_id, installment_id, description, date, receipt_number, status, channel,
          reference_id, reference_type, customer_id, supplier_id, invoice_number, affects_customer_balance,
          created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        data.type,
        data.amount,
        data.saleId || null,
        data.installmentId || null,
        data.description,
        data.date,
        receiptNumber,
        data.channel,
        data.referenceId || null,
        data.referenceType,
        finalCustomerId,
        finalSupplierId,
        data.invoiceNumber || null,
        data.affectsCustomerBalance ? 1 : 0,
        req.user?.name || 'system',
        now,
      );
    });

    await audit('payment.create', 'payment', id, req.user?.name || 'system', {
      id,
      receiptNumber,
      amount: data.amount,
      type: data.type,
    });

    // Build detailed notification with client and installment info
    let clientName = '';
    if (finalCustomerId) {
      const custRow = await db.get<any>(`SELECT name FROM customers WHERE id = ?`, finalCustomerId);
      if (custRow) clientName = custRow.name;
    }
    const installmentMatch = data.description?.match(/قسط\s+(\d+)/);
    const installmentNo = installmentMatch ? installmentMatch[1] : (data.installmentId ?? '');
    const detailedMessage = `${financialMovementLabel(data.type)} ${formatMoney(data.amount)} - سداد القسط ${installmentNo} من الفاتورة ${data.invoiceNumber || ''} - إيصال ${receiptNumber} - عميل ${clientName}`;
    await createSystemNotification(
      data.type === 'in' ? 'success' : 'warning',
      `حركة خزينة ${financialMovementLabel(data.type)}`,
      detailedMessage,
    );

    return res.status(201).json({ id, receiptNumber });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// POST /payments/:id/reverse
router.post('/:id/reverse', requirePermission('payments:reverse'), async (req: AuthedRequest, res) => {
  const db = await dbPromise;
  const original = await db.get<any>(
    'SELECT * FROM payments WHERE id = ?',
    req.params.id,
  );
  if (!original) return res.status(404).json({ message: 'Payment not found' });
  if (original.status === 'voided') return res.status(409).json({ message: 'Payment is already voided' });

  const now = new Date().toISOString();
  const reverseId = uid();
  const receiptNumber = await nextReceiptNumber();
  const reverseType = original.type === 'in' ? 'out' : 'in';

  try {
    if (req.user?.role !== 'admin' && (await isPeriodClosed(db, original.date) || await isPeriodClosed(db, now.slice(0, 10)))) {
      return res.status(400).json({ message: 'لا يمكن عكس حركة مالية في تاريخ مغلق مالياً' });
    }
    // 1. If reversing a sale payment, deduct from paid and add back to remaining
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

      // Revert schedules
      if (original.installment_id) {
        const schedule = await db.get<{ id: string; paid_amount: number; sale_id: string }>(
          'SELECT id, paid_amount, sale_id FROM installment_schedules WHERE id = ?',
          original.installment_id,
        );
        if (schedule) {
          const nextPaidAmount = Math.max(0, Number((schedule.paid_amount - original.amount).toFixed(2)));
          const scheduleStatus = nextPaidAmount <= 0 ? 'unpaid' : 'partial';
          const latestPayment = nextPaidAmount > 0 ? await db.get<{ date: string }>(
            'SELECT date FROM payments WHERE sale_id = ? AND status = \'posted\' AND id <> ? ORDER BY date DESC',
            schedule.sale_id,
            original.id,
          ) : null;
          await db.run(
            `UPDATE installment_schedules
             SET paid_amount = ?,
                 status = ?,
                 paid_at = ?
             WHERE id = ?`,
            nextPaidAmount,
            scheduleStatus,
            latestPayment ? latestPayment.date : null,
            original.installment_id,
          );
        }
      } else {
        // Auto-revert schedules in reverse order (month_index DESC)
        const schedules = await db.all<{ id: string; paid_amount: number; sale_id: string }>(
          'SELECT id, paid_amount, sale_id FROM installment_schedules WHERE sale_id = ? AND paid_amount > 0 ORDER BY month_index DESC',
          original.sale_id,
        );
        let remainingRevert = original.amount;
        for (const sch of schedules) {
          if (remainingRevert <= 0) break;
          const applied = Math.min(sch.paid_amount, remainingRevert);
          const nextPaidAmount = Number((sch.paid_amount - applied).toFixed(2));
          remainingRevert = Number((remainingRevert - applied).toFixed(2));

          const latestPayment = nextPaidAmount > 0 ? await db.get<{ date: string }>(
            'SELECT date FROM payments WHERE sale_id = ? AND status = \'posted\' AND id <> ? ORDER BY date DESC',
            sch.sale_id,
            original.id,
          ) : null;

          await db.run(
            `UPDATE installment_schedules
             SET paid_amount = ?,
                 status = ?,
                 paid_at = ?
             WHERE id = ?`,
            nextPaidAmount,
            nextPaidAmount <= 0 ? 'unpaid' : 'partial',
            latestPayment ? latestPayment.date : null,
            sch.id,
          );
        }
      }
    }

    // 2. Revert Customer Balance (outgoing reverse payment increases debtor balance)
    if (original.type === 'in' && original.customer_id && original.affects_customer_balance) {
      await db.run(
        `UPDATE customers
         SET balance = balance + ?,
             updated_at = ?
         WHERE id = ?`,
        original.amount,
        now,
        original.customer_id,
      );
    }

    // 3. Revert Supplier Balance (incoming reverse payment increases creditor balance we owe them)
    if (original.type === 'out' && original.supplier_id) {
      await db.run(
        `UPDATE suppliers
         SET balance = balance + ?,
             updated_at = ?
         WHERE id = ?`,
        original.amount,
        now,
        original.supplier_id,
      );
    }

    // 4. Create void payment transaction
    await db.run(
      `INSERT INTO payments (
        id, type, amount, sale_id, installment_id, description, date, receipt_number, status, void_ref, approved_by, channel,
        reference_id, reference_type, customer_id, supplier_id, invoice_number, affects_customer_balance,
        created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      reverseId,
      reverseType,
      original.amount,
      original.sale_id || null,
      original.installment_id || null,
      `Reverse of ${original.description}`,
      now.slice(0, 10),
      receiptNumber,
      original.id,
      req.user?.name || 'system',
      original.channel || 'other',
      original.reference_id || null,
      original.reference_type || 'other',
      original.customer_id || null,
      original.supplier_id || null,
      original.invoice_number || null,
      original.affects_customer_balance === 1 ? 1 : 0,
      req.user?.name || 'system',
      now,
    );

    // 5. Update original payment status to voided
    await db.run(
      'UPDATE payments SET status = \'voided\', void_ref = ?, approved_by = ? WHERE id = ?',
      reverseId,
      req.user?.name || 'system',
      original.id,
    );

    await audit('payment.reverse', 'payment', original.id, req.user?.name || 'system', { reverseId });
    await createSystemNotification(
      reverseType === 'in' ? 'success' : 'warning',
      'عكس حركة مالية',
      `${financialMovementLabel(reverseType)} ${formatMoney(original.amount)} لعكس الإيصال ${original.receipt_number || original.id} - إيصال ${receiptNumber}`,
    );
    return res.json({ message: 'Reversed', reverseId });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

export default router;






