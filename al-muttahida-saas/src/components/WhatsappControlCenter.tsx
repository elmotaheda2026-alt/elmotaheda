import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  History,
  LogOut,
  MessageCircle,
  Play,
  Plus,
  Power,
  QrCode,
  RefreshCw,
  Save,
  Search,
  Send,
  Shield,
  ShieldAlert,
  Square,
  Trash2,
  UserX,
} from 'lucide-react';
import { Setting } from '../types';
import { useAuth } from '../context/AuthContext';
import { useDialog } from '../context/DialogContext';
import { formatWholeCurrency } from '../lib/utils';
import {
  applyAntiBanVariation,
  clearDeliveryLogs,
  DEFAULT_WHATSAPP_MESSAGE_TEMPLATE,
  formatReminderText,
  getDeliveryLogs,
  getDueStatusLabel,
  getFailedContacts,
  getMatchingReminderCandidates,
  getTodaySentCount,
  isWithinSendingHours,
  removeFailedContact,
  runWhatsappQueue,
  sendSingleWhatsappReminder,
  toggleExcludeContact,
  WhatsappCandidatePreview,
  WhatsappDeliveryLog,
  WhatsappFailedContact,
  WhatsappQueueProgress,
} from '../lib/whatsappReminders';

interface WhatsappControlCenterProps {
  formData: Setting;
  setFormData: React.Dispatch<React.SetStateAction<Setting>>;
  onSave: (e: React.FormEvent) => Promise<void> | void;
  saved: boolean;
  canManage: boolean;
}

const PRESET_OFFSETS: Array<{ offset: number; label: string }> = [
  { offset: -7, label: 'قبل 7 أيام' },
  { offset: -3, label: 'قبل 3 أيام' },
  { offset: -2, label: 'قبل يومين' },
  { offset: -1, label: 'قبل يوم واحد' },
  { offset: 0, label: 'يوم الاستحقاق' },
  { offset: 1, label: 'متأخر بيوم' },
  { offset: 3, label: 'متأخر 3 أيام' },
  { offset: 7, label: 'متأخر 7 أيام' },
];

