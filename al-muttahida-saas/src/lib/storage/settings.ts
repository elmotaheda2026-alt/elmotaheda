import { Setting } from '../../types';
import { api, isApiMode } from '../apiClient';
import { DB_KEYS } from './core';

const defaultSettings: Setting = {
  companyName: 'شركة المتحدة',
  companyAddress: 'الشارع المقابل للبوابة الخلفية للمستشفى العام',
  companyPhone: '01001207474',
  companyEmail: 'info@almuttahida.com',
  taxRate: 0,
  currency: 'جنيه',
  invoicePrefix: 'INV',
  invoiceFooter: 'شكرا للتعامل معنا - شركة المتحدة',
  whatsappRemindersEnabled: false,
  whatsappMode: 'web_session',
  whatsappPhoneNumberId: '',
  whatsappAccessToken: '',
  whatsappTemplateName: 'installment_reminder',
  whatsappTemplateLanguage: 'ar',
  whatsappMessageTemplate: 'عميلنا العزيز {name}، نذكركم بموعد سداد القسط المستحق بقيمة {amount} بتاريخ {dueDate} للعقد رقم {invoiceNumber} - {companyName}',
  whatsappReminderOffsets: [-2, -1, 0],
  whatsappMinDelaySec: 15,
  whatsappMaxDelaySec: 45,
  whatsappDailyLimit: 80,
  whatsappBatchSize: 15,
  whatsappBatchPauseSec: 180,
  whatsappSendStartHour: '10:00',
  whatsappSendEndHour: '21:00',
  whatsappAntiBanVariation: true,
  whatsappAutoSkipInvalid: true,
};

let apiSettingsCache: Setting | null = null;

function mergeSettings(raw?: Partial<Setting> | null): Setting {
  const offsets = Array.isArray(raw?.whatsappReminderOffsets) && raw.whatsappReminderOffsets.length > 0
    ? raw.whatsappReminderOffsets.map((n) => Number(n)).filter((n) => Number.isFinite(n))
    : defaultSettings.whatsappReminderOffsets;
  return {
    ...defaultSettings,
    ...(raw || {}),
    whatsappMode: raw?.whatsappMode === 'meta_api' ? 'meta_api' : 'web_session',
    whatsappTemplateName: raw?.whatsappTemplateName?.trim() || defaultSettings.whatsappTemplateName,
    whatsappTemplateLanguage: raw?.whatsappTemplateLanguage?.trim() || defaultSettings.whatsappTemplateLanguage,
    whatsappMessageTemplate: raw?.whatsappMessageTemplate?.trim() || defaultSettings.whatsappMessageTemplate,
    whatsappReminderOffsets: offsets && offsets.length > 0 ? offsets : defaultSettings.whatsappReminderOffsets,
  };
}

export function getSettings(): Setting {
  if (isApiMode()) {
    if (apiSettingsCache) return mergeSettings(apiSettingsCache);
    const local = localStorage.getItem(DB_KEYS.SETTINGS);
    return local ? mergeSettings(JSON.parse(local)) : defaultSettings;
  }

  const settings = localStorage.getItem(DB_KEYS.SETTINGS);
  return settings ? mergeSettings(JSON.parse(settings)) : defaultSettings;
}

export async function syncSettings(): Promise<Setting> {
  if (!isApiMode()) return getSettings();
  const remote = await api.getSettings();
  apiSettingsCache = mergeSettings(remote);
  try {
    const { whatsappAccessToken: _stripToken, ...safeCache } = apiSettingsCache;
    localStorage.setItem(DB_KEYS.SETTINGS, JSON.stringify(safeCache));
  } catch {
    // Ignore storage quota errors
  }
  return apiSettingsCache;
}

export async function updateSettings(settings: Setting): Promise<void> {
  const normalized = mergeSettings({ ...settings, taxRate: 0 });
  if (isApiMode()) {
    await api.updateSettings(normalized);
    apiSettingsCache = normalized;
    try {
      const { whatsappAccessToken: _stripToken, ...safeCache } = normalized;
      localStorage.setItem(DB_KEYS.SETTINGS, JSON.stringify(safeCache));
    } catch {
      // Ignore storage quota errors
    }
    return;
  }

  const { whatsappAccessToken: _stripToken, ...safeLocal } = normalized;
  localStorage.setItem(DB_KEYS.SETTINGS, JSON.stringify(safeLocal));
}