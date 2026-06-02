const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';
const DATA_MODE = import.meta.env.VITE_DATA_MODE === 'local' ? 'local' : 'api';
const API_USER_KEY = 'api_user';

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
    throw new Error(payload.message || 'Request failed');
  }
  return response.json() as Promise<T>;
}

export const api = {
  health: () => request<{ ok: boolean }>('/health'),
  seedAdmin: () => request<{ message: string }>('/auth/seed-admin', { method: 'POST' }),
  login: (email: string, password: string) =>
    request<{ token: string; user: { id: string; name: string; role: string; permissions?: Record<string, boolean> | string[] } }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  listSales: () => request<any[]>('/sales'),
  createSale: (payload: any) => request<{ id: string }>('/sales', { method: 'POST', body: JSON.stringify(payload) }),
  updateSale: (id: string, payload: any) =>
    request<{ message: string }>(`/sales/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  listPayments: () => request<any[]>('/payments'),
  createPayment: (payload: any) => request<{ id: string; receiptNumber: string }>('/payments', { method: 'POST', body: JSON.stringify(payload) }),
  reversePayment: (id: string) => request<{ message: string }>(`/payments/${id}/reverse`, { method: 'POST' }),
  getAging: () => request<any[]>('/reports/aging'),
  getCollectionRate: () => request<{ billed: number; collected: number; rate: number }>('/reports/collection-rate'),
  getDailyCash: (date: string) => request<{ date: string; cashIn: number; cashOut: number; net: number }>(`/reports/daily-cash?date=${encodeURIComponent(date)}`),
  listCustomers: () => request<any[]>('/customers'),
  createCustomer: (payload: any) => request<{ id: string }>('/customers', { method: 'POST', body: JSON.stringify(payload) }),
  updateCustomer: (id: string, payload: any) => request<{ message: string }>(`/customers/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteCustomer: (id: string) => request<{ message: string }>(`/customers/${id}`, { method: 'DELETE' }),
  listSuppliers: () => request<any[]>('/suppliers'),
  createSupplier: (payload: any) => request<{ id: string }>('/suppliers', { method: 'POST', body: JSON.stringify(payload) }),
  updateSupplier: (id: string, payload: any) => request<{ message: string }>(`/suppliers/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteSupplier: (id: string) => request<{ message: string }>(`/suppliers/${id}`, { method: 'DELETE' }),
  listUsers: () => request<any[]>('/users'),
  createUser: (payload: any) => request<{ id: string }>('/users', { method: 'POST', body: JSON.stringify(payload) }),
  updateUser: (id: string, payload: any) => request<{ message: string }>(`/users/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteUser: (id: string) => request<{ message: string }>(`/users/${id}`, { method: 'DELETE' }),
};
