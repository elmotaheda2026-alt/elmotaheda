const API_BASE = (window as any).__API_BASE_URL__ || import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';
const DATA_MODE = import.meta.env.VITE_DATA_MODE === 'local' ? 'local' : 'api';
const API_USER_KEY = 'api_user';
const FORCE_LOCAL_RESTORE_KEY = 'almuttahida_force_local_restore';

export function isApiMode() {
  return DATA_MODE === 'api';
}

export function isLocalMode() {
  return DATA_MODE === 'local';
}

function getToken() {
  return localStorage.getItem('api_token');
}

export function hasApiToken() {
  return !!getToken();
}

export function clearApiToken() {
  localStorage.removeItem('api_token');
  localStorage.removeItem(API_USER_KEY);
}

export function setApiSession(token: string, user: unknown) {
  localStorage.setItem('api_token', token);
  localStorage.setItem(API_USER_KEY, JSON.stringify(user));
}

export function getApiUser<T>() {
  const user = localStorage.getItem(API_USER_KEY);
  return user ? JSON.parse(user) as T : null;
}

type PaginatedResponse<T> = T[] | {
  total?: number;
  page?: number;
  limit?: number;
  items?: T[];
  data?: T[];
  rows?: T[];
  results?: T[];
  sales?: T[];
  customers?: T[];
  suppliers?: T[];
  products?: T[];
  purchases?: T[];
  payments?: T[];
  expenses?: T[];
  shareholders?: T[];
  transactions?: T[];
  notifications?: T[];
};

const ARRAY_PAYLOAD_KEYS = [
  'items', 'data', 'rows', 'results', 'sales', 'customers', 'suppliers', 'products',
  'purchases', 'payments', 'expenses', 'shareholders', 'transactions', 'notifications',
] as const;

function unwrapArray<T>(payload: PaginatedResponse<T>, label: string): T[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    for (const key of ARRAY_PAYLOAD_KEYS) {
      const value = payload[key];
      if (Array.isArray(value)) return value;
    }
  }
  throw new Error(`Invalid API response for ${label}: expected an array or paginated object`);
}

async function requestArray<T>(path: string, label: string, options: RequestInit = {}): Promise<T[]> {
  const payload = await request<PaginatedResponse<T>>(path, options);
  return unwrapArray(payload, label);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) {
      clearApiToken();
      if (window.location.pathname !== '/login') {
        window.location.replace('/login');
      }
    }
    throw new Error(payload.message || 'Request failed');
  }
  const text = await response.text();
  if (!text.trim()) throw new Error(`Invalid API response for ${path}: empty response body`);
  try { return JSON.parse(text) as T; } catch { throw new Error(`Invalid API response for ${path}: response body is not valid JSON`); }
}

