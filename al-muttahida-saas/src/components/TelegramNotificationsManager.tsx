import React, { useEffect, useState } from 'react';
import { Send, Save, CheckCircle2, AlertCircle, Eye, EyeOff, BellRing, HelpCircle } from 'lucide-react';
import { api, isApiMode } from '../lib/apiClient';

interface TelegramNotificationsManagerProps {
  canManage: boolean;
}

export default function TelegramNotificationsManager({ canManage }: TelegramNotificationsManagerProps) {
  const [enabled, setEnabled] = useState(false);
  const [botToken, setBotToken] = useState('');
  const [chatIds, setChatIds] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!isApiMode()) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    api
      .getTelegramSettings()
      .then((cfg) => {
        if (!cancelled && cfg) {
          setEnabled(Boolean(cfg.enabled));
          setBotToken(cfg.botToken || '');
          setChatIds(cfg.chatIds || '');
          if (cfg.botToken && cfg.chatIds) {
            setCollapsed(true);
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setFeedback({ type: 'error', text: err?.message || 'تعذر تحميل إعدادات تليجرام' });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage || saving) return;
    setSaving(true);
    setFeedback(null);
    try {
      await api.updateTelegramSettings({
        enabled,
        botToken: botToken.trim(),
        chatIds: chatIds.trim(),
      });
      setFeedback({ type: 'success', text: 'تم حفظ إعدادات إشعارات تليجرام بنجاح.' });
      setCollapsed(true);
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'تعذر حفظ الإعدادات.' });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!canManage || testing) return;
    setTesting(true);
    setFeedback(null);
    try {
      const res = await api.testTelegramSettings({
        botToken: botToken.trim(),
        chatIds: chatIds.trim(),
      });
      setFeedback({
        type: 'success',
        text: res?.message || 'تم إرسال الرسالة التجريبية بنجاح إلى تليجرام!',
      });
    } catch (err: any) {
      setFeedback({
        type: 'error',
        text: err?.message || 'فشل إرسال الرسالة التجريبية. تأكد من صحة Bot Token و Chat ID.',
      });
    } finally {
      setTesting(false);
    }
  };

  if (!isApiMode()) {
    return (
      <div className="p-6" dir="rtl">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800 font-bold flex items-center gap-2">
          <AlertCircle size={18} />
          <span>ميزة إشعارات تليجرام متاحة في وضع الخادم المتصل فقط.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5" dir="rtl">
      <div className="border border-slate-200 rounded-xl p-5 space-y-4 bg-slate-50/60">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center shrink-0">
              <BellRing size={19} />
            </div>
            <div>
              <h4 className="font-bold text-slate-800 text-sm">إشعارات تليجرام الفورية (Telegram Bot)</h4>
              <p className="text-xs text-slate-500">
                استقبل جميع إشعارات النظام لحظياً على تليجرام مع إعادة الإرسال تلقائياً عند عودة الإنترنت.
              </p>
            </div>
          </div>

          {collapsed && !loading && (
            <div className="flex items-center gap-2 self-start sm:self-auto">
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold">
                <CheckCircle2 size={14} />
                <span>{enabled ? 'مفعّل ومحفوظ' : 'متوقف ومحفوظ'}</span>
              </span>
              {canManage && (
                <button
                  type="button"
                  onClick={() => {
                    setCollapsed(false);
                    setFeedback(null);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-bold shadow-xs transition-colors cursor-pointer"
                >
                  تعديل الإعدادات
                </button>
              )}
            </div>
          )}
        </div>

        {feedback && (
          <div
            className={`rounded-xl px-4 py-3 text-xs font-bold flex items-center gap-2 border ${
              feedback.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-rose-50 border-rose-200 text-rose-800'
            }`}
          >
            {feedback.type === 'success' ? (
              <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle size={16} className="text-rose-600 shrink-0" />
            )}
            <span>{feedback.text}</span>
          </div>
        )}

        {loading ? (
          <div className="py-8 text-center text-sm text-slate-400 font-bold">جاري تحميل الإعدادات...</div>
        ) : !collapsed ? (
          <div className="space-y-5 pt-1">
            <form onSubmit={handleSave} className="space-y-5">
              {/* Enable Switch */}
              <div className="flex items-center justify-between p-4 rounded-xl border border-slate-200 bg-white">
                <div>
                  <p className="text-sm font-black text-slate-800">تفعيل إرسال جميع إشعارات النظام إلى تليجرام</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    الإرسال يتم في الخلفية ولا يؤثر على سرعة البرنامج حتى في حال انقطاع الإنترنت.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                    disabled={!canManage}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-sky-600" />
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Bot Token */}
                <div>
                  <label className="block text-xs font-black text-slate-700 mb-1.5">
                    رمز البوت (Bot Token)
                  </label>
                  <div className="relative">
                    <input
                      type={showToken ? 'text' : 'password'}
                      value={botToken}
                      onChange={(e) => setBotToken(e.target.value)}
                      disabled={!canManage}
                      dir="ltr"
                      placeholder="1234567890:ABCdefGHIjklMNOpqrSTUvwxYZ"
                      className="w-full h-11 px-3.5 pl-10 text-xs font-mono font-bold text-slate-800 bg-white border border-slate-300 rounded-xl focus:border-sky-600 focus:ring-4 focus:ring-sky-100 outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowToken((v) => !v)}
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-1 cursor-pointer"
                      title={showToken ? 'إخفاء الرمز' : 'إظهار الرمز'}
                    >
                      {showToken ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>

                {/* Chat IDs */}
                <div>
                  <label className="block text-xs font-black text-slate-700 mb-1.5">
                    رقم المحادثة أو الجروب (Chat ID)
                  </label>
                  <input
                    type="text"
                    value={chatIds}
                    onChange={(e) => setChatIds(e.target.value)}
                    disabled={!canManage}
                    dir="ltr"
                    placeholder="123456789 أو -1001234567890"
                    className="w-full h-11 px-3.5 text-xs font-mono font-bold text-slate-800 bg-white border border-slate-300 rounded-xl focus:border-sky-600 focus:ring-4 focus:ring-sky-100 outline-none"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    يمكنك إدخال أكثر من رقم مفصولين بفاصلة <span className="font-mono">,</span> للإرسال لأكثر من شخص أو جروب إدارة.
                  </p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="submit"
                  disabled={!canManage || saving}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-black shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Save size={15} />
                  <span>{saving ? 'جاري الحفظ...' : 'حفظ إعدادات تليجرام'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => void handleTest()}
                  disabled={!canManage || testing || !botToken.trim() || !chatIds.trim()}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200 text-xs font-black transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Send size={15} />
                  <span>{testing ? 'جاري الإرسال...' : 'إرسال رسالة تجريبية'}</span>
                </button>

                {botToken.trim() && chatIds.trim() && (
                  <button
                    type="button"
                    onClick={() => setCollapsed(true)}
                    className="px-4 py-2.5 rounded-xl bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-bold cursor-pointer"
                  >
                    إلغاء
                  </button>
                )}
              </div>
            </form>

            {/* Quick 3-step guide */}
            <div className="rounded-2xl border border-sky-200/80 bg-sky-50/50 p-4 space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-black text-sky-900">
                <HelpCircle size={16} className="text-sky-600" />
                <span>طريقة الإعداد السريعة (دقيقتين فقط — مجاناً 100%)</span>
              </div>
              <ol className="list-decimal list-inside space-y-1.5 text-xs text-sky-900/90 leading-relaxed font-medium">
                <li>
                  افتح تليجرام وابحث عن البوت الرسمي <span className="font-mono font-bold" dir="ltr">@BotFather</span>، أرسل له{' '}
                  <span className="font-mono font-bold" dir="ltr">/newbot</span>، اختر اسماً للبوت، ثم انسخ الـ{' '}
                  <strong>Bot Token</strong> والصقه في الخانة بالأعلى.
                </li>
                <li>
                  افتح البوت الجديد الذي أنشأته واضغط <strong>Start / ابدأ</strong> (خطوة ضرورية حتى يسمح تليجرام للبوت بمراسلتك).
                </li>
                <li>
                  لمعرفة رقمك (<strong>Chat ID</strong>)، ابحث في تليجرام عن <span className="font-mono font-bold" dir="ltr">@userinfobot</span>{' '}
                  واضغط Start ليظهر لك رقم الـ <span className="font-mono font-bold" dir="ltr">Id</span>، انسخه بالأعلى ثم اضغط{' '}
                  <strong>«إرسال رسالة تجريبية»</strong> ثم <strong>«حفظ»</strong>.
                </li>
              </ol>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
