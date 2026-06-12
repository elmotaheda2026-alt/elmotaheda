import { Router } from 'express';
import { z } from 'zod';
import { dbPromise } from '../db.js';
import { requireAuth, requirePermission, type AuthedRequest } from '../middleware/auth.js';
import { uid, formatDate } from '../utils.js';

const router = Router();
router.use(requireAuth);

const notificationSchema = z.object({
  type: z.enum(['info', 'warning', 'success', 'error']).default('info'),
  title: z.string().min(1),
  message: z.string().min(1),
});

// GET /notifications
router.get('/', requirePermission('notifications:read'), async (_req, res) => {
  try {
    const db = await dbPromise;
    const rows = await db.all('SELECT * FROM notifications ORDER BY created_at DESC');
    const mapped = rows.map((row: any) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      message: row.message,
      isRead: row.is_read === 1 || row.is_read === true,
      createdAt: formatDate(row.created_at),
    }));
    return res.json(mapped);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// POST /notifications (usually created by system triggers)
router.post('/', async (req: AuthedRequest, res) => {
  const parsed = notificationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid notification payload', errors: parsed.error.format() });
  }

  const data = parsed.data;
  const id = uid();
  const now = new Date().toISOString();

  try {
    const db = await dbPromise;
    await db.run(
      `INSERT INTO notifications (id, type, title, message, is_read, created_at)
       VALUES (?, ?, ?, ?, 0, ?)`,
      id,
      data.type,
      data.title,
      data.message,
      now,
    );
    return res.status(201).json({ id });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// PUT /notifications/read-all
router.put('/read-all', requirePermission('notifications:read'), async (_req, res) => {
  try {
    const db = await dbPromise;
    await db.run('UPDATE notifications SET is_read = 1');
    return res.json({ message: 'All notifications marked as read' });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// PUT /notifications/:id/read
router.put('/:id/read', requirePermission('notifications:read'), async (req, res) => {
  try {
    const db = await dbPromise;
    const existing = await db.get('SELECT id FROM notifications WHERE id = ?', req.params.id);
    if (!existing) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    await db.run('UPDATE notifications SET is_read = 1 WHERE id = ?', req.params.id);
    return res.json({ message: 'Notification marked as read' });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// DELETE /notifications/:id
router.delete('/:id', requirePermission('notifications:read'), async (req, res) => {
  try {
    const db = await dbPromise;
    const existing = await db.get('SELECT id FROM notifications WHERE id = ?', req.params.id);
    if (!existing) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    await db.run('DELETE FROM notifications WHERE id = ?', req.params.id);
    return res.json({ message: 'Notification deleted successfully' });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

export default router;
