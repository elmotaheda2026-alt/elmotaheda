import { Permission, UserRole } from './types.js';

export const validPermissions: Permission[] = [
  'dashboard:view',
  'sales:read',
  'sales:write',
  'sales:reschedule',
  'sales:transfer',
  'sales:guarantors',
  'payments:read',
  'payments:write',
  'payments:reverse',
  'payments:early_settlement',
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
    'dashboard:view',
    'sales:read',
    'sales:write',
    'sales:reschedule',
    'sales:transfer',
    'sales:guarantors',
    'payments:read',
    'payments:write',
    'reports:read',
    'inventory:manage',
    'purchases:manage',
    'notifications:read',
  ],
  accountant: [
    'dashboard:view',
    'sales:read',
    'sales:write',
    'sales:guarantors',
    'payments:read',
    'payments:write',
    'payments:reverse',
    'closing:write',
    'inventory:manage',
    'purchases:manage',
    'notifications:read',
  ],
  user: [
    'dashboard:view',
    'sales:read',
    'payments:read',
    'notifications:read',
  ],
  collector: [
    'dashboard:view',
    'payments:read',
    'payments:write',
    'notifications:read',
  ],
  reviewer: [
    'dashboard:view',
    'sales:read',
    'payments:read',
    'reports:read',
    'sales:reschedule',
    'notifications:read',
  ],
  finance_manager: [
    'dashboard:view',
    'sales:read',
    'sales:write',
    'sales:transfer',
    'sales:guarantors',
    'payments:read',
    'payments:write',
    'payments:reverse',
    'payments:early_settlement',
    'reports:read',
    'closing:write',
    'inventory:manage',
    'purchases:manage',
    'shareholders:manage',
    'notifications:read',
  ],
};

export const legacyPermissionMap: Record<string, Permission[]> = {
  sales: ['sales:read', 'sales:write', 'sales:reschedule', 'sales:transfer', 'sales:guarantors', 'inventory:manage', 'purchases:manage', 'reports:read'],
  customers: ['sales:read', 'sales:write'],
  treasury: ['payments:read', 'payments:write', 'payments:reverse', 'closing:write'],
  collection: ['payments:read', 'reports:read', 'notifications:read'],
};

export function parseStoredPermissionsObject(value?: string | null): Record<string, boolean> | undefined {
  if (!value) return undefined;
  try {
    let raw: unknown = value;
    for (let i = 0; i < 6 && typeof raw === 'string'; i++) {
      const trimmed = raw.trim();
      if (!trimmed) return undefined;
      raw = JSON.parse(trimmed);
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const entries = Object.entries(raw as Record<string, unknown>);
    if (entries.length === 0) return undefined;
    const parsed: Record<string, boolean> = {};
    for (const [key, val] of entries) {
      parsed[key] = Boolean(val);
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export function extractApiPermissions(value?: string | null): Permission[] | undefined {
  const permissions = parseStoredPermissionsObject(value);
  if (!permissions) return undefined;

  const parsedPermissions = new Set<Permission>();
  validPermissions.forEach((permission) => {
    if (permissions[permission]) parsedPermissions.add(permission);
  });
  Object.entries(legacyPermissionMap).forEach(([legacyPermission, mappedPermissions]) => {
    if (permissions[legacyPermission]) {
      mappedPermissions.forEach((permission) => parsedPermissions.add(permission));
    }
  });
  return [...parsedPermissions];
}

let dynamicRolePermissions: Record<UserRole, Permission[]> = Object.fromEntries(
  Object.entries(defaultRolePermissions).map(([role, perms]) => [role, [...perms]])
) as Record<UserRole, Permission[]>;

export interface LiveUserAuth {
  id: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  permissions?: Permission[];
}

let userAuthSnapshotLoaded = false;
const userAuthSnapshot = new Map<string, LiveUserAuth>();

export function setUserAuthSnapshot(users: LiveUserAuth[]): void {
  userAuthSnapshot.clear();
  for (const user of users) {
    userAuthSnapshot.set(user.id, {
      ...user,
      permissions: user.role === 'admin' || !Array.isArray(user.permissions) ? undefined : [...user.permissions],
    });
  }
  userAuthSnapshotLoaded = true;
}

export function upsertUserAuthSnapshot(user: LiveUserAuth): void {
  userAuthSnapshot.set(user.id, {
    ...user,
    permissions: user.role === 'admin' || !Array.isArray(user.permissions) ? undefined : [...user.permissions],
  });
}

export function removeUserAuthSnapshot(userId: string): void {
  userAuthSnapshot.delete(userId);
}

export function clearNonAdminUserPermissionOverrides(): void {
  for (const [id, user] of userAuthSnapshot.entries()) {
    if (user.role !== 'admin') {
      userAuthSnapshot.set(id, { ...user, permissions: undefined });
    }
  }
}

export function getLiveUserAuth(userId: string): { loaded: boolean; user?: LiveUserAuth } {
  if (!userAuthSnapshotLoaded) {
    return { loaded: false };
  }
  const found = userAuthSnapshot.get(userId);
  if (!found) {
    return { loaded: true, user: undefined };
  }
  return {
    loaded: true,
    user: {
      ...found,
      permissions: Array.isArray(found.permissions) ? [...found.permissions] : undefined,
    },
  };
}

export function resetUserAuthSnapshotForTests(): void {
  userAuthSnapshot.clear();
  userAuthSnapshotLoaded = false;
}

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
  if (Array.isArray(userPermissions)) {
    return userPermissions.includes(permission);
  }
  return dynamicRolePermissions[role]?.includes(permission) ?? false;
}
