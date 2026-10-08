import { Router } from 'express';
import { z } from 'zod';
import { dbPromise } from '../db.js';
import { requireAdmin, requireAuth, requirePermission, type AuthedRequest } from '../middleware/auth.js';
import { audit } from '../audit.js';
import { uid, formatDate, parseDateInput } from '../utils.js';
import { createSystemNotification } from '../financialNotifications.js';

const router = Router();
router.use(requireAuth);

const pad = (value: number) => String(value).padStart(2, '0');

export function parseDateToYMD(dateStr: string): { year: number; month: number; day: number } | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const str = dateStr.trim();

  // 1. Check YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss
  const ymdMatch = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(str);
  if (ymdMatch) {
    return {
      year: parseInt(ymdMatch[1], 10),
      month: parseInt(ymdMatch[2], 10),
      day: parseInt(ymdMatch[3], 10),
    };
  }

  // 2. Check DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(str);
  if (dmyMatch) {
    return {
      year: parseInt(dmyMatch[3], 10),
      month: parseInt(dmyMatch[2], 10),
      day: parseInt(dmyMatch[1], 10),
    };
  }

  // 3. Fallback standard Date parsing
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    return {
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      day: d.getDate(),
    };
  }

  return null;
}

function addMonths(dateStr: string, months: number): string {
  const parsed = parseDateToYMD(dateStr);
  if (!parsed) return dateStr;

  const totalMonths = (parsed.year * 12 + (parsed.month - 1)) + months;
  const newYear = Math.floor(totalMonths / 12);
  const newMonth = (totalMonths % 12) + 1;
  const daysInTargetMonth = new Date(Date.UTC(newYear, newMonth, 0)).getUTCDate();
  const newDay = Math.min(parsed.day, daysInTargetMonth);

  return `${newYear}-${pad(newMonth)}-${pad(newDay)}`;
}

const saleItemSchema = z.preprocess((value) => {
  if (!value || typeof value !== 'object') return value;
  const item = value as Record<string, unknown>;
  return {
    ...item,
    productId: item.productId ?? item.product_id,
    productName: item.productName ?? item.product_name,
    unitPrice: item.unitPrice ?? item.unit_price,
    unitCost: item.unitCost ?? item.unit_cost,
  };
}, z.object({
  productId: z.string().min(1),
  productName: z.string().min(1),
  barcode: z.string().optional().nullable(),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  unitCost: z.number().nonnegative().optional().default(0),
  discount: z.number().nonnegative().default(0),
  tax: z.number().nonnegative().default(0),
  total: z.number().nonnegative(),
}));

const saleFinancingSchema = z.preprocess((value) => {
  if (!value || typeof value !== 'object') return value;
  const financing = value as Record<string, unknown>;
  return {
    ...financing,
    paymentMethod: financing.paymentMethod ?? financing.payment_method,
    manualInvoiceRef: financing.manualInvoiceRef ?? financing.manual_invoice_ref,
    salesRepId: financing.salesRepId ?? financing.sales_rep_id,
    salesRepName: financing.salesRepName ?? financing.sales_rep_name,
    commissionRate: financing.commissionRate ?? financing.commission_rate,
    commissionAmount: financing.commissionAmount ?? financing.commission_amount,
    installmentMonths: financing.installmentMonths ?? financing.installment_months,
    installmentStartDate: financing.installmentStartDate ?? financing.installment_start_date,
    upfrontAmount: financing.upfrontAmount ?? financing.upfront_amount,
    monthlyInstallmentAmount: financing.monthlyInstallmentAmount ?? financing.monthly_installment_amount,
  };
}, z.object({
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
})).optional().nullable();

const saleSchema = z.preprocess((value) => {
  if (!value || typeof value !== 'object') return value;
  const sale = value as Record<string, unknown>;
  return {
    ...sale,
    customerId: sale.customerId ?? sale.customer_id,
    customerName: sale.customerName ?? sale.customer_name,
    invoiceNumber: sale.invoiceNumber ?? sale.invoice_number,
    subtotal: sale.subtotal ?? sale.subtotal_amount,
    total: sale.total ?? sale.totalAmount ?? sale.total_amount,
    paid: sale.paid ?? sale.paidAmount ?? sale.paid_amount,
    financing: sale.financing ?? sale.paymentDetails ?? sale.payment_details ?? sale.installmentPlan ?? sale.installment_plan,
  };
}, z.object({
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
}));

type SaleInput = z.infer<typeof saleSchema>;

