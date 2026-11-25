import { Router } from 'express';
import { z } from 'zod';
import { dbPromise } from '../db.js';
import { requireAdmin, requireAnyPermission, requireAuth, requirePermission, type AuthedRequest } from '../middleware/auth.js';
import { audit } from '../audit.js';
import { uid, formatDate, parseDateInput, isPeriodClosed } from '../utils.js';
import { createSystemNotification } from '../financialNotifications.js';
import { getCollectionDues } from './dues.js';

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
    fulfillmentType: item.fulfillmentType ?? item.fulfillment_type ?? (item.sourceType === 'warehouse' ? 'stocked' : item.sourceType),
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
  fulfillmentType: z.string().optional().nullable(),
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
  guarantors: z.array(
    z.object({
      name: z.string().optional().default(''),
      phone: z.string().optional().default(''),
      nationalId: z.string().optional().default(''),
      address: z.string().optional().default(''),
      relationship: z.string().optional().default(''),
    }).nullable()
  ).max(3).optional(),
  replaceAutoPurchases: z.boolean().optional(),
}));

type SaleInput = z.infer<typeof saleSchema>;

const roundMoney = (value: number) => Number(Number(value || 0).toFixed(2));

type LinkedPurchaseRow = { id: string; supplier_id: string; remaining: number; paid: number };

async function getLinkedAutoPurchases(db: any, invoiceNumber: string): Promise<LinkedPurchaseRow[]> {
  const autoPurchasePrefix = `شراء تلقائي مرتبط بالفاتورة ${invoiceNumber}`;
  return db.all(
    `SELECT id, supplier_id, remaining, paid
     FROM purchases
     WHERE notes = ? OR notes LIKE ?`,
    autoPurchasePrefix,
    `${autoPurchasePrefix} %`,
  );
}

