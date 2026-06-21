import { Customer, Payment, Sale } from '../../types';
import { DB_KEYS, getStorage, setStorage, generateId, addMonths, buildInstallmentSchedule, syncSalePaymentStatus, createAuditLog } from './core';
import { getSettings } from './settings';
import { updateProductQuantity } from './products';
import { api, isApiMode } from '../apiClient';

type SaleDraft = Omit<Sale, 'id' | 'invoiceNumber' | 'createdAt'>;

export function getSales(): Sale[] {
  const sales = getStorage<Sale>(DB_KEYS.SALES);
  const payments = getStorage<Payment>(DB_KEYS.PAYMENTS);
  let changed = false;

  const fixedSales = sales.map((sale) => {
    const upfrontPayments = payments.filter(
      (payment) =>
        payment.type === 'in' &&
        payment.status !== 'voided' &&
        payment.affectsCustomerBalance === false &&
        (payment.saleId === sale.id || payment.referenceId === sale.id),
    );
    const duplicatedUpfront = upfrontPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const schedulePaidTotal =
      sale.financing?.schedules?.reduce((sum, schedule) => sum + Number(schedule.paidAmount || 0), 0) || 0;
    const amountToFix = Math.min(duplicatedUpfront, schedulePaidTotal);

    if (amountToFix <= 0) return sale;

    const nextSale: Sale = {
      ...sale,
      paid: Number(Math.max(Number(sale.paid || 0) - amountToFix, 0).toFixed(2)),
      financing: sale.financing
        ? {
            ...sale.financing,
            schedules: sale.financing.schedules ? [...sale.financing.schedules] : sale.financing.schedules,
          }
        : sale.financing,
    };

    if (nextSale.financing?.schedules?.length) {
      let amountToRemove = amountToFix;
      nextSale.financing.schedules = nextSale.financing.schedules.map((schedule) => {
        if (amountToRemove <= 0 || Number(schedule.paidAmount || 0) <= 0) return schedule;

        const removed = Math.min(Number(schedule.paidAmount || 0), amountToRemove);
        amountToRemove = Number((amountToRemove - removed).toFixed(2));
        const paidAmount = Number(Math.max(Number(schedule.paidAmount || 0) - removed, 0).toFixed(2));

        return {
          ...schedule,
          paidAmount,
          paidAt: paidAmount > 0 ? schedule.paidAt : undefined,
          status: paidAmount <= 0 ? 'unpaid' : paidAmount >= schedule.amount ? 'paid' : 'partial',
        };
      });
    }

    nextSale.remaining = Number(Math.max(Number(nextSale.total || 0) - Number(nextSale.paid || 0), 0).toFixed(2));
    nextSale.status = nextSale.remaining <= 0 ? 'completed' : 'pending';
    changed = true;
    return nextSale;
  });

  if (changed) {
    setStorage(DB_KEYS.SALES, fixedSales);
  }

  return fixedSales;
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