const roundMoney = (value: number) => Number(Number(value || 0).toFixed(2));

function validateSaleTotals(data: SaleInput): string | null {
  const round = (v: number) => Number(Number(v || 0).toFixed(2));

  // Recalculate each item total dynamically or check tolerance (< 0.05)
  for (const item of data.items) {
    const itemSubtotal = round(item.quantity * item.unitPrice);
    const discountAmt = round((itemSubtotal * item.discount) / 100);
    const taxable = itemSubtotal - discountAmt;
    const taxAmt = round((taxable * item.tax) / 100);
    const expected = round(taxable + taxAmt);

    // If total provided differs significantly from expected, update item.total to expected
    if (Math.abs(round(item.total) - expected) > 0.05) {
      item.total = expected;
    }
  }

  // Recalculate subtotal, discount, tax, total
  const subtotal = round(
    data.items.reduce((sum, item) => sum + round(item.quantity * item.unitPrice), 0),
  );
  const discount = round(
    data.items.reduce(
      (sum, item) => sum + round((item.quantity * item.unitPrice * item.discount) / 100),
      0,
    ),
  );
  const tax = round(
    data.items.reduce((sum, item) => {
      const itemSubtotal = round(item.quantity * item.unitPrice);
      const discountAmt = round((itemSubtotal * item.discount) / 100);
      const taxable = itemSubtotal - discountAmt;
      return sum + round((taxable * item.tax) / 100);
    }, 0),
  );
  const total = round(subtotal - discount + tax);

  if (Math.abs(round(data.subtotal) - subtotal) > 0.05) data.subtotal = subtotal;
  if (Math.abs(round(data.discount) - discount) > 0.05) data.discount = discount;
  if (Math.abs(round(data.tax) - tax) > 0.05) data.tax = tax;
  if (Math.abs(round(data.total) - total) > 0.05) data.total = total;

  if (round(data.paid) > data.total + 0.05) return 'Paid amount cannot exceed sale total.';
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
  deferred?: number | boolean | null;
  deferred_at?: string | null;
  notes?: string | null;
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
  deferred?: number | boolean | null;
  deferred_at?: string | null;
  notes?: string | null;
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
    dueDate: sch.due_date,
    amount: Number(sch.amount),
    paidAmount: Number(sch.paid_amount),
    status: sch.status,
    paidAt: sch.paid_at || undefined,
    deferred: sch.deferred === 1 || sch.deferred === true,
    deferredAt: sch.deferred_at || undefined,
    notes: sch.notes || undefined,
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
    date: row.date,
    notes: row.notes,
    version: row.version,
    locked: row.locked === 1 || row.locked === true,
    lastEditedBy: row.last_edited_by,
    lastEditedAt: row.last_edited_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    items,
    financing: {
      paymentMethod: row.payment_method || 'cash',
      manualInvoiceRef: row.manual_invoice_ref,
      salesRepId: row.sales_rep_id,
      salesRepName: row.sales_rep_name,
      commissionRate: row.commission_rate ? Number(row.commission_rate) : undefined,
      commissionAmount: row.commission_amount ? Number(row.commission_amount) : undefined,
      installmentMonths: row.installment_months ? Number(row.installment_months) : undefined,
      installmentStartDate: row.installment_start_date || undefined,
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
  const row = await db.get<SaleRow>('SELECT * FROM sales WHERE id = ?', id);
  if (!row) return null;

  const [items, schedules] = await Promise.all([
    db.all<SaleItemRow>('SELECT * FROM sale_items WHERE sale_id = ?', id),
    db.all<ScheduleRow>('SELECT * FROM installment_schedules WHERE sale_id = ? ORDER BY month_index ASC', id),
  ]);

  return mapSale(row, mapSaleItems(items), mapSchedules(schedules));
}

router.get('/', requirePermission('sales:read'), async (req, res) => {
  try {
    const db = await dbPromise;
    const includeItems = String(req.query.includeItems) === 'true';
    const customerId = typeof req.query.customerId === 'string' ? req.query.customerId.trim() : '';
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

    // Pagination parameters - explicitly active only if page/limit exists in query
    const pagination = (req.query.page || req.query.limit)
      ? {
        page: Math.max(1, Number(req.query.page || 1)),
        limit: Math.min(Math.max(1, Number(req.query.limit || 20)), 50)
      }
      : undefined;

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

    const query = `
      SELECT s.*,
             COUNT(*) OVER() AS total_count_metadata
      FROM sales s
      ${where}
      ORDER BY s.created_at DESC
    `;

    const rows = await db.all<SaleRow & { total_count_metadata?: number }>(
      query,
      args,
      pagination
    );

    const total = rows.length > 0 ? (rows[0].total_count_metadata || 0) : 0;
    const saleIds = rows.map((row) => row.id);
    const schedulesBySaleId = new Map<string, ScheduleRow[]>();
    const itemsBySaleId = new Map<string, SaleItemRow[]>();

    if (saleIds.length) {
      const placeholders = saleIds.map(() => '?').join(',');
      const scheduleRows = await db.all<ScheduleRow & { sale_id: string }>(
        `SELECT * FROM installment_schedules WHERE sale_id IN (${placeholders}) ORDER BY sale_id ASC, month_index ASC`,
        ...saleIds,
      );
      scheduleRows.forEach((schedule) => {
        const saleSchedules = schedulesBySaleId.get(schedule.sale_id) || [];
        saleSchedules.push(schedule);
        schedulesBySaleId.set(schedule.sale_id, saleSchedules);
      });

      if (includeItems) {
        const itemRows = await db.all<SaleItemRow & { sale_id: string }>(
          `SELECT * FROM sale_items WHERE sale_id IN (${placeholders})`,
          ...saleIds,
        );
        itemRows.forEach((item) => {
          const saleItems = itemsBySaleId.get(item.sale_id) || [];
          saleItems.push(item);
          itemsBySaleId.set(item.sale_id, saleItems);
        });
      }
    }

    const sales = rows.map((row) => (
      mapSale(
        row,
        mapSaleItems(itemsBySaleId.get(row.id) || []),
        mapSchedules(schedulesBySaleId.get(row.id) || []),
      )
    ));

    return res.json({
      total,
      page: pagination?.page || 1,
      limit: pagination?.limit || total || 50,
      sales
    });
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

    await db.withTransaction(async (txDb: typeof db) => {
      await txDb.run(
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

      await insertSaleItemsAndAdjustStock(txDb, id, data.items, now);
      await insertInstallmentSchedules(txDb, id, data, remaining);

      await txDb.run(
        `UPDATE customers
         SET balance = balance + ?,
             updated_at = ?
         WHERE id = ?`,
        remaining,
        now,
        data.customerId,
      );
    });

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

router.delete('/:id', requirePermission('sales:write'), requireAdmin, async (req: AuthedRequest, res) => {
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

const deferInstallmentSchema = z.object({
  installmentId: z.string().optional(),
  installment_id: z.string().optional(),
  id: z.string().optional(),
  saleId: z.string().optional(),
  invoiceId: z.string().optional(),
  sale_id: z.string().optional(),
  invoice_id: z.string().optional(),
  newDueDate: z.string().optional(),
  new_due_date: z.string().optional(),
  dueDate: z.string().optional(),
  date: z.string().optional(),
  strategy: z.enum(['shift_subsequent', 'merge_next']).optional(),
  postponeType: z.enum(['shift_subsequent', 'merge_next']).optional(),
  penaltyFee: z.union([z.number(), z.string(), z.null()]).optional().transform((val) => {
    if (val === null || val === undefined || val === '') return 0;
    const n = Number(val);
    return isNaN(n) || n < 0 ? 0 : n;
  }),
  fineCollectionType: z.enum(['add_to_debt', 'collect_cash']).optional(),
  penaltyPaymentType: z.enum(['add_to_debt', 'collect_cash']).optional(),
});

const handleDeferOrPostpone = async (req: AuthedRequest, res: any) => {
  const parsed = deferInstallmentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'بيانات غير صالحة', errors: parsed.error.format() });
  }

  const data = parsed.data;
  const rawDate = data.newDueDate || data.new_due_date || data.dueDate || data.date;
  if (!rawDate) {
    return res.status(400).json({ message: 'يرجى تحديد تاريخ الاستحقاق الجديد' });
  }

  let newDueDateIso = '';
  try {
    const parsedIso = parseDateInput(rawDate);
    newDueDateIso = parsedIso.includes('T') ? parsedIso.split('T')[0] : parsedIso;
  } catch (e) {
    return res.status(400).json({ message: e instanceof Error ? e.message : 'صيغة تاريخ غير صالحة' });
  }

  const installmentId = data.installmentId || data.installment_id || data.id;
  if (!installmentId) {
    return res.status(400).json({ message: 'يرجى تحديد القسط المراد ترحيله' });
  }

  const db = await dbPromise;
  let saleId = req.params.id || data.saleId || data.invoiceId || data.sale_id || data.invoice_id;

  if (!saleId) {
    const schLookup = await db.get<{ sale_id: string }>('SELECT sale_id FROM installment_schedules WHERE id = ?', installmentId);
    if (schLookup) {
      saleId = schLookup.sale_id;
    }
  }

  if (!saleId) {
    return res.status(400).json({ message: 'تعذر تحديد رقم العقد أو الفاتورة المرتبطة بالقسط' });
  }

  const strategy = data.strategy || data.postponeType || 'shift_subsequent';
  const penaltyPaymentType = data.penaltyPaymentType || data.fineCollectionType || 'add_to_debt';
  const penalty = roundMoney(data.penaltyFee || 0);
  const now = new Date().toISOString();

  try {
    const sale = await db.get<SaleRow>('SELECT * FROM sales WHERE id = ?', saleId);
    if (!sale) {
      return res.status(404).json({ message: 'لم يتم العثور على عقد البيع' });
    }

    const schedules = await db.all<ScheduleRow>(
      'SELECT * FROM installment_schedules WHERE sale_id = ? ORDER BY month_index ASC',
      saleId,
    );

    const targetIndex = schedules.findIndex((s) => s.id === installmentId);
    if (targetIndex === -1) {
      return res.status(404).json({ message: 'لم يتم العثور على القسط المحدد' });
    }

    const target = schedules[targetIndex];
    if (target.status === 'paid' || target.status === 'settled_early') {
      return res.status(400).json({ message: 'لا يمكن ترحيل قسط مسدد بالفعل أو مسوى' });
    }

    await db.withTransaction(async (tx: typeof db) => {
      if (strategy === 'shift_subsequent') {
        const targetNewAmount = penaltyPaymentType === 'add_to_debt' && penalty > 0
          ? roundMoney(target.amount + penalty)
          : target.amount;

        await tx.run(
          'UPDATE installment_schedules SET due_date = ?, amount = ?, deferred = 1, deferred_at = ?, notes = ? WHERE id = ?',
          newDueDateIso,
          targetNewAmount,
          now,
          'تم ترحيل القسط وتعديل تاريخ الاستحقاق',
          target.id,
        );

        // Shift subsequent unpaid installments forward by 1 month using robust calendar math
        for (let i = targetIndex + 1; i < schedules.length; i++) {
          const sch = schedules[i];
          if (sch.status !== 'paid' && sch.status !== 'settled_early') {
            const shiftedDate = addMonths(sch.due_date, 1);
            await tx.run(
              'UPDATE installment_schedules SET due_date = ? WHERE id = ?',
              shiftedDate,
              sch.id,
            );
          }
        }
      } else if (strategy === 'merge_next') {
        const nextIndex = schedules.findIndex(
          (s, idx) => idx > targetIndex && s.status !== 'paid' && s.status !== 'settled_early',
        );
        if (nextIndex === -1) {
          throw new Error('لا يوجد قسط قادم لدمج هذا القسط معه. يرجى استخدام استراتيجية إزاحة الأقساط شهراً للأمام.');
        }

        const nextSch = schedules[nextIndex];
        const unpaidTargetAmount = roundMoney(target.amount - target.paid_amount);
        const extraFromPenalty = penaltyPaymentType === 'add_to_debt' && penalty > 0 ? penalty : 0;
        const nextNewAmount = roundMoney(nextSch.amount + unpaidTargetAmount + extraFromPenalty);

        // 1. Update next installment with combined amount and deferred flag
        await tx.run(
          'UPDATE installment_schedules SET amount = ?, deferred = 1, deferred_at = ?, notes = ? WHERE id = ?',
          nextNewAmount,
          now,
          `مدمج مع القسط ${target.month_index}`,
          nextSch.id,
        );

        // 2. Update deferred target installment: keep its place in schedule, set amount to paid_amount, mark deferred and settled
        await tx.run(
          `UPDATE installment_schedules 
           SET amount = paid_amount, 
               status = CASE WHEN paid_amount > 0 THEN 'paid' ELSE 'settled_early' END, 
               deferred = 1, 
               deferred_at = ?,
               notes = ?
           WHERE id = ?`,
          now,
          `تم ترحيله ودمجه مع القسط ${nextSch.month_index}`,
          target.id,
        );
      }

      if (penalty > 0) {
        if (penaltyPaymentType === 'add_to_debt') {
          await tx.run(
            `UPDATE sales
             SET total = total + ?,
                 remaining = remaining + ?,
                 last_edited_by = ?,
                 last_edited_at = ?
             WHERE id = ?`,
            penalty,
            penalty,
            req.user?.name || 'system',
            now,
            saleId,
          );

          await tx.run(
            `UPDATE customers
             SET balance = balance + ?,
                 updated_at = ?
             WHERE id = ?`,
            penalty,
            now,
            sale.customer_id,
          );
        } else if (penaltyPaymentType === 'collect_cash') {
          const receiptRow = await tx.get<{ receipt_number: string }>(
            `SELECT TOP 1 receipt_number
             FROM payments
             WHERE receipt_number LIKE 'RCPT-%'
               AND TRY_CONVERT(INT, SUBSTRING(receipt_number, 6, 32)) IS NOT NULL
             ORDER BY TRY_CONVERT(INT, SUBSTRING(receipt_number, 6, 32)) DESC`,
          );
          const maxNum = receiptRow ? parseInt(receiptRow.receipt_number.replace('RCPT-', ''), 10) : 5000;
          const penaltyReceipt = `RCPT-${maxNum + 1}`;
          const penaltyPaymentId = uid();

          await tx.run(
            `INSERT INTO payments (
              id, type, amount, sale_id, installment_id, description, date, receipt_number, status, channel,
              reference_id, reference_type, customer_id, supplier_id, invoice_number, affects_customer_balance,
              created_by, created_at
            ) VALUES (?, 'in', ?, ?, ?, ?, ?, ?, 'posted', 'cash', ?, 'sale', ?, NULL, ?, 0, ?, ?)`,
            penaltyPaymentId,
            penalty,
            saleId,
            target.id,
            `تحصيل غرامة تأخير/ترحيل القسط ${target.month_index} - العقد ${sale.invoice_number}`,
            newDueDateIso,
            penaltyReceipt,
            saleId,
            sale.customer_id,
            sale.invoice_number,
            req.user?.name || 'system',
            now,
          );
        }
      }
    });

    await audit('sale.defer_installment', 'sale', saleId, req.user?.name || 'system', {
      saleId,
      invoiceNumber: sale.invoice_number,
      installmentId: target.id,
      strategy,
      newDueDate: newDueDateIso,
      penaltyFee: penalty,
      penaltyPaymentType,
    });

    await createSystemNotification(
      'info',
      'ترحيل قسط تعاقد',
      `تم ترحيل القسط ${target.month_index} للعقد ${sale.invoice_number} للعميل ${sale.customer_name}${penalty > 0 ? ` مع غرامة ترحيل ${penalty} جنيه` : ''}`,
    );

    const updatedSchedules = await db.all<ScheduleRow>(
      'SELECT * FROM installment_schedules WHERE sale_id = ? ORDER BY month_index ASC',
      saleId,
    );
    const updatedSaleRow = await db.get<SaleRow>('SELECT * FROM sales WHERE id = ?', saleId);

    return res.status(200).json({
      message: 'تم ترحيل القسط بنجاح',
      schedules: mapSchedules(updatedSchedules),
      sale: updatedSaleRow ? mapSale(updatedSaleRow, [], mapSchedules(updatedSchedules)) : null,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
};

// Route aliases: accept POST and PUT on all defer and postpone endpoints (Admin only)
router.post('/:id/defer-installment', requirePermission('sales:write'), requireAdmin, handleDeferOrPostpone);
router.put('/:id/defer-installment', requirePermission('sales:write'), requireAdmin, handleDeferOrPostpone);
router.post('/:id/postpone', requirePermission('sales:write'), requireAdmin, handleDeferOrPostpone);
router.put('/:id/postpone', requirePermission('sales:write'), requireAdmin, handleDeferOrPostpone);
router.post('/defer-installment', requirePermission('sales:write'), requireAdmin, handleDeferOrPostpone);
router.put('/defer-installment', requirePermission('sales:write'), requireAdmin, handleDeferOrPostpone);
router.post('/postpone', requirePermission('sales:write'), requireAdmin, handleDeferOrPostpone);
router.put('/postpone', requirePermission('sales:write'), requireAdmin, handleDeferOrPostpone);
router.post('/:id/installments/postpone', requirePermission('sales:write'), requireAdmin, handleDeferOrPostpone);
router.put('/:id/installments/postpone', requirePermission('sales:write'), requireAdmin, handleDeferOrPostpone);
router.post('/installments/postpone', requirePermission('sales:write'), requireAdmin, handleDeferOrPostpone);
router.put('/installments/postpone', requirePermission('sales:write'), requireAdmin, handleDeferOrPostpone);

export default router;


