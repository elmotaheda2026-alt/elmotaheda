import { Payment, Sale, Customer, Supplier } from '../../types';
import { DB_KEYS, getStorage, setStorage, generateId, applyPaymentToSale, createAuditLog, getNextReceiptNumber } from './core';
import { api, isApiMode } from '../apiClient';

export function getPayments(): Payment[] {
  return getStorage<Payment>(DB_KEYS.PAYMENTS);
}

export async function syncPayments(): Promise<void> {
  if (!isApiMode()) return;
  const data = await api.listPayments();
  setStorage(DB_KEYS.PAYMENTS, data);
}

export function createPayment(payment: Omit<Payment, 'id' | 'createdAt'>): Payment {
  if (isApiMode()) {
    throw new Error('لا يمكن حفظ الدفعة محليًا أثناء تشغيل وضع API. استخدم مسار API أو فعّل VITE_DATA_MODE=local للديمو.');
  }

  const sales = getStorage<Sale>(DB_KEYS.SALES);
  const saleId = payment.saleId || (payment.referenceType === 'sale' ? payment.referenceId : undefined);
  const saleIndex = payment.type === 'in' && saleId ? sales.findIndex((sale) => sale.id === saleId) : -1;
  if (saleIndex !== -1 && Number(payment.amount || 0) > Number(sales[saleIndex].remaining || 0)) {
    throw new Error('Payment amount cannot exceed the remaining sale balance.');
  }

  const payments = getStorage<Payment>(DB_KEYS.PAYMENTS);
  const newPayment: Payment = {
    ...payment,
    id: generateId(),
    createdAt: new Date().toISOString(),
    receiptNumber: payment.receiptNumber || getNextReceiptNumber(),
    status: payment.status || 'posted',
  };
  payments.push(newPayment);
  setStorage(DB_KEYS.PAYMENTS, payments);

  if (payment.type === 'in') {
    if (saleIndex !== -1 && payment.affectsCustomerBalance !== false) {
      sales[saleIndex] = applyPaymentToSale(sales[saleIndex], newPayment);
      sales[saleIndex].locked = true;
      setStorage(DB_KEYS.SALES, sales);
    }

    const customers = getStorage<Customer>(DB_KEYS.CUSTOMERS);
    const linkedSale = saleIndex !== -1 ? sales[saleIndex] : null;
    const customerId =
      payment.customerId ||
      (payment.referenceType === 'customer' ? payment.referenceId : undefined) ||
      linkedSale?.customerId;
    const shouldAffectBalance = payment.affectsCustomerBalance !== false;
    const index = customerId ? customers.findIndex((customer) => customer.id === customerId) : -1;

    if (shouldAffectBalance && index !== -1) {
      customers[index].balance = Number(Math.max(customers[index].balance - payment.amount, 0).toFixed(2));
      setStorage(DB_KEYS.CUSTOMERS, customers);
    }
  } else {
    const suppliers = getStorage<Supplier>(DB_KEYS.SUPPLIERS);
    const supplierId = payment.supplierId || (payment.referenceType === 'supplier' ? payment.referenceId : undefined);
    const index = supplierId ? suppliers.findIndex((supplier) => supplier.id === supplierId) : -1;
    if (index !== -1) {
      suppliers[index].balance = Number(Math.max(suppliers[index].balance - payment.amount, 0).toFixed(2));
      setStorage(DB_KEYS.SUPPLIERS, suppliers);
    }
  }

  createAuditLog({
    action: 'payment.create',
    entityType: 'payment',
    entityId: newPayment.id,
    payload: {
      type: newPayment.type,
      amount: newPayment.amount,
      receiptNumber: newPayment.receiptNumber,
      referenceType: newPayment.referenceType,
      referenceId: newPayment.referenceId,
    },
    createdBy: newPayment.createdBy || 'system',
  });

  return newPayment;
}

export function reversePayment(paymentId: string, reversedBy: string, reason = 'Reverse payment'): Payment {
  if (isApiMode()) {
    throw new Error('لا يمكن عكس الدفعة محليًا أثناء تشغيل وضع API.');
  }

  const payments = getStorage<Payment>(DB_KEYS.PAYMENTS);
  const original = payments.find((p) => p.id === paymentId);
  if (!original) throw new Error('الدفعة غير موجودة');
  if (original.status === 'voided') throw new Error('الدفعة ملغاة بالفعل');

  const reverse: Omit<Payment, 'id' | 'createdAt'> = {
    type: original.type === 'in' ? 'out' : 'in',
    amount: original.amount,
    referenceId: original.referenceId,
    referenceType: original.referenceType,
    description: `${reason} - عكس قيد للدفعة ${original.receiptNumber || original.id}`,
    date: new Date().toISOString().slice(0, 10),
    createdBy: reversedBy,
    customerId: original.customerId,
    supplierId: original.supplierId,
    saleId: original.saleId,
    installmentId: original.installmentId,
    invoiceNumber: original.invoiceNumber,
    affectsCustomerBalance: true,
    voidRef: original.id,
    approvedBy: reversedBy,
    channel: original.channel || 'other',
  };

  const reversed = createPayment(reverse);
  const updatedPayments = getStorage<Payment>(DB_KEYS.PAYMENTS).map((p) =>
    p.id === original.id ? { ...p, status: 'voided', voidRef: reversed.id, approvedBy: reversedBy } : p,
  );
  setStorage(DB_KEYS.PAYMENTS, updatedPayments);

  createAuditLog({
    action: 'payment.reverse',
    entityType: 'payment',
    entityId: original.id,
    payload: { reversedPaymentId: reversed.id, receiptNumber: original.receiptNumber },
    createdBy: reversedBy,
  });

  return reversed;
}
