import { api, isApiMode } from '../apiClient';
import { DB_KEYS } from './core';
import { syncCustomers } from './customers';
import { syncSuppliers } from './suppliers';
import { syncProducts } from './products';
import { syncSales } from './sales';
import { syncPurchases } from './purchases';
import { syncPayments } from './payments';
import { syncExpenses } from './expenses';
import { syncNotifications } from './notifications';
import { syncSalesReps } from './salesReps';
import { syncShareholders, syncShareholderTransactions } from './shareholders';
import { syncClosingPeriods } from './operations';

const BACKUP_VERSION = 2;
const BACKUP_KEY_NAMES = Object.entries(DB_KEYS).filter(([name]) => name !== 'AUTH');

export interface DatabaseBackupFile {
  app: 'almuttahida-saas';
  version: number;
  exportedAt: string;
  dataMode: 'api' | 'local';
  data: Record<string, string | null>;
}

async function syncBackupCache(): Promise<void> {
  if (!isApiMode()) return;

  await Promise.allSettled([
    syncCustomers(),
    syncSuppliers(),
    syncProducts(),
    syncSales(),
    syncPurchases(),
    syncPayments(),
    syncExpenses(),
    syncNotifications(),
    syncSalesReps(),
    syncShareholders(),
    syncShareholderTransactions(),
    syncClosingPeriods(),
  ]);
}

export async function createDatabaseBackup(): Promise<DatabaseBackupFile> {
  if (isApiMode()) {
    try {
      const serverBackup = await api.exportBackup();
      if (serverBackup && serverBackup.data) {
        return serverBackup;
      }
    } catch (e) {
      console.warn('API backup export failed, falling back to cached local storage:', e);
    }
  }

  await syncBackupCache();

  return {
    app: 'almuttahida-saas',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    dataMode: isApiMode() ? 'api' : 'local',
    data: Object.fromEntries(BACKUP_KEY_NAMES.map(([name, key]) => [name, localStorage.getItem(key)])),
  };
}

export function generateSqlBackup(backup: DatabaseBackupFile): string {
  const lines: string[] = [
    '-- ============================================================',
    '-- Al-Muttahida ERP Database Backup (SQL Dump)',
    '-- شركة المتحدة للتجارة والتوزيع - نسخة احتياطية لقاعدة البيانات',
    `-- تاريخ التصدير: ${new Date().toLocaleString('ar-EG')}`,
    `-- Exported At (ISO): ${backup.exportedAt}`,
    `-- App: ${backup.app}`,
    `-- Version: ${backup.version}`,
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
    RESCHEDULE_REQUESTS: 'reschedule_requests',
    CLOSING_PERIODS: 'closing_periods',
  };

  for (const [key, rawRows] of Object.entries(backup.data || {})) {
    const tableName = tableMap[key] || key.toLowerCase();
    lines.push(`-- ------------------------------------------------------------`);
    lines.push(`-- Table: ${tableName} (${key})`);
    lines.push(`-- ------------------------------------------------------------`);

    if (!rawRows) {
      lines.push(`-- No data recorded for ${tableName}`);
      lines.push('');
      continue;
    }

    let rows: any[] = [];
    try {
      rows = JSON.parse(rawRows);
      if (!Array.isArray(rows)) {
        rows = [rows];
      }
    } catch (_) {
      rows = [];
    }

    if (rows.length === 0) {
      lines.push(`-- 0 rows recorded for ${tableName}`);
      lines.push('');
      continue;
    }

    lines.push(`-- ${rows.length} rows recorded`);
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const cols = Object.keys(row);
      if (cols.length === 0) continue;

      const colNames = cols.join(', ');
      const valStrings = cols
        .map((col) => {
          const val = row[col];
          if (val === null || val === undefined) return 'NULL';
          if (typeof val === 'number') return String(val);
          if (typeof val === 'boolean') return val ? '1' : '0';
          if (typeof val === 'object') {
            return `N'${JSON.stringify(val).replace(/'/g, "''")}'`;
          }
          return `N'${String(val).replace(/'/g, "''")}'`;
        })
        .join(', ');

      lines.push(`INSERT INTO ${tableName} (${colNames}) VALUES (${valStrings});`);
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

export async function downloadDatabaseBackup(): Promise<void> {
  const backup = await createDatabaseBackup();
  const sqlContent = generateSqlBackup(backup);
  const blob = new Blob([sqlContent], { type: 'application/sql;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);

  link.href = url;
  link.download = `almuttahida-backup-${date}.sql`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function restoreDatabaseBackup(fileContent: string): Promise<void> {
  let backup: DatabaseBackupFile | null = null;
  const trimmed = fileContent.trim();

  if (trimmed.startsWith('{')) {
    // Backward compatibility: JSON backup file
    try {
      backup = JSON.parse(trimmed) as DatabaseBackupFile;
    } catch (_) {
      throw new Error('الملف ليس بصيغة JSON صالحة.');
    }
  } else {
    // SQL Backup File (.sql)
    const payloadMatch = fileContent.match(/\/\*\s*AL_MUTTAHIDA_SQL_BACKUP_PAYLOAD_START\s*([\s\S]*?)\s*AL_MUTTAHIDA_SQL_BACKUP_PAYLOAD_END\s*\*\//);
    if (payloadMatch && payloadMatch[1]) {
      try {
        backup = JSON.parse(payloadMatch[1].trim()) as DatabaseBackupFile;
      } catch (_) {
        throw new Error('تعذر فك شفرة بيانات النسخة الاحتياطية داخل ملف SQL.');
      }
    } else {
      throw new Error('الملف المحدد ليس ملف نسخة احتياطية صالح لنظام المتحدة (.sql).');
    }
  }

  if (!backup || backup.app !== 'almuttahida-saas' || !backup.data || typeof backup.data !== 'object') {
    throw new Error('بيانات النسخة الاحتياطية غير صالحة أو لا تنتمي لنظام المتحدة.');
  }

  if (isApiMode()) {
    await api.restoreBackup(backup);
    return;
  }

  BACKUP_KEY_NAMES.forEach(([name, key]) => {
    if (!Object.prototype.hasOwnProperty.call(backup!.data, name)) return;

    const value = backup!.data[name];
    if (value === null || value === undefined) return;

    if (typeof value !== 'string') {
      throw new Error('بيانات النسخة الاحتياطية غير صالحة.');
    }

    localStorage.setItem(key, value);
  });
}
