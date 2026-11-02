export function formatDateDisplay(dateStr?: string | Date | null): string {
  if (!dateStr || dateStr === 'null' || dateStr === 'undefined' || dateStr === '0') return '-';

  if (typeof dateStr === 'string') {
    const trimmed = dateStr.trim();
    if (trimmed.includes('1970') || trimmed.startsWith('0001')) return '-';
    // Already in DD/MM/YYYY format
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) return trimmed;
  }

  const date =
    dateStr instanceof Date
      ? dateStr
      : typeof dateStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim())
        ? new Date(`${dateStr.trim()}T00:00:00`)
        : new Date(dateStr);

  if (Number.isNaN(date.getTime()) || date.getFullYear() <= 1970) return '-';

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

export function formatDateTimeDisplay(dateStr?: string | Date | null): string {
  if (!dateStr) return '-';

  const date = dateStr instanceof Date ? dateStr : new Date(dateStr);
  if (Number.isNaN(date.getTime())) return String(dateStr);

  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${formatDateDisplay(date)} ${hours}:${minutes}`;
}
