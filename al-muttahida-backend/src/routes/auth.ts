import { Router } from 'express';
import { z } from 'zod';
import { dbPromise } from '../db.js';
import { comparePassword, hashPassword, signToken, uid } from '../utils.js';

const router = Router();

router.post('/seed-admin', async (_req, res) => {
  const db = await dbPromise;
  const existing = await db.get<{ count: number }>('SELECT COUNT(*) AS count FROM users');
  if ((existing?.count || 0) > 0) return res.status(409).json({ message: 'Users already exist' });

  const hashed = await hashPassword('admin123');
  const id = uid();
  await db.run(
    `INSERT INTO users (id, name, email, password_hash, role, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)`,
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
  const user = await db.get<{ id: string; name: string; role: string; password_hash: string; is_active: number }>(
    'SELECT id, name, role, password_hash, is_active FROM users WHERE email = ?',
    parsed.data.email,
  );
  if (!user || user.is_active !== 1) return res.status(401).json({ message: 'Invalid credentials' });
  const ok = await comparePassword(parsed.data.password, user.password_hash);
  if (!ok) return res.status(401).json({ message: 'Invalid credentials' });

  const token = signToken({ userId: user.id, role: user.role, name: user.name });
  return res.json({ token, user: { id: user.id, name: user.name, role: user.role } });
});

export default router;
