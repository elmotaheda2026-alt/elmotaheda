import { OpeningBalances } from '../../types';
import { DB_KEYS } from './core';
import { api, isApiMode } from '../apiClient';

const DEFAULT_OPENING_BALANCES: OpeningBalances = {
  startingCashBalance: 0,
  startingReceivables: 0,
  startingPayables: 0,
  startingInventoryValue: 0,
  updatedAt: new Date().toISOString(),
};

export function getOpeningBalances(): OpeningBalances {
  try {
    const raw = localStorage.getItem(DB_KEYS.OPENING_BALANCES);
    if (!raw) return { ...DEFAULT_OPENING_BALANCES };
    const parsed = JSON.parse(raw) as Partial<OpeningBalances>;
    return {
      startingCashBalance: Number(parsed.startingCashBalance ?? 0),
      startingReceivables: Number(parsed.startingReceivables ?? 0),
      startingPayables: Number(parsed.startingPayables ?? 0),
      startingInventoryValue: Number(parsed.startingInventoryValue ?? 0),
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    };
  } catch {
    return { ...DEFAULT_OPENING_BALANCES };
  }
}

export function saveOpeningBalances(balances: Omit<OpeningBalances, 'updatedAt'>): void {
  const data: OpeningBalances = {
    ...balances,
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(DB_KEYS.OPENING_BALANCES, JSON.stringify(data));

  if (isApiMode()) {
    api.updateOpeningBalances(balances).catch((err) => {
      console.error('Failed to sync opening balances to backend API:', err);
    });
  }
}
