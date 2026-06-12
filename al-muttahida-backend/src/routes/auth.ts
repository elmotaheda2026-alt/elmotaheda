import { Router } from 'express';
import { z } from 'zod';
import { dbPromise } from '../db.js';
import { Permission } from '../types.js';
import { comparePassword, hashPassword, signToken, uid } from '../utils.js';

const router = Router();

const apiPermissions: Permission[] = [
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

const legacyPermissionMap: Record<string, Permission[]> = {
  sales: ['sales:read', 'sales:write'],
  customers: ['sales:read', 'sales:write'],
  suppliers: ['sales:read', 'sales:write'],
  treasury: ['payments:read', 'payments:write'],
  reports: ['reports:read'],
  users: ['users:manage'],
};

function parseApiPermissions(value?: string | null): Permission[] | undefined {
  if (!value) return undefined;
  try {
    const permissions = JSON.parse(value) as Record<string, boolean>;
    const parsedPermissions = new Set<Permission>();
    apiPermissions.forEach((permission) => {
      if (permissions[permission]) parsedPermissions.add(permission);
    });
    Object.entries(legacyPermissionMap).forEach(([legacyPermission, mappedPermissions]) => {
      if (permissions[legacyPermission]) {
        mappedPermissions.forEach((permission) => parsedPermissions.add(permission));
      }
    });
    return [...parsedPermissions];
  } catch {
    return undefined;
  }
}

function parseStoredPermissions(value?: string | null): Record<string, boolean> | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as Record<string, boolean>;
  } catch {
    return undefined;
  }
}

router.post('/seed-admin', async (_req, res) => {
  if (process.env.ALLOW_SEED !== 'true') {
    return res.status(404).json({ message: 'Not found' });
  }
  const db = await dbPromise;
  const existing = await db.get<{ count: number }>('SELECT COUNT(*) AS count FROM users');
  if ((existing?.count || 0) > 0) return res.status(409).json({ message: 'Users already exist' });

  const hashed = await hashPassword('admin123');
  const id = uid();
  await db.run(
    `INSERT INTO users (id, name, email, password_hash, role, is_active, created_at)` +
    ` VALUES (?, ?, ?, ?, ?, 1, ?)`,
    id,
    'مدير النظام',
    'admin@almuttahida.com',
    hashed,
    'admin',
    new Date().toISOString(),
  );
  return res.json({ message: 'Admin created', email: 'admin@almuttahida.com', password: 'admin123' });
});

router.post('/login', async (req, res) => {
  const schema = z.object({ email: z.string().email(), password: z.string().min(6) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid payload' });

  const db = await dbPromise;
  const user = await db.get<{ id: string; name: string; role: string; password_hash: string; is_active: number | boolean; permissions: string | null }>(
    'SELECT id, name, role, password_hash, is_active, permissions FROM users WHERE email = ?',
    parsed.data.email,
  );
  if (!user || !(user.is_active === 1 || user.is_active === true)) return res.status(401).json({ message: 'Invalid credentials' });
  const ok = await comparePassword(parsed.data.password, user.password_hash);
  if (!ok) return res.status(401).json({ message: 'Invalid credentials' });

  const tokenPermissions = parseApiPermissions(user.permissions);
  const userPermissions = parseStoredPermissions(user.permissions);
  const token = signToken({ userId: user.id, role: user.role, name: user.name, permissions: tokenPermissions });
  return res.json({ token, user: { id: user.id, name: user.name, role: user.role, permissions: userPermissions } });
});

export default router;