async function undoLinkedAutoPurchases(txDb: any, linkedPurchases: LinkedPurchaseRow[], now: string): Promise<string[]> {
  const linkedPurchaseIds = linkedPurchases.map((p) => p.id);
  if (!linkedPurchaseIds.length) return [];

  const placeholders = linkedPurchaseIds.map(() => '?').join(',');
  const linkedPurchaseItems = (await txDb.all(
    `SELECT purchase_id, product_id, quantity
     FROM purchase_items
     WHERE purchase_id IN (${placeholders})`,
    ...linkedPurchaseIds,
  )) as { purchase_id: string; product_id: string; quantity: number }[];

  for (const item of linkedPurchaseItems) {
    await txDb.run(
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
    await txDb.run(
      `UPDATE suppliers
       SET balance = ROUND(balance - ?, 2),
           updated_at = ?
       WHERE id = ?`,
      purchase.remaining,
      now,
      purchase.supplier_id,
    );
  }

  await txDb.run(
    `DELETE FROM purchase_items WHERE purchase_id IN (${placeholders})`,
    ...linkedPurchaseIds,
  );
  await txDb.run(
    `DELETE FROM payments
     WHERE reference_type IN ('purchase', 'purchase_downpayment')
       AND reference_id IN (${placeholders})`,
    ...linkedPurchaseIds,
  );
  await txDb.run(
    `DELETE FROM purchases WHERE id IN (${placeholders})`,
    ...linkedPurchaseIds,
  );

  return linkedPurchaseIds;
}

async function nextReceiptNumber(txDb: any): Promise<string> {
  const receiptRow = await txDb.get(
    `SELECT TOP 1 receipt_number
     FROM payments WITH (UPDLOCK, HOLDLOCK)
     WHERE receipt_number LIKE 'RCPT-%'
       AND TRY_CONVERT(INT, SUBSTRING(receipt_number, 6, 32)) IS NOT NULL
     ORDER BY TRY_CONVERT(INT, SUBSTRING(receipt_number, 6, 32)) DESC`,
  );
  const maxNum = receiptRow ? parseInt(String(receiptRow.receipt_number).replace('RCPT-', ''), 10) : 5000;
  return `RCPT-${(Number.isFinite(maxNum) ? maxNum : 5000) + 1}`;
}

function validateSaleTotals(data: SaleInput): string | null {
  const round = (v: number) => Number(Number(v || 0).toFixed(2));
  const isInstallment = data.financing?.paymentMethod === 'installment';

  const preTaxTotal = round(
    data.items.reduce((sum, item) => {
      const itemSubtotal = round(item.quantity * item.unitPrice);
      const discountAmt = round((itemSubtotal * item.discount) / 100);
      return sum + (itemSubtotal - discountAmt);
    }, 0),
  );

  // In installment contracts, interest (tax %) applies only to the financed principal after deducting the down payment.
  const upfrontAgainstItems = isInstallment
    ? Math.min(Math.max(round(data.paid || 0), 0), Math.max(preTaxTotal, 0))
    : 0;

  let totalTax = 0;

  // Recalculate each item total dynamically or check tolerance (< 0.05)
  for (const item of data.items) {
    const itemSubtotal = round(item.quantity * item.unitPrice);
    const discountAmt = round((itemSubtotal * item.discount) / 100);
    const amountBeforeTax = round(itemSubtotal - discountAmt);
    const paidShare = preTaxTotal > 0 ? (amountBeforeTax / preTaxTotal) * upfrontAgainstItems : 0;
    const taxable = Math.max(amountBeforeTax - paidShare, 0);
    const taxAmt = round((taxable * item.tax) / 100);
    const expected = round(amountBeforeTax + taxAmt);
    totalTax = round(totalTax + taxAmt);

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
  const tax = totalTax;
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
  fulfillment_type?: string | null;
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
    fulfillmentType: item.fulfillment_type || undefined,
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

type SaleGuarantorRow = {
  id: string;
  sale_id: string;
  slot: number;
  name: string;
  phone?: string | null;
  national_id?: string | null;
  address?: string | null;
  relationship?: string | null;
  status: string;
  replaced_at?: string | null;
  replaced_by?: string | null;
  replace_reason?: string | null;
  remaining_at_replace?: number | null;
  created_at: string;
  updated_at: string;
};

function mapSaleGuarantors(rows: SaleGuarantorRow[]) {
  const guarantors: [any, any, any] = [null, null, null];
  const guarantorRecords = rows.map((r) => ({
    id: r.id,
    saleId: r.sale_id,
    slot: (Number(r.slot) === 2 ? 2 : Number(r.slot) === 3 ? 3 : 1) as 1 | 2 | 3,
    name: r.name || '',
    phone: r.phone || '',
    nationalId: r.national_id || '',
    address: r.address || '',
    relationship: r.relationship || '',
    status: (r.status === 'replaced' ? 'replaced' : 'active') as 'active' | 'replaced',
    replacedAt: r.replaced_at || null,
    replacedBy: r.replaced_by || null,
    replaceReason: r.replace_reason || null,
    remainingAtReplace: r.remaining_at_replace !== null && r.remaining_at_replace !== undefined ? Number(r.remaining_at_replace) : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));

  let historyCount = 0;
  for (const rec of guarantorRecords) {
    if (rec.status === 'replaced') {
      historyCount++;
    } else {
      const idx = rec.slot - 1;
      if (idx >= 0 && idx < 3 && !guarantors[idx]) {
        guarantors[idx] = {
          name: rec.name,
          phone: rec.phone,
          nationalId: rec.nationalId,
          address: rec.address,
          relationship: rec.relationship,
        };
      }
    }
  }

  return { guarantors, guarantorRecords, guarantorHistoryCount: historyCount };
}

async function insertSaleGuarantors(
  txDb: Awaited<typeof dbPromise>,
  saleId: string,
  guarantors: SaleInput['guarantors'],
  now: string,
) {
  if (!Array.isArray(guarantors) || guarantors.length === 0) return;
  for (let i = 0; i < Math.min(guarantors.length, 3); i++) {
    const g = guarantors[i];
    if (!g) continue;
    const name = String(g.name || '').trim();
    const phone = String(g.phone || '').trim();
    const nationalId = String(g.nationalId || '').trim();
    const address = String(g.address || '').trim();
    const relationship = String(g.relationship || '').trim();
    if (!name && !phone && !nationalId) continue;

    await txDb.run(
      `INSERT INTO sale_guarantors (
        id, sale_id, slot, name, phone, national_id, address, relationship, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      uid(),
      saleId,
      i + 1,
      name || 'ضامن',
      phone,
      nationalId,
      address,
      relationship,
      now,
      now,
    );
  }
}

function mapSale(
  row: SaleRow,
  items: ReturnType<typeof mapSaleItems> = [],
  schedules: ReturnType<typeof mapSchedules> = [],
  guarantorRows: SaleGuarantorRow[] = [],
) {
  const { guarantors, guarantorRecords, guarantorHistoryCount } = mapSaleGuarantors(guarantorRows);
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
    guarantors,
    guarantorRecords,
    guarantorHistoryCount,
    financing: {
      paymentMethod: row.payment_method || (row.installment_months && row.installment_months > 1 ? 'installment' : 'cash'),
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
  const productIds = Array.from(new Set(items.map((item) => item.productId)));
  const productInfoById = new Map<string, { purchase_price: number; fulfillment_type: string }>();

  if (productIds.length) {
    const rows = await db.all<{ id: string; purchase_price: number; fulfillment_type: string }>(
      `SELECT id, purchase_price, fulfillment_type FROM products WHERE id IN (${productIds.map(() => '?').join(',')})`,
      ...productIds,
    );
    rows.forEach((row) => productInfoById.set(row.id, {
      purchase_price: Number(row.purchase_price || 0),
      fulfillment_type: row.fulfillment_type || 'on_demand',
    }));
  }

  for (const item of items) {
    const prodInfo = productInfoById.get(item.productId);
    const cost = item.unitCost || prodInfo?.purchase_price || 0;
    const fulfillmentType = item.fulfillmentType || prodInfo?.fulfillment_type || (item.unitPrice > cost && cost > 0 ? 'stocked' : 'on_demand');

    await db.run(
      `INSERT INTO sale_items (
        id, sale_id, product_id, product_name, barcode, quantity, unit_price, unit_cost, discount, tax, total, fulfillment_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      uid(),
      saleId,
      item.productId,
      item.productName,
      item.barcode || null,
      item.quantity,
      item.unitPrice,
      cost,
      item.discount,
      item.tax,
      item.total,
      fulfillmentType,
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
  const totalPiastres = Math.round(Number(remaining || 0) * 100);
  const basePiastres = Math.floor(totalPiastres / months);
  let remainingPiastres = totalPiastres;

  for (let index = 0; index < months; index++) {
    const installmentPiastres = index === months - 1 ? remainingPiastres : basePiastres;
    remainingPiastres -= installmentPiastres;
    const amount = Number((installmentPiastres / 100).toFixed(2));

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

  const [items, schedules, guarantors] = await Promise.all([
    db.all<SaleItemRow>('SELECT * FROM sale_items WHERE sale_id = ?', id),
    db.all<ScheduleRow>('SELECT * FROM installment_schedules WHERE sale_id = ? ORDER BY month_index ASC', id),
    db.all<SaleGuarantorRow>('SELECT * FROM sale_guarantors WHERE sale_id = ? ORDER BY status ASC, slot ASC, created_at DESC', id),
  ]);

  return mapSale(row, mapSaleItems(items), mapSchedules(schedules), guarantors);
}

router.get('/', requireAnyPermission('sales:read', 'payments:read', 'reports:read'), async (req, res) => {
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

    const countSelect = pagination ? ', COUNT(*) OVER() AS total_count_metadata' : '';
    const query = `
      SELECT s.*${countSelect}
      FROM sales s
      ${where}
      ORDER BY COALESCE(TRY_CONVERT(datetime2, s.created_at), TRY_CONVERT(datetime2, s.date), TRY_CONVERT(datetime2, '1900-01-01')) DESC, s.id DESC
    `;

    const rows = await db.all<SaleRow & { total_count_metadata?: number }>(
      query,
      args,
      pagination
    );

    const total = pagination ? (rows.length > 0 ? (rows[0].total_count_metadata || 0) : 0) : rows.length;
    const saleIds = rows.map((row) => row.id);
    const schedulesBySaleId = new Map<string, ScheduleRow[]>();
    const itemsBySaleId = new Map<string, SaleItemRow[]>();
    const guarantorsBySaleId = new Map<string, SaleGuarantorRow[]>();

    if (saleIds.length) {
      // Chunk IDs in batches of 500 to stay safely below SQL Server's 2,100-parameter limit
      const chunkSize = 500;
      for (let i = 0; i < saleIds.length; i += chunkSize) {
        const chunk = saleIds.slice(i, i + chunkSize);
        const placeholders = chunk.map(() => '?').join(',');
        const [scheduleRows, guarantorRows] = await Promise.all([
          db.all<ScheduleRow & { sale_id: string }>(
            `SELECT * FROM installment_schedules WHERE sale_id IN (${placeholders}) ORDER BY sale_id ASC, month_index ASC`,
            ...chunk,
          ),
          db.all<SaleGuarantorRow>(
            `SELECT * FROM sale_guarantors WHERE sale_id IN (${placeholders}) ORDER BY sale_id ASC, status ASC, slot ASC, created_at DESC`,
            ...chunk,
          ),
        ]);
        scheduleRows.forEach((schedule) => {
          const saleSchedules = schedulesBySaleId.get(schedule.sale_id) || [];
          saleSchedules.push(schedule);
          schedulesBySaleId.set(schedule.sale_id, saleSchedules);
        });
        guarantorRows.forEach((g) => {
          const list = guarantorsBySaleId.get(g.sale_id) || [];
          list.push(g);
          guarantorsBySaleId.set(g.sale_id, list);
        });

        if (includeItems) {
          const itemRows = await db.all<SaleItemRow & { sale_id: string }>(
            `SELECT * FROM sale_items WHERE sale_id IN (${placeholders})`,
            ...chunk,
          );
          itemRows.forEach((item) => {
            const saleItems = itemsBySaleId.get(item.sale_id) || [];
            saleItems.push(item);
            itemsBySaleId.set(item.sale_id, saleItems);
          });
        }
      }
    }

    const sales = rows.map((row) => (
      mapSale(
        row,
        mapSaleItems(itemsBySaleId.get(row.id) || []),
        mapSchedules(schedulesBySaleId.get(row.id) || []),
        guarantorsBySaleId.get(row.id) || [],
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

router.get('/collection-due', requireAnyPermission('sales:read', 'payments:read'), async (req, res) => {
  try {
    const data = await getCollectionDues({
      from: typeof req.query.from === 'string' ? req.query.from : undefined,
      to: typeof req.query.to === 'string' ? req.query.to : undefined,
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      salesRepId: typeof req.query.salesRepId === 'string' ? req.query.salesRepId : undefined,
      hideSued: String(req.query.hideSued) === 'true',
      includeOverdue: String(req.query.includeOverdue) === 'true',
      strictDate: String(req.query.strictDate) === 'true',
      statusFilter: typeof req.query.statusFilter === 'string' ? (req.query.statusFilter as any) : undefined,
      dateBasis: typeof req.query.dateBasis === 'string' ? (req.query.dateBasis as any) : undefined,
    });
    return res.json(data);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});
async function generateNextSaleInvoiceNumber(db: any): Promise<string> {
  const settings = await db.get('SELECT TOP 1 invoice_prefix FROM settings');
  const prefix = settings?.invoice_prefix || 'PB';

  const rows = (await db.all(
    `SELECT TOP 100 invoice_number FROM sales WITH (UPDLOCK, HOLDLOCK) WHERE invoice_number LIKE ? ORDER BY created_at DESC`,
    `${prefix}-%`
  )) as { invoice_number: string }[];
  let maxNum = 1000;
  for (const row of rows) {
    const parts = (row.invoice_number || '').split('-');
    const lastPart = parts[parts.length - 1];
    const n = parseInt(lastPart, 10);
    if (!isNaN(n) && n > maxNum) {
      maxNum = n;
    }
  }
  return `${prefix}-${maxNum + 1}`;
}

router.get('/next-invoice-number', requirePermission('sales:read'), async (_req, res) => {
  try {
    const db = await dbPromise;
    const invoiceNumber = await generateNextSaleInvoiceNumber(db);
    return res.json({ invoiceNumber });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

router.get('/check-person-risk', requireAnyPermission('sales:read', 'sales:write', 'payments:read', 'reports:read'), async (req, res) => {
  try {
    const db = await dbPromise;
    const nationalId = String(req.query.nationalId || '').replace(/\D/g, '').trim();
    const phone = String(req.query.phone || '').replace(/\D/g, '').trim();
    const excludeCustomerId = String(req.query.excludeCustomerId || '').trim();
    const excludeSaleId = String(req.query.excludeSaleId || '').trim();

    const hasNat = nationalId.length >= 6;
    const hasPhone = phone.length >= 8;
    if (!hasNat && !hasPhone) {
      return res.json({
        existingCustomers: [],
        activeGuarantees: [],
        totalGuaranteedRemaining: 0,
        hasSuedOrOverdue: false,
      });
    }

    const custWhere: string[] = [];
    const custArgs: any[] = [];
    if (hasNat) {
      custWhere.push('national_id = ?');
      custArgs.push(nationalId);
    }
    if (hasPhone) {
      custWhere.push('phone = ?');
      custArgs.push(phone);
    }
    let custQuery = `SELECT id, customer_number, name, phone, national_id, balance, is_sued FROM customers WHERE (${custWhere.join(' OR ')})`;
    if (excludeCustomerId) {
      custQuery += ' AND id <> ?';
      custArgs.push(excludeCustomerId);
    }

    const guarWhere: string[] = [];
    const guarArgs: any[] = [];
    const todayIso = new Date().toISOString().slice(0, 10);
    guarArgs.push(todayIso);
    if (hasNat) {
      guarWhere.push('sg.national_id = ?');
      guarArgs.push(nationalId);
    }
    if (hasPhone) {
      guarWhere.push('sg.phone = ?');
      guarArgs.push(phone);
    }
    let guarQuery = `
      SELECT
        sg.sale_id,
        sg.slot,
        sg.name AS guarantor_name,
        s.invoice_number,
        s.customer_id,
        s.customer_name,
        s.remaining,
        s.status,
        c.is_sued,
        (SELECT COUNT(*) FROM installment_schedules isch WHERE isch.sale_id = s.id AND isch.status <> 'paid' AND isch.status <> 'settled_early' AND isch.due_date < ?) AS overdue_count
      FROM sale_guarantors sg
      INNER JOIN sales s ON s.id = sg.sale_id
      LEFT JOIN customers c ON c.id = s.customer_id
      WHERE sg.status = 'active'
        AND s.status NOT IN ('cancelled', 'completed', 'settled_early')
        AND s.remaining > 0
        AND (${guarWhere.join(' OR ')})
    `;
    if (excludeSaleId) {
      guarQuery += ' AND sg.sale_id <> ?';
      guarArgs.push(excludeSaleId);
    }

    const [customerRows, guaranteeRows] = await Promise.all([
      db.all<any>(custQuery, ...custArgs),
      db.all<any>(guarQuery, ...guarArgs),
    ]);

    const existingCustomers = customerRows.map((c) => ({
      id: c.id,
      customerNumber: c.customer_number || '',
      name: c.name || '',
      phone: c.phone || '',
      nationalId: c.national_id || '',
      balance: Number(c.balance || 0),
      isSued: c.is_sued === 1 || c.is_sued === true,
    }));

    const activeGuarantees = guaranteeRows.map((g) => ({
      saleId: g.sale_id,
      slot: Number(g.slot || 1),
      guarantorName: g.guarantor_name || '',
      invoiceNumber: g.invoice_number || '',
      customerId: g.customer_id || '',
      customerName: g.customer_name || '',
      remaining: Number(g.remaining || 0),
      isSued: g.is_sued === 1 || g.is_sued === true,
      overdueCount: Number(g.overdue_count || 0),
    }));

    const totalGuaranteedRemaining = roundMoney(
      activeGuarantees.reduce((sum, g) => sum + g.remaining, 0),
    );
    const hasSuedOrOverdue =
      existingCustomers.some((c) => c.isSued) ||
      activeGuarantees.some((g) => g.isSued || g.overdueCount > 0);

    return res.json({
      existingCustomers,
      activeGuarantees,
      totalGuaranteedRemaining,
      hasSuedOrOverdue,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

router.post('/:id/transfer', requirePermission('sales:transfer'), async (req: AuthedRequest, res) => {
  const transferSchema = z.object({
    newCustomerId: z.string().min(1, 'يرجى اختيار العميل الجديد'),
    transferDate: z.string().optional(),
    installmentMonths: z.number().int().min(1).max(120).optional(),
    installmentStartDate: z.string().optional(),
    reason: z.string().optional().default(''),
    guarantors: z.array(
      z.object({
        name: z.string().optional().default(''),
        phone: z.string().optional().default(''),
        nationalId: z.string().optional().default(''),
        address: z.string().optional().default(''),
        relationship: z.string().optional().default(''),
      }).nullable(),
    ).max(3).optional(),
  });

  const parsed = transferSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'بيانات التنازل غير مكتملة', errors: parsed.error.format() });
  }

  const { newCustomerId, reason, guarantors } = parsed.data;
  const now = new Date().toISOString();
  const actor = req.user?.name || 'system';
  let transferDateIso = now.slice(0, 10);
  try {
    if (parsed.data.transferDate) {
      transferDateIso = parseDateInput(parsed.data.transferDate);
    }
  } catch {
    return res.status(400).json({ message: 'صيغة تاريخ التنازل غير صحيحة' });
  }

  try {
    const db = await dbPromise;
    if (req.user?.role !== 'admin' && await isPeriodClosed(db, transferDateIso)) {
      return res.status(403).json({ message: 'الفترة المالية مغلقة ولا يمكن تنفيذ التنازل فيها إلا بواسطة المدير.' });
    }

    const newCustomer = await db.get<{ id: string; name: string }>('SELECT id, name FROM customers WHERE id = ?', newCustomerId);
    if (!newCustomer) {
      return res.status(404).json({ message: 'العميل الجديد غير موجود' });
    }

    let createdSaleId = '';
    let createdInvoiceNumber = '';
    let oldInvoiceNumber = '';
    let oldCustomerName = '';
    let transferredAmount = 0;

    await db.withTransaction(async (txDb: typeof db) => {
      const oldSale = await txDb.get<SaleRow>(
        'SELECT * FROM sales WITH (UPDLOCK, ROWLOCK) WHERE id = ?',
        req.params.id,
      );
      if (!oldSale) {
        throw Object.assign(new Error('الفاتورة الأصلية غير موجودة'), { statusCode: 404 });
      }
      if (oldSale.status === 'cancelled' || oldSale.status === 'completed' || oldSale.status === 'settled_early') {
        throw Object.assign(new Error('لا يمكن التنازل عن عقد مغلق أو ملغى أو مكتمل السداد'), { statusCode: 400 });
      }
      const oldTotal = roundMoney(Number(oldSale.total || 0));
      const oldPaid = roundMoney(Number(oldSale.paid || 0));
      const remaining = roundMoney(Number(oldSale.remaining || 0));
      if (remaining <= 0.01) {
        throw Object.assign(new Error('لا يوجد مبلغ متبقٍ على هذا العقد للتنازل عنه'), { statusCode: 400 });
      }
      if (oldSale.customer_id === newCustomer.id) {
        throw Object.assign(new Error('العميل الجديد يجب أن يكون مختلفاً عن العميل الحالي'), { statusCode: 400 });
      }

      oldInvoiceNumber = oldSale.invoice_number;
      oldCustomerName = oldSale.customer_name;
      transferredAmount = remaining;

      const [oldItems, oldSchedules] = await Promise.all([
        txDb.all<SaleItemRow & { id: string }>('SELECT * FROM sale_items WHERE sale_id = ?', oldSale.id),
        txDb.all<ScheduleRow>('SELECT * FROM installment_schedules WHERE sale_id = ? ORDER BY month_index ASC', oldSale.id),
      ]);

      const unpaidSchedules = oldSchedules.filter((s) => s.status !== 'paid' && s.status !== 'settled_early');
      const months = parsed.data.installmentMonths || Math.max(1, unpaidSchedules.length || 1);
      let startDate = unpaidSchedules[0]?.due_date || addMonths(transferDateIso, 1);
      if (parsed.data.installmentStartDate) {
        startDate = parseDateInput(parsed.data.installmentStartDate);
      }

      createdSaleId = uid();
      createdInvoiceNumber = await generateNextSaleInvoiceNumber(txDb);

      const transferReasonText = reason.trim() ? ` (${reason.trim()})` : '';
      const oldSaleNoteSuffix = `تم التنازل عن المتبقي (${remaining}) للعميل ${newCustomer.name} بموجب العقد ${createdInvoiceNumber} بتاريخ ${transferDateIso}${transferReasonText}`;
      const newSaleNotes = `عقد منقول بالتنازل من العميل ${oldSale.customer_name} — أصل العقد ${oldSale.invoice_number} بتاريخ ${transferDateIso}${transferReasonText}`;
      const mergedOldNotes = oldSale.notes ? `${oldSale.notes}\n${oldSaleNoteSuffix}` : oldSaleNoteSuffix;

      const monthlyInstallmentAmount = roundMoney(remaining / months);
      const isZeroPaid = oldPaid <= 0.005;
      const paidRatio = isZeroPaid ? 0 : (oldTotal > 0 ? oldPaid / oldTotal : 0);
      const remRatio = isZeroPaid ? 1 : Math.max(0, 1 - paidRatio);

      // 1. Close/settle old contract without double-counting revenue or COGS
      // Note: set total = oldPaid when settled_early on transfer so (total - eff_total) = 0 (not falsely counted as early settlement discount)
      const newOldStatus = isZeroPaid ? 'cancelled' : 'settled_early';
      const newOldTotal = isZeroPaid ? oldTotal : oldPaid;
      await txDb.run(
        `UPDATE sales
         SET status = ?,
             total = ?,
             remaining = 0,
             locked = 1,
             notes = ?,
             last_edited_by = ?,
             last_edited_at = ?,
             version = version + 1
         WHERE id = ?`,
        newOldStatus,
        newOldTotal,
        mergedOldNotes,
        actor,
        now,
        oldSale.id,
      );

      // Close unpaid schedules on old contract (zero remaining so dues/aging never double-count)
      await txDb.run(
        `UPDATE installment_schedules
         SET amount = paid_amount,
             status = 'settled_early',
             notes = COALESCE(notes + ' | ', '') + ?
         WHERE sale_id = ? AND status NOT IN ('paid', 'settled_early')`,
        `تم التنازل للعقد ${createdInvoiceNumber}`,
        oldSale.id,
      );

      // Close any open collection tasks on old contract
      await txDb.run(
        `UPDATE collection_tasks
         SET status = 'completed',
             notes = COALESCE(notes + ' | ', '') + ?
         WHERE sale_id = ? AND status NOT IN ('completed', 'cancelled')`,
        `تم التنازل للعقد ${createdInvoiceNumber}`,
        oldSale.id,
      );

      // 2. Create new contract for the transferee customer (for the exact remaining balance)
      const newSubtotal = isZeroPaid ? roundMoney(Number(oldSale.subtotal || remaining)) : roundMoney(Number(oldSale.subtotal || remaining) * remRatio);
      const newDiscount = isZeroPaid ? roundMoney(Number(oldSale.discount || 0)) : roundMoney(Number(oldSale.discount || 0) * remRatio);
      const newTax = isZeroPaid ? roundMoney(Number(oldSale.tax || 0)) : roundMoney(Number(oldSale.tax || 0) * remRatio);

      await txDb.run(
        `INSERT INTO sales (
          id, invoice_number, customer_id, customer_name, total, paid, remaining, status, date, notes, version, locked,
          last_edited_by, last_edited_at, created_by, created_at, subtotal, discount, tax,
          payment_method, manual_invoice_ref, sales_rep_id, sales_rep_name, commission_rate, commission_amount,
          installment_months, installment_start_date, upfront_amount, monthly_installment_amount
        ) VALUES (?, ?, ?, ?, ?, 0, ?, 'pending', ?, ?, 1, 0, ?, ?, ?, ?, ?, ?, ?, 'installment', ?, ?, ?, NULL, NULL, ?, ?, 0, ?)`,
        createdSaleId,
        createdInvoiceNumber,
        newCustomer.id,
        newCustomer.name,
        remaining,
        remaining,
        transferDateIso,
        newSaleNotes,
        actor,
        now,
        actor,
        now,
        newSubtotal,
        newDiscount,
        newTax,
        oldSale.invoice_number,
        oldSale.sales_rep_id || null,
        oldSale.sales_rep_name || null,
        months,
        startDate,
        monthlyInstallmentAmount,
      );

      // 3. Split sale_items COGS & price proportionally (zero inventory movement, zero COGS duplication!)
      for (const item of oldItems) {
        const origUnitCost = Number(item.unit_cost || 0);
        const origUnitPrice = Number(item.unit_price || 0);
        const origTotal = Number(item.total || 0);
        const origDiscount = Number(item.discount || 0);
        const origTax = Number(item.tax || 0);

        let newUnitCost = origUnitCost;
        let newUnitPrice = origUnitPrice;
        let newItemTotal = origTotal;
        let newItemDiscount = origDiscount;
        let newItemTax = origTax;

        if (!isZeroPaid) {
          const oldUnitCost = roundMoney(origUnitCost * paidRatio);
          const oldUnitPrice = roundMoney(origUnitPrice * paidRatio);
          const oldItemTotal = roundMoney(origTotal * paidRatio);

          newUnitCost = roundMoney(Math.max(0, origUnitCost - oldUnitCost));
          newUnitPrice = roundMoney(Math.max(0, origUnitPrice - oldUnitPrice));
          newItemTotal = roundMoney(Math.max(0, origTotal - oldItemTotal));

          // Keep discount and tax as original percentages (0-100) — do NOT scale percentages!
          await txDb.run(
            `UPDATE sale_items
             SET unit_cost = ?, unit_price = ?, total = ?
             WHERE id = ?`,
            oldUnitCost,
            oldUnitPrice,
            oldItemTotal,
            item.id,
          );
        }

        await txDb.run(
          `INSERT INTO sale_items (
            id, sale_id, product_id, product_name, barcode, quantity, unit_price, unit_cost, discount, tax, total, fulfillment_type
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          uid(),
          createdSaleId,
          item.product_id,
          item.product_name,
          item.barcode || null,
          Number(item.quantity || 1),
          newUnitPrice,
          newUnitCost,
          newItemDiscount,
          newItemTax,
          newItemTotal,
          item.fulfillment_type || 'on_demand',
        );
      }

      // 4. Generate exact installment schedules for the new contract
      const baseAmount = Math.floor((remaining / months) * 100) / 100;
      let allocated = 0;
      for (let i = 0; i < months; i++) {
        const isLast = i === months - 1;
        const amt = isLast ? roundMoney(remaining - allocated) : baseAmount;
        allocated = roundMoney(allocated + amt);
        await txDb.run(
          `INSERT INTO installment_schedules (id, sale_id, month_index, due_date, amount, paid_amount, status)
           VALUES (?, ?, ?, ?, ?, 0, 'unpaid')`,
          uid(),
          createdSaleId,
          i + 1,
          addMonths(startDate, i),
          amt,
        );
      }

      // 5. Save new guarantors (if provided) on the new contract
      await insertSaleGuarantors(txDb, createdSaleId, guarantors, now);

      // 6. Transfer exact balance from old customer to new customer (net customer receivables change = 0)
      await txDb.run(
        'UPDATE customers SET balance = balance - ?, updated_at = ? WHERE id = ?',
        remaining,
        now,
        oldSale.customer_id,
      );
      await txDb.run(
        'UPDATE customers SET balance = balance + ?, updated_at = ? WHERE id = ?',
        remaining,
        now,
        newCustomer.id,
      );
    });

    await audit('sale.transfer', 'sale', createdSaleId, actor, {
      oldSaleId: req.params.id,
      oldInvoiceNumber,
      oldCustomerName,
      newSaleId: createdSaleId,
      newInvoiceNumber: createdInvoiceNumber,
      newCustomerId: newCustomer.id,
      newCustomerName: newCustomer.name,
      transferredAmount,
      reason: reason.trim() || 'تنازل عن عقد تقسيط',
    });

    await createSystemNotification(
      'info',
      `تنازل عن عقد ${oldInvoiceNumber}`,
      `تم نقل المتبقي (${Math.round(transferredAmount)} جنيه) من العميل ${oldCustomerName} إلى العميل ${newCustomer.name} بعقد جديد رقم ${createdInvoiceNumber}`,
    );

    const [updatedOldSale, createdNewSale] = await Promise.all([
      getMappedSale(req.params.id),
      getMappedSale(createdSaleId),
    ]);

    return res.status(201).json({
      oldSale: updatedOldSale,
      newSale: createdNewSale,
    });
  } catch (error: any) {
    const statusCode = error?.statusCode || 500;
    return res.status(statusCode).json({ message: error?.message || 'تعذر تنفيذ التنازل عن العقد' });
  }
});

router.get('/customer/:customerId/latest-guarantors', requireAnyPermission('sales:read', 'sales:write'), async (req, res) => {
  try {
    const db = await dbPromise;
    const customerId = String(req.params.customerId || '').trim();
    if (!customerId) {
      return res.json({ guarantors: [null, null, null], source: 'none' });
    }

    const latestSale = await db.get<{ id: string; invoice_number: string }>(
      `SELECT TOP 1 s.id, s.invoice_number
       FROM sales s
       WHERE s.customer_id = ?
         AND EXISTS (SELECT 1 FROM sale_guarantors sg WHERE sg.sale_id = s.id AND sg.status = 'active')
       ORDER BY COALESCE(TRY_CONVERT(datetime2, s.created_at), TRY_CONVERT(datetime2, s.date), TRY_CONVERT(datetime2, '1900-01-01')) DESC, s.id DESC`,
      customerId,
    );

    if (latestSale) {
      const rows = await db.all<SaleGuarantorRow>(
        "SELECT * FROM sale_guarantors WHERE sale_id = ? AND status = 'active' ORDER BY slot ASC",
        latestSale.id,
      );
      const { guarantors } = mapSaleGuarantors(rows);
      return res.json({ guarantors, source: 'sale', invoiceNumber: latestSale.invoice_number });
    }

    // Fallback to legacy customers.guarantors
    const customer = await db.get<{ guarantors?: string | null }>('SELECT guarantors FROM customers WHERE id = ?', customerId);
    if (customer?.guarantors) {
      try {
        const parsed = JSON.parse(customer.guarantors);
        if (Array.isArray(parsed)) {
          const normalized = [parsed[0] || null, parsed[1] || null, parsed[2] || null];
          if (normalized.some(Boolean)) {
            return res.json({ guarantors: normalized, source: 'customer' });
          }
        }
      } catch {
        // ignore invalid JSON
      }
    }

    return res.json({ guarantors: [null, null, null], source: 'none' });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

router.get('/:id/guarantors', requireAnyPermission('sales:read', 'payments:read', 'reports:read'), async (req, res) => {
  try {
    const db = await dbPromise;
    const rows = await db.all<SaleGuarantorRow>(
      'SELECT * FROM sale_guarantors WHERE sale_id = ? ORDER BY status ASC, slot ASC, created_at DESC',
      req.params.id,
    );
    return res.json(mapSaleGuarantors(rows));
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

router.post('/:id/guarantors/replace', requirePermission('sales:guarantors'), async (req: AuthedRequest, res) => {
  const replaceSchema = z.object({
    slot: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    guarantor: z.object({
      name: z.string().min(1, 'اسم الضامن مطلوب'),
      phone: z.string().optional().default(''),
      nationalId: z.string().optional().default(''),
      address: z.string().optional().default(''),
      relationship: z.string().optional().default(''),
    }),
    reason: z.string().optional().default(''),
  });

  const parsed = replaceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'بيانات الضامن غير مكتملة', errors: parsed.error.format() });
  }

  const { slot, guarantor, reason } = parsed.data;
  const now = new Date().toISOString();
  const actor = req.user?.name || 'system';

  try {
    const db = await dbPromise;
    const sale = await db.get<{ id: string; invoice_number: string; customer_name: string; remaining: number }>(
      'SELECT id, invoice_number, customer_name, remaining FROM sales WHERE id = ?',
      req.params.id,
    );
    if (!sale) {
      return res.status(404).json({ message: 'الفاتورة غير موجودة' });
    }

    let previousGuarantorName = '';
    await db.withTransaction(async (txDb: typeof db) => {
      const prevRow = await txDb.get<{ name: string }>(
        `SELECT name FROM sale_guarantors WHERE sale_id = ? AND slot = ? AND status = 'active'`,
        sale.id,
        slot,
      );
      previousGuarantorName = prevRow?.name || '';

      await txDb.run(
        `UPDATE sale_guarantors
         SET status = 'replaced',
             replaced_at = ?,
             replaced_by = ?,
             replace_reason = ?,
             remaining_at_replace = ?,
             updated_at = ?
         WHERE sale_id = ? AND slot = ? AND status = 'active'`,
        now,
        actor,
        reason.trim() || 'استبدال ضامن',
        Number(sale.remaining || 0),
        now,
        sale.id,
        slot,
      );

      await txDb.run(
        `INSERT INTO sale_guarantors (
          id, sale_id, slot, name, phone, national_id, address, relationship, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
        uid(),
        sale.id,
        slot,
        guarantor.name.trim(),
        guarantor.phone.trim(),
        guarantor.nationalId.trim(),
        guarantor.address.trim(),
        guarantor.relationship.trim(),
        now,
        now,
      );
    });

    await audit('sale.guarantor_replace', 'sale', sale.id, actor, {
      invoiceNumber: sale.invoice_number,
      customerName: sale.customer_name,
      slot,
      previousGuarantor: previousGuarantorName || null,
      newGuarantor: guarantor.name.trim(),
      reason: reason.trim() || 'استبدال ضامن',
      remainingAtReplace: Number(sale.remaining || 0),
    });

    await createSystemNotification(
      'info',
      previousGuarantorName
        ? `استبدال ضامن للعقد ${sale.invoice_number}`
        : `إضافة ضامن للعقد ${sale.invoice_number}`,
      previousGuarantorName
        ? `تم استبدال الضامن #${slot} (${previousGuarantorName}) بالضامن الجديد (${guarantor.name.trim()}) للعميل ${sale.customer_name} — المتبقي وقت الاستبدال ${Math.round(Number(sale.remaining || 0))} جنيه${reason.trim() ? ` (${reason.trim()})` : ''}`
        : `تم إضافة الضامن #${slot} (${guarantor.name.trim()}) على عقد العميل ${sale.customer_name} — المتبقي ${Math.round(Number(sale.remaining || 0))} جنيه`,
    );

    const updated = await getMappedSale(sale.id);
    return res.json(updated);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

router.get('/:id', requireAnyPermission('sales:read', 'payments:read', 'reports:read'), async (req, res) => {
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
    if (req.user?.role !== 'admin' && await isPeriodClosed(db, data.date)) {
      return res.status(403).json({ message: 'الفترة المالية مغلقة ولا يمكن إصدار فواتير فيها إلا بواسطة المدير.' });
    }
    const customer = await db.get('SELECT id FROM customers WHERE id = ?', data.customerId);
    if (!customer) {
      return res.status(400).json({ message: 'Customer not found' });
    }

    await db.withTransaction(async (txDb: typeof db) => {
      // Auto-generate next invoice number atomically inside transaction to prevent multi-device collisions
      const existingInvoice = await txDb.get('SELECT 1 FROM sales WITH (UPDLOCK, HOLDLOCK) WHERE invoice_number = ?', data.invoiceNumber);
      if (existingInvoice || !data.invoiceNumber || !data.invoiceNumber.trim()) {
        data.invoiceNumber = await generateNextSaleInvoiceNumber(txDb);
      }

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
      await insertSaleGuarantors(txDb, id, data.guarantors, now);

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

    if (req.user?.role !== 'admin' && (await isPeriodClosed(db, existing.date) || await isPeriodClosed(db, data.date))) {
      return res.status(403).json({ message: 'الفترة المالية مغلقة ولا يمكن تعديل فواتيرها إلا بواسطة المدير.' });
    }

    if (Number(existing.paid || 0) > 0 || existing.locked === 1 || existing.locked === true) {
      return res.status(409).json({ message: 'Cannot edit a sale that has payments or is locked' });
    }

    const linkedPurchases = await getLinkedAutoPurchases(db, existing.invoice_number);
    if (linkedPurchases.some((p) => Number(p.paid || 0) > 0)) {
      return res.status(409).json({
        message: 'لا يمكن تعديل الفاتورة لوجود فواتير شراء تلقائية مرتبطة بها مسددة جزئياً أو كلياً للمورد.',
      });
    }

    const customer = await db.get('SELECT id FROM customers WHERE id = ?', data.customerId);
    if (!customer) {
      return res.status(400).json({ message: 'Customer not found' });
    }

    await db.withTransaction(async (txDb) => {
      const lockedSale = await txDb.get(
        'SELECT paid, locked FROM sales WITH (UPDLOCK, ROWLOCK) WHERE id = ?',
        req.params.id,
      );
      if (!lockedSale || Number(lockedSale.paid || 0) > 0 || lockedSale.locked === 1 || lockedSale.locked === true) {
        throw Object.assign(new Error('Cannot edit a sale that has payments or is locked'), { statusCode: 409 });
      }
      if (data.replaceAutoPurchases && linkedPurchases.length > 0) {
        await undoLinkedAutoPurchases(txDb, linkedPurchases, now);
      }
      const oldItems = (await txDb.all(
        'SELECT * FROM sale_items WHERE sale_id = ?',
        req.params.id,
      )) as SaleItemRow[];
      for (const item of oldItems) {
        await txDb.run(
          `UPDATE products
           SET quantity = quantity + ?,
               updated_at = ?
           WHERE id = ? AND fulfillment_type = 'stocked'`,
          item.quantity,
          now,
          item.product_id,
        );
      }

      await txDb.run(
        `UPDATE customers
         SET balance = balance - ?,
             updated_at = ?
         WHERE id = ?`,
        existing.remaining,
        now,
        existing.customer_id,
      );

      await txDb.run('DELETE FROM sale_items WHERE sale_id = ?', req.params.id);
      await txDb.run('DELETE FROM installment_schedules WHERE sale_id = ?', req.params.id);

      await txDb.run(
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

      await insertSaleItemsAndAdjustStock(txDb, req.params.id, data.items, now);
      await insertInstallmentSchedules(txDb, req.params.id, data, remaining);
      if (data.guarantors !== undefined) {
        await txDb.run("DELETE FROM sale_guarantors WHERE sale_id = ? AND status = 'active'", req.params.id);
        await insertSaleGuarantors(txDb, req.params.id, data.guarantors, now);
      }

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

    if (Number(existing.paid || 0) > 0) {
      return res.status(409).json({
        message: 'لا يمكن حذف تعاقد تم تحصيل مدفوعات عليه؛ استخدم «مرتجع / إلغاء» بدلاً من الحذف لحماية الخزينة وسجل الأقساط.',
      });
    }

    if (req.user?.role !== 'admin' && await isPeriodClosed(db, existing.date)) {
      return res.status(403).json({ message: 'الفترة المالية مغلقة ولا يمكن حذف فواتيرها إلا بواسطة المدير.' });
    }

    const oldItems = (await db.all(
      'SELECT * FROM sale_items WHERE sale_id = ?',
      req.params.id,
    )) as SaleItemRow[];

    const linkedPurchases = await getLinkedAutoPurchases(db, existing.invoice_number);
    let linkedPurchaseIds: string[] = [];

    await db.withTransaction(async (txDb) => {
      const lockedSale = await txDb.get(
        'SELECT paid, locked, notes FROM sales WITH (UPDLOCK, ROWLOCK) WHERE id = ?',
        req.params.id,
      );
      if (!lockedSale || Number(lockedSale.paid || 0) > 0 || lockedSale.locked === 1 || lockedSale.locked === true) {
        throw Object.assign(new Error('لا يمكن حذف تعاقد تم تحصيل مدفوعات عليه'), { statusCode: 409 });
      }
      if (String(lockedSale.notes || '').includes('عقد منقول بالتنازل')) {
        throw Object.assign(new Error('لا يمكن حذف عقد منقول بالتنازل؛ استخدم المرتجع أو التنازل حفاظاً على سلامة الحسابات والمخزون.'), { statusCode: 409 });
      }
      for (const item of oldItems) {
        await txDb.run(
          `UPDATE products
           SET quantity = quantity + ?,
               updated_at = ?
           WHERE id = ? AND fulfillment_type = 'stocked'`,
          item.quantity,
          now,
          item.product_id,
        );
      }

      linkedPurchaseIds = await undoLinkedAutoPurchases(txDb, linkedPurchases, now);

      await txDb.run(
        `UPDATE customers
         SET balance = ROUND(balance - ?, 2),
             updated_at = ?
         WHERE id = ?`,
        existing.remaining,
        now,
        existing.customer_id,
      );

      await txDb.run(
        `DELETE FROM payments
         WHERE sale_id = ?
            OR reference_id = ?
            OR invoice_number = ?`,
        req.params.id,
        req.params.id,
        existing.invoice_number,
      );
      await txDb.run('DELETE FROM collection_tasks WHERE sale_id = ?', req.params.id);
      await txDb.run('DELETE FROM reschedule_requests WHERE sale_id = ?', req.params.id);
      await txDb.run('DELETE FROM installment_schedules WHERE sale_id = ?', req.params.id);
      await txDb.run('DELETE FROM sale_guarantors WHERE sale_id = ?', req.params.id);
      await txDb.run('DELETE FROM sale_items WHERE sale_id = ?', req.params.id);
      await txDb.run('DELETE FROM sales WHERE id = ?', req.params.id);
    });

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

const returnSaleSchema = z.object({
  reason: z.string().max(300).optional().default(''),
  returnDate: z.string().optional(),
  refundAmount: z.number().nonnegative().optional(),
});

// POST /sales/:id/return — Sales return / contract cancellation preserving audit trail & issuing cash refund
router.post('/:id/return', requirePermission('sales:write'), requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = returnSaleSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ message: 'بيانات المرتجع غير صالحة', errors: parsed.error.format() });
  }

  const now = new Date().toISOString();
  const todayCairo = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  let returnDateIso = todayCairo;
  if (parsed.data.returnDate) {
    try {
      const parsedIso = parseDateInput(parsed.data.returnDate);
      returnDateIso = parsedIso.includes('T') ? parsedIso.split('T')[0] : parsedIso;
    } catch (e) {
      return res.status(400).json({ message: e instanceof Error ? e.message : 'تاريخ المرتجع غير صالح' });
    }
  }

  try {
    const db = await dbPromise;
    const existing = await db.get<SaleRow>('SELECT * FROM sales WHERE id = ?', req.params.id);
    if (!existing) {
      return res.status(404).json({ message: 'الفاتورة غير موجودة' });
    }
    if (existing.status === 'cancelled') {
      return res.status(409).json({ message: 'الفاتورة ملغاة أو مرتجعة بالفعل' });
    }

    if (req.user?.role !== 'admin' && (await isPeriodClosed(db, returnDateIso))) {
      return res.status(403).json({ message: 'الفترة المالية مغلقة ولا يمكن تسجيل مرتجع فيها إلا بواسطة المدير.' });
    }

    const totalPaid = roundMoney(Number(existing.paid || 0));
    const requestedRefund = parsed.data.refundAmount !== undefined
      ? roundMoney(parsed.data.refundAmount)
      : totalPaid;

    if (requestedRefund > totalPaid + 0.01) {
      return res.status(400).json({ message: `مبلغ الاسترداد (${requestedRefund}) لا يمكن أن يتجاوز إجمالي المسدد (${totalPaid}).` });
    }
    const refundAmountInit = Math.min(requestedRefund, totalPaid);
    let refundAmount = refundAmountInit;
    const reasonText = (parsed.data.reason || '').trim();
    const noteAppend = `[مرتجع بتاريخ ${returnDateIso}${reasonText ? `: ${reasonText}` : ''}]`;
    const mergedNotes = existing.notes ? `${existing.notes}\n${noteAppend}` : noteAppend;
    let refundReceipt: string | null = null;

    await db.withTransaction(async (txDb) => {
      const lockedSale = (await txDb.get(
        'SELECT * FROM sales WITH (UPDLOCK, ROWLOCK) WHERE id = ?',
        req.params.id,
      )) as SaleRow | undefined;
      if (!lockedSale || lockedSale.status === 'cancelled') {
        const conflictErr: any = new Error('الفاتورة ملغاة أو مرتجعة بالفعل');
        conflictErr.statusCode = 409;
        throw conflictErr;
      }
      if (String(lockedSale.notes || '').includes('تم التنازل عن المتبقي')) {
        const transferErr: any = new Error('لا يمكن عمل مرتجع لعقد تم التنازل عنه لعميل آخر');
        transferErr.statusCode = 409;
        throw transferErr;
      }
      const livePaid = roundMoney(Number(lockedSale.paid || 0));
      const liveRequestedRefund = parsed.data.refundAmount !== undefined ? roundMoney(parsed.data.refundAmount) : livePaid;
      if (liveRequestedRefund > livePaid + 0.01) {
        const err: any = new Error(`مبلغ الاسترداد (${liveRequestedRefund}) لا يمكن أن يتجاوز إجمالي المسدد (${livePaid}).`);
        err.statusCode = 400;
        throw err;
      }
      refundAmount = Math.min(liveRequestedRefund, livePaid);

      const oldItems = (await txDb.all('SELECT * FROM sale_items WHERE sale_id = ?', req.params.id)) as SaleItemRow[];
      for (const item of oldItems) {
        await txDb.run(
          `UPDATE products
           SET quantity = quantity + ?,
               updated_at = ?
           WHERE id = ? AND fulfillment_type = 'stocked'`,
          item.quantity,
          now,
          item.product_id,
        );
      }

      const liveRemaining = roundMoney(Number(lockedSale.remaining || 0));
      if (liveRemaining > 0) {
        await txDb.run(
          `UPDATE customers
           SET balance = ROUND(balance - ?, 2),
               updated_at = ?
           WHERE id = ?`,
          liveRemaining,
          now,
          lockedSale.customer_id,
        );
      }

      await txDb.run(
        `UPDATE installment_schedules
         SET amount = paid_amount,
             status = 'settled_early',
             notes = N'ملغى بمرتجع فاتورة'
         WHERE sale_id = ? AND status NOT IN ('paid', 'settled_early')`,
        req.params.id,
      );

      await txDb.run(
        "UPDATE collection_tasks SET status = 'cancelled', visit_notes = N'ملغاة بسبب مرتجع التعاقد', updated_at = ? WHERE sale_id = ? AND status IN ('open', 'in_progress')",
        now,
        req.params.id,
      );

      if (refundAmount > 0) {
        refundReceipt = await nextReceiptNumber(txDb);
        await txDb.run(
          `INSERT INTO payments (
            id, type, amount, sale_id, installment_id, description, date, receipt_number, status, channel,
            reference_id, reference_type, customer_id, supplier_id, invoice_number, affects_customer_balance,
            created_by, created_at
          ) VALUES (?, 'out', ?, ?, NULL, ?, ?, ?, 'posted', 'cash', ?, 'sale_return', ?, NULL, ?, 0, ?, ?)`,
          uid(),
          refundAmount,
          existing.id,
          `مرتجع / استرداد نقدية فاتورة ${existing.invoice_number}${reasonText ? ` (${reasonText})` : ''}`,
          returnDateIso,
          refundReceipt,
          existing.id,
          existing.customer_id,
          existing.invoice_number,
          req.user?.name || 'system',
          now,
        );
      }

      await txDb.run(
        `UPDATE sales
         SET status = 'cancelled',
             remaining = 0,
             paid = ROUND(paid - ?, 2),
             locked = 1,
             last_edited_by = ?,
             last_edited_at = ?,
             notes = ?
         WHERE id = ?`,
        refundAmount,
        req.user?.name || 'system',
        now,
        mergedNotes,
        req.params.id,
      );
    });

    await audit('sale.return', 'sale', req.params.id, req.user?.name || 'system', {
      invoiceNumber: existing.invoice_number,
      customerId: existing.customer_id,
      refundAmount,
      refundReceipt,
      reason: reasonText,
      returnDate: returnDateIso,
    });

    await createSystemNotification(
      'warning',
      'مرتجع وإلغاء تعاقد',
      `تم تسجيل مرتجع الفاتورة ${existing.invoice_number} للعميل ${existing.customer_name}${refundAmount > 0 ? ` واسترداد ${refundAmount} جنيه من الخزينة` : ''}.`,
    );

    return res.json({
      message: `تم تسجيل المرتجع وإلغاء التعاقد ${existing.invoice_number} بنجاح.`,
      refundAmount,
      refundReceipt,
    });
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
      const lockedSale = await tx.get<SaleRow>('SELECT * FROM sales WITH (UPDLOCK, ROWLOCK) WHERE id = ?', saleId);
      if (!lockedSale || lockedSale.status === 'cancelled' || lockedSale.status === 'settled_early') {
        throw Object.assign(new Error('لا يمكن ترحيل قسط على عقد ملغى أو مسوى بالكامل'), { statusCode: 409 });
      }
      const lockedTarget = await tx.get<ScheduleRow>(
        'SELECT * FROM installment_schedules WITH (UPDLOCK, ROWLOCK) WHERE id = ?',
        target.id,
      );
      if (!lockedTarget || lockedTarget.status === 'paid' || lockedTarget.status === 'settled_early') {
        throw Object.assign(new Error('تم سداد هذا القسط بالفعل من جهاز آخر، يرجى تحديث الصفحة.'), { statusCode: 409 });
      }
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
          const penaltyReceipt = await nextReceiptNumber(tx);
          const penaltyPaymentId = uid();

          const todayCashDate = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Africa/Cairo',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(new Date());

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
            todayCashDate,
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
      monthIndex: target.month_index,
      strategy,
      newDueDate: newDueDateIso,
      penaltyFee: penalty,
      penaltyPaymentType,
      previousTotal: Number(sale.total),
      previousRemaining: Number(sale.remaining),
      previousSchedules: schedules.map((s) => ({
        id: s.id,
        due_date: s.due_date,
        amount: Number(s.amount),
        paid_amount: Number(s.paid_amount),
        status: s.status,
        deferred: s.deferred === 1 || s.deferred === true,
        deferred_at: s.deferred_at || null,
        notes: s.notes || null,
      })),
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

// Route aliases: accept POST and PUT on all defer and postpone endpoints
router.post('/:id/defer-installment', requirePermission('sales:reschedule'), handleDeferOrPostpone);
router.put('/:id/defer-installment', requirePermission('sales:reschedule'), handleDeferOrPostpone);
router.post('/:id/postpone', requirePermission('sales:reschedule'), handleDeferOrPostpone);
router.put('/:id/postpone', requirePermission('sales:reschedule'), handleDeferOrPostpone);
router.post('/defer-installment', requirePermission('sales:reschedule'), handleDeferOrPostpone);
router.put('/defer-installment', requirePermission('sales:reschedule'), handleDeferOrPostpone);
router.post('/postpone', requirePermission('sales:reschedule'), handleDeferOrPostpone);
router.put('/postpone', requirePermission('sales:reschedule'), handleDeferOrPostpone);

const rescheduleSchema = z.object({
  newInstallmentCount: z.number().int().min(1).max(120),
  extraInterestPercent: z.number().min(0).max(200).optional().default(0),
  firstNewDueDate: z.string().min(1),
  reason: z.string().max(300).optional().default(''),
});

// POST /sales/:id/reschedule — Safely reschedule remaining unpaid balance without touching paid installments or cash receipts
router.post('/:id/reschedule', requirePermission('sales:reschedule'), async (req: AuthedRequest, res) => {
  const parsed = rescheduleSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ message: 'بيانات إعادة الجدولة غير صالحة', errors: parsed.error.format() });
  }

  let firstNewDueDateIso = '';
  try {
    const parsedIso = parseDateInput(parsed.data.firstNewDueDate);
    firstNewDueDateIso = parsedIso.includes('T') ? parsedIso.split('T')[0] : parsedIso;
  } catch (e) {
    return res.status(400).json({ message: e instanceof Error ? e.message : 'تاريخ بداية الأقساط الجديدة غير صالح' });
  }

  const { newInstallmentCount, extraInterestPercent, reason } = parsed.data;
  const now = new Date().toISOString();

  try {
    const db = await dbPromise;
    const sale = await db.get<SaleRow>('SELECT * FROM sales WHERE id = ?', req.params.id);
    if (!sale) {
      return res.status(404).json({ message: 'لم يتم العثور على التعاقد' });
    }
    if (sale.status === 'cancelled') {
      return res.status(409).json({ message: 'لا يمكن إعادة جدولة تعاقد ملغى أو مرتجع' });
    }
    if (sale.payment_method !== 'installment') {
      return res.status(400).json({ message: 'إعادة الجدولة متاحة لعقود التقسيط فقط' });
    }

    let oldMonths = Number(sale.installment_months || 0);
    let totalLockedCount = 0;
    let currentRemaining = roundMoney(Number(sale.remaining || 0));
    let extraInterestAmount = 0;
    let newRemaining = currentRemaining;
    let newTotal = roundMoney(Number(sale.total || 0));
    let newTax = roundMoney(Number(sale.tax || 0));
    let monthlyAmount = 0;

    await db.withTransaction(async (txDb: typeof db) => {
      const lockedSale = await txDb.get<SaleRow>(
        'SELECT * FROM sales WITH (UPDLOCK, ROWLOCK) WHERE id = ?',
        req.params.id,
      );
      if (!lockedSale || lockedSale.status === 'cancelled' || lockedSale.status === 'settled_early') {
        throw Object.assign(new Error('لا يمكن إعادة جدولة تعاقد ملغى أو مسوى'), { statusCode: 409 });
      }
      currentRemaining = roundMoney(Number(lockedSale.remaining || 0));
      if (currentRemaining <= 0) {
        throw Object.assign(new Error('لا يوجد مبلغ متبقٍ لإعادة جدولته في هذا التعاقد'), { statusCode: 400 });
      }
      extraInterestAmount = roundMoney((currentRemaining * extraInterestPercent) / 100);
      newRemaining = roundMoney(currentRemaining + extraInterestAmount);
      newTotal = roundMoney(Number(lockedSale.total || 0) + extraInterestAmount);
      newTax = roundMoney(Number(lockedSale.tax || 0) + extraInterestAmount);
      monthlyAmount = Math.round(newRemaining / newInstallmentCount);
      if (monthlyAmount * (newInstallmentCount - 1) > newRemaining) {
        monthlyAmount = Math.floor(newRemaining / newInstallmentCount);
      }
      oldMonths = Number(lockedSale.installment_months || 0);

      const schedules = await txDb.all<ScheduleRow>(
        'SELECT * FROM installment_schedules WITH (UPDLOCK, ROWLOCK) WHERE sale_id = ? ORDER BY month_index ASC',
        lockedSale.id,
      );

      if (!oldMonths) {
        oldMonths = schedules.length;
      }

      let maxLockedMonthIndex = 0;
      for (const sch of schedules) {
        const isSettled = sch.status === 'paid' || sch.status === 'settled_early';
        const paidAmt = roundMoney(Number(sch.paid_amount || 0));
        if (isSettled) {
          totalLockedCount++;
          if (sch.month_index > maxLockedMonthIndex) maxLockedMonthIndex = sch.month_index;
        } else if (paidAmt > 0) {
          // Lock partial payments at what was actually paid so past treasury receipts remain exact
          await txDb.run(
            `UPDATE installment_schedules
             SET amount = ?, status = 'paid', paid_at = COALESCE(paid_at, ?), notes = ?
             WHERE id = ?`,
            paidAmt,
            now,
            'تم إغلاق الجزء المسدد وإعادة جدولة المتبقي',
            sch.id,
          );
          totalLockedCount++;
          if (sch.month_index > maxLockedMonthIndex) maxLockedMonthIndex = sch.month_index;
        }
      }

      // Cancel open collection tasks for old unpaid installments
      await txDb.run(
        `UPDATE collection_tasks
         SET status = 'cancelled', visit_notes = N'ملغاة بسبب إعادة جدولة المتبقي', updated_at = ?
         WHERE sale_id = ? AND status IN ('open', 'in_progress')`,
        now,
        sale.id,
      );

      // Remove only unpaid (paid_amount = 0) schedules
      await txDb.run(
        `DELETE FROM installment_schedules
         WHERE sale_id = ? AND status NOT IN ('paid', 'settled_early') AND COALESCE(paid_amount, 0) <= 0`,
        sale.id,
      );

      // Insert new installment schedules for newRemaining
      for (let i = 0; i < newInstallmentCount; i++) {
        const dueDate = addMonths(firstNewDueDateIso, i);
        const amount =
          i === newInstallmentCount - 1
            ? roundMoney(newRemaining - monthlyAmount * (newInstallmentCount - 1))
            : monthlyAmount;

        await txDb.run(
          `INSERT INTO installment_schedules (
            id, sale_id, month_index, due_date, amount, paid_amount, status, notes
          ) VALUES (?, ?, ?, ?, ?, 0, 'pending', ?)`,
          uid(),
          sale.id,
          maxLockedMonthIndex + i + 1,
          dueDate,
          amount,
          reason.trim() ? `إعادة جدولة: ${reason.trim()}` : 'قسط مُعاد جدولته',
        );
      }

      const newTotalMonths = totalLockedCount + newInstallmentCount;
      const rescheduleNote = `[إعادة جدولة المتبقي (${newRemaining} ج) على ${newInstallmentCount} قسط${
        extraInterestAmount > 0 ? ` + فائدة تمديد ${extraInterestAmount} ج` : ''
      }${reason.trim() ? ` - ${reason.trim()}` : ''}]`;
      const mergedNotes = sale.notes ? `${sale.notes}\n${rescheduleNote}` : rescheduleNote;

      await txDb.run(
        `UPDATE sales
         SET total = ?,
             tax = ?,
             remaining = ?,
             installment_months = ?,
             monthly_installment_amount = ?,
             notes = ?,
             last_edited_by = ?,
             last_edited_at = ?
         WHERE id = ?`,
        newTotal,
        newTax,
        newRemaining,
        newTotalMonths,
        monthlyAmount,
        mergedNotes,
        req.user?.name || 'system',
        now,
        sale.id,
      );

      if (extraInterestAmount > 0) {
        await txDb.run(
          `UPDATE customers
           SET balance = ROUND(balance + ?, 2),
               updated_at = ?
           WHERE id = ?`,
          extraInterestAmount,
          now,
          sale.customer_id,
        );
      }

      await txDb.run(
        `INSERT INTO reschedule_requests (
          id, sale_id, customer_id, reason, status, old_installment_months, new_installment_months,
          paid_before_reschedule, extra_interest_amount,
          requested_by, requested_at, reviewed_by, reviewed_at
        ) VALUES (?, ?, ?, ?, 'approved', ?, ?, ?, ?, ?, ?, ?, ?)`,
        uid(),
        sale.id,
        sale.customer_id,
        reason.trim() || 'إعادة جدولة المتبقي من العقد',
        oldMonths,
        newTotalMonths,
        roundMoney(Number(sale.paid || 0)),
        extraInterestAmount,
        req.user?.name || 'system',
        now,
        req.user?.name || 'system',
        now,
      );
    });

    await audit('sale.reschedule', 'sale', sale.id, req.user?.name || 'system', {
      invoiceNumber: sale.invoice_number,
      oldMonths,
      newRemainingInstallments: newInstallmentCount,
      lockedPaidInstallments: totalLockedCount,
      previousRemaining: currentRemaining,
      extraInterestPercent,
      extraInterestAmount,
      newRemaining,
      monthlyAmount,
      firstNewDueDate: firstNewDueDateIso,
    });

    await createSystemNotification(
      'info',
      'إعادة جدولة تعاقد',
      `تمت إعادة جدولة المتبقي للعقد ${sale.invoice_number} (${sale.customer_name}) على ${newInstallmentCount} قسط بقيمة ${monthlyAmount} جنيه شهرياً`,
    );

    const updatedSchedules = await db.all<ScheduleRow>(
      'SELECT * FROM installment_schedules WHERE sale_id = ? ORDER BY month_index ASC',
      sale.id,
    );
    const updatedSaleRow = await db.get<SaleRow>('SELECT * FROM sales WHERE id = ?', sale.id);

    return res.status(200).json({
      message: 'تمت إعادة جدولة المتبقي بنجاح',
      schedules: mapSchedules(updatedSchedules),
      sale: updatedSaleRow ? mapSale(updatedSaleRow, [], mapSchedules(updatedSchedules)) : null,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});
router.post('/:id/installments/postpone', requirePermission('sales:reschedule'), handleDeferOrPostpone);
router.put('/:id/installments/postpone', requirePermission('sales:reschedule'), handleDeferOrPostpone);
router.post('/installments/postpone', requirePermission('sales:reschedule'), handleDeferOrPostpone);
router.put('/installments/postpone', requirePermission('sales:reschedule'), handleDeferOrPostpone);

// POST /sales/:id/undo-defer-installment — Revert an installment deferral cleanly
router.post('/:id/undo-defer-installment', requirePermission('sales:reschedule'), async (req: AuthedRequest, res) => {
  const installmentId = String(req.body?.installmentId || '').trim();
  const saleId = String(req.params.id || '').trim();
  if (!saleId || !installmentId) {
    return res.status(400).json({ message: 'معرف الفاتورة ومعرف القسط مطلوبان' });
  }

  const now = new Date().toISOString();
  try {
    const db = await dbPromise;
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
    const isDeferred = target.deferred === 1 || target.deferred === true || Boolean(target.notes?.includes('مرحّل') || target.notes?.includes('مدمج') || target.notes?.includes('تم ترحيل'));
    if (!isDeferred) {
      return res.status(400).json({ message: 'هذا القسط ليس مرحلاً حالياً' });
    }

    const auditRows = await db.all<{ payload: string | null }>(
      "SELECT payload FROM audit_log WHERE action = 'sale.defer_installment' AND entity_type = 'sale' AND entity_id = ? ORDER BY created_at DESC",
      saleId,
    );
    let matchedPayload: any = null;
    for (const row of auditRows) {
      if (!row.payload) continue;
      try {
        const parsedPayload = JSON.parse(row.payload);
        if (parsedPayload?.installmentId === installmentId || parsedPayload?.previousSchedules) {
          matchedPayload = parsedPayload;
          if (parsedPayload?.installmentId === installmentId) break;
        }
      } catch {
        // skip malformed audit payload
      }
    }

    if (matchedPayload?.previousSchedules && Array.isArray(matchedPayload.previousSchedules)) {
      const prevSchedules = matchedPayload.previousSchedules as Array<{
        id: string;
        due_date: string;
        amount: number;
        paid_amount: number;
        status: string;
        deferred: boolean;
        deferred_at: string | null;
        notes: string | null;
      }>;

      for (const prevSch of prevSchedules) {
        const liveSch = schedules.find((s) => s.id === prevSch.id);
        if (liveSch && roundMoney(Number(liveSch.paid_amount)) > roundMoney(Number(prevSch.paid_amount || 0)) + 0.01) {
          return res.status(409).json({
            message: `تم تحصيل مبالغ على القسط ${liveSch.month_index} بعد الترحيل. يرجى عكس الإيصالات المسددة أولاً قبل التراجع عن الترحيل.`,
          });
        }
      }

      const penaltyFee = roundMoney(Number(matchedPayload.penaltyFee || 0));
      const penaltyPaymentType = matchedPayload.penaltyPaymentType;

      await db.withTransaction(async (tx: typeof db) => {
        for (const prevSch of prevSchedules) {
          await tx.run(
            `UPDATE installment_schedules
             SET due_date = ?, amount = ?, status = ?, deferred = ?, deferred_at = ?, notes = ?
             WHERE id = ? AND sale_id = ?`,
            prevSch.due_date,
            prevSch.amount,
            prevSch.status,
            prevSch.deferred ? 1 : 0,
            prevSch.deferred_at || null,
            prevSch.notes || null,
            prevSch.id,
            saleId,
          );
        }

        if (penaltyFee > 0 && penaltyPaymentType === 'add_to_debt') {
          await tx.run(
            `UPDATE sales
             SET total = ROUND(total - ?, 2),
                 remaining = ROUND(remaining - ?, 2),
                 last_edited_by = ?,
                 last_edited_at = ?
             WHERE id = ?`,
            penaltyFee,
            penaltyFee,
            req.user?.name || 'system',
            now,
            saleId,
          );
          await tx.run(
            'UPDATE customers SET balance = ROUND(balance - ?, 2), updated_at = ? WHERE id = ?',
            penaltyFee,
            now,
            sale.customer_id,
          );
        } else if (penaltyFee > 0 && penaltyPaymentType === 'collect_cash') {
          await tx.run(
            `UPDATE payments
             SET status = 'voided'
             WHERE sale_id = ? AND installment_id = ? AND status = 'posted' AND type = 'in' AND amount = ? AND description LIKE N'%غرامة تأخير/ترحيل%'`,
            saleId,
            installmentId,
            penaltyFee,
          );
        }
      });
    } else if (matchedPayload?.strategy === 'shift_subsequent' || (!target.notes?.includes('مدمج') && !target.notes?.includes('ودمجه'))) {
      // Best-effort fallback for shift deferrals that happened before audit snapshotting
      const penaltyFee = matchedPayload?.penaltyPaymentType === 'add_to_debt' ? roundMoney(Number(matchedPayload?.penaltyFee || 0)) : 0;
      await db.withTransaction(async (tx: typeof db) => {
        await tx.run(
          'UPDATE installment_schedules SET due_date = ?, amount = ?, deferred = 0, deferred_at = NULL, notes = NULL WHERE id = ?',
          addMonths(target.due_date, -1),
          Math.max(Number(target.paid_amount), roundMoney(Number(target.amount) - penaltyFee)),
          target.id,
        );
        for (let i = targetIndex + 1; i < schedules.length; i++) {
          const sch = schedules[i];
          if (sch.status !== 'paid' && sch.status !== 'settled_early') {
            await tx.run(
              'UPDATE installment_schedules SET due_date = ? WHERE id = ?',
              addMonths(sch.due_date, -1),
              sch.id,
            );
          }
        }
        if (penaltyFee > 0) {
          await tx.run(
            `UPDATE sales
             SET total = ROUND(total - ?, 2),
                 remaining = ROUND(remaining - ?, 2),
                 last_edited_by = ?,
                 last_edited_at = ?
             WHERE id = ?`,
            penaltyFee,
            penaltyFee,
            req.user?.name || 'system',
            now,
            saleId,
          );
          await tx.run(
            'UPDATE customers SET balance = ROUND(balance - ?, 2), updated_at = ? WHERE id = ?',
            penaltyFee,
            now,
            sale.customer_id,
          );
        }
      });
    } else {
      return res.status(400).json({
        message: 'تم هذا الدمج قبل تفعيل سجل اللقطة التفصيلية. لا يمكن التراجع التلقائي عن دمجه.',
      });
    }

    await audit('sale.undo_defer_installment', 'sale', saleId, req.user?.name || 'system', {
      saleId,
      invoiceNumber: sale.invoice_number,
      installmentId,
    });

    const updatedSchedules = await db.all<ScheduleRow>(
      'SELECT * FROM installment_schedules WHERE sale_id = ? ORDER BY month_index ASC',
      saleId,
    );
    const updatedSaleRow = await db.get<SaleRow>('SELECT * FROM sales WHERE id = ?', saleId);

    return res.json({
      message: 'تم التراجع عن ترحيل القسط وإعادة الجدول لحالته السابقة بنجاح.',
      schedules: mapSchedules(updatedSchedules),
      sale: updatedSaleRow ? mapSale(updatedSaleRow, mapSaleItems(await db.all<SaleItemRow>('SELECT * FROM sale_items WHERE sale_id = ?', saleId)), mapSchedules(updatedSchedules)) : null,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// Update or clear a collection follow-up note on a specific installment schedule
const handleUpdateInstallmentNote = async (req: any, res: any) => {
  try {
    const installmentId = String(req.params.id || '').trim();
    if (!installmentId) {
      return res.status(400).json({ message: 'معرف القسط مطلوب' });
    }
    const rawNote = typeof req.body?.notes === 'string' ? req.body.notes.trim() : '';
    const noteValue = rawNote.length > 0 ? rawNote.slice(0, 255) : null;

    const db = await dbPromise;
    const existing = await db.get<{ id: string }>(
      'SELECT id FROM installment_schedules WHERE id = ?',
      installmentId,
    );
    if (!existing) {
      return res.status(404).json({ message: 'القسط غير موجود أو لا يملك جدول أقساط منفصل' });
    }

    await db.run(
      'UPDATE installment_schedules SET notes = ? WHERE id = ?',
      noteValue,
      installmentId,
    );
    return res.json({ ok: true, id: installmentId, notes: noteValue });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
};

router.patch('/:id/note', requireAnyPermission('sales:write', 'payments:write'), handleUpdateInstallmentNote);
router.post('/:id/note', requireAnyPermission('sales:write', 'payments:write'), handleUpdateInstallmentNote);

// Update or clear a pinned collection follow-up note on the entire sale/invoice (persists until invoice is paid off)
const handleUpdateSaleCollectionNote = async (req: any, res: any) => {
  try {
    const saleId = String(req.params.id || '').trim();
    if (!saleId) {
      return res.status(400).json({ message: 'معرف الفاتورة مطلوب' });
    }
    const rawNote = typeof req.body?.notes === 'string' ? req.body.notes.trim() : '';
    const noteValue = rawNote.length > 0 ? rawNote.slice(0, 500) : null;

    const db = await dbPromise;
    const existing = await db.get<{ id: string }>('SELECT id FROM sales WHERE id = ?', saleId);
    if (!existing) {
      return res.status(404).json({ message: 'الفاتورة غير موجودة' });
    }

    await db.run('UPDATE sales SET collection_note = ? WHERE id = ?', noteValue, saleId);
    return res.json({ ok: true, id: saleId, invoiceNote: noteValue });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
};

router.patch('/:id/collection-note', requireAnyPermission('sales:write', 'payments:write'), handleUpdateSaleCollectionNote);
router.post('/:id/collection-note', requireAnyPermission('sales:write', 'payments:write'), handleUpdateSaleCollectionNote);

export default router;


