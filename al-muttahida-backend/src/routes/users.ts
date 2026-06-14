import { Router } from 'express';
import { formatDate } from '../utils.js';
import { z } from 'zod';
import { dbPromise } from '../db.js';
import { requireAuth, requirePermission, type AuthedRequest } from '../middleware/auth.js';
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
  email: z.string().email(),
  password: z.string().min(6).optional().or(z.literal('')),
  role: z.enum(['admin', 'manager', 'accountant', 'user', 'collector', 'reviewer', 'finance_manager']),
  phone: z.string().optional().nullable(),
  isActive: z.boolean().default(true),
  permissions: userPermissionsSchema.optional().nullable(),
});

// GET /users
router.get('/', requirePermission('users:manage'), async (_req, res) => {
  try {
    const db = await dbPromise;
    const rows = await db.all('SELECT id, name, email, role, is_active, phone, permissions, created_at FROM users');
    const mapped = rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      isActive: row.is_active === 1 || row.is_active === true,
      phone: row.phone || '',
      createdAt: formatDate(row.created_at),
      permissions: row.permissions ? { ...defaultPermissions, ...JSON.parse(row.permissions) } : defaultPermissions,
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
  if (!data.password) {
    return res.status(400).json({ message: 'Password is required' });
  }

  const id = uid();
  const now = new Date().toISOString();

  try {
    const db = await dbPromise;
    const existing = await db.get('SELECT id FROM users WHERE email = ?', data.email);
    if (existing) {
      return res.status(409).json({ message: 'البريد الإلكتروني مسجل بالفعل لمستخدم آخر' });
    }

    const hashedPassword = await hashPassword(data.password);
    await db.run(
      `INSERT INTO users (id, name, email, password_hash, role, is_active, phone, permissions, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      data.name,
      data.email,
      hashedPassword,
      data.role,
      data.isActive ? 1 : 0,
      data.phone || null,
      data.permissions ? JSON.stringify(data.permissions) : null,
      now,
    );

    await audit('user.create', 'user', id, req.user?.name || 'system', {
      name: data.name,
      email: data.email,
      role: data.role,
      isActive: data.isActive,
      phone: data.phone,
      permissions: data.permissions,
    });

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

  try {
    const db = await dbPromise;
    const current = await db.get<{ id: string; password_hash: string }>('SELECT id, password_hash FROM users WHERE id = ?', req.params.id);
    if (!current) {
      return res.status(404).json({ message: 'User not found' });
    }

    let hashedPassword = current.password_hash;
    if (data.password && data.password.trim().length >= 6) {
      hashedPassword = await hashPassword(data.password);
    }

    await db.run(
      `UPDATE users
       SET name = ?, email = ?, password_hash = ?, role = ?, is_active = ?, phone = ?, permissions = ?
       WHERE id = ?`,
      data.name,
      data.email,
      hashedPassword,
      data.role,
      data.isActive ? 1 : 0,
      data.phone || null,
      data.permissions ? JSON.stringify(data.permissions) : null,
      req.params.id,
    );

    await audit('user.update', 'user', req.params.id, req.user?.name || 'system', {
      name: data.name,
      email: data.email,
      role: data.role,
      isActive: data.isActive,
      phone: data.phone,
      permissions: data.permissions,
    });

    return res.json({ message: 'User updated successfully' });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// DELETE /users/:id
router.delete('/:id', requirePermission('users:manage'), async (req: AuthedRequest, res) => {
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
    await audit('user.delete', 'user', req.params.id, req.user?.name || 'system', { id: req.params.id });
    return res.json({ message: 'User deleted successfully' });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});
router.delete('/', requirePermission('users:manage'), async (req: AuthedRequest, res) => {
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
