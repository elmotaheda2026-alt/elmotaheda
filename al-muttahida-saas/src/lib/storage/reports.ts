import { Sale } from '../../types';
import { getSales } from './sales';
import { getPurchases } from './purchases';
import { getProducts } from './products';
import { getExpenses } from './expenses';
import { getPayments } from './payments';
import { calculateCostOfGoodsSold, calculateNetProfit, roundMoney } from '../accounting';

const DAY_MS = 86400000;

function isWithinDateRange(date?: string, startDate?: string, endDate?: string) {
  if (!date) return false;
  if (startDate && date < startDate) return false;
  if (endDate && date > endDate) return false;
  return true;
}

function isPostedIncomingSalePayment(payment: ReturnType<typeof getPayments>[number]) {
  return (
    payment.type === 'in' &&
    payment.status !== 'voided' &&
    (payment.saleId || payment.referenceType === 'sale' || payment.invoiceNumber)
  );
}

function paymentSaleKey(payment: ReturnType<typeof getPayments>[number]) {
  return payment.saleId || (payment.referenceType === 'sale' ? payment.referenceId : '') || payment.invoiceNumber || '';
}

function getSaleUnitCostTotal(sale: Sale) {
  const products = getProducts();
  return calculateCostOfGoodsSold([sale], products);
}

export function getSalesReport(startDate?: string, endDate?: string) {
  return getSales().filter((sale) => isWithinDateRange(sale.date, startDate, endDate));
}

export function getPurchasesReport(startDate?: string, endDate?: string) {
  return getPurchases().filter((purchase) => isWithinDateRange(purchase.date, startDate, endDate));
}

export function getInventoryReport() {
  return getProducts().map((product) => ({
    ...product,
    status: product.quantity <= product.minQuantity ? 'منخفض' : 'متوفر',
    value: product.quantity * product.purchasePrice,
  }));
}

export function getProfitLossReport(startDate?: string, endDate?: string) {
  const sales = getSalesReport(startDate, endDate);
  const purchases = getPurchasesReport(startDate, endDate);
  const expenses = getExpenses().filter((expense) => isWithinDateRange(expense.date, startDate, endDate));

  const totalSales = sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
  const totalPurchases = purchases.reduce((sum, purchase) => sum + Number(purchase.total || 0), 0);
  const costOfGoodsSold = calculateCostOfGoodsSold(sales, getProducts());
  const totalExpenses = expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const profit = calculateNetProfit(sales, getProducts(), expenses);

  return {
    totalSales,
    totalPurchases,
    costOfGoodsSold,
    totalExpenses,
    profit,
    salesCount: sales.length,
    purchasesCount: purchases.length,
  };
}

export function getAgingReport(referenceDate = new Date().toISOString().slice(0, 10)) {
  const ref = new Date(referenceDate).getTime();
  const rows: Array<{ saleId: string; invoiceNumber: string; customerName: string; remaining: number; dpd: number; bucket: string; dueDate: string }> = [];

  getSales()
    .filter((sale) => Number(sale.remaining || 0) > 0)
    .forEach((sale) => {
      const schedules = sale.financing?.schedules || [];
      if (schedules.length) {
        schedules.forEach((schedule) => {
          const remaining = roundMoney(Number(schedule.amount || 0) - Number(schedule.paidAmount || 0));
          const dueTime = new Date(schedule.dueDate).getTime();
          if (remaining <= 0 || Number.isNaN(dueTime) || dueTime > ref) return;
          const dpd = Math.floor((ref - dueTime) / DAY_MS);
          const bucket = dpd <= 30 ? '0-30' : dpd <= 60 ? '31-60' : dpd <= 90 ? '61-90' : '90+';
          rows.push({ saleId: sale.id, invoiceNumber: sale.invoiceNumber, customerName: sale.customerName, remaining, dpd, bucket, dueDate: schedule.dueDate });
        });
        return;
      }

      const dueTime = new Date(sale.date).getTime();
      if (Number.isNaN(dueTime) || dueTime > ref) return;
      const dpd = Math.floor((ref - dueTime) / DAY_MS);
      const bucket = dpd <= 30 ? '0-30' : dpd <= 60 ? '31-60' : dpd <= 90 ? '61-90' : '90+';
      rows.push({ saleId: sale.id, invoiceNumber: sale.invoiceNumber, customerName: sale.customerName, remaining: Number(sale.remaining || 0), dpd, bucket, dueDate: sale.date });
    });

  return rows;
}

export function getCollectionRateReport(startDate?: string, endDate?: string) {
  const sales = getSalesReport(startDate, endDate);
  const saleIds = new Set(sales.map((sale) => sale.id));
  const invoiceNumbers = new Set(sales.map((sale) => sale.invoiceNumber));
  const payments = getPayments().filter(
    (payment) =>
      isPostedIncomingSalePayment(payment) &&
      isWithinDateRange(payment.date, startDate, endDate) &&
      (saleIds.has(payment.saleId || '') || (payment.referenceType === 'sale' && saleIds.has(payment.referenceId)) || invoiceNumbers.has(payment.invoiceNumber || '')),
  );
  const billed = sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
  const collected = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  return {
    billed,
    collected,
    collectionRate: billed > 0 ? Number(((collected / billed) * 100).toFixed(2)) : 0,
  };
}

export function getDailyCashMovementReport(date: string) {
  const payments = getPayments().filter((payment) => payment.date === date && payment.status !== 'voided');
  const cashIn = payments.filter((payment) => payment.type === 'in').reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const cashOut = payments.filter((payment) => payment.type === 'out').reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  return { date, cashIn, cashOut, net: cashIn - cashOut, count: payments.length };
}

export function getRealizedProfitReport(startDate?: string, endDate?: string) {
  const sales = getSales();
  const saleById = new Map(sales.map((sale) => [sale.id, sale]));
  const saleByInvoice = new Map(sales.map((sale) => [sale.invoiceNumber, sale]));
  const payments = getPayments().filter(
    (payment) => isPostedIncomingSalePayment(payment) && isWithinDateRange(payment.date, startDate, endDate),
  );

  const grossRealized = payments.reduce((sum, payment) => {
    const sale = saleById.get(payment.saleId || '') ||
      (payment.referenceType === 'sale' ? saleById.get(payment.referenceId) : undefined) ||
      saleByInvoice.get(payment.invoiceNumber || '');
    if (!sale || Number(sale.total || 0) <= 0) return sum;
    const saleCost = getSaleUnitCostTotal(sale);
    const marginRatio = Math.max(0, (Number(sale.total || 0) - saleCost) / Number(sale.total || 0));
    return sum + Number(payment.amount || 0) * marginRatio;
  }, 0);

  const expenses = getExpenses()
    .filter((expense) => isWithinDateRange(expense.date, startDate, endDate))
    .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);

  return {
    collected: payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
    grossRealized: roundMoney(grossRealized),
    expenses: roundMoney(expenses),
    netRealized: roundMoney(grossRealized - expenses),
  };
}

export function getReceivablesReconciliationReport(startDate?: string, endDate?: string) {
  const sales = getSalesReport(startDate, endDate);
  const totalDeferredSales = sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
  const totalCollected = sales.reduce((sum, sale) => sum + Number(sale.paid || 0), 0);
  const totalRemaining = sales.reduce((sum, sale) => sum + Number(sale.remaining || 0), 0);
  const variance = roundMoney(totalDeferredSales - totalCollected - totalRemaining);
  return { totalDeferredSales, totalCollected, totalRemaining, variance, hasAlert: Math.abs(variance) > 0.009 };
}
