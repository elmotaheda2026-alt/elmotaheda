import { dbPromise } from './db.js';

export interface TelegramConfig {
  enabled: boolean;
  botToken: string;
  chatIds: string;
}

const DEFAULT_TELEGRAM_CONFIG: TelegramConfig = {
  enabled: false,
  botToken: '',
  chatIds: '',
};

let cachedConfig: { value: TelegramConfig; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 30_000;
let telegramColumnEnsured = false;
let retryTimer: ReturnType<typeof setInterval> | null = null;
let isFlushingQueue = false;

export function invalidateTelegramConfigCache() {
  cachedConfig = null;
}

export async function ensureTelegramQueueColumn(): Promise<void> {
  if (telegramColumnEnsured) return;
  try {
    const db = await dbPromise;
    await db.run(`
      IF OBJECT_ID('notifications', 'U') IS NOT NULL AND COL_LENGTH('notifications', 'telegram_sent') IS NULL
      BEGIN
        ALTER TABLE notifications ADD telegram_sent BIT NOT NULL DEFAULT 1;
      END
    `);
    telegramColumnEnsured = true;
  } catch (err: any) {
    console.warn('[Telegram] Could not ensure telegram_sent column:', err?.message || err);
  }
}

export function parseTelegramConfig(raw?: string | null): TelegramConfig {
  if (!raw) return { ...DEFAULT_TELEGRAM_CONFIG };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_TELEGRAM_CONFIG };
    return {
      enabled: Boolean(parsed.enabled),
      botToken: typeof parsed.botToken === 'string' ? parsed.botToken.trim() : '',
      chatIds: typeof parsed.chatIds === 'string' ? parsed.chatIds.trim() : '',
    };
  } catch {
    return { ...DEFAULT_TELEGRAM_CONFIG };
  }
}

export function parseChatIdList(chatIds: string): string[] {
  return String(chatIds || '')
    .split(/[\s,;،]+/)
    .map((id) => id.trim())
    .filter((id) => /^-?\d+$/.test(id));
}

function escapeHtml(text: string): string {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function resolveEmoji(type: 'info' | 'warning' | 'success' | 'error', title: string, message: string): string {
  const combined = `${title} ${message}`;
  if (/تنازل عن عقد|نقل المتبقي/.test(combined)) return '🔄';
  if (/استبدال ضامن|إضافة ضامن/.test(combined)) return '🛡️';
  if (/مرتجع|إلغاء|عكس حركة/.test(combined)) return '↩️';
  if (/تكييش|سداد مبكر|تسوية مبكرة/.test(combined)) return '⚡';
  if (/شريك|شركاء|مساهم|رأس مال|أرباح/.test(combined)) return '🤝';
  if (/خزينة وارد|تحصيل|سند قبض/.test(combined)) return '💰';
  if (/خزينة صادر|مصروف|سند صرف/.test(combined)) return '💸';
  if (/فاتورة|تعاقد/.test(combined)) return '🧾';
  if (/ترحيل|جدولة|قسط/.test(combined)) return '📅';
  if (type === 'success') return '✅';
  if (type === 'warning') return '⚠️';
  if (type === 'error') return '🔴';
  return '🔔';
}

function formatCairoDateTime(isoDate?: string): string {
  const d = isoDate ? new Date(isoDate) : new Date();
  const safeDate = Number.isNaN(d.getTime()) ? new Date() : d;
  try {
    return new Intl.DateTimeFormat('ar-EG', {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(safeDate);
  } catch {
    return safeDate.toISOString().slice(0, 16).replace('T', ' ');
  }
}

async function getActiveTelegramConfig(): Promise<TelegramConfig> {
  if (cachedConfig && Date.now() - cachedConfig.fetchedAt < CACHE_TTL_MS) {
    return cachedConfig.value;
  }
  try {
    const db = await dbPromise;
    const row = await db.get<{ telegram_config_json?: string | null }>(
      `IF COL_LENGTH('settings', 'telegram_config_json') IS NOT NULL
         SELECT TOP 1 telegram_config_json FROM settings
       ELSE
         SELECT NULL AS telegram_config_json`,
    );
    const parsed = parseTelegramConfig(row?.telegram_config_json);
    cachedConfig = { value: parsed, fetchedAt: Date.now() };
    return parsed;
  } catch {
    return { ...DEFAULT_TELEGRAM_CONFIG };
  }
}

async function postTelegramMessage(botToken: string, chatId: string, htmlText: string): Promise<{ ok: boolean; error?: string }> {
  const url = `https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendMessage`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: htmlText,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(6000),
    });

    const data: any = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) {
      return { ok: false, error: data?.description || `HTTP ${response.status}` };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Network timeout' };
  }
}

async function markNotificationTelegramSent(notificationId: string): Promise<void> {
  try {
    const db = await dbPromise;
    await db.run('UPDATE notifications SET telegram_sent = 1 WHERE id = ?', notificationId);
  } catch {
    // Ignore transient update error
  }
}

