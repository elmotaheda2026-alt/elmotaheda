import { Customer, Sale, Setting } from '../types';
import { getCustomers, getSales, getSettings } from './storage';
import { formatWholeCurrency } from './utils';

const SENT_KEY_PREFIX = 'almuttahida_whatsapp_reminders_sent_';
const FAILED_CONTACTS_KEY = 'almuttahida_whatsapp_failed_contacts';
const DELIVERY_LOGS_KEY = 'almuttahida_whatsapp_delivery_logs';

export const DEFAULT_WHATSAPP_MESSAGE_TEMPLATE =
  'عميلنا العزيز {name}، نذكركم بموعد سداد القسط المستحق بقيمة {amount} ({dueStatus}) بتاريخ {dueDate} للعقد رقم {invoiceNumber} - {companyName}';

export type WhatsappFailureReason = 'no_whatsapp' | 'invalid_phone' | 'excluded' | 'send_error';

export interface WhatsappFailedContact {
  phone: string;
  customerId?: string;
  customerName: string;
  invoiceNumber?: string;
  reason: WhatsappFailureReason;
  errorMessage: string;
  updatedAt: string;
  excluded: boolean;
  attempts: number;
}

export interface WhatsappDeliveryLog {
  id: string;
  customerName: string;
  phone: string;
  invoiceNumber: string;
  amount: string;
  dueDate: string;
  offsetDays: number;
  status: 'sent' | 'failed';
  reason?: string;
  sentAt: string;
}

export interface WhatsappCandidatePreview {
  key: string;
  saleId: string;
  scheduleId: string;
  customerId: string;
  customerName: string;
  phone: string;
  invoiceNumber: string;
  amount: number;
  dueDate: string;
  offsetDays: number;
  dueStatusLabel: string;
  alreadySentToday: boolean;
  isExcludedOrNoWhatsapp: boolean;
  failReason?: WhatsappFailureReason;
}

export interface WhatsappQueueProgress {
  running: boolean;
  phase: 'sending' | 'waiting' | 'batch_pause' | 'done' | 'stopped';
  currentIndex: number;
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  currentCustomerName?: string;
  waitSecondsRemaining?: number;
  stopReason?: string;
}

interface ElectronWhatsappBridge {
  sendWhatsappWebMessage?: (payload: {
    phone: string;
    message: string;
  }) => Promise<{ ok: boolean; autoSent?: boolean; reason?: string; error?: string }>;
}

const getTodayIso = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const toISODateOnly = (value?: string) => {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(value.trim())) {
    const [dd, mm, yyyy] = value.trim().split('/');
    return `${yyyy}-${mm}-${dd}`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const diffDaysFromToday = (dueIso: string, todayIso: string): number | null => {
  if (!dueIso || !todayIso) return null;
  const dueMs = new Date(`${dueIso}T00:00:00Z`).getTime();
  const todayMs = new Date(`${todayIso}T00:00:00Z`).getTime();
  if (Number.isNaN(dueMs) || Number.isNaN(todayMs)) return null;
  // Negative means due in future (-2 = 2 days before due date); positive means overdue (+3 = 3 days late)
  return Math.round((todayMs - dueMs) / (24 * 60 * 60 * 1000));
};

export const normalizeEgyptPhone = (phone: string) => {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('20') && digits.length >= 11) return digits;
  if (digits.startsWith('01') && digits.length === 11) return `20${digits.slice(1)}`;
  if (digits.startsWith('1') && digits.length === 10) return `20${digits}`;
  if (digits.startsWith('0') && digits.length >= 10) return `20${digits.slice(1)}`;
  return digits.length >= 10 ? digits : '';
};

export const getDueStatusLabel = (offsetDays: number): string => {
  if (offsetDays === 0) return 'مستحق اليوم';
  if (offsetDays === -1) return 'يستحق غداً';
  if (offsetDays === -2) return 'يستحق بعد يومين';
  if (offsetDays < -2) return `يستحق بعد ${Math.abs(offsetDays)} أيام`;
  if (offsetDays === 1) return 'متأخر منذ يوم';
  if (offsetDays === 2) return 'متأخر منذ يومين';
  return `متأخر منذ ${offsetDays} أيام`;
};

