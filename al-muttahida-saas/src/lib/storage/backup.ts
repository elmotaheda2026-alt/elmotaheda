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
const FORCE_LOCAL_RESTORE_KEY = 'almuttahida_force_local_restore';
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
  await syncBackupCache();

  return {
    app: 'almuttahida-saas',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    dataMode: isApiMode() ? 'api' : 'local',
    data: Object.fromEntries(BACKUP_KEY_NAMES.map(([name, key]) => [name, localStorage.getItem(key)])),
  };
}

export async function downloadDatabaseBackup(): Promise<void> {
  const backup = await createDatabaseBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);

  link.href = url;
  link.download = `almuttahida-backup-${date}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function restoreDatabaseBackup(fileContent: string): Promise<void> {
  const backup = JSON.parse(fileContent) as DatabaseBackupFile;

  if (backup.app !== 'almuttahida-saas' || !backup.data || typeof backup.data !== 'object') {
    throw new Error('Invalid backup file');
  }

  if (isApiMode()) {
    await api.restoreBackup(backup);
    return;
  }

  BACKUP_KEY_NAMES.forEach(([name, key]) => {
    if (!Object.prototype.hasOwnProperty.call(backup.data, name)) return;

    const value = backup.data[name];
    if (value === null || value === undefined) return;

    if (typeof value !== 'string') {
      throw new Error('Invalid backup data');
    }

    localStorage.setItem(key, value);
  });


}