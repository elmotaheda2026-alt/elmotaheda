import { Router } from 'express';
import { z } from 'zod';
import { dbPromise } from '../db.js';
import { requireAuth, requirePermission, type AuthedRequest } from '../middleware/auth.js';
import { audit } from '../audit.js';
import { uid, formatDate, parseDateInput } from '../utils.js';

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

type SaleInput = z.infer<typeof saleSchema>;

type SaleRow = {
  id: string;
  invoice_number: string;
  customer_id: string;
  customer_name: string;
  subtotal?: number | null;
  discount?: number | null;
  tax?: number | null;
  total: number;
  paid: number;
  remaining: number;
  status: string;
  date: string;
  notes?: string | null;
  version: number;
  locked: number | boolean;
  last_edited_by?: string | null;
  last_edited_at?: string | null;
  created_by: string;
  created_at: string;
  payment_method?: string | null;
  manual_invoice_ref?: string | null;
  sales_rep_id?: string | null;
  sales_rep_name?: string | null;
  commission_rate?: number | null;
  commission_amount?: number | null;
  installment_months?: number | null;
  installment_start_date?: string | null;
  upfront_amount?: number | null;
  monthly_installment_amount?: number | null;
};

type SaleItemRow = {
  product_id: string;
  product_name: string;
  barcode: string;
  quantity: number;
  unit_price: number;
  discount: number;
  tax: number;
  total: number;
};

type ScheduleRow = {
  id: string;
  month_index: number;
  due_date: string;
  amount: number;
  paid_amount: number;
  status: string;
};

function mapSaleItems(items: SaleItemRow[]) {
  return items.map((item) => ({
    productId: item.product_id,
    productName: item.product_name,
    barcode: item.barcode,
    quantity: Number(item.quantity),
    unitPrice: Number(item.unit_price),
    discount: Number(item.discount),
    tax: Number(item.tax),
    total: Number(item.total),
  }));
}

function mapSchedules(schedules: ScheduleRow[]) {
  return schedules.map((sch) => ({
    id: sch.id,
    monthIndex: Number(sch.month_index),
    label: `القسط ${sch.month_index}`,
    dueDate: formatDate(sch.due_date),
    amount: Number(sch.amount),
    paidAmount: Number(sch.paid_amount),
    status: sch.status,
  }));
}

function mapSale(row: SaleRow, items: ReturnType<typeof mapSaleItems> = [], schedules: ReturnType<typeof mapSchedules> = []) {
  return {
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
    date: formatDate(row.date),
    notes: row.notes,
    version: row.version,
    locked: row.locked === 1 || row.locked === true,
    lastEditedBy: row.last_edited_by,
    lastEditedAt: row.last_edited_at,
    createdBy: row.created_by,
    createdAt: formatDate(row.created_at),
    items,
    financing: {
      paymentMethod: row.payment_method || 'cash',
      manualInvoiceRef: row.manual_invoice_ref,
      salesRepId: row.sales_rep_id,
      salesRepName: row.sales_rep_name,
      commissionRate: row.commission_rate ? Number(row.commission_rate) : undefined,
      commissionAmount: row.commission_amount ? Number(row.commission_amount) : undefined,
      installmentMonths: row.installment_months ? Number(row.installment_months) : undefined,
      installmentStartDate: formatDate(row.installment_start_date),
      upfrontAmount: row.upfront_amount ? Number(row.upfront_amount) : undefined,
      monthlyInstallmentAmount: row.monthly_installment_amount ? Number(row.monthly_installment_amount) : undefined,
      schedules,
    },
  };
}

