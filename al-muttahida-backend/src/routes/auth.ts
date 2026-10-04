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
  sales: ['sales:read', 'sales:write', 'sales:reschedule', 'inventory:manage', 'purchases:manage', 'reports:read'],
  customers: ['sales:read', 'sales:write'],
  treasury: ['payments:read', 'payments:write', 'payments:reverse', 'closing:write'],
  collection: ['payments:read', 'reports:read', 'notifications:read'],
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

function isAllowedInitialPassword(password?: string): password is string {
  if (!password || password.length < 12) return false;
  const blocked = new Set(['admin123', 'password123', '123456789012']);
  return !blocked.has(password.toLowerCase());
}

router.post('/seed-admin', async (req, res) => {
  const provisioningEnabled = process.env.ENABLE_ADMIN_PROVISIONING === 'true';
  const provisioningToken = process.env.ADMIN_PROVISIONING_TOKEN;
  const requestedToken = req.headers['x-admin-provisioning-token'];
  const initialPassword = process.env.ADMIN_INITIAL_PASSWORD;

  if (!provisioningEnabled) {
    return res.status(404).json({ message: 'Not found' });
  }

  if (!provisioningToken || provisioningToken.length < 32) {
    return res.status(503).json({ message: 'Admin provisioning is not configured securely' });
  }

  if (requestedToken !== provisioningToken) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  if (!isAllowedInitialPassword(initialPassword)) {
    return res.status(503).json({ message: 'Admin initial password is not configured securely' });
  }

  const db = await dbPromise;
  const existing = await db.get<{ id: string }>('SELECT id FROM users WHERE username = ?', 'admin');

  if (existing?.id) {
    return res.status(409).json({ message: 'Admin already exists' });
  }

  const hashed = await hashPassword(initialPassword);
  const id = uid();
  await db.run(
    `INSERT INTO users (id, name, username, password_hash, role, is_active, created_at)` +
    ` VALUES (?, ?, ?, ?, ?, 1, ?)`,
    id,
    'System Admin',
    'admin',
    hashed,
    'admin',
    new Date().toISOString(),
  );
  return res.status(201).json({ message: 'Admin created', username: 'admin' });
});
router.post('/login', async (req, res) => {
  const schema = z.object({ username: z.string().min(3), password: z.string().min(6) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid payload' });

  const db = await dbPromise;
  const user = await db.get<{ id: string; name: string; role: string; password_hash: string; is_active: number | boolean; permissions: string | null }>(
    'SELECT id, name, role, password_hash, is_active, permissions FROM users WHERE username = ?',
    parsed.data.username,
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

