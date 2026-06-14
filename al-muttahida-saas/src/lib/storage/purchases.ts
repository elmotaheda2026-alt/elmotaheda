import { Purchase, Supplier } from '../../types';
import { DB_KEYS, getStorage, setStorage, generateId } from './core';
import { getSettings } from './settings';
import { updateProductQuantity } from './products';
import { api, isApiMode } from '../apiClient';

export function getPurchases(): Purchase[] {
  return getStorage<Purchase>(DB_KEYS.PURCHASES);
}

export async function syncPurchases(): Promise<void> {
  if (!isApiMode()) return;
  const data = await api.listPurchases();
  setStorage(DB_KEYS.PURCHASES, data);
}

export async function createPurchase(purchase: Omit<Purchase, 'id' | 'invoiceNumber' | 'createdAt'>): Promise<Purchase> {
  if (isApiMode()) {
    const settings = getSettings();
    const invoiceCounter = parseInt(localStorage.getItem(DB_KEYS.INVOICE_COUNTER) || '1000') + 1;
    localStorage.setItem(DB_KEYS.INVOICE_COUNTER, invoiceCounter.toString());
    const invoiceNumber = `${settings.invoicePrefix}-PO-${invoiceCounter}`;

    const res = await api.createPurchase({
      ...purchase,
      invoiceNumber,
    });

    const newPurchase: Purchase = {
      ...purchase,
      id: res.id,
      invoiceNumber,
      createdAt: new Date().toISOString(),
    } as Purchase;

    const purchases = getStorage<Purchase>(DB_KEYS.PURCHASES);
    purchases.push(newPurchase);
    setStorage(DB_KEYS.PURCHASES, purchases);

    return newPurchase;
  }

  const purchases = getStorage<Purchase>(DB_KEYS.PURCHASES);
  const invoiceCounter = parseInt(localStorage.getItem(DB_KEYS.INVOICE_COUNTER) || '1000') + 1;
  localStorage.setItem(DB_KEYS.INVOICE_COUNTER, invoiceCounter.toString());

  const settings = getSettings();
  const invoiceNumber = `${settings.invoicePrefix}-PO-${invoiceCounter}`;

  const newPurchase: Purchase = {
    ...purchase,
    id: generateId(),
    invoiceNumber,
    createdAt: new Date().toISOString(),
  };
  purchases.push(newPurchase);
  setStorage(DB_KEYS.PURCHASES, purchases);

  // Update product quantities
  purchase.items.forEach((item) => {
    updateProductQuantity(item.productId, item.quantity);
  });

  // Update supplier balance
  const suppliers = getStorage<Supplier>(DB_KEYS.SUPPLIERS);
  const supplierIndex = suppliers.findIndex((s) => s.id === purchase.supplierId);
  if (supplierIndex !== -1) {
    suppliers[supplierIndex].balance += purchase.remaining;
    setStorage(DB_KEYS.SUPPLIERS, suppliers);
  }

  return newPurchase;
}
