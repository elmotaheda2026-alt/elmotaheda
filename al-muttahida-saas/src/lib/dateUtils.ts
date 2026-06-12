export function formatDateDisplay(dateStr?: string | Date | null): string {
  if (!dateStr) return '-';

  const date =
    dateStr instanceof Date
      ? dateStr
      : /^\d{4}-\d{2}-\d{2}$/.test(dateStr)
        ? new Date(`${dateStr}T00:00:00`)
        : new Date(dateStr);

  if (Number.isNaN(date.getTime())) return String(dateStr);

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
