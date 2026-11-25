import React, { useEffect, useState } from 'react';
import { Phone, Shield, X } from 'lucide-react';
import { Customer, Guarantor, Sale } from '../types';
import { api, isApiMode } from '../lib/apiClient';
import { formatDateDisplay } from '../lib/dateUtils';
import { DatePicker } from './DatePicker';
import PersonRiskAlert from './PersonRiskAlert';

interface ContractManagementSectionProps {
  sale: Sale;
  customers: Customer[];
  formatCurrency: (amount: number) => string;
  showTransferForm: boolean;
  onToggleTransferForm: (open: boolean) => void;
  canManageGuarantors?: boolean;
  canTransferContract?: boolean;
  onSaleUpdated: (updatedSale: Sale) => void;
  onContractTransferred?: (oldSale: Sale, newSale: Sale) => void;
}

export default function ContractManagementSection({
  sale,
  customers,
  formatCurrency,
  showTransferForm,
  onToggleTransferForm,
  canManageGuarantors = true,
  canTransferContract = true,
  onSaleUpdated,
  onContractTransferred,
}: ContractManagementSectionProps) {
  const [replacingSlot, setReplacingSlot] = useState<1 | 2 | 3 | null>(null);
  const [replaceForm, setReplaceForm] = useState({
    name: '',
    phone: '',
    nationalId: '',
    address: '',
    relationship: '',
    reason: '',
  });
  const [isReplacing, setIsReplacing] = useState(false);
  const [replaceFeedback, setReplaceFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const [transferNewCustomerId, setTransferNewCustomerId] = useState('');
  const [transferCustomerSearch, setTransferCustomerSearch] = useState('');
  const [transferMonths, setTransferMonths] = useState(1);
  const [transferStartDate, setTransferStartDate] = useState('');
  const [transferReason, setTransferReason] = useState('');
  const [transferGuarantor, setTransferGuarantor] = useState({
    name: '',
    phone: '',
    nationalId: '',
    address: '',
    relationship: '',
  });
  const [isTransferring, setIsTransferring] = useState(false);
  const [transferFeedback, setTransferFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    setReplacingSlot(null);
    setReplaceFeedback(null);
    setShowHistory(false);
    setTransferFeedback(null);
    setTransferNewCustomerId('');
    setTransferCustomerSearch('');
    setTransferReason('');
    setTransferGuarantor({ name: '', phone: '', nationalId: '', address: '', relationship: '' });

    const unpaid = (sale.financing?.schedules || []).filter(
      (s) => s.status !== 'paid' && s.status !== 'settled_early',
    );
    setTransferMonths(Math.max(1, unpaid.length || 1));
    const nowLocal = new Date();
    const localToday = `${nowLocal.getFullYear()}-${String(nowLocal.getMonth() + 1).padStart(2, '0')}-${String(nowLocal.getDate()).padStart(2, '0')}`;
    setTransferStartDate(unpaid[0]?.dueDate || localToday);
  }, [sale.id]);

  const matchedCustomer = customers.find((c) => c.id === sale.customerId);
  const rawSlots: [Guarantor | null, Guarantor | null, Guarantor | null] =
    sale.guarantors && sale.guarantors.some(Boolean)
      ? [sale.guarantors[0] || null, sale.guarantors[1] || null, sale.guarantors[2] || null]
      : [
          matchedCustomer?.guarantors?.[0] || null,
          matchedCustomer?.guarantors?.[1] || null,
          matchedCustomer?.guarantors?.[2] || null,
        ];

  const activeSlots = ([1, 2, 3] as const)
    .map((slot) => ({ slot, data: rawSlots[slot - 1] }))
    .filter((entry) => Boolean(entry.data && (entry.data.name || entry.data.phone || entry.data.nationalId)));
  const firstEmptySlot = ([1, 2, 3] as const).find((slot) => !rawSlots[slot - 1]);
  const replacedRecords = (sale.guarantorRecords || []).filter((r) => r.status === 'replaced');

  const handleSaveReplace = async () => {
    if (!replacingSlot) return;
    if (!replaceForm.name.trim()) {
      setReplaceFeedback({ type: 'error', text: 'يرجى إدخال اسم الضامن الجديد.' });
      return;
    }
    setIsReplacing(true);
    setReplaceFeedback(null);
    try {
      const updated = await api.replaceSaleGuarantor(sale.id, {
        slot: replacingSlot,
        guarantor: {
          name: replaceForm.name.trim(),
          phone: replaceForm.phone.replace(/\D/g, ''),
          nationalId: replaceForm.nationalId.replace(/\D/g, ''),
          address: replaceForm.address.trim(),
          relationship: replaceForm.relationship.trim(),
        },
        reason: replaceForm.reason.trim(),
      });
      if (updated) onSaleUpdated(updated);
      setReplacingSlot(null);
      setReplaceForm({ name: '', phone: '', nationalId: '', address: '', relationship: '', reason: '' });
      setReplaceFeedback({ type: 'success', text: 'تم حفظ الضامن الجديد وأرشفة بيانات الضامن السابق بنجاح.' });
    } catch (err: any) {
      setReplaceFeedback({ type: 'error', text: err?.message || 'تعذر استبدال الضامن.' });
    } finally {
      setIsReplacing(false);
    }
  };

  const handleConfirmTransfer = async () => {
    if (!transferNewCustomerId) {
      setTransferFeedback({ type: 'error', text: 'يرجى اختيار العميل الجديد أولاً.' });
      return;
    }
    setIsTransferring(true);
    setTransferFeedback(null);
    try {
      const hasGuar = Boolean(
        transferGuarantor.name.trim() || transferGuarantor.phone.trim() || transferGuarantor.nationalId.trim(),
      );
      const res = await api.transferSaleContract(sale.id, {
        newCustomerId: transferNewCustomerId,
        installmentMonths: Math.max(1, Number(transferMonths) || 1),
        installmentStartDate: transferStartDate || undefined,
        reason: transferReason.trim(),
        guarantors: hasGuar ? [transferGuarantor, null, null] : undefined,
      });
      if (res?.oldSale) onSaleUpdated(res.oldSale);
      if (res?.oldSale && res?.newSale) onContractTransferred?.(res.oldSale, res.newSale);
      onToggleTransferForm(false);
      setTransferFeedback({
        type: 'success',
        text: `تم التنازل بنجاح وإنشاء العقد الجديد رقم ${res?.newSale?.invoiceNumber || ''} للعميل الجديد، وإغلاق المتبقي على هذا العقد بدون أي تكرار محاسبي.`,
      });
    } catch (err: any) {
      setTransferFeedback({ type: 'error', text: err?.message || 'تعذر تنفيذ التنازل عن العقد.' });
    } finally {
      setIsTransferring(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Guarantors Card */}
      <div className="bg-amber-50/60 border border-amber-200/80 rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-black text-amber-900">
            <Shield size={16} className="text-amber-600" />
            <span>بيانات الضامنين النشطين ({activeSlots.length})</span>
          </div>
          <div className="flex items-center gap-1.5">
            {replacedRecords.length > 0 && (
              <button
                type="button"
                onClick={() => setShowHistory((v) => !v)}
                className="px-2.5 py-1 rounded-lg bg-white border border-amber-200 text-[11px] font-bold text-amber-800 hover:bg-amber-100/60 transition-colors cursor-pointer"
              >
                {showHistory ? 'إخفاء الأرشيف' : `ضامنون سابقون (${replacedRecords.length})`}
              </button>
            )}
            {canManageGuarantors && isApiMode() && firstEmptySlot && sale.status !== 'cancelled' && (
              <button
                type="button"
                onClick={() => {
                  setReplacingSlot(firstEmptySlot);
                  setReplaceForm({ name: '', phone: '', nationalId: '', address: '', relationship: '', reason: 'إضافة ضامن جديد للعقد' });
                  setReplaceFeedback(null);
                }}
                className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold transition-colors cursor-pointer"
              >
                + إضافة ضامن
              </button>
            )}
          </div>
        </div>

        {replaceFeedback && (
          <div className={`rounded-xl px-3 py-2 text-xs font-bold border ${replaceFeedback.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
            {replaceFeedback.text}
          </div>
        )}

        {activeSlots.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {activeSlots.map(({ slot, data: g }) => (
              <div key={slot} className="bg-white border border-amber-200/60 rounded-xl p-3 flex flex-col gap-1.5 shadow-2xs">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[10px] font-black bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded shrink-0">
                      #{slot}
                    </span>
                    <span className="font-bold text-slate-800 text-xs truncate">{g?.name || 'ضامن'}</span>
                    {g?.relationship && (
                      <span className="text-[10px] bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-bold shrink-0">
                        {g.relationship}
                      </span>
                    )}
                  </div>
                  {canManageGuarantors && isApiMode() && sale.status !== 'cancelled' && (
                    <button
                      type="button"
                      onClick={() => {
                        setReplacingSlot(slot);
                        setReplaceForm({ name: '', phone: '', nationalId: '', address: '', relationship: '', reason: '' });
                        setReplaceFeedback(null);
                      }}
                      className="px-2 py-0.5 rounded-md bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-[10px] font-bold shrink-0 cursor-pointer"
                    >
                      استبدال
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-3 text-[11px] text-slate-600 flex-wrap">
                  {g?.phone && (
                    <span className="flex items-center gap-1 font-mono text-slate-700 font-semibold" dir="ltr">
                      <Phone size={11} className="text-slate-400" />
                      {g.phone}
                    </span>
                  )}
                  {g?.nationalId && (
                    <span className="text-slate-500">
                      الرقم القومي: <span className="font-mono">{g.nationalId}</span>
                    </span>
                  )}
                  {g?.address && <span className="text-slate-500 w-full truncate">{g.address}</span>}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-amber-800/80 font-medium">لا يوجد ضامنون مسجلون لهذا العقد.</p>
        )}

        {replacingSlot && (
          <div className="bg-white border border-blue-200 rounded-xl p-3.5 space-y-2.5 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-blue-900">
                {rawSlots[replacingSlot - 1]
                  ? `استبدال الضامن #${replacingSlot} (سيتم حفظ الضامن القديم في الأرشيف تلقائياً)`
                  : `إضافة الضامن #${replacingSlot} للعقد`}
              </span>
              <button type="button" onClick={() => setReplacingSlot(null)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X size={14} />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              <input
                type="text"
                placeholder="اسم الضامن الجديد *"
                value={replaceForm.name}
                onChange={(e) => setReplaceForm((p) => ({ ...p, name: e.target.value }))}
                className="h-8 px-2.5 rounded-lg border border-slate-200 text-xs font-medium outline-none focus:border-blue-500"
              />
              <input
                type="tel"
                placeholder="رقم الهاتف"
                value={replaceForm.phone}
                onChange={(e) => setReplaceForm((p) => ({ ...p, phone: e.target.value.replace(/\D/g, '') }))}
                className="h-8 px-2.5 rounded-lg border border-slate-200 text-xs font-medium outline-none focus:border-blue-500"
              />
              <input
                type="text"
                placeholder="الرقم القومي"
                value={replaceForm.nationalId}
                onChange={(e) => setReplaceForm((p) => ({ ...p, nationalId: e.target.value.replace(/\D/g, '') }))}
                className="h-8 px-2.5 rounded-lg border border-slate-200 text-xs font-medium outline-none focus:border-blue-500"
              />
              <input
                type="text"
                placeholder="صلة القرابة"
                value={replaceForm.relationship}
                onChange={(e) => setReplaceForm((p) => ({ ...p, relationship: e.target.value }))}
                className="h-8 px-2.5 rounded-lg border border-slate-200 text-xs font-medium outline-none focus:border-blue-500"
              />
              <input
                type="text"
                placeholder="العنوان"
                value={replaceForm.address}
                onChange={(e) => setReplaceForm((p) => ({ ...p, address: e.target.value }))}
                className="h-8 px-2.5 rounded-lg border border-slate-200 text-xs font-medium outline-none focus:border-blue-500"
              />
              <input
                type="text"
                placeholder="سبب الاستبدال / ملاحظة (اختياري)"
                value={replaceForm.reason}
                onChange={(e) => setReplaceForm((p) => ({ ...p, reason: e.target.value }))}
                className="h-8 px-2.5 rounded-lg border border-slate-200 text-xs font-medium outline-none focus:border-blue-500"
              />
            </div>
            <PersonRiskAlert
              nationalId={replaceForm.nationalId}
              phone={replaceForm.phone}
              excludeSaleId={sale.id}
              context="guarantor"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setReplacingSlot(null)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={isReplacing}
                onClick={() => void handleSaveReplace()}
                className="px-3.5 py-1.5 rounded-lg bg-[#1e40af] hover:bg-[#1d4ed8] text-white text-xs font-bold cursor-pointer disabled:opacity-60"
              >
                {isReplacing ? 'جاري الحفظ...' : 'تأكيد وحفظ'}
              </button>
            </div>
          </div>
        )}

        {showHistory && replacedRecords.length > 0 && (
          <div className="border-t border-amber-200/80 pt-2.5 space-y-1.5">
            <span className="text-[11px] font-black text-slate-600 block">
              سجل الضامنين السابقين (أرشيف للقراءة فقط)
            </span>
            {replacedRecords.map((rec) => (
              <div key={rec.id} className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-[11px] text-slate-600 space-y-0.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-slate-800">
                    الضامن #{rec.slot}: {rec.name} {rec.relationship ? `(${rec.relationship})` : ''}
                  </span>
                  <span className="text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded">
                    مستبدَل {rec.replacedAt ? `بتاريخ ${formatDateDisplay(rec.replacedAt)}` : ''}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-[10.5px] text-slate-500">
                  {rec.phone && <span dir="ltr">{rec.phone}</span>}
                  {rec.nationalId && <span>الرقم القومي: {rec.nationalId}</span>}
                  {rec.replacedBy && <span>بواسطة: {rec.replacedBy}</span>}
                  {rec.remainingAtReplace !== null && rec.remainingAtReplace !== undefined && (
                    <span>المتبقي وقت الاستبدال: {formatCurrency(rec.remainingAtReplace)}</span>
                  )}
                  {rec.replaceReason && <span>السبب: {rec.replaceReason}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Contract Transfer Feedback & Inline Panel */}
      {transferFeedback && (
        <div className={`rounded-xl px-4 py-2.5 text-xs font-bold border ${transferFeedback.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
          {transferFeedback.text}
        </div>
      )}

      {canTransferContract && showTransferForm && (
        <div className="bg-indigo-50/70 border border-indigo-200 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-xs sm:text-sm font-black text-indigo-950">تنازل عن العقد ونقل المتبقي لعميل آخر</h4>
              <p className="text-[11px] text-indigo-800/80 font-medium mt-0.5">
                سيتم إغلاق المتبقي ({formatCurrency(sale.remaining)}) على العميل الحالي وإنشاء عقد جديد بالمتبقي للعميل الجديد بدون أي حركة خزينة أو تكرار في المبيعات.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onToggleTransferForm(false)}
              className="text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div className="sm:col-span-2 space-y-1.5">
              <label className="text-[11px] font-bold text-slate-700 block">ابحث واختر العميل الجديد *</label>
              <input
                type="text"
                placeholder="اكتب اسم أو هاتف العميل للتصفية..."
                value={transferCustomerSearch}
                onChange={(e) => setTransferCustomerSearch(e.target.value)}
                className="w-full h-8 px-2.5 rounded-lg border border-slate-200 bg-white text-xs font-medium outline-none focus:border-indigo-500"
              />
              <select
                value={transferNewCustomerId}
                onChange={(e) => setTransferNewCustomerId(e.target.value)}
                className="w-full h-8 px-2.5 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-800 outline-none focus:border-indigo-500"
              >
                <option value="">-- اختر العميل الجديد --</option>
                {customers
                  .filter((c) => {
                    if (c.id === sale.customerId) return false;
                    const q = transferCustomerSearch.trim().toLowerCase();
                    if (!q) return true;
                    return c.name.toLowerCase().includes(q) || (c.phone || '').includes(q);
                  })
                  .slice(0, 60)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.phone ? `— ${c.phone}` : ''}
                    </option>
                  ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-slate-700 block">عدد الأقساط الجديدة</label>
              <input
                type="number"
                min={1}
                max={120}
                value={transferMonths}
                onChange={(e) => setTransferMonths(Math.max(1, Number(e.target.value) || 1))}
                className="w-full h-8 px-2.5 rounded-lg border border-slate-200 bg-white text-xs font-bold outline-none focus:border-indigo-500"
              />
              <label className="text-[11px] font-bold text-slate-700 block">بداية أول قسط</label>
              <DatePicker
                value={transferStartDate}
                onChange={setTransferStartDate}
                className="h-8 w-full rounded-lg border-slate-200 bg-white text-xs font-bold"
              />
            </div>
          </div>

          <div className="bg-white border border-indigo-100 rounded-xl p-3 space-y-2">
            <span className="text-[11px] font-black text-slate-700 block">ضامن العقد الجديد (اختياري)</span>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input
                type="text"
                placeholder="اسم الضامن"
                value={transferGuarantor.name}
                onChange={(e) => setTransferGuarantor((p) => ({ ...p, name: e.target.value }))}
                className="h-8 px-2.5 rounded-lg border border-slate-200 text-xs outline-none focus:border-indigo-500"
              />
              <input
                type="tel"
                placeholder="رقم الهاتف"
                value={transferGuarantor.phone}
                onChange={(e) => setTransferGuarantor((p) => ({ ...p, phone: e.target.value.replace(/\D/g, '') }))}
                className="h-8 px-2.5 rounded-lg border border-slate-200 text-xs outline-none focus:border-indigo-500"
              />
              <input
                type="text"
                placeholder="الرقم القومي"
                value={transferGuarantor.nationalId}
                onChange={(e) => setTransferGuarantor((p) => ({ ...p, nationalId: e.target.value.replace(/\D/g, '') }))}
                className="h-8 px-2.5 rounded-lg border border-slate-200 text-xs outline-none focus:border-indigo-500"
              />
            </div>
            <PersonRiskAlert
              nationalId={transferGuarantor.nationalId}
              phone={transferGuarantor.phone}
              context="guarantor"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <input
              type="text"
              placeholder="سبب التنازل / ملاحظة (اختياري)"
              value={transferReason}
              onChange={(e) => setTransferReason(e.target.value)}
              className="flex-1 min-w-[200px] h-8 px-2.5 rounded-lg border border-slate-200 bg-white text-xs outline-none focus:border-indigo-500"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onToggleTransferForm(false)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={isTransferring}
                onClick={() => void handleConfirmTransfer()}
                className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer disabled:opacity-60"
              >
                {isTransferring ? 'جاري التنفيذ...' : 'تأكيد التنازل ونقل العقد'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
