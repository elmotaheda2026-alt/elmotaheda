import type { PaymentChannelConfig } from '../types';

export type TreasuryChannel = string;
export type PaymentChannelIcon = PaymentChannelConfig['icon'];
export type PaymentChannelColor = PaymentChannelConfig['color'];

export interface TreasuryChannelMeta extends PaymentChannelConfig {
  badgeClass: string;
  activeCardClass: string;
  activeButtonClass: string;
  iconBgClass: string;
  iconColorClass: string;
}

export const CHANNEL_COLOR_STYLES: Record<
  PaymentChannelColor,
  {
    label: string;
    swatchClass: string;
    badgeClass: string;
    activeCardClass: string;
    activeButtonClass: string;
    iconBgClass: string;
    iconColorClass: string;
  }
> = {
  emerald: {
    label: 'أخضر',
    swatchClass: 'bg-emerald-500',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    activeCardClass: 'border-emerald-500 ring-2 ring-emerald-200 bg-emerald-50/70',
    activeButtonClass: 'border-emerald-600 bg-emerald-50 text-emerald-800 ring-2 ring-emerald-200',
    iconBgClass: 'bg-emerald-100',
    iconColorClass: 'text-emerald-700',
  },
  rose: {
    label: 'أحمر / وردي',
    swatchClass: 'bg-rose-500',
    badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
    activeCardClass: 'border-rose-500 ring-2 ring-rose-200 bg-rose-50/70',
    activeButtonClass: 'border-rose-600 bg-rose-50 text-rose-800 ring-2 ring-rose-200',
    iconBgClass: 'bg-rose-100',
    iconColorClass: 'text-rose-700',
  },
  blue: {
    label: 'أزرق',
    swatchClass: 'bg-blue-500',
    badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
    activeCardClass: 'border-blue-500 ring-2 ring-blue-200 bg-blue-50/70',
    activeButtonClass: 'border-blue-600 bg-blue-50 text-blue-800 ring-2 ring-blue-200',
    iconBgClass: 'bg-blue-100',
    iconColorClass: 'text-blue-700',
  },
  violet: {
    label: 'بنفسجي',
    swatchClass: 'bg-violet-500',
    badgeClass: 'bg-violet-50 text-violet-700 border-violet-200',
    activeCardClass: 'border-violet-500 ring-2 ring-violet-200 bg-violet-50/70',
    activeButtonClass: 'border-violet-600 bg-violet-50 text-violet-800 ring-2 ring-violet-200',
    iconBgClass: 'bg-violet-100',
    iconColorClass: 'text-violet-700',
  },
  amber: {
    label: 'ذهبي / برتقالي',
    swatchClass: 'bg-amber-500',
    badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
    activeCardClass: 'border-amber-500 ring-2 ring-amber-200 bg-amber-50/70',
    activeButtonClass: 'border-amber-600 bg-amber-50 text-amber-900 ring-2 ring-amber-200',
    iconBgClass: 'bg-amber-100',
    iconColorClass: 'text-amber-700',
  },
  slate: {
    label: 'رمادي',
    swatchClass: 'bg-slate-600',
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-200',
    activeCardClass: 'border-slate-500 ring-2 ring-slate-200 bg-slate-100/70',
    activeButtonClass: 'border-slate-600 bg-slate-100 text-slate-900 ring-2 ring-slate-200',
    iconBgClass: 'bg-slate-200',
    iconColorClass: 'text-slate-700',
  },
};

export const DEFAULT_PAYMENT_CHANNELS: PaymentChannelConfig[] = [
  { id: 'cash', label: 'الدرج (كاش)', icon: 'cash', color: 'emerald', isDefault: true },
];

export const QUICK_ADD_CHANNEL_PRESETS: PaymentChannelConfig[] = [
  { id: 'wallet', label: 'فودافون كاش', icon: 'wallet', color: 'rose' },
  { id: 'transfer', label: 'الحساب البنكي', icon: 'bank', color: 'blue' },
  { id: 'instapay', label: 'إنستاباي', icon: 'instapay', color: 'violet' },
  { id: 'etisalat_cash', label: 'اتصالات كاش', icon: 'wallet', color: 'emerald' },
  { id: 'pos_card', label: 'ماكينة فيزا', icon: 'card', color: 'amber' },
  { id: 'orange_cash', label: 'أورانج كاش', icon: 'wallet', color: 'amber' },
];

