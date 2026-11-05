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
    'inventory:manage',
    'purchases:manage',
    'settings:manage',
    'shareholders:manage',
    'notifications:read',
  ],
  manager: [
    'sales:read',
    'sales:write',
    'sales:reschedule',
    'payments:read',
    'payments:write',
    'reports:read',
    'inventory:manage',
    'purchases:manage',
    'notifications:read',
  ],
  accountant: [
    'sales:read',
    'sales:write',
    'payments:read',
    'payments:write',
    'payments:reverse',
    'closing:write',
    'reports:read',
    'inventory:manage',
    'purchases:manage',
    'notifications:read',
  ],
  user: [
    'sales:read',
    'payments:read',
    'notifications:read',
  ],
  collector: [
    'payments:read',
    'payments:write',
    'notifications:read',
  ],
  reviewer: [
    'sales:read',
    'payments:read',
    'reports:read',
    'sales:reschedule',
    'notifications:read',
  ],
  finance_manager: [
    'sales:read',
    'sales:write',
    'payments:read',
    'payments:write',
    'payments:reverse',
    'reports:read',
    'closing:write',
    'inventory:manage',
    'purchases:manage',
    'shareholders:manage',
    'notifications:read',
  ],
};

export function hasPermission(role: UserRole, permission: Permission, userPermissions?: Permission[]): boolean {
  if (role === 'admin') return true;
  if (Array.isArray(userPermissions) && userPermissions.length > 0) {
    return userPermissions.includes(permission);
  }
  return rolePermissions[role]?.includes(permission) ?? false;
}
