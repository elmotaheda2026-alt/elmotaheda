import { Permission, User } from '../types';
import { isMobileDevice } from './apiClient';

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
  'payments:early_settlement': ['treasury'],
  'reports:read': ['reports'],
  'closing:write': ['treasury'],
  'users:manage': ['users'],
  'dashboard:view': ['dashboard'],
  'inventory:manage': ['inventory'],
  'purchases:manage': ['purchases'],
  'settings:manage': ['settings'],
  'shareholders:manage': ['shareholders'],
};

export const DEFAULT_ROLE_PERMISSIONS: Record<User['role'], Permission[]> = {
  admin: [
    'dashboard:view',
    'sales:read',
    'sales:write',
    'sales:reschedule',
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
  ],
  manager: [
    'dashboard:view',
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
    'dashboard:view',
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
  user: ['dashboard:view', 'sales:read', 'payments:read', 'notifications:read'],
  collector: ['dashboard:view', 'payments:read', 'payments:write', 'notifications:read'],
  reviewer: ['dashboard:view', 'sales:read', 'payments:read', 'reports:read', 'sales:reschedule', 'notifications:read'],
  finance_manager: [
    'dashboard:view',
    'sales:read',
    'sales:write',
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

let dynamicRolePermissions: Record<User['role'], Permission[]> = Object.fromEntries(
  Object.entries(DEFAULT_ROLE_PERMISSIONS).map(([role, perms]) => [role, [...perms]])
) as Record<User['role'], Permission[]>;

export function setDynamicRolePermissions(custom?: Partial<Record<User['role'], Permission[]>> | null): void {
  const next: Record<User['role'], Permission[]> = Object.fromEntries(
    Object.entries(DEFAULT_ROLE_PERMISSIONS).map(([role, perms]) => [role, [...perms]])
  ) as Record<User['role'], Permission[]>;

  if (custom && typeof custom === 'object') {
    (Object.keys(DEFAULT_ROLE_PERMISSIONS) as User['role'][]).forEach((role) => {
      if (role === 'admin') {
        next.admin = [...DEFAULT_ROLE_PERMISSIONS.admin];
        return;
      }
      const list = custom[role];
      if (Array.isArray(list)) {
        next[role] = Array.from(new Set(list));
      }
    });
  }

  dynamicRolePermissions = next;
}

export function getRolePermissionsSnapshot(): Record<User['role'], Permission[]> {
  return Object.fromEntries(
    Object.entries(dynamicRolePermissions).map(([role, perms]) => [role, [...perms]])
  ) as Record<User['role'], Permission[]>;
}

const MOBILE_BLOCKED_WRITE_PERMISSIONS: ReadonlySet<Permission> = new Set([
  'sales:write',
  'sales:reschedule',
  'payments:write',
  'payments:reverse',
  'closing:write',
]);

export const PERMISSION_CATALOG: { key: Permission; label: string; category: string }[] = [
  { key: 'dashboard:view', label: 'عرض الرئيسية والإحصائيات', category: 'عام' },
  { key: 'notifications:read', label: 'عرض مركز التنبيهات', category: 'عام' },
  { key: 'sales:read', label: 'عرض المبيعات والعملاء', category: 'المبيعات' },
  { key: 'sales:write', label: 'إضافة وتعديل المبيعات والعملاء', category: 'المبيعات' },
  { key: 'sales:reschedule', label: 'ترحيل وإعادة جدولة الأقساط', category: 'المبيعات' },
  { key: 'payments:read', label: 'عرض الخزينة والمدفوعات', category: 'الخزينة' },
  { key: 'payments:write', label: 'تسجيل تحصيل وصرف نقدي', category: 'الخزينة' },
  { key: 'payments:reverse', label: 'عكس وإلغاء الحركات المالية', category: 'الخزينة' },
  { key: 'payments:early_settlement', label: 'تكييش وتسوية مبكرة للأقساط', category: 'الخزينة' },
  { key: 'closing:write', label: 'إغلاق وفتح الفترات اليومية', category: 'الخزينة' },
  { key: 'inventory:manage', label: 'إدارة الأصناف والمخزون', category: 'المخزون' },
  { key: 'purchases:manage', label: 'إدارة المشتريات والموردين', category: 'المخزون' },
  { key: 'reports:read', label: 'عرض التقارير والقيود المالية', category: 'التقارير' },
  { key: 'shareholders:manage', label: 'إدارة حسابات الشركاء والمساهمين', category: 'الإدارة' },
  { key: 'users:manage', label: 'إدارة المستخدمين', category: 'الإدارة' },
  { key: 'settings:manage', label: 'تعديل إعدادات النظام', category: 'الإدارة' },
];

export const isAdmin = (user: User | null): boolean => user?.role === 'admin';
export const isSupervisor = (user: User | null): boolean => user?.role === 'manager';
export const isReadOnlyUser = (_user: User | null): boolean => isMobileDevice();
export const canModify = (user: User | null): boolean => !isMobileDevice() && Boolean(user);

/**
 * Checks if the current authenticated user has the given permission.
 */
export const hasPermission = (user: User | null, permission: Permission): boolean => {
  if (!user) return false;
  if (isMobileDevice() && MOBILE_BLOCKED_WRITE_PERMISSIONS.has(permission)) {
    return false;
  }
  if (user.role === 'admin') return true;

  // If user has explicit permissions object, respect its boolean values directly
  if (user.permissions && typeof user.permissions === 'object') {
    const customVal = user.permissions[permission];
    if (customVal !== undefined) {
      return customVal;
    }
  }

  // Fallback to dynamic role defaults
  return dynamicRolePermissions[user.role]?.includes(permission) ?? false;
};

export function getDefaultRouteForUser(user: User | null): string {
  if (!user) return '/login';
  if (hasPermission(user, 'dashboard:view')) return '/';
  if (hasPermission(user, 'sales:read')) return '/customers';
  if (hasPermission(user, 'purchases:manage')) return '/suppliers';
  if (hasPermission(user, 'inventory:manage')) return '/products-inventory';
  if (hasPermission(user, 'payments:read')) return '/payments';
  if (hasPermission(user, 'payments:write')) return '/expenses';
  if (hasPermission(user, 'reports:read')) return '/sales';
  if (hasPermission(user, 'shareholders:manage')) return '/shareholders';
  if (hasPermission(user, 'users:manage')) return '/users';
  if (hasPermission(user, 'notifications:read')) return '/notifications';
  if (hasPermission(user, 'settings:manage')) return '/settings';
  return '/';
}

export const canViewNotification = (
  user: User | null,
  notification: { title?: string | null; message?: string | null },
): boolean => {
  if (!user) return false;
  if (isAdmin(user)) return true;
  if (!hasPermission(user, 'notifications:read')) return false;

  const text = `${notification.title || ''} ${notification.message || ''}`;
    if (text.includes('حركة شريك') || text.includes('مساهم') || text.includes('تسوية أرباح') || text.includes('رأس المال')) {
      return hasPermission(user, 'shareholders:manage');
    }
    if (text.includes('تقرير') || text.includes('قيود') || text.includes('ميزان') || text.includes('أرباح')) {
      return hasPermission(user, 'reports:read');
    }
    if (text.includes('مستخدم') || text.includes('صلاحيات')) {
      return hasPermission(user, 'users:manage');
    }
    if (text.includes('نسخة احتياطية') || text.includes('إعدادات') || text.includes('واتساب') || text.includes('حذف جميع البيانات')) {
      return hasPermission(user, 'settings:manage');
    }
    if (text.includes('شراء تلقائي') || text.includes('فاتورة شراء') || text.includes('مديونية المورد')) {
      return hasPermission(user, 'purchases:manage') || hasPermission(user, 'sales:read');
    }
      if (text.includes('سند صرف') || text.includes('حركة خزينة') || text.includes('تكييش') || text.includes('عكس حركة مالية') || text.includes('إغلاق')) {
        return hasPermission(user, 'payments:read') || hasPermission(user, 'payments:write');
      }
      if (text.includes('فاتورة جديدة') || text.includes('تعديل تعاقد') || text.includes('مرتجع') || text.includes('ترحيل قسط')) {
        return hasPermission(user, 'sales:read') || hasPermission(user, 'sales:write');
      }
      return hasPermission(user, 'payments:read') || hasPermission(user, 'sales:read') || hasPermission(user, 'notifications:read');
    };
