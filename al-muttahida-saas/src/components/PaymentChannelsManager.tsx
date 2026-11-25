import React, { useMemo, useState } from 'react';
import {
  Banknote,
  Check,
  CheckCircle2,
  CreditCard,
  Landmark,
  Pencil,
  Plus,
  Smartphone,
  Trash2,
  Wallet,
  X,
  Zap,
} from 'lucide-react';
import type { PaymentChannelConfig } from '../types';
import { useAuth } from '../context/AuthContext';
import { useDialog } from '../context/DialogContext';
import { api, isApiMode } from '../lib/apiClient';
import { hasPermission } from '../lib/permissions';
import {
  CHANNEL_COLOR_STYLES,
  DEFAULT_PAYMENT_CHANNELS,
  QUICK_ADD_CHANNEL_PRESETS,
  type PaymentChannelColor,
  type PaymentChannelIcon,
} from '../lib/paymentChannels';

const ICON_OPTIONS: Array<{ id: PaymentChannelIcon; label: string; icon: React.ReactNode }> = [
  { id: 'cash', label: 'نقدي / درج', icon: <Banknote size={15} /> },
  { id: 'wallet', label: 'محفظة إلكترونية', icon: <Smartphone size={15} /> },
  { id: 'bank', label: 'حساب بنكي', icon: <Landmark size={15} /> },
  { id: 'instapay', label: 'إنستاباي', icon: <Zap size={15} /> },
  { id: 'card', label: 'فيزا / بطاقة', icon: <CreditCard size={15} /> },
];

export function renderChannelIcon(icon: PaymentChannelIcon, size = 16) {
  switch (icon) {
    case 'cash':
      return <Banknote size={size} />;
    case 'bank':
      return <Landmark size={size} />;
    case 'instapay':
      return <Zap size={size} />;
    case 'card':
      return <CreditCard size={size} />;
    case 'wallet':
    default:
      return <Smartphone size={size} />;
  }
}

