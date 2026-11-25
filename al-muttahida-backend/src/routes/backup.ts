import { Router } from 'express';
import { z } from 'zod';
import sql from 'mssql';
import { dbPromise, poolPromise } from '../db.js';
import { requireAdmin, requireAuth, requirePermission, type AuthedRequest } from '../middleware/auth.js';
import { extractApiPermissions, setRolePermissions, setUserAuthSnapshot } from '../permissions.js';
import { broadcastDataChange } from '../realtime.js';
import type { UserRole } from '../types.js';
import { audit } from '../audit.js';
import { hashPassword, uid } from '../utils.js';
import { getAutoBackupConfig, updateAutoBackupConfig, performAutoBackup } from '../autoBackupService.js';

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
  'COLLECTION_TASKS_ARCHIVE',
  'PAYMENTS_ARCHIVE',
  'RESCHEDULE_REQUESTS',
  'CLOSING_PERIODS',
  'DOCUMENT_TEMPLATES',
  'SALE_GUARANTORS',
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
  COLLECTION_TASKS_ARCHIVE: 'SELECT * FROM collection_tasks_archive',
  PAYMENTS_ARCHIVE: 'SELECT * FROM payments_archive',
  RESCHEDULE_REQUESTS: 'SELECT * FROM reschedule_requests',
  CLOSING_PERIODS: 'SELECT * FROM closing_periods',
  DOCUMENT_TEMPLATES: 'SELECT * FROM document_templates',
  SALE_GUARANTORS: 'SELECT * FROM sale_guarantors',
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
  includeWarehouseProfit: 'include_warehouse_profit',
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

function toIsoDate(rawDate: unknown): string {
  if (typeof rawDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(rawDate.trim())) {
    return rawDate.trim().slice(0, 10);
  }
  const parsed = rawDate ? new Date(String(rawDate)) : new Date();
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, '0');
  const d = String(parsed.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addMonthsToIso(dateStr: string, monthsToAdd: number): string {
  const base = toIsoDate(dateStr);
  const [y, m, d] = base.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m - 1) + monthsToAdd, d));
  return dt.toISOString().slice(0, 10);
}

/**
 * Reconstructs installment schedules for legacy backups that exported `sales` without `installment_schedules`.
 */
export function buildFallbackSchedulesForSale(sale: any) {
  const months = Math.trunc(Number(sale.installment_months || 0));
  if (sale.payment_method !== 'installment' || months <= 0) return [];

  const total = Number(sale.total || 0);
  const paid = Math.max(0, Number(sale.paid || 0));
  const upfront = Math.max(0, Number(sale.upfront_amount || 0));
  const financedTotal = Math.max(0, Math.round(total - upfront));
  if (financedTotal <= 0) return [];

  const startDate = toIsoDate(sale.installment_start_date || sale.date);
  const baseAmount = Math.round(financedTotal / months);
  let remainingToDistribute = financedTotal;
  let paidLeft = Math.max(0, Math.round(paid - upfront));
  const schedules: Array<Record<string, any>> = [];

  for (let index = 0; index < months; index++) {
    const amount = index === months - 1 ? remainingToDistribute : baseAmount;
    remainingToDistribute -= amount;

    const paidAmount = Math.min(amount, paidLeft);
    paidLeft -= paidAmount;

    const status = paidAmount >= amount ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid';
    schedules.push({
      id: uid(),
      month_index: index + 1,
      due_date: addMonthsToIso(startDate, index),
      amount,
      paid_amount: paidAmount,
      status,
      paid_at: status === 'paid' ? startDate : null,
    });
  }

  return schedules;
}

