export type Permission =
  | 'dashboard:view'
  | 'sales:read'
  | 'sales:write'
  | 'sales:reschedule'
  | 'sales:transfer'
  | 'sales:guarantors'
  | 'payments:read'
  | 'payments:write'
  | 'payments:reverse'
  | 'payments:early_settlement'
  | 'reports:read'
  | 'closing:write'
  | 'users:manage'
  | 'inventory:manage'
  | 'purchases:manage'
  | 'settings:manage'
  | 'shareholders:manage'
  | 'notifications:read';

export type UserPermissions = Partial<Record<Permission, boolean>>;

export interface User {
  id: string;
  name: string;
  username: string;
  password: string;
  role: 'admin' | 'manager' | 'accountant' | 'user' | 'collector' | 'reviewer' | 'finance_manager';
  permissions?: UserPermissions | null;
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

export interface SaleGuarantorRecord extends Guarantor {
  id: string;
  saleId: string;
  slot: 1 | 2 | 3;
  status: 'active' | 'replaced';
  replacedAt?: string | null;
  replacedBy?: string | null;
  replaceReason?: string | null;
  remainingAtReplace?: number | null;
  createdAt: string;
  updatedAt: string;
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
  balanceType: 'debtor';
  notes?: string;
  image?: string;
  idCardFront?: string;
  idCardBack?: string;
  guarantors: [Guarantor | null, Guarantor | null, Guarantor | null];
  isSued?: boolean;
  suedDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Supplier {
  id: string;
  name: string;
  phone: string;
  email?: string;
  address: string;
  balance: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierLedgerItem {
  productName: string;
  barcode?: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  tax?: number;
  total: number;
}

export interface SupplierLedgerTransaction {
  id: string;
  date: string;
  rawDate: string;
  type: 'opening_balance' | 'purchase' | 'payment_out' | 'payment_in' | 'purchase_downpayment';
  typeLabel: string;
  docNumber: string;
  description: string;
  credit: number;
  debit: number;
  runningBalance: number;
  items?: SupplierLedgerItem[];
  createdBy?: string;
}

export interface SupplierStatement {
  supplier: Supplier;
  summary: {
    openingBalance: number;
    totalPurchasesAmount: number;
    totalPaymentsAmount: number;
    currentBalance: number;
    purchasesCount: number;
    paymentsCount: number;
  };
  transactions: SupplierLedgerTransaction[];
}

export interface Product {
  id: string;
  name: string;
  barcode?: string;
  category: string;
  fulfillmentType: 'stocked' | 'on_demand';
  unit: string;
  purchasePrice: number;
  salePrice: number;
  discount: number;
  tax: number;
  quantity: number;
  minQuantity: number;
  image?: string;
  idCardFront?: string;
  idCardBack?: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SaleItem {
  productId: string;
  productName: string;
  barcode?: string;
  quantity: number;
  unitPrice: number;
  unitCost?: number;
  discount: number;
  tax: number;
  total: number;
  fulfillmentType?: 'stocked' | 'on_demand';
}

export interface InstallmentSchedule {
  id: string;
  monthIndex: number;
  label: string;
  dueDate: string;
  amount: number;
  paidAmount: number;
  paidAt?: string;
  status: 'paid' | 'partial' | 'unpaid' | 'settled_early';
  deferred?: boolean;
  deferredAt?: string;
  notes?: string;
}

export interface SaleFinancing {
  paymentMethod: 'cash' | 'card' | 'transfer' | 'installment';
  manualInvoiceRef?: string;
  salesRepId?: string;
  salesRepName?: string;
  commissionRate?: number;
  commissionAmount?: number;
  installmentMonths?: number;
  installmentStartDate?: string;
  upfrontAmount?: number;
  monthlyInstallmentAmount?: number;
  schedules?: InstallmentSchedule[];
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
  status: 'pending' | 'completed' | 'cancelled' | 'settled_early';
  date: string;
  notes?: string;
  createdBy: string;
  createdAt: string;
  version?: number;
  locked?: boolean;
  lastEditedBy?: string;
  lastEditedAt?: string;
  financing?: SaleFinancing;
  guarantors?: [Guarantor | null, Guarantor | null, Guarantor | null];
  guarantorRecords?: SaleGuarantorRecord[];
  guarantorHistoryCount?: number;
}

export interface PurchaseItem {
  productId: string;
  productName: string;
  barcode?: string;
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

export interface Payment {
  id: string;
  type: 'in' | 'out';
  amount: number;
  referenceId: string;
  referenceType: 'customer' | 'supplier' | 'sale' | 'purchase' | 'expense' | 'internal_transfer' | 'other';
  description: string;
  date: string;
  createdBy: string;
  createdAt: string;
  customerId?: string;
  supplierId?: string;
  saleId?: string;
  installmentId?: string;
  invoiceNumber?: string;
  affectsCustomerBalance?: boolean;
  receiptNumber?: string;
  voidRef?: string;
  approvedBy?: string;
  channel?: string;
  status?: 'posted' | 'voided';
  isEarlySettlement?: boolean;
  settlementDiscount?: number;
}

export interface InstallmentCollectionTask {
  id: string;
  customerId: string;
  customerName: string;
  saleId: string;
  installmentId: string;
  dueDate: string;
  amount: number;
  status: 'open' | 'visited' | 'collected' | 'failed' | 'cancelled';
  assignedToUserId?: string;
  assignedToName?: string;
  visitNotes?: string;
  visitResult?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RescheduleRequest {
  id: string;
  saleId: string;
  customerId: string;
  reason: string;
  requestedBy: string;
  requestedAt: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy?: string;
  reviewedAt?: string;
  oldInstallmentMonths: number;
  newInstallmentMonths: number;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  payload?: Record<string, any>;
  createdBy: string;
  createdAt: string;
}

export interface ClosingPeriod {
  id: string;
  periodType: 'daily' | 'monthly';
  periodDate: string;
  status: 'open' | 'closed';
  closedBy?: string;
  closedAt?: string;
  notes?: string;
  totalIn?: number;
  totalOut?: number;
  netMovement?: number;
  closingBalance?: number;
}

export interface Expense {
  id: string;
  category: string;
  description: string;
  amount: number;
  date: string;
  receipt?: string;
  channel?: Payment['channel'];
  createdBy: string;
  createdAt: string;
}

export interface PaymentChannelConfig {
  id: string;
  label: string;
  icon: 'cash' | 'wallet' | 'bank' | 'instapay' | 'card';
  color: 'emerald' | 'rose' | 'blue' | 'violet' | 'amber' | 'slate';
  isDefault?: boolean;
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
  whatsappRemindersEnabled?: boolean;
  whatsappMode?: 'web_session' | 'meta_api';
  whatsappPhoneNumberId?: string;
  whatsappAccessToken?: string;
  whatsappTemplateName?: string;
  whatsappTemplateLanguage?: string;
  whatsappMessageTemplate?: string;
  whatsappReminderOffsets?: number[];
  whatsappMinDelaySec?: number;
  whatsappMaxDelaySec?: number;
  whatsappDailyLimit?: number;
  whatsappBatchSize?: number;
  whatsappBatchPauseSec?: number;
  whatsappSendStartHour?: string;
  whatsappSendEndHour?: string;
  whatsappAntiBanVariation?: boolean;
  whatsappAutoSkipInvalid?: boolean;
  rolePermissions?: Partial<Record<User['role'], Permission[]>>;
  paymentChannels?: PaymentChannelConfig[];
  isConfigured?: boolean;
}


export interface OpeningBalances {
  startingCashBalance: number;
  startingReceivables: number;
  startingPayables: number;
  startingInventoryValue: number;
  updatedAt: string;
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
  target: number;
  achieved: number;
  commission: number;
  isActive: boolean;
  createdAt: string;
}

export interface DashboardStats {
  totalSales: number;
  totalPurchases: number;
  costOfGoodsSold?: number;
  totalProfit: number;
  totalCustomers: number;
  totalSuppliers: number;
  totalProducts: number;
  lowStockItems: number;
  pendingPayments: number;
  supplierPayables?: number;
}

export interface Shareholder {
  id: string;
  name: string;
  phone: string;
  sharePercentage: number;
  managementFeePercentage?: number;
  capital: number;
  originalCapital?: number;
  currentBalance: number;
  joinedDate?: string;
  isFounder?: boolean;
  includeWarehouseProfit?: boolean;
  payoutPreference?: 'cash' | 'capitalize' | 'ask';
  payoutCycleMonths?: number;
  payoutNoticeDays?: number;
  nextPayoutDate?: string | null;
  noticeDeadlineDate?: string | null;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShareholderTransaction {
  id: string;
  shareholderId: string;
  shareholderName: string;
  type: 'capital_deposit' | 'capital_withdrawal' | 'profit_distribution' | 'profit_withdrawal';
  amount: number;
  date: string;
  displayDate?: string;
  description: string;
  channel?: Payment['channel'];
  createdBy: string;
  createdAt: string;
  runningCapital?: number;
  runningAvailableProfit?: number;
  runningTotalEquity?: number;
}
