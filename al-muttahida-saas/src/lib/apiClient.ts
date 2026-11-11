function resolveApiBaseUrl(): string {
  if (typeof window !== 'undefined') {
    // 1. Electron or custom window injected API URL
    if ((window as any).__API_BASE_URL__) {
      return (window as any).__API_BASE_URL__;
    }

    // 2. Saved custom server URL in localStorage
    const saved = localStorage.getItem('server_api_url');
    if (saved) return saved;

    // 3. Dynamic network detection:
    // If user accesses via network IP (e.g. http://192.168.1.9:5173),
    // automatically point backend requests to that same host on port 4000.
    const hostname = window.location.hostname;
    if (hostname && hostname !== 'localhost' && hostname !== '127.0.0.1') {
      return `${window.location.protocol}//${hostname}:4000`;
    }
  }

  // 4. Default fallback (configured env or localhost)
  return import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';
}

export const API_BASE = resolveApiBaseUrl();
const DATA_MODE = import.meta.env.VITE_DATA_MODE === 'local' ? 'local' : 'api';
const API_USER_KEY = 'api_user';
const FORCE_LOCAL_RESTORE_KEY = 'almuttahida_force_local_restore';

export function setServerApiUrl(url: string): string {
  let cleanUrl = url.trim().replace(/\/+$/, '');
  if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
    cleanUrl = `http://${cleanUrl}`;
  }
  try {
    const parsed = new URL(cleanUrl);
    if (!parsed.port) {
      parsed.port = '4000';
      cleanUrl = parsed.origin;
    }
  } catch {
    if (!cleanUrl.includes(':', 6)) {
      cleanUrl = `${cleanUrl}:4000`;
    }
  }
  localStorage.setItem('server_api_url', cleanUrl);
  return cleanUrl;
}

export function clearServerApiUrl(): void {
  localStorage.removeItem('server_api_url');
}

export function getServerApiUrl(): string {
  return resolveApiBaseUrl();
}

export async function testServerUrl(url: string, timeoutMs = 3000): Promise<{ ok: boolean; message?: string }> {
  let cleanUrl = url.trim().replace(/\/+$/, '');
  if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
    cleanUrl = `http://${cleanUrl}`;
  }
  if (!cleanUrl.includes(':', 6)) {
    cleanUrl = `${cleanUrl}:4000`;
  }
  try {
    const res = await fetch(`${cleanUrl}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (res.ok) return { ok: true };
  } catch (_) {}

  try {
    const res2 = await fetch(`${cleanUrl}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (res2.ok) return { ok: true };
  } catch (_) {}

  return { ok: false, message: 'تعذر الوصول إلى الخادم على هذا العنوان' };
}

