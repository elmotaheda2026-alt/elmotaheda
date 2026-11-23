import React from 'react';
import { Banknote, CreditCard, Landmark, Smartphone, Zap } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getDynamicPaymentChannels, type PaymentChannelIcon, type TreasuryChannel } from '../lib/paymentChannels';

interface PaymentChannelSelectorProps {
  value: TreasuryChannel;
  onChange: (channel: TreasuryChannel) => void;
  label?: string;
  excludeChannel?: TreasuryChannel;
  compact?: boolean;
  disabled?: boolean;
}

function renderSelectorIcon(icon: PaymentChannelIcon) {
  switch (icon) {
    case 'cash':
      return <Banknote size={15} />;
    case 'bank':
      return <Landmark size={15} />;
    case 'instapay':
      return <Zap size={15} />;
    case 'card':
      return <CreditCard size={15} />;
    case 'wallet':
    default:
      return <Smartphone size={15} />;
  }
}

export function PaymentChannelSelector({
  value,
  onChange,
  label = 'طريقة الدفع / الخزنة',
  excludeChannel,
  compact = false,
  disabled = false,
}: PaymentChannelSelectorProps) {
  const { settings } = useAuth();
  const configured = getDynamicPaymentChannels(settings?.paymentChannels);
  const options = excludeChannel
    ? configured.filter((ch) => ch.id !== excludeChannel)
    : configured;

  const gridClass =
    options.length <= 1
      ? 'grid-cols-1 max-w-xs'
      : options.length === 2
        ? 'grid-cols-2'
        : options.length === 3
          ? 'grid-cols-3'
          : 'grid-cols-2 sm:grid-cols-4';

  return (
    <div>
      {label && (
        <span className={`block font-bold text-slate-700 ${compact ? 'mb-1.5 text-xs' : 'mb-2 text-sm'}`}>
          {label}
        </span>
      )}
      <div className={`grid gap-2 ${gridClass}`}>
        {options.map((ch) => {
          const isActive = value === ch.id;
          return (
            <button
              key={ch.id}
              type="button"
              disabled={disabled}
              onClick={() => onChange(ch.id)}
              className={`flex items-center justify-center gap-1.5 rounded-xl border font-bold transition-all cursor-pointer disabled:opacity-50 ${
                compact ? 'px-2.5 py-2 text-xs' : 'px-3 py-2.5 text-xs sm:text-sm'
              } ${
                isActive
                  ? ch.activeButtonClass
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <span className={isActive ? ch.iconColorClass : 'text-slate-400'}>
                {renderSelectorIcon(ch.icon)}
              </span>
              <span className="truncate">{ch.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default PaymentChannelSelector;
