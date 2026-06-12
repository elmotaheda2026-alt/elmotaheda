import { Customer, Sale } from '../../types';
import { DB_KEYS, getStorage, setStorage, generateId, addMonths, buildInstallmentSchedule, syncSalePaymentStatus, createAuditLog } from './core';
import { getSettings } from './settings';
import { updateProductQuantity } from './products';
import { api, isApiMode } from '../apiClient';

type SaleDraft = Omit<Sale, 'id' | 'invoiceNumber' | 'createdAt'>;

export function getSales(): Sale[] {
  return getStorage<Sale>(DB_KEYS.SALES);
}

export function getNextSaleInvoiceNumber(): string {
  const invoiceCounter = parseInt(localStorage.getItem(DB_KEYS.INVOICE_COUNTER) || '1000', 10) + 1;
  const settings = getSettings();
  return `${settings.invoicePrefix}-${invoiceCounter}`;
}

function nextSaleInvoiceNumber(): string {
  const invoiceCounter = parseInt(localStorage.getItem(DB_KEYS.INVOICE_COUNTER) || '1000', 10) + 1;
  localStorage.setItem(DB_KEYS.INVOICE_COUNTER, invoiceCounter.toString());

  const settings = getSettings();
  return `${settings.invoicePrefix}-${invoiceCounter}`;
}

function buildFinancing(sale: SaleDraft) {
  return sale.financing
    ? {
        ...sale.financing,
        schedules:
          sale.financing.paymentMethod === 'installment'
            ? buildInstallmentSchedule(
                sale.financing.installmentStartDate || addMonths(sale.date, 1),
                sale.remaining,
                sale.financing.installmentMonths || 1,
              )
            : sale.financing.schedules || [],
      }
    : undefined;
}

export async function createSale(sale: SaleDraft): Promise<Sale> {
  const sales = getStorage<Sale>(DB_KEYS.SALES);
  const invoiceNumber = nextSaleInvoiceNumber();
  const financing = buildFinancing(sale);

  if (isApiMode()) {
    const res = await api.createSale({ ...sale, invoiceNumber, financing });
    const newSale: Sale = {
      ...sale,
      id: res.id,
      invoiceNumber,
      createdAt: new Date().toISOString(),
      version: 1,
      locked: false,
      lastEditedBy: sale.createdBy,
      lastEditedAt: new Date().toISOString(),
      financing,
    };
    sales.push(syncSalePaymentStatus(newSale));
    setStorage(DB_KEYS.SALES, sales);
    return newSale;
  }

  const newSale: Sale = {
    ...sale,
    id: generateId(),
    invoiceNumber,
    createdAt: new Date().toISOString(),
    version: 1,
    locked: false,
    lastEditedBy: sale.createdBy,
    lastEditedAt: new Date().toISOString(),
    financing,
  };
  sales.push(syncSalePaymentStatus(newSale));
  setStorage(DB_KEYS.SALES, sales);

  sale.items.forEach((item) => {
    updateProductQuantity(item.productId, -item.quantity);
  });

  const customers = getStorage<Customer>(DB_KEYS.CUSTOMERS);
  const customerIndex = customers.findIndex((c) => c.id === sale.customerId);
  if (customerIndex !== -1) {
    customers[customerIndex].balance += sale.remaining;
    setStorage(DB_KEYS.CUSTOMERS, customers);
  }

  createAuditLog({
    action: 'sale.create',
    entityType: 'sale',
    entityId: newSale.id,
    payload: { invoiceNumber: newSale.invoiceNumber, total: newSale.total, remaining: newSale.remaining },
    createdBy: sale.createdBy || 'system',
  });

  return newSale;
}

export async function updateSale(saleId: string, updatedSaleData: SaleDraft): Promise<Sale> {
  const sales = getStorage<Sale>(DB_KEYS.SALES);
  const saleIndex = sales.findIndex((s) => s.id === saleId);

  if (saleIndex === -1) {
    throw new Error('Sale was not found');
  }

  const oldSale = sales[saleIndex];
  if ((oldSale.paid || 0) > 0 || (oldSale.financing?.schedules?.some((s) => s.paidAmount > 0) ?? false)) {
    throw new Error('Cannot edit a sale that has payments.');
  }
  if (oldSale.locked) {
    throw new Error('Sale is locked and cannot be edited.');
  }

  if (!isApiMode()) {
    oldSale.items.forEach((item) => {
      updateProductQuantity(item.productId, item.quantity);
    });

    const customers = getStorage<Customer>(DB_KEYS.CUSTOMERS);
    const oldCustomerIndex = customers.findIndex((c) => c.id === oldSale.customerId);
    if (oldCustomerIndex !== -1) {
      customers[oldCustomerIndex].balance -= oldSale.remaining;
    }

    const newCustomerIndex = customers.findIndex((c) => c.id === updatedSaleData.customerId);
    if (newCustomerIndex !== -1) {
      customers[newCustomerIndex].balance += updatedSaleData.remaining;
    }
    setStorage(DB_KEYS.CUSTOMERS, customers);

    updatedSaleData.items.forEach((item) => {
      updateProductQuantity(item.productId, -item.quantity);
    });
  }

  const financing = buildFinancing(updatedSaleData);
  const newSale: Sale = {
    ...oldSale,
    ...updatedSaleData,
    id: oldSale.id,
    invoiceNumber: oldSale.invoiceNumber,
    createdAt: oldSale.createdAt,
    version: (oldSale.version || 1) + 1,
    lastEditedBy: updatedSaleData.createdBy || oldSale.createdBy,
    lastEditedAt: new Date().toISOString(),
    financing,
  };

  const syncedSale = syncSalePaymentStatus(newSale);

  if (isApiMode()) {
    await api.updateSale(saleId, { ...updatedSaleData, invoiceNumber: oldSale.invoiceNumber, financing });
  }

  sales[saleIndex] = syncedSale;
  setStorage(DB_KEYS.SALES, sales);

  createAuditLog({
    action: 'sale.update',
    entityType: 'sale',
    entityId: syncedSale.id,
    payload: { invoiceNumber: syncedSale.invoiceNumber, version: syncedSale.version, total: syncedSale.total, remaining: syncedSale.remaining },
    createdBy: updatedSaleData.createdBy || 'system',
  });

  return syncedSale;
}
