import { Router } from 'express';
import sql from 'mssql';
import { dbPromise, poolPromise } from '../db.js';
import { requireAuth, requirePermission, type AuthedRequest } from '../middleware/auth.js';
import { audit } from '../audit.js';
import { hashPassword, uid } from '../utils.js';

const router = Router();
router.use(requireAuth, requirePermission('settings:manage'));

const BACKUP_VERSION = 1;
const BACKUP_KEY_NAMES = [
  'USERS',
  'CUSTOMERS',
  'SUPPLIERS',
  'PRODUCTS',
  'SALES',
  'PURCHASES',
  'PAYMENTS',
  'EXPENSES',
  'SETTINGS',
  'NOTIFICATIONS',
  'SALES_REPS',
  'SHAREHOLDERS',
  'SHAREHOLDER_TRANSACTIONS',
  'AUDIT_LOGS',
  'COLLECTION_TASKS',
  'RESCHEDULE_REQUESTS',
  'CLOSING_PERIODS',
] as const;

type BackupKey = (typeof BACKUP_KEY_NAMES)[number];

type BackupFile = {
  app: 'almuttahida-saas';
  version: number;
  exportedAt: string;
  dataMode: 'api' | 'local';
  data: Record<BackupKey, string | null>;
};

const tableExportQueries: Record<Exclude<BackupKey, never>, string> = {
  USERS: 'SELECT id, name, username, password_hash, role, is_active, phone, permissions, created_at FROM users',
  CUSTOMERS: 'SELECT * FROM customers',
  SUPPLIERS: 'SELECT * FROM suppliers',
  PRODUCTS: 'SELECT * FROM products',
  SALES: 'SELECT * FROM sales',
  PURCHASES: 'SELECT * FROM purchases',
  PAYMENTS: 'SELECT * FROM payments',
  EXPENSES: 'SELECT * FROM expenses',
  SETTINGS: 'SELECT TOP 1 * FROM settings',
  NOTIFICATIONS: 'SELECT * FROM notifications',
  SALES_REPS: 'SELECT * FROM sales_reps',
  SHAREHOLDERS: 'SELECT * FROM shareholders',
  SHAREHOLDER_TRANSACTIONS: 'SELECT * FROM shareholder_transactions',
  AUDIT_LOGS: 'SELECT * FROM audit_log',
  COLLECTION_TASKS: 'SELECT * FROM collection_tasks',
  RESCHEDULE_REQUESTS: 'SELECT * FROM reschedule_requests',
  CLOSING_PERIODS: 'SELECT * FROM closing_periods',
};

function safeStringify(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}
function normalizeSqlValue(value: any) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value);
}

const KEY_ALIASES: Record<string, string> = {
  customerNumber: 'customer_number',
  balanceType: 'balance_type',
  dateOfBirth: 'date_of_birth',
  nationalId: 'national_id',
  pensionDate: 'pension_date',
  isSued: 'is_sued',
  suedDate: 'sued_date',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  supplierId: 'supplier_id',
  supplierName: 'supplier_name',
  productId: 'product_id',
  productName: 'product_name',
  unitPrice: 'unit_price',
  unitCost: 'unit_cost',
  saleId: 'sale_id',
  purchaseId: 'purchase_id',
  installmentId: 'installment_id',
  monthIndex: 'month_index',
  dueDate: 'due_date',
  paidAmount: 'paid_amount',
  paidAt: 'paid_at',
  invoiceNumber: 'invoice_number',
  referenceId: 'reference_id',
  referenceType: 'reference_type',
  affectsCustomerBalance: 'affects_customer_balance',
  customerId: 'customer_id',
  companyName: 'company_name',
  companyAddress: 'company_address',
  companyPhone: 'company_phone',
  companyEmail: 'company_email',
  taxRate: 'tax_rate',
  invoicePrefix: 'invoice_prefix',
  invoiceFooter: 'invoice_footer',
  isRead: 'is_read',
  salesRepId: 'sales_rep_id',
  salesRepName: 'sales_rep_name',
  sharePercentage: 'share_percentage',
  managementFeePercentage: 'management_fee_percentage',
  currentBalance: 'current_balance',
  shareholderId: 'shareholder_id',
  shareholderName: 'shareholder_name',
  periodType: 'period_type',
  periodDate: 'period_date',
  closedBy: 'closed_by',
  closedAt: 'closed_at',
  requestedBy: 'requested_by',
  requestedAt: 'requested_at',
  reviewedBy: 'reviewed_by',
  reviewedAt: 'reviewed_at',
};

