import { Supplier } from '../../types';
import { DB_KEYS, getStorage, setStorage, generateId } from './core';
import { api, isApiMode } from '../apiClient';

export function getSuppliers(): Supplier[] {
  return getStorage<Supplier>(DB_KEYS.SUPPLIERS);
}

export async function syncSuppliers(): Promise<void> {
  if (!isApiMode()) return;
  const data = await api.listSuppliers();
  setStorage(DB_KEYS.SUPPLIERS, data);
}

export async function createSupplier(supplier: Omit<Supplier, 'id' | 'createdAt' | 'updatedAt' | 'balance'> & { balance?: number }): Promise<Supplier> {
  if (isApiMode()) {
    const res = await api.createSupplier(supplier);
    const newSupplier: Supplier = {
      ...supplier,
      id: res.id,
      balance: supplier.balance || 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as Supplier;
    const suppliers = getStorage<Supplier>(DB_KEYS.SUPPLIERS);
    suppliers.push(newSupplier);
    setStorage(DB_KEYS.SUPPLIERS, suppliers);
    return newSupplier;
  }

  const suppliers = getStorage<Supplier>(DB_KEYS.SUPPLIERS);
  const newSupplier: Supplier = {
    ...supplier,
    id: generateId(),
    balance: supplier.balance || 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as Supplier;
  suppliers.push(newSupplier);
  setStorage(DB_KEYS.SUPPLIERS, suppliers);
  return newSupplier;
}

export async function updateSupplier(id: string, updates: Partial<Supplier>): Promise<Supplier | null> {
  if (isApiMode()) {
    await api.updateSupplier(id, updates);
    const suppliers = getStorage<Supplier>(DB_KEYS.SUPPLIERS);
    const index = suppliers.findIndex(s => s.id === id);
    if (index !== -1) {
      suppliers[index] = { ...suppliers[index], ...updates, updatedAt: new Date().toISOString() };
      setStorage(DB_KEYS.SUPPLIERS, suppliers);
      return suppliers[index];
    }
    return null;
  }

  const suppliers = getStorage<Supplier>(DB_KEYS.SUPPLIERS);
  const index = suppliers.findIndex(s => s.id === id);
  if (index !== -1) {
    suppliers[index] = { ...suppliers[index], ...updates, updatedAt: new Date().toISOString() };
    setStorage(DB_KEYS.SUPPLIERS, suppliers);
    return suppliers[index];
  }
  return null;
}

export async function deleteSupplier(id: string): Promise<boolean> {
  if (isApiMode()) {
    await api.deleteSupplier(id);
    const suppliers = getStorage<Supplier>(DB_KEYS.SUPPLIERS);
    const filtered = suppliers.filter(s => s.id !== id);
    if (filtered.length !== suppliers.length) {
      setStorage(DB_KEYS.SUPPLIERS, filtered);
      return true;
    }
    return false;
  }

  const suppliers = getStorage<Supplier>(DB_KEYS.SUPPLIERS);
  const filtered = suppliers.filter(s => s.id !== id);
  if (filtered.length !== suppliers.length) {
    setStorage(DB_KEYS.SUPPLIERS, filtered);
    return true;
  }
  return false;
}
