import { Supplier } from '../../types';
import { DB_KEYS, getStorage, setStorage, generateId } from './core';
import { api, hasApiToken } from '../apiClient';

export function getSuppliers(): Supplier[] {
  return getStorage<Supplier>(DB_KEYS.SUPPLIERS);
}

export async function syncSuppliers(): Promise<void> {
  if (hasApiToken()) {
    try {
      const data = await api.listSuppliers();
      setStorage(DB_KEYS.SUPPLIERS, data);
    } catch (e) {
      console.error('Failed to sync suppliers with API', e);
    }
  }
}

export async function createSupplier(supplier: Omit<Supplier, 'id' | 'createdAt' | 'updatedAt' | 'balance'> & { balance?: number }): Promise<Supplier> {
  if (hasApiToken()) {
    try {
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
    } catch (e) {
      console.error('API createSupplier failed, falling back to localStorage', e);
    }
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
  if (hasApiToken()) {
    try {
      await api.updateSupplier(id, updates);
      const suppliers = getStorage<Supplier>(DB_KEYS.SUPPLIERS);
      const index = suppliers.findIndex(s => s.id === id);
      if (index !== -1) {
        suppliers[index] = { ...suppliers[index], ...updates, updatedAt: new Date().toISOString() };
        setStorage(DB_KEYS.SUPPLIERS, suppliers);
        return suppliers[index];
      }
    } catch (e) {
      console.error('API updateSupplier failed, falling back to localStorage cache', e);
    }
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
  if (hasApiToken()) {
    try {
      await api.deleteSupplier(id);
      const suppliers = getStorage<Supplier>(DB_KEYS.SUPPLIERS);
      const filtered = suppliers.filter(s => s.id !== id);
      if (filtered.length !== suppliers.length) {
        setStorage(DB_KEYS.SUPPLIERS, filtered);
        return true;
      }
    } catch (e) {
      console.error('API deleteSupplier failed, falling back to localStorage cache', e);
    }
  }

  const suppliers = getStorage<Supplier>(DB_KEYS.SUPPLIERS);
  const filtered = suppliers.filter(s => s.id !== id);
  if (filtered.length !== suppliers.length) {
    setStorage(DB_KEYS.SUPPLIERS, filtered);
    return true;
  }
  return false;
}
