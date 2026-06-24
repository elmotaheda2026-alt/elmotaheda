import { Expense } from '../../types';
import { DB_KEYS, getStorage, setStorage, generateId } from './core';
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
  return newExpense;
}
