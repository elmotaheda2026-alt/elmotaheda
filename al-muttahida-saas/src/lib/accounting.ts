import type { Expense, Product, Purchase, Sale } from '../types';

export const roundMoney = (value: number): number => Number(Number(value || 0).toFixed(2));

export function calculateLineTotal(quantity: number, unitPrice: number, discount = 0, tax = 0): number {
  return roundMoney(quantity * unitPrice - quantity * discount + quantity * tax);
}

export function calculateDocumentTotals(items: Array<{ quantity: number; unitPrice: number; discount: number; tax: number }>) {
  const subtotal = roundMoney(items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0));
  const discount = roundMoney(items.reduce((sum, item) => sum + item.quantity * item.discount, 0));
  const tax = roundMoney(items.reduce((sum, item) => sum + item.quantity * item.tax, 0));
  const total = roundMoney(subtotal - discount + tax);
  return { subtotal, discount, tax, total };
}

export function calculateCostOfGoodsSold(sales: Sale[], products: Product[]): number {
  const purchasePriceByProduct = new Map(products.map((product) => [product.id, Number(product.purchasePrice || 0)]));

  return roundMoney(
    sales.reduce(
      (saleSum, sale) =>
        saleSum +
        (sale.items || []).reduce((itemSum, item) => {
          const purchasePrice = purchasePriceByProduct.get(item.productId) || 0;
          return itemSum + item.quantity * purchasePrice;
        }, 0),
      0,
    ),
  );
}

export function calculateNetProfit(sales: Sale[], products: Product[], expenses: Expense[] = []): number {
  const revenue = sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
  const cogs = calculateCostOfGoodsSold(sales, products);
  const expenseTotal = expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  return roundMoney(revenue - cogs - expenseTotal);
}

export function calculateInventoryValue(products: Product[]): number {
  return roundMoney(products.reduce((sum, product) => sum + Number(product.quantity || 0) * Number(product.purchasePrice || 0), 0));
}

export function calculatePurchaseTotal(purchases: Purchase[]): number {
  return roundMoney(purchases.reduce((sum, purchase) => sum + Number(purchase.total || 0), 0));
}
