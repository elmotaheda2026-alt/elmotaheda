import { dbPromise } from './db.js';
import { uid } from './utils.js';
import { ensureTelegramQueueColumn, sendTelegramNotification } from './telegramService.js';

type NotificationType = 'info' | 'warning' | 'success' | 'error';

export async function createSystemNotification(type: NotificationType, title: string, message: string) {
  const db = await dbPromise;
  await ensureTelegramQueueColumn();
  const notifId = uid();
  const createdAt = new Date().toISOString();
  await db.run(
    `INSERT INTO notifications (id, type, title, message, is_read, telegram_sent, created_at)
     VALUES (?, ?, ?, ?, 0, 0, ?)`,
    notifId,
    type,
    title,
    message,
    createdAt,
  );
  // Fire-and-forget Telegram forwarding; if offline, telegram_sent stays 0 and retry worker flushes it once internet returns
  void sendTelegramNotification(type, title, message, notifId, createdAt).catch(() => {});
}

export function formatMoney(amount: number) {
  return `${Number(amount || 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} جنيه`;
}

export function financialMovementLabel(type: 'in' | 'out') {
  return type === 'in' ? 'وارد' : 'صادر';
}
