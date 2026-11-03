import { Router } from 'express';
import { dbPromise } from '../db.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { formatDate } from '../utils.js';

const router = Router();
router.use(requireAuth);

export interface DueCollectionRow {
  sale_id: string;
  invoice_number: string;
  customer_id: string;
  customer_name: string;
  customer_phone?: string;
  customer_address?: string;
  customer_number?: string;
  sales_rep_id?: string;
  sales_rep_name?: string;
  is_sued?: boolean | number;
  guarantors?: string;
  installment_id: string;
  month_index: number;
  installment_label: string;
  due_date: string;
  parsed_due_date?: Date | null;
  installment_amount: number;
  remaining_amount: number;
  status: string;
  paid_at?: string;
  last_payment_date?: string;
  parsed_last_payment_date?: Date | null;
  total_invoice_remaining?: number;
}

export async function getCollectionDues(params: {
  from?: string;
  to?: string;
  search?: string;
  salesRepId?: string;
  hideSued?: boolean;
  includeOverdue?: boolean;
  strictDate?: boolean;
}) {
  const db = await dbPromise;

  const from = (params.from || '').trim();
  const to = (params.to || '').trim();
  const search = (params.search || '').trim();
  const salesRepId = (params.salesRepId || '').trim();
  const hideSued = Boolean(params.hideSued);
  // Default is false: strict period filtering by default, unless includeOverdue is explicitly true
  const includeOverdue = Boolean(params.includeOverdue) && !params.strictDate;

  // Strictly exclude zero-balance or negligible remaining amounts (exclude rounding dust < 1 EGP)
  const whereParts: string[] = ['remaining_amount >= 1.0'];
  const args: any[] = [];

  if (search) {
    whereParts.push('(customer_name LIKE ? OR invoice_number LIKE ? OR customer_phone LIKE ? OR customer_address LIKE ?)');
    args.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  if (salesRepId && salesRepId !== 'all') {
    whereParts.push('sales_rep_id = ?');
    args.push(salesRepId);
  }

  if (hideSued) {
    whereParts.push('ISNULL(is_sued, 0) = 0');
  }

  // Date Filtering:
  // 1. When includeOverdue is explicitly true: include all active unpaid debts due on or before `to`
  if (includeOverdue) {
    if (to) {
      whereParts.push('(parsed_due_date IS NULL OR parsed_due_date <= ?)');
      args.push(to);
    }
  } else {
    // 2. Default: Strict Period Filtering (only records that actually fall within the range)
    if (from && to) {
      whereParts.push('(parsed_due_date >= ? AND parsed_due_date <= ?)');
      args.push(from, to);
    } else if (from) {
      whereParts.push('(parsed_due_date >= ?)');
      args.push(from);
    } else if (to) {
      whereParts.push('(parsed_due_date <= ?)');
      args.push(to);
    }
  }

  const query = `
    WITH AllDues AS (
      -- 1. Explicit installment schedules
      SELECT
        s.id AS sale_id,
        s.invoice_number,
        s.customer_id,
        s.customer_name,
        c.phone AS customer_phone,
        c.address AS customer_address,
        c.customer_number,
        s.sales_rep_id,
        s.sales_rep_name,
        c.is_sued,
        c.guarantors,
        sch.id AS installment_id,
        sch.month_index,
        N'القسط ' + CAST(sch.month_index AS NVARCHAR(10)) AS installment_label,
        sch.due_date,
        TRY_CONVERT(date, sch.due_date) AS parsed_due_date,
        sch.amount AS installment_amount,
        (sch.amount - sch.paid_amount) AS remaining_amount,
        sch.status,
        sch.paid_at,
        COALESCE(
          p_sale.last_payment_by_sale,
          p_cust.last_payment_by_customer,
          sch_paid.last_sch_paid_at,
          sch.paid_at,
          CASE WHEN s.paid > 0 THEN COALESCE(s.installment_start_date, s.date, s.created_at) ELSE NULL END
        ) AS last_payment_date,
        TRY_CONVERT(date, COALESCE(
          p_sale.last_payment_by_sale,
          p_cust.last_payment_by_customer,
          sch_paid.last_sch_paid_at,
          sch.paid_at,
          CASE WHEN s.paid > 0 THEN COALESCE(s.installment_start_date, s.date, s.created_at) ELSE NULL END
        )) AS parsed_last_payment_date,
        s.remaining AS total_invoice_remaining
      FROM installment_schedules sch
      INNER JOIN sales s ON s.id = sch.sale_id
      LEFT JOIN customers c ON c.id = s.customer_id
      LEFT JOIN (
        SELECT sale_id, MAX(paid_at) AS last_sch_paid_at
        FROM installment_schedules
        WHERE status = 'paid' AND paid_at IS NOT NULL
        GROUP BY sale_id
      ) sch_paid ON sch_paid.sale_id = s.id
      LEFT JOIN (
        SELECT sale_id, MAX(date) AS last_payment_by_sale
        FROM payments
        WHERE status = 'posted' AND type = 'in' AND sale_id IS NOT NULL
        GROUP BY sale_id
      ) p_sale ON p_sale.sale_id = s.id
      LEFT JOIN (
        SELECT customer_id, MAX(date) AS last_payment_by_customer
        FROM payments
        WHERE status = 'posted' AND type = 'in' AND customer_id IS NOT NULL
        GROUP BY customer_id
      ) p_cust ON p_cust.customer_id = s.customer_id
      WHERE s.status <> 'cancelled'
        AND sch.status <> 'paid'
        AND (sch.amount - sch.paid_amount) >= 1.0

      UNION ALL

      -- 2. Open balance / sales with remaining > 0 without explicit installment schedules
      SELECT
        s.id AS sale_id,
        s.invoice_number,
        s.customer_id,
        s.customer_name,
        c.phone AS customer_phone,
        c.address AS customer_address,
        c.customer_number,
        s.sales_rep_id,
        s.sales_rep_name,
        c.is_sued,
        c.guarantors,
        s.id + N'-single' AS installment_id,
        1 AS month_index,
        N'القسط الشهري' AS installment_label,
        COALESCE(s.installment_start_date, s.date, s.created_at) AS due_date,
        COALESCE(
          TRY_CONVERT(date, s.installment_start_date),
          TRY_CONVERT(date, s.date),
          TRY_CONVERT(date, s.created_at)
        ) AS parsed_due_date,
        COALESCE(s.monthly_installment_amount, s.total) AS installment_amount,
        CASE
          WHEN s.monthly_installment_amount > 0 AND s.remaining < s.monthly_installment_amount THEN s.remaining
          WHEN s.monthly_installment_amount > 0 THEN s.monthly_installment_amount
          ELSE s.remaining
        END AS remaining_amount,
        CASE WHEN s.paid > 0 THEN 'partial' ELSE 'unpaid' END AS status,
        NULL AS paid_at,
        COALESCE(
          p_sale.last_payment_by_sale,
          p_cust.last_payment_by_customer,
          CASE WHEN s.paid > 0 THEN COALESCE(s.installment_start_date, s.date, s.created_at) ELSE NULL END
        ) AS last_payment_date,
        TRY_CONVERT(date, COALESCE(
          p_sale.last_payment_by_sale,
          p_cust.last_payment_by_customer,
          CASE WHEN s.paid > 0 THEN COALESCE(s.installment_start_date, s.date, s.created_at) ELSE NULL END
        )) AS parsed_last_payment_date,
        s.remaining AS total_invoice_remaining
      FROM sales s
      LEFT JOIN customers c ON c.id = s.customer_id
      LEFT JOIN (
        SELECT sale_id, MAX(date) AS last_payment_by_sale
        FROM payments
        WHERE status = 'posted' AND type = 'in' AND sale_id IS NOT NULL
        GROUP BY sale_id
      ) p_sale ON p_sale.sale_id = s.id
      LEFT JOIN (
        SELECT customer_id, MAX(date) AS last_payment_by_customer
        FROM payments
        WHERE status = 'posted' AND type = 'in' AND customer_id IS NOT NULL
        GROUP BY customer_id
      ) p_cust ON p_cust.customer_id = s.customer_id
      WHERE s.status <> 'cancelled'
        AND s.remaining >= 1.0
        AND NOT EXISTS (
          SELECT 1 FROM installment_schedules WHERE sale_id = s.id
        )
    )
    SELECT *
    FROM AllDues
    WHERE ${whereParts.join(' AND ')}
    ORDER BY parsed_due_date ASC, customer_name ASC, month_index ASC
  `;

  const rows = await db.all<DueCollectionRow>(query, ...args);

  return rows.map((row) => {
    let parsedGuarantors: any[] = [null, null, null];
    if (row.guarantors) {
      try {
        parsedGuarantors = JSON.parse(row.guarantors);
      } catch (_) {}
    }

    const isoDueDate = row.parsed_due_date
      ? (row.parsed_due_date instanceof Date
          ? row.parsed_due_date.toISOString().slice(0, 10)
          : String(row.parsed_due_date).slice(0, 10))
      : formatDate(row.due_date);

    const isoLastPaymentDate = row.parsed_last_payment_date
      ? (row.parsed_last_payment_date instanceof Date
          ? row.parsed_last_payment_date.toISOString().slice(0, 10)
          : String(row.parsed_last_payment_date).slice(0, 10))
      : row.last_payment_date ? formatDate(row.last_payment_date) : undefined;

    return {
      saleId: row.sale_id,
      invoiceNumber: row.invoice_number,
      customerId: row.customer_id,
      customerName: row.customer_name,
      customerPhone: row.customer_phone || '-',
      customerAddress: row.customer_address || '-',
      customerNumber: row.customer_number || '',
      installmentId: row.installment_id,
      installmentLabel: row.installment_label,
      dueDate: isoDueDate,
      installmentAmount: Number(row.installment_amount),
      remainingAmount: Math.max(Number(row.remaining_amount), 0),
      status: row.status,
      paidAt: row.paid_at || undefined,
      guarantors: parsedGuarantors,
      salesRepId: row.sales_rep_id || undefined,
      salesRepName: row.sales_rep_name || undefined,
      isSued: row.is_sued === 1 || row.is_sued === true,
      lastPaymentDate: isoLastPaymentDate || undefined,
      totalInvoiceRemaining: Number(row.total_invoice_remaining || 0),
    };
  });
}

router.get('/', requirePermission('sales:read'), async (req, res) => {
  try {
    const data = await getCollectionDues({
      from: typeof req.query.from === 'string' ? req.query.from : undefined,
      to: typeof req.query.to === 'string' ? req.query.to : undefined,
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      salesRepId: typeof req.query.salesRepId === 'string' ? req.query.salesRepId : undefined,
      hideSued: String(req.query.hideSued) === 'true',
      includeOverdue: String(req.query.includeOverdue) === 'true',
      strictDate: String(req.query.strictDate) === 'true',
    });
    return res.json(data);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

export default router;