export async function sendTelegramNotification(
  type: 'info' | 'warning' | 'success' | 'error',
  title: string,
  message: string,
  notificationId?: string,
  createdAtIso?: string,
): Promise<boolean> {
  const cfg = await getActiveTelegramConfig();
  const targets = parseChatIdList(cfg.chatIds);
  if (!cfg.enabled || !cfg.botToken || targets.length === 0) {
    if (notificationId) {
      await markNotificationTelegramSent(notificationId);
    }
    return false;
  }

  const emoji = resolveEmoji(type, title, message);
  const htmlText =
    `${emoji} <b>${escapeHtml(title)}</b>\n` +
    `${escapeHtml(message)}\n` +
    `<i>🕒 ${escapeHtml(formatCairoDateTime(createdAtIso))}</i>`;

  let anySucceeded = false;
  for (const chatId of targets) {
    const res = await postTelegramMessage(cfg.botToken, chatId, htmlText);
    if (res.ok) {
      anySucceeded = true;
    } else {
      console.warn(`[Telegram] Failed to send to ${chatId}: ${res.error}`);
    }
  }

  if (anySucceeded && notificationId) {
    await markNotificationTelegramSent(notificationId);
  }
  return anySucceeded;
}

export async function flushPendingTelegramNotifications(): Promise<void> {
  if (isFlushingQueue) return;
  isFlushingQueue = true;
  try {
    await ensureTelegramQueueColumn();
    const cfg = await getActiveTelegramConfig();
    const targets = parseChatIdList(cfg.chatIds);
    if (!cfg.enabled || !cfg.botToken || targets.length === 0) return;

    const db = await dbPromise;
    const sevenDaysAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const pending = await db.all<{
      id: string;
      type: 'info' | 'warning' | 'success' | 'error';
      title: string;
      message: string;
      created_at: string;
    }>(
      `SELECT TOP 20 id, type, title, message, created_at
       FROM notifications
       WHERE telegram_sent = 0
         AND created_at >= ?
       ORDER BY created_at ASC`,
      sevenDaysAgoIso,
    );

    if (!pending || pending.length === 0) return;

    for (const item of pending) {
      const ok = await sendTelegramNotification(
        item.type || 'info',
        item.title || 'إشعار النظام',
        item.message || '',
        item.id,
        item.created_at,
      );
      if (!ok) {
        // Internet still offline or Telegram unreachable — stop batch and retry next cycle
        break;
      }
      await new Promise((r) => setTimeout(r, 350));
    }
  } catch (err: any) {
    console.warn('[Telegram Queue] Flush warning:', err?.message || err);
  } finally {
    isFlushingQueue = false;
  }
}

export function startTelegramRetryWorker(): void {
  if (retryTimer) return;
  void ensureTelegramQueueColumn().then(() => {
    setTimeout(() => {
      void flushPendingTelegramNotifications();
    }, 8000);
  });
  retryTimer = setInterval(() => {
    void flushPendingTelegramNotifications();
  }, 60_000);
}

export async function testTelegramConnection(
  botToken: string,
  chatIds: string,
): Promise<{ ok: boolean; sentCount: number; error?: string }> {
  const cleanToken = String(botToken || '').trim();
  const targets = parseChatIdList(chatIds);
  if (!cleanToken) {
    return { ok: false, sentCount: 0, error: 'يرجى إدخال رمز البوت (Bot Token) أولاً.' };
  }
  if (targets.length === 0) {
    return { ok: false, sentCount: 0, error: 'يرجى إدخال رقم محادثة (Chat ID) صحيح (أرقام فقط، أو رقم جروب يبدأ بـ -).' };
  }

  const htmlText =
    `✅ <b>تم ربط إشعارات شركة المتحدة بتليجرام بنجاح!</b>\n` +
    `ستصلك جميع إشعارات النظام (المبيعات، الخزينة، التحصيل، المرتجعات، التنازل، الضامنين، والشركاء) هنا فور حدوثها.\n` +
    `<i>🕒 ${escapeHtml(formatCairoDateTime())}</i>`;

  let sentCount = 0;
  let lastError = '';
  for (const chatId of targets) {
    const res = await postTelegramMessage(cleanToken, chatId, htmlText);
    if (res.ok) {
      sentCount += 1;
    } else {
      lastError = res.error || 'تعذر الإرسال';
    }
  }

  if (sentCount === 0) {
    let friendly = lastError;
    if (/Unauthorized|401|Not Found/i.test(lastError)) {
      friendly = 'رمز البوت (Bot Token) غير صحيح؛ تأكد من نسخه كاملاً من @BotFather.';
    } else if (/chat not found|bot was blocked|400/i.test(lastError)) {
      friendly = 'تعذر الوصول للمحادثة (Chat ID)؛ تأكد من إرسال رسالة /start للبوت أولاً أو إضافته للجروب.';
    } else if (/timeout|fetch failed|ENOTFOUND/i.test(lastError)) {
      friendly = 'تعذر الاتصال بخوادم تليجرام؛ تأكد من اتصال جهاز السيرفر بالإنترنت.';
    }
    return { ok: false, sentCount: 0, error: friendly };
  }

  return { ok: true, sentCount };
}
