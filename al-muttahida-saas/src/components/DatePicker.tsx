import React, { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { ar } from 'date-fns/locale';
import { Calendar as CalendarIcon } from 'lucide-react';
import { DayPicker } from 'react-day-picker';
import * as Popover from '@radix-ui/react-popover';
import 'react-day-picker/dist/style.css';

interface DatePickerProps {
  value: string;
  onChange: (date: string) => void;
  placeholder?: string;
  className?: string;
}

export function DatePicker({ value, onChange, placeholder = "يوم-شهر-سنة", className }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  
  // Safely parse the value (expected format YYYY-MM-DD from state)
  const date = value ? parseISO(value) : undefined;

  const handleSelect = (selectedDate: Date | undefined) => {
    if (selectedDate) {
      // Return YYYY-MM-DD format for internal state
      const formatted = format(selectedDate, 'yyyy-MM-dd');
      onChange(formatted);
      setOpen(false);
    } else {
      onChange('');
    }
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={`flex items-center justify-between px-3 py-1.5 border rounded-lg bg-white text-right text-sm ${!value ? 'text-slate-400' : 'text-slate-900'} ${className || 'w-full border-slate-200 focus:border-indigo-500'}`}
        >
          <span className="font-medium pt-0.5">{date ? format(date, 'dd-MM-yyyy') : placeholder}</span>
          <CalendarIcon size={16} className="text-slate-400 mr-2" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="z-50 bg-white p-3 rounded-2xl shadow-xl border border-slate-100 mt-1" align="end" sideOffset={4}>
          <DayPicker
            mode="single"
            selected={date}
            onSelect={handleSelect}
            locale={ar}
            dir="rtl"
            showOutsideDays
            className="p-1 font-sans"
            modifiersClassNames={{
              selected: "bg-indigo-600 text-white rounded-lg hover:bg-indigo-700",
              today: "font-bold text-indigo-600 bg-indigo-50 rounded-lg"
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
