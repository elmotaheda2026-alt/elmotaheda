import { Customer } from '../../types';
import { DB_KEYS, getStorage, setStorage, generateId } from './core';

export function getCustomers(): Customer[] {
  return getStorage<Customer>(DB_KEYS.CUSTOMERS);
}

export function createCustomer(customer: Omit<Customer, 'id' | 'createdAt' | 'updatedAt' | 'balance'>): Customer {
  const customers = getStorage<Customer>(DB_KEYS.CUSTOMERS);
  const newCustomer: Customer = {
    ...customer,
    id: generateId(),
    balance: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  customers.push(newCustomer);
  setStorage(DB_KEYS.CUSTOMERS, customers);
  return newCustomer;
}

export function updateCustomer(id: string, updates: Partial<Customer>): Customer | null {
  const customers = getStorage<Customer>(DB_KEYS.CUSTOMERS);
  const index = customers.findIndex(c => c.id === id);
  if (index !== -1) {
    customers[index] = { ...customers[index], ...updates, updatedAt: new Date().toISOString() };
    setStorage(DB_KEYS.CUSTOMERS, customers);
    return customers[index];
  }
  return null;
}

export function deleteCustomer(id: string): boolean {
  const customers = getStorage<Customer>(DB_KEYS.CUSTOMERS);
  const filtered = customers.filter(c => c.id !== id);
  if (filtered.length !== customers.length) {
    setStorage(DB_KEYS.CUSTOMERS, filtered);
    return true;
  }
  return false;
}
