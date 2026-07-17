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
  const origDate = new Date(dateStr);
  if (isNaN(origDate.getTime())) {
    return dateStr;
  }
  const originalDay = origDate.getDate();
  const newDate = new Date(origDate);
  newDate.setMonth(newDate.getMonth() + months);
  const daysInTargetMonth = new Date(newDate.getFullYear(), newDate.getMonth() + 1, 0).getDate();
  newDate.setDate(Math.min(originalDay, daysInTargetMonth));
  const year = newDate.getFullYear();
  const month = newDate.getMonth() + 1;
  const day = newDate.getDate();
  return `${year}-${pad(month)}-${pad(day)}`;
}

const saleItemSchema = z.object({
  productId: z.string().min(1),
  productName: z.string().min(1),
  barcode: z.string().optional().nullable(),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  unitCost: z.number().nonnegative().optional().default(0),
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

const roundMoney = (value: number) => Number(Number(value || 0).toFixed(2));

function validateSaleTotals(data: SaleInput): string | null {
  const round = (v: number) => Number(Number(v || 0).toFixed(2));
  // Subtotal: sum of quantity * unit price
  const subtotal = round(
    data.items.reduce((sum, item) => sum + round(item.quantity * item.unitPrice), 0),
  );
  // Discount: percentage per item
  const discount = round(
    data.items.reduce(
      (sum, item) => sum + round((item.quantity * item.unitPrice * item.discount) / 100),
      0,
    ),
  );
  // Tax: percentage applied after discount per item
  const tax = round(
    data.items.reduce((sum, item) => {
      const itemSubtotal = round(item.quantity * item.unitPrice);
      const discountAmt = round((itemSubtotal * item.discount) / 100);
      const taxable = itemSubtotal - discountAmt;
      return sum + round((taxable * item.tax) / 100);
    }, 0),
  );
  const total = round(subtotal - discount + tax);

  // Verify each item's total using percentage logic
  const itemsMismatch = data.items.some((item) => {
    const itemSubtotal = round(item.quantity * item.unitPrice);
    const discountAmt = round((itemSubtotal * item.discount) / 100);
    const taxable = itemSubtotal - discountAmt;
    const taxAmt = round((taxable * item.tax) / 100);
    const expected = round(taxable + taxAmt);
    return Math.abs(round(item.total) - expected) > 0.01;
  });

  if (itemsMismatch) return 'Sale item totals do not match quantity, unit price, discount, and tax.';
  if (round(data.subtotal) !== subtotal) return 'Sale subtotal does not match item subtotal.';
  if (round(data.discount) !== discount) return 'Sale discount does not match item discounts.';
  if (round(data.tax) !== tax) return 'Sale tax does not match item taxes.';
  if (round(data.total) !== total) return 'Sale total does not match subtotal - discount + tax.';
  if (round(data.paid) > total) return 'Paid amount cannot exceed sale total.';
  return null;
}

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
  barcode?: string | null;
  quantity: number;
  unit_price: number;
  unit_cost?: number | null;
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
  paid_at?: string | null;
};
type DueCollectionRow = {
  sale_id: string;
  invoice_number: string;
  customer_id: string;
  customer_name: string;
  customer_phone?: string | null;
  customer_address?: string | null;
  sales_rep_id?: string | null;
  sales_rep_name?: string | null;
  is_sued?: number | boolean | null;
  guarantors?: string | null;
  installment_id: string;
  month_index: number;
  due_date: string;
  amount: number;
  paid_amount: number;
  status: string;
  paid_at?: string | null;
  last_payment_date?: string | null;
};

function mapSaleItems(items: SaleItemRow[]) {
  return items.map((item) => ({
    productId: item.product_id,
    productName: item.product_name,
    barcode: item.barcode || '',
    quantity: Number(item.quantity),
    unitPrice: Number(item.unit_price),
    unitCost: Number(item.unit_cost || 0),
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
    paidAt: sch.paid_at || undefined,
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
      installmentStartDate: row.installment_start_date ? formatDate(row.installment_start_date) : undefined,
      upfrontAmount: row.upfront_amount ? Number(row.upfront_amount) : undefined,
      monthlyInstallmentAmount: row.monthly_installment_amount ? Number(row.monthly_installment_amount) : undefined,
      schedules,
    },
  };
}

async function insertSaleItemsAndAdjustStock(db: Awaited<typeof dbPromise>, saleId: string, items: SaleInput['items'], now: string) {
  const itemsMissingUnitCost = items.filter((item) => !item.unitCost);
  const productIds = Array.from(new Set(itemsMissingUnitCost.map((item) => item.productId)));
  const purchasePriceByProduct = new Map<string, number>();

  if (productIds.length) {
    const rows = await db.all<{ id: string; purchase_price: number }>(
      `SELECT id, purchase_price FROM products WHERE id IN (${productIds.map(() => '?').join(',')})`,
      ...productIds,
    );
    rows.forEach((row) => purchasePriceByProduct.set(row.id, Number(row.purchase_price || 0)));
  }

  for (const item of items) {
    await db.run(
      `INSERT INTO sale_items (
        id, sale_id, product_id, product_name, barcode, quantity, unit_price, unit_cost, discount, tax, total
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      uid(),
      saleId,
      item.productId,
      item.productName,
      item.barcode || null,
      item.quantity,
      item.unitPrice,
      item.unitCost || purchasePriceByProduct.get(item.productId) || 0,
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
  const row = await db.get<SaleRow & { items_json?: string; schedules_json?: string }>(
    `SELECT s.*,
            (SELECT * FROM sale_items WHERE sale_id = s.id FOR JSON PATH) AS items_json,
            (SELECT * FROM installment_schedules WHERE sale_id = s.id ORDER BY month_index ASC FOR JSON PATH) AS schedules_json
     FROM sales s
     WHERE s.id = ?`,
    id
  );
  if (!row) return null;
  const items = row.items_json ? JSON.parse(row.items_json) : [];
  const schedules = row.schedules_json ? JSON.parse(row.schedules_json) : [];
  return mapSale(row, mapSaleItems(items), mapSchedules(schedules));
}

router.get('/', requirePermission('sales:read'), async (req, res) => {
  try {
    const db = await dbPromise;
    const includeItems = String(req.query.includeItems) === 'true';
    const customerId = typeof req.query.customerId === 'string' ? req.query.customerId.trim() : '';
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const requestedLimit = Number(req.query.limit || 0);
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(Math.floor(requestedLimit), 100) : 0;
    const whereParts: string[] = [];
    const args: any[] = [];

    if (customerId) {
      whereParts.push('s.customer_id = ?');
      args.push(customerId);
    }

    if (search) {
      whereParts.push('(s.customer_name LIKE ? OR s.invoice_number LIKE ?)');
      args.push(`%${search}%`, `%${search}%`);
    }

    const where = whereParts.length ? ` WHERE ${whereParts.join(' AND ')}` : '';
    const topClause = limit ? `TOP (${limit}) ` : '';

    const query = `
      SELECT ${topClause}s.*,
             (SELECT * FROM installment_schedules WHERE sale_id = s.id ORDER BY month_index ASC FOR JSON PATH) AS schedules_json
             ${includeItems ? ', (SELECT * FROM sale_items WHERE sale_id = s.id FOR JSON PATH) AS items_json' : ''}
      FROM sales s
      ${where}
      ORDER BY s.created_at DESC
    `;

    const rows = await db.all<SaleRow & { schedules_json?: string; items_json?: string }>(query, ...args);

    const mapped = rows.map((row) => {
      const schedules = row.schedules_json ? JSON.parse(row.schedules_json) : [];
      const items = row.items_json ? JSON.parse(row.items_json) : [];
      return mapSale(row, mapSaleItems(items), mapSchedules(schedules));
    });

    return res.json(mapped);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

router.get('/collection-due', requirePermission('sales:read'), async (req, res) => {
  try {
    const db = await dbPromise;
    const from = typeof req.query.from === 'string' ? req.query.from.trim() : '';
    const to = typeof req.query.to === 'string' ? req.query.to.trim() : '';
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const salesRepId = typeof req.query.salesRepId === 'string' ? req.query.salesRepId.trim() : '';
    const hideSued = String(req.query.hideSued) === 'true';

    if (!from || !to || from > to) {
      return res.status(400).json({ message: 'Valid from/to date range is required' });
    }

    const whereParts = [
      "s.status <> 'cancelled'",
      "sch.status <> 'paid'",
      'sch.due_date >= ?',
      'sch.due_date <= ?',
    ];
    const args: any[] = [from, to];

    if (search) {
      whereParts.push('(s.customer_name LIKE ? OR s.invoice_number LIKE ? OR c.phone LIKE ? OR c.address LIKE ?)');
      args.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (salesRepId && salesRepId !== 'all') {
      whereParts.push('s.sales_rep_id = ?');
      args.push(salesRepId);
    }

    if (hideSued) {
      whereParts.push('ISNULL(c.is_sued, 0) = 0');
    }

    const rows = await db.all<DueCollectionRow>(
      `
      SELECT
        s.id AS sale_id,
        s.invoice_number,
        s.customer_id,
        s.customer_name,
        c.phone AS customer_phone,
        c.address AS customer_address,
        s.sales_rep_id,
        s.sales_rep_name,
        c.is_sued,
        c.guarantors,
        sch.id AS installment_id,
        sch.month_index,
        sch.due_date,
        sch.amount,
        sch.paid_amount,
        sch.status,
        sch.paid_at,
        last_payment.last_payment_date
      FROM installment_schedules sch
      INNER JOIN sales s ON s.id = sch.sale_id
      LEFT JOIN customers c ON c.id = s.customer_id
      LEFT JOIN (
        SELECT sale_id, MAX(date) AS last_payment_date
        FROM payments
        WHERE status = 'posted'
        GROUP BY sale_id
      ) last_payment ON last_payment.sale_id = s.id
      WHERE ${whereParts.join(' AND ')}
      ORDER BY sch.due_date ASC, s.customer_name ASC, sch.month_index ASC
      `,
      ...args,
    );

    return res.json(rows.map((row) => ({
      saleId: row.sale_id,
      invoiceNumber: row.invoice_number,
      customerId: row.customer_id,
      customerName: row.customer_name,
      customerPhone: row.customer_phone || '-',
      customerAddress: row.customer_address || '-',
      installmentId: row.installment_id,
      installmentLabel: `القسط ${row.month_index}`,
      dueDate: formatDate(row.due_date),
      installmentAmount: Number(row.amount),
      remainingAmount: Math.max(Number(row.amount) - Number(row.paid_amount), 0),
      status: row.status,
      paidAt: row.paid_at || undefined,
      guarantors: row.guarantors ? JSON.parse(row.guarantors) : [null, null, null],
      salesRepId: row.sales_rep_id || undefined,
      salesRepName: row.sales_rep_name || undefined,
      isSued: row.is_sued === 1 || row.is_sued === true,
      lastPaymentDate: row.last_payment_date || undefined,
    })));
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
    // eslint-disable-next-line no-console
    console.error('Sale Validation Error:', JSON.stringify(parsed.error.format(), null, 2));
    return res.status(400).json({ message: 'Invalid sale payload', errors: parsed.error.format() });
  }

  const data = parsed.data;
  const totalsError = validateSaleTotals(data);
  if (totalsError) {
    return res.status(400).json({ message: totalsError });
  }
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
  const totalsError = validateSaleTotals(data);
  if (totalsError) {
    return res.status(400).json({ message: totalsError });
  }
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

router.delete('/:id', requirePermission('sales:write'), async (req: AuthedRequest, res) => {
  const now = new Date().toISOString();

  try {
    const db = await dbPromise;
    const existing = await db.get<SaleRow>('SELECT * FROM sales WHERE id = ?', req.params.id);
    if (!existing) {
      return res.status(404).json({ message: 'Sale not found' });
    }

    const oldItems = await db.all<SaleItemRow>('SELECT * FROM sale_items WHERE sale_id = ?', req.params.id);
    const linkedPurchases = await db.all<{
      id: string;
      supplier_id: string;
      remaining: number;
    }>(
      `SELECT id, supplier_id, remaining
       FROM purchases
       WHERE notes LIKE ?`,
      `%${existing.invoice_number}%`,
    );
    const linkedPurchaseIds = linkedPurchases.map((purchase) => purchase.id);
    const linkedPurchaseItems = linkedPurchaseIds.length
      ? await db.all<{ purchase_id: string; product_id: string; quantity: number }>(
          `SELECT purchase_id, product_id, quantity
           FROM purchase_items
           WHERE purchase_id IN (${linkedPurchaseIds.map(() => '?').join(',')})`,
          ...linkedPurchaseIds,
        )
      : [];

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

    for (const item of linkedPurchaseItems) {
      await db.run(
        `UPDATE products
         SET quantity = CASE WHEN quantity - ? < 0 THEN 0 ELSE quantity - ? END,
             updated_at = ?
         WHERE id = ? AND fulfillment_type = 'stocked'`,
        item.quantity,
        item.quantity,
        now,
        item.product_id,
      );
    }

    for (const purchase of linkedPurchases) {
      await db.run(
        `UPDATE suppliers
         SET balance = CASE WHEN balance - ? < 0 THEN 0 ELSE balance - ? END,
             updated_at = ?
         WHERE id = ?`,
        purchase.remaining,
        purchase.remaining,
        now,
        purchase.supplier_id,
      );
    }

    await db.run(
      `UPDATE customers
       SET balance = CASE WHEN balance - ? < 0 THEN 0 ELSE balance - ? END,
           updated_at = ?
       WHERE id = ?`,
      existing.remaining,
      existing.remaining,
      now,
      existing.customer_id,
    );

    await db.run(
      `DELETE FROM payments
       WHERE sale_id = ?
          OR reference_id = ?
          OR invoice_number = ?`,
      req.params.id,
      req.params.id,
      existing.invoice_number,
    );
    await db.run('DELETE FROM collection_tasks WHERE sale_id = ?', req.params.id);
    await db.run('DELETE FROM reschedule_requests WHERE sale_id = ?', req.params.id);
    await db.run('DELETE FROM installment_schedules WHERE sale_id = ?', req.params.id);
    await db.run('DELETE FROM sale_items WHERE sale_id = ?', req.params.id);
    if (linkedPurchaseIds.length) {
      await db.run(
        `DELETE FROM purchase_items WHERE purchase_id IN (${linkedPurchaseIds.map(() => '?').join(',')})`,
        ...linkedPurchaseIds,
      );
      await db.run(
        `DELETE FROM payments
         WHERE reference_type = 'purchase'
           AND reference_id IN (${linkedPurchaseIds.map(() => '?').join(',')})`,
        ...linkedPurchaseIds,
      );
      await db.run(
        `DELETE FROM purchases WHERE id IN (${linkedPurchaseIds.map(() => '?').join(',')})`,
        ...linkedPurchaseIds,
      );
    }
    await db.run('DELETE FROM sales WHERE id = ?', req.params.id);

    await audit('sale.delete', 'sale', req.params.id, req.user?.name || 'system', {
      invoiceNumber: existing.invoice_number,
      customerId: existing.customer_id,
      total: existing.total,
      remaining: existing.remaining,
      itemsCount: oldItems.length,
      deletedAutoPurchaseIds: linkedPurchaseIds,
    });

    return res.json({ message: 'Sale deleted successfully' });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

export default router;




