import { getSales } from './sales';
import { getPurchases } from './purchases';
import { getCustomers } from './customers';
import { getSuppliers } from './suppliers';
import { getProducts, getLowStockProducts } from './products';
import { getExpenses } from './expenses';
import { calculateCostOfGoodsSold, calculateNetProfit, calculatePurchaseTotal } from '../accounting';

export function getDashboardStats() {
  const sales = getSales();
  const purchases = getPurchases();
  const customers = getCustomers();
  const suppliers = getSuppliers();
  const products = getProducts();
  const lowStock = getLowStockProducts();
  const expenses = getExpenses();

  const totalSales = sales.reduce((sum, s) => sum + s.total, 0);
  const totalPurchases = calculatePurchaseTotal(purchases);
  const totalProfit = calculateNetProfit(sales, products, expenses);
  const pendingPayments = customers.reduce((sum, c) => sum + c.balance, 0);
  const supplierPayables = suppliers.reduce((sum, s) => sum + s.balance, 0);

  return {
    totalSales,
    totalPurchases,
    costOfGoodsSold: calculateCostOfGoodsSold(sales, products),
    totalProfit,
    totalCustomers: customers.length,
    totalSuppliers: suppliers.length,
    totalProducts: products.length,
    lowStockItems: lowStock.length,
    pendingPayments,
    supplierPayables,
  };
}
