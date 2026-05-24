import { Permission, UserRole } from './types.js';

const rolePermissions: Record<UserRole, Permission[]> = {
  admin: [
    'sales:read',
    'sales:write',
    'sales:reschedule',
    'payments:read',
    'payments:write',
    'payments:reverse',
    'reports:read',
    'closing:write',
    'users:manage',
  ],
  manager: ['sales:read', 'sales:write', 'payments:read', 'reports:read'],
  accountant: ['sales:read', 'payments:read', 'payments:write', 'reports:read'],
  user: ['sales:read', 'payments:read'],
  collector: ['payments:read', 'payments:write'],
  reviewer: ['sales:read', 'payments:read', 'reports:read', 'sales:reschedule'],
  finance_manager: ['sales:read', 'payments:read', 'payments:reverse', 'reports:read', 'closing:write'],
};

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return rolePermissions[role]?.includes(permission) ?? false;
}