export const formatReminderText = (
  settings: Setting,
  params: { name: string; amount: string; dueDate: string; invoiceNumber: string; dueStatus?: string },
) => {
  const template = settings.whatsappMessageTemplate?.trim() || DEFAULT_WHATSAPP_MESSAGE_TEMPLATE;
  return template
    .replace(/\{name\}/g, params.name)
    .replace(/\{amount\}/g, params.amount)
    .replace(/\{dueDate\}/g, params.dueDate)
    .replace(/\{dueStatus\}/g, params.dueStatus || 'مستحق اليوم')
    .replace(/\{invoiceNumber\}/g, params.invoiceNumber)
    .replace(/\{companyName\}/g, settings.companyName || 'شركة المتحدة');
};

export const applyAntiBanVariation = (text: string, settings: Setting): string => {
  if (settings.whatsappAntiBanVariation === false) return text;
  const greetings = ['تحياتنا لحضرتك —', 'السلام عليكم ورحمة الله —', 'أهلاً بحضرتك —', 'مع خالص التحية —'];
  const greeting = greetings[Math.floor(Math.random() * greetings.length)];
  const ref = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${greeting}\n${text}\n[مرجع: #${ref}]`;
};

export const isWithinSendingHours = (settings: Setting): boolean => {
  const startStr = settings.whatsappSendStartHour || '10:00';
  const endStr = settings.whatsappSendEndHour || '21:00';
  const [sh, sm] = startStr.split(':').map((x) => Number(x) || 0);
  const [eh, em] = endStr.split(':').map((x) => Number(x) || 0);
  const now = new Date();
  const currentMin = now.getHours() * 60 + now.getMinutes();
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  if (startMin <= endMin) {
    return currentMin >= startMin && currentMin <= endMin;
  }
  return currentMin >= startMin || currentMin <= endMin;
};

export const getFailedContacts = (): WhatsappFailedContact[] => {
  try {
    const raw = localStorage.getItem(FAILED_CONTACTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const saveFailedContacts = (list: WhatsappFailedContact[]) => {
  try {
    localStorage.setItem(FAILED_CONTACTS_KEY, JSON.stringify(list));
  } catch {
    // Ignore storage quota errors
  }
};

export const recordFailedContact = (entry: {
  phone: string;
  customerId?: string;
  customerName: string;
  invoiceNumber?: string;
  reason: WhatsappFailureReason;
  errorMessage: string;
  excluded?: boolean;
}) => {
  const normalized = normalizeEgyptPhone(entry.phone) || entry.phone.trim();
  if (!normalized) return;
  const current = getFailedContacts();
  const existingIdx = current.findIndex((item) => item.phone === normalized);
  const now = new Date().toISOString();

  if (existingIdx >= 0) {
    const prev = current[existingIdx];
    current[existingIdx] = {
      ...prev,
      customerId: entry.customerId || prev.customerId,
      customerName: entry.customerName || prev.customerName,
      invoiceNumber: entry.invoiceNumber || prev.invoiceNumber,
      reason: entry.reason,
      errorMessage: entry.errorMessage,
      updatedAt: now,
      excluded: entry.excluded !== undefined ? entry.excluded : entry.reason === 'no_whatsapp' || entry.reason === 'invalid_phone' || prev.excluded,
      attempts: (prev.attempts || 0) + 1,
    };
  } else {
    current.unshift({
      phone: normalized,
      customerId: entry.customerId,
      customerName: entry.customerName,
      invoiceNumber: entry.invoiceNumber,
      reason: entry.reason,
      errorMessage: entry.errorMessage,
      updatedAt: now,
      excluded: entry.excluded !== undefined ? entry.excluded : entry.reason === 'no_whatsapp' || entry.reason === 'invalid_phone' || entry.reason === 'excluded',
      attempts: 1,
    });
  }
  saveFailedContacts(current);
};

export const toggleExcludeContact = (phone: string, customerName = 'عميل', exclude?: boolean, customerId?: string) => {
  const normalized = normalizeEgyptPhone(phone) || phone.trim();
  if (!normalized) return;
  const current = getFailedContacts();
  const idx = current.findIndex((item) => item.phone === normalized);
  if (idx >= 0) {
    const nextExcluded = exclude !== undefined ? exclude : !current[idx].excluded;
    current[idx] = {
      ...current[idx],
      excluded: nextExcluded,
      reason: nextExcluded ? (current[idx].reason === 'no_whatsapp' ? 'no_whatsapp' : 'excluded') : current[idx].reason,
      updatedAt: new Date().toISOString(),
    };
    saveFailedContacts(current);
  } else {
    current.unshift({
      phone: normalized,
      customerId,
      customerName,
      reason: 'excluded',
      errorMessage: 'تم الاستبعاد يدوياً من الإرسال التلقائي',
      updatedAt: new Date().toISOString(),
      excluded: exclude !== undefined ? exclude : true,
      attempts: 0,
    });
    saveFailedContacts(current);
  }
};

export const removeFailedContact = (phone: string) => {
  const normalized = normalizeEgyptPhone(phone) || phone.trim();
  const current = getFailedContacts().filter((item) => item.phone !== normalized && item.phone !== phone);
  saveFailedContacts(current);
};

export const updateFailedContactPhone = (oldPhone: string, newPhone: string) => {
  const normalizedOld = normalizeEgyptPhone(oldPhone) || oldPhone.trim();
  const normalizedNew = normalizeEgyptPhone(newPhone) || newPhone.trim();
  const current = getFailedContacts().map((item) =>
    item.phone === normalizedOld || item.phone === oldPhone
      ? { ...item, phone: normalizedNew, excluded: false, updatedAt: new Date().toISOString() }
      : item,
  );
  saveFailedContacts(current);
};

export const getDeliveryLogs = (): WhatsappDeliveryLog[] => {
  try {
    const raw = localStorage.getItem(DELIVERY_LOGS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const appendDeliveryLog = (entry: Omit<WhatsappDeliveryLog, 'id' | 'sentAt'>) => {
  const logs = getDeliveryLogs();
  logs.unshift({
    ...entry,
    id: `wa-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    sentAt: new Date().toISOString(),
  });
  try {
    localStorage.setItem(DELIVERY_LOGS_KEY, JSON.stringify(logs.slice(0, 300)));
  } catch {
    // Ignore storage quota errors
  }
};

export const clearDeliveryLogs = () => {
  localStorage.removeItem(DELIVERY_LOGS_KEY);
};

const getSentIds = (date: string) => {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(`${SENT_KEY_PREFIX}${date}`) || '[]'));
  } catch {
    return new Set<string>();
  }
};

const saveSentIds = (date: string, sentIds: Set<string>) => {
  localStorage.setItem(`${SENT_KEY_PREFIX}${date}`, JSON.stringify(Array.from(sentIds)));
};

export const getTodaySentCount = (): number => {
  const todayIso = getTodayIso();
  return getSentIds(todayIso).size;
};

export const getMatchingReminderCandidates = (customSettings?: Setting): WhatsappCandidatePreview[] => {
  const settings = customSettings || getSettings();
  const todayIso = getTodayIso();
  const offsets =
    Array.isArray(settings.whatsappReminderOffsets) && settings.whatsappReminderOffsets.length > 0
      ? settings.whatsappReminderOffsets
      : [-2, -1, 0];
  const offsetSet = new Set(offsets.map((n) => Number(n)));

  const customers = getCustomers();
  const customersById = new Map<string, Customer>(customers.map((customer) => [customer.id, customer]));
  const sentToday = getSentIds(todayIso);
  const failedContacts = getFailedContacts();
  const failedByPhone = new Map<string, WhatsappFailedContact>(failedContacts.map((f) => [f.phone, f]));

  return getSales().flatMap((sale) => {
    if (sale.status === 'cancelled' || Number(sale.remaining || 0) <= 0) return [];

    const customer = customersById.get(sale.customerId);
    const rawPhone = customer?.phone || '';
    const normalizedPhone = normalizeEgyptPhone(rawPhone);
    const legacyInstallments = (sale as { installments?: NonNullable<typeof sale.financing>['schedules'] }).installments;
    const schedules =
      legacyInstallments && legacyInstallments.length > 0
        ? legacyInstallments
        : sale.financing?.schedules || [];

    return schedules
      .filter((schedule) => schedule.status !== 'paid')
      .map((schedule) => {
        const dueIso = toISODateOnly(schedule.dueDate);
        const offsetDays = diffDaysFromToday(dueIso, todayIso);
        const amount = Math.max(Number(schedule.amount || 0) - Number(schedule.paidAmount || 0), 0);
        return { schedule, dueIso, offsetDays, amount };
      })
      .filter(
        ({ offsetDays, amount }) =>
          offsetDays !== null && offsetSet.has(offsetDays) && amount > 0,
      )
      .map(({ schedule, dueIso, offsetDays, amount }) => {
        const key = `${sale.id}:${schedule.id}`;
        const failedRecord = normalizedPhone ? failedByPhone.get(normalizedPhone) : undefined;
        const isInvalidPhone = !normalizedPhone;
        const isExcludedOrNoWhatsapp =
          isInvalidPhone || Boolean(failedRecord?.excluded);

        return {
          key,
          saleId: sale.id,
          scheduleId: schedule.id,
          customerId: sale.customerId,
          customerName: customer?.name || sale.customerName || 'عميل',
          phone: normalizedPhone || rawPhone || '-',
          invoiceNumber: sale.invoiceNumber,
          amount,
          dueDate: dueIso,
          offsetDays: offsetDays as number,
          dueStatusLabel: getDueStatusLabel(offsetDays as number),
          alreadySentToday: sentToday.has(key),
          isExcludedOrNoWhatsapp,
          failReason: isInvalidPhone ? 'invalid_phone' : failedRecord?.reason,
        };
      });
  });
};

let browserFallbackPopup: Window | null = null;

export async function sendSingleWhatsappReminder(
  settings: Setting,
  params: {
    phone: string;
    name: string;
    amount: string;
    dueDate: string;
    invoiceNumber: string;
    dueStatus?: string;
    customerId?: string;
  },
): Promise<{ ok: boolean; reason?: WhatsappFailureReason | 'not_logged_in' | 'timeout'; error?: string }> {
  const recipient = normalizeEgyptPhone(params.phone);
  if (!recipient) {
    recordFailedContact({
      phone: params.phone || 'غير مسجل',
      customerId: params.customerId,
      customerName: params.name,
      invoiceNumber: params.invoiceNumber,
      reason: 'invalid_phone',
      errorMessage: 'رقم الهاتف غير صالح أو ناقص',
      excluded: true,
    });
    return { ok: false, reason: 'invalid_phone', error: 'رقم الهاتف غير صالح' };
  }

  if (settings.whatsappMode === 'meta_api') {
    const phoneNumberId = settings.whatsappPhoneNumberId?.trim();
    const accessToken = settings.whatsappAccessToken?.trim();
    const templateName = settings.whatsappTemplateName?.trim() || 'installment_reminder';
    const language = settings.whatsappTemplateLanguage?.trim() || 'ar';

    if (!phoneNumberId || !accessToken) {
      return { ok: false, reason: 'send_error', error: 'يرجى إدخال Phone Number ID و Access Token الخاصين بميتا' };
    }

    const response = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: recipient,
        type: 'template',
        template: {
          name: templateName,
          language: { code: language },
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: params.name },
                { type: 'text', text: params.amount },
                { type: 'text', text: params.dueDate },
                { type: 'text', text: params.invoiceNumber },
              ],
            },
          ],
        },
      }),
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => null);
      const errMsg = errBody?.error?.message || `Meta API HTTP ${response.status}`;
      const code = Number(errBody?.error?.code || 0);
      const reason: WhatsappFailureReason = code === 131026 || code === 131051 ? 'no_whatsapp' : 'send_error';
      recordFailedContact({
        phone: recipient,
        customerId: params.customerId,
        customerName: params.name,
        invoiceNumber: params.invoiceNumber,
        reason,
        errorMessage: errMsg,
        excluded: reason === 'no_whatsapp',
      });
      return { ok: false, reason, error: errMsg };
    }
    return { ok: true };
  }

  const baseText = formatReminderText(settings, params);
  const text = applyAntiBanVariation(baseText, settings);
  const electronApi = (window as unknown as { electronAPI?: ElectronWhatsappBridge }).electronAPI;
  if (electronApi?.sendWhatsappWebMessage) {
    const result = await electronApi.sendWhatsappWebMessage({ phone: recipient, message: text });
    if (!result.ok) {
      const reason: WhatsappFailureReason | 'not_logged_in' | 'timeout' =
        result.reason === 'no_whatsapp'
          ? 'no_whatsapp'
          : result.reason === 'invalid_phone'
            ? 'invalid_phone'
            : result.reason === 'not_logged_in'
              ? 'not_logged_in'
              : 'send_error';
      if (reason === 'no_whatsapp' || reason === 'invalid_phone' || reason === 'send_error') {
        recordFailedContact({
          phone: recipient,
          customerId: params.customerId,
          customerName: params.name,
          invoiceNumber: params.invoiceNumber,
          reason,
          errorMessage: result.error || 'تعذر الإرسال عبر واتساب ويب',
          excluded: settings.whatsappAutoSkipInvalid !== false && (reason === 'no_whatsapp' || reason === 'invalid_phone'),
        });
      }
      return { ok: false, reason, error: result.error };
    }
    return { ok: true };
  }

  // Browser fallback: reuse a single named popup tab so multiple tabs don't pile up
  const url = `https://web.whatsapp.com/send?phone=${recipient}&text=${encodeURIComponent(text)}`;
  browserFallbackPopup = window.open(url, 'almuttahida_wa_background_worker', 'width=960,height=700');
  return { ok: true };
}

const waitWithAbort = async (
  seconds: number,
  shouldStop?: () => boolean,
  onTick?: (remaining: number) => void,
) => {
  for (let remaining = seconds; remaining > 0; remaining -= 1) {
    if (shouldStop?.()) return false;
    onTick?.(remaining);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return !shouldStop?.();
};

export async function runWhatsappQueue(options?: {
  forceAll?: boolean;
  ignoreHours?: boolean;
  customSettings?: Setting;
  onProgress?: (state: WhatsappQueueProgress) => void;
  shouldStop?: () => boolean;
}): Promise<{ sent: number; failed: number; skipped: number; stopReason?: string }> {
  const settings = options?.customSettings || getSettings();
  const todayIso = getTodayIso();

  if (!options?.ignoreHours && !isWithinSendingHours(settings)) {
    const reason = `خارج ساعات الإرسال المسموحة (${settings.whatsappSendStartHour || '10:00'} - ${settings.whatsappSendEndHour || '21:00'}) لحماية الرقم`;
    options?.onProgress?.({
      running: false,
      phase: 'stopped',
      currentIndex: 0,
      total: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      stopReason: reason,
    });
    return { sent: 0, failed: 0, skipped: 0, stopReason: reason };
  }

  const dailyLimit = Math.max(Number(settings.whatsappDailyLimit || 80), 1);
  const sentTodaySet = getSentIds(todayIso);
  let sentTodayCount = sentTodaySet.size;

  if (sentTodayCount >= dailyLimit) {
    const reason = `تم الوصول للحد اليومي الآمن (${dailyLimit} رسالة) لحماية الرقم من الحظر`;
    options?.onProgress?.({
      running: false,
      phase: 'stopped',
      currentIndex: 0,
      total: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      stopReason: reason,
    });
    return { sent: 0, failed: 0, skipped: 0, stopReason: reason };
  }

  const allCandidates = getMatchingReminderCandidates(settings);
  const autoSkip = settings.whatsappAutoSkipInvalid !== false;

  const queue = allCandidates.filter((item) => {
    if (!options?.forceAll && item.alreadySentToday) return false;
    if (autoSkip && item.isExcludedOrNoWhatsapp) return false;
    return true;
  });

  const minDelay = Math.max(Number(settings.whatsappMinDelaySec ?? 15), 2);
  const maxDelay = Math.max(Number(settings.whatsappMaxDelaySec ?? 45), minDelay);
  const batchSize = Math.max(Number(settings.whatsappBatchSize ?? 15), 1);
  const batchPauseSec = Math.max(Number(settings.whatsappBatchPauseSec ?? 180), 10);

  let sent = 0;
  let failed = 0;
  const skipped = allCandidates.length - queue.length;

  for (let i = 0; i < queue.length; i += 1) {
    if (options?.shouldStop?.()) {
      options?.onProgress?.({
        running: false,
        phase: 'stopped',
        currentIndex: i,
        total: queue.length,
        sent,
        failed,
        skipped,
        stopReason: 'تم إيقاف الطابور يدوياً',
      });
      return { sent, failed, skipped, stopReason: 'تم إيقاف الطابور يدوياً' };
    }

    if (sentTodayCount >= dailyLimit) {
      const reason = `تم إيقاف الإرسال للوصول للحد اليومي (${dailyLimit})`;
      options?.onProgress?.({
        running: false,
        phase: 'stopped',
        currentIndex: i,
        total: queue.length,
        sent,
        failed,
        skipped,
        stopReason: reason,
      });
      return { sent, failed, skipped, stopReason: reason };
    }

    const candidate = queue[i];
    const formattedAmount = formatWholeCurrency(candidate.amount, settings.currency);

    options?.onProgress?.({
      running: true,
      phase: 'sending',
      currentIndex: i + 1,
      total: queue.length,
      sent,
      failed,
      skipped,
      currentCustomerName: candidate.customerName,
    });

    const result = await sendSingleWhatsappReminder(settings, {
      phone: candidate.phone,
      name: candidate.customerName,
      amount: formattedAmount,
      dueDate: candidate.dueDate,
      invoiceNumber: candidate.invoiceNumber,
      dueStatus: candidate.dueStatusLabel,
      customerId: candidate.customerId,
    });

    if (result.ok) {
      sent += 1;
      sentTodayCount += 1;
      sentTodaySet.add(candidate.key);
      saveSentIds(todayIso, sentTodaySet);
      appendDeliveryLog({
        customerName: candidate.customerName,
        phone: candidate.phone,
        invoiceNumber: candidate.invoiceNumber,
        amount: formattedAmount,
        dueDate: candidate.dueDate,
        offsetDays: candidate.offsetDays,
        status: 'sent',
      });
    } else {
      failed += 1;
      appendDeliveryLog({
        customerName: candidate.customerName,
        phone: candidate.phone,
        invoiceNumber: candidate.invoiceNumber,
        amount: formattedAmount,
        dueDate: candidate.dueDate,
        offsetDays: candidate.offsetDays,
        status: 'failed',
        reason: result.error || 'فشل الإرسال',
      });

      if (result.reason === 'not_logged_in') {
        options?.onProgress?.({
          running: false,
          phase: 'stopped',
          currentIndex: i + 1,
          total: queue.length,
          sent,
          failed,
          skipped,
          stopReason: result.error,
        });
        return { sent, failed, skipped, stopReason: result.error };
      }
    }

    if (i < queue.length - 1) {
      const isBatchBoundary = (i + 1) % batchSize === 0;
      const delaySec = isBatchBoundary
        ? batchPauseSec
        : Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;

      const continued = await waitWithAbort(delaySec, options?.shouldStop, (remaining) => {
        options?.onProgress?.({
          running: true,
          phase: isBatchBoundary ? 'batch_pause' : 'waiting',
          currentIndex: i + 1,
          total: queue.length,
          sent,
          failed,
          skipped,
          currentCustomerName: candidate.customerName,
          waitSecondsRemaining: remaining,
        });
      });
      if (!continued) {
        options?.onProgress?.({
          running: false,
          phase: 'stopped',
          currentIndex: i + 1,
          total: queue.length,
          sent,
          failed,
          skipped,
          stopReason: 'تم إيقاف الطابور يدوياً',
        });
        return { sent, failed, skipped, stopReason: 'تم إيقاف الطابور يدوياً' };
      }
    }
  }

  options?.onProgress?.({
    running: false,
    phase: 'done',
    currentIndex: queue.length,
    total: queue.length,
    sent,
    failed,
    skipped,
  });

  return { sent, failed, skipped };
}

export async function runDailyWhatsappReminders(forceAllToday = false) {
  const settings = getSettings();
  if (!forceAllToday && !settings.whatsappRemindersEnabled) {
    return { sent: 0, failed: 0, skipped: true };
  }
  const res = await runWhatsappQueue({
    forceAll: forceAllToday,
    ignoreHours: forceAllToday,
  });
  return { sent: res.sent, failed: res.failed, skipped: false, stopReason: res.stopReason };
}
