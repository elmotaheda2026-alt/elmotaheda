import { Customer, Sale, Setting } from '../types';
import { getCustomers, getSales, getSettings } from './storage';
import { formatWholeCurrency } from './utils';

const SENT_KEY_PREFIX = 'almuttahida_whatsapp_reminders_sent_';

interface ReminderCandidate {
  sale: Sale;
  customer: Customer;
  scheduleId: string;
  amount: number;
  dueDate: string;
}

const today = () => new Date().toISOString().split('T')[0];

const toISODateOnly = (value?: string) => {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const normalizeEgyptPhone = (phone: string) => {
  const digits = phone.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('20')) return digits;
  if (digits.startsWith('0')) return `20${digits.slice(1)}`;
  return digits;
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

const buildCandidates = (date: string): ReminderCandidate[] => {
  const customers = getCustomers();
  const customersById = new Map(customers.map((customer) => [customer.id, customer]));

  return getSales().flatMap((sale) => {
    if (sale.status === 'cancelled' || Number(sale.remaining || 0) <= 0) return [];

    const customer = customersById.get(sale.customerId);
    if (!customer?.phone) return [];

    const schedules = sale.financing?.schedules || [];
    return schedules
      .filter((schedule) => schedule.status !== 'paid' && toISODateOnly(schedule.dueDate) === date)
      .map((schedule) => ({
        sale,
        customer,
        scheduleId: schedule.id,
        amount: Math.max(Number(schedule.amount || 0) - Number(schedule.paidAmount || 0), 0),
        dueDate: toISODateOnly(schedule.dueDate),
      }))
      .filter((candidate) => candidate.amount > 0);
  });
};

const sendTemplateMessage = async (settings: Setting, candidate: ReminderCandidate) => {
  const phoneNumberId = settings.whatsappPhoneNumberId?.trim();
  const accessToken = settings.whatsappAccessToken?.trim();
  const templateName = settings.whatsappTemplateName?.trim() || 'installment_reminder';
  const language = settings.whatsappTemplateLanguage?.trim() || 'ar';
  const recipient = normalizeEgyptPhone(candidate.customer.phone);

  if (!phoneNumberId || !accessToken || !recipient) return false;

  const amount = formatWholeCurrency(candidate.amount, settings.currency);
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
              { type: 'text', text: candidate.customer.name },
              { type: 'text', text: amount },
              { type: 'text', text: candidate.dueDate },
              { type: 'text', text: candidate.sale.invoiceNumber },
            ],
          },
        ],
      },
    }),
  });

  return response.ok;
};

export async function runDailyWhatsappReminders() {
  const settings = getSettings();
  if (!settings.whatsappRemindersEnabled) return { sent: 0, failed: 0, skipped: true };

  const date = today();
  const sentIds = getSentIds(date);
  const candidates = buildCandidates(date).filter((candidate) => !sentIds.has(`${candidate.sale.id}:${candidate.scheduleId}`));

  let sent = 0;
  let failed = 0;

  for (const candidate of candidates) {
    const key = `${candidate.sale.id}:${candidate.scheduleId}`;
    try {
      const ok = await sendTemplateMessage(settings, candidate);
      if (ok) {
        sentIds.add(key);
        saveSentIds(date, sentIds);
        sent += 1;
      } else {
        failed += 1;
      }
    } catch (error) {
      console.warn('WhatsApp reminder failed', error);
      failed += 1;
    }
  }

  return { sent, failed, skipped: false };
}