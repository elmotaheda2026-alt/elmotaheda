import fs from 'fs';
import path from 'path';

const filePath = 'c:/Users/Administrator/Desktop/elmotaheda/al-muttahida-saas/src/lib/storage/sales.ts';
let content = fs.readFileSync(filePath, 'utf8');

// Normalize line endings
content = content.replace(/\r\n/g, '\n');

const target = `export async function syncSales(): Promise<void> {
  if (!isApiMode()) return;
  const data = await api.listSales();
  setStorage(DB_KEYS.SALES, data);
}

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
}`.replace(/\r\n/g, '\n');

const replacement = `export async function syncSales(customerId?: string): Promise<void> {
  if (!isApiMode()) return;
  const data = await api.listSales(customerId);
  if (customerId) {
    const sales = getStorage<Sale>(DB_KEYS.SALES);
    const otherSales = sales.filter((s) => s.customerId !== customerId);
    setStorage(DB_KEYS.SALES, [...otherSales, ...data]);
  } else {
    setStorage(DB_KEYS.SALES, data);
  }
}

export function getSales(customerIds?: string[]): Sale[] {
  let sales = getStorage<Sale>(DB_KEYS.SALES);
  
  if (customerIds) {
    if (customerIds.length === 0) return [];
    sales = sales.filter((sale) => customerIds.includes(sale.customerId));
  }

  const payments = getStorage<Payment>(DB_KEYS.PAYMENTS);
  
  // Build a lookup map of payments by saleId/referenceId to reduce complexity from O(N * M) to O(N + M)
  const paymentsBySale = new Map<string, Payment[]>();
  payments.forEach((payment) => {
    if (
      payment.type === 'in' &&
      payment.status !== 'voided' &&
      payment.affectsCustomerBalance === false
    ) {
      const sId = payment.saleId || payment.referenceId;
      if (sId) {
        let list = paymentsBySale.get(sId);
        if (!list) {
          list = [];
          paymentsBySale.set(sId, list);
        }
        list.push(payment);
      }
    }
  });

  let changed = false;

  const fixedSales = sales.map((sale) => {
    const upfrontPayments = paymentsBySale.get(sale.id) || [];
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

  if (changed && !customerIds) {
    setStorage(DB_KEYS.SALES, fixedSales);
  }

  return fixedSales;
}`.replace(/\r\n/g, '\n');

if (content.includes(target)) {
  const updatedContent = content.replace(target, replacement);
  fs.writeFileSync(filePath, updatedContent, 'utf8');
  console.log('Success: storage/sales.ts has been updated successfully!');
} else {
  console.error('Error: target content not found in the file!');
}
