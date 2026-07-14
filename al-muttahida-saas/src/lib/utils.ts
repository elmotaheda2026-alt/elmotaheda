import { clsx, ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatWholeCurrency(amount: number, currency: string): string {
  // Ensure -0 is displayed as 0 for a cleaner UI
  const rounded = Math.round(Number(amount || 0));
  const normalized = Object.is(rounded, -0) ? 0 : rounded;
  return `${new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(normalized)} ${currency}`;
}
