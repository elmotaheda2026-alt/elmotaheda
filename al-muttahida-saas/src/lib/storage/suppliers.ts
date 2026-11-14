import { Payment, Purchase, Supplier, SupplierStatement, SupplierLedgerTransaction } from '../../types';
import { DB_KEYS, getStorage, setStorage, generateId } from './core';
import { api, isApiMode } from '../apiClient';
import { formatDateDisplay } from '../dateUtils';

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
  const supplier = suppliers.find((item) => item.id === id);
  if (!supplier) return false;
  if (Number(supplier.balance || 0) > 0) {
    throw new Error('لا يمكن حذف المورد قبل تصفية الرصيد المستحق له.');
  }

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

export async function getSupplierStatement(id: string): Promise<SupplierStatement> {
  if (isApiMode()) {
    return api.getSupplierStatement(id);
  }

  // Local storage fallback
  const suppliers = getStorage<Supplier>(DB_KEYS.SUPPLIERS);
  const supplier = suppliers.find((s) => s.id === id);
  if (!supplier) {
    throw new Error('المورد غير موجود');
  }

  const allPurchases = getStorage<Purchase>(DB_KEYS.PURCHASES);
  const purchases = allPurchases.filter((p) => p.supplierId === id);

  const allPayments = getStorage<Payment>(DB_KEYS.PAYMENTS);
  const payments = allPayments.filter(
    (pay) => pay.supplierId === id || (pay.referenceType === 'supplier' && pay.referenceId === id),
  );

  const currentBalance = Number(supplier.balance || 0);
  const sumPurchasesRemaining = purchases.reduce((acc, p) => acc + Number(p.remaining || 0), 0);
  const sumPaymentsOut = payments
    .filter((p) => p.type === 'out')
    .reduce((acc, p) => acc + Number(p.amount || 0), 0);
  const sumPaymentsIn = payments
    .filter((p) => p.type === 'in')
    .reduce((acc, p) => acc + Number(p.amount || 0), 0);

  const calculatedOpening = Number((currentBalance - sumPurchasesRemaining + sumPaymentsOut - sumPaymentsIn).toFixed(2));
  const openingBalance = Math.max(0, calculatedOpening);

  const rawEvents: Array<{
    date: string;
    createdAt: string;
    type: 'opening_balance' | 'purchase' | 'payment_out' | 'payment_in';
    data: any;
  }> = [];

  if (openingBalance > 0) {
    rawEvents.push({
      date: supplier.createdAt || '2000-01-01',
      createdAt: supplier.createdAt || '2000-01-01',
      type: 'opening_balance',
      data: {
        id: `op-${supplier.id}`,
        amount: openingBalance,
        notes: supplier.notes || 'رصيد افتتاحي سابق للمورد',
      },
    });
  }

  for (const p of purchases) {
    rawEvents.push({
      date: p.date,
      createdAt: p.createdAt,
      type: 'purchase',
      data: p,
    });
  }

  for (const pay of payments) {
    rawEvents.push({
      date: pay.date,
      createdAt: pay.createdAt,
      type: pay.type === 'in' ? 'payment_in' : 'payment_out',
      data: pay,
    });
  }

  rawEvents.sort((a, b) => {
    if (a.type === 'opening_balance') return -1;
    if (b.type === 'opening_balance') return 1;
    const da = new Date(a.date).getTime() || 0;
    const dbDate = new Date(b.date).getTime() || 0;
    if (da !== dbDate) return da - dbDate;
    const ca = new Date(a.createdAt).getTime() || 0;
    const cb = new Date(b.createdAt).getTime() || 0;
    return ca - cb;
  });

  let running = 0;
  const transactions: SupplierLedgerTransaction[] = [];

  for (const ev of rawEvents) {
    if (ev.type === 'opening_balance') {
      const amt = Number(ev.data.amount);
      running += amt;
      transactions.push({
        id: ev.data.id,
        date: formatDateDisplay(ev.date),
        rawDate: ev.date,
        type: 'opening_balance',
        typeLabel: 'الرصيد',
        docNumber: '—',
        description: ev.data.notes || 'الرصيد المسجل للمورد',
        credit: amt,
        debit: 0,
        runningBalance: running,
      });
    } else if (ev.type === 'purchase') {
      const p = ev.data;
      const total = Number(p.total || 0);
      const paid = Number(p.paid || 0);

      if (paid > 0) {
        running += total;
        transactions.push({
          id: p.id,
          date: formatDateDisplay(p.date),
          rawDate: p.date,
          type: 'purchase',
          typeLabel: 'فاتورة مشتريات',
          docNumber: p.invoiceNumber,
          description: p.notes ? `فاتورة مشتريات - ${p.notes}` : 'فاتورة مشتريات بضاعة',
          credit: total,
          debit: 0,
          runningBalance: running,
          items: (p.items || []).map((it: any) => ({
            productName: it.productName,
            barcode: it.barcode,
            quantity: Number(it.quantity),
            unitPrice: Number(it.unitPrice),
            total: Number(it.total),
          })),
          createdBy: p.createdBy,
        });

        running -= paid;
        transactions.push({
          id: `downpayment-${p.id}`,
          date: formatDateDisplay(p.date),
          rawDate: p.date,
          type: 'purchase_downpayment',
          typeLabel: 'دفعة مسددة مع الفاتورة',
          docNumber: p.invoiceNumber,
          description: `سداد نقدي فوري مع الفاتورة رقم ${p.invoiceNumber}`,
          credit: 0,
          debit: paid,
          runningBalance: running,
        });
      } else {
        running += total;
        transactions.push({
          id: p.id,
          date: formatDateDisplay(p.date),
          rawDate: p.date,
          type: 'purchase',
          typeLabel: 'فاتورة مشتريات',
          docNumber: p.invoiceNumber,
          description: p.notes ? `فاتورة مشتريات - ${p.notes}` : 'فاتورة مشتريات بضاعة',
          credit: total,
          debit: 0,
          runningBalance: running,
          items: (p.items || []).map((it: any) => ({
            productName: it.productName,
            barcode: it.barcode,
            quantity: Number(it.quantity),
            unitPrice: Number(it.unitPrice),
            total: Number(it.total),
          })),
          createdBy: p.createdBy,
        });
      }
    } else if (ev.type === 'payment_out') {
      const pay = ev.data;
      const amt = Number(pay.amount || 0);
      running = Math.max(0, running - amt);
      transactions.push({
        id: pay.id,
        date: formatDateDisplay(pay.date),
        rawDate: pay.date,
        type: 'payment_out',
        typeLabel: 'سداد دفعة للمورد',
        docNumber: pay.receiptNumber || '—',
        description: pay.description || 'سند صرف نقدي للمورد',
        credit: 0,
        debit: amt,
        runningBalance: running,
        createdBy: pay.createdBy,
      });
    } else if (ev.type === 'payment_in') {
      const pay = ev.data;
      const amt = Number(pay.amount || 0);
      running += amt;
      transactions.push({
        id: pay.id,
        date: formatDateDisplay(pay.date),
        rawDate: pay.date,
        type: 'payment_in',
        typeLabel: 'استرداد نقدي من المورد',
        docNumber: pay.receiptNumber || '—',
        description: pay.description || 'سند قبض / استرداد من المورد',
        credit: amt,
        debit: 0,
        runningBalance: running,
        createdBy: pay.createdBy,
      });
    }
  }

  return {
    supplier,
    summary: {
      openingBalance,
      totalPurchasesAmount: purchases.reduce((acc, p) => acc + Number(p.total || 0), 0),
      totalPaymentsAmount: sumPaymentsOut + purchases.reduce((acc, p) => acc + Number(p.paid || 0), 0),
      currentBalance,
      purchasesCount: purchases.length,
      paymentsCount: payments.length,
    },
    transactions,
  };
}
