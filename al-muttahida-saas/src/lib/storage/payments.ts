import { Payment, Sale, Customer, Supplier } from '../../types';
import { DB_KEYS, getStorage, setStorage, generateId, applyPaymentToSale, createAuditLog, getNextReceiptNumber } from './core';
import { createNotification } from './notifications';
import { api, isApiMode } from '../apiClient';

export function getPayments(): Payment[] {
  return getStorage<Payment>(DB_KEYS.PAYMENTS);
}

export async function syncPayments(): Promise<Payment[]> {
  if (!isApiMode()) return getPayments();
  const data = await api.listPayments();
  try {
    localStorage.removeItem(DB_KEYS.PAYMENTS);
  } catch {
    // Ignore storage cleanup failures; API data is still the source of truth.
  }
  return data;
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
      // Create notification showing customer name (if available)
      const customersList = getStorage<Customer>(DB_KEYS.CUSTOMERS);
      const linkedSaleInfo = saleIndex !== -1 ? sales[saleIndex] : null;
      const custId =
        payment.customerId ||
        (payment.referenceType === 'customer' ? payment.referenceId : undefined) ||
        linkedSaleInfo?.customerId;
      const cust = custId ? customersList.find(c => c.id === custId) : null;
      const clientName = cust ? cust.name : '';
       // استخراج رقم القسط من الوصف إن لم يكن موجودًا في installmentId
       const installmentMatch = newPayment.description?.match(/قسط\s+(\d+)/);
       const installmentNo = installmentMatch ? installmentMatch[1] : (newPayment.installmentId ?? '');
       void createNotification({
         type: newPayment.type === 'in' ? 'success' : 'warning',
         title: `حركة خزينة ${newPayment.type === 'in' ? 'وارد' : 'صادر'}`,
         message: `${newPayment.type === 'in' ? 'تم استلام' : 'تم سحب'} مبلغ ${Number(newPayment.amount || 0).toLocaleString('ar-EG')} جنيه من العميل ${clientName} لسداد القسط ${installmentNo} من الفاتورة ${newPayment.invoiceNumber || ''} (إيصال ${newPayment.receiptNumber || ''})`,
       });
    }
  } else {
    // Supplier payment handling (if needed). Currently no specific logic.
  }

  // Create audit log for payment creation
  createAuditLog({
    action: 'payment.create',
    entityType: 'payment',
    entityId: newPayment.id,
    payload: { amount: newPayment.amount, type: newPayment.type },
    createdBy: payment.createdBy ?? 'system',
  });

  return newPayment;
}

export function reversePayment(original: Payment, reason: string, reversedBy: string): Payment {
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
