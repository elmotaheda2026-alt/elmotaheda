import { dbPromise } from './db.js';
import { uid } from './utils.js';

type NotificationType = 'info' | 'warning' | 'success' | 'error';

export async function createSystemNotification(type: NotificationType, title: string, message: string) {
  const db = await dbPromise;
  await db.run(
    `INSERT INTO notifications (id, type, title, message, is_read, created_at)
     VALUES (?, ?, ?, ?, 0, ?)`,
    uid(),
    type,
    title,
    message,
    new Date().toISOString(),
  );
}

export function formatMoney(amount: number) {
  return `${Number(amount || 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} جنيه`;
}

export function financialMovementLabel(type: 'in' | 'out') {
  return type === 'in' ? 'وارد' : 'صادر';
}
