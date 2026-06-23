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
};

export function getStorage<T>(key: string): T[] {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export function setStorage<T>(key: string, data: T[]): void {
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
  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) {
    return dateStr;
  }

  const monthIndex = month - 1 + months;
  const targetYear = year + Math.floor(monthIndex / 12);
  const normalizedMonthIndex = ((monthIndex % 12) + 12) % 12;
  const targetMonth = normalizedMonthIndex + 1;
  const lastDayInTargetMonth = new Date(targetYear, targetMonth, 0).getDate();
  const safeDay = Math.min(day, lastDayInTargetMonth);

  return `${targetYear}-${pad(targetMonth)}-${pad(safeDay)}`;
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
      label: `القسط ${index + 1}`,
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
        paidAt: nextPaidAmount >= schedule.amount ? payment.date : schedule.paidAt,
        status: (nextPaidAmount >= schedule.amount ? 'paid' : 'partial') as InstallmentSchedule['status'],
      };
    }

    sale.financing.schedules = schedules;
  }

  return syncSalePaymentStatus(sale);
}

// Initialize default admin user if not exists
export function initializeDatabase(): void {
  const users = getStorage<User>(DB_KEYS.USERS);
  if (users.length === 0) {
    const adminUser: User = {
      id: generateId(),
      name: 'مدير النظام',
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
      companyName: 'شركة المتحدة',
      companyAddress: 'الشارع المقابل للبوابة الخلفية للمستشفى العام',
      companyPhone: '01001207474',
      companyEmail: 'info@almuttahida.com',
      taxRate: 0,
      currency: 'جنيه',
      invoicePrefix: 'INV',
      invoiceFooter: 'شكراً للتعامل معنا - شركة المتحدة',
    };
    localStorage.setItem(DB_KEYS.SETTINGS, JSON.stringify(defaultSettings));
  } else {
    try {
      const parsed = JSON.parse(settings);
      if (parsed.taxRate === 14) {
        parsed.taxRate = 0;
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

  // Initialize Default Shareholders
  if (!localStorage.getItem(DB_KEYS.SHAREHOLDERS)) {
    const defaultShareholders = [
      {
        id: generateId(),
        name: 'م. أحمد المصري',
        phone: '01000000001',
        sharePercentage: 60,
        capital: 600000,
        currentBalance: 0,
        notes: 'المدير التنفيذي والمؤسس للشركة',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: generateId(),
        name: 'م. خالد الدسوقي',
        phone: '01000000002',
        sharePercentage: 40,
        capital: 400000,
        currentBalance: 0,
        notes: 'شريك استراتيجي',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];
    localStorage.setItem(DB_KEYS.SHAREHOLDERS, JSON.stringify(defaultShareholders));
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
  console.log('تم حذف جميع البيانات الافتراضية بنجاح');
}
