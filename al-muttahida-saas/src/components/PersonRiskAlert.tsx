import React, { useEffect, useState } from 'react';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import { api, isApiMode } from '../lib/apiClient';
import { formatWholeCurrency } from '../lib/utils';

interface PersonRiskAlertProps {
  nationalId?: string;
  phone?: string;
  excludeCustomerId?: string;
  excludeSaleId?: string;
  context: 'guarantor' | 'customer';
}

type RiskResult = Awaited<ReturnType<typeof api.checkPersonRisk>>;

export default function PersonRiskAlert({
  nationalId = '',
  phone = '',
  excludeCustomerId,
  excludeSaleId,
  context,
}: PersonRiskAlertProps) {
  const [risk, setRisk] = useState<RiskResult | null>(null);

  const cleanNat = nationalId.replace(/\D/g, '').trim();
  const cleanPhone = phone.replace(/\D/g, '').trim();
  const shouldCheck = isApiMode() && (cleanNat.length >= 6 || cleanPhone.length >= 8);

  useEffect(() => {
    if (!shouldCheck) {
      setRisk(null);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      api
        .checkPersonRisk({
          nationalId: cleanNat.length >= 6 ? cleanNat : undefined,
          phone: cleanPhone.length >= 8 ? cleanPhone : undefined,
          excludeCustomerId,
          excludeSaleId,
        })
        .then((res) => {
          if (!cancelled) setRisk(res);
        })
        .catch(() => {
          if (!cancelled) setRisk(null);
        });
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [shouldCheck, cleanNat, cleanPhone, excludeCustomerId, excludeSaleId]);

  if (!risk) return null;
  const hasCustomers = risk.existingCustomers.length > 0;
  const hasGuarantees = risk.activeGuarantees.length > 0;
  if (!hasCustomers && !hasGuarantees) return null;

  const isHighRisk = risk.hasSuedOrOverdue || (context === 'customer' && hasCustomers);
  const boxClass = isHighRisk
    ? 'bg-rose-50 border-rose-200 text-rose-900'
    : 'bg-amber-50 border-amber-200 text-amber-900';

  return (
    <div className={`rounded-xl border px-3 py-2 text-[11px] space-y-1 ${boxClass}`}>
      <div className="flex items-center gap-1.5 font-black">
        {isHighRisk ? (
          <ShieldAlert size={14} className="text-rose-600 shrink-0" />
        ) : (
          <AlertTriangle size={14} className="text-amber-600 shrink-0" />
        )}
        <span>
          {context === 'customer' && hasCustomers
            ? 'تنبيه: هذا الشخص مسجل كعميل بالفعل في النظام!'
            : hasGuarantees && risk.hasSuedOrOverdue
              ? 'تحذير: هذا الشخص مرتبط بعقود متأخرة أو قضائية!'
              : 'تنبيه مخاطر: بيانات مطابقة لسجلات قائمة بالنظام'}
        </span>
      </div>

      {hasCustomers && (
        <div className="space-y-0.5 pr-5">
          {risk.existingCustomers.map((c) => (
            <div key={c.id} className="font-semibold leading-snug">
              • عميل مسجل: <strong className="font-black">{c.name}</strong>
              {c.customerNumber ? ` (#${c.customerNumber})` : ''} — الرصيد المتبقي:{' '}
              <strong className="font-mono">{formatWholeCurrency(c.balance)}</strong>
              {c.isSued && (
                <span className="mr-1.5 inline-block rounded bg-rose-600 text-white px-1.5 py-0.2 text-[10px] font-black">
                  محال للقانونية
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {hasGuarantees && (
        <div className="space-y-0.5 pr-5">
          <div className="font-bold">
            • ضامن حالياً على ({risk.activeGuarantees.length}) عقود نشطة بإجمالي متبقي:{' '}
            <strong className="font-mono">{formatWholeCurrency(risk.totalGuaranteedRemaining)}</strong>
          </div>
          {risk.activeGuarantees.slice(0, 3).map((g) => (
            <div key={`${g.saleId}-${g.slot}`} className="text-[10.5px] opacity-90">
              — العقد <span className="font-mono font-bold">{g.invoiceNumber}</span> (العميل: {g.customerName} · متبقي:{' '}
              {formatWholeCurrency(g.remaining)})
              {g.isSued && <span className="mr-1 font-black text-rose-700">[قضائي]</span>}
              {!g.isSued && g.overdueCount > 0 && (
                <span className="mr-1 font-black text-amber-800">[متأخر {g.overdueCount} قسط]</span>
              )}
            </div>
          ))}
          {risk.activeGuarantees.length > 3 && (
            <div className="text-[10px] opacity-75">وعدد {risk.activeGuarantees.length - 3} عقود أخرى...</div>
          )}
        </div>
      )}
    </div>
  );
}
