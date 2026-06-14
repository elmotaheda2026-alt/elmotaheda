import { clsx, ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatWholeCurrency(amount: number, currency: string): string {
  return `${new Intl.NumberFormat('ar-EG', {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(Math.round(Number(amount || 0)))} ${currency}`;
}
