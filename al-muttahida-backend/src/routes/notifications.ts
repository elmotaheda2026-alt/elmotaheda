import { Router } from 'express';
import { z } from 'zod';
import { dbPromise } from '../db.js';
import { requireAdmin, requireAnyPermission, requireAuth, requirePermission, type AuthedRequest } from '../middleware/auth.js';
import { hasPermission } from '../permissions.js';
import { uid, formatDate } from '../utils.js';

const router = Router();
router.use(requireAuth);

function canViewNotification(user: AuthedRequest['user'], row: { title?: string; message?: string }): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (!hasPermission(user.role, 'notifications:read', user.permissions)) return false;

  const text = `${row.title || ''} ${row.message || ''}`;
    if (text.includes('حركة شريك') || text.includes('مساهم') || text.includes('تسوية أرباح') || text.includes('رأس المال')) {
      return hasPermission(user.role, 'shareholders:manage', user.permissions);
    }
    if (text.includes('تقرير') || text.includes('قيود') || text.includes('ميزان') || text.includes('أرباح')) {
      return hasPermission(user.role, 'reports:read', user.permissions);
    }
    if (text.includes('مستخدم') || text.includes('صلاحيات')) {
      return hasPermission(user.role, 'users:manage', user.permissions);
    }
    if (text.includes('نسخة احتياطية') || text.includes('إعدادات') || text.includes('واتساب') || text.includes('حذف جميع البيانات')) {
      return hasPermission(user.role, 'settings:manage', user.permissions);
    }
    if (text.includes('شراء تلقائي') || text.includes('فاتورة شراء') || text.includes('مديونية المورد')) {
      return hasPermission(user.role, 'purchases:manage', user.permissions) || hasPermission(user.role, 'sales:read', user.permissions);
    }
      if (text.includes('سند صرف') || text.includes('حركة خزينة') || text.includes('تكييش') || text.includes('عكس حركة مالية') || text.includes('إغلاق')) {
        return hasPermission(user.role, 'payments:read', user.permissions) || hasPermission(user.role, 'payments:write', user.permissions);
      }
      if (text.includes('فاتورة جديدة') || text.includes('تعديل تعاقد') || text.includes('مرتجع') || text.includes('ترحيل قسط')) {
        return hasPermission(user.role, 'sales:read', user.permissions) || hasPermission(user.role, 'sales:write', user.permissions);
      }
      return hasPermission(user.role, 'payments:read', user.permissions) || hasPermission(user.role, 'sales:read', user.permissions) || hasPermission(user.role, 'notifications:read', user.permissions);
    }

    const notificationSchema = z.object({
      type: z.enum(['info', 'warning', 'success', 'error']).default('info'),
      title: z.string().min(1),
      message: z.string().min(1),
    });

    // GET /notifications
    router.get('/', async (req: AuthedRequest, res) => {
      try {
        const db = await dbPromise;
        const rawLimit = Number(req.query.limit);
        const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 300) : 150;
        const rows = await db.all('SELECT TOP (?) * FROM notifications ORDER BY created_at DESC', limit);
        const mapped = rows
          .filter((row: any) => canViewNotification(req.user, row))
          .map((row: any) => ({
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
    router.post('/', requireAnyPermission('sales:write', 'payments:write', 'settings:manage'), async (req: AuthedRequest, res) => {
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
    router.delete('/:id', requireAdmin, async (req, res) => {
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
