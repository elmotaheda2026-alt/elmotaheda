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
  paid_amount?: number;
  remaining_amount: number;
  status: string;
  paid_at?: string;
  effective_payment_date?: string | Date | null;
  last_payment_date?: string;
  parsed_last_payment_date?: Date | null;
  total_invoice_remaining?: number;
}

export type CollectionStatusFilter = 'unpaid' | 'paid' | 'all';
export type CollectionDateBasis = 'actual_payment' | 'due_date';

export async function getCollectionDues(params: {
  from?: string;
  to?: string;
  search?: string;
  salesRepId?: string;
  hideSued?: boolean;
  includeOverdue?: boolean;
  strictDate?: boolean;
  statusFilter?: CollectionStatusFilter;
  dateBasis?: CollectionDateBasis;
}) {
  const db = await dbPromise;

  const from = (params.from || '').trim();
  const to = (params.to || '').trim();
  const search = (params.search || '').trim();
  const salesRepId = (params.salesRepId || '').trim();
  const hideSued = Boolean(params.hideSued);
  const statusFilter: CollectionStatusFilter = params.statusFilter || 'unpaid';
  const dateBasis: CollectionDateBasis = params.dateBasis || 'actual_payment';

  // includeOverdue only applies to unpaid/open installments
  const includeOverdue = Boolean(params.includeOverdue) && !params.strictDate && statusFilter !== 'paid';

  const whereParts: string[] = [];
  const args: any[] = [];

  // 1. Status Filtering
  if (statusFilter === 'unpaid') {
    whereParts.push("status <> 'paid'");
    whereParts.push('remaining_amount >= 1.0');
  } else if (statusFilter === 'paid') {
    whereParts.push("(status = 'paid' OR remaining_amount < 1.0)");
  }
  // If 'all', do not constrain status

  // 2. Search & Rep & Legal Filtering
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

  // 3. Date Filtering Logic
  if (statusFilter === 'unpaid') {
    if (includeOverdue) {
      if (to) {
        whereParts.push('(parsed_due_date IS NULL OR parsed_due_date <= ?)');
        args.push(to);
      }
    } else {
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
  } else if (statusFilter === 'paid') {
    if (dateBasis === 'actual_payment') {
      if (from && to) {
        whereParts.push('(effective_payment_date >= ? AND effective_payment_date <= ?)');
        args.push(from, to);
      } else if (from) {
        whereParts.push('(effective_payment_date >= ?)');
        args.push(from);
      } else if (to) {
        whereParts.push('(effective_payment_date <= ?)');
        args.push(to);
      }
    } else {
      // by due date
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
  } else {
    // statusFilter === 'all':
    if (dateBasis === 'due_date') {
      if (includeOverdue) {
        if (from && to) {
          whereParts.push('((status = \'paid\' AND parsed_due_date >= ? AND parsed_due_date <= ?) OR (status <> \'paid\' AND (parsed_due_date IS NULL OR parsed_due_date <= ?)))');
          args.push(from, to, to);
        } else if (to) {
          whereParts.push('(parsed_due_date IS NULL OR parsed_due_date <= ?)');
          args.push(to);
        }
      } else {
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
    } else {
      // actual_payment: for paid records check effective_payment_date; for unpaid check parsed_due_date
      if (includeOverdue) {
        if (from && to) {
          whereParts.push('((status = \'paid\' AND effective_payment_date >= ? AND effective_payment_date <= ?) OR (status <> \'paid\' AND (parsed_due_date IS NULL OR parsed_due_date <= ?)))');
          args.push(from, to, to);
        } else if (to) {
          whereParts.push('((status = \'paid\' AND effective_payment_date <= ?) OR (status <> \'paid\' AND (parsed_due_date IS NULL OR parsed_due_date <= ?)))');
          args.push(to, to);
        }
      } else {
        if (from && to) {
          whereParts.push('((status = \'paid\' AND effective_payment_date >= ? AND effective_payment_date <= ?) OR (status <> \'paid\' AND parsed_due_date >= ? AND parsed_due_date <= ?))');
          args.push(from, to, from, to);
        } else if (from) {
          whereParts.push('((status = \'paid\' AND effective_payment_date >= ?) OR (status <> \'paid\' AND parsed_due_date >= ?))');
          args.push(from, from);
        } else if (to) {
          whereParts.push('((status = \'paid\' AND effective_payment_date <= ?) OR (status <> \'paid\' AND parsed_due_date <= ?))');
          args.push(to, to);
        }
      }
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
        sch.paid_amount AS paid_amount,
        (sch.amount - sch.paid_amount) AS remaining_amount,
        sch.status,
        sch.paid_at,
        COALESCE(
          TRY_CONVERT(date, sch.paid_at),
          TRY_CONVERT(date, p_sale.last_payment_by_sale),
          TRY_CONVERT(date, p_cust.last_payment_by_customer),
          TRY_CONVERT(date, sch_paid.last_sch_paid_at),
          TRY_CONVERT(date, s.installment_start_date),
          TRY_CONVERT(date, s.date)
        ) AS effective_payment_date,
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
      FROM installment_schedules sch WITH (NOLOCK)
      INNER JOIN sales s WITH (NOLOCK) ON s.id = sch.sale_id
      LEFT JOIN customers c WITH (NOLOCK) ON c.id = s.customer_id
      LEFT JOIN (
        SELECT sale_id, MAX(paid_at) AS last_sch_paid_at
        FROM installment_schedules WITH (NOLOCK)
        WHERE status = 'paid' AND paid_at IS NOT NULL
        GROUP BY sale_id
      ) sch_paid ON sch_paid.sale_id = s.id
      LEFT JOIN (
        SELECT sale_id, MAX(date) AS last_payment_by_sale
        FROM payments WITH (NOLOCK)
        WHERE status = 'posted' AND type = 'in' AND sale_id IS NOT NULL
        GROUP BY sale_id
      ) p_sale ON p_sale.sale_id = s.id
      LEFT JOIN (
        SELECT customer_id, MAX(date) AS last_payment_by_customer
        FROM payments WITH (NOLOCK)
        WHERE status = 'posted' AND type = 'in' AND customer_id IS NOT NULL
        GROUP BY customer_id
      ) p_cust ON p_cust.customer_id = s.customer_id
      WHERE s.status <> 'cancelled'

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
        s.paid AS paid_amount,
        CASE
          WHEN s.monthly_installment_amount > 0 AND s.remaining < s.monthly_installment_amount THEN s.remaining
          WHEN s.monthly_installment_amount > 0 THEN s.monthly_installment_amount
          ELSE s.remaining
        END AS remaining_amount,
        CASE WHEN s.remaining < 1.0 THEN 'paid' WHEN s.paid > 0 THEN 'partial' ELSE 'unpaid' END AS status,
        NULL AS paid_at,
        COALESCE(
          TRY_CONVERT(date, p_sale.last_payment_by_sale),
          TRY_CONVERT(date, p_cust.last_payment_by_customer),
          TRY_CONVERT(date, s.date)
        ) AS effective_payment_date,
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
      FROM sales s WITH (NOLOCK)
      LEFT JOIN customers c WITH (NOLOCK) ON c.id = s.customer_id
      LEFT JOIN (
        SELECT sale_id, MAX(date) AS last_payment_by_sale
        FROM payments WITH (NOLOCK)
        WHERE status = 'posted' AND type = 'in' AND sale_id IS NOT NULL
        GROUP BY sale_id
      ) p_sale ON p_sale.sale_id = s.id
      LEFT JOIN (
        SELECT customer_id, MAX(date) AS last_payment_by_customer
        FROM payments WITH (NOLOCK)
        WHERE status = 'posted' AND type = 'in' AND customer_id IS NOT NULL
        GROUP BY customer_id
      ) p_cust ON p_cust.customer_id = s.customer_id
      WHERE s.status <> 'cancelled'
        AND NOT EXISTS (
          SELECT 1 FROM installment_schedules WITH (NOLOCK) WHERE sale_id = s.id
        )
    )
    SELECT *
    FROM AllDues
    ${whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : ''}
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

    const isoEffectivePaymentDate = row.effective_payment_date
      ? (row.effective_payment_date instanceof Date
          ? row.effective_payment_date.toISOString().slice(0, 10)
          : String(row.effective_payment_date).slice(0, 10))
      : undefined;

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
      paidAmount: Number(row.paid_amount || (row.status === 'paid' ? row.installment_amount : (row.installment_amount - row.remaining_amount))),
      remainingAmount: Math.max(Number(row.remaining_amount), 0),
      status: row.status,
      paidAt: row.paid_at || isoEffectivePaymentDate || undefined,
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
      statusFilter: typeof req.query.statusFilter === 'string' ? (req.query.statusFilter as CollectionStatusFilter) : undefined,
      dateBasis: typeof req.query.dateBasis === 'string' ? (req.query.dateBasis as CollectionDateBasis) : undefined,
    });
    return res.json(data);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

export default router;

