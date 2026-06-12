import { Router } from 'express';
import { z } from 'zod';
import { dbPromise } from '../db.js';
import { requireAuth, requirePermission, type AuthedRequest } from '../middleware/auth.js';
import { audit } from '../audit.js';
import { uid } from '../utils.js';

const router = Router();
router.use(requireAuth);

const pad = (value: number) => String(value).padStart(2, '0');
function addMonths(dateStr: string, months: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) return dateStr;
  const monthIndex = month - 1 + months;
  const targetYear = year + Math.floor(monthIndex / 12);
  const normalizedMonthIndex = ((monthIndex % 12) + 12) % 12;
  const targetMonth = normalizedMonthIndex + 1;
  const lastDayInTargetMonth = new Date(targetYear, targetMonth, 0).getDate();
  const safeDay = Math.min(day, lastDayInTargetMonth);
  return `${targetYear}-${pad(targetMonth)}-${pad(safeDay)}`;
}

const saleItemSchema = z.object({
  productId: z.string().min(1),
  productName: z.string().min(1),
  barcode: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  discount: z.number().nonnegative().default(0),
  tax: z.number().nonnegative().default(0),
  total: z.number().nonnegative(),
});

const saleFinancingSchema = z.object({
  paymentMethod: z.enum(['cash', 'card', 'transfer', 'installment']).default('cash'),
  manualInvoiceRef: z.string().optional().nullable(),
  salesRepId: z.string().optional().nullable(),
  salesRepName: z.string().optional().nullable(),
  commissionRate: z.number().optional().nullable(),
  commissionAmount: z.number().optional().nullable(),
  installmentMonths: z.number().optional().nullable(),
  installmentStartDate: z.string().optional().nullable(),
  upfrontAmount: z.number().optional().nullable(),
  monthlyInstallmentAmount: z.number().optional().nullable(),
}).optional().nullable();

const saleSchema = z.object({
  customerId: z.string().min(1),
  customerName: z.string().min(1),
  invoiceNumber: z.string().min(1),
  items: z.array(saleItemSchema).min(1),
  subtotal: z.number().nonnegative(),
  discount: z.number().nonnegative().default(0),
  tax: z.number().nonnegative().default(0),
  total: z.number().positive(),
  paid: z.number().nonnegative().default(0),
  date: z.string().min(8),
  notes: z.string().optional().nullable(),
  financing: saleFinancingSchema,
});

