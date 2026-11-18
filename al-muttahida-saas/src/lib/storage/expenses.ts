import { Expense } from '../../types';
import { DB_KEYS, getStorage, setStorage, generateId } from './core';
import { createNotification } from './notifications';
import { api, isApiMode } from '../apiClient';

export function getExpenses(): Expense[] {
  return getStorage<Expense>(DB_KEYS.EXPENSES);
}

export async function syncExpenses(): Promise<void> {
  if (!isApiMode()) return;
  const data = await api.listExpenses();
  setStorage(DB_KEYS.EXPENSES, data);
}

export async function createExpense(expense: Omit<Expense, 'id' | 'createdAt'>): Promise<Expense> {
  if (isApiMode()) {
    const res = await api.createExpense(expense);
    const newExpense: Expense = {
      ...expense,
      id: res.id,
      createdAt: new Date().toISOString(),
    };
    const expenses = getStorage<Expense>(DB_KEYS.EXPENSES);
    expenses.push(newExpense);
    setStorage(DB_KEYS.EXPENSES, expenses);
    return newExpense;
  }

  const expenses = getStorage<Expense>(DB_KEYS.EXPENSES);
  const newExpense: Expense = {
    ...expense,
    id: generateId(),
    createdAt: new Date().toISOString(),
  };
  expenses.push(newExpense);
  setStorage(DB_KEYS.EXPENSES, expenses);

  // Auto-register cash-out transaction record in payments treasury ledger
  const payments = getStorage<any>(DB_KEYS.PAYMENTS);
  const cashOutPayment = {
    id: generateId(),
    type: 'out',
    amount: newExpense.amount,
    date: newExpense.date,
    description: `مصروفات - ${newExpense.category}: ${newExpense.description}`,
    receiptNumber: `EXP-${newExpense.id.slice(-6).toUpperCase()}`,
    status: 'posted',
    createdAt: new Date().toISOString(),
    createdBy: expense.createdBy || 'current_user',
    referenceId: newExpense.id,
    referenceType: 'expense',
    channel: 'cash',
  };
  payments.push(cashOutPayment);
  setStorage(DB_KEYS.PAYMENTS, payments);

  void createNotification({
    type: 'warning',
    title: 'سند صرف جديد',
    message: `صادر ${Number(newExpense.amount || 0).toLocaleString('ar-EG')} جنيه - ${newExpense.category}: ${newExpense.description}`,
  });
  return newExpense;
}

export async function updateExpense(id: string, data: Partial<Omit<Expense, 'id' | 'createdAt'>>): Promise<void> {
  if (isApiMode()) {
    await api.updateExpense(id, data);
    await syncExpenses();
    return;
  }

  const expenses = getStorage<Expense>(DB_KEYS.EXPENSES);
  const idx = expenses.findIndex((e) => e.id === id);
  if (idx === -1) throw new Error('المصروف غير موجود');
  const updated: Expense = { ...expenses[idx], ...data };
  expenses[idx] = updated;
  setStorage(DB_KEYS.EXPENSES, expenses);

  const payments = getStorage<any>(DB_KEYS.PAYMENTS);
  const nextPayments = payments.map((p) =>
    p.referenceType === 'expense' && p.referenceId === id
      ? {
          ...p,
          amount: updated.amount,
          date: updated.date,
          description: `مصروفات - ${updated.category}: ${updated.description}`,
        }
      : p
  );
  setStorage(DB_KEYS.PAYMENTS, nextPayments);
}

export async function deleteExpense(id: string): Promise<void> {
  if (isApiMode()) {
    await api.deleteExpense(id);
    await syncExpenses();
    return;
  }

  const expenses = getStorage<Expense>(DB_KEYS.EXPENSES).filter((e) => e.id !== id);
  setStorage(DB_KEYS.EXPENSES, expenses);

  const payments = getStorage<any>(DB_KEYS.PAYMENTS).map((p) =>
    p.referenceType === 'expense' && p.referenceId === id
      ? { ...p, status: 'voided' }
      : p
  );
  setStorage(DB_KEYS.PAYMENTS, payments);
}

