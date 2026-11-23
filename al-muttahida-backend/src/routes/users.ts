import { Router } from 'express';
import { formatDate } from '../utils.js';
import { z } from 'zod';
import { dbPromise } from '../db.js';
import { requireAdmin, requireAnyPermission, requireAuth, requirePermission, type AuthedRequest } from '../middleware/auth.js';
import {
  extractApiPermissions,
  parseStoredPermissionsObject,
  removeUserAuthSnapshot,
  upsertUserAuthSnapshot,
} from '../permissions.js';
import { broadcastDataChange } from '../realtime.js';
import type { UserRole } from '../types.js';
import { hashPassword, uid } from '../utils.js';
import { audit } from '../audit.js';

const router = Router();
router.use(requireAuth);

const userPermissionsSchema = z.object({
  'dashboard:view': z.boolean().default(true),
  'sales:read': z.boolean().default(false),
  'sales:write': z.boolean().default(false),
  'sales:reschedule': z.boolean().default(false),
  'payments:read': z.boolean().default(false),
  'payments:write': z.boolean().default(false),
  'payments:reverse': z.boolean().default(false),
  'payments:early_settlement': z.boolean().default(false),
  'reports:read': z.boolean().default(false),
  'closing:write': z.boolean().default(false),
  'users:manage': z.boolean().default(false),
  'inventory:manage': z.boolean().default(false),
  'purchases:manage': z.boolean().default(false),
  'settings:manage': z.boolean().default(false),
  'shareholders:manage': z.boolean().default(false),
  'notifications:read': z.boolean().default(false),
});

const defaultPermissions = {
  'dashboard:view': true,
  'sales:read': false,
  'sales:write': false,
  'sales:reschedule': false,
  'payments:read': false,
  'payments:write': false,
  'payments:reverse': false,
  'payments:early_settlement': false,
  'reports:read': false,
  'closing:write': false,
  'users:manage': false,
  'inventory:manage': false,
  'purchases:manage': false,
  'settings:manage': false,
  'shareholders:manage': false,
  'notifications:read': false,
};

const userSchema = z.object({
  name: z.string().min(1),
  username: z.string().min(3).regex(/^[A-Za-z0-9_]+$/),
  password: z.string().min(8, 'كلمة المرور يجب أن تكون 8 أحرف على الأقل').optional().or(z.literal('')),
  role: z.enum(['admin', 'manager', 'accountant', 'user', 'collector', 'reviewer', 'finance_manager']),
  phone: z.string().optional().nullable(),
  isActive: z.boolean().default(true),
  permissions: userPermissionsSchema.optional().nullable(),
});

