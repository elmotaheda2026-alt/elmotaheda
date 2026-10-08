import {
  AuditLogEntry,
  ClosingPeriod,
  Customer,
  Expense,
  InstallmentSchedule,
  Notification,
  Payment,
  Product,
  Purchase,
  RescheduleRequest,
  Sale,
  SalesRep,
  Setting,
  Supplier,
  User,
  InstallmentCollectionTask,
} from '../../types';
import { api, isApiMode } from '../apiClient';

export const DB_KEYS = {
  USERS: 'almuttahida_users',
  CUSTOMERS: 'almuttahida_customers',
  SUPPLIERS: 'almuttahida_suppliers',
  PRODUCTS: 'almuttahida_products',
  SALES: 'almuttahida_sales',
  PURCHASES: 'almuttahida_purchases',
  PAYMENTS: 'almuttahida_payments',
  EXPENSES: 'almuttahida_expenses',
  SETTINGS: 'almuttahida_settings',
  NOTIFICATIONS: 'almuttahida_notifications',
  SALES_REPS: 'almuttahida_sales_reps',
  AUTH: 'almuttahida_auth',
  INVOICE_COUNTER: 'almuttahida_invoice_counter',
  SHAREHOLDERS: 'almuttahida_shareholders',
  SHAREHOLDER_TRANSACTIONS: 'almuttahida_shareholder_transactions',
  AUDIT_LOGS: 'almuttahida_audit_logs',
  COLLECTION_TASKS: 'almuttahida_collection_tasks',
  RESCHEDULE_REQUESTS: 'almuttahida_reschedule_requests',
  CLOSING_PERIODS: 'almuttahida_closing_periods',
  RECEIPT_COUNTER: 'almuttahida_receipt_counter',
  OPENING_BALANCES: 'almuttahida_opening_balances',
};

const API_MEMORY_KEYS = new Set<string>([
  DB_KEYS.USERS,
  DB_KEYS.CUSTOMERS,
  DB_KEYS.SUPPLIERS,
  DB_KEYS.PRODUCTS,
  DB_KEYS.SALES,
  DB_KEYS.PURCHASES,
  DB_KEYS.PAYMENTS,
  DB_KEYS.EXPENSES,
  DB_KEYS.NOTIFICATIONS,
  DB_KEYS.SALES_REPS,
  DB_KEYS.SHAREHOLDERS,
  DB_KEYS.SHAREHOLDER_TRANSACTIONS,
  DB_KEYS.AUDIT_LOGS,
  DB_KEYS.COLLECTION_TASKS,
  DB_KEYS.RESCHEDULE_REQUESTS,
  DB_KEYS.CLOSING_PERIODS,
]);

const apiMemoryStore = new Map<string, unknown[]>();

function isApiMemoryKey(key: string): boolean {
  return isApiMode() && API_MEMORY_KEYS.has(key);
}

