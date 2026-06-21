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
  const clean = input.replace(/[^0-9/]/g, '');
  const rawSegments = clean.split('/');
  
  const segments: string[] = [];
  let overflow = '';
  
  for (let i = 0; i < 3; i++) {
    let current = (rawSegments[i] || '') + overflow;
    overflow = '';
    
    const maxLength = i === 2 ? 4 : 2;
    if (current.length > maxLength) {
      overflow = current.slice(maxLength);
      current = current.slice(0, maxLength);
    }
    
    if (current.length > 0 || (i < rawSegments.length - 1)) {
      segments.push(current);
    } else {
      break;
    }
  }
  
  return segments.join('/');
}

function parseDisplayDate(input: string): string {
  const match = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
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
    const currentParsed = parseDisplayDate(typedValue);
    const normalizedValue = value || '';
    if (currentParsed !== normalizedValue) {
      setTypedValue(value ? formatDateDisplay(value) : '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Strip padding classes from wrapper class name so they don't compound padding and shrink content width
  const cleanClassName = className
    ? className.replace(/\b(p[xytrbl]?-[0-9.]+)\b/g, '').trim()
    : '';

  // Extract vertical padding passed (like py-2) to apply to the input, default to py-1.5
  const pyClass = className?.match(/\b(py-[0-9.]+)\b/)?.[1] || 'py-1.5';

  return (
    <div
      className={`relative flex items-center rounded-lg border bg-white text-right text-sm transition ${cleanClassName || 'w-full border-slate-200 focus-within:border-indigo-500'}`}
    >
      <input
        type="text"
        inputMode="numeric"
        value={typedValue}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder={placeholder}
        className={`h-full w-full rounded-[inherit] border-0 bg-transparent pl-9 pr-3 ${pyClass} text-right text-sm font-medium text-slate-900 outline-none placeholder:text-slate-400`}
      />
      <CalendarIcon size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
    </div>
  );
}
