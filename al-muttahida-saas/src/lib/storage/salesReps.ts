import { SalesRep } from '../../types';
import { DB_KEYS, getStorage, setStorage, generateId } from './core';

export function getSalesReps(): SalesRep[] {
  return getStorage<SalesRep>(DB_KEYS.SALES_REPS);
}

export function createSalesRep(rep: Omit<SalesRep, 'id' | 'createdAt' | 'achieved'>): SalesRep {
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

export function updateSalesRep(id: string, updates: Partial<SalesRep>): SalesRep | null {
  const reps = getStorage<SalesRep>(DB_KEYS.SALES_REPS);
  const index = reps.findIndex((r) => r.id === id);
  if (index !== -1) {
    reps[index] = { ...reps[index], ...updates };
    setStorage(DB_KEYS.SALES_REPS, reps);
    return reps[index];
  }
  return null;
}

export function deleteSalesRep(id: string): boolean {
  const reps = getStorage<SalesRep>(DB_KEYS.SALES_REPS);
  const filtered = reps.filter((r) => r.id !== id);
  if (filtered.length !== reps.length) {
    setStorage(DB_KEYS.SALES_REPS, filtered);
    return true;
  }
  return false;
}
