import { Setting } from '../../types';
import { DB_KEYS } from './core';

export function getSettings(): Setting {
  const settings = localStorage.getItem(DB_KEYS.SETTINGS);
  return settings
    ? JSON.parse(settings)
    : {
        companyName: 'شركة المتحدة',
        companyAddress: 'الشارع المقابل للبوابة الخلفية للمستشفى العام',
        companyPhone: '01001207474',
        companyEmail: 'info@almuttahida.com',
        taxRate: 14,
        currency: 'جنيه',
        invoicePrefix: 'INV',
        invoiceFooter: 'شكراً للتعامل معنا - شركة المتحدة',
      };
}

export function updateSettings(settings: Setting): void {
  localStorage.setItem(DB_KEYS.SETTINGS, JSON.stringify(settings));
}
