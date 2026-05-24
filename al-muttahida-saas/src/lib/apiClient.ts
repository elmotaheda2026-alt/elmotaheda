const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';

function getToken() {
  return localStorage.getItem('api_token');
}

export function hasApiToken() {
  return !!getToken();
}

export function clearApiToken() {
  localStorage.removeItem('api_token');
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
    request<{ token: string; user: { id: string; name: string; role: string } }>('/auth/login', {
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
};
