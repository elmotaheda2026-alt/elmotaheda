// Types for Al Muttahida SaaS ERP System

export interface User {
  id: string;
  name: string;
  email: string;
  password: string;
  role: 'admin' | 'manager' | 'user';
  phone?: string;
  avatar?: string;
  createdAt: string;
  lastLogin?: string;
  isActive: boolean;
}

export interface Guarantor {
  name: string;
  address: string;
  nationalId: string;
  phone: string;
  relationship: string;
}

export interface Customer {
  id: string;
  customerNumber: string;
  name: string;
  phone: string;
  email?: string;
  address: string;
  gender: 'male' | 'female';
  city: string;
  governorate: string;
  region: string;
  dateOfBirth: string;
  nationalId: string;
  age: number;
  pensionDate: string;
  balance: number;
  balanceType: 'debtor' | 'creditor'; // مدين / دائن
  notes?: string;
  image?: string;
  guarantors: [Guarantor | null, Guarantor | null, Guarantor | null];
  createdAt: string;
  updatedAt: string;
}

export interface Supplier {
  id: string;
  name: string;
  phone: string;
  email?: string;
  address: string;
  balance: number; // رصيد المورد
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  id: string;
  name: string;
  barcode: string;
  category: string;
  unit: string; // وحدة القياس
  purchasePrice: number;
  salePrice: number;
  discount: number;
  tax: number;
  quantity: number; // الكمية في المخزون
  minQuantity: number; // الحد الأدنى للمخزون
  image?: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Sale {
  id: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  items: SaleItem[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  paid: number;
  remaining: number;
  status: 'pending' | 'completed' | 'cancelled';
  date: string;
  notes?: string;
  createdBy: string;
  createdAt: string;
}

export interface SaleItem {
  productId: string;
  productName: string;
  barcode: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  tax: number;
  total: number;
}

export interface Purchase {
  id: string;
  invoiceNumber: string;
  supplierId: string;
  supplierName: string;
  items: PurchaseItem[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  paid: number;
  remaining: number;
  status: 'pending' | 'completed' | 'cancelled';
  date: string;
  notes?: string;
  createdBy: string;
  createdAt: string;
}

export interface PurchaseItem {
  productId: string;
  productName: string;
  barcode: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  tax: number;
  total: number;
}

export interface Payment {
  id: string;
  type: 'in' | 'out'; // in = من عميل، out = لمورد
  amount: number;
  referenceId: string; // invoice id or customer/supplier id
  referenceType: 'customer' | 'supplier' | 'sale' | 'purchase' | 'other';
  description: string;
  date: string;
  createdBy: string;
  createdAt: string;
}

export interface Expense {
  id: string;
  category: string;
  description: string;
  amount: number;
  date: string;
  receipt?: string;
  createdBy: string;
  createdAt: string;
}

export interface Setting {
  companyName: string;
  companyAddress: string;
  companyPhone: string;
  companyEmail: string;
  taxRate: number;
  currency: string;
  invoicePrefix: string;
  invoiceFooter?: string;
}

export interface Notification {
  id: string;
  type: 'info' | 'warning' | 'success' | 'error';
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

export interface SalesRep {
  id: string;
  name: string;
  phone: string;
  email?: string;
  address: string;
  area: string;
  target: number; // الهدف الشهري
  achieved: number;
  commission: number;
  isActive: boolean;
  createdAt: string;
}

export interface DashboardStats {
  totalSales: number;
  totalPurchases: number;
  totalProfit: number;
  totalCustomers: number;
  totalSuppliers: number;
  totalProducts: number;
  lowStockItems: number;
  pendingPayments: number;
}
