import { Customer, Sale } from '../../types';
import { DB_KEYS, getStorage, setStorage, generateId, addMonths, buildInstallmentSchedule, syncSalePaymentStatus, createAuditLog } from './core';
import { getSettings } from './settings';
import { updateProductQuantity } from './products';
import { isApiMode } from '../apiClient';

export function getSales(): Sale[] {
  return getStorage<Sale>(DB_KEYS.SALES);
}

export function getNextSaleInvoiceNumber(): string {
  const invoiceCounter = parseInt(localStorage.getItem(DB_KEYS.INVOICE_COUNTER) || '1000', 10) + 1;
  const settings = getSettings();
  return `${settings.invoicePrefix}-${invoiceCounter}`;
}

export function createSale(sale: Omit<Sale, 'id' | 'invoiceNumber' | 'createdAt'>): Sale {
  if (isApiMode()) {
    throw new Error('لا يمكن حفظ البيع محليًا أثناء تشغيل وضع API. استخدم مسار API أو فعّل VITE_DATA_MODE=local للديمو.');
  }

  const sales = getStorage<Sale>(DB_KEYS.SALES);
  const invoiceCounter = parseInt(localStorage.getItem(DB_KEYS.INVOICE_COUNTER) || '1000') + 1;
  localStorage.setItem(DB_KEYS.INVOICE_COUNTER, invoiceCounter.toString());

  const settings = getSettings();
  const invoiceNumber = `${settings.invoicePrefix}-${invoiceCounter}`;

  const financing = sale.financing
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

  // Update product quantities
  sale.items.forEach((item) => {
    updateProductQuantity(item.productId, -item.quantity);
  });

  // Update customer balance
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

export function updateSale(saleId: string, updatedSaleData: Omit<Sale, 'id' | 'invoiceNumber' | 'createdAt'>): Sale {
  if (isApiMode()) {
    throw new Error('لا يمكن تعديل البيع محليًا أثناء تشغيل وضع API.');
  }

  const sales = getStorage<Sale>(DB_KEYS.SALES);
  const saleIndex = sales.findIndex((s) => s.id === saleId);
  
  if (saleIndex === -1) {
    throw new Error('التعاقد غير موجود في قاعدة البيانات');
  }

  const oldSale = sales[saleIndex];
  if ((oldSale.paid || 0) > 0 || (oldSale.financing?.schedules?.some((s) => s.paidAmount > 0) ?? false)) {
    throw new Error('لا يمكن تعديل عقد تم عليه سداد. استخدم مسار التسوية/العكس المحاسبي.');
  }
  if (oldSale.locked) {
    throw new Error('العقد مقفل ولا يمكن تعديله.');
  }

  // 1. Revert old product quantities
  oldSale.items.forEach((item) => {
    updateProductQuantity(item.productId, item.quantity);
  });

  // 2. Revert old customer balance
  const customers = getStorage<Customer>(DB_KEYS.CUSTOMERS);
  const oldCustomerIndex = customers.findIndex((c) => c.id === oldSale.customerId);
  if (oldCustomerIndex !== -1) {
    customers[oldCustomerIndex].balance -= oldSale.remaining;
  }

  // 3. Process new financing details and build schedules
  const financing = updatedSaleData.financing
    ? {
        ...updatedSaleData.financing,
        schedules:
          updatedSaleData.financing.paymentMethod === 'installment'
            ? buildInstallmentSchedule(
                updatedSaleData.financing.installmentStartDate || addMonths(updatedSaleData.date, 1),
                updatedSaleData.remaining,
                updatedSaleData.financing.installmentMonths || 1,
              )
            : updatedSaleData.financing.schedules || [],
      }
    : undefined;

  // 4. Construct the new sale object preserving identifiers
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
  sales[saleIndex] = syncedSale;
  setStorage(DB_KEYS.SALES, sales);

  // 5. Update new product quantities
  updatedSaleData.items.forEach((item) => {
    updateProductQuantity(item.productId, -item.quantity);
  });

  // 6. Update new customer balance
  const newCustomerIndex = customers.findIndex((c) => c.id === updatedSaleData.customerId);
  if (newCustomerIndex !== -1) {
    customers[newCustomerIndex].balance += syncedSale.remaining;
  }
  setStorage(DB_KEYS.CUSTOMERS, customers);

  createAuditLog({
    action: 'sale.update',
    entityType: 'sale',
    entityId: syncedSale.id,
    payload: { invoiceNumber: syncedSale.invoiceNumber, version: syncedSale.version, total: syncedSale.total, remaining: syncedSale.remaining },
    createdBy: updatedSaleData.createdBy || 'system',
  });

  return syncedSale;
}