export const api = {
  health: () => request<{ ok: boolean }>('/health'),
  seedAdmin: () => request<{ message: string }>('/auth/seed-admin', { method: 'POST' }),
  login: (username: string, password: string) =>
    request<{ token: string; user: { id: string; name: string; role: string; permissions?: Record<string, boolean> | string[]; email?: string } }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  listSales: () => requestArray<any>('/sales?includeItems=true', 'sales'),
  searchSales: (filters: { search?: string; limit?: number; includeItems?: boolean } = {}) => {
    const params = new URLSearchParams({ includeItems: filters.includeItems === false ? 'false' : 'true' });
    if (filters.search) params.set('search', filters.search);
    if (filters.limit) params.set('limit', String(filters.limit));
    return requestArray<any>(`/sales?${params.toString()}`, 'sales search');
  },
  listSalesForCollection: (filters: { customerId?: string; search?: string } = {}) => {
    const params = new URLSearchParams({ includeItems: 'false' });
    if (filters.customerId) params.set('customerId', filters.customerId);
    if (filters.search) params.set('search', filters.search);
    return requestArray<any>(`/sales?${params.toString()}`, 'sales collection');
  },
  listCollectionDue: (filters: { from: string; to: string; search?: string; salesRepId?: string; hideSued?: boolean }, options: RequestInit = {}) => {
    const params = new URLSearchParams({ from: filters.from, to: filters.to });
    if (filters.search) params.set('search', filters.search);
    if (filters.salesRepId && filters.salesRepId !== 'all') params.set('salesRepId', filters.salesRepId);
    if (filters.hideSued) params.set('hideSued', 'true');
    return requestArray<any>(`/sales/collection-due?${params.toString()}`, 'collection due');
  },
  createSale: (payload: any) => request<{ id: string }>('/sales', { method: 'POST', body: JSON.stringify(payload) }),
  updateSale: (id: string, payload: any) =>
    request<{ message: string }>(`/sales/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteSale: (id: string) => request<{ message: string }>(`/sales/${id}`, { method: 'DELETE' }),
  listPayments: (filters: { date?: string; search?: string; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (filters.date) params.set('date', filters.date);
    if (filters.search) params.set('search', filters.search);
    if (filters.limit) params.set('limit', String(filters.limit));
    const query = params.toString();
    return requestArray<any>(`/payments${query ? `?${query}` : ''}`, 'payments');
  },
  createPayment: (payload: any) => request<{ id: string; receiptNumber: string }>('/payments', { method: 'POST', body: JSON.stringify(payload) }),
  reversePayment: (id: string) => request<{ message: string }>(`/payments/${id}/reverse`, { method: 'POST' }),
  getAging: () => requestArray<any>('/reports/aging', 'aging report'),
  getCollectionRate: () => request<{ billed: number; collected: number; rate: number }>('/reports/collection-rate'),
  getDailyCash: (date: string) => request<{ date: string; cashIn: number; cashOut: number; net: number }>(`/reports/daily-cash?date=${encodeURIComponent(date)}`),
  listCustomers: () => requestArray<any>('/customers', 'customers'),
  createCustomer: (payload: any) => request<{ id: string }>('/customers', { method: 'POST', body: JSON.stringify(payload) }),
  updateCustomer: (id: string, payload: any) => request<{ message: string }>(`/customers/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteCustomer: (id: string) => request<{ message: string }>(`/customers/${id}`, { method: 'DELETE' }),
  getCustomer: (id: string) => request<any>(`/customers/${id}`),
  listSuppliers: () => requestArray<any>('/suppliers', 'suppliers'),
  createSupplier: (payload: any) => request<{ id: string }>('/suppliers', { method: 'POST', body: JSON.stringify(payload) }),
  updateSupplier: (id: string, payload: any) => request<{ message: string }>(`/suppliers/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteSupplier: (id: string) => request<{ message: string }>(`/suppliers/${id}`, { method: 'DELETE' }),
  listUsers: () => requestArray<any>('/users', 'users'),
  createUser: (payload: any) => request<{ id: string }>('/users', { method: 'POST', body: JSON.stringify(payload) }),
  updateUser: (id: string, payload: any) => request<{ message: string }>(`/users/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteUser: (id: string) => request<{ message: string }>(`/users/${id}`, { method: 'DELETE' }),

  // Products
  listProducts: () => requestArray<any>('/products', 'products'),
  getProduct: (id: string) => request<any>(`/products/${id}`),
  createProduct: (payload: any) => request<{ id: string }>('/products', { method: 'POST', body: JSON.stringify(payload) }),
  updateProduct: (id: string, payload: any) => request<{ message: string }>(`/products/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteProduct: (id: string) => request<{ message: string }>(`/products/${id}`, { method: 'DELETE' }),

  // Purchases
  listPurchases: () => requestArray<any>('/purchases', 'purchases'),
  getPurchase: (id: string) => request<any>(`/purchases/${id}`),
  createPurchase: (payload: any) => request<{ id: string }>('/purchases', { method: 'POST', body: JSON.stringify(payload) }),

  // Expenses
  listExpenses: () => requestArray<any>('/expenses', 'expenses'),
  createExpense: (payload: any) => request<{ id: string }>('/expenses', { method: 'POST', body: JSON.stringify(payload) }),
  updateExpense: (id: string, payload: any) => request<{ message: string }>(`/expenses/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteExpense: (id: string) => request<{ message: string }>(`/expenses/${id}`, { method: 'DELETE' }),

  // Sales Representatives
  listSalesReps: () => requestArray<any>('/sales-reps', 'sales reps'),
  createSalesRep: (payload: any) => request<{ id: string }>('/sales-reps', { method: 'POST', body: JSON.stringify(payload) }),
  updateSalesRep: (id: string, payload: any) => request<{ message: string }>(`/sales-reps/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteSalesRep: (id: string) => request<{ message: string }>(`/sales-reps/${id}`, { method: 'DELETE' }),

  // Shareholders
  listShareholders: () => requestArray<any>('/shareholders', 'shareholders'),
  createShareholder: (payload: any) => request<{ id: string }>('/shareholders', { method: 'POST', body: JSON.stringify(payload) }),
  updateShareholder: (id: string, payload: any) => request<{ message: string }>(`/shareholders/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteShareholder: (id: string) => request<{ message: string }>(`/shareholders/${id}`, { method: 'DELETE' }),
  listShareholderTransactions: () => requestArray<any>('/shareholders/transactions', 'shareholder transactions'),
  createShareholderTransaction: (payload: any) => request<{ id: string }>('/shareholders/transactions', { method: 'POST', body: JSON.stringify(payload) }),

  // Settings
  getSettings: () => request<any>('/settings'),
  updateSettings: (payload: any) => request<{ message: string }>('/settings', { method: 'PUT', body: JSON.stringify(payload) }),
  clearAllData: () => request<{ message: string }>('/settings/clear-data', { method: 'POST' }),
  exportBackup: () => request<any>('/settings/backup'),
  restoreBackup: (payload: any) => request<{ message: string }>('/settings/restore-backup', { method: 'POST', body: JSON.stringify(payload) }),

  // Notifications
  listNotifications: () => requestArray<any>('/notifications', 'notifications'),
  createNotification: (payload: any) => request<{ id: string }>('/notifications', { method: 'POST', body: JSON.stringify(payload) }),
  markNotificationRead: (id: string) => request<{ message: string }>(`/notifications/${id}/read`, { method: 'PUT' }),
  markAllNotificationsRead: () => request<{ message: string }>('/notifications/read-all', { method: 'PUT' }),
  deleteNotification: (id: string) => request<{ message: string }>(`/notifications/${id}`, { method: 'DELETE' }),

  // Collection Tasks
  listCollectionTasks: () => requestArray<any>('/collection-tasks', 'collection tasks'),
  createCollectionTask: (payload: any) => request<{ id: string }>('/collection-tasks', { method: 'POST', body: JSON.stringify(payload) }),
  updateCollectionTask: (id: string, payload: any) => request<{ message: string }>(`/collection-tasks/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteCollectionTask: (id: string) => request<{ message: string }>(`/collection-tasks/${id}`, { method: 'DELETE' }),

  // Closing Periods
  listClosingPeriods: () => requestArray<any>('/closing', 'closing periods'),
  closePeriod: (payload: { periodType: 'daily' | 'monthly'; periodDate: string; notes?: string }) =>
    request<{ message: string }>('/closing/close', { method: 'POST', body: JSON.stringify(payload) }),

  // Dashboard Metrics
  getDashboardMetrics: (filters: { startDate?: string; endDate?: string } = {}) => {
    const params = new URLSearchParams();
    if (filters.startDate) params.set('startDate', filters.startDate);
    if (filters.endDate) params.set('endDate', filters.endDate);
    const query = params.toString();
    return request<any>(`/reports/dashboard/metrics${query ? `?${query}` : ''}`);
  },
  getDashboardMetricsCached: () => request<any>('/reports/dashboard/metrics-cached'),
  refreshDashboardCache: () => request<{ message: string; lastRefreshedAt: string }>('/reports/dashboard/refresh-cache', { method: 'POST' }),
};