export function getStorage<T>(key: string): T[] {
  if (isApiMemoryKey(key)) {
    return [...(apiMemoryStore.get(key) || [])] as T[];
  }

  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    if (isApiMode()) {
      throw new Error(`Failed to read local cache for ${key}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return [];
  }
}

export function setStorage<T>(key: string, data: T[]): void {
  if (isApiMemoryKey(key)) {
    apiMemoryStore.set(key, [...data]);
    try {
      localStorage.removeItem(key);
    } catch {
      // Best-effort stale-cache cleanup only; API mode never reads this key from localStorage.
    }
    return;
  }

  localStorage.setItem(key, JSON.stringify(data));
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

export function createAuditLog(entry: Omit<AuditLogEntry, 'id' | 'createdAt'>): AuditLogEntry {
  const logs = getStorage<AuditLogEntry>(DB_KEYS.AUDIT_LOGS);
  const newEntry: AuditLogEntry = {
    ...entry,
    id: generateId(),
    createdAt: new Date().toISOString(),
  };
  logs.push(newEntry);
  setStorage(DB_KEYS.AUDIT_LOGS, logs);
  return newEntry;
}

export function getAuditLogs(): AuditLogEntry[] {
  return getStorage<AuditLogEntry>(DB_KEYS.AUDIT_LOGS);
}

export function getNextReceiptNumber(): string {
  const value = parseInt(localStorage.getItem(DB_KEYS.RECEIPT_COUNTER) || '5000', 10) + 1;
  localStorage.setItem(DB_KEYS.RECEIPT_COUNTER, String(value));
  return `RCPT-${value}`;
}

export const pad = (value: number) => String(value).padStart(2, '0');

export function addMonths(dateStr: string, months: number): string {
  // Parse date safely; handle ISO strings.
  const origDate = new Date(dateStr);
  if (isNaN(origDate.getTime())) {
    return dateStr;
  }
  const originalDay = origDate.getDate();
  // Add months
  const newDate = new Date(origDate);
  newDate.setMonth(newDate.getMonth() + months);
  // Adjust for month overflow: ensure day does not exceed last day of target month
  const daysInTargetMonth = new Date(newDate.getFullYear(), newDate.getMonth() + 1, 0).getDate();
  newDate.setDate(Math.min(originalDay, daysInTargetMonth));
  const year = newDate.getFullYear();
  const month = newDate.getMonth() + 1; // getMonth is zeroâ€‘based
  const day = newDate.getDate();
  return `${year}-${pad(month)}-${pad(day)}`;
}




export function buildInstallmentSchedule(startDate: string, amount: number, months: number): InstallmentSchedule[] {
  if (months <= 0 || amount <= 0) return [];

  const baseAmount = Number((amount / months).toFixed(2));
  let remaining = Number(amount.toFixed(2));

  return Array.from({ length: months }, (_, index): InstallmentSchedule => {
    const installmentAmount = index === months - 1 ? Number(remaining.toFixed(2)) : baseAmount;
    remaining = Number((remaining - installmentAmount).toFixed(2));

    return {
      id: generateId(),
      monthIndex: index + 1,
      label: `ط§ظ„ظ‚ط³ط· ${index + 1}`,
      dueDate: addMonths(startDate, index),
      amount: installmentAmount,
      paidAmount: 0,
      status: 'unpaid',
    };
  });
}

export function syncSalePaymentStatus(sale: Sale): Sale {
  const paid = Number((sale.paid || 0).toFixed(2));
  const remaining = Number(Math.max(sale.total - paid, 0).toFixed(2));
  sale.paid = paid;
  sale.remaining = remaining;
  sale.status = remaining <= 0 ? 'completed' : 'pending';
  return sale;
}

export function applyPaymentToSale(sale: Sale, payment: Payment): Sale {
  if (payment.isEarlySettlement) {
    const amt = Number(payment.amount || 0);
    const disc = Number(payment.settlementDiscount || 0);
    sale.paid = Number(((sale.paid || 0) + amt).toFixed(2));
    sale.discount = Number(((sale.discount || 0) + disc).toFixed(2));
    sale.remaining = 0;
    sale.status = 'settled_early';
    if (sale.financing?.schedules) {
      sale.financing.schedules = sale.financing.schedules.map((schedule) => ({
        ...schedule,
        status: (schedule.status === 'paid' ? 'paid' : 'settled_early') as InstallmentSchedule['status'],
        paidAt: schedule.status === 'paid' ? schedule.paidAt : payment.date,
      }));
    }
    return sale;
  }
  const amount = Number(payment.amount || 0);
  if (amount <= 0) return sale;

  sale.paid = Number(((sale.paid || 0) + amount).toFixed(2));

  if (sale.financing?.schedules?.length) {
    let remainingPayment = amount;
    const targetedIndex = payment.installmentId
      ? sale.financing.schedules.findIndex((schedule) => schedule.id === payment.installmentId)
      : -1;
    const orderedIndices = targetedIndex === -1
      ? sale.financing.schedules.map((_, index) => index)
      : [targetedIndex, ...sale.financing.schedules.map((_, index) => index).filter((index) => index !== targetedIndex)];
    const schedules = [...sale.financing.schedules];

    for (const index of orderedIndices) {
      const schedule = schedules[index];
      if (!schedule || remainingPayment <= 0) break;

      const scheduleRemaining = Number((schedule.amount - schedule.paidAmount).toFixed(2));
      if (scheduleRemaining <= 0) {
        schedules[index] = {
          ...schedule,
          status: 'paid' as InstallmentSchedule['status'],
        };
        continue;
      }

      const applied = Math.min(scheduleRemaining, remainingPayment);
      const nextPaidAmount = Number((schedule.paidAmount + applied).toFixed(2));
      remainingPayment = Number((remainingPayment - applied).toFixed(2));

      schedules[index] = {
        ...schedule,
        paidAmount: nextPaidAmount,
        paidAt: payment.date,
        status: (nextPaidAmount >= schedule.amount ? 'paid' : 'partial') as InstallmentSchedule['status'],
      };
    }

    sale.financing.schedules = schedules;
  }

  return syncSalePaymentStatus(sale);
}

// Initialize default admin user if not exists
export function initializeDatabase(): void {
  if (isApiMode()) return;
  const users = getStorage<User>(DB_KEYS.USERS);
  if (users.length === 0) {
    const adminUser: User = {
      id: generateId(),
      name: 'ظ…ط¯ظٹط± ط§ظ„ظ†ط¸ط§ظ…',
      username: 'admin',
      password: 'admin123',
      role: 'admin',
      phone: '01001207474',
      createdAt: new Date().toISOString(),
      isActive: true,
    };
    setStorage(DB_KEYS.USERS, [adminUser]);
  }

  // Initialize settings
  const settings = localStorage.getItem(DB_KEYS.SETTINGS);
  if (!settings) {
    const defaultSettings: Setting = {
      companyName: 'ط´ط±ظƒط© ط§ظ„ظ…طھط­ط¯ط©',
      companyAddress: 'ط§ظ„ط´ط§ط±ط¹ ط§ظ„ظ…ظ‚ط§ط¨ظ„ ظ„ظ„ط¨ظˆط§ط¨ط© ط§ظ„ط®ظ„ظپظٹط© ظ„ظ„ظ…ط³طھط´ظپظ‰ ط§ظ„ط¹ط§ظ…',
      companyPhone: '01001207474',
      companyEmail: 'info@almuttahida.com',
      taxRate: 0,
      currency: 'ط¬ظ†ظٹظ‡',
      invoicePrefix: 'INV',
      invoiceFooter: 'ط´ظƒط±ط§ظ‹ ظ„ظ„طھط¹ط§ظ…ظ„ ظ…ط¹ظ†ط§ - ط´ط±ظƒط© ط§ظ„ظ…طھط­ط¯ط©',
      whatsappRemindersEnabled: false,
      whatsappPhoneNumberId: '',
      whatsappAccessToken: '',
      whatsappTemplateName: 'installment_reminder',
      whatsappTemplateLanguage: 'ar',
    };
    localStorage.setItem(DB_KEYS.SETTINGS, JSON.stringify(defaultSettings));
  } else {
    try {
      const parsed = JSON.parse(settings);
      let changed = false;
      if (parsed.taxRate === 14) {
        parsed.taxRate = 0;
        changed = true;
      }
      if (parsed.whatsappRemindersEnabled === undefined) {
        parsed.whatsappRemindersEnabled = false;
        changed = true;
      }
      if (parsed.whatsappTemplateName === undefined) {
        parsed.whatsappTemplateName = 'installment_reminder';
        changed = true;
      }
      if (parsed.whatsappTemplateLanguage === undefined) {
        parsed.whatsappTemplateLanguage = 'ar';
        changed = true;
      }
      if (changed) {
        localStorage.setItem(DB_KEYS.SETTINGS, JSON.stringify(parsed));
      }
    } catch (e) {}
  }

  // Initialize invoice counter
  if (!localStorage.getItem(DB_KEYS.INVOICE_COUNTER)) {
    localStorage.setItem(DB_KEYS.INVOICE_COUNTER, '1000');
  }
  if (!localStorage.getItem(DB_KEYS.RECEIPT_COUNTER)) {
    localStorage.setItem(DB_KEYS.RECEIPT_COUNTER, '5000');
  }

  // Initialize Shareholders
  if (!localStorage.getItem(DB_KEYS.SHAREHOLDERS)) {
    localStorage.setItem(DB_KEYS.SHAREHOLDERS, JSON.stringify([]));
  }
  if (!localStorage.getItem(DB_KEYS.AUDIT_LOGS)) localStorage.setItem(DB_KEYS.AUDIT_LOGS, JSON.stringify([] as AuditLogEntry[]));
  if (!localStorage.getItem(DB_KEYS.COLLECTION_TASKS)) localStorage.setItem(DB_KEYS.COLLECTION_TASKS, JSON.stringify([] as InstallmentCollectionTask[]));
  if (!localStorage.getItem(DB_KEYS.RESCHEDULE_REQUESTS)) localStorage.setItem(DB_KEYS.RESCHEDULE_REQUESTS, JSON.stringify([] as RescheduleRequest[]));
  if (!localStorage.getItem(DB_KEYS.CLOSING_PERIODS)) localStorage.setItem(DB_KEYS.CLOSING_PERIODS, JSON.stringify([] as ClosingPeriod[]));
}

// Clear all business data (keep admin user and settings)
export async function clearAllData(): Promise<void> {
  if (isApiMode()) {
    try {
      await api.clearAllData();
      apiMemoryStore.clear();
      return;
    } catch (err) {
      console.error('Failed to clear remote database:', err);
      throw err;
    }
  }

  setStorage(DB_KEYS.CUSTOMERS, []);
  setStorage(DB_KEYS.SUPPLIERS, []);
  setStorage(DB_KEYS.PRODUCTS, []);
  setStorage(DB_KEYS.SALES, []);
  setStorage(DB_KEYS.PURCHASES, []);
  setStorage(DB_KEYS.PAYMENTS, []);
  setStorage(DB_KEYS.EXPENSES, []);
  setStorage(DB_KEYS.NOTIFICATIONS, []);
  setStorage(DB_KEYS.SALES_REPS, []);
  setStorage(DB_KEYS.SHAREHOLDERS, []);
  setStorage(DB_KEYS.SHAREHOLDER_TRANSACTIONS, []);
  localStorage.setItem(DB_KEYS.INVOICE_COUNTER, '1000');
  console.log('طھظ… ط­ط°ظپ ط¬ظ…ظٹط¹ ط§ظ„ط¨ظٹط§ظ†ط§طھ ط§ظ„ط§ظپطھط±ط§ط¶ظٹط© ط¨ظ†ط¬ط§ط­');
}