export async function exportBackup(): Promise<BackupFile> {
  const db = await dbPromise;
  const data = {} as Record<string, string | null>;

  const [saleItems, installmentSchedules, purchaseItems] = await Promise.all([
    db.all<any>('SELECT * FROM sale_items'),
    db.all<any>('SELECT * FROM installment_schedules ORDER BY month_index ASC'),
    db.all<any>('SELECT * FROM purchase_items'),
  ]);

  const saleItemsBySaleId = new Map<string, any[]>();
  for (const item of saleItems) {
    const list = saleItemsBySaleId.get(item.sale_id) || [];
    list.push(item);
    saleItemsBySaleId.set(item.sale_id, list);
  }

  const schedulesBySaleId = new Map<string, any[]>();
  for (const sch of installmentSchedules) {
    const list = schedulesBySaleId.get(sch.sale_id) || [];
    list.push(sch);
    schedulesBySaleId.set(sch.sale_id, list);
  }

  const purchaseItemsByPurchaseId = new Map<string, any[]>();
  for (const item of purchaseItems) {
    const list = purchaseItemsByPurchaseId.get(item.purchase_id) || [];
    list.push(item);
    purchaseItemsByPurchaseId.set(item.purchase_id, list);
  }

  for (const key of BACKUP_KEY_NAMES) {
    let rows = await db.all<any>(tableExportQueries[key as keyof typeof tableExportQueries]);
    if (key === 'SALES') {
      rows = rows.map((sale) => ({
        ...sale,
        items: saleItemsBySaleId.get(sale.id) || [],
        financing: {
          paymentMethod: sale.payment_method,
          installmentMonths: sale.installment_months,
          installmentStartDate: sale.installment_start_date,
          upfrontAmount: sale.upfront_amount,
          monthlyInstallmentAmount: sale.monthly_installment_amount,
          schedules: schedulesBySaleId.get(sale.id) || [],
        },
      }));
    } else if (key === 'PURCHASES') {
      rows = rows.map((purchase) => ({
        ...purchase,
        items: purchaseItemsByPurchaseId.get(purchase.id) || [],
      }));
    }
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

async function insertFilteredRow(
  trx: any,
  table: string,
  row: Record<string, any>,
  allowedColumns: Set<string>,
): Promise<boolean> {
  const filtered = filterRowColumns(row, allowedColumns);
  const columns = Object.keys(filtered);
  if (columns.length === 0) return false;
  const request = new sql.Request(trx);
  columns.forEach((column, index) => request.input(`p${index + 1}`, normalizeSqlValue(filtered[column])));
  const values = columns.map((_, index) => `@p${index + 1}`).join(', ');
  await request.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values})`);
  return true;
}

async function ensureSettingsBackupColumns(db: any) {
  await db.run(`
    IF COL_LENGTH('settings', 'starting_cash_balance') IS NULL
      ALTER TABLE settings ADD starting_cash_balance DECIMAL(18,2) NOT NULL DEFAULT 0;
    IF COL_LENGTH('settings', 'starting_receivables') IS NULL
      ALTER TABLE settings ADD starting_receivables DECIMAL(18,2) NOT NULL DEFAULT 0;
    IF COL_LENGTH('settings', 'starting_payables') IS NULL
      ALTER TABLE settings ADD starting_payables DECIMAL(18,2) NOT NULL DEFAULT 0;
    IF COL_LENGTH('settings', 'starting_inventory_value') IS NULL
      ALTER TABLE settings ADD starting_inventory_value DECIMAL(18,2) NOT NULL DEFAULT 0;
    IF COL_LENGTH('settings', 'whatsapp_config_json') IS NULL
      ALTER TABLE settings ADD whatsapp_config_json NVARCHAR(MAX) NULL;
    IF COL_LENGTH('settings', 'role_permissions_json') IS NULL
      ALTER TABLE settings ADD role_permissions_json NVARCHAR(MAX) NULL;
    IF COL_LENGTH('settings', 'payment_channels_json') IS NULL
      ALTER TABLE settings ADD payment_channels_json NVARCHAR(MAX) NULL;
    IF COL_LENGTH('settings', 'telegram_config_json') IS NULL
      ALTER TABLE settings ADD telegram_config_json NVARCHAR(MAX) NULL;
    IF COL_LENGTH('notifications', 'telegram_sent') IS NULL
      ALTER TABLE notifications ADD telegram_sent BIT NOT NULL DEFAULT 1;
    IF COL_LENGTH('shareholders', 'include_warehouse_profit') IS NULL
      ALTER TABLE shareholders ADD include_warehouse_profit BIT NOT NULL DEFAULT 0;
    IF COL_LENGTH('shareholders', 'payout_preference') IS NULL
      ALTER TABLE shareholders ADD payout_preference NVARCHAR(20) NOT NULL DEFAULT 'capitalize';
    IF COL_LENGTH('shareholders', 'payout_cycle_months') IS NULL
      ALTER TABLE shareholders ADD payout_cycle_months INT NOT NULL DEFAULT 3;
    IF COL_LENGTH('shareholders', 'payout_notice_days') IS NULL
      ALTER TABLE shareholders ADD payout_notice_days INT NOT NULL DEFAULT 15;
    IF COL_LENGTH('shareholders', 'next_payout_date') IS NULL
      ALTER TABLE shareholders ADD next_payout_date NVARCHAR(40) NULL;
    IF COL_LENGTH('reschedule_requests', 'paid_before_reschedule') IS NULL
      ALTER TABLE reschedule_requests ADD paid_before_reschedule DECIMAL(18,2) NOT NULL DEFAULT 0;
    IF COL_LENGTH('reschedule_requests', 'extra_interest_amount') IS NULL
      ALTER TABLE reschedule_requests ADD extra_interest_amount DECIMAL(18,2) NOT NULL DEFAULT 0;
  `);
}

export function generateSqlBackup(backup: BackupFile): string {
  const lines: string[] = [
    '-- ============================================================',
    '-- Al-Muttahida ERP Database Backup (SQL Dump)',
    '-- شركة المتحدة للتجارة والتوزيع - نسخة احتياطية لقاعدة البيانات',
    '-- Exported At (ISO): ' + backup.exportedAt,
    '-- App: ' + backup.app,
    '-- Version: ' + backup.version,
    '-- ============================================================',
    '',
    'SET NOCOUNT ON;',
    'SET XACT_ABORT ON;',
    'BEGIN TRANSACTION;',
    '',
  ];

  const tableMap: Record<string, string> = {
    USERS: 'users',
    CUSTOMERS: 'customers',
    SUPPLIERS: 'suppliers',
    PRODUCTS: 'products',
    SALES: 'sales',
    PURCHASES: 'purchases',
    PAYMENTS: 'payments',
    EXPENSES: 'expenses',
    SETTINGS: 'settings',
    NOTIFICATIONS: 'notifications',
    SALES_REPS: 'sales_reps',
    SHAREHOLDERS: 'shareholders',
    SHAREHOLDER_TRANSACTIONS: 'shareholder_transactions',
    AUDIT_LOGS: 'audit_log',
    COLLECTION_TASKS: 'collection_tasks',
    COLLECTION_TASKS_ARCHIVE: 'collection_tasks_archive',
    PAYMENTS_ARCHIVE: 'payments_archive',
    RESCHEDULE_REQUESTS: 'reschedule_requests',
    CLOSING_PERIODS: 'closing_periods',
    DOCUMENT_TEMPLATES: 'document_templates',
    SALE_GUARANTORS: 'sale_guarantors',
  };

  for (const [key, rawRows] of Object.entries(backup.data || {})) {
    const tableName = tableMap[key] || key.toLowerCase();
    lines.push('-- ------------------------------------------------------------');
    lines.push('-- Table: ' + tableName + ' (' + key + ')');
    lines.push('-- ------------------------------------------------------------');

    if (!rawRows) {
      lines.push('-- No data recorded for ' + tableName);
      lines.push('');
      continue;
    }

    let rows: any[] = [];
    try {
      rows = JSON.parse(rawRows);
      if (!Array.isArray(rows)) rows = [rows];
    } catch (_) {
      rows = [];
    }

    if (rows.length === 0) {
      lines.push('-- 0 rows recorded for ' + tableName);
      lines.push('');
      continue;
    }

    lines.push('-- ' + rows.length + ' rows recorded');
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const cols = Object.keys(row).filter((col) => {
        if (tableName === 'sales' && (col === 'items' || col === 'financing')) return false;
        if (tableName === 'purchases' && col === 'items') return false;
        return true;
      });
      if (cols.length === 0) continue;

      const colNames = cols.join(', ');
      const valStrings = cols
        .map((col) => {
          const val = row[col];
          if (val === null || val === undefined) return 'NULL';
          if (typeof val === 'number') return String(val);
          if (typeof val === 'boolean') return val ? '1' : '0';
          if (typeof val === 'object') {
            return "N'" + JSON.stringify(val).replace(/'/g, "''") + "'";
          }
          return "N'" + String(val).replace(/'/g, "''") + "'";
        })
        .join(', ');

      lines.push('INSERT INTO ' + tableName + ' (' + colNames + ') VALUES (' + valStrings + ');');
    }
    lines.push('');
  }

  lines.push('COMMIT TRANSACTION;');
  lines.push('');
  lines.push('/* AL_MUTTAHIDA_SQL_BACKUP_PAYLOAD_START');
  lines.push(JSON.stringify(backup));
  lines.push('AL_MUTTAHIDA_SQL_BACKUP_PAYLOAD_END */');
  lines.push('');

  return lines.join('\n');
}


router.get('/backup', async (_req, res) => {
  try {
    const backup = await exportBackup();
    return res.json(backup);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

router.get('/backup.sql', async (_req, res) => {
  try {
    const backup = await exportBackup();
    const sqlContent = generateSqlBackup(backup);
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/sql; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="almuttahida-backup-' + date + '.sql"');
    return res.send(sqlContent);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});


// Auto Backup Endpoints
router.get('/auto-backup', async (_req, res) => {
  try {
    const config = getAutoBackupConfig();
    return res.json(config);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Error fetching auto-backup config' });
  }
});

const autoBackupUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  destinationPath: z.string().max(500).optional(),
  frequency: z.enum(['daily', 'hourly', 'twice_daily']).optional(),
  backupTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  retentionDays: z.number().int().min(1).max(365).optional(),
});

router.put('/auto-backup', async (req: AuthedRequest, res) => {
  const parsed = autoBackupUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'بيانات النسخ الاحتياطي التلقائي غير صالحة', errors: parsed.error.format() });
  }
  try {
    const updated = updateAutoBackupConfig(parsed.data);
    await audit('settings.auto_backup.update', 'settings', 'auto-backup', req.user?.name || 'system', { config: updated });
    return res.json({ message: 'تم حفظ إعدادات النسخ الاحتياطي التلقائي بنجاح', config: updated });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Error updating auto-backup config' });
  }
});

router.post('/auto-backup/run', async (req: AuthedRequest, res) => {
  try {
    const result = await performAutoBackup('Manual user trigger');
    if (result.success) {
      await audit('settings.auto_backup.run', 'settings', 'auto-backup', req.user?.name || 'system', { fileName: result.fileName, filePath: result.filePath });
      return res.json({ message: 'تم إنشاء النسخة الاحتياطية بنجاح وحفظها في المجلد المحدد', ...result });
    } else {
      return res.status(500).json({ message: result.error || 'فشل إنشاء النسخة الاحتياطية' });
    }
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Error executing auto backup' });
  }
});

export async function restoreBackupInTransaction(
  trx: any,
  payload: BackupFile,
  onStep?: (step: string) => void,
): Promise<{ restoredCounts: Record<string, number> }> {
  const step = (name: string) => {
    onStep?.(name);
  };
  const restoredCounts: Record<string, number> = {};

  step('validating users');
  const validRoles = new Set(['admin', 'manager', 'accountant', 'user', 'collector', 'reviewer', 'finance_manager']);
  const rawUsers = parseRows<any>(payload.data.USERS);
  if (rawUsers.length === 0) {
    throw new Error('ملف النسخة الاحتياطية لا يحتوي على أي مستخدمين — تم إلغاء الاستعادة لحماية النظام.');
  }

  const users = rawUsers.map((user) => ({
    id: user.id || uid(),
    name: user.name || 'User',
    username: user.username || `user_${uid().slice(0, 6)}`,
    password_hash: user.password_hash || '',
    raw_password: typeof user.password === 'string' ? user.password : '',
    role: validRoles.has(user.role) ? user.role : 'user',
    is_active: user.is_active === true || user.is_active === 1 || user.isActive === true ? 1 : 0,
    phone: user.phone || null,
    permissions:
      user.permissions == null
        ? null
        : typeof user.permissions === 'string'
          ? user.permissions
          : safeStringify(user.permissions),
    created_at: user.created_at || user.createdAt || new Date().toISOString(),
  }));

  step('clearing tables');
  await new sql.Request(trx).query('DELETE FROM sale_guarantors');
  await new sql.Request(trx).query('DELETE FROM sale_items');
  await new sql.Request(trx).query('DELETE FROM installment_schedules');
  await new sql.Request(trx).query('DELETE FROM purchase_items');
  await new sql.Request(trx).query('DELETE FROM payments');
  await new sql.Request(trx).query('DELETE FROM payments_archive');
  await new sql.Request(trx).query('DELETE FROM expenses');
  await new sql.Request(trx).query('DELETE FROM notifications');
  await new sql.Request(trx).query('DELETE FROM sales_reps');
  await new sql.Request(trx).query('DELETE FROM shareholder_transactions');
  await new sql.Request(trx).query('DELETE FROM collection_tasks');
  await new sql.Request(trx).query('DELETE FROM collection_tasks_archive');
  await new sql.Request(trx).query('DELETE FROM audit_log');
  await new sql.Request(trx).query('DELETE FROM closing_periods');
  await new sql.Request(trx).query('DELETE FROM reschedule_requests');
  await new sql.Request(trx).query('DELETE FROM document_templates');
  await new sql.Request(trx).query('DELETE FROM dashboard_metrics_cache');
  await new sql.Request(trx).query('DELETE FROM sales');
  await new sql.Request(trx).query('DELETE FROM purchases');
  await new sql.Request(trx).query('DELETE FROM customers');
  await new sql.Request(trx).query('DELETE FROM suppliers');
  await new sql.Request(trx).query('DELETE FROM products');
  await new sql.Request(trx).query('DELETE FROM shareholders');
  await new sql.Request(trx).query('DELETE FROM settings');
  await new sql.Request(trx).query('DELETE FROM users');

  step('users');
  restoredCounts.users = 0;
  for (const user of users) {
    let passwordHash = user.password_hash;
    if (!passwordHash) {
      const plain = user.raw_password.trim().length > 0 ? user.raw_password : 'admin123';
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
    restoredCounts.users += 1;
  }

  step('settings');
  restoredCounts.settings = 0;
  const settingsAllowedCols = await getTableColumns(trx, 'settings');
  const settingsRows = parseRows<any>(payload.data.SETTINGS).slice(0, 1);
  if (settingsRows.length > 0) {
    const normalizedSettings = normalizeBackupRow(settingsRows[0]);
    if (await insertFilteredRow(trx, 'settings', normalizedSettings, settingsAllowedCols)) {
      restoredCounts.settings += 1;
    }
  }

  const directTables: Array<[BackupKey, string]> = [
    ['CUSTOMERS', 'customers'],
    ['SUPPLIERS', 'suppliers'],
    ['PRODUCTS', 'products'],
    ['EXPENSES', 'expenses'],
    ['NOTIFICATIONS', 'notifications'],
    ['SALES_REPS', 'sales_reps'],
    ['SHAREHOLDERS', 'shareholders'],
    ['SHAREHOLDER_TRANSACTIONS', 'shareholder_transactions'],
    ['AUDIT_LOGS', 'audit_log'],
    ['COLLECTION_TASKS', 'collection_tasks'],
    ['COLLECTION_TASKS_ARCHIVE', 'collection_tasks_archive'],
    ['PAYMENTS_ARCHIVE', 'payments_archive'],
    ['RESCHEDULE_REQUESTS', 'reschedule_requests'],
    ['CLOSING_PERIODS', 'closing_periods'],
    ['DOCUMENT_TEMPLATES', 'document_templates'],
  ];

  for (const [key, table] of directTables) {
    step(table);
    restoredCounts[table] = 0;
    const allowedColumns = await getTableColumns(trx, table);
    const rows = parseRows<any>(payload.data[key]);
    for (const rawRow of rows) {
      const normalized = normalizeBackupRow(rawRow);
      if (await insertFilteredRow(trx, table, normalized, allowedColumns)) {
        restoredCounts[table] += 1;
      }
    }
  }

  step('sales');
  restoredCounts.sales = 0;
  restoredCounts.sale_items = 0;
  restoredCounts.installment_schedules = 0;
  const salesColumns = await getTableColumns(trx, 'sales');
  const saleItemColumns = await getTableColumns(trx, 'sale_items');
  const scheduleColumns = await getTableColumns(trx, 'installment_schedules');
  const sales = parseRows<any>(payload.data.SALES);
  for (const originalSale of sales) {
    const sale = filterRowColumns(normalizeBackupRow(originalSale), salesColumns);
    if (await insertFilteredRow(trx, 'sales', sale, salesColumns)) {
      restoredCounts.sales += 1;
    }

    if (Array.isArray(originalSale.items)) {
      step('sale_items');
      for (const item of originalSale.items) {
        const normalizedItem = normalizeBackupRow({
          ...item,
          id: item.id || uid(),
          sale_id: sale.id,
          product_id: item.product_id || item.productId || '',
          product_name: item.product_name || item.productName || '',
          barcode: item.barcode ?? null,
          quantity: Number(item.quantity || 0),
          unit_price: Number(item.unit_price ?? item.unitPrice ?? 0),
          unit_cost: Number(item.unit_cost ?? item.unitCost ?? 0),
          discount: Number(item.discount || 0),
          tax: Number(item.tax || 0),
          total: Number(item.total || 0),
          fulfillment_type: item.fulfillment_type ?? item.fulfillmentType ?? 'on_demand',
        });
        if (await insertFilteredRow(trx, 'sale_items', normalizedItem, saleItemColumns)) {
          restoredCounts.sale_items += 1;
        }
      }
    }

    const rawSchedules = originalSale.financing?.schedules || [];
    const schedules = rawSchedules.length > 0 ? rawSchedules : buildFallbackSchedulesForSale(sale);
    if (schedules.length > 0) {
      step('installment_schedules');
      for (const schedule of schedules) {
        const normalizedSchedule = normalizeBackupRow({
          ...schedule,
          id: schedule.id || uid(),
          sale_id: sale.id,
          month_index: Number(schedule.month_index ?? schedule.monthIndex ?? 0),
          due_date: schedule.due_date ?? schedule.dueDate ?? sale.date,
          amount: Number(schedule.amount || 0),
          paid_amount: Number(schedule.paid_amount ?? schedule.paidAmount ?? 0),
          status: schedule.status || 'unpaid',
          paid_at: schedule.paid_at ?? schedule.paidAt ?? null,
          deferred: schedule.deferred === true || schedule.deferred === 1 ? 1 : 0,
          deferred_at: schedule.deferred_at ?? schedule.deferredAt ?? null,
          notes: schedule.notes ?? null,
        });
        if (await insertFilteredRow(trx, 'installment_schedules', normalizedSchedule, scheduleColumns)) {
          restoredCounts.installment_schedules += 1;
        }
      }
    }
  }

  step('sale_guarantors');
  restoredCounts.sale_guarantors = 0;
  const saleGuarantorColumns = await getTableColumns(trx, 'sale_guarantors');
  const rawSaleGuarantors = parseRows<any>(payload.data.SALE_GUARANTORS);
  for (const rawGuarantor of rawSaleGuarantors) {
    const normalized = normalizeBackupRow(rawGuarantor);
    if (await insertFilteredRow(trx, 'sale_guarantors', normalized, saleGuarantorColumns)) {
      restoredCounts.sale_guarantors += 1;
    }
  }

  step('purchases');
  restoredCounts.purchases = 0;
  restoredCounts.purchase_items = 0;
  const purchaseColumns = await getTableColumns(trx, 'purchases');
  const purchaseItemColumns = await getTableColumns(trx, 'purchase_items');
  const purchases = parseRows<any>(payload.data.PURCHASES);
  for (const originalPurchase of purchases) {
    const purchase = filterRowColumns(normalizeBackupRow(originalPurchase), purchaseColumns);
    if (await insertFilteredRow(trx, 'purchases', purchase, purchaseColumns)) {
      restoredCounts.purchases += 1;
    }

    if (Array.isArray(originalPurchase.items)) {
      step('purchase_items');
      for (const item of originalPurchase.items) {
        const normalizedItem = normalizeBackupRow({
          ...item,
          id: item.id || uid(),
          purchase_id: purchase.id,
          product_id: item.product_id || item.productId || '',
          product_name: item.product_name || item.productName || '',
          barcode: item.barcode ?? null,
          quantity: Number(item.quantity || 0),
          unit_price: Number(item.unit_price ?? item.unitPrice ?? 0),
          discount: Number(item.discount || 0),
          tax: Number(item.tax || 0),
          total: Number(item.total || 0),
        });
        if (await insertFilteredRow(trx, 'purchase_items', normalizedItem, purchaseItemColumns)) {
          restoredCounts.purchase_items += 1;
        }
      }
    }
  }

  // Insert payments after sales & customers to satisfy FK_payments_sales and FK_payments_customers
  step('payments');
  restoredCounts.payments = 0;
  const paymentColumns = await getTableColumns(trx, 'payments');
  const paymentRows = parseRows<any>(payload.data.PAYMENTS);
  for (const rawRow of paymentRows) {
    const normalized = normalizeBackupRow(rawRow);
    for (const nullableCol of ['sale_id', 'customer_id', 'supplier_id', 'installment_id']) {
      if (normalized[nullableCol] === '') {
        normalized[nullableCol] = null;
      }
    }
    if (await insertFilteredRow(trx, 'payments', normalized, paymentColumns)) {
      restoredCounts.payments += 1;
    }
  }

  return { restoredCounts };
}

router.post('/restore-backup', requireAdmin, async (req: AuthedRequest, res) => {
  let payload = req.body as BackupFile;

  // Handle raw SQL backup or JSON string if sent directly
  if (typeof req.body === 'string' || (req.body && typeof req.body.sql === 'string')) {
    const rawSql = typeof req.body === 'string' ? req.body : req.body.sql;
    const trimmed = rawSql.trim();
    if (trimmed.startsWith('{')) {
      try {
        payload = JSON.parse(trimmed);
      } catch (_) {}
    } else {
      const match = rawSql.match(/\/\*\s*AL_MUTTAHIDA_SQL_BACKUP_PAYLOAD_START\s*([\s\S]*?)\s*AL_MUTTAHIDA_SQL_BACKUP_PAYLOAD_END\s*\*\//);
      if (match && match[1]) {
        try {
          payload = JSON.parse(match[1].trim());
        } catch (_) {}
      }
    }
  }

  if (!payload || payload.app !== 'almuttahida-saas' || !payload.data) {
    return res.status(400).json({ message: 'Invalid backup file' });
  }

  let precheckUsers: any[] = [];
  try {
    precheckUsers = parseRows<any>(payload.data.USERS);
  } catch {
    return res.status(400).json({ message: 'بيانات المستخدمين في النسخة الاحتياطية غير صالحة' });
  }
  if (precheckUsers.length === 0) {
    return res.status(400).json({ message: 'ملف النسخة الاحتياطية لا يحتوي على أي مستخدمين — تم إلغاء الاستعادة لحماية النظام.' });
  }

  const db = await dbPromise;
  await ensureSettingsBackupColumns(db);

  const pool = await poolPromise;
  const trx: any = new (sql as any).Transaction(pool);

  let restoreStep = 'starting restore';

  try {
    await trx.begin();
    const { restoredCounts } = await restoreBackupInTransaction(trx, payload, (step) => {
      restoreStep = step;
    });
    await trx.commit();

    try {
      await db.run('EXEC sp_refresh_dashboard_metrics');
    } catch {
      // Ignore post-restore dashboard cache refresh errors
    }

    try {
      const col = await db.get<any>(`SELECT COL_LENGTH('settings', 'role_permissions_json') AS len`);
      if (col?.len) {
        const settingsRow = await db.get<{ role_permissions_json?: string | null }>('SELECT TOP 1 role_permissions_json FROM settings');
        setRolePermissions(settingsRow?.role_permissions_json ? JSON.parse(settingsRow.role_permissions_json) : null);
      } else {
        setRolePermissions(null);
      }
      const restoredUsers = await db.all<{
        id: string;
        name: string;
        role: UserRole;
        is_active: number | boolean;
        permissions: string | null;
      }>('SELECT id, name, role, is_active, permissions FROM users');
      setUserAuthSnapshot(
        restoredUsers.map((u) => ({
          id: u.id,
          name: u.name,
          role: u.role,
          isActive: u.is_active === 1 || u.is_active === true,
          permissions: u.role === 'admin' ? undefined : extractApiPermissions(u.permissions),
        }))
      );
    } catch {
      // Ignore post-restore snapshot refresh errors
    }

    for (const topic of [
      'settings',
      'users',
      'customers',
      'suppliers',
      'products',
      'sales',
      'payments',
      'expenses',
      'shareholders',
      'sales-reps',
      'notifications',
    ]) {
      broadcastDataChange(topic, 'restore');
    }

    await audit('backup.restore', 'database', 'global', req.user?.name || 'system', {
      version: payload.version,
      exportedAt: payload.exportedAt,
      restoredCounts,
    });
    return res.json({ message: 'Backup restored successfully', restoredCounts });
  } catch (error: any) {
    try {
      await trx.rollback();
    } catch {}
    return res.status(500).json({ message: (error.message || 'Database error') + ' (restore step: ' + restoreStep + ')' });
  }
});

export default router;



