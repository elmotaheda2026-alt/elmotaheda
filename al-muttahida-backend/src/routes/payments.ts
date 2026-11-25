import { Router } from 'express';
import { z } from 'zod';
import { dbPromise } from '../db.js';
import { requireAnyPermission, requireAuth, requirePermission, type AuthedRequest } from '../middleware/auth.js';
import { hasPermission } from '../permissions.js';
import { audit } from '../audit.js';
import { uid, formatDate, parseDateInput, comparePassword, isPeriodClosed } from '../utils.js';
import { createSystemNotification, financialMovementLabel, formatMoney } from '../financialNotifications.js';
import { broadcastDataChange } from '../realtime.js';
import { parsePaymentChannelsJson } from './settings.js';

const router = Router();
router.use(requireAuth);

async function nextReceiptNumber(txDb?: any) {
  const executor = txDb || (await dbPromise);
  const row = (await executor.get(
    `SELECT TOP 1 receipt_number
     FROM payments WITH (UPDLOCK, HOLDLOCK)
     WHERE receipt_number LIKE 'RCPT-%'
       AND TRY_CONVERT(INT, SUBSTRING(receipt_number, 6, 32)) IS NOT NULL
     ORDER BY TRY_CONVERT(INT, SUBSTRING(receipt_number, 6, 32)) DESC`
  )) as { receipt_number: string } | undefined;
  const maxNum = row ? parseInt(row.receipt_number.replace('RCPT-', ''), 10) : 5000;
  return `RCPT-${maxNum + 1}`;
}

const roundMoney = (value: number) => Number(Number(value || 0).toFixed(2));

const NORMALIZED_CHANNEL_SQL = `CASE
  WHEN channel IS NULL OR LTRIM(RTRIM(channel)) = '' OR channel = 'other' THEN 'cash'
  ELSE channel
END`;

const paymentSchema = z.object({
  type: z.enum(['in', 'out']),
  amount: z.number().positive(),
  saleId: z.string().optional().nullable(),
  installmentId: z.string().optional().nullable(),
  customerId: z.string().optional().nullable(),
  supplierId: z.string().optional().nullable(),
  referenceId: z.string().optional().nullable(),
  referenceType: z.enum(['customer', 'supplier', 'sale', 'purchase', 'expense', 'internal_transfer', 'other']).default('other'),
  description: z.string().min(1),
  date: z.string().min(8),
  channel: z.string().trim().min(1).max(64).default('cash'),
  invoiceNumber: z.string().optional().nullable(),
  affectsCustomerBalance: z.boolean().default(true),
  isEarlySettlement: z.boolean().optional().default(false),
  settlementDiscount: z.number().nonnegative().optional().default(0),
  adminUsername: z.string().optional(),
  adminPassword: z.string().optional(),
});

