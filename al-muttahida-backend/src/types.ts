export type UserRole =
  | 'admin'
  | 'manager'
  | 'accountant'
  | 'user'
  | 'collector'
  | 'reviewer'
  | 'finance_manager';

export type Permission =
  | 'sales:read'
  | 'sales:write'
  | 'sales:reschedule'
  | 'payments:read'
  | 'payments:write'
  | 'payments:reverse'
  | 'reports:read'
  | 'closing:write'
  | 'users:manage'
  | 'inventory:manage'
  | 'purchases:manage'
  | 'settings:manage'
  | 'shareholders:manage'
  | 'notifications:read';
