import { getSales } from './sales';
import { getPurchases } from './purchases';
import { getProducts } from './products';
import { getExpenses } from './expenses';
import { getPayments } from './payments';

export function getSalesReport(startDate?: string, endDate?: string) {
  const sales = getSales();
  return sales.filter((s) => {
    if (startDate && s.date < startDate) return false;
    if (endDate && s.date > endDate) return false;
    return true;
  });
}

export function getPurchasesReport(startDate?: string, endDate?: string) {
  const purchases = getPurchases();
  return purchases.filter((p) => {
    if (startDate && p.date < startDate) return false;
    if (endDate && p.date > endDate) return false;
    return true;
  });
}

export function getInventoryReport() {
  return getProducts().map((p) => ({
    ...p,
    status: p.quantity <= p.minQuantity ? 'منخفض' : 'متوفر',
    value: p.quantity * p.purchasePrice,
  }));
}

export function getProfitLossReport(startDate?: string, endDate?: string) {
  const sales = getSalesReport(startDate, endDate);
  const purchases = getPurchasesReport(startDate, endDate);
  const expenses = getExpenses().filter((e) => {
    if (startDate && e.date < startDate) return false;
    if (endDate && e.date > endDate) return false;
    return true;
  });

  const totalSales = sales.reduce((sum, s) => sum + s.total, 0);
  const totalPurchases = purchases.reduce((sum, p) => sum + p.total, 0);
  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
  const profit = totalSales - totalPurchases - totalExpenses;

  return {
    totalSales,
    totalPurchases,
    totalExpenses,
    profit,
    salesCount: sales.length,
    purchasesCount: purchases.length,
  };
}

export function getAgingReport(referenceDate = new Date().toISOString().slice(0, 10)) {
  const sales = getSales();
  const ref = new Date(referenceDate);
  const rows = sales
    .filter((s) => s.remaining > 0)
    .map((sale) => {
      const dueDate = sale.financing?.schedules?.find((x) => x.status !== 'paid')?.dueDate || sale.date;
      const diffDays = Math.max(0, Math.floor((ref.getTime() - new Date(dueDate).getTime()) / 86400000));
      const bucket = diffDays <= 30 ? '0-30' : diffDays <= 60 ? '31-60' : diffDays <= 90 ? '61-90' : '90+';
      return { saleId: sale.id, invoiceNumber: sale.invoiceNumber, customerName: sale.customerName, remaining: sale.remaining, dpd: diffDays, bucket };
    });
  return rows;
}

export function getCollectionRateReport(startDate?: string, endDate?: string) {
  const sales = getSalesReport(startDate, endDate);
  const payments = getPayments().filter((p) => p.type === 'in' && (!startDate || p.date >= startDate) && (!endDate || p.date <= endDate));
  const billed = sales.reduce((sum, s) => sum + s.total, 0);
  const collected = payments.reduce((sum, p) => sum + p.amount, 0);
  return {
    billed,
    collected,
    collectionRate: billed > 0 ? Number(((collected / billed) * 100).toFixed(2)) : 0,
  };
}

export function getDailyCashMovementReport(date: string) {
  const payments = getPayments().filter((p) => p.date === date && p.status !== 'voided');
  const cashIn = payments.filter((p) => p.type === 'in').reduce((sum, p) => sum + p.amount, 0);
  const cashOut = payments.filter((p) => p.type === 'out').reduce((sum, p) => sum + p.amount, 0);
  return { date, cashIn, cashOut, net: cashIn - cashOut, count: payments.length };
}

export function getReceivablesReconciliationReport() {
  const sales = getSales();
  const totalDeferredSales = sales.reduce((sum, s) => sum + s.total, 0);
  const totalCollected = sales.reduce((sum, s) => sum + s.paid, 0);
  const totalRemaining = sales.reduce((sum, s) => sum + s.remaining, 0);
  const variance = Number((totalDeferredSales - totalCollected - totalRemaining).toFixed(2));
  return { totalDeferredSales, totalCollected, totalRemaining, variance, hasAlert: Math.abs(variance) > 0.009 };
}