export async function checkBackendHealth(targetUrl?: string): Promise<boolean> {
  const base = targetUrl || resolveApiBaseUrl();
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    try {
      const res2 = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(3000) });
      return res2.ok;
    } catch {
      return false;
    }
  }
}

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
      if (typeof window !== 'undefined' && !window.location.hash.includes('login')) {
        window.location.hash = '#/login';
      }
    }
    let errorMsg = payload.message || payload.error;
    if (!errorMsg && payload.errors && typeof payload.errors === 'object') {
      const firstField = Object.keys(payload.errors)[0];
      const fieldErrors = payload.errors[firstField];
      if (Array.isArray(fieldErrors?._errors) && fieldErrors._errors.length > 0) {
        errorMsg = `${firstField}: ${fieldErrors._errors.join(', ')}`;
      } else if (Array.isArray(fieldErrors) && fieldErrors.length > 0) {
        errorMsg = `${firstField}: ${fieldErrors.join(', ')}`;
      }
    }
    throw new Error(errorMsg || `Request failed with status ${response.status}`);
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
    if (filters.limit) {
      params.set('page', '1');
      params.set('limit', String(filters.limit));
    }
    return requestArray<any>(`/sales?${params.toString()}`, 'sales search');
  },
  listSalesForCollection: (filters: { customerId?: string; search?: string } = {}) => {
    const params = new URLSearchParams({ includeItems: 'false' });
    if (filters.customerId) params.set('customerId', filters.customerId);
    if (filters.search) params.set('search', filters.search);
    return requestArray<any>(`/sales?${params.toString()}`, 'sales collection');
  },
  listCollectionDue: (filters: { from?: string; to?: string; search?: string; salesRepId?: string; hideSued?: boolean; includeOverdue?: boolean; strictDate?: boolean; statusFilter?: string; dateBasis?: string } = {}, options: RequestInit = {}) => {
    const params = new URLSearchParams();
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    if (filters.search) params.set('search', filters.search);
    if (filters.salesRepId && filters.salesRepId !== 'all') params.set('salesRepId', filters.salesRepId);
    if (filters.hideSued) params.set('hideSued', 'true');
    if (filters.includeOverdue) params.set('includeOverdue', 'true');
    if (filters.strictDate) params.set('strictDate', 'true');
    if (filters.statusFilter) params.set('statusFilter', filters.statusFilter);
    if (filters.dateBasis) params.set('dateBasis', filters.dateBasis);
    return requestArray<any>(`/sales/collection-due?${params.toString()}`, 'collection due');
  },
  listDues: (filters: { from?: string; to?: string; search?: string; salesRepId?: string; hideSued?: boolean; includeOverdue?: boolean; strictDate?: boolean; statusFilter?: string; dateBasis?: string } = {}, options: RequestInit = {}) => {
    const params = new URLSearchParams();
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    if (filters.search) params.set('search', filters.search);
    if (filters.salesRepId && filters.salesRepId !== 'all') params.set('salesRepId', filters.salesRepId);
    if (filters.hideSued) params.set('hideSued', 'true');
    if (filters.includeOverdue) params.set('includeOverdue', 'true');
    if (filters.strictDate) params.set('strictDate', 'true');
    if (filters.statusFilter) params.set('statusFilter', filters.statusFilter);
    if (filters.dateBasis) params.set('dateBasis', filters.dateBasis);
    return requestArray<any>(`/dues?${params.toString()}`, 'dues');
  },
  createSale: (payload: any) => request<{ id: string }>('/sales', { method: 'POST', body: JSON.stringify(payload) }),
  updateSale: (id: string, payload: any) =>
    request<{ message: string }>(`/sales/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteSale: (id: string) => request<{ message: string }>(`/sales/${id}`, { method: 'DELETE' }),
  getSale: (id: string) => request<any>(`/sales/${id}`),
  deferInstallment: (saleId: string, payload: {
    installmentId: string;
    newDueDate: string;
    strategy: 'shift_subsequent' | 'merge_next';
    penaltyFee?: number;
    penaltyPaymentType?: 'add_to_debt' | 'collect_cash';
  }) => request<{ message: string; schedules: any[]; sale?: any }>(`/sales/${saleId}/defer-installment`, {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  postponeInstallment: (saleId: string, payload: {
    installmentId: string;
    newDueDate: string;
    strategy: 'shift_subsequent' | 'merge_next';
    penaltyFee?: number;
    penaltyPaymentType?: 'add_to_debt' | 'collect_cash';
  }) => request<{ message: string; schedules: any[]; sale?: any }>(`/sales/${saleId}/postpone`, {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  listPayments: (filters: { date?: string; search?: string; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (filters.date) params.set('date', filters.date);
    if (filters.search) params.set('search', filters.search);
    if (filters.limit) {
      params.set('page', '1');
      params.set('limit', String(filters.limit));
    }
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
  toggleCustomerSued: (id: string, isSued: boolean, suedDate?: string) =>
    request<{ message: string; id: string; isSued: boolean; suedDate: string | null }>(`/customers/${id}/toggle-sued`, {
      method: 'PATCH',
      body: JSON.stringify({ isSued, suedDate }),
    }),
  deleteCustomer: (id: string) => request<{ message: string }>(`/customers/${id}`, { method: 'DELETE' }),
  getCustomer: (id: string) => request<any>(`/customers/${id}`),
  listSuppliers: () => requestArray<any>('/suppliers', 'suppliers'),
  createSupplier: (payload: any) => request<{ id: string }>('/suppliers', { method: 'POST', body: JSON.stringify(payload) }),
  updateSupplier: (id: string, payload: any) => request<{ message: string }>(`/suppliers/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteSupplier: (id: string) => request<{ message: string }>(`/suppliers/${id}`, { method: 'DELETE' }),
  listUsers: () => requestArray<any>('/users', 'users'),
  listAdmins: () => requestArray<{ id: string; name: string; username: string }>('/users/admins', 'admins'),
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
  deleteShareholderTransaction: (id: string) => request<{ message: string }>(`/shareholders/transactions/${id}`, { method: 'DELETE' }),
  capitalizeProfits: (shareholderId?: string) =>
    request<{ success: boolean; totalCapitalized: number; message: string }>('/shareholders/capitalize-profits', {
      method: 'POST',
      body: JSON.stringify({ shareholderId }),
    }),
  getShareholdersLiveTrading: (filters: { periodFrom?: string; periodTo?: string } = {}) => {
    const params = new URLSearchParams();
    if (filters.periodFrom) params.set('periodFrom', filters.periodFrom);
    if (filters.periodTo) params.set('periodTo', filters.periodTo);
    const q = params.toString();
    return request<any>(`/shareholders/live-trading${q ? `?${q}` : ''}`);
  },

  // Settings
  getSettings: () => request<any>('/settings'),
  updateSettings: (payload: any) => request<{ message: string }>('/settings', { method: 'PUT', body: JSON.stringify(payload) }),
  getOpeningBalances: () => request<any>('/settings/opening-balances'),
  updateOpeningBalances: (payload: any) => request<{ message: string }>('/settings/opening-balances', { method: 'PUT', body: JSON.stringify(payload) }),
  clearAllData: () => request<{ message: string }>('/settings/clear-data', { method: 'POST' }),
  exportBackup: () => request<any>('/settings/backup'),
  restoreBackup: (payload: any) => request<{ message: string }>('/settings/restore-backup', { method: 'POST', body: JSON.stringify(payload) }),
  getAutoBackupConfig: () => request<any>('/settings/auto-backup'),
  updateAutoBackupConfig: (payload: any) => request<any>('/settings/auto-backup', { method: 'PUT', body: JSON.stringify(payload) }),
  runAutoBackupNow: () => request<any>('/settings/auto-backup/run', { method: 'POST' }),

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