function normalizeBackupRow(row: any) {
  const normalized: Record<string, any> = {};
  for (const [key, value] of Object.entries(row || {})) {
    if (key === 'items' || key === 'financing') continue;
    const normalizedKey = KEY_ALIASES[key] || key.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`);
    normalized[normalizedKey] = value;
  }
  return normalized;
}

async function exportBackup(): Promise<BackupFile> {
  const db = await dbPromise;
  const data = {} as Record<string, string | null>;

  for (const key of BACKUP_KEY_NAMES) {
    const rows = await db.all(tableExportQueries[key as keyof typeof tableExportQueries]);
    data[key] = JSON.stringify(rows);
  }

  return {
    app: 'almuttahida-saas',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    dataMode: 'api',
    data,
  };
}

function parseRows<T = any>(payload: BackupFile['data'][BackupKey]): T[] {
  if (!payload) return [];
  const parsed = JSON.parse(payload);
  return Array.isArray(parsed) ? parsed : [];
}

async function getTableColumns(trx: any, table: string): Promise<Set<string>> {
  const request = new sql.Request(trx);
  request.input('table', table);
  const result = await request.query('SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = @table');
  return new Set((result.recordset || []).map((row: any) => String(row.COLUMN_NAME)));
}

function filterRowColumns(row: Record<string, any>, allowedColumns: Set<string>) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => allowedColumns.has(key)));
}
async function replaceTable(trx: any, table: string, rows: any[]) {
  const request = new sql.Request(trx);
  await request.query(`DELETE FROM ${table}`);
  for (const row of rows) {
    const cols = Object.keys(row);
    if (!cols.length) continue;
    const placeholders = cols.map((_, index) => `@p${index + 1}`).join(', ');
    const insert = new sql.Request(trx);
    cols.forEach((col, index) => insert.input(`p${index + 1}`, row[col]));
    await insert.query(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`);
  }
}

