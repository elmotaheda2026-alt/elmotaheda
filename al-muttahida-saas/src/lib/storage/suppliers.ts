import { Supplier } from '../../types';
import { DB_KEYS, getStorage, setStorage, generateId } from './core';

export function getSuppliers(): Supplier[] {
  return getStorage<Supplier>(DB_KEYS.SUPPLIERS);
}

export function createSupplier(supplier: Omit<Supplier, 'id' | 'createdAt' | 'updatedAt' | 'balance'>): Supplier {
  const suppliers = getStorage<Supplier>(DB_KEYS.SUPPLIERS);
  const newSupplier: Supplier = {
    ...supplier,
    id: generateId(),
    balance: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  suppliers.push(newSupplier);
  setStorage(DB_KEYS.SUPPLIERS, suppliers);
  return newSupplier;
}

export function updateSupplier(id: string, updates: Partial<Supplier>): Supplier | null {
  const suppliers = getStorage<Supplier>(DB_KEYS.SUPPLIERS);
  const index = suppliers.findIndex(s => s.id === id);
  if (index !== -1) {
    suppliers[index] = { ...suppliers[index], ...updates, updatedAt: new Date().toISOString() };
    setStorage(DB_KEYS.SUPPLIERS, suppliers);
    return suppliers[index];
  }
  return null;
}

export function deleteSupplier(id: string): boolean {
  const suppliers = getStorage<Supplier>(DB_KEYS.SUPPLIERS);
  const filtered = suppliers.filter(s => s.id !== id);
  if (filtered.length !== suppliers.length) {
    setStorage(DB_KEYS.SUPPLIERS, filtered);
    return true;
  }
  return false;
}
