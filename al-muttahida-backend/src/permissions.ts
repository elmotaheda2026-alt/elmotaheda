import { Permission, UserRole } from './types.js';

export const validPermissions: Permission[] = [
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
];

export const defaultRolePermissions: Record<UserRole, Permission[]> = {
  admin: [...validPermissions],
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

let dynamicRolePermissions: Record<UserRole, Permission[]> = Object.fromEntries(
  Object.entries(defaultRolePermissions).map(([role, perms]) => [role, [...perms]])
) as Record<UserRole, Permission[]>;

export function getRolePermissions(): Record<UserRole, Permission[]> {
  return Object.fromEntries(
    Object.entries(dynamicRolePermissions).map(([role, perms]) => [role, [...perms]])
  ) as Record<UserRole, Permission[]>;
}

export function setRolePermissions(custom?: Partial<Record<UserRole, Permission[]>> | null): Record<UserRole, Permission[]> {
  const next: Record<UserRole, Permission[]> = Object.fromEntries(
    Object.entries(defaultRolePermissions).map(([role, perms]) => [role, [...perms]])
  ) as Record<UserRole, Permission[]>;

  if (custom && typeof custom === 'object') {
    for (const role of Object.keys(defaultRolePermissions) as UserRole[]) {
      if (role === 'admin') {
        next.admin = [...defaultRolePermissions.admin];
        continue;
      }
      const list = custom[role];
      if (Array.isArray(list)) {
        next[role] = Array.from(new Set(list.filter((p): p is Permission => validPermissions.includes(p))));
      }
    }
  }

  dynamicRolePermissions = next;
  return getRolePermissions();
}

export function hasPermission(role: UserRole, permission: Permission, userPermissions?: Permission[]): boolean {
  if (role === 'admin') return true;
  if (Array.isArray(userPermissions) && userPermissions.length > 0) {
    return userPermissions.includes(permission);
  }
  return dynamicRolePermissions[role]?.includes(permission) ?? false;
}