export default function PaymentChannelsManager() {
  const { settings, updateSettings, refreshSettings, user } = useAuth();
  const { showToast, confirmDialog } = useDialog();
  const canManage = hasPermission(user, 'settings:manage');

  const channels = useMemo<PaymentChannelConfig[]>(() => {
    const raw = settings.paymentChannels;
    if (Array.isArray(raw) && raw.length > 0) return raw;
    return DEFAULT_PAYMENT_CHANNELS;
  }, [settings.paymentChannels]);

  const [newLabel, setNewLabel] = useState('');
  const [newIcon, setNewIcon] = useState<PaymentChannelIcon>('wallet');
  const [newColor, setNewColor] = useState<PaymentChannelColor>('rose');
  const [saving, setSaving] = useState(false);
  const [collapsed, setCollapsed] = useState(true);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editIcon, setEditIcon] = useState<PaymentChannelIcon>('wallet');
  const [editColor, setEditColor] = useState<PaymentChannelColor>('blue');

  const persistChannels = async (nextList: PaymentChannelConfig[], successMessage: string) => {
    setSaving(true);
    try {
      if (isApiMode()) {
        await api.updatePaymentChannels(nextList);
        await refreshSettings();
      } else {
        await updateSettings({ ...settings, paymentChannels: nextList });
      }
      showToast(successMessage, 'success');
      setCollapsed(true);
    } catch (err: any) {
      showToast(err?.message || 'تعذر حفظ قنوات الدفع', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleAddChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    const label = newLabel.trim();
    if (!label) {
      showToast('اكتب اسم قناة الدفع أولاً', 'warning');
      return;
    }
    if (channels.some((c) => c.label.trim() === label)) {
      showToast('هذه القناة مضافة بالفعل بنفس الاسم', 'warning');
      return;
    }

    const id = `ch_${Date.now().toString(36)}`;
    const nextList: PaymentChannelConfig[] = [
      ...channels,
      { id, label, icon: newIcon, color: newColor },
    ];
    await persistChannels(nextList, `تمت إضافة قناة "${label}" بنجاح`);
    setNewLabel('');
  };

  const handleQuickAdd = async (preset: PaymentChannelConfig) => {
    if (channels.some((c) => c.id === preset.id || c.label.trim() === preset.label.trim())) {
      return;
    }
    const nextList = [...channels, { ...preset }];
    await persistChannels(nextList, `تمت إضافة "${preset.label}" بنجاح`);
  };

  const startEdit = (ch: PaymentChannelConfig) => {
    setEditingId(ch.id);
    setEditLabel(ch.label);
    setEditIcon(ch.icon);
    setEditColor(ch.color);
  };

  const handleSaveEdit = async (id: string) => {
    const label = editLabel.trim();
    if (!label) {
      showToast('لا يمكن ترك اسم القناة فارغاً', 'warning');
      return;
    }
    const nextList = channels.map((c) =>
      c.id === id ? { ...c, label, icon: editIcon, color: editColor } : c,
    );
    await persistChannels(nextList, 'تم تحديث القناة بنجاح');
    setEditingId(null);
  };

  const handleDelete = async (ch: PaymentChannelConfig) => {
    if (ch.id === 'cash') return;
    const confirmed = await confirmDialog({
      title: 'حذف قناة دفع',
      message: `هل تريد إزالة "${ch.label}" من قنوات الدفع النشطة؟ الحركات المسجلة سابقاً ستبقى محفوظة في السجل ولن تُحذف.`,
      confirmText: 'نعم، حذف القناة',
      cancelText: 'إلغاء',
      type: 'warning',
    });
    if (!confirmed) return;

    const nextList = channels.filter((c) => c.id !== ch.id);
    await persistChannels(nextList, `تمت إزالة "${ch.label}"`);
  };

  const availablePresets = QUICK_ADD_CHANNEL_PRESETS.filter(
    (preset) => !channels.some((c) => c.id === preset.id || c.label.trim() === preset.label.trim()),
  );

  return (
    <div className="p-6 space-y-6">
      {collapsed ? (
        <div className="border border-slate-200 rounded-xl p-5 bg-slate-50/60">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
                <Wallet size={19} />
              </div>
              <div>
                <h4 className="font-bold text-slate-800 text-sm">قنوات الدفع والخزائن ({channels.length} قنوات نشطة)</h4>
                <p className="text-xs text-slate-500">
                  {channels.map((c) => c.label).join(' • ')}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 self-start sm:self-auto">
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold">
                <CheckCircle2 size={14} />
                <span>مفعّل ومحفوظ</span>
              </span>
              {canManage && (
                <button
                  type="button"
                  onClick={() => setCollapsed(false)}
                  className="px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-bold shadow-xs transition-colors cursor-pointer"
                >
                  تعديل الإعدادات
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
      <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
            <Wallet size={20} className="text-indigo-600" />
            <span>قنوات الدفع والخزائن</span>
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            أضف المحافظ الإلكترونية والحسابات البنكية وإنستاباي لتظهر في شاشة الخزينة وتحصيل الأقساط.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
        >
          <CheckCircle2 size={14} />
          <span>حفظ وإغلاق</span>
        </button>
      </div>

      {/* Existing Channels List */}
      <div className="space-y-2.5">
        {channels.map((ch) => {
          const style = CHANNEL_COLOR_STYLES[ch.color] || CHANNEL_COLOR_STYLES.slate;
          const isEditing = editingId === ch.id;

          return (
            <div
              key={ch.id}
              className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3 flex flex-wrap items-center justify-between gap-3"
            >
              {isEditing ? (
                <div className="flex flex-wrap items-center gap-2.5 flex-1">
                  <input
                    type="text"
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    className="input-ui h-9 text-xs font-bold flex-1 min-w-[160px]"
                    placeholder="اسم القناة"
                  />
                  <select
                    value={editIcon}
                    onChange={(e) => setEditIcon(e.target.value as PaymentChannelIcon)}
                    className="input-ui h-9 text-xs font-bold w-40"
                  >
                    {ICON_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center gap-1">
                    {(Object.keys(CHANNEL_COLOR_STYLES) as PaymentChannelColor[]).map((colorKey) => (
                      <button
                        key={colorKey}
                        type="button"
                        onClick={() => setEditColor(colorKey)}
                        className={`w-6 h-6 rounded-full ${CHANNEL_COLOR_STYLES[colorKey].swatchClass} cursor-pointer transition-transform ${
                          editColor === colorKey ? 'ring-2 ring-offset-1 ring-slate-900 scale-110' : 'opacity-60 hover:opacity-100'
                        }`}
                        title={CHANNEL_COLOR_STYLES[colorKey].label}
                      />
                    ))}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => handleSaveEdit(ch.id)}
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 cursor-pointer disabled:opacity-50"
                    >
                      <Check size={14} />
                      <span>حفظ</span>
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => setEditingId(null)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100 cursor-pointer"
                    >
                      <X size={14} />
                      <span>إلغاء</span>
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${style.iconBgClass} ${style.iconColorClass}`}>
                      {renderChannelIcon(ch.icon, 18)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-black text-slate-800">{ch.label}</span>
                        {ch.id === 'cash' && (
                          <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 border border-emerald-200">
                            افتراضي أساسي
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-slate-400 font-mono">ID: {ch.id}</span>
                    </div>
                  </div>
                  {canManage && (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => startEdit(ch)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:border-blue-300 hover:text-blue-700 cursor-pointer"
                      >
                        <Pencil size={13} />
                        <span>تعديل</span>
                      </button>
                      {ch.id !== 'cash' && (
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => handleDelete(ch)}
                          className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-100 cursor-pointer"
                        >
                          <Trash2 size={13} />
                          <span>حذف</span>
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {canManage && (
        <>
          {/* Quick-Add Suggestions */}
          {availablePresets.length > 0 && (
            <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4 space-y-2.5">
              <p className="text-xs font-black text-indigo-950">إضافة سريعة لقنوات شائعة (بضغطة واحدة):</p>
              <div className="flex flex-wrap gap-2">
                {availablePresets.map((preset) => {
                  const style = CHANNEL_COLOR_STYLES[preset.color];
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      disabled={saving}
                      onClick={() => handleQuickAdd(preset)}
                      className={`inline-flex items-center gap-1.5 rounded-xl border bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-indigo-50 hover:border-indigo-300 transition-colors cursor-pointer disabled:opacity-50`}
                    >
                      <span className={style.iconColorClass}>{renderChannelIcon(preset.icon, 14)}</span>
                      <span>+ {preset.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Custom Add Form */}
          <form onSubmit={handleAddChannel} className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3.5">
            <h4 className="text-xs font-black text-slate-800 flex items-center gap-1.5">
              <Plus size={15} className="text-blue-600" />
              <span>إضافة قناة دفع مخصصة جديدة</span>
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr_auto_auto] gap-3 items-end">
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">اسم القناة / الخزنة</label>
                <input
                  type="text"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="مثال: حساب البنك الأهلي، فودافون كاش محل، إنستاباي..."
                  className="input-ui h-10 w-full text-xs font-bold"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">الأيقونة</label>
                <select
                  value={newIcon}
                  onChange={(e) => setNewIcon(e.target.value as PaymentChannelIcon)}
                  className="input-ui h-10 w-full text-xs font-bold"
                >
                  {ICON_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1.5">اللون</label>
                <div className="flex items-center gap-1.5 h-10 px-2 rounded-xl border border-slate-200 bg-slate-50">
                  {(Object.keys(CHANNEL_COLOR_STYLES) as PaymentChannelColor[]).map((colorKey) => (
                    <button
                      key={colorKey}
                      type="button"
                      onClick={() => setNewColor(colorKey)}
                      className={`w-6 h-6 rounded-full ${CHANNEL_COLOR_STYLES[colorKey].swatchClass} cursor-pointer transition-transform ${
                        newColor === colorKey ? 'ring-2 ring-offset-1 ring-slate-900 scale-110' : 'opacity-65 hover:opacity-100'
                      }`}
                      title={CHANNEL_COLOR_STYLES[colorKey].label}
                    />
                  ))}
                </div>
              </div>
              <button
                type="submit"
                disabled={saving || !newLabel.trim()}
                className="h-10 inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#1e40af] px-4 text-xs font-bold text-white hover:bg-[#1d4ed8] disabled:opacity-50 cursor-pointer shadow-xs whitespace-nowrap"
              >
                <Plus size={15} />
                <span>{saving ? 'جاري الحفظ...' : 'إضافة القناة'}</span>
              </button>
            </div>
          </form>
        </>
      )}
      </>
      )}
    </div>
  );
}
