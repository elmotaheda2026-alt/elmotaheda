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
  whatsappPhoneNumberId: '',
  whatsappAccessToken: '',
  whatsappTemplateName: 'installment_reminder',
  whatsappTemplateLanguage: 'ar',
};

let apiSettingsCache: Setting | null = null;

export function getSettings(): Setting {
  if (isApiMode()) {
    return apiSettingsCache || defaultSettings;
  }

  const settings = localStorage.getItem(DB_KEYS.SETTINGS);
  return settings ? JSON.parse(settings) : defaultSettings;
}

export async function syncSettings(): Promise<Setting> {
  if (!isApiMode()) return getSettings();
  apiSettingsCache = await api.getSettings();
  return apiSettingsCache;
}

export async function updateSettings(settings: Setting): Promise<void> {
  const normalized = { ...settings, taxRate: 0 };
  if (isApiMode()) {
    await api.updateSettings(normalized);
    apiSettingsCache = normalized;
    return;
  }

  localStorage.setItem(DB_KEYS.SETTINGS, JSON.stringify(normalized));
}