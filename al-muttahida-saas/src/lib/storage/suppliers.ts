import { Payment, Purchase, Supplier } from '../../types';
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

    const [freshSuppliers, freshProducts, freshPurchases] = await Promise.all([
      api.listSuppliers(),
      api.listProducts(),
      api.listPurchases(),
    ]);

    setStorage(DB_KEYS.SUPPLIERS, freshSuppliers);
    setStorage(DB_KEYS.PRODUCTS, freshProducts);
    setStorage(DB_KEYS.PURCHASES, freshPurchases);

    const payments = getStorage<Payment>(DB_KEYS.PAYMENTS);
    setStorage(
      DB_KEYS.PAYMENTS,
      payments.filter(
        (payment) =>
          payment.supplierId !== id &&
          !(payment.referenceType === 'supplier' && payment.referenceId === id),
      ),
    );
    return true;
  }

  const suppliers = getStorage<Supplier>(DB_KEYS.SUPPLIERS);
  const supplierExists = suppliers.some((supplier) => supplier.id === id);
  if (!supplierExists) return false;

  const purchases = getStorage<Purchase>(DB_KEYS.PURCHASES);
  const linkedPurchaseIds = new Set(purchases.filter((purchase) => purchase.supplierId === id).map((purchase) => purchase.id));

  setStorage(DB_KEYS.SUPPLIERS, suppliers.filter((supplier) => supplier.id !== id));
  setStorage(DB_KEYS.PURCHASES, purchases.filter((purchase) => purchase.supplierId !== id));

  const payments = getStorage<Payment>(DB_KEYS.PAYMENTS);
  setStorage(
    DB_KEYS.PAYMENTS,
    payments.filter(
      (payment) =>
        payment.supplierId !== id &&
        !(payment.referenceType === 'supplier' && payment.referenceId === id) &&
        !(payment.referenceType === 'purchase' && payment.referenceId && linkedPurchaseIds.has(payment.referenceId)),
    ),
  );

  return true;
}
