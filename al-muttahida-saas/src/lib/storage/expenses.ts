import { Expense } from '../../types';
import { DB_KEYS, getStorage, setStorage, generateId } from './core';

export function getExpenses(): Expense[] {
  return getStorage<Expense>(DB_KEYS.EXPENSES);
}

export function createExpense(expense: Omit<Expense, 'id' | 'createdAt'>): Expense {
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
