import React, { useEffect, useState } from 'react';
import { Download, RefreshCw, X } from 'lucide-react';

interface UpdaterStatusPayload {
  status: 'checking' | 'available' | 'up-to-date' | 'downloading' | 'downloaded' | 'error';
  version?: string;
  percent?: number;
  message?: string;
}

interface ElectronUpdaterBridge {
  getUpdaterStatus?: () => Promise<UpdaterStatusPayload | null>;
  onUpdaterStatus?: (cb: (data: UpdaterStatusPayload) => void) => () => void;
  installUpdate?: () => Promise<{ ok?: boolean }>;
}

export default function UpdateBanner() {
  const [updateState, setUpdateState] = useState<UpdaterStatusPayload | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const api = (window as unknown as { electronAPI?: ElectronUpdaterBridge }).electronAPI;
    if (!api?.onUpdaterStatus) return;

    if (api.getUpdaterStatus) {
      void api.getUpdaterStatus().then((last) => {
        if (last && (last.status === 'available' || last.status === 'downloading' || last.status === 'downloaded')) {
          setUpdateState(last);
        }
      }).catch(() => {});
    }

    const unsubscribe = api.onUpdaterStatus((payload) => {
      if (payload.status === 'available' || payload.status === 'downloading' || payload.status === 'downloaded' || payload.status === 'error') {
        setDismissed(false);
        setUpdateState(payload);
      } else if (payload.status === 'up-to-date') {
        setUpdateState(null);
      }
    });

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  if (dismissed || !updateState) return null;

  const handleInstall = async () => {
    const api = (window as unknown as { electronAPI?: ElectronUpdaterBridge }).electronAPI;
    if (api?.installUpdate) {
      await api.installUpdate();
    }
  };

  return (
    <div className="print:hidden bg-gradient-to-l from-blue-700 to-indigo-700 text-white px-4 py-2 text-xs font-bold flex items-center justify-between gap-3 shrink-0 shadow-sm">
      <div className="flex items-center gap-2 min-w-0">
        {updateState.status === 'downloaded' ? (
          <RefreshCw size={15} className="shrink-0 text-emerald-300" />
        ) : (
          <Download size={15} className="shrink-0 animate-bounce text-blue-200" />
        )}
        <span className="truncate">
          {updateState.status === 'downloaded'
            ? `تم تحميل التحديث الجديد${updateState.version ? ` (v${updateState.version})` : ''} — جاهز للتثبيت الآن`
            : updateState.status === 'downloading'
              ? `جاري تحميل التحديث الجديد... ${updateState.percent ?? 0}%`
              : updateState.status === 'error'
                ? `تعذر فحص/تحميل التحديث: ${updateState.message || 'خطأ في الاتصال'}`
                : `يتوفر تحديث جديد للنظام${updateState.version ? ` (v${updateState.version})` : ''} — جاري التحميل...`}
        </span>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {updateState.status === 'downloaded' && (
          <button
            type="button"
            onClick={handleInstall}
            className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black px-3 py-1 rounded-lg transition-colors shadow-xs active:scale-95"
          >
            تحديث وإعادة تشغيل
          </button>
        )}
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="p-1 text-white/75 hover:text-white rounded-md hover:bg-white/10 transition-colors"
          title="إخفاء"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
