import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { dbPromise } from '../db.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import {
  extractApiPermissions,
  getRolePermissions,
  parseStoredPermissionsObject,
  upsertUserAuthSnapshot,
} from '../permissions.js';
import type { UserRole } from '../types.js';
import { comparePassword, hashPassword, signToken, uid } from '../utils.js';

const router = Router();

function isAllowedInitialPassword(password?: string): password is string {
  if (!password || password.length < 12) return false;
  const blocked = new Set(['admin123', 'password123', '123456789012']);
  return !blocked.has(password.toLowerCase());
}

router.post('/seed-admin', async (req, res, next) => {
  try {
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
  } catch (err) {
    return next(err);
  }
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 attempts per 15 minutes per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'تم تجاوز عدد محاولات الدخول المسموح بها، يرجى المحاولة بعد 15 دقيقة.' },
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const schema = z.object({ username: z.string().min(1), password: z.string().min(1) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: 'بيانات الدخول غير مكتملة' });

    const db = await dbPromise;
    const user = await db.get<{ id: string; name: string; role: string; password_hash: string; is_active: number | boolean; permissions: string | null }>(
      'SELECT id, name, role, password_hash, is_active, permissions FROM users WHERE username = ?',
      parsed.data.username,
    );
    if (!user || !(user.is_active === 1 || user.is_active === true)) {
      return res.status(401).json({ message: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }

    const ok = await comparePassword(parsed.data.password, user.password_hash);
    if (!ok) return res.status(401).json({ message: 'اسم المستخدم أو كلمة المرور غير صحيحة' });

    const tokenPermissions = user.role === 'admin' ? undefined : extractApiPermissions(user.permissions);
    const userPermissions = user.role === 'admin' ? undefined : parseStoredPermissionsObject(user.permissions);
    upsertUserAuthSnapshot({
      id: user.id,
      name: user.name,
      role: user.role as UserRole,
      isActive: true,
      permissions: tokenPermissions,
    });
    const token = signToken({ userId: user.id, role: user.role, name: user.name, permissions: tokenPermissions });
    return res.json({ token, user: { id: user.id, name: user.name, role: user.role, permissions: userPermissions } });
  } catch (err) {
    return next(err);
  }
});

router.get('/me', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const db = await dbPromise;
    const user = await db.get<{
      id: string;
      username: string;
      name: string;
      role: string;
      is_active: number | boolean;
      permissions: string | null;
    }>('SELECT id, username, name, role, is_active, permissions FROM users WHERE id = ?', req.user!.userId);

    if (!user || !(user.is_active === 1 || user.is_active === true)) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const tokenPermissions = user.role === 'admin' ? undefined : extractApiPermissions(user.permissions);
    const userPermissions = user.role === 'admin' ? undefined : parseStoredPermissionsObject(user.permissions);
    upsertUserAuthSnapshot({
      id: user.id,
      name: user.name,
      role: user.role as UserRole,
      isActive: true,
      permissions: tokenPermissions,
    });

    return res.json({
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        permissions: userPermissions,
      },
      rolePermissions: getRolePermissions(),
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

export default router;

