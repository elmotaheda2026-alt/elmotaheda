import React, { useEffect, useState } from 'react';
import { Calendar as CalendarIcon } from 'lucide-react';
import { formatDateDisplay } from '../lib/dateUtils';

interface DatePickerProps {
  value: string;
  onChange: (date: string) => void;
  placeholder?: string;
  className?: string;
}

const pad = (value: number) => String(value).padStart(2, '0');

function normalizeTypedDate(input: string): string {
  const digits = input.replace(/\D/g, '').slice(0, 8);
  const day = digits.slice(0, 2);
  const month = digits.slice(2, 4);
  const year = digits.slice(4, 8);

  return [day, month, year].filter(Boolean).join('/');
}

function parseDisplayDate(input: string): string {
  const match = input.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return '';

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return '';
  }

  return `${year}-${pad(month)}-${pad(day)}`;
}

export function DatePicker({ value, onChange, placeholder = 'يوم/شهر/سنة', className }: DatePickerProps) {
  const [typedValue, setTypedValue] = useState(value ? formatDateDisplay(value) : '');

  useEffect(() => {
    setTypedValue(value ? formatDateDisplay(value) : '');
  }, [value]);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextValue = normalizeTypedDate(event.target.value);
    setTypedValue(nextValue);

    const parsedDate = parseDisplayDate(nextValue);
    if (parsedDate || !nextValue) {
      onChange(parsedDate);
    }
  };

  const handleBlur = () => {
    const parsedDate = parseDisplayDate(typedValue);
    setTypedValue(parsedDate ? formatDateDisplay(parsedDate) : value ? formatDateDisplay(value) : '');
  };

  return (
    <div
      className={`relative flex items-center rounded-lg border bg-white text-right text-sm transition ${className || 'w-full border-slate-200 focus-within:border-indigo-500'}`}
    >
      <input
        type="text"
        inputMode="numeric"
        value={typedValue}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder={placeholder}
        className="h-full w-full rounded-[inherit] border-0 bg-transparent pl-9 pr-3 py-1.5 text-right text-sm font-medium text-slate-900 outline-none placeholder:text-slate-400"
      />
      <CalendarIcon size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
    </div>
  );
}
