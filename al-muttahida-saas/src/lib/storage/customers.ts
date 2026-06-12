import { Customer } from '../../types';
import { DB_KEYS, getStorage, setStorage, generateId } from './core';
import { api, isApiMode } from '../apiClient';

export function getCustomers(): Customer[] {
  return getStorage<Customer>(DB_KEYS.CUSTOMERS);
}

export async function syncCustomers(): Promise<void> {
  if (!isApiMode()) return;
  const data = await api.listCustomers();
  setStorage(DB_KEYS.CUSTOMERS, data);
}

export async function createCustomer(customer: Omit<Customer, 'id' | 'createdAt' | 'updatedAt' | 'balance'> & { balance?: number }): Promise<Customer> {
  const requiredFields = ['name', 'phone', 'address', 'city', 'governorate', 'region', 'nationalId'];
  const missing = requiredFields.filter((field) => !(field in customer) || !customer[field as keyof typeof customer]);
  if (missing.length > 0) {
    throw new Error(`الحقول المطلوبة مفقودة: ${missing.join(', ')}`);
  }

  if (isApiMode()) {
    const res = await api.createCustomer(customer);
    const newCustomer: Customer = {
      ...customer,
      id: res.id,
      balance: customer.balance || 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as Customer;
    const customers = getStorage<Customer>(DB_KEYS.CUSTOMERS);
    customers.push(newCustomer);
    setStorage(DB_KEYS.CUSTOMERS, customers);
    return newCustomer;
  }

  const customers = getStorage<Customer>(DB_KEYS.CUSTOMERS);
  const newCustomer: Customer = {
    ...customer,
    id: generateId(),
    balance: customer.balance || 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as Customer;
  customers.push(newCustomer);
  setStorage(DB_KEYS.CUSTOMERS, customers);
  return newCustomer;
}

export async function updateCustomer(id: string, updates: Partial<Customer>): Promise<Customer | null> {
  const requiredFields = ['name', 'phone', 'address', 'city', 'governorate', 'region', 'nationalId'];
  const customers = getStorage<Customer>(DB_KEYS.CUSTOMERS);
  const index = customers.findIndex(c => c.id === id);

  if (index === -1) {
    return null;
  }

  const merged = { ...customers[index], ...updates } as Customer;
  const missing = requiredFields.filter((field) => !(field in merged) || !merged[field as keyof typeof merged]);
  if (missing.length > 0) {
    throw new Error(`الحقول المطلوبة مفقودة في تعديل العميل: ${missing.join(', ')}`);
  }

  if (isApiMode()) {
    await api.updateCustomer(id, merged);
  }

  customers[index] = { ...merged, updatedAt: new Date().toISOString() };
  setStorage(DB_KEYS.CUSTOMERS, customers);
  return customers[index];
}

export async function deleteCustomer(id: string): Promise<boolean> {
  if (isApiMode()) {
    await api.deleteCustomer(id);
    const customers = getStorage<Customer>(DB_KEYS.CUSTOMERS);
    const filtered = customers.filter(c => c.id !== id);
    if (filtered.length !== customers.length) {
      setStorage(DB_KEYS.CUSTOMERS, filtered);
      return true;
    }
    return false;
  }

  const customers = getStorage<Customer>(DB_KEYS.CUSTOMERS);
  const filtered = customers.filter(c => c.id !== id);
  if (filtered.length !== customers.length) {
    setStorage(DB_KEYS.CUSTOMERS, filtered);
    return true;
  }
  return false;
}
