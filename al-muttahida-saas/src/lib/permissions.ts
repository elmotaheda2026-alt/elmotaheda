import { Permission, User } from '../types';

type LegacyPermission =
  | 'dashboard'
  | 'sales'
  | 'purchases'
  | 'inventory'
  | 'customers'
  | 'suppliers'
  | 'treasury'
  | 'reports'
  | 'settings'
  | 'users'
  | 'shareholders';

const broadPermissionMap: Partial<Record<Permission, LegacyPermission[]>> = {
  'sales:read': ['sales', 'customers', 'suppliers'],
  'sales:write': ['sales', 'customers', 'suppliers'],
  'sales:reschedule': ['sales'],
  'payments:read': ['treasury'],
  'payments:write': ['treasury'],
  'payments:reverse': ['treasury'],
  'reports:read': ['reports'],
  'closing:write': ['treasury'],
  'users:manage': ['users'],
  'dashboard:view': ['dashboard'],
  'inventory:manage': ['inventory'],
  'purchases:manage': ['purchases'],
  'settings:manage': ['settings'],
  'shareholders:manage': ['shareholders'],
};

const rolePermissions: Record<User['role'], Permission[]> = {
  admin: [
    'dashboard:view',
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
  manager: ['dashboard:view', 'sales:read', 'sales:write', 'payments:read', 'reports:read', 'notifications:read'],
  accountant: ['dashboard:view', 'sales:read', 'payments:read', 'payments:write', 'reports:read', 'notifications:read'],
  user: ['dashboard:view', 'sales:read', 'payments:read', 'notifications:read'],
  collector: ['dashboard:view', 'payments:read', 'payments:write', 'notifications:read'],
  reviewer: ['dashboard:view', 'sales:read', 'payments:read', 'reports:read', 'sales:reschedule', 'notifications:read'],
  finance_manager: ['dashboard:view', 'sales:read', 'payments:read', 'payments:reverse', 'reports:read', 'closing:write', 'notifications:read'],
};

/**
 * Checks if the current authenticated user has the given permission.
 */
export const hasPermission = (user: User | null, permission: Permission): boolean => {
  if (!user) return false;
  if (user.role === 'admin') return true;

  if (user.permissions?.[permission]) return true;

  if (!user.permissions) {
    return rolePermissions[user.role]?.includes(permission) ?? false;
  }

  return broadPermissionMap[permission]?.some((legacyPermission) => {
    const permissions = user.permissions as Record<string, boolean> | undefined;
    return !!permissions?.[legacyPermission];
  }) ?? false;
};