const LEGACY_CHANNEL_FALLBACKS: Record<string, PaymentChannelConfig> = {
  cash: DEFAULT_PAYMENT_CHANNELS[0],
  wallet: { id: 'wallet', label: 'فودافون كاش', icon: 'wallet', color: 'rose' },
  transfer: { id: 'transfer', label: 'الحساب البنكي', icon: 'bank', color: 'blue' },
  card: { id: 'card', label: 'بطاقة / فيزا', icon: 'card', color: 'amber' },
  instapay: { id: 'instapay', label: 'إنستاباي', icon: 'instapay', color: 'violet' },
};

function enrichChannelMeta(item: PaymentChannelConfig): TreasuryChannelMeta {
  const styles = CHANNEL_COLOR_STYLES[item.color] || CHANNEL_COLOR_STYLES.slate;
  return {
    ...item,
    badgeClass: styles.badgeClass,
    activeCardClass: styles.activeCardClass,
    activeButtonClass: styles.activeButtonClass,
    iconBgClass: styles.iconBgClass,
    iconColorClass: styles.iconColorClass,
  };
}

function sanitizeChannelConfigs(channels?: PaymentChannelConfig[] | null): PaymentChannelConfig[] {
  const list: PaymentChannelConfig[] = [];
  const seen = new Set<string>();
  if (Array.isArray(channels)) {
    for (const item of channels) {
      if (!item || typeof item !== 'object') continue;
      const id = String(item.id || '').trim();
      const label = String(item.label || '').trim();
      if (!id || !label || seen.has(id)) continue;
      seen.add(id);
      list.push({
        id,
        label,
        icon: item.icon || 'wallet',
        color: item.color || 'blue',
        isDefault: id === 'cash' ? true : undefined,
      });
    }
  }

  const cashIdx = list.findIndex((c) => c.id === 'cash');
  if (cashIdx === -1) {
    return [{ ...DEFAULT_PAYMENT_CHANNELS[0] }, ...list];
  }
  const cashItem: PaymentChannelConfig = { ...list[cashIdx], isDefault: true };
  return [cashItem, ...list.filter((_, idx) => idx !== cashIdx)];
}

let dynamicChannels: TreasuryChannelMeta[] = DEFAULT_PAYMENT_CHANNELS.map(enrichChannelMeta);

export function setDynamicPaymentChannels(channels?: PaymentChannelConfig[] | null): TreasuryChannelMeta[] {
  const sanitized = sanitizeChannelConfigs(channels);
  dynamicChannels = sanitized.map(enrichChannelMeta);
  return dynamicChannels;
}

export function getDynamicPaymentChannels(overrideList?: PaymentChannelConfig[] | null): TreasuryChannelMeta[] {
  if (Array.isArray(overrideList) && overrideList.length > 0) {
    return sanitizeChannelConfigs(overrideList).map(enrichChannelMeta);
  }
  return dynamicChannels;
}

export function normalizePaymentChannel(channel?: string | null): TreasuryChannel {
  const clean = String(channel || '').trim();
  if (!clean || clean === 'other') return 'cash';
  return clean;
}

export function getPaymentChannelMeta(
  channel?: string | null,
  overrideList?: PaymentChannelConfig[] | null,
): TreasuryChannelMeta {
  const key = normalizePaymentChannel(channel);
  const activeList = getDynamicPaymentChannels(overrideList);
  const found = activeList.find((c) => c.id === key);
  if (found) return found;

  if (LEGACY_CHANNEL_FALLBACKS[key]) {
    return enrichChannelMeta(LEGACY_CHANNEL_FALLBACKS[key]);
  }

  return enrichChannelMeta({
    id: key,
    label: key,
    icon: 'wallet',
    color: 'slate',
  });
}
