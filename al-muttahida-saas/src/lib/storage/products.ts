import { Product } from '../../types';
import { DB_KEYS, getStorage, setStorage, generateId } from './core';

function normalizeProduct(product: Product): Product {
  return {
    ...product,
    fulfillmentType: product.fulfillmentType || 'stocked',
  };
}

export function getProducts(): Product[] {
  return getStorage<Product>(DB_KEYS.PRODUCTS).map(normalizeProduct);
}

export function createProduct(product: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>): Product {
  const products = getStorage<Product>(DB_KEYS.PRODUCTS);
  const newProduct: Product = {
    ...product,
    fulfillmentType: product.fulfillmentType || 'stocked',
    id: generateId(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  products.push(newProduct);
  setStorage(DB_KEYS.PRODUCTS, products);
  return newProduct;
}

export function updateProduct(id: string, updates: Partial<Product>): Product | null {
  const products = getStorage<Product>(DB_KEYS.PRODUCTS);
  const index = products.findIndex((p) => p.id === id);
  if (index !== -1) {
    products[index] = {
      ...normalizeProduct(products[index]),
      ...updates,
      fulfillmentType: updates.fulfillmentType || products[index].fulfillmentType || 'stocked',
      updatedAt: new Date().toISOString(),
    };
    setStorage(DB_KEYS.PRODUCTS, products);
    return normalizeProduct(products[index]);
  }
  return null;
}

export function deleteProduct(id: string): boolean {
  const products = getStorage<Product>(DB_KEYS.PRODUCTS);
  const filtered = products.filter((p) => p.id !== id);
  if (filtered.length !== products.length) {
    setStorage(DB_KEYS.PRODUCTS, filtered);
    return true;
  }
  return false;
}

export function updateProductQuantity(productId: string, quantityChange: number): void {
  const products = getStorage<Product>(DB_KEYS.PRODUCTS);
  const index = products.findIndex((p) => p.id === productId);
  if (index !== -1) {
    products[index].quantity += quantityChange;
    products[index].updatedAt = new Date().toISOString();
    setStorage(DB_KEYS.PRODUCTS, products);
  }
}

export function getLowStockProducts(): Product[] {
  const products = getStorage<Product>(DB_KEYS.PRODUCTS);
  return products
    .map(normalizeProduct)
    .filter((product) => product.fulfillmentType === 'stocked' && product.quantity <= product.minQuantity);
}