async function insertSaleItemsAndAdjustStock(db: Awaited<typeof dbPromise>, saleId: string, items: SaleInput['items'], now: string) {
  for (const item of items) {
    await db.run(
      `INSERT INTO sale_items (
        id, sale_id, product_id, product_name, barcode, quantity, unit_price, discount, tax, total
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      uid(),
      saleId,
      item.productId,
      item.productName,
      item.barcode,
      item.quantity,
      item.unitPrice,
      item.discount,
      item.tax,
      item.total,
    );

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
}

async function insertInstallmentSchedules(db: Awaited<typeof dbPromise>, saleId: string, data: SaleInput, remaining: number) {
  if (data.financing?.paymentMethod !== 'installment' || !data.financing.installmentMonths || data.financing.installmentMonths <= 0) {
    return;
  }

  const months = data.financing.installmentMonths;
  const startDate = data.financing.installmentStartDate || data.date;
  const baseAmount = Number((remaining / months).toFixed(2));
  let remainingAmount = remaining;

  for (let index = 0; index < months; index++) {
    const amount = index === months - 1 ? Number(remainingAmount.toFixed(2)) : baseAmount;
    remainingAmount = Number((remainingAmount - amount).toFixed(2));

    await db.run(
      `INSERT INTO installment_schedules (id, sale_id, month_index, due_date, amount, paid_amount, status)
       VALUES (?, ?, ?, ?, ?, 0, 'unpaid')`,
      uid(),
      saleId,
      index + 1,
      addMonths(startDate, index),
      amount,
    );
  }
}

async function getMappedSale(id: string) {
  const db = await dbPromise;
  const row = await db.get<SaleRow>('SELECT * FROM sales WHERE id = ?', id);
  if (!row) return null;
  const items = await db.all<SaleItemRow>('SELECT * FROM sale_items WHERE sale_id = ?', id);
  const schedules = await db.all<ScheduleRow>('SELECT * FROM installment_schedules WHERE sale_id = ? ORDER BY month_index ASC', id);
  return mapSale(row, mapSaleItems(items), mapSchedules(schedules));
}

router.get('/', requirePermission('sales:read'), async (req, res) => {
  try {
    const db = await dbPromise;
    const rows = await db.all<SaleRow>('SELECT * FROM sales ORDER BY created_at DESC');
    const includeItems = String(req.query.includeItems) === 'true';
    if (includeItems) {
      const allItems = await db.all<(SaleItemRow & { sale_id: string })>('SELECT * FROM sale_items');
      const itemsBySale = new Map<string, SaleItemRow[]>();
      allItems.forEach((item) => {
        const current = itemsBySale.get(item.sale_id) || [];
        current.push(item);
        itemsBySale.set(item.sale_id, current);
      });
      return res.json(rows.map((row) => mapSale(row, mapSaleItems(itemsBySale.get(row.id) || []))));
    }
    // No items requested
    return res.json(rows.map((row) => mapSale(row, [])));
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

router.get('/:id', requirePermission('sales:read'), async (req, res) => {
  try {
    const sale = await getMappedSale(req.params.id);
    if (!sale) {
      return res.status(404).json({ message: 'Sale not found' });
    }
    return res.json(sale);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

router.post('/', requirePermission('sales:write'), async (req: AuthedRequest, res) => {
  const parsed = saleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid sale payload', errors: parsed.error.format() });
  }

  const data = parsed.data;
  // Parse date fields (DD/MM/YYYY) to ISO
  try {
    data.date = parseDateInput(data.date);
    if (data.financing?.installmentStartDate) {
      data.financing.installmentStartDate = parseDateInput(data.financing.installmentStartDate);
    }
  } catch (e) {
    return res.status(400).json({ message: e instanceof Error ? e.message : 'Invalid date format' });
  }
  const id = uid();
  const now = new Date().toISOString();
  const remaining = Number((data.total - data.paid).toFixed(2));
  const status = remaining <= 0 ? 'completed' : 'pending';

  try {
    const db = await dbPromise;
    const customer = await db.get('SELECT id FROM customers WHERE id = ?', data.customerId);
    if (!customer) {
      return res.status(400).json({ message: 'Customer not found' });
    }

    await db.run(
      `INSERT INTO sales (
        id, invoice_number, customer_id, customer_name, total, paid, remaining, status, date, notes, version, locked,
        last_edited_by, last_edited_at, created_by, created_at, subtotal, discount, tax,
        payment_method, manual_invoice_ref, sales_rep_id, sales_rep_name, commission_rate, commission_amount,
        installment_months, installment_start_date, upfront_amount, monthly_installment_amount
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      data.invoiceNumber,
      data.customerId,
      data.customerName,
      data.total,
      data.paid,
      remaining,
      status,
      data.date,
      data.notes || null,
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

    await insertSaleItemsAndAdjustStock(db, id, data.items, now);
    await insertInstallmentSchedules(db, id, data, remaining);

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
      return res.status(409).json({ message: 'Invoice number already exists' });
    }
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

router.put('/:id', requirePermission('sales:write'), async (req: AuthedRequest, res) => {
  const parsed = saleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid sale payload', errors: parsed.error.format() });
  }

  const data = parsed.data;
  // Parse date fields (DD/MM/YYYY) to ISO
  try {
    data.date = parseDateInput(data.date);
    if (data.financing?.installmentStartDate) {
      data.financing.installmentStartDate = parseDateInput(data.financing.installmentStartDate);
    }
  } catch (e) {
    return res.status(400).json({ message: e instanceof Error ? e.message : 'Invalid date format' });
  }
  const now = new Date().toISOString();
  const remaining = Number((data.total - data.paid).toFixed(2));
  const status = remaining <= 0 ? 'completed' : 'pending';

  try {
    const db = await dbPromise;
    const existing = await db.get<SaleRow>('SELECT * FROM sales WHERE id = ?', req.params.id);
    if (!existing) {
      return res.status(404).json({ message: 'Sale not found' });
    }

    if (Number(existing.paid || 0) > 0 || existing.locked === 1 || existing.locked === true) {
      return res.status(409).json({ message: 'Cannot edit a sale that has payments or is locked' });
    }

    const customer = await db.get('SELECT id FROM customers WHERE id = ?', data.customerId);
    if (!customer) {
      return res.status(400).json({ message: 'Customer not found' });
    }

    const oldItems = await db.all<SaleItemRow>('SELECT * FROM sale_items WHERE sale_id = ?', req.params.id);
    for (const item of oldItems) {
      await db.run(
        `UPDATE products
         SET quantity = quantity + ?,
             updated_at = ?
         WHERE id = ? AND fulfillment_type = 'stocked'`,
        item.quantity,
        now,
        item.product_id,
      );
    }

    await db.run(
      `UPDATE customers
       SET balance = balance - ?,
           updated_at = ?
       WHERE id = ?`,
      existing.remaining,
      now,
      existing.customer_id,
    );

    await db.run('DELETE FROM sale_items WHERE sale_id = ?', req.params.id);
    await db.run('DELETE FROM installment_schedules WHERE sale_id = ?', req.params.id);

    await db.run(
      `UPDATE sales
       SET invoice_number = ?, customer_id = ?, customer_name = ?, total = ?, paid = ?, remaining = ?,
           status = ?, date = ?, notes = ?, version = version + 1, locked = 0,
           last_edited_by = ?, last_edited_at = ?, subtotal = ?, discount = ?, tax = ?,
           payment_method = ?, manual_invoice_ref = ?, sales_rep_id = ?, sales_rep_name = ?,
           commission_rate = ?, commission_amount = ?, installment_months = ?, installment_start_date = ?,
           upfront_amount = ?, monthly_installment_amount = ?
       WHERE id = ?`,
      data.invoiceNumber,
      data.customerId,
      data.customerName,
      data.total,
      data.paid,
      remaining,
      status,
      data.date,
      data.notes || null,
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
      req.params.id,
    );

    await insertSaleItemsAndAdjustStock(db, req.params.id, data.items, now);
    await insertInstallmentSchedules(db, req.params.id, data, remaining);

    await db.run(
      `UPDATE customers
       SET balance = balance + ?,
           updated_at = ?
       WHERE id = ?`,
      remaining,
      now,
      data.customerId,
    );

    await audit('sale.update', 'sale', req.params.id, req.user?.name || 'system', {
      invoiceNumber: data.invoiceNumber,
      total: data.total,
      remaining,
    });

    return res.json({ message: 'Sale updated successfully' });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE') || error.message?.includes('violates UNIQUE constraint')) {
      return res.status(409).json({ message: 'Invoice number already exists' });
    }
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

export default router;