// GET /sales
router.get('/', requirePermission('sales:read'), async (_req, res) => {
  try {
    const db = await dbPromise;
    const rows = await db.all('SELECT * FROM sales ORDER BY created_at DESC');
    const mapped = rows.map((row: any) => ({
      id: row.id,
      invoiceNumber: row.invoice_number,
      customerId: row.customer_id,
      customerName: row.customer_name,
      subtotal: Number(row.subtotal || 0),
      discount: Number(row.discount || 0),
      tax: Number(row.tax || 0),
      total: Number(row.total),
      paid: Number(row.paid),
      remaining: Number(row.remaining),
      status: row.status,
      date: row.date,
      version: row.version,
      locked: row.locked === 1 || row.locked === true,
      lastEditedBy: row.last_edited_by,
      lastEditedAt: row.last_edited_at,
      createdBy: row.created_by,
      createdAt: row.created_at,
      financing: {
        paymentMethod: row.payment_method || 'cash',
        manualInvoiceRef: row.manual_invoice_ref,
        salesRepId: row.sales_rep_id,
        salesRepName: row.sales_rep_name,
        commissionRate: row.commission_rate ? Number(row.commission_rate) : undefined,
        commissionAmount: row.commission_amount ? Number(row.commission_amount) : undefined,
        installmentMonths: row.installment_months ? Number(row.installment_months) : undefined,
        installmentStartDate: row.installment_start_date,
        upfrontAmount: row.upfront_amount ? Number(row.upfront_amount) : undefined,
        monthlyInstallmentAmount: row.monthly_installment_amount ? Number(row.monthly_installment_amount) : undefined,
      },
    }));
    return res.json(mapped);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// GET /sales/:id
router.get('/:id', requirePermission('sales:read'), async (req, res) => {
  try {
    const db = await dbPromise;
    const row = await db.get<any>('SELECT * FROM sales WHERE id = ?', req.params.id);
    if (!row) {
      return res.status(404).json({ message: 'Sale not found' });
    }

    const items = await db.all('SELECT * FROM sale_items WHERE sale_id = ?', req.params.id);
    const mappedItems = items.map((item: any) => ({
      productId: item.product_id,
      productName: item.product_name,
      barcode: item.barcode,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unit_price),
      discount: Number(item.discount),
      tax: Number(item.tax),
      total: Number(item.total),
    }));

    const schedules = await db.all('SELECT * FROM installment_schedules WHERE sale_id = ? ORDER BY month_index ASC', req.params.id);
    const mappedSchedules = schedules.map((sch: any) => ({
      id: sch.id,
      monthIndex: Number(sch.month_index),
      label: `القسط ${sch.month_index}`,
      dueDate: sch.due_date,
      amount: Number(sch.amount),
      paidAmount: Number(sch.paid_amount),
      status: sch.status,
    }));

    return res.json({
      id: row.id,
      invoiceNumber: row.invoice_number,
      customerId: row.customer_id,
      customerName: row.customer_name,
      subtotal: Number(row.subtotal || 0),
      discount: Number(row.discount || 0),
      tax: Number(row.tax || 0),
      total: Number(row.total),
      paid: Number(row.paid),
      remaining: Number(row.remaining),
      status: row.status,
      date: row.date,
      version: row.version,
      locked: row.locked === 1 || row.locked === true,
      lastEditedBy: row.last_edited_by,
      lastEditedAt: row.last_edited_at,
      createdBy: row.created_by,
      createdAt: row.created_at,
      items: mappedItems,
      financing: {
        paymentMethod: row.payment_method || 'cash',
        manualInvoiceRef: row.manual_invoice_ref,
        salesRepId: row.sales_rep_id,
        salesRepName: row.sales_rep_name,
        commissionRate: row.commission_rate ? Number(row.commission_rate) : undefined,
        commissionAmount: row.commission_amount ? Number(row.commission_amount) : undefined,
        installmentMonths: row.installment_months ? Number(row.installment_months) : undefined,
        installmentStartDate: row.installment_start_date,
        upfrontAmount: row.upfront_amount ? Number(row.upfront_amount) : undefined,
        monthlyInstallmentAmount: row.monthly_installment_amount ? Number(row.monthly_installment_amount) : undefined,
        schedules: mappedSchedules,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// POST /sales
router.post('/', requirePermission('sales:write'), async (req: AuthedRequest, res) => {
  const parsed = saleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid sale payload', errors: parsed.error.format() });
  }

  const data = parsed.data;
  const id = uid();
  const now = new Date().toISOString();
  const remaining = Number((data.total - data.paid).toFixed(2));
  const status = remaining <= 0 ? 'completed' : 'pending';

  try {
    const db = await dbPromise;

    // Verify customer exists
    const customer = await db.get('SELECT id FROM customers WHERE id = ?', data.customerId);
    if (!customer) {
      return res.status(400).json({ message: 'العميل المحدد غير موجود' });
    }

    // Insert sale invoice
    await db.run(
      `INSERT INTO sales (
        id, invoice_number, customer_id, customer_name, total, paid, remaining, status, date, version, locked,
        last_edited_by, last_edited_at, created_by, created_at, subtotal, discount, tax,
        payment_method, manual_invoice_ref, sales_rep_id, sales_rep_name, commission_rate, commission_amount,
        installment_months, installment_start_date, upfront_amount, monthly_installment_amount
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      data.invoiceNumber,
      data.customerId,
      data.customerName,
      data.total,
      data.paid,
      remaining,
      status,
      data.date,
      req.user?.name || 'system',
      now,
      req.user?.name || 'system',
      now,
      data.subtotal,
      data.discount,
      data.tax,
      data.financing?.paymentMethod || 'cash',
      data.financing?.manualInvoiceRef || null,
      data.financing?.salesRepId || null,
      data.financing?.salesRepName || null,
      data.financing?.commissionRate || null,
      data.financing?.commissionAmount || null,
      data.financing?.installmentMonths || null,
      data.financing?.installmentStartDate || null,
      data.financing?.upfrontAmount || null,
      data.financing?.monthlyInstallmentAmount || null,
    );

    // Insert sale items and reduce product stock
    for (const item of data.items) {
      const itemId = uid();
      await db.run(
        `INSERT INTO sale_items (
          id, sale_id, product_id, product_name, barcode, quantity, unit_price, discount, tax, total
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        itemId,
        id,
        item.productId,
        item.productName,
        item.barcode,
        item.quantity,
        item.unitPrice,
        item.discount,
        item.tax,
        item.total,
      );

      // Decrement product quantity in stock for stocked products
      await db.run(
        `UPDATE products
         SET quantity = CASE WHEN quantity - ? < 0 THEN 0 ELSE quantity - ? END,
             updated_at = ?
         WHERE id = ? AND fulfillment_type = 'stocked'`,
        item.quantity,
        item.quantity,
        now,
        item.productId,
      );
    }

    // Generate installment schedules if method is installment
    if (data.financing?.paymentMethod === 'installment' && data.financing.installmentMonths && data.financing.installmentMonths > 0) {
      const months = data.financing.installmentMonths;
      const startD = data.financing.installmentStartDate || data.date;
      const baseAmt = Number((remaining / months).toFixed(2));
      let remAmt = remaining;

      for (let index = 0; index < months; index++) {
        const schId = uid();
        const amt = index === months - 1 ? Number(remAmt.toFixed(2)) : baseAmt;
        remAmt = Number((remAmt - amt).toFixed(2));

        await db.run(
          `INSERT INTO installment_schedules (id, sale_id, month_index, due_date, amount, paid_amount, status)
           VALUES (?, ?, ?, ?, ?, 0, 'unpaid')`,
          schId,
          id,
          index + 1,
          addMonths(startD, index),
          amt,
        );
      }
    }

    // Update customer balance (increase their debtor balance by the remaining unpaid amount)
    await db.run(
      `UPDATE customers
       SET balance = balance + ?,
           updated_at = ?
       WHERE id = ?`,
      remaining,
      now,
      data.customerId,
    );

    await audit('sale.create', 'sale', id, req.user?.name || 'system', {
      id,
      invoiceNumber: data.invoiceNumber,
      total: data.total,
      remaining,
    });

    return res.status(201).json({ id });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE') || error.message?.includes('violates UNIQUE constraint')) {
      return res.status(409).json({ message: 'رقم الفاتورة مسجل بالفعل' });
    }
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

export default router;