// GET /payments/summary — daily breakdown + admin-only cumulative totals
router.get('/summary', requireAnyPermission('payments:read', 'reports:read'), async (req: AuthedRequest, res) => {
  try {
    const db = await dbPromise;
    const isAdminUser = req.user?.role === 'admin';
    const todayDate =
      typeof req.query.date === 'string' && req.query.date.trim()
        ? req.query.date.trim().slice(0, 10)
        : new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Africa/Cairo',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(new Date());

    const payRow = await db.get<any>(
      `SELECT
         COUNT(*) AS totalCount,
         COUNT(CASE WHEN (status IS NULL OR status != 'voided') AND COALESCE(reference_type, '') != 'internal_transfer' AND CONVERT(date, date) = CONVERT(date, ?) THEN 1 END) AS todayCount,
         COALESCE(SUM(CASE WHEN type = 'in' AND (status IS NULL OR status != 'voided') AND COALESCE(reference_type, '') != 'internal_transfer' THEN amount ELSE 0 END), 0) AS totalIn,
         COALESCE(SUM(CASE WHEN type = 'out' AND (status IS NULL OR status != 'voided') AND COALESCE(reference_type, '') != 'internal_transfer' THEN amount ELSE 0 END), 0) AS totalOut,
         COALESCE(SUM(CASE WHEN type = 'in' AND (status IS NULL OR status != 'voided') AND COALESCE(reference_type, '') != 'internal_transfer' AND CONVERT(date, date) = CONVERT(date, ?) THEN amount ELSE 0 END), 0) AS todayIn,
         COALESCE(SUM(CASE WHEN type = 'out' AND (status IS NULL OR status != 'voided') AND COALESCE(reference_type, '') != 'internal_transfer' AND CONVERT(date, date) = CONVERT(date, ?) THEN amount ELSE 0 END), 0) AS todayOut
       FROM payments`,
      todayDate,
      todayDate,
      todayDate,
    );
    const expRow = await db.get<any>(
      `SELECT
         COALESCE(SUM(e.amount), 0) AS totalExpenses,
         COALESCE(SUM(CASE WHEN CONVERT(date, e.date) = CONVERT(date, ?) THEN e.amount ELSE 0 END), 0) AS todayExpenses
       FROM expenses e
       WHERE NOT EXISTS (
         SELECT 1 FROM payments p
         WHERE p.reference_type = 'expense'
           AND p.reference_id = e.id
           AND (p.status IS NULL OR p.status != 'voided')
       )`,
      todayDate,
    );

    const channelRows = await db.all<any>(
      `SELECT
         ${NORMALIZED_CHANNEL_SQL} AS normChannel,
         COALESCE(SUM(CASE WHEN type = 'in' THEN amount ELSE 0 END), 0) AS totalIn,
         COALESCE(SUM(CASE WHEN type = 'out' THEN amount ELSE 0 END), 0) AS totalOut,
         COALESCE(SUM(CASE WHEN type = 'in' AND CONVERT(date, date) = CONVERT(date, ?) THEN amount ELSE 0 END), 0) AS todayIn,
         COALESCE(SUM(CASE WHEN type = 'out' AND CONVERT(date, date) = CONVERT(date, ?) THEN amount ELSE 0 END), 0) AS todayOut
       FROM payments
       WHERE (status IS NULL OR status != 'voided')
       GROUP BY ${NORMALIZED_CHANNEL_SQL}`,
      todayDate,
      todayDate,
    );

    const totalIn = Number(payRow?.totalIn || 0);
    const totalOut = Number(payRow?.totalOut || 0);
    const totalExpenses = Number(expRow?.totalExpenses || 0);
    const todayIn = Number(payRow?.todayIn || 0);
    const todayOut = Number(payRow?.todayOut || 0);
    const todayExpenses = Number(expRow?.todayExpenses || 0);

    const configuredRow = await db.get<{ payment_channels_json?: string | null }>(
      'SELECT TOP 1 payment_channels_json FROM settings',
    ).catch(() => null);
    const configuredChannels = parsePaymentChannelsJson(configuredRow?.payment_channels_json);

    const makeEmptyChannel = () => ({
      balance: isAdminUser ? 0 : null,
      totalIn: isAdminUser ? 0 : null,
      totalOut: isAdminUser ? 0 : null,
      todayIn: 0,
      todayOut: 0,
      todayNet: 0,
    });
    const channels: Record<
      string,
      { balance: number | null; totalIn: number | null; totalOut: number | null; todayIn: number; todayOut: number; todayNet: number }
    > = {};

    for (const ch of configuredChannels) {
      channels[ch.id] = makeEmptyChannel();
    }

    for (const r of channelRows) {
      const key = String(r.normChannel || 'cash').trim() || 'cash';
      if (!channels[key]) {
        channels[key] = makeEmptyChannel();
      }
      const chIn = roundMoney(r.totalIn);
      const chOut = roundMoney(r.totalOut);
      const chTodayIn = roundMoney(r.todayIn);
      const chTodayOut = roundMoney(r.todayOut);
      channels[key] = {
        totalIn: isAdminUser ? chIn : null,
        totalOut: isAdminUser ? chOut : null,
        balance: isAdminUser ? roundMoney(chIn - chOut) : null,
        todayIn: chTodayIn,
        todayOut: chTodayOut,
        todayNet: roundMoney(chTodayIn - chTodayOut),
      };
    }

    const settingsRow = await db.get<{ starting_cash_balance?: number }>('SELECT TOP 1 starting_cash_balance FROM settings');
    const startingCashBalance = roundMoney(Number(settingsRow?.starting_cash_balance || 0));

    if (totalExpenses !== 0 || todayExpenses !== 0 || startingCashBalance !== 0) {
      if (!channels.cash) channels.cash = makeEmptyChannel();
      if (isAdminUser && channels.cash.totalOut !== null && channels.cash.totalIn !== null) {
        channels.cash.totalOut = roundMoney(channels.cash.totalOut + totalExpenses);
        channels.cash.balance = roundMoney(startingCashBalance + channels.cash.totalIn - channels.cash.totalOut);
      }
      channels.cash.todayOut = roundMoney(channels.cash.todayOut + todayExpenses);
      channels.cash.todayNet = roundMoney(channels.cash.todayIn - channels.cash.todayOut);
    }

    // Optional date-range summary for accurate server-side Period Closing (daily / monthly / yearly)
    const rawStartDate = typeof req.query.startDate === 'string' && req.query.startDate.trim() ? req.query.startDate.trim().slice(0, 10) : null;
    const rawEndDate = typeof req.query.endDate === 'string' && req.query.endDate.trim() ? req.query.endDate.trim().slice(0, 10) : null;
    let period: {
      startDate: string;
      endDate: string;
      totalIn: number;
      totalOut: number;
      totalExpenses: number;
      count: number;
      net: number;
      closingBalance: number;
    } | null = null;

    if (rawStartDate && rawEndDate) {
      const [periodPayRow, periodExpRow, upToPayRow, upToExpRow] = await Promise.all([
        db.get<any>(
          `SELECT
             COUNT(*) AS cnt,
             COALESCE(SUM(CASE WHEN type = 'in' THEN amount ELSE 0 END), 0) AS pIn,
             COALESCE(SUM(CASE WHEN type = 'out' THEN amount ELSE 0 END), 0) AS pOut
           FROM payments
           WHERE (status IS NULL OR status != 'voided')
             AND COALESCE(reference_type, '') != 'internal_transfer'
             AND CONVERT(date, date) >= CONVERT(date, ?)
             AND CONVERT(date, date) <= CONVERT(date, ?)`,
          rawStartDate,
          rawEndDate,
        ),
        db.get<any>(
          `SELECT COALESCE(SUM(e.amount), 0) AS pExp
           FROM expenses e
           WHERE CONVERT(date, e.date) >= CONVERT(date, ?)
             AND CONVERT(date, e.date) <= CONVERT(date, ?)
             AND NOT EXISTS (
               SELECT 1 FROM payments p
               WHERE p.reference_type = 'expense' AND p.reference_id = e.id
                 AND (p.status IS NULL OR p.status != 'voided')
             )`,
          rawStartDate,
          rawEndDate,
        ),
        db.get<any>(
          `SELECT
             COALESCE(SUM(CASE WHEN type = 'in' THEN amount ELSE 0 END), 0) AS cumIn,
             COALESCE(SUM(CASE WHEN type = 'out' THEN amount ELSE 0 END), 0) AS cumOut
           FROM payments
           WHERE (status IS NULL OR status != 'voided')
             AND COALESCE(reference_type, '') != 'internal_transfer'
             AND CONVERT(date, date) <= CONVERT(date, ?)`,
          rawEndDate,
        ),
        db.get<any>(
          `SELECT COALESCE(SUM(e.amount), 0) AS cumExp
           FROM expenses e
           WHERE CONVERT(date, e.date) <= CONVERT(date, ?)
             AND NOT EXISTS (
               SELECT 1 FROM payments p
               WHERE p.reference_type = 'expense' AND p.reference_id = e.id
                 AND (p.status IS NULL OR p.status != 'voided')
             )`,
          rawEndDate,
        ),
      ]);
      const pIn = roundMoney(periodPayRow?.pIn || 0);
      const pOut = roundMoney(periodPayRow?.pOut || 0);
      const pExp = roundMoney(periodExpRow?.pExp || 0);
      const cumIn = roundMoney(upToPayRow?.cumIn || 0);
      const cumOut = roundMoney(upToPayRow?.cumOut || 0);
      const cumExp = roundMoney(upToExpRow?.cumExp || 0);
      period = {
        startDate: rawStartDate,
        endDate: rawEndDate,
        totalIn: pIn,
        totalOut: roundMoney(pOut + pExp),
        totalExpenses: pExp,
        count: Number(periodPayRow?.cnt || 0),
        net: roundMoney(pIn - pOut - pExp),
        closingBalance: roundMoney(startingCashBalance + cumIn - cumOut - cumExp),
      };
    }

    return res.json({
      totalCount: Number(payRow?.totalCount || 0),
      todayCount: Number(payRow?.todayCount || 0),
      totalIn: isAdminUser ? totalIn : null,
      totalOut: isAdminUser ? totalOut : null,
      totalExpenses: isAdminUser ? totalExpenses : null,
      startingCashBalance: isAdminUser ? startingCashBalance : null,
      netCash: isAdminUser ? roundMoney(startingCashBalance + totalIn - totalOut - totalExpenses) : null,
      todayIn,
      todayOut,
      todayExpenses,
      todayNet: roundMoney(todayIn - todayOut - todayExpenses),
      channels,
      period,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// GET /payments
router.get('/', requireAnyPermission('payments:read', 'reports:read'), async (req, res) => {
  try {
    const db = await dbPromise;

    // Extract query parameters
    const date = typeof req.query.date === 'string' ? req.query.date.slice(0, 10) : '';
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const channel = typeof req.query.channel === 'string' ? req.query.channel.trim() : '';
    const includeMeta = req.query.includeMeta === '1' || req.query.includeMeta === 'true';
    const rawPage = typeof req.query.page === 'string' ? Number(req.query.page) : undefined;
    const rawLimit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;

    // Build pagination object only when both page and limit are supplied
    const pagination =
      rawPage && rawLimit
        ? { page: Math.max(1, Math.trunc(rawPage)), limit: Math.max(1, Math.trunc(rawLimit)) }
        : undefined;

    const where: string[] = [];
    const params: any[] = [];

    if (date) {
      where.push('CONVERT(date, p.date) = CONVERT(date, ?)');
      params.push(date);
    }

    if (channel) {
      if (channel === 'cash') {
        where.push("(p.channel IS NULL OR LTRIM(RTRIM(p.channel)) = '' OR p.channel IN ('cash', 'other'))");
      } else {
        where.push('p.channel = ?');
        params.push(channel);
      }
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

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = await db.all<any>(
      `SELECT p.*
         FROM payments p
         LEFT JOIN customers c ON c.id = p.customer_id OR (p.reference_type = 'customer' AND c.id = p.reference_id)
         LEFT JOIN suppliers s ON s.id = p.supplier_id OR (p.reference_type = 'supplier' AND s.id = p.reference_id)
         ${whereSql}
         ORDER BY COALESCE(TRY_CONVERT(datetime2, p.created_at), TRY_CONVERT(datetime2, p.date), TRY_CONVERT(datetime2, '1900-01-01')) DESC, p.id DESC`,
      params,
      pagination,
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

    if (includeMeta && pagination) {
      const countRow = await db.get<{ total: number }>(
        `SELECT COUNT(*) AS total
         FROM payments p
         LEFT JOIN customers c ON c.id = p.customer_id OR (p.reference_type = 'customer' AND c.id = p.reference_id)
         LEFT JOIN suppliers s ON s.id = p.supplier_id OR (p.reference_type = 'supplier' AND s.id = p.reference_id)
         ${whereSql}`,
        ...params,
      );
      const total = Number(countRow?.total || 0);
      return res.json({
        total,
        page: pagination.page,
        limit: pagination.limit,
        totalPages: Math.max(1, Math.ceil(total / pagination.limit)),
        payments: mapped,
      });
    }

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
  let receiptNumber = '';

  try {
    if (req.user?.role !== 'admin' && await isPeriodClosed(db, data.date)) {
      return res.status(400).json({ message: 'لا يمكن تسجيل عملية دفع في تاريخ مغلق مالياً' });
    }

    let authorizingAdminName: string | null = null;

    if (data.isEarlySettlement) {
      const canSettleDirectly = hasPermission(req.user!.role, 'payments:early_settlement', req.user!.permissions);
      if (req.user?.role !== 'admin' && !canSettleDirectly) {
        const { adminUsername, adminPassword } = data;
        if (!adminUsername || !adminPassword) {
          return res.status(403).json({
            message: 'تكييش وتصفية العقد تتطلب موافقة المدير. يرجى اختيار المدير وإدخال كلمة المرور.',
          });
        }

        const adminUser = await db.get<{ id: string; name: string; username: string; role: string; password_hash: string; is_active: number | boolean }>(
          "SELECT id, name, username, role, password_hash, is_active FROM users WHERE username = ? AND role = 'admin'",
          adminUsername,
        );

        if (!adminUser || !(adminUser.is_active === 1 || adminUser.is_active === true)) {
          return res.status(403).json({ message: 'حساب المدير المحدد غير موجود أو غير نشط' });
        }

        const passwordMatch = await comparePassword(adminPassword, adminUser.password_hash);
        if (!passwordMatch) {
          return res.status(401).json({ message: 'كلمة مرور المدير غير صحيحة، تم رفض الموافقة' });
        }

        authorizingAdminName = adminUser.name || adminUser.username;
      }

      if (!data.saleId) {
        return res.status(400).json({ message: 'يجب اختيار الفاتورة/العقد المراد تكييشه' });
      }
    }

    // Validate sale exists and amount before transaction
    let finalCustomerId = data.customerId || null;
    let finalSupplierId = data.supplierId || null;
    let resolvedInvoiceNumber = data.invoiceNumber || null;
    let saleRemainingBeforeSettlement = 0;
    const isDownPayment = data.type === 'in' && Boolean(data.saleId) && data.affectsCustomerBalance === false;

    if (data.type === 'in' && data.saleId) {
      const sale = await db.get<{ id: string; customer_id: string; paid: number; remaining: number; total: number; invoice_number: string }>(
        'SELECT id, customer_id, paid, remaining, total, invoice_number FROM sales WHERE id = ?',
        data.saleId,
      );
      if (!sale) return res.status(404).json({ message: 'Sale invoice not found' });
      saleRemainingBeforeSettlement = Number(sale.remaining || 0);
      if (!resolvedInvoiceNumber) resolvedInvoiceNumber = sale.invoice_number || null;

      if (!isDownPayment) {
        if (data.isEarlySettlement) {
          const discount = Number(data.settlementDiscount || 0);
          if (discount > saleRemainingBeforeSettlement) {
            return res.status(400).json({ message: 'قيمة خصم التعجيل لا يمكن أن تتجاوز المبلغ المتبقي' });
          }
          const expectedNet = Math.max(0, Number((saleRemainingBeforeSettlement - discount).toFixed(2)));
          if (roundMoney(data.amount) > roundMoney(expectedNet)) {
            return res.status(400).json({ message: 'مبلغ السداد لا يمكن أن يتجاوز صافي التسوية المطلوب' });
          }
        } else {
          if (roundMoney(data.amount) > roundMoney(sale.remaining)) {
            return res.status(400).json({ message: 'Payment amount cannot exceed the remaining sale balance' });
          }
        }
      }
      finalCustomerId = sale.customer_id;
    }

    // Run all DB mutations inside a single transaction with row-level locks to prevent double-payment races
    await db.withTransaction(async (tx) => {
      receiptNumber = await nextReceiptNumber(tx);
      let liveRemainingForSettlement = saleRemainingBeforeSettlement;
      // 1. If paying installments/balance for a sale (not a down-payment treasury record), lock sale row & update installments
      if (data.type === 'in' && data.saleId && !isDownPayment) {
        const lockedSale = await tx.get(
          'SELECT id, paid, remaining, total, status FROM sales WITH (UPDLOCK, ROWLOCK) WHERE id = ?',
          data.saleId,
        );
        if (!lockedSale) {
          const err: any = new Error('الفاتورة غير موجودة');
          err.statusCode = 404;
          throw err;
        }
        const liveRemaining = Number(lockedSale.remaining || 0);
        liveRemainingForSettlement = liveRemaining;
        if (data.isEarlySettlement) {
          const discount = Number(data.settlementDiscount || 0);
          const expectedNet = Math.max(0, Number((liveRemaining - discount).toFixed(2)));
          if (liveRemaining <= 0 || lockedSale.status === 'settled_early' || roundMoney(data.amount) > roundMoney(expectedNet)) {
            const err: any = new Error('تم سداد هذه الفاتورة أو تغير رصيدها من جهاز آخر، يرجى تحديث الصفحة.');
            err.statusCode = 409;
            throw err;
          }
        } else if (roundMoney(data.amount) > roundMoney(liveRemaining)) {
          const err: any = new Error('تم سداد جزء من هذه الفاتورة من جهاز آخر وأصبح المبلغ أكبر من المتبقي، يرجى تحديث الصفحة.');
          err.statusCode = 409;
          throw err;
        }

        if (data.isEarlySettlement) {
          const discount = Number(data.settlementDiscount || 0);
          await tx.run(
            `UPDATE sales
             SET paid = paid + ?,
                 remaining = 0,
                 locked = 1,
                 status = 'settled_early',
                 discount = discount + ?,
                 collection_note = NULL,
                 last_edited_by = ?,
                 last_edited_at = ?
             WHERE id = ?`,
            data.amount,
            discount,
            req.user?.name || 'system',
            now,
            data.saleId,
          );

          await tx.run(
            `UPDATE installment_schedules
             SET status = 'settled_early',
                 paid_at = ?,
                 notes = NULL
             WHERE sale_id = ? AND status <> 'paid'`,
            data.date,
            data.saleId,
          );
        } else {
          await tx.run(
            `UPDATE sales
             SET paid = paid + ?,
                 remaining = CASE WHEN total - (paid + ?) < 0 THEN 0 ELSE total - (paid + ?) END,
                 locked = 1,
                 status = CASE WHEN (paid + ?) >= total - 0.01 THEN 'completed' ELSE 'pending' END,
                 collection_note = CASE WHEN (paid + ?) >= (total - 0.01) THEN NULL ELSE collection_note END
             WHERE id = ?`,
            data.amount, data.amount, data.amount, data.amount, data.amount, data.saleId,
          );

          if (data.installmentId) {
            const schedule = await tx.get(
              'SELECT id, amount, paid_amount, month_index, sale_id, status FROM installment_schedules WITH (UPDLOCK, ROWLOCK) WHERE id = ?',
              data.installmentId,
            );
            if (schedule) {
              if (schedule.status === 'paid' || (schedule.amount - schedule.paid_amount) <= 0.01) {
                const err: any = new Error('تم تحصيل هذا القسط بالفعل من جهاز آخر، يرجى تحديث الصفحة.');
                err.statusCode = 409;
                throw err;
              }
              const schRemaining = Math.max(0, Number((schedule.amount - schedule.paid_amount).toFixed(2)));
              const applied = Math.min(schRemaining, data.amount);
              const nextPaid = Number((schedule.paid_amount + applied).toFixed(2));
              const isPaid = (schedule.amount - nextPaid) <= 0.01;
              const finalPaid = isPaid ? schedule.amount : nextPaid;
              const nextStatus = isPaid ? 'paid' : (finalPaid > 0 ? 'partial' : 'unpaid');
              await tx.run(
                `UPDATE installment_schedules SET paid_amount = ?, status = ?, paid_at = ?, notes = CASE WHEN ? = 'paid' THEN NULL ELSE notes END WHERE id = ?`,
                finalPaid,
                nextStatus,
                data.date,
                nextStatus,
                data.installmentId,
              );

              // If payment exceeds current installment, cascade surplus to subsequent installments
              let surplus = Number((data.amount - applied).toFixed(2));
              if (surplus > 0) {
                const subsequentSchedules = await tx.all(
                  `SELECT id, amount, paid_amount FROM installment_schedules
                   WHERE sale_id = ? AND status <> 'paid' AND id <> ? AND month_index > ?
                   ORDER BY month_index ASC`,
                  schedule.sale_id,
                  schedule.id,
                  schedule.month_index,
                );
                for (const nextSch of subsequentSchedules) {
                  if (surplus <= 0) break;
                  const nextRemaining = Math.max(0, Number((nextSch.amount - nextSch.paid_amount).toFixed(2)));
                  const nextApplied = Math.min(nextRemaining, surplus);
                  const nextSchPaid = Number((nextSch.paid_amount + nextApplied).toFixed(2));
                  surplus = Number((surplus - nextApplied).toFixed(2));
                  const isNextPaid = (nextSch.amount - nextSchPaid) <= 0.01;
                  const finalNextPaid = isNextPaid ? nextSch.amount : nextSchPaid;
                  const nextSchStatus = isNextPaid ? 'paid' : (finalNextPaid > 0 ? 'partial' : 'unpaid');
                  await tx.run(
                    `UPDATE installment_schedules SET paid_amount = ?, status = ?, paid_at = ?, notes = CASE WHEN ? = 'paid' THEN NULL ELSE notes END WHERE id = ?`,
                    finalNextPaid,
                    nextSchStatus,
                    data.date,
                    nextSchStatus,
                    nextSch.id,
                  );
                }
              }
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
              const isSchPaid = (sch.amount - nextPaidAmount) <= 0.01;
              const finalSchPaid = isSchPaid ? sch.amount : nextPaidAmount;
              const schStatus = isSchPaid ? 'paid' : (finalSchPaid > 0 ? 'partial' : 'unpaid');
              await tx.run(
                `UPDATE installment_schedules SET paid_amount = ?, status = ?, paid_at = ?, notes = CASE WHEN ? = 'paid' THEN NULL ELSE notes END WHERE id = ?`,
                finalSchPaid,
                schStatus,
                data.date,
                schStatus,
                sch.id,
              );
            }
          }
        }
      }

      // 2. Update Customer Balance
      if (data.type === 'in' && finalCustomerId && data.affectsCustomerBalance) {
        const customerDeduction = data.isEarlySettlement ? liveRemainingForSettlement : data.amount;
        await tx.run(
          `UPDATE customers
           SET balance = ROUND(balance - ?, 2), updated_at = ?
           WHERE id = ?`,
          customerDeduction, now, finalCustomerId,
        );

        // If customer has no active remaining debt left across all sales, clear legal lawsuit flag
        const remainingCustomerDebt = (await tx.get(
          `SELECT COALESCE(SUM(remaining), 0) as total_debt
           FROM sales
           WHERE customer_id = ? AND status NOT IN ('cancelled', 'settled_early')`,
          finalCustomerId,
        )) as { total_debt: number } | undefined;
        if (Number(remainingCustomerDebt?.total_debt || 0) <= 0.5) {
          await tx.run(
            `UPDATE customers SET is_sued = 0, updated_at = ? WHERE id = ? AND is_sued = 1`,
            now,
            finalCustomerId,
          );
        }
      }

      // 3. Update Supplier Balance (allow negative balance = advance credit with supplier)
      if (data.type === 'out' && finalSupplierId) {
        await tx.run(
          `UPDATE suppliers
           SET balance = ROUND(balance - ?, 2), updated_at = ?
           WHERE id = ?`,
          data.amount, now, finalSupplierId,
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
        resolvedInvoiceNumber,
        data.affectsCustomerBalance ? 1 : 0,
        req.user?.name || 'system',
        now,
      );
    });

    // Build client info
    let clientName = '';
    if (finalCustomerId) {
      const custRow = await db.get<any>(`SELECT name FROM customers WHERE id = ?`, finalCustomerId);
      if (custRow) clientName = custRow.name;
    }

    if (data.isEarlySettlement) {
      await audit('payment.early_settlement', 'payment', id, req.user?.name || 'system', {
        id,
        receiptNumber,
        amount: data.amount,
        discount: data.settlementDiscount,
        saleId: data.saleId,
        authorizedBy: authorizingAdminName || (req.user?.role === 'admin' ? req.user?.name : null),
      });

      const adminNote = authorizingAdminName ? ` بموافقة المدير: ${authorizingAdminName}` : '';
      const detailedMessage = `تكييش وتصفية عقد: استلام ${formatMoney(data.amount)} (خصم تسوية ${formatMoney(data.settlementDiscount)}) - إيصال ${receiptNumber} - عميل ${clientName} - فاتورة ${data.invoiceNumber || ''}${adminNote}`;
      await createSystemNotification(
        'success',
        'تكييش وتصفية عقد',
        detailedMessage,
      );
    } else {
      await audit('payment.create', 'payment', id, req.user?.name || 'system', {
        id,
        receiptNumber,
        amount: data.amount,
        type: data.type,
      });

      let actionLabel = '';
      if (data.description?.includes('مقدم') || data.description?.includes('دفعة مقدمة')) {
        actionLabel = `تحصيل دفعة مقدمة للفاتورة ${data.invoiceNumber || ''}`.trim();
      } else {
        const installmentMatch = data.description?.match(/قسط\s+(\d+)/);
        const installmentNo = installmentMatch ? installmentMatch[1] : (data.installmentId ?? '');
        if (installmentNo) {
          actionLabel = `سداد القسط رقم ${installmentNo} من الفاتورة ${data.invoiceNumber || ''}`.trim();
        } else {
          actionLabel = `${data.description || 'حركة خزينة'} ${data.invoiceNumber ? `للفاتورة ${data.invoiceNumber}` : ''}`.trim();
        }
      }
      const detailedMessage = `${financialMovementLabel(data.type)} ${formatMoney(data.amount)} - ${actionLabel} - إيصال ${receiptNumber}${clientName ? ` - عميل ${clientName}` : ''}`;
      await createSystemNotification(
        data.type === 'in' ? 'success' : 'warning',
        `حركة خزينة ${financialMovementLabel(data.type)}`,
        detailedMessage,
      );
    }

    broadcastDataChange('payments', 'create', id);
    broadcastDataChange('sales', 'update', data.saleId || undefined);
    broadcastDataChange('customers', 'update', data.customerId || undefined);
    broadcastDataChange('notifications', 'create');
    return res.status(201).json({ id, receiptNumber });
  } catch (error: any) {
    return res.status(error?.statusCode || 500).json({ message: error.message || 'Database error' });
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
  if (original.void_ref || String(original.description || '').startsWith('Reverse of ')) {
    return res.status(409).json({ message: 'لا يمكن عكس حركة عكسية مرة أخرى.' });
  }

  const now = new Date().toISOString();
  const reverseId = uid();
  let receiptNumber = '';
  const reverseType = original.type === 'in' ? 'out' : 'in';

  try {
    if (req.user?.role !== 'admin' && (await isPeriodClosed(db, original.date) || await isPeriodClosed(db, now.slice(0, 10)))) {
      return res.status(400).json({ message: 'لا يمكن عكس حركة مالية في تاريخ مغلق مالياً' });
    }
    await db.withTransaction(async (tx) => {
      const lockedOriginal = (await tx.get(
        'SELECT status, void_ref FROM payments WITH (UPDLOCK, ROWLOCK) WHERE id = ?',
        req.params.id,
      )) as { status?: string; void_ref?: string | null } | undefined;
      if (!lockedOriginal || lockedOriginal.status === 'voided' || lockedOriginal.void_ref) {
        const conflictErr: any = new Error('Payment is already voided');
        conflictErr.statusCode = 409;
        throw conflictErr;
      }

      if (original.reference_type === 'internal_transfer' && original.reference_id) {
        const pairedLegs = (await tx.all(
          `SELECT * FROM payments WITH (UPDLOCK, ROWLOCK)
           WHERE reference_type = 'internal_transfer'
             AND reference_id = ?
             AND (status IS NULL OR status != 'voided')`,
          original.reference_id,
        )) as any[];
        for (const leg of pairedLegs) {
          const contraId = leg.id === original.id ? reverseId : uid();
          const contraReceipt = await nextReceiptNumber(tx);
          if (leg.id === original.id) {
            receiptNumber = contraReceipt;
          }
          const legReverseType = leg.type === 'in' ? 'out' : 'in';
          await tx.run(
            `INSERT INTO payments (
              id, type, amount, sale_id, installment_id, description, date, receipt_number, status, void_ref, approved_by, channel,
              reference_id, reference_type, customer_id, supplier_id, invoice_number, affects_customer_balance,
              created_by, created_at
            ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, 'voided', ?, ?, ?, ?, 'internal_transfer', NULL, NULL, NULL, 0, ?, ?)`,
            contraId,
            legReverseType,
            leg.amount,
            `Reverse of ${leg.description}`,
            now.slice(0, 10),
            contraReceipt,
            leg.id,
            req.user?.name || 'system',
            leg.channel || 'cash',
            leg.reference_id,
            req.user?.name || 'system',
            now,
          );
          await tx.run(
            "UPDATE payments SET status = 'voided', void_ref = ?, approved_by = ? WHERE id = ?",
            contraId,
            req.user?.name || 'system',
            leg.id,
          );
        }
        return;
      }

      receiptNumber = await nextReceiptNumber(tx);
      // 1. If reversing a sale payment (excluding upfront down-payment treasury record), deduct from paid and add back to remaining
      let isEarlySettlementReversal = false;
      let restoredEarlyRemaining = 0;
      const isDownPaymentReversal = !(original.affects_customer_balance === 1 || original.affects_customer_balance === true);

      if (original.sale_id && original.type === 'in' && !isDownPaymentReversal) {
        const linkedSale = (await tx.get(
          'SELECT id, status, discount, total, paid, remaining, notes FROM sales WITH (UPDLOCK, ROWLOCK) WHERE id = ?',
          original.sale_id,
        )) as { id: string; status: string; discount: number; total: number; paid: number; remaining: number; notes?: string | null } | undefined;

        if (linkedSale && String(linkedSale.notes || '').includes('تم التنازل عن المتبقي')) {
          throw Object.assign(new Error('لا يمكن عكس دفعة على عقد تم التنازل عنه لعميل آخر حفاظاً على سلامة الأرصدة.'), { statusCode: 409 });
        }

        const isActualEarlySettlementPayment =
          !original.installment_id && String(original.description || '').includes('سداد مبكر');

        if (linkedSale && linkedSale.status === 'settled_early' && isActualEarlySettlementPayment) {
          isEarlySettlementReversal = true;
          // 1. Reopen all early settled schedules
          await tx.run(
            `UPDATE installment_schedules
             SET status = CASE WHEN paid_amount > 0 THEN 'partial' ELSE 'unpaid' END,
                 paid_at = CASE WHEN paid_amount > 0 THEN paid_at ELSE NULL END
             WHERE sale_id = ? AND status = 'settled_early'`,
            original.sale_id,
          );

          // 2. Calculate restored unpaid remaining installments
          const schedDebt = (await tx.get(
            `SELECT COALESCE(SUM(amount - paid_amount), 0) as total_debt
             FROM installment_schedules
             WHERE sale_id = ?`,
            original.sale_id,
          )) as { total_debt: number } | undefined;

          restoredEarlyRemaining = Number((schedDebt?.total_debt || 0).toFixed(2));
          const restoredPaid = Math.max(0, Number((linkedSale.paid - original.amount).toFixed(2)));
          const restoredDiscount = Math.max(0, Number((linkedSale.total - (restoredPaid + restoredEarlyRemaining)).toFixed(2)));

          await tx.run(
            `UPDATE sales
             SET paid = ?,
                 remaining = ?,
                 discount = ?,
                 locked = 0,
                 status = CASE WHEN ? <= 0 THEN 'completed' ELSE 'pending' END,
                 last_edited_by = ?,
                 last_edited_at = ?
             WHERE id = ?`,
            restoredPaid,
            restoredEarlyRemaining,
            restoredDiscount,
            restoredEarlyRemaining,
            req.user?.name || 'system',
            now,
            original.sale_id,
          );
        } else {
          await tx.run(
            `UPDATE sales
             SET paid = CASE WHEN paid - ? < 0 THEN 0 ELSE paid - ? END,
                 remaining = CASE WHEN remaining + ? > total THEN total ELSE remaining + ? END,
                 locked = CASE WHEN (paid - ?) <= 0 THEN 0 ELSE 1 END,
                 status = CASE WHEN (paid - ?) >= total THEN 'completed' ELSE 'pending' END
             WHERE id = ?`,
            original.amount,
            original.amount,
            original.amount,
            original.amount,
            original.amount,
            original.amount,
            original.sale_id,
          );

          // Revert schedules
          if (original.installment_id) {
            const schedule = (await tx.get(
              'SELECT id, paid_amount, month_index, sale_id FROM installment_schedules WHERE id = ?',
              original.installment_id,
            )) as { id: string; paid_amount: number; month_index: number; sale_id: string } | undefined;
            if (schedule) {
              const targetRevert = Math.min(Number(schedule.paid_amount || 0), Number(original.amount || 0));
              const nextPaidAmount = Math.max(0, Number((schedule.paid_amount - targetRevert).toFixed(2)));
              const scheduleStatus = nextPaidAmount <= 0 ? 'unpaid' : 'partial';
              const latestPayment = nextPaidAmount > 0 ? ((await tx.get(
                'SELECT date FROM payments WHERE sale_id = ? AND status = \'posted\' AND id <> ? ORDER BY date DESC',
                schedule.sale_id,
                original.id,
              )) as { date: string } | undefined) : null;
              await tx.run(
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

              // Also revert any cascaded surplus on subsequent installments
              let surplusRevert = Number((Number(original.amount || 0) - targetRevert).toFixed(2));
              if (surplusRevert > 0.005) {
                const subsequentPaid = (await tx.all(
                  'SELECT id, paid_amount, sale_id FROM installment_schedules WHERE sale_id = ? AND month_index > ? AND paid_amount > 0 ORDER BY month_index DESC',
                  schedule.sale_id,
                  schedule.month_index,
                )) as { id: string; paid_amount: number; sale_id: string }[];
                for (const nextSch of subsequentPaid) {
                  if (surplusRevert <= 0) break;
                  const applied = Math.min(Number(nextSch.paid_amount || 0), surplusRevert);
                  const nextSubPaid = Math.max(0, Number((nextSch.paid_amount - applied).toFixed(2)));
                  surplusRevert = Number((surplusRevert - applied).toFixed(2));
                  const latestSubPay = nextSubPaid > 0 ? ((await tx.get(
                    'SELECT date FROM payments WHERE sale_id = ? AND status = \'posted\' AND id <> ? ORDER BY date DESC',
                    nextSch.sale_id,
                    original.id,
                  )) as { date: string } | undefined) : null;
                  await tx.run(
                    `UPDATE installment_schedules
                     SET paid_amount = ?,
                         status = ?,
                         paid_at = ?
                     WHERE id = ?`,
                    nextSubPaid,
                    nextSubPaid <= 0 ? 'unpaid' : 'partial',
                    latestSubPay ? latestSubPay.date : null,
                    nextSch.id,
                  );
                }
              }
            }
          } else {
            // Auto-revert schedules in reverse order (month_index DESC)
            const schedules = (await tx.all(
              'SELECT id, paid_amount, sale_id FROM installment_schedules WHERE sale_id = ? AND paid_amount > 0 ORDER BY month_index DESC',
              original.sale_id,
            )) as { id: string; paid_amount: number; sale_id: string }[];
            let remainingRevert = original.amount;
            for (const sch of schedules) {
              if (remainingRevert <= 0) break;
              const applied = Math.min(sch.paid_amount, remainingRevert);
              const nextPaidAmount = Number((sch.paid_amount - applied).toFixed(2));
              remainingRevert = Number((remainingRevert - applied).toFixed(2));

              const latestPayment = nextPaidAmount > 0 ? ((await tx.get(
                'SELECT date FROM payments WHERE sale_id = ? AND status = \'posted\' AND id <> ? ORDER BY date DESC',
                sch.sale_id,
                original.id,
              )) as { date: string } | undefined) : null;

              await tx.run(
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
      }

      // 2. Revert Customer Balance (outgoing reverse payment increases debtor balance)
      if (original.type === 'in' && original.customer_id && original.affects_customer_balance) {
        const revertBalanceAmount = isEarlySettlementReversal && restoredEarlyRemaining > 0
          ? restoredEarlyRemaining
          : original.amount;

        await tx.run(
          `UPDATE customers
           SET balance = balance + ?,
               updated_at = ?
           WHERE id = ?`,
          revertBalanceAmount,
          now,
          original.customer_id,
        );
      }

      // 3. Revert Supplier Balance (incoming reverse payment increases creditor balance we owe them)
      if (original.type === 'out' && original.supplier_id) {
        await tx.run(
          `UPDATE suppliers
           SET balance = balance + ?,
               updated_at = ?
           WHERE id = ?`,
          original.amount,
          now,
          original.supplier_id,
        );
      }

      // 3b. If reversing an expense payment, also delete the linked expense row so profit & balance sheet stay reconciled
      if (original.type === 'out' && original.reference_type === 'expense' && original.reference_id) {
        await tx.run('DELETE FROM expenses WHERE id = ?', original.reference_id);
      }

      // 4. Create voided contra-entry audit log (status='voided' prevents 2x subtraction in treasury totals since original is also marked voided)
      await tx.run(
        `INSERT INTO payments (
          id, type, amount, sale_id, installment_id, description, date, receipt_number, status, void_ref, approved_by, channel,
          reference_id, reference_type, customer_id, supplier_id, invoice_number, affects_customer_balance,
          created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'voided', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      await tx.run(
        'UPDATE payments SET status = \'voided\', void_ref = ?, approved_by = ? WHERE id = ?',
        reverseId,
        req.user?.name || 'system',
        original.id,
      );
    });

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

const editInstallmentPaymentSchema = z.object({
  amount: z.number().positive(),
  date: z.string().min(8),
  description: z.string().min(1).optional(),
});

// PATCH /payments/:id — Direct edit of an installment payment (amount/date/description) without duplicate reversal entries
router.patch('/:id', requirePermission('payments:write'), async (req: AuthedRequest, res) => {
  const parsed = editInstallmentPaymentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid payment edit payload', issues: parsed.error.issues });
  }

  const db = await dbPromise;
  const original = await db.get<any>('SELECT * FROM payments WHERE id = ?', req.params.id);
  if (!original) return res.status(404).json({ message: 'Payment not found' });
  if (original.status === 'voided') return res.status(409).json({ message: 'لا يمكن تعديل حركة ملغاة.' });
  if (original.void_ref || String(original.description || '').startsWith('Reverse of ')) {
    return res.status(409).json({ message: 'لا يمكن تعديل حركة عكسية.' });
  }
  if (original.type !== 'in' || !original.sale_id || original.affects_customer_balance === 0) {
    return res.status(400).json({ message: 'التعديل المباشر متاح لحركات سداد الأقساط فقط.' });
  }

  const newAmount = roundMoney(parsed.data.amount);
  const newDate = parseDateInput(parsed.data.date);
  const newDescription = parsed.data.description?.trim() || original.description;
  const oldAmount = roundMoney(Number(original.amount || 0));
  const delta = roundMoney(newAmount - oldAmount);
  const now = new Date().toISOString();

  if (req.user?.role !== 'admin') {
    const oldDate = String(original.date || '').slice(0, 10);
    if ((oldDate && await isPeriodClosed(db, oldDate)) || await isPeriodClosed(db, newDate)) {
      return res.status(403).json({ message: 'لا يمكن تعديل حركة في فترة مغلقة مالياً.' });
    }
  }

  try {
    let lockedOldAmount = oldAmount;
    await db.withTransaction(async (tx: any) => {
      const lockedPayment = await tx.get('SELECT * FROM payments WITH (UPDLOCK, ROWLOCK) WHERE id = ?', req.params.id);
      if (!lockedPayment || lockedPayment.status === 'voided') {
        throw new Error('لا يمكن تعديل حركة غير موجودة أو ملغاة.');
      }
      lockedOldAmount = roundMoney(Number(lockedPayment.amount || 0));
      const liveDelta = roundMoney(newAmount - lockedOldAmount);

      const sale = await tx.get('SELECT * FROM sales WITH (UPDLOCK, ROWLOCK) WHERE id = ?', lockedPayment.sale_id);
      if (!sale) throw new Error('الفاتورة المرتبطة غير موجودة.');

      if (liveDelta !== 0) {
        if (liveDelta > roundMoney(Number(sale.remaining || 0)) + 0.01) {
          throw new Error('المبلغ الجديد يتجاوز الرصيد المتبقي على الفاتورة.');
        }

        const nextPaid = roundMoney(Math.max(0, Number(sale.paid || 0) + liveDelta));
        const nextRemaining = roundMoney(Math.max(0, Number(sale.remaining || 0) - liveDelta));
        const nextStatus = sale.status === 'settled_early' ? 'settled_early' : nextRemaining <= 0.01 ? 'completed' : 'pending';

        await tx.run(
          'UPDATE sales SET paid = ?, remaining = ?, status = ? WHERE id = ?',
          nextPaid,
          nextRemaining,
          nextStatus,
          sale.id
        );

        if (lockedPayment.customer_id) {
          await tx.run(
            'UPDATE customers SET balance = ROUND(balance - ?, 2), updated_at = ? WHERE id = ?',
            liveDelta,
            now,
            lockedPayment.customer_id
          );
        }

        if (lockedPayment.installment_id) {
          const schedule = await tx.get(
            'SELECT * FROM installment_schedules WITH (UPDLOCK, ROWLOCK) WHERE id = ?',
            lockedPayment.installment_id
          );
          if (schedule) {
            const schedAmount = roundMoney(Number(schedule.amount || 0));
            const nextSchedPaid = roundMoney(
              Math.max(0, Math.min(schedAmount, Number(schedule.paid_amount || 0) + liveDelta))
            );
            const nextSchedStatus =
              nextSchedPaid >= schedAmount - 0.01
                ? 'paid'
                : nextSchedPaid > 0.01
                  ? 'partial'
                  : 'unpaid';
            await tx.run(
              'UPDATE installment_schedules SET paid_amount = ?, status = ?, paid_at = ? WHERE id = ?',
              nextSchedPaid,
              nextSchedStatus,
              nextSchedPaid > 0 ? newDate : null,
              schedule.id
            );
          }
        }
      } else if (lockedPayment.installment_id) {
        await tx.run(
          'UPDATE installment_schedules SET paid_at = ? WHERE id = ? AND paid_amount > 0',
          newDate,
          lockedPayment.installment_id
        );
      }

      await tx.run(
        'UPDATE payments SET amount = ?, date = ?, description = ?, approved_by = ? WHERE id = ?',
        newAmount,
        newDate,
        newDescription,
        req.user?.name || 'system',
        lockedPayment.id
      );
    });

    await audit('payment.update', 'payment', original.id, req.user?.name || 'system', {
      oldAmount: lockedOldAmount,
      newAmount,
      newDate,
    });
    return res.json({ message: 'Updated' });
  } catch (error: any) {
    return res.status(400).json({ message: error.message || 'Failed to update payment' });
  }
});

export default router;