router.get('/backup', async (_req, res) => {
  try {
    const backup = await exportBackup();
    return res.json(backup);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

router.post('/restore-backup', async (req: AuthedRequest, res) => {
  const payload = req.body as BackupFile;
  if (!payload || payload.app !== 'almuttahida-saas' || !payload.data) {
    return res.status(400).json({ message: 'Invalid backup file' });
  }

  const pool = await poolPromise;
  const trx: any = new (sql as any).Transaction(pool);

  let restoreStep = 'starting restore';

  try {
    await trx.begin();

    await new sql.Request(trx).query('DELETE FROM sale_items');
    await new sql.Request(trx).query('DELETE FROM installment_schedules');
    await new sql.Request(trx).query('DELETE FROM purchase_items');
    await new sql.Request(trx).query('DELETE FROM payments');
    await new sql.Request(trx).query('DELETE FROM expenses');
    await new sql.Request(trx).query('DELETE FROM notifications');
    await new sql.Request(trx).query('DELETE FROM sales_reps');
    await new sql.Request(trx).query('DELETE FROM shareholder_transactions');
    await new sql.Request(trx).query('DELETE FROM collection_tasks');
    await new sql.Request(trx).query('DELETE FROM audit_log');
    await new sql.Request(trx).query('DELETE FROM closing_periods');
    await new sql.Request(trx).query('DELETE FROM reschedule_requests');
    await new sql.Request(trx).query('DELETE FROM sales');
    await new sql.Request(trx).query('DELETE FROM purchases');
    await new sql.Request(trx).query('DELETE FROM customers');
    await new sql.Request(trx).query('DELETE FROM suppliers');
    await new sql.Request(trx).query('DELETE FROM products');
    await new sql.Request(trx).query('DELETE FROM shareholders');
    await new sql.Request(trx).query('DELETE FROM users');

    restoreStep = 'users';
    const users = parseRows<any>(payload.data.USERS).map((user) => ({
      id: user.id || uid(),
      name: user.name || 'User',
      username: user.username || `user_${uid().slice(0, 6)}`,
      password_hash: user.password_hash || '',
      role: user.role || 'staff',
      is_active: user.is_active === true || user.is_active === 1 ? 1 : 0,
      phone: user.phone || null,
      permissions: safeStringify(user.permissions) || null,
      created_at: user.created_at || user.createdAt || new Date().toISOString(),
    }));

    for (const user of users) {
      let passwordHash = user.password_hash;
      if (!passwordHash) {
        const plain = payload.data.USERS?.includes('"password"') ? 'admin123' : 'admin123';
        passwordHash = await hashPassword(plain);
      }
      const request = new sql.Request(trx);
      request.input('id', user.id);
      request.input('name', user.name);
      request.input('username', user.username);
      request.input('password_hash', passwordHash);
      request.input('role', user.role);
      request.input('is_active', user.is_active);
      request.input('phone', user.phone);
      request.input('permissions', user.permissions);
      request.input('created_at', user.created_at);
      await request.query(`INSERT INTO users (id, name, username, password_hash, role, is_active, phone, permissions, created_at)
        VALUES (@id, @name, @username, @password_hash, @role, @is_active, @phone, @permissions, @created_at)`);
    }

    restoreStep = 'settings';
    const settingsRows = parseRows<any>(payload.data.SETTINGS);
    if (settingsRows.length > 0) {
      const s = settingsRows[0];
      const request = new sql.Request(trx);
      request.input('company_name', s.company_name || s.companyName || '‘—ﬂ… «·„ Õœ…');
      request.input('company_address', s.company_address || s.companyAddress || '');
      request.input('company_phone', s.company_phone || s.companyPhone || '');
      request.input('company_email', s.company_email || s.companyEmail || '');
      request.input('tax_rate', Number(s.tax_rate ?? s.taxRate ?? 0));
      request.input('currency', s.currency || 'Ã‰ÌÂ');
      request.input('invoice_prefix', s.invoice_prefix || s.invoicePrefix || 'INV');
      request.input('invoice_footer', s.invoice_footer || s.invoiceFooter || null);
      await request.query(`INSERT INTO settings (company_name, company_address, company_phone, company_email, tax_rate, currency, invoice_prefix, invoice_footer)
        VALUES (@company_name, @company_address, @company_phone, @company_email, @tax_rate, @currency, @invoice_prefix, @invoice_footer)`);
    }

    const directTables: Array<[string, string, string?]> = [
      ['CUSTOMERS', 'customers'],
      ['SUPPLIERS', 'suppliers'],
      ['PRODUCTS', 'products'],
      ['PAYMENTS', 'payments'],
      ['EXPENSES', 'expenses'],
      ['NOTIFICATIONS', 'notifications'],
      ['SALES_REPS', 'sales_reps'],
      ['SHAREHOLDERS', 'shareholders'],
      ['SHAREHOLDER_TRANSACTIONS', 'shareholder_transactions'],
      ['AUDIT_LOGS', 'audit_log'],
      ['COLLECTION_TASKS', 'collection_tasks'],
      ['RESCHEDULE_REQUESTS', 'reschedule_requests'],
      ['CLOSING_PERIODS', 'closing_periods'],
    ];

    for (const [key, table] of directTables) {
      restoreStep = table;
      const allowedColumns = await getTableColumns(trx, table);
      const rows = parseRows<any>(payload.data[key as keyof BackupFile['data']]).map((row) => filterRowColumns(normalizeBackupRow(row), allowedColumns));
      for (const row of rows) {
        const columns = Object.keys(row);
        if (columns.length === 0) continue;
        const request = new sql.Request(trx);
        columns.forEach((column, index) => request.input(`p${index + 1}`, normalizeSqlValue(row[column])));
        const values = columns.map((_, index) => `@p${index + 1}`).join(', ');
        await request.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values})`);
      }
    }

    restoreStep = 'sales';
    const salesColumns = await getTableColumns(trx, 'sales');
    const sales = parseRows<any>(payload.data.SALES);
    for (const originalSale of sales) {
      const sale = filterRowColumns(normalizeBackupRow(originalSale), salesColumns);
      const saleRequest = new sql.Request(trx);
      const columns = Object.keys(sale);
      columns.forEach((column, index) => saleRequest.input(`p${index + 1}`, normalizeSqlValue(sale[column])));
      const values = columns.map((_, index) => `@p${index + 1}`).join(', ');
      await saleRequest.query(`INSERT INTO sales (${columns.join(', ')}) VALUES (${values})`);

      if (Array.isArray(originalSale.items)) {
        for (const item of originalSale.items) {
          const req = new sql.Request(trx);
          req.input('id', normalizeSqlValue(item.id || uid()));
          req.input('sale_id', normalizeSqlValue(sale.id));
          req.input('product_id', normalizeSqlValue(item.product_id || item.productId));
          req.input('product_name', normalizeSqlValue(item.product_name || item.productName));
          req.input('barcode', normalizeSqlValue(item.barcode || null));
          req.input('quantity', Number(item.quantity || 0));
          req.input('unit_price', Number(item.unit_price || item.unitPrice || 0));
          req.input('unit_cost', Number(item.unit_cost || item.unitCost || 0));
          req.input('discount', Number(item.discount || 0));
          req.input('tax', Number(item.tax || 0));
          req.input('total', Number(item.total || 0));
          await req.query(`INSERT INTO sale_items (id, sale_id, product_id, product_name, barcode, quantity, unit_price, unit_cost, discount, tax, total)
            VALUES (@id, @sale_id, @product_id, @product_name, @barcode, @quantity, @unit_price, @unit_cost, @discount, @tax, @total)`);
        }
      }

      const schedules = originalSale.financing?.schedules || [];
      for (const schedule of schedules) {
        const req = new sql.Request(trx);
        req.input('id', normalizeSqlValue(schedule.id || uid()));
        req.input('sale_id', normalizeSqlValue(sale.id));
        req.input('month_index', Number(schedule.month_index || schedule.monthIndex || 0));
        req.input('due_date', normalizeSqlValue(schedule.due_date || schedule.dueDate || sale.date));
        req.input('amount', Number(schedule.amount || 0));
        req.input('paid_amount', Number(schedule.paid_amount || schedule.paidAmount || 0));
        req.input('status', normalizeSqlValue(schedule.status || 'unpaid')); 
        req.input('paid_at', normalizeSqlValue(schedule.paid_at || schedule.paidAt || null));
        await req.query(`INSERT INTO installment_schedules (id, sale_id, month_index, due_date, amount, paid_amount, status, paid_at)
          VALUES (@id, @sale_id, @month_index, @due_date, @amount, @paid_amount, @status, @paid_at)`);
      }
    }

    restoreStep = 'purchases';
    const purchaseColumns = await getTableColumns(trx, 'purchases');
    const purchases = parseRows<any>(payload.data.PURCHASES);
    for (const originalPurchase of purchases) {
      const purchase = filterRowColumns(normalizeBackupRow(originalPurchase), purchaseColumns);
      const purchaseRequest = new sql.Request(trx);
      const columns = Object.keys(purchase);
      columns.forEach((column, index) => purchaseRequest.input(`p${index + 1}`, normalizeSqlValue(purchase[column])));
      const values = columns.map((_, index) => `@p${index + 1}`).join(', ');
      await purchaseRequest.query(`INSERT INTO purchases (${columns.join(', ')}) VALUES (${values})`);

      if (Array.isArray(originalPurchase.items)) {
        for (const item of originalPurchase.items) {
          const req = new sql.Request(trx);
          req.input('id', normalizeSqlValue(item.id || uid()));
          req.input('purchase_id', normalizeSqlValue(purchase.id));
          req.input('product_id', normalizeSqlValue(item.product_id || item.productId));
          req.input('product_name', normalizeSqlValue(item.product_name || item.productName));
          req.input('barcode', normalizeSqlValue(item.barcode || null));
          req.input('quantity', Number(item.quantity || 0));
          req.input('unit_price', Number(item.unit_price || item.unitPrice || 0));
          req.input('unit_cost', Number(item.unit_cost || item.unitCost || 0));
          req.input('discount', Number(item.discount || 0));
          req.input('tax', Number(item.tax || 0));
          req.input('total', Number(item.total || 0));
          await req.query(`INSERT INTO purchase_items (id, purchase_id, product_id, product_name, barcode, quantity, unit_price, unit_cost, discount, tax, total)
            VALUES (@id, @purchase_id, @product_id, @product_name, @barcode, @quantity, @unit_price, @unit_cost, @discount, @tax, @total)`);
        }
      }
    }

    await trx.commit();
    await audit('backup.restore', 'database', 'global', req.user?.name || 'system', { version: payload.version, exportedAt: payload.exportedAt });
    return res.json({ message: 'Backup restored successfully' });
  } catch (error: any) {
    try {
      await trx.rollback();
    } catch {}
    return res.status(500).json({ message: (error.message || 'Database error') + ' (restore step: ' + restoreStep + ')' });
  }
});

export default router;



