import { Product } from '../../types';
import { DB_KEYS, getStorage, setStorage, generateId } from './core';
import { api, isApiMode } from '../apiClient';

function normalizeProduct(product: Product): Product {
  return {
    ...product,
    fulfillmentType: product.fulfillmentType || 'stocked',
  };
}

export function getProducts(): Product[] {
  return getStorage<Product>(DB_KEYS.PRODUCTS).map(normalizeProduct);
}

export async function syncProducts(): Promise<void> {
  if (!isApiMode()) return;
  const data = await api.listProducts();
  setStorage(DB_KEYS.PRODUCTS, data);
}

export async function createProduct(product: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>): Promise<Product> {
  if (isApiMode()) {
    const res = await api.createProduct(product);
    const newProduct: Product = {
      ...product,
      id: res.id,
      fulfillmentType: product.fulfillmentType || 'stocked',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as Product;
    const products = getStorage<Product>(DB_KEYS.PRODUCTS);
    products.push(newProduct);
    setStorage(DB_KEYS.PRODUCTS, products);
    return newProduct;
  }

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

export async function updateProduct(id: string, updates: Partial<Product>): Promise<Product | null> {
  if (isApiMode()) {
    await api.updateProduct(id, updates);
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

export async function deleteProduct(id: string): Promise<boolean> {
  if (isApiMode()) {
    await api.deleteProduct(id);
    const products = getStorage<Product>(DB_KEYS.PRODUCTS);
    const filtered = products.filter((p) => p.id !== id);
    if (filtered.length !== products.length) {
      setStorage(DB_KEYS.PRODUCTS, filtered);
      return true;
    }
    return false;
  }

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
