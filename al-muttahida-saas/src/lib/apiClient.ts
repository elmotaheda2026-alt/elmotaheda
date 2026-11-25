export function isMobileDevice(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  if ((window as any).electronAPI) return false;
  const ua = navigator.userAgent || '';
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua) || window.innerWidth < 768;
}

export function resolveApiBaseUrl(): string {
  if (typeof window !== 'undefined') {
    // 1. Saved custom server URL in localStorage (configured via OnboardingWizard or Settings)
    const saved = localStorage.getItem('server_api_url');
    if (saved && !saved.includes('localhost') && !saved.includes('127.0.0.1')) {
      return saved;
    }

    // 2. Electron or custom window injected API URL
    if ((window as any).__API_BASE_URL__) {
      const injected = (window as any).__API_BASE_URL__;
      if (injected && (!saved || injected !== 'http://127.0.0.1:4000')) {
        return injected;
      }
    }

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
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('erp:api-url-changed'));
  }
  return cleanUrl;
}

export function clearServerApiUrl(): void {
  localStorage.removeItem('server_api_url');
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('erp:api-url-changed'));
  }
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
  } catch {
    // Try /api/health fallback
  }

  try {
    const res2 = await fetch(`${cleanUrl}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (res2.ok) return { ok: true };
  } catch {
    // Unreachable
  }

  return { ok: false, message: 'تعذر الوصول إلى الخادم على هذا العنوان' };
}

export function emitApiHealth(connected: boolean) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('api-health-change', { detail: connected }));
}

  export async function probeBackendHealth(targetUrl?: string, timeoutMs = 2500): Promise<boolean> {
    const base = targetUrl || resolveApiBaseUrl();
    try {
      const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) {
        return true;
      }
      if (res.status === 404) {
        const res2 = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
        return res2.ok;
      }
      return false;
    } catch {
      return false;
    }
  }

  export async function checkBackendHealth(targetUrl?: string): Promise<boolean> {
    const ok = await probeBackendHealth(targetUrl, 2500);
    emitApiHealth(ok);
    return ok;
  }

  export function isApiMode() {
    return DATA_MODE === 'api';
  }

  export function isLocalMode() {
    return DATA_MODE === 'local';
  }

  function getToken() {
    return sessionStorage.getItem('api_token');
  }

  export function getApiToken() {
    return getToken();
  }

  export function hasApiToken() {
    return !!getToken();
  }

  export function clearApiToken() {
    sessionStorage.removeItem('api_token');
    sessionStorage.removeItem(API_USER_KEY);
    try {
      localStorage.removeItem('api_token');
      localStorage.removeItem(API_USER_KEY);
    } catch {
      // Ignore storage removal errors
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('auth:session-expired'));
    }
  }

  export function setApiSession(token: string, user: unknown) {
    sessionStorage.setItem('api_token', token);
    sessionStorage.setItem(API_USER_KEY, JSON.stringify(user));
    try {
      localStorage.removeItem('api_token');
      localStorage.removeItem(API_USER_KEY);
    } catch {
      // Ignore storage removal errors
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('erp:api-url-changed'));
    }
  }

  export function getApiUser<T>() {
    const user = sessionStorage.getItem(API_USER_KEY);
    return user ? JSON.parse(user) as T : null;
  }

  export function updateApiUser(user: unknown) {
    sessionStorage.setItem(API_USER_KEY, JSON.stringify(user));
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
    const base = resolveApiBaseUrl();
    const token = getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Client-Device': isMobileDevice() ? 'mobile' : 'desktop',
      ...(options.headers as Record<string, string> || {}),
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    let response: Response;
    try {
      response = await fetch(`${base}${path}`, {
        cache: 'no-store',
        ...options,
        headers,
        signal: options.signal || (typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(12000) : undefined),
      });
    } catch (networkErr) {
      emitApiHealth(false);
      throw networkErr;
    }
    emitApiHealth(response.status !== 502 && response.status !== 503 && response.status !== 504);
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
    listSalesPaged: (filters: { page?: number; limit?: number; search?: string; status?: string; includeItems?: boolean } = {}) => {
      const params = new URLSearchParams({ includeItems: filters.includeItems === false ? 'false' : 'true' });
      params.set('page', String(filters.page || 1));
      params.set('limit', String(filters.limit || 50));
      if (filters.search) params.set('search', filters.search);
      if (filters.status && filters.status !== 'all') params.set('status', filters.status);
      return request<{ total: number; page: number; limit: number; sales: any[] }>(`/sales?${params.toString()}`);
    },
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
    returnSale: (id: string, payload: { reason?: string; returnDate?: string; refundAmount?: number }) =>
      request<{ message: string; refundAmount: number; refundReceipt?: string | null }>(`/sales/${id}/return`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    undoDeferInstallment: (saleId: string, installmentId: string) =>
      request<{ message: string; schedules: any[]; sale?: any }>(`/sales/${saleId}/undo-defer-installment`, {
        method: 'POST',
        body: JSON.stringify({ installmentId }),
      }),
    getSale: (id: string) => request<any>(`/sales/${id}`),
    getLatestCustomerGuarantors: (customerId: string) =>
      request<{ guarantors: [any, any, any]; source: 'sale' | 'customer' | 'none'; invoiceNumber?: string }>(
        `/sales/customer/${encodeURIComponent(customerId)}/latest-guarantors`,
      ),
    getSaleGuarantors: (saleId: string) =>
      request<{ guarantors: [any, any, any]; guarantorRecords: any[]; guarantorHistoryCount: number }>(
        `/sales/${encodeURIComponent(saleId)}/guarantors`,
      ),
    replaceSaleGuarantor: (
      saleId: string,
      payload: {
        slot: 1 | 2 | 3;
        guarantor: { name: string; phone: string; nationalId: string; address: string; relationship: string };
        reason?: string;
      },
    ) =>
      request<any>(`/sales/${encodeURIComponent(saleId)}/guarantors/replace`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    checkPersonRisk: (params: { nationalId?: string; phone?: string; excludeCustomerId?: string; excludeSaleId?: string }) => {
      const qs = new URLSearchParams();
      if (params.nationalId) qs.set('nationalId', params.nationalId);
      if (params.phone) qs.set('phone', params.phone);
      if (params.excludeCustomerId) qs.set('excludeCustomerId', params.excludeCustomerId);
      if (params.excludeSaleId) qs.set('excludeSaleId', params.excludeSaleId);
      return request<{
        existingCustomers: Array<{
          id: string;
          customerNumber: string;
          name: string;
          phone: string;
          nationalId: string;
          balance: number;
          isSued: boolean;
        }>;
        activeGuarantees: Array<{
          saleId: string;
          slot: number;
          guarantorName: string;
          invoiceNumber: string;
          customerId: string;
          customerName: string;
          remaining: number;
          isSued: boolean;
          overdueCount: number;
        }>;
        totalGuaranteedRemaining: number;
        hasSuedOrOverdue: boolean;
      }>(`/sales/check-person-risk?${qs.toString()}`);
    },
    transferSaleContract: (
      saleId: string,
      payload: {
        newCustomerId: string;
        transferDate?: string;
        installmentMonths?: number;
        installmentStartDate?: string;
        reason?: string;
        guarantors?: Array<{ name: string; phone: string; nationalId: string; address: string; relationship: string } | null>;
      },
    ) =>
      request<{ oldSale: any; newSale: any }>(`/sales/${encodeURIComponent(saleId)}/transfer`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    updateInstallmentNote: (installmentId: string, notes: string) =>
      request<{ ok: boolean; id: string; notes: string | null }>(`/installments/${installmentId}/note`, {
        method: 'PATCH',
        body: JSON.stringify({ notes }),
      }),
    updateSaleCollectionNote: (saleId: string, notes: string) =>
      request<{ ok: boolean; id: string; invoiceNote: string | null }>(`/sales/${saleId}/collection-note`, {
        method: 'PATCH',
        body: JSON.stringify({ notes }),
      }),
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
    rescheduleSale: (saleId: string, payload: {
      newInstallmentCount: number;
      extraInterestPercent?: number;
      firstNewDueDate: string;
      reason?: string;
    }) => request<{ message: string; schedules: any[]; sale?: any }>(`/sales/${saleId}/reschedule`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
    listPayments: (filters: { date?: string; search?: string; channel?: string; limit?: number } = {}) => {
      const params = new URLSearchParams();
      if (filters.date) params.set('date', filters.date);
      if (filters.search) params.set('search', filters.search);
      if (filters.channel) params.set('channel', filters.channel);
      if (filters.limit) {
        params.set('page', '1');
        params.set('limit', String(filters.limit));
      }
      const query = params.toString();
      return requestArray<any>(`/payments${query ? `?${query}` : ''}`, 'payments');
    },
    listPaymentsPaged: (filters: { page?: number; limit?: number; date?: string; search?: string; channel?: string } = {}) => {
      const params = new URLSearchParams({ includeMeta: '1' });
      params.set('page', String(filters.page || 1));
      params.set('limit', String(filters.limit || 100));
      if (filters.date) params.set('date', filters.date);
      if (filters.search) params.set('search', filters.search);
      if (filters.channel) params.set('channel', filters.channel);
      return request<{ total: number; page: number; limit: number; totalPages: number; payments: any[] }>(`/payments?${params.toString()}`);
    },
    getPaymentsSummary: (date?: string, range?: { startDate?: string; endDate?: string }) => {
      const params = new URLSearchParams();
      if (date) params.set('date', date);
      if (range?.startDate) params.set('startDate', range.startDate);
      if (range?.endDate) params.set('endDate', range.endDate);
      const qs = params.toString();
      return request<{
        totalCount: number;
        todayCount?: number;
        totalIn: number | null;
        totalOut: number | null;
        totalExpenses: number | null;
        startingCashBalance?: number | null;
        netCash: number | null;
        todayIn: number;
        todayOut: number;
        todayExpenses: number;
        todayNet: number;
        channels?: Record<
          string,
          { balance: number | null; totalIn: number | null; totalOut: number | null; todayIn: number; todayOut: number; todayNet: number }
        >;
        period?: {
          startDate: string;
          endDate: string;
          totalIn: number;
          totalOut: number;
          totalExpenses: number;
          count: number;
          net: number;
          closingBalance: number;
        } | null;
      }>(`/payments/summary${qs ? `?${qs}` : ''}`);
    },
    createPayment: (payload: any) => request<{ id: string; receiptNumber: string }>('/payments', { method: 'POST', body: JSON.stringify(payload) }),
    updatePayment: (id: string, payload: { amount: number; date: string; description?: string }) =>
      request<{ message: string }>(`/payments/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
    reversePayment: (id: string) => request<{ message: string }>(`/payments/${id}/reverse`, { method: 'POST' }),
    getAging: () => requestArray<any>('/reports/aging', 'aging report'),
    getCollectionRate: () => request<{ billed: number; collected: number; rate: number }>('/reports/collection-rate'),
    getDailyCash: (date: string) => request<{ date: string; cashIn: number; cashOut: number; net: number }>(`/reports/daily-cash?date=${encodeURIComponent(date)}`),
    listCustomers: () => requestArray<any>('/customers', 'customers'),
    getNextCustomerNumber: () => request<{ customerNumber: string }>('/customers/next-number'),
    listCustomersPaged: (filters: { page?: number; limit?: number; search?: string; filter?: string } = {}) => {
      const params = new URLSearchParams();
      params.set('page', String(filters.page || 1));
      params.set('limit', String(filters.limit || 50));
      if (filters.search) params.set('search', filters.search);
      if (filters.filter && filters.filter !== 'all') params.set('filter', filters.filter);
      return request<{
        total: number;
        page: number;
        limit: number;
        totalPages: number;
        stats: { totalCount: number; debtorsCount: number; suedCount: number; totalReceivables: number };
        customers: any[];
      }>(`/customers?${params.toString()}`);
    },
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
    getSupplierStatement: (id: string) => request<any>(`/suppliers/${id}/statement`),
    createSupplier: (payload: any) => request<{ id: string }>('/suppliers', { method: 'POST', body: JSON.stringify(payload) }),
    updateSupplier: (id: string, payload: any) => request<{ message: string }>(`/suppliers/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
    deleteSupplier: (id: string) => request<{ message: string }>(`/suppliers/${id}`, { method: 'DELETE' }),
    listUsers: () => requestArray<any>('/users', 'users'),
    listAdmins: () => requestArray<{ id: string; name: string; username: string }>('/users/admins', 'admins'),
    createUser: (payload: any) => request<{ id: string }>('/users', { method: 'POST', body: JSON.stringify(payload) }),
    updateUser: (id: string, payload: any) => request<{ message: string }>(`/users/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
    toggleUserStatus: (id: string, isActive: boolean) =>
      request<{ message: string; isActive: boolean }>(`/users/${id}/status`, { method: 'PATCH', body: JSON.stringify({ isActive }) }),
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
    deletePurchase: (id: string) => request<{ message: string }>(`/purchases/${id}`, { method: 'DELETE' }),

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
    updateShareholderPayoutPreference: (
      id: string,
      payload: {
        payoutPreference: 'cash' | 'capitalize' | 'ask';
        payoutCycleMonths?: number;
        payoutNoticeDays?: number;
        nextPayoutDate?: string | null;
      }
    ) =>
      request<{
        message: string;
        payoutPreference: 'cash' | 'capitalize' | 'ask';
        payoutCycleMonths: number;
        payoutNoticeDays: number;
        nextPayoutDate: string | null;
        noticeDeadlineDate: string | null;
      }>(`/shareholders/${id}/payout-preference`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    listShareholderTransactions: () => requestArray<any>('/shareholders/transactions', 'shareholder transactions'),
    createShareholderTransaction: (payload: any) => request<{ id: string }>('/shareholders/transactions', { method: 'POST', body: JSON.stringify(payload) }),
    deleteShareholderTransaction: (id: string) => request<{ message: string }>(`/shareholders/transactions/${id}`, { method: 'DELETE' }),
    capitalizeProfits: (shareholderId?: string) =>
      request<{ success: boolean; totalCapitalized: number; message: string }>('/shareholders/capitalize-profits', {
        method: 'POST',
        body: JSON.stringify({ shareholderId }),
      }),
    getShareholdersLiveTrading: (filters: { periodFrom?: string; periodTo?: string; profitBasis?: 'realized' | 'accrual' } = {}) => {
      const params = new URLSearchParams();
      if (filters.periodFrom) params.set('periodFrom', filters.periodFrom);
      if (filters.periodTo) params.set('periodTo', filters.periodTo);
      if (filters.profitBasis) params.set('profitBasis', filters.profitBasis);
      const q = params.toString();
      return request<any>(`/shareholders/live-trading${q ? `?${q}` : ''}`);
    },
    settleShareholdersPeriod: (payload: { periodFrom?: string | null; periodTo: string; profitBasis?: 'realized' | 'accrual'; notes?: string }) =>
      request<{ success: boolean; settledCount: number; totalSettledAmount: number; message: string }>('/shareholders/settle-period', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    deleteShareholderSettlement: (id: string) =>
      request<{ success: boolean; reversedTxCount: number; message: string }>(`/shareholders/settlements/${id}`, {
        method: 'DELETE',
      }),

    // Settings
    getSettings: () => request<any>('/settings'),
    updateSettings: (payload: any) => request<{ message: string }>('/settings', { method: 'PUT', body: JSON.stringify(payload) }),
    getTelegramSettings: () => request<{ enabled: boolean; botToken: string; chatIds: string }>('/settings/telegram'),
    updateTelegramSettings: (payload: { enabled: boolean; botToken: string; chatIds: string }) =>
      request<{ message: string; config: { enabled: boolean; botToken: string; chatIds: string } }>('/settings/telegram', {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),
    testTelegramSettings: (payload: { botToken: string; chatIds: string }) =>
      request<{ ok: boolean; sentCount: number; message: string }>('/settings/telegram/test', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    updateRolePermissions: (rolePermissions: Record<string, string[]>) =>
      request<{ message: string; rolePermissions: Record<string, string[]> }>('/settings/role-permissions', {
        method: 'PUT',
        body: JSON.stringify({ rolePermissions }),
      }),
    updatePaymentChannels: (
      paymentChannels: Array<{
        id: string;
        label: string;
        icon: 'cash' | 'wallet' | 'bank' | 'instapay' | 'card';
        color: 'emerald' | 'rose' | 'blue' | 'violet' | 'amber' | 'slate';
        isDefault?: boolean;
      }>,
    ) =>
      request<{
        message: string;
        paymentChannels: Array<{
          id: string;
          label: string;
          icon: 'cash' | 'wallet' | 'bank' | 'instapay' | 'card';
          color: 'emerald' | 'rose' | 'blue' | 'violet' | 'amber' | 'slate';
          isDefault?: boolean;
        }>;
      }>('/settings/payment-channels', {
        method: 'PUT',
        body: JSON.stringify({ paymentChannels }),
      }),
    getOpeningBalances: () => request<any>('/settings/opening-balances'),
    updateOpeningBalances: (payload: any) => request<{ message: string }>('/settings/opening-balances', { method: 'PUT', body: JSON.stringify(payload) }),
    clearAllData: () => request<{ message: string }>('/settings/clear-data', { method: 'POST' }),
    exportBackup: () =>
      request<any>('/settings/backup', {
        signal: typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(300_000) : undefined,
      }),
    restoreBackup: (payload: any) =>
      request<{ message: string; restoredCounts?: Record<string, number> }>('/settings/restore-backup', {
        method: 'POST',
        body: JSON.stringify(payload),
        signal: typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(300_000) : undefined,
      }),
    getAutoBackupConfig: () => request<any>('/settings/auto-backup'),
    updateAutoBackupConfig: (payload: any) => request<any>('/settings/auto-backup', { method: 'PUT', body: JSON.stringify(payload) }),
    runAutoBackupNow: () =>
      request<any>('/settings/auto-backup/run', {
        method: 'POST',
        signal: typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(300_000) : undefined,
      }),

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
    reopenPeriod: (payload: { periodType: 'daily' | 'monthly'; periodDate: string }) =>
      request<{ message: string }>('/closing/reopen', { method: 'POST', body: JSON.stringify(payload) }),

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

    // Document Templates
    listDocumentTemplates: () => requestArray<any>('/document-templates', 'document templates'),
    createDocumentTemplate: (payload: any) =>
      request<any>('/document-templates', { method: 'POST', body: JSON.stringify(payload) }),
    updateDocumentTemplate: (id: string, payload: any) =>
      request<any>(`/document-templates/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
    resetDocumentTemplate: (id: string) =>
      request<any>(`/document-templates/${id}/reset`, { method: 'POST' }),
    deleteDocumentTemplate: (id: string) =>
      request<{ message: string }>(`/document-templates/${id}`, { method: 'DELETE' }),

    // Current Authenticated Session Info
    getMe: () =>
      request<{
        user: {
          id: string;
          username?: string;
          name: string;
          role: string;
          permissions?: Record<string, boolean> | null;
        };
        rolePermissions?: Record<string, string[]>;
      }>('/auth/me'),
  };





