import React, { useState } from 'react';
import { Network, RefreshCw, Server, CheckCircle2, XCircle, Wifi } from 'lucide-react';

interface Props {
  currentUrl: string;
  onConnect: (targetUrl: string) => void;
  onScanLAN: () => Promise<string | null>;
}

export function ServerConnectionModal({ currentUrl, onConnect, onScanLAN }: Props) {
  const [inputUrl, setInputUrl] = useState(currentUrl || 'http://192.168.1.50:4000');
  const [scanning, setScanning] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'failed'>('idle');
  const [message, setMessage] = useState('');

  const handleScan = async () => {
    setScanning(true);
    setStatus('idle');
    setMessage('جاري البحث عن السيرفر في الشبكة المحلية (LAN)...');
    try {
      const foundUrl = await onScanLAN();
      if (foundUrl) {
        setInputUrl(foundUrl);
        setStatus('success');
        setMessage(`تم اكتشاف السيرفر بنجاح: ${foundUrl}`);
        setTimeout(() => {
          onConnect(foundUrl);
        }, 1200);
      } else {
        setStatus('failed');
        setMessage('تعذر العثور على السيرفر تلقائياً. يرجى إدخال عنوان IP السيرفر يدوياً.');
      }
    } catch {
      setStatus('failed');
      setMessage('حدث خطأ أثناء فحص الشبكة.');
    } finally {
      setScanning(false);
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let url = inputUrl.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `http://${url}`;
    }
    onConnect(url);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/90 backdrop-blur-md flex items-center justify-center z-50 p-4 dir-rtl" dir="rtl">
      <div className="bg-slate-800 border border-slate-700 rounded-3xl max-w-md w-full p-6 md:p-8 shadow-2xl space-y-6 text-slate-100">
        <div className="text-center space-y-2">
          <div className="w-16 h-16 bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 rounded-2xl flex items-center justify-center mx-auto">
            <Server size={32} />
          </div>
          <h2 className="text-xl font-bold text-white">ربط السيرفر في الشبكة المحلية</h2>
          <p className="text-xs text-slate-400">
            تعذر الاتصال بالسيرفر الحالي. يرجى البحث في الشبكة أو إدخال عنوان السيرفر.
          </p>
        </div>

        {/* Status Indicator */}
        <div className="flex items-center justify-between bg-slate-900/80 p-3.5 rounded-2xl border border-slate-700/80 text-xs">
          <span className="text-slate-300 font-medium">حالة الاتصال:</span>
          {status === 'success' ? (
            <span className="flex items-center gap-1.5 text-emerald-400 font-bold">
              <CheckCircle2 size={16} />
              🟢 متصل بالسيرفر
            </span>
          ) : status === 'failed' ? (
            <span className="flex items-center gap-1.5 text-rose-400 font-bold">
              <XCircle size={16} />
              🔴 تعذر الاتصال بالسيرفر
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-amber-400 font-medium">
              <Wifi size={16} />
              🟡 غير متصل
            </span>
          )}
        </div>

        {message && (
          <p className={`text-xs text-center leading-relaxed ${status === 'failed' ? 'text-rose-400' : 'text-emerald-400'}`}>
            {message}
          </p>
        )}

        {/* Auto Scan Button */}
        <button
          type="button"
          onClick={handleScan}
          disabled={scanning}
          className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3.5 rounded-2xl transition-colors text-sm disabled:opacity-50"
        >
          <RefreshCw size={18} className={scanning ? 'animate-spin' : ''} />
          <span>{scanning ? 'جاري الفحص السريع للشبكة...' : 'إعادة البحث عن السيرفر في الشبكة (LAN)'}</span>
        </button>

        {/* Manual IP Input Form */}
        <form onSubmit={handleManualSubmit} className="space-y-4 pt-2 border-t border-slate-700/60">
          <div>
            <label className="block text-xs font-semibold mb-1 text-slate-300">
              عنوان IP السيرفر اليدوي (مثال: 192.168.1.50:4000)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                required
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white dir-ltr text-left focus:outline-none focus:border-indigo-500 font-mono"
                placeholder="192.168.1.50:4000"
              />
              <button
                type="submit"
                className="bg-slate-700 hover:bg-slate-600 text-white font-semibold px-4 py-2.5 rounded-xl text-xs transition-colors"
              >
                ربط
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