// GET /users/admins - List active admin users for authorization selects
router.get('/admins', requireAnyPermission('users:manage', 'payments:write'), async (_req, res) => {
  try {
    const db = await dbPromise;
    const rows = await db.all<{ id: string; name: string; username: string }>(
      "SELECT id, name, username FROM users WHERE role = 'admin' AND is_active = 1 ORDER BY name ASC"
    );
    return res.json(rows);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// GET /users
router.get('/', requirePermission('users:manage'), async (_req, res) => {
  try {
    const db = await dbPromise;
    const rows = await db.all('SELECT id, name, username, role, is_active, phone, permissions, created_at FROM users');
    const mapped = rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      username: row.username,
      role: row.role,
      isActive: row.is_active === 1 || row.is_active === true,
      phone: row.phone || '',
      createdAt: formatDate(row.created_at),
      permissions: row.role === 'admin' ? null : (parseStoredPermissionsObject(row.permissions) || null),
    }));
    return res.json(mapped);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// POST /users
router.post('/', requirePermission('users:manage'), async (req: AuthedRequest, res) => {
  const parsed = userSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid user payload', errors: parsed.error.format() });
  }

  const data = parsed.data;
  if (data.role === 'admin' && req.user?.role !== 'admin') {
    return res.status(403).json({ message: 'إنشاء حساب مدير نظام يتطلب صلاحية المدير العام.' });
  }
  if (!data.password) {
    return res.status(400).json({ message: 'Password is required' });
  }

  const id = uid();
  const now = new Date().toISOString();

  try {
    const db = await dbPromise;
    const existing = await db.get('SELECT id FROM users WHERE username = ?', data.username);
    if (existing) {
      return res.status(409).json({ message: 'اسم المستخدم مسجل بالفعل لمستخدم آخر' });
    }

    const hashedPassword = await hashPassword(data.password);
    const storedPermissions = data.role === 'admin' || !data.permissions ? null : JSON.stringify(data.permissions);
    await db.run(
      `INSERT INTO users (id, name, username, password_hash, role, is_active, phone, permissions, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      data.name,
      data.username,
      hashedPassword,
      data.role,
      data.isActive ? 1 : 0,
      data.phone || null,
      storedPermissions,
      now,
    );

    upsertUserAuthSnapshot({
      id,
      name: data.name,
      role: data.role as UserRole,
      isActive: data.isActive,
      permissions: data.role === 'admin' ? undefined : extractApiPermissions(storedPermissions),
    });

    await audit('user.create', 'user', id, req.user?.name || 'system', {
      name: data.name,
      username: data.username,
      role: data.role,
      isActive: data.isActive,
      phone: data.phone,
      permissions: data.role === 'admin' ? null : data.permissions,
    });
    broadcastDataChange('users', 'create');

    return res.status(201).json({ id });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// PUT /users/:id
router.put('/:id', requirePermission('users:manage'), async (req: AuthedRequest, res) => {
  const parsed = userSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid user payload', errors: parsed.error.format() });
  }

  const data = parsed.data;
  if (data.role === 'admin' && req.user?.role !== 'admin') {
    return res.status(403).json({ message: 'ترقية حساب إلى مدير نظام يتطلب صلاحية المدير العام.' });
  }

  try {
    const db = await dbPromise;
    const current = await db.get<{ id: string; role: string; password_hash: string }>(
      'SELECT id, role, password_hash FROM users WHERE id = ?',
      req.params.id,
    );
    if (!current) {
      return res.status(404).json({ message: 'User not found' });
    }
    if (current.role === 'admin' && req.user?.role !== 'admin') {
      return res.status(403).json({ message: 'تعديل حساب مدير نظام يتطلب صلاحية المدير العام.' });
    }

    let hashedPassword = current.password_hash;
    if (data.password && data.password.trim().length >= 6) {
      hashedPassword = await hashPassword(data.password);
    }

    const storedPermissions = data.role === 'admin' || !data.permissions ? null : JSON.stringify(data.permissions);
    await db.run(
      `UPDATE users
       SET name = ?, username = ?, password_hash = ?, role = ?, is_active = ?, phone = ?, permissions = ?
       WHERE id = ?`,
      data.name,
      data.username,
      hashedPassword,
      data.role,
      data.isActive ? 1 : 0,
      data.phone || null,
      storedPermissions,
      req.params.id,
    );

    upsertUserAuthSnapshot({
      id: req.params.id,
      name: data.name,
      role: data.role as UserRole,
      isActive: data.isActive,
      permissions: data.role === 'admin' ? undefined : extractApiPermissions(storedPermissions),
    });

    await audit('user.update', 'user', req.params.id, req.user?.name || 'system', {
      name: data.name,
      username: data.username,
      role: data.role,
      isActive: data.isActive,
      phone: data.phone,
      permissions: data.role === 'admin' ? null : data.permissions,
    });
    broadcastDataChange('users', 'update');

    return res.json({ message: 'User updated successfully' });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// PATCH /users/:id/status
router.patch('/:id/status', requirePermission('users:manage'), async (req: AuthedRequest, res) => {
  const parsed = z.object({ isActive: z.boolean() }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid status payload' });
  }

  try {
    const db = await dbPromise;
    const current = await db.get<{ id: string; username: string; name: string; role: string; permissions: string | null }>(
      'SELECT id, username, name, role, permissions FROM users WHERE id = ?',
      req.params.id,
    );
    if (!current) {
      return res.status(404).json({ message: 'User not found' });
    }
    if (current.role === 'admin' && req.user?.role !== 'admin') {
      return res.status(403).json({ message: 'تغيير حالة مدير نظام يتطلب صلاحية المدير العام.' });
    }

    if (req.user?.userId === req.params.id && !parsed.data.isActive) {
      return res.status(400).json({ message: 'لا يمكنك تعطيل حسابك الحالي النشط' });
    }

    await db.run('UPDATE users SET is_active = ? WHERE id = ?', parsed.data.isActive ? 1 : 0, req.params.id);
    upsertUserAuthSnapshot({
      id: current.id,
      name: current.name,
      role: current.role as UserRole,
      isActive: parsed.data.isActive,
      permissions: current.role === 'admin' ? undefined : extractApiPermissions(current.permissions),
    });
    await audit('user.toggle_status', 'user', req.params.id, req.user?.name || 'system', {
      username: current.username,
      isActive: parsed.data.isActive,
    });
    broadcastDataChange('users', 'update');

    return res.json({ message: 'تم تحديث حالة المستخدم بنجاح', isActive: parsed.data.isActive });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// DELETE /users/:id
router.delete('/:id', requirePermission('users:manage'), requireAdmin, async (req: AuthedRequest, res) => {
  try {
    const db = await dbPromise;
    const current = await db.get<{ id: string }>('SELECT id FROM users WHERE id = ?', req.params.id);
    if (!current) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (req.user?.userId === req.params.id) {
      return res.status(400).json({ message: 'لا يمكنك حذف حسابك الحالي النشط' });
    }

    await db.run('DELETE FROM users WHERE id = ?', req.params.id);
    removeUserAuthSnapshot(req.params.id);
    await audit('user.delete', 'user', req.params.id, req.user?.name || 'system', { id: req.params.id });
    broadcastDataChange('users', 'delete');
    return res.json({ message: 'User deleted successfully' });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});
router.delete('/', requirePermission('users:manage'), requireAdmin, async (req: AuthedRequest, res) => {
  // Only enable in development/testing via ALLOW_BULK_DELETE env var
  if (process.env.ALLOW_BULK_DELETE !== 'true') {
    return res.status(403).json({ message: 'Bulk delete not allowed' });
  }
  try {
    const db = await dbPromise;
    await db.run('DELETE FROM users');
    await audit('user.bulkDelete', 'user', '-', req.user?.name || 'system', {});
    return res.json({ message: 'All users deleted successfully' });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

export default router;