export default function WhatsappControlCenter({
  formData,
  setFormData,
  onSave,
  saved,
  canManage,
}: WhatsappControlCenterProps) {
  const { updateSettings } = useAuth();
  const { showToast } = useDialog();

  const isEnabled = Boolean(formData.whatsappRemindersEnabled);
  const [subTab, setSubTab] = useState<'send' | 'config' | 'history'>('send');
  const [historyView, setHistoryView] = useState<'logs' | 'failed'>('logs');
  const [toggling, setToggling] = useState(false);

  const [whatsappSession, setWhatsappSession] = useState<{ connected: boolean; windowOpen: boolean }>({
    connected: false,
    windowOpen: false,
  });
  const waPopupRef = useRef<Window | null>(null);
  const [waOpenedInBrowser, setWaOpenedInBrowser] = useState(false);

  const [customOffsetInput, setCustomOffsetInput] = useState('');
  const [customOffsetDir, setCustomOffsetDir] = useState<'before' | 'after'>('before');
  const [queueSearch, setQueueSearch] = useState('');

  const [failedSearch, setFailedSearch] = useState('');
  const [manualExcludeName, setManualExcludeName] = useState('');
  const [manualExcludePhone, setManualExcludePhone] = useState('');

  const [testPhone, setTestPhone] = useState('');
  const [testingSend, setTestingSend] = useState(false);
  const [sendingRowKey, setSendingRowKey] = useState<string | null>(null);

  const [refreshTick, setRefreshTick] = useState(0);
  const stopQueueRef = useRef(false);
  const [queueProgress, setQueueProgress] = useState<WhatsappQueueProgress>({
    running: false,
    phase: 'done',
    currentIndex: 0,
    total: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
  });

  const activeOffsets = useMemo(
    () =>
      Array.isArray(formData.whatsappReminderOffsets) && formData.whatsappReminderOffsets.length > 0
        ? formData.whatsappReminderOffsets
        : [-2, -1, 0],
    [formData.whatsappReminderOffsets],
  );

  // Zero idle scanning or localStorage reads when WhatsApp reminders are disabled
  const candidates: WhatsappCandidatePreview[] = useMemo(() => {
    if (!isEnabled) return [];
    void refreshTick;
    return getMatchingReminderCandidates(formData);
  }, [isEnabled, formData, refreshTick]);

  const failedContacts: WhatsappFailedContact[] = useMemo(() => {
    if (!isEnabled) return [];
    void refreshTick;
    return getFailedContacts();
  }, [isEnabled, refreshTick]);

  const deliveryLogs: WhatsappDeliveryLog[] = useMemo(() => {
    if (!isEnabled) return [];
    void refreshTick;
    return getDeliveryLogs();
  }, [isEnabled, refreshTick]);

  const todaySentCount = useMemo(() => {
    if (!isEnabled) return 0;
    void refreshTick;
    return getTodaySentCount();
  }, [isEnabled, refreshTick]);

  const refreshWhatsappSessionStatus = async (manualClick = false) => {
    if (!isEnabled) return;
    const apiBridge = (window as unknown as {
      electronAPI?: {
        checkWhatsappSession?: () => Promise<{ connected: boolean; windowOpen: boolean }>;
      };
    }).electronAPI;

    if (apiBridge?.checkWhatsappSession) {
      try {
        const status = await apiBridge.checkWhatsappSession();
        const isConnected = Boolean(status?.connected);
        setWhatsappSession({ connected: isConnected, windowOpen: Boolean(status?.windowOpen) });
        if (manualClick) {
          showToast(
            isConnected
              ? 'جلسة واتساب متصلة وتعمل في الخلفية بنجاح'
              : 'لم يكتمل مسح كود QR بعد — يرجى مسح الكود من نافذة واتساب',
            isConnected ? 'success' : 'warning',
          );
        }
      } catch {
        // Ignore check errors
      }
      return;
    }

    if (manualClick) {
      localStorage.setItem('almuttahida_wa_web_connected', 'true');
      setWaOpenedInBrowser(false);
      setWhatsappSession({
        connected: true,
        windowOpen: Boolean(waPopupRef.current && !waPopupRef.current.closed),
      });
      showToast('تم تأكيد ربط جلسة واتساب ويب بنجاح', 'success');
    } else {
      setWhatsappSession({
        connected: localStorage.getItem('almuttahida_wa_web_connected') === 'true',
        windowOpen: Boolean(waPopupRef.current && !waPopupRef.current.closed),
      });
    }
  };

  useEffect(() => {
    if (!isEnabled) return;

    void refreshWhatsappSessionStatus(false);

    const apiBridge = (window as unknown as {
      electronAPI?: {
        checkWhatsappSession?: () => Promise<unknown>;
        onWhatsappSessionUpdated?: (cb: (data: { connected: boolean; windowOpen: boolean }) => void) => () => void;
      };
    }).electronAPI;

    const unsubscribe = apiBridge?.onWhatsappSessionUpdated?.((data) => {
      setWhatsappSession({ connected: Boolean(data?.connected), windowOpen: Boolean(data?.windowOpen) });
      if (data?.connected) {
        showToast('تم ربط جلسة واتساب ويب — الإرسال سيعمل في الخلفية بدون فتح نوافذ', 'success');
      }
    });

    const handleFocus = () => {
      if (apiBridge?.checkWhatsappSession) {
        void refreshWhatsappSessionStatus(false);
      } else if (waOpenedInBrowser) {
        localStorage.setItem('almuttahida_wa_web_connected', 'true');
        setWaOpenedInBrowser(false);
        setWhatsappSession({
          connected: true,
          windowOpen: Boolean(waPopupRef.current && !waPopupRef.current.closed),
        });
        showToast('تم ربط جلسة واتساب ويب بنجاح', 'success');
      }
    };

    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [isEnabled, waOpenedInBrowser, showToast]);

  const handleToggleEnabled = async (nextEnabled: boolean) => {
    if (!canManage || toggling) return;
    if (!nextEnabled && queueProgress.running) {
      stopQueueRef.current = true;
    }
    const nextSettings: Setting = {
      ...formData,
      whatsappRemindersEnabled: nextEnabled,
      taxRate: 0,
    };
    setFormData(nextSettings);
    setToggling(true);
    try {
      await updateSettings(nextSettings);
      showToast(
        nextEnabled ? 'تم تفعيل خدمة رسائل الواتساب بنجاح' : 'تم إيقاف خدمة رسائل الواتساب ولن تعمل في الخلفية',
        nextEnabled ? 'success' : 'info',
      );
    } catch (err: any) {
      setFormData(formData);
      showToast(err?.message || 'تعذر تحديث حالة رسائل الواتساب', 'error');
    } finally {
      setToggling(false);
    }
  };

  const toggleOffset = (offset: number) => {
    const exists = activeOffsets.includes(offset);
    const next = exists
      ? activeOffsets.filter((x) => x !== offset)
      : [...activeOffsets, offset].sort((a, b) => a - b);
    if (next.length === 0) {
      showToast('يجب اختيار فترة تذكير واحدة على الأقل', 'warning');
      return;
    }
    setFormData({ ...formData, whatsappReminderOffsets: next });
  };

  const handleAddCustomOffset = () => {
    const num = Math.abs(Math.floor(Number(customOffsetInput)));
    if (!Number.isFinite(num) || num <= 0 || num > 90) {
      showToast('أدخل عدداً صحيحاً بين 1 و 90 يوماً', 'warning');
      return;
    }
    const offset = customOffsetDir === 'before' ? -num : num;
    if (!activeOffsets.includes(offset)) {
      const next = [...activeOffsets, offset].sort((a, b) => a - b);
      setFormData({ ...formData, whatsappReminderOffsets: next });
    }
    setCustomOffsetInput('');
  };

  const handleOpenQrSession = async () => {
    const apiBridge = (window as unknown as {
      electronAPI?: {
        openWhatsappSession?: () => Promise<{ ok: boolean; error?: string }>;
      };
    }).electronAPI;

    if (apiBridge?.openWhatsappSession) {
      const res = await apiBridge.openWhatsappSession();
      if (!res?.ok) {
        showToast(res?.error || 'تعذر فتح نافذة واتساب', 'error');
      } else {
        showToast('امسح كود QR ثم أغلق نافذة واتساب؛ ستبقى الجلسة نشطة بالخلفية', 'info');
        setTimeout(() => void refreshWhatsappSessionStatus(false), 3000);
      }
    } else {
      waPopupRef.current = window.open('https://web.whatsapp.com/', 'almuttahida_wa_background_worker', 'width=960,height=700');
      setWaOpenedInBrowser(true);
      showToast('تم فتح واتساب ويب — بعد مسح كود QR ارجع لهذه الصفحة', 'info');
    }
  };

  const handleLogoutSession = async () => {
    const apiBridge = (window as unknown as {
      electronAPI?: {
        logoutWhatsappSession?: () => Promise<{ ok: boolean }>;
      };
    }).electronAPI;
    if (apiBridge?.logoutWhatsappSession) {
      await apiBridge.logoutWhatsappSession();
    }
    localStorage.removeItem('almuttahida_wa_web_connected');
    setWaOpenedInBrowser(false);
    setWhatsappSession({ connected: false, windowOpen: false });
    showToast('تم تسجيل الخروج ومسح الجلسة بنجاح', 'success');
  };

  const handleStartQueue = async (ignoreHours = false) => {
    if (!isEnabled) return;
    stopQueueRef.current = false;
    const result = await runWhatsappQueue({
      forceAll: false,
      ignoreHours,
      customSettings: formData,
      shouldStop: () => stopQueueRef.current,
      onProgress: (progress) => {
        setQueueProgress(progress);
        setRefreshTick((t) => t + 1);
      },
    });
    setRefreshTick((t) => t + 1);

    if (result.stopReason && result.sent === 0 && result.failed === 0) {
      showToast(result.stopReason, 'warning');
    } else {
      showToast(
        `انتهى الطابور: تم إرسال ${result.sent} بنجاح${result.failed > 0 ? `، فشل ${result.failed}` : ''}${result.skipped > 0 ? `، تم تخطي ${result.skipped}` : ''}`,
        result.failed > 0 ? 'warning' : 'success',
      );
    }
  };

  const handleSendSingleRow = async (item: WhatsappCandidatePreview) => {
    if (!isEnabled) return;
    setSendingRowKey(item.key);
    try {
      const amountText = formatWholeCurrency(item.amount, formData.currency);
      const res = await sendSingleWhatsappReminder(formData, {
        phone: item.phone,
        name: item.customerName,
        amount: amountText,
        dueDate: item.dueDate,
        invoiceNumber: item.invoiceNumber,
        dueStatus: item.dueStatusLabel,
        customerId: item.customerId,
      });
      setRefreshTick((t) => t + 1);
      if (res.ok) {
        showToast(`تم إرسال التذكير إلى ${item.customerName}`, 'success');
      } else {
        showToast(res.error || 'تعذر الإرسال', 'error');
      }
    } finally {
      setSendingRowKey(null);
    }
  };

  const readyToSendCount = candidates.filter((c) => !c.alreadySentToday && !c.isExcludedOrNoWhatsapp).length;
  const dailyLimit = Math.max(Number(formData.whatsappDailyLimit || 80), 1);
  const inHours = isWithinSendingHours(formData);

  const visibleCandidates = useMemo(() => {
    if (!queueSearch.trim()) return candidates;
    const q = queueSearch.trim().toLowerCase();
    return candidates.filter(
      (c) =>
        c.customerName.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q) ||
        c.invoiceNumber.toLowerCase().includes(q),
    );
  }, [candidates, queueSearch]);

  const filteredFailed = failedContacts.filter((entry) => {
    if (!failedSearch.trim()) return true;
    const q = failedSearch.trim().toLowerCase();
    return (
      entry.customerName.toLowerCase().includes(q) ||
      entry.phone.toLowerCase().includes(q) ||
      (entry.invoiceNumber || '').toLowerCase().includes(q)
    );
  });

  const reasonMeta = (reason: WhatsappFailedContact['reason']) => {
    switch (reason) {
      case 'no_whatsapp':
        return { label: 'لا يملك واتساب', badge: 'bg-rose-50 text-rose-700 border-rose-200' };
      case 'invalid_phone':
        return { label: 'رقم غير صالح', badge: 'bg-amber-50 text-amber-700 border-amber-200' };
      case 'excluded':
        return { label: 'مستبعد يدوياً', badge: 'bg-slate-100 text-slate-700 border-slate-300' };
      default:
        return { label: 'فشل التوصيل', badge: 'bg-orange-50 text-orange-700 border-orange-200' };
    }
  };

  // ── DISABLED / IDLE VIEW (Zero scanning, zero session checks, clean empty state) ────
  if (!isEnabled) {
    return (
      <div className="p-6 md:p-10">
        <div className="max-w-2xl mx-auto rounded-2xl border border-slate-200 bg-slate-50/70 p-6 md:p-8 text-center space-y-5">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-white border border-slate-200 shadow-2xs flex items-center justify-center text-slate-400">
            <MessageCircle size={28} />
          </div>

          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-200/70 text-slate-700 text-xs font-bold mb-1">
              <span className="w-2 h-2 rounded-full bg-slate-500" />
              <span>رسائل الواتساب متوقفة حالياً</span>
            </div>
            <h3 className="text-lg font-black text-slate-900">تذكيرات الأقساط عبر الواتساب غير مفعّلة</h3>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed max-w-lg mx-auto">
              لن يقوم النظام بفحص الأقساط أو فتح أي جلسة واتساب أو عرض أي طابور إرسال في الخلفية إلا بعد قيامك بتفعيل الخدمة بنفسك.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-right text-xs">
            <div className="rounded-xl bg-white border border-slate-200/80 p-3">
              <span className="font-black text-slate-800 block">تذكير بالمواعيد</span>
              <span className="text-[11px] text-slate-500">قبل الاستحقاق ويوم السداد والمتأخرين تلقائياً.</span>
            </div>
            <div className="rounded-xl bg-white border border-slate-200/80 p-3">
              <span className="font-black text-slate-800 block">حماية ذكية من الحظر</span>
              <span className="text-[11px] text-slate-500">فواصل عشوائية واستراحات وساعات إرسال محددة.</span>
            </div>
            <div className="rounded-xl bg-white border border-slate-200/80 p-3">
              <span className="font-black text-slate-800 block">تصفية الأرقام المتعذرة</span>
              <span className="text-[11px] text-slate-500">استبعاد تلقائي للأرقام التي لا تملك واتساب.</span>
            </div>
          </div>

          <div className="pt-1">
            {canManage ? (
              <button
                type="button"
                disabled={toggling}
                onClick={() => void handleToggleEnabled(true)}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3 text-sm font-black shadow-sm transition-colors cursor-pointer disabled:opacity-50"
              >
                <Power size={17} />
                <span>{toggling ? 'جاري التفعيل...' : 'تفعيل رسائل الواتساب الآن'}</span>
              </button>
            ) : (
              <span className="inline-block text-xs font-bold text-amber-700 bg-amber-50 px-4 py-2 rounded-xl border border-amber-200">
                تفعيل الخدمة متاح لمن لديه صلاحية إدارة الإعدادات فقط
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSave} className="p-5 md:p-6 space-y-5">
      {/* Compact Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 shrink-0">
            <MessageCircle size={20} />
          </div>
          <div>
            <h3 className="font-black text-base text-slate-900">رسائل تذكير الواتساب</h3>
            <p className="text-xs text-slate-500">اختر مواعيد الأقساط وأرسل التذكيرات بأمان وبضغطة زر</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs flex items-center gap-1.5">
            <Shield size={14} className="text-blue-600" />
            <span className="text-slate-600 font-bold">إرسال اليوم:</span>
            <span className="font-black text-slate-900 tabular-nums" dir="ltr">
              {todaySentCount} / {dailyLimit}
            </span>
          </div>

          {(formData.whatsappMode || 'web_session') === 'web_session' && (
            <>
              <span
                className={`inline-flex items-center gap-1.5 text-xs font-extrabold px-3 py-1.5 rounded-xl border ${
                  whatsappSession.connected
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-amber-50 text-amber-700 border-amber-200'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${whatsappSession.connected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                {whatsappSession.connected ? 'واتساب متصل' : 'غير متصل'}
              </span>
              <button
                type="button"
                onClick={() => void handleOpenQrSession()}
                className="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-xl text-xs font-bold shadow-2xs transition-colors cursor-pointer"
              >
                <QrCode size={14} />
                <span>{whatsappSession.connected ? 'فتح واتساب' : 'ربط QR'}</span>
              </button>
              <button
                type="button"
                onClick={() => void refreshWhatsappSessionStatus(true)}
                className="inline-flex items-center justify-center bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 p-2 rounded-xl text-xs font-bold cursor-pointer"
                title="فحص الاتصال"
              >
                <RefreshCw size={13} />
              </button>
              {whatsappSession.connected && (
                <button
                  type="button"
                  onClick={() => void handleLogoutSession()}
                  className="inline-flex items-center justify-center bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 p-2 rounded-xl text-xs font-bold cursor-pointer"
                  title="تسجيل خروج واتساب"
                >
                  <LogOut size={13} />
                </button>
              )}
            </>
          )}

          {canManage && (
            <button
              type="button"
              disabled={toggling}
              onClick={() => void handleToggleEnabled(false)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 px-3 py-1.5 text-xs font-bold text-rose-700 transition-colors cursor-pointer disabled:opacity-50"
              title="إيقاف الخدمة بالكامل"
            >
              <Power size={13} />
              <span>إيقاف الخدمة</span>
            </button>
          )}
        </div>
      </div>

      {/* 3 Focused Navigation Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex flex-wrap gap-1.5 bg-slate-100/90 border border-slate-200 rounded-xl p-1">
          {[
            { id: 'send' as const, label: 'الإرسال والمواعيد', badge: readyToSendCount, icon: <Play size={14} /> },
            { id: 'config' as const, label: 'القالب والحماية', icon: <ShieldAlert size={14} /> },
            { id: 'history' as const, label: 'السجل والمستبعدون', badge: failedContacts.length + deliveryLogs.length, icon: <History size={14} /> },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSubTab(tab.id)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                subTab === tab.id
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
              {typeof tab.badge === 'number' && tab.badge > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-extrabold bg-slate-200/80 text-slate-800">
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {saved && (
          <span className="inline-flex items-center gap-1 text-emerald-600 font-bold text-xs">
            <CheckCircle2 size={15} />
            تم حفظ الإعدادات
          </span>
        )}
      </div>

      {/* TAB 1: Queue & Reminder Timing */}
      {subTab === 'send' && (
        <div className="space-y-4">
          {/* Timing Period Selector */}
          <div className="bg-slate-50/80 border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div>
                <h4 className="text-sm font-black text-slate-900">مواعيد التذكير</h4>
                <p className="text-xs text-slate-500">اختر الأيام التي يظهر فيها القسط جاهزاً للإرسال</p>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <select
                  value={customOffsetDir}
                  onChange={(e) => setCustomOffsetDir(e.target.value as 'before' | 'after')}
                  className="h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-bold text-slate-700 outline-none focus:border-blue-500"
                >
                  <option value="before">قبل الموعد</option>
                  <option value="after">متأخر بعد</option>
                </select>
                <input
                  type="number"
                  min={1}
                  max={90}
                  value={customOffsetInput}
                  onChange={(e) => setCustomOffsetInput(e.target.value)}
                  placeholder="أيام"
                  className="h-9 w-16 rounded-lg border border-slate-300 bg-white px-2 text-xs font-bold text-center outline-none focus:border-blue-500"
                />
                <button
                  type="button"
                  onClick={handleAddCustomOffset}
                  className="h-9 px-3 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
                >
                  <Plus size={13} />
                  <span>إضافة</span>
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {PRESET_OFFSETS.map((preset) => {
                const selected = activeOffsets.includes(preset.offset);
                return (
                  <button
                    key={preset.offset}
                    type="button"
                    onClick={() => toggleOffset(preset.offset)}
                    className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                      selected
                        ? preset.offset > 0
                          ? 'bg-rose-600 text-white border-rose-600 shadow-2xs'
                          : preset.offset === 0
                            ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                            : 'bg-emerald-600 text-white border-emerald-600 shadow-2xs'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}

              {activeOffsets
                .filter((off) => !PRESET_OFFSETS.some((p) => p.offset === off))
                .map((customOff) => (
                  <button
                    key={customOff}
                    type="button"
                    onClick={() => toggleOffset(customOff)}
                    className="px-3 py-1.5 rounded-lg border bg-indigo-600 text-white border-indigo-600 text-xs font-bold cursor-pointer whitespace-nowrap"
                    title="اضغط لإلغاء الفترة"
                  >
                    {customOff < 0 ? `قبل ${Math.abs(customOff)} أيام` : `متأخر ${customOff} أيام`} ×
                  </button>
                ))}
            </div>
          </div>

          {/* Live Queue Card */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-0.5">
                <div className="text-sm font-black text-slate-900">
                  جاهز للإرسال ({readyToSendCount} من أصل {candidates.length})
                </div>
                <div className="text-xs text-slate-500 flex flex-wrap items-center gap-2.5">
                  <span>تأخير آمن: {formData.whatsappMinDelaySec ?? 15}–{formData.whatsappMaxDelaySec ?? 45} ث</span>
                  <span>•</span>
                  <span className={inHours ? 'text-emerald-700 font-bold' : 'text-amber-700 font-bold'}>
                    {inHours
                      ? `داخل أوقات الإرسال (${formData.whatsappSendStartHour || '10:00'} - ${formData.whatsappSendEndHour || '21:00'})`
                      : `خارج أوقات الإرسال (${formData.whatsappSendStartHour || '10:00'} - ${formData.whatsappSendEndHour || '21:00'})`}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-48 sm:w-56">
                  <Search size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <input
                    type="text"
                    value={queueSearch}
                    onChange={(e) => setQueueSearch(e.target.value)}
                    placeholder="بحث بالعميل أو الهاتف أو العقد..."
                    className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50/70 pr-8 pl-2.5 text-xs font-medium outline-none focus:bg-white focus:border-blue-500"
                  />
                </div>

                {queueProgress.running ? (
                  <button
                    type="button"
                    onClick={() => {
                      stopQueueRef.current = true;
                    }}
                    className="inline-flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 rounded-lg text-xs font-bold shadow-xs cursor-pointer"
                  >
                    <Square size={13} />
                    <span>إيقاف الطابور</span>
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={readyToSendCount === 0}
                      onClick={() => void handleStartQueue(false)}
                      className="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-xs font-bold shadow-xs disabled:opacity-50 cursor-pointer whitespace-nowrap"
                    >
                      <Play size={14} />
                      <span>بدء الإرسال الآمن</span>
                    </button>
                    {!inHours && readyToSendCount > 0 && (
                      <button
                        type="button"
                        onClick={() => void handleStartQueue(true)}
                        className="inline-flex items-center gap-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 px-3 py-2 rounded-lg text-xs font-bold cursor-pointer whitespace-nowrap"
                      >
                        <Clock size={13} />
                        <span>إرسال فوري</span>
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            {(queueProgress.running || queueProgress.total > 0) && (
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2 font-bold">
                  <span className="text-slate-800">
                    {queueProgress.running
                      ? queueProgress.phase === 'batch_pause'
                        ? `استراحة حماية الدفعة... متبقي ${queueProgress.waitSecondsRemaining ?? 0} ثانية`
                        : queueProgress.phase === 'waiting'
                          ? `انتظار عشوائي آمن... متبقي ${queueProgress.waitSecondsRemaining ?? 0} ثانية`
                          : `جاري الإرسال إلى: ${queueProgress.currentCustomerName || ''} (${queueProgress.currentIndex}/${queueProgress.total})`
                      : queueProgress.stopReason || `اكتمل الطابور (${queueProgress.currentIndex}/${queueProgress.total})`}
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="text-emerald-700">ناجح: {queueProgress.sent}</span>
                    <span className="text-rose-700">فشل: {queueProgress.failed}</span>
                    <span className="text-slate-500">متخطى: {queueProgress.skipped}</span>
                  </div>
                </div>
                {queueProgress.total > 0 && (
                  <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-600 transition-all duration-300"
                      style={{ width: `${Math.min(100, Math.round((queueProgress.currentIndex / queueProgress.total) * 100))}%` }}
                    />
                  </div>
                )}
              </div>
            )}

            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-xs text-right">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-extrabold">
                  <tr>
                    <th className="p-2.5">العميل</th>
                    <th className="p-2.5">رقم الهاتف</th>
                    <th className="p-2.5">العقد</th>
                    <th className="p-2.5">القسط</th>
                    <th className="p-2.5">الموعد</th>
                    <th className="p-2.5">الحالة</th>
                    <th className="p-2.5 text-center">إجراء</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleCandidates.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-slate-400 font-bold">
                        {candidates.length === 0
                          ? 'لا توجد أقساط مطابقة للفترات المحددة حالياً'
                          : 'لا توجد نتائج مطابقة للبحث'}
                      </td>
                    </tr>
                  ) : (
                    visibleCandidates.map((item) => (
                      <tr key={item.key} className="hover:bg-slate-50/70">
                        <td className="p-2.5 font-bold text-slate-800">{item.customerName}</td>
                        <td className="p-2.5 font-mono text-slate-700 whitespace-nowrap" dir="ltr">
                          {item.phone}
                        </td>
                        <td className="p-2.5 font-mono font-bold text-blue-700 whitespace-nowrap">{item.invoiceNumber}</td>
                        <td className="p-2.5 font-extrabold text-slate-900 whitespace-nowrap">
                          {formatWholeCurrency(item.amount, formData.currency)}
                        </td>
                        <td className="p-2.5 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full border font-bold text-[10px] whitespace-nowrap ${
                              item.offsetDays > 0
                                ? 'bg-rose-50 text-rose-700 border-rose-200'
                                : item.offsetDays === 0
                                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                                  : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            }`}
                          >
                            {item.dueStatusLabel} ({item.dueDate})
                          </span>
                        </td>
                        <td className="p-2.5 whitespace-nowrap">
                          {item.isExcludedOrNoWhatsapp ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 font-bold text-[10px] whitespace-nowrap">
                              {item.failReason === 'no_whatsapp' ? 'بدون واتساب' : 'مستبعد'}
                            </span>
                          ) : item.alreadySentToday ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold text-[10px] whitespace-nowrap">
                              أُرسل اليوم
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200 font-bold text-[10px] whitespace-nowrap">
                              جاهز
                            </span>
                          )}
                        </td>
                        <td className="p-2.5 text-center whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              disabled={sendingRowKey === item.key || item.isExcludedOrNoWhatsapp}
                              onClick={() => void handleSendSingleRow(item)}
                              className="px-2.5 py-1 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-bold text-[11px] disabled:opacity-40 cursor-pointer"
                            >
                              {sendingRowKey === item.key ? '...' : 'إرسال'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                toggleExcludeContact(item.phone, item.customerName, !item.isExcludedOrNoWhatsapp, item.customerId);
                                setRefreshTick((t) => t + 1);
                              }}
                              className="px-2.5 py-1 rounded bg-slate-100 hover:bg-rose-50 text-slate-600 hover:text-rose-700 border border-slate-200 font-bold text-[11px] cursor-pointer"
                            >
                              {item.isExcludedOrNoWhatsapp ? 'تفعيل' : 'استبعاد'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {canManage && (
            <div className="flex items-center justify-end">
              <button
                type="submit"
                className="inline-flex items-center gap-2 bg-[#1e40af] text-white px-5 py-2 rounded-lg hover:bg-[#1d4ed8] transition-colors font-bold text-xs shadow-2xs cursor-pointer"
              >
                <Save size={15} />
                <span>حفظ مواعيد التذكير</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: Template, Anti-Ban Guard & Connection Mode */}
      {subTab === 'config' && (
        <div className="space-y-5">
          {/* Template & Test Message */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-sm font-black text-slate-800">قالب نص الرسالة</label>
              <div className="flex flex-wrap items-center gap-1 text-[11px]">
                {['{name}', '{amount}', '{dueStatus}', '{dueDate}', '{invoiceNumber}', '{companyName}'].map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() =>
                      setFormData({
                        ...formData,
                        whatsappMessageTemplate: `${formData.whatsappMessageTemplate || DEFAULT_WHATSAPP_MESSAGE_TEMPLATE} ${tag}`,
                      })
                    }
                    dir="ltr"
                    className="font-mono px-2 py-0.5 rounded bg-slate-50 border border-slate-200 text-slate-700 hover:border-emerald-400 hover:text-emerald-700 cursor-pointer"
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
            <textarea
              rows={3}
              spellCheck={false}
              value={formData.whatsappMessageTemplate || DEFAULT_WHATSAPP_MESSAGE_TEMPLATE}
              onChange={(e) => setFormData({ ...formData, whatsappMessageTemplate: e.target.value })}
              className="input-ui w-full text-sm leading-relaxed"
            />
            <div className="bg-emerald-50/50 border border-emerald-200/80 rounded-lg p-3 text-xs text-slate-700 whitespace-pre-line">
              <span className="font-bold text-emerald-700 block mb-1">معاينة الرسالة:</span>
              {applyAntiBanVariation(
                formatReminderText(formData, {
                  name: 'محمد أحمد',
                  amount: '1,500 جنيه',
                  dueDate: '2026-11-20',
                  dueStatus: getDueStatusLabel(-2),
                  invoiceNumber: 'INV-1031',
                }),
                formData,
              )}
            </div>

            <div className="flex flex-wrap items-end gap-2.5 pt-2 border-t border-slate-100">
              <div className="flex-1 min-w-[200px] max-w-xs">
                <label className="block text-xs font-bold text-slate-700 mb-1">رقم لاختبار الإرسال</label>
                <input
                  type="text"
                  dir="ltr"
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  placeholder="01012345678"
                  className="input-ui h-9 w-full font-mono text-xs"
                />
              </div>
              <button
                type="button"
                disabled={testingSend}
                onClick={async () => {
                  if (!testPhone.trim()) {
                    showToast('يرجى إدخال رقم هاتف للاختبار', 'warning');
                    return;
                  }
                  setTestingSend(true);
                  try {
                    const res = await sendSingleWhatsappReminder(formData, {
                      phone: testPhone.trim(),
                      name: 'عميل تجريبي',
                      amount: '1,000 جنيه',
                      dueDate: new Date().toISOString().split('T')[0],
                      dueStatus: 'مستحق اليوم',
                      invoiceNumber: 'INV-TEST',
                    });
                    setRefreshTick((t) => t + 1);
                    if (res.ok) {
                      showToast('تم إرسال رسالة الاختبار بنجاح', 'success');
                    } else {
                      showToast(res.error || 'فشل إرسال رسالة الاختبار', 'error');
                    }
                  } finally {
                    setTestingSend(false);
                  }
                }}
                className="flex items-center gap-1.5 h-9 px-4 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold transition-colors disabled:opacity-50 cursor-pointer"
              >
                <Send size={13} />
                <span>{testingSend ? 'جاري الإرسال...' : 'إرسال رسالة تجريبية'}</span>
              </button>
            </div>
          </div>

          {/* Anti-Ban Safety Rules */}
          <div className="bg-slate-50/80 border border-slate-200 rounded-xl p-4 space-y-4">
            <div className="flex items-center gap-2">
              <Shield size={17} className="text-blue-600" />
              <h4 className="font-black text-sm text-slate-900">قواعد الأمان والحماية من الحظر</h4>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">أقل تأخير عشوائي (ثانية)</label>
                <input
                  type="number"
                  min={5}
                  max={300}
                  value={formData.whatsappMinDelaySec ?? 15}
                  onChange={(e) => setFormData({ ...formData, whatsappMinDelaySec: Number(e.target.value) || 15 })}
                  className="input-ui h-9 w-full text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">أقصى تأخير عشوائي (ثانية)</label>
                <input
                  type="number"
                  min={10}
                  max={600}
                  value={formData.whatsappMaxDelaySec ?? 45}
                  onChange={(e) => setFormData({ ...formData, whatsappMaxDelaySec: Number(e.target.value) || 45 })}
                  className="input-ui h-9 w-full text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">الحد الأقصى اليومي للرسائل</label>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={formData.whatsappDailyLimit ?? 80}
                  onChange={(e) => setFormData({ ...formData, whatsappDailyLimit: Number(e.target.value) || 80 })}
                  className="input-ui h-9 w-full text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">استراحة بعد كل (عدد رسائل)</label>
                <input
                  type="number"
                  min={3}
                  max={100}
                  value={formData.whatsappBatchSize ?? 15}
                  onChange={(e) => setFormData({ ...formData, whatsappBatchSize: Number(e.target.value) || 15 })}
                  className="input-ui h-9 w-full text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">مدة استراحة الدفعة (ثانية)</label>
                <input
                  type="number"
                  min={30}
                  max={1800}
                  value={formData.whatsappBatchPauseSec ?? 180}
                  onChange={(e) => setFormData({ ...formData, whatsappBatchPauseSec: Number(e.target.value) || 180 })}
                  className="input-ui h-9 w-full text-xs"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">بداية الإرسال</label>
                  <input
                    type="time"
                    value={formData.whatsappSendStartHour || '10:00'}
                    onChange={(e) => setFormData({ ...formData, whatsappSendStartHour: e.target.value })}
                    className="input-ui h-9 w-full text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">نهاية الإرسال</label>
                  <input
                    type="time"
                    value={formData.whatsappSendEndHour || '21:00'}
                    onChange={(e) => setFormData({ ...formData, whatsappSendEndHour: e.target.value })}
                    className="input-ui h-9 w-full text-xs"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
              <label className="flex items-start gap-2.5 bg-white border border-slate-200 rounded-xl p-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.whatsappAntiBanVariation !== false}
                  onChange={(e) => setFormData({ ...formData, whatsappAntiBanVariation: e.target.checked })}
                  className="w-4 h-4 accent-blue-600 mt-0.5"
                />
                <div>
                  <span className="text-xs font-black text-slate-800 block">تنويع نص الرسالة تلقائياً (Anti-Spam)</span>
                  <span className="text-[11px] text-slate-500">يغير التحية ويضيف رمز مرجعي فريد حتى لا تبدو الرسائل مكررة.</span>
                </div>
              </label>

              <label className="flex items-start gap-2.5 bg-white border border-slate-200 rounded-xl p-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.whatsappAutoSkipInvalid !== false}
                  onChange={(e) => setFormData({ ...formData, whatsappAutoSkipInvalid: e.target.checked })}
                  className="w-4 h-4 accent-blue-600 mt-0.5"
                />
                <div>
                  <span className="text-xs font-black text-slate-800 block">تخطي الأرقام التي لا تملك واتساب تلقائياً</span>
                  <span className="text-[11px] text-slate-500">يمنع تكرار الإرسال للأرقام الفاشلة لحماية رقم الشركة.</span>
                </div>
              </label>
            </div>
          </div>

          {/* Connection Mode Selector */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            <button
              type="button"
              onClick={() => setFormData({ ...formData, whatsappMode: 'web_session' })}
              className={`text-right p-4 rounded-xl border-2 transition-all cursor-pointer ${
                (formData.whatsappMode || 'web_session') === 'web_session'
                  ? 'border-emerald-500 bg-emerald-50/40 shadow-2xs'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-black text-sm text-slate-900">واتساب ويب بالخلفية (QR)</span>
                <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-600 text-white">مجاني</span>
              </div>
              <p className="text-xs text-slate-600">إرسال صامت بالخلفية بعد مسح الكود مرة واحدة.</p>
            </button>

            <button
              type="button"
              onClick={() => setFormData({ ...formData, whatsappMode: 'meta_api' })}
              className={`text-right p-4 rounded-xl border-2 transition-all cursor-pointer ${
                formData.whatsappMode === 'meta_api'
                  ? 'border-blue-600 bg-blue-50/40 shadow-2xs'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-black text-sm text-slate-900">Meta Cloud API الرسمي</span>
                <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-blue-600 text-white">رسمي</span>
              </div>
              <p className="text-xs text-slate-600">ربط مباشر عبر واجهة Meta باستخدام قوالب معتمدة.</p>
            </button>
          </div>

          {formData.whatsappMode === 'meta_api' && (
            <div className="bg-blue-50/40 border border-blue-200 rounded-xl p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Phone Number ID</label>
                <input
                  type="text"
                  dir="ltr"
                  value={formData.whatsappPhoneNumberId || ''}
                  onChange={(e) => setFormData({ ...formData, whatsappPhoneNumberId: e.target.value })}
                  placeholder="123456789012345"
                  className="input-ui h-9 w-full font-mono text-xs bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Access Token</label>
                <input
                  type="password"
                  dir="ltr"
                  value={formData.whatsappAccessToken || ''}
                  onChange={(e) => setFormData({ ...formData, whatsappAccessToken: e.target.value })}
                  placeholder="EAAG..."
                  className="input-ui h-9 w-full font-mono text-xs bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">اسم القالب (Template Name)</label>
                <input
                  type="text"
                  dir="ltr"
                  value={formData.whatsappTemplateName || 'installment_reminder'}
                  onChange={(e) => setFormData({ ...formData, whatsappTemplateName: e.target.value })}
                  className="input-ui h-9 w-full font-mono text-xs bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">لغة القالب</label>
                <input
                  type="text"
                  dir="ltr"
                  value={formData.whatsappTemplateLanguage || 'ar'}
                  onChange={(e) => setFormData({ ...formData, whatsappTemplateLanguage: e.target.value })}
                  className="input-ui h-9 w-full font-mono text-xs bg-white"
                />
              </div>
            </div>
          )}

          {canManage && (
            <div className="flex items-center justify-end pt-1">
              <button
                type="submit"
                className="flex items-center gap-2 bg-[#1e40af] text-white px-6 py-2.5 rounded-lg hover:bg-[#1d4ed8] transition-colors font-bold text-sm shadow-2xs cursor-pointer"
              >
                <Save size={16} />
                <span>حفظ إعدادات الواتساب والحماية</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: Combined Logs & Failed / Excluded Contacts */}
      {subTab === 'history' && (
        <div className="space-y-4">
          <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1 gap-1">
            <button
              type="button"
              onClick={() => setHistoryView('logs')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer ${
                historyView === 'logs' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              <History size={13} />
              <span>سجل الإرسال ({deliveryLogs.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setHistoryView('failed')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer ${
                historyView === 'failed' ? 'bg-white text-rose-700 shadow-xs' : 'text-slate-600'
              }`}
            >
              <UserX size={13} />
              <span>بدون واتساب ومستبعدون ({failedContacts.length})</span>
            </button>
          </div>

          {historyView === 'logs' ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-600">آخر {deliveryLogs.length} عملية إرسال مسجلة</span>
                {deliveryLogs.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      clearDeliveryLogs();
                      setRefreshTick((t) => t + 1);
                    }}
                    className="text-xs font-bold text-rose-600 hover:underline cursor-pointer"
                  >
                    مسح السجل
                  </button>
                )}
              </div>

              <div className="overflow-x-auto border border-slate-200 rounded-xl bg-white">
                <table className="w-full text-xs text-right">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-extrabold">
                    <tr>
                      <th className="p-2.5">الوقت</th>
                      <th className="p-2.5">العميل</th>
                      <th className="p-2.5">الهاتف</th>
                      <th className="p-2.5">العقد / المبلغ</th>
                      <th className="p-2.5">الحالة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {deliveryLogs.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="p-10 text-center text-slate-400 font-bold">
                          لا توجد عمليات إرسال مسجلة حتى الآن
                        </td>
                      </tr>
                    ) : (
                      deliveryLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-slate-50/70">
                          <td className="p-2.5 text-slate-500 whitespace-nowrap">
                            {new Date(log.sentAt).toLocaleString('ar-EG')}
                          </td>
                          <td className="p-2.5 font-bold text-slate-800">{log.customerName}</td>
                          <td className="p-2.5 font-mono text-slate-700 whitespace-nowrap" dir="ltr">
                            {log.phone}
                          </td>
                          <td className="p-2.5 whitespace-nowrap">
                            <span className="font-mono font-bold text-blue-700">{log.invoiceNumber}</span>
                            <span className="mx-1.5 text-slate-400">•</span>
                            <span className="font-extrabold text-slate-800">{log.amount}</span>
                          </td>
                          <td className="p-2.5 whitespace-nowrap">
                            {log.status === 'sent' ? (
                              <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold text-[10px]">
                                تم الإرسال
                              </span>
                            ) : (
                              <span
                                className="px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 font-bold text-[10px]"
                                title={log.reason}
                              >
                                فشل: {log.reason || 'خطأ'}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-rose-50/60 border border-rose-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle size={18} className="text-rose-600 shrink-0 mt-0.5" />
                  <div className="text-xs text-rose-900">
                    <span className="font-black block">قائمة الأرقام التي لا تملك واتساب أو المستبعدة</span>
                    <span className="text-rose-700">تُستثنى تلقائياً من الطابور لحماية رقم الشركة من الحظر.</span>
                  </div>
                </div>

                <div className="relative w-full sm:w-64">
                  <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={failedSearch}
                    onChange={(e) => setFailedSearch(e.target.value)}
                    placeholder="بحث بالاسم أو الرقم..."
                    className="input-ui h-9 w-full pr-8 pl-3 text-xs bg-white"
                  />
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 flex flex-wrap items-end gap-2.5">
                <div className="flex-1 min-w-[160px]">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">اسم العميل</label>
                  <input
                    type="text"
                    value={manualExcludeName}
                    onChange={(e) => setManualExcludeName(e.target.value)}
                    placeholder="الاسم..."
                    className="input-ui h-9 w-full text-xs bg-white"
                  />
                </div>
                <div className="flex-1 min-w-[160px]">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">رقم الهاتف</label>
                  <input
                    type="text"
                    dir="ltr"
                    value={manualExcludePhone}
                    onChange={(e) => setManualExcludePhone(e.target.value)}
                    placeholder="01012345678"
                    className="input-ui h-9 w-full text-xs font-mono bg-white"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (!manualExcludePhone.trim()) {
                      showToast('يرجى إدخال رقم الهاتف للاستبعاد', 'warning');
                      return;
                    }
                    toggleExcludeContact(manualExcludePhone.trim(), manualExcludeName.trim() || 'عميل مستبعد', true);
                    setManualExcludeName('');
                    setManualExcludePhone('');
                    setRefreshTick((t) => t + 1);
                    showToast('تمت إضافة الرقم لقائمة الاستبعاد', 'success');
                  }}
                  className="h-9 px-3.5 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Ban size={13} />
                  <span>استبعاد رقم</span>
                </button>
              </div>

              <div className="overflow-x-auto border border-slate-200 rounded-xl bg-white">
                <table className="w-full text-xs text-right">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-extrabold">
                    <tr>
                      <th className="p-2.5">العميل</th>
                      <th className="p-2.5">رقم الهاتف</th>
                      <th className="p-2.5">السبب</th>
                      <th className="p-2.5">التفاصيل</th>
                      <th className="p-2.5">الحالة</th>
                      <th className="p-2.5 text-center">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredFailed.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-10 text-center text-slate-400 font-bold">
                          لا توجد أرقام غير متوصل إليها أو مستبعدة حالياً
                        </td>
                      </tr>
                    ) : (
                      filteredFailed.map((entry) => {
                        const rMeta = reasonMeta(entry.reason);
                        return (
                          <tr key={entry.phone} className="hover:bg-slate-50/70">
                            <td className="p-2.5 font-bold text-slate-800">{entry.customerName}</td>
                            <td className="p-2.5 font-mono text-slate-700 whitespace-nowrap" dir="ltr">
                              {entry.phone}
                            </td>
                            <td className="p-2.5 whitespace-nowrap">
                              <span className={`px-2 py-0.5 rounded-full border font-bold text-[10px] ${rMeta.badge}`}>
                                {rMeta.label}
                              </span>
                            </td>
                            <td className="p-2.5 text-slate-500 max-w-xs truncate" title={entry.errorMessage}>
                              {entry.errorMessage}
                            </td>
                            <td className="p-2.5 whitespace-nowrap">
                              <span
                                className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${
                                  entry.excluded
                                    ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                    : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                }`}
                              >
                                {entry.excluded ? 'مستبعد' : 'مفعّل'}
                              </span>
                            </td>
                            <td className="p-2.5 text-center whitespace-nowrap">
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    toggleExcludeContact(entry.phone, entry.customerName, !entry.excluded, entry.customerId);
                                    setRefreshTick((t) => t + 1);
                                  }}
                                  className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px] cursor-pointer"
                                >
                                  {entry.excluded ? 'إلغاء الاستبعاد' : 'استبعاد'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    removeFailedContact(entry.phone);
                                    setRefreshTick((t) => t + 1);
                                  }}
                                  className="p-1.5 rounded text-rose-600 hover:bg-rose-50 cursor-pointer"
                                  title="حذف من القائمة"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </form>
  );
}
