import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  XCircle,
  X,
  Trash2,
  HelpCircle,
} from 'lucide-react';

export interface ConfirmOptions {
  title?: string;
  message: string;
  subMessage?: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'danger' | 'warning' | 'info';
}

export interface AlertOptions {
  title?: string;
  message: string;
  type?: 'success' | 'error' | 'warning' | 'info';
  buttonText?: string;
}

export interface ToastItem {
  id: string;
  message: string;
  type: 'success' | 'error' | 'warning' | 'info';
  duration?: number;
}

interface DialogContextType {
  confirmDialog: (options: ConfirmOptions | string) => Promise<boolean>;
  alertDialog: (options: AlertOptions | string) => Promise<void>;
  showToast: (message: string, type?: 'success' | 'error' | 'warning' | 'info', duration?: number) => void;
}

const DialogContext = createContext<DialogContextType | undefined>(undefined);

export function DialogProvider({ children }: { children: React.ReactNode }) {
  // Confirm Modal state
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    options: ConfirmOptions;
    resolve: (val: boolean) => void;
  } | null>(null);

  // Alert Modal state
  const [alertState, setAlertState] = useState<{
    isOpen: boolean;
    options: AlertOptions;
    resolve: () => void;
  } | null>(null);

  // Toasts state
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const confirmDialog = useCallback((options: ConfirmOptions | string): Promise<boolean> => {
    return new Promise((resolve) => {
      const opts: ConfirmOptions =
        typeof options === 'string'
          ? {
              message: options,
              title: options.includes('حذف') ? 'تأكيد الحذف' : 'تأكيد الإجراء',
              type: options.includes('حذف') ? 'danger' : 'warning',
              confirmText: options.includes('حذف') ? 'نعم، حذف' : 'تأكيد',
              cancelText: 'إلغاء',
            }
          : {
              title: options.title || (options.type === 'danger' ? 'تأكيد الحذف' : 'تأكيد الإجراء'),
              confirmText: options.confirmText || (options.type === 'danger' ? 'نعم، حذف' : 'تأكيد'),
              cancelText: options.cancelText || 'إلغاء',
              type: options.type || 'danger',
              ...options,
            };

      setConfirmState({
        isOpen: true,
        options: opts,
        resolve,
      });
    });
  }, []);

  const alertDialog = useCallback((options: AlertOptions | string): Promise<void> => {
    return new Promise((resolve) => {
      const opts: AlertOptions =
        typeof options === 'string'
          ? {
              title: 'تنبيه من النظام',
              message: options,
              type: 'info',
              buttonText: 'حسناً',
            }
          : {
              title: options.title || 'تنبيه من النظام',
              type: options.type || 'info',
              buttonText: options.buttonText || 'حسناً',
              ...options,
            };

      setAlertState({
        isOpen: true,
        options: opts,
        resolve,
      });
    });
  }, []);

  const showToast = useCallback(
    (message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info', duration = 4000) => {
      const id = `${Date.now()}-${Math.random()}`;
      setToasts((prev) => [...prev, { id, message, type, duration }]);
      if (duration > 0) {
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id));
        }, duration);
      }
    },
    []
  );

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Expose to window for global access and override native window.alert
  useEffect(() => {
    (window as any).confirmDialog = confirmDialog;
    (window as any).alertDialog = alertDialog;
    (window as any).showToast = showToast;

    // Polyfill window.alert to show in-system toast notifications instead of browser alerts!
    const originalAlert = window.alert;
    window.alert = (msg: any) => {
      const text = String(msg || '');
      const isError =
        text.includes('خطأ') ||
        text.includes('فشل') ||
        text.includes('لا يمكن') ||
        text.includes('يرجى') ||
        text.includes('تعذر');
      showToast(text, isError ? 'error' : 'info', 5000);
    };

    return () => {
      window.alert = originalAlert;
    };
  }, [confirmDialog, alertDialog, showToast]);

  // Handle keyboard events for confirm modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (confirmState?.isOpen) {
        if (e.key === 'Escape') {
          confirmState.resolve(false);
          setConfirmState(null);
        } else if (e.key === 'Enter') {
          confirmState.resolve(true);
          setConfirmState(null);
        }
      } else if (alertState?.isOpen) {
        if (e.key === 'Escape' || e.key === 'Enter') {
          alertState.resolve();
          setAlertState(null);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [confirmState, alertState]);

  return (
    <DialogContext.Provider value={{ confirmDialog, alertDialog, showToast }}>
      {children}

      {/* ─── Global In-System Confirmation Dialog ──────────────────────── */}
      {confirmState?.isOpen && (
        <div
          className="fixed inset-0 z-[99999] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn select-none"
          onClick={() => {
            confirmState.resolve(false);
            setConfirmState(null);
          }}
          dir="rtl"
        >
          <div
            className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden transform transition-all animate-scaleUp"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header Strip */}
            <div className="p-6 pb-4 flex items-start gap-4">
              <div
                className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-inner ${
                  confirmState.options.type === 'danger'
                    ? 'bg-rose-100 text-rose-600'
                    : confirmState.options.type === 'warning'
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-blue-100 text-blue-700'
                }`}
              >
                {confirmState.options.type === 'danger' ? (
                  <Trash2 size={24} />
                ) : confirmState.options.type === 'warning' ? (
                  <AlertTriangle size={24} />
                ) : (
                  <HelpCircle size={24} />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-black text-slate-900">
                  {confirmState.options.title}
                </h3>
                <p className="mt-1 text-sm text-slate-600 leading-relaxed font-semibold">
                  {confirmState.options.message}
                </p>
                {confirmState.options.subMessage && (
                  <p className="mt-1 text-xs text-slate-400 font-normal">
                    {confirmState.options.subMessage}
                  </p>
                )}
              </div>
            </div>

            {/* Modal Actions Footer */}
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => {
                  confirmState.resolve(false);
                  setConfirmState(null);
                }}
                className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold transition-all active:scale-95 cursor-pointer shadow-2xs"
              >
                {confirmState.options.cancelText || 'إلغاء'}
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => {
                  confirmState.resolve(true);
                  setConfirmState(null);
                }}
                className={`px-5 py-2.5 rounded-xl text-white text-xs font-bold transition-all shadow-md active:scale-95 cursor-pointer flex items-center gap-1.5 ${
                  confirmState.options.type === 'danger'
                    ? 'bg-rose-600 hover:bg-rose-700 shadow-rose-600/20'
                    : confirmState.options.type === 'warning'
                    ? 'bg-amber-600 hover:bg-amber-700 shadow-amber-600/20'
                    : 'bg-blue-600 hover:bg-blue-700 shadow-blue-600/20'
                }`}
              >
                {confirmState.options.type === 'danger' && <Trash2 size={14} />}
                <span>{confirmState.options.confirmText || 'تأكيد'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Global In-System Alert Dialog ─────────────────────────────── */}
      {alertState?.isOpen && (
        <div
          className="fixed inset-0 z-[99999] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn select-none"
          onClick={() => {
            alertState.resolve();
            setAlertState(null);
          }}
          dir="rtl"
        >
          <div
            className="w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden transform transition-all animate-scaleUp p-6 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className={`w-14 h-14 rounded-2xl mx-auto flex items-center justify-center mb-4 ${
                alertState.options.type === 'error'
                  ? 'bg-rose-100 text-rose-600'
                  : alertState.options.type === 'success'
                  ? 'bg-emerald-100 text-emerald-600'
                  : alertState.options.type === 'warning'
                  ? 'bg-amber-100 text-amber-600'
                  : 'bg-blue-100 text-blue-600'
              }`}
            >
              {alertState.options.type === 'error' ? (
                <XCircle size={28} />
              ) : alertState.options.type === 'success' ? (
                <CheckCircle2 size={28} />
              ) : alertState.options.type === 'warning' ? (
                <AlertTriangle size={28} />
              ) : (
                <Info size={28} />
              )}
            </div>

            <h3 className="text-base font-black text-slate-900 mb-1">
              {alertState.options.title}
            </h3>
            <p className="text-xs text-slate-600 font-semibold leading-relaxed mb-5">
              {alertState.options.message}
            </p>

            <button
              type="button"
              autoFocus
              onClick={() => {
                alertState.resolve();
                setAlertState(null);
              }}
              className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-all shadow-md active:scale-95 cursor-pointer"
            >
              {alertState.options.buttonText || 'حسناً'}
            </button>
          </div>
        </div>
      )}

      {/* ─── Global In-System Toast Notifications ───────────────────────── */}
      <div
        className="fixed top-5 left-1/2 -translate-x-1/2 z-[999999] flex flex-col gap-2 max-w-md w-full px-4 pointer-events-none select-none"
        dir="rtl"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-center justify-between gap-3 px-4 py-3 rounded-2xl shadow-xl border text-xs font-bold transition-all animate-slideDown ${
              toast.type === 'success'
                ? 'bg-emerald-600 text-white border-emerald-500 shadow-emerald-600/25'
                : toast.type === 'error'
                ? 'bg-rose-600 text-white border-rose-500 shadow-rose-600/25'
                : toast.type === 'warning'
                ? 'bg-amber-600 text-white border-amber-500 shadow-amber-600/25'
                : 'bg-slate-900 text-white border-slate-800 shadow-slate-900/30'
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {toast.type === 'success' && <CheckCircle2 size={18} className="shrink-0 text-emerald-200" />}
              {toast.type === 'error' && <XCircle size={18} className="shrink-0 text-rose-200" />}
              {toast.type === 'warning' && <AlertTriangle size={18} className="shrink-0 text-amber-200" />}
              {toast.type === 'info' && <Info size={18} className="shrink-0 text-sky-200" />}
              <span className="truncate leading-snug">{toast.message}</span>
            </div>
            <button
              type="button"
              onClick={() => removeToast(toast.id)}
              className="p-1 text-white/80 hover:text-white rounded-lg transition-colors shrink-0 cursor-pointer"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </DialogContext.Provider>
  );
}

export function useDialog() {
  const context = useContext(DialogContext);
  if (!context) {
    throw new Error('useDialog must be used within a DialogProvider');
  }
  return context;
}

