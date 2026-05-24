import { getSales } from './sales';
import { getPurchases } from './purchases';
import { getCustomers } from './customers';
import { getSuppliers } from './suppliers';
import { getProducts, getLowStockProducts } from './products';

export function getDashboardStats() {
  const sales = getSales();
  const purchases = getPurchases();
  const customers = getCustomers();
  const suppliers = getSuppliers();
  const products = getProducts();
  const lowStock = getLowStockProducts();

  const totalSales = sales.reduce((sum, s) => sum + s.total, 0);
  const totalPurchases = purchases.reduce((sum, p) => sum + p.total, 0);
  const totalProfit = totalSales - totalPurchases;
  const pendingPayments = [...customers, ...suppliers].reduce((sum, c) => sum + c.balance, 0);

  return {
    totalSales,
    totalPurchases,
    totalProfit,
    totalCustomers: customers.length,
    totalSuppliers: suppliers.length,
    totalProducts: products.length,
    lowStockItems: lowStock.length,
    pendingPayments,
  };
}
