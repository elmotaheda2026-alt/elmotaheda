import { clsx, ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatWholeCurrency(amount: number, currency: string): string {
  const num = Number(amount || 0);
  if (Math.abs(num) < 0.0001 || Object.is(num, -0)) {
    return `0 ${currency}`;
  }
  const rounded = Math.round(num);
  const normalized = Object.is(rounded, -0) || rounded === 0 ? 0 : rounded;
  return `${new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(normalized)} ${currency}`;
}
