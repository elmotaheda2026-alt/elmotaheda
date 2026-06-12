// src/lib/dateUtils.ts

/**
 * Formats a date string (ISO or any parseable) to DD/MM/YYYY for UI display.
 * Uses Arabic locale for month names if needed, but returns numeric day/month/year.
 */
export function formatDateDisplay(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}
