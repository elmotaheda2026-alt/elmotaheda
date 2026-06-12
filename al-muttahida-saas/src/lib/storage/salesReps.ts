import { SalesRep } from '../../types';
import { DB_KEYS, getStorage, setStorage, generateId } from './core';
import { api, isApiMode } from '../apiClient';

export async function syncSalesReps(): Promise<void> {
  if (!isApiMode()) return;
  const data = await api.listSalesReps();
  setStorage(DB_KEYS.SALES_REPS, data);
}

export function getSalesReps(): SalesRep[] {
  return getStorage<SalesRep>(DB_KEYS.SALES_REPS);
}

export async function createSalesRep(rep: Omit<SalesRep, 'id' | 'createdAt' | 'achieved'>): Promise<SalesRep> {
  if (isApiMode()) {
    const res = await api.createSalesRep(rep);
    const newRep: SalesRep = {
      ...rep,
      id: res.id,
      achieved: 0,
      createdAt: new Date().toISOString(),
    };
    const reps = getStorage<SalesRep>(DB_KEYS.SALES_REPS);
    reps.push(newRep);
    setStorage(DB_KEYS.SALES_REPS, reps);
    return newRep;
  }
  const reps = getStorage<SalesRep>(DB_KEYS.SALES_REPS);
  const newRep: SalesRep = {
    ...rep,
    id: generateId(),
    achieved: 0,
    createdAt: new Date().toISOString(),
  };
  reps.push(newRep);
  setStorage(DB_KEYS.SALES_REPS, reps);
  return newRep;
}

export async function updateSalesRep(id: string, updates: Partial<SalesRep>): Promise<SalesRep | null> {
  if (isApiMode()) {
    await api.updateSalesRep(id, updates);
  }
  const reps = getStorage<SalesRep>(DB_KEYS.SALES_REPS);
  const index = reps.findIndex((r) => r.id === id);
  if (index !== -1) {
    reps[index] = { ...reps[index], ...updates };
    setStorage(DB_KEYS.SALES_REPS, reps);
    return reps[index];
  }
  return null;
}

export async function deleteSalesRep(id: string): Promise<boolean> {
  if (isApiMode()) {
    await api.deleteSalesRep(id);
  }
  const reps = getStorage<SalesRep>(DB_KEYS.SALES_REPS);
  const filtered = reps.filter((r) => r.id !== id);
  if (filtered.length !== reps.length) {
    setStorage(DB_KEYS.SALES_REPS, filtered);
    return true;
  }
  return false;
}
