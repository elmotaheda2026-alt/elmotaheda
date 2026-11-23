import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, ServerOff, Settings, Wifi } from 'lucide-react';
import CompanyLogo from './CompanyLogo';
import { emitApiHealth, isApiMode, probeBackendHealth, resolveApiBaseUrl } from '../lib/apiClient';
import { startRealtimeSync, stopRealtimeSync } from '../lib/realtimeSync';
import { useAuth } from '../context/AuthContext';

export default function ServerOfflineOverlay() {
  const { settings } = useAuth();
  const [isOffline, setIsOffline] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [countdown, setCountdown] = useState(5);
  const [serverUrl, setServerUrl] = useState(() => resolveApiBaseUrl());

  const isOfflineRef = useRef(false);
  const inFlightRef = useRef(false);
  const lastFailureProbeRef = useRef(0);
  const mountedAtRef = useRef(Date.now());

  const markConnected = useCallback(() => {
    const wasOffline = isOfflineRef.current;
    isOfflineRef.current = false;
    setIsOffline(false);
    setIsChecking(false);
    emitApiHealth(true);

    if (wasOffline && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('server-reconnected'));
      startRealtimeSync();
      window.setTimeout(() => {
        ['settings', 'customers', 'sales', 'payments'].forEach((entity) => {
          window.dispatchEvent(new CustomEvent('erp:data-changed', { detail: { entity, action: 'reconnect' } }));
        });
      }, 300);
    }
  }, []);

    const verifyConnection = useCallback(async (options?: { manual?: boolean; confirmBeforeShowing?: boolean }) => {
      if (!isApiMode()) return;
      if (typeof window !== 'undefined' && window.location.hash.includes('/onboarding')) {
        isOfflineRef.current = false;
        setIsOffline(false);
        return;
      }
      if (inFlightRef.current) return;

      inFlightRef.current = true;
      setIsChecking(true);

          try {
            const currentUrl = resolveApiBaseUrl();
            setServerUrl(currentUrl);

            let ok = await probeBackendHealth(currentUrl, 2500);
            if (!ok && !isOfflineRef.current && options?.confirmBeforeShowing) {
              await new Promise((r) => setTimeout(r, 1000));
              ok = await probeBackendHealth(currentUrl, 2500);
            }

            if (ok) {
              markConnected();
            } else if (options?.manual || isOfflineRef.current || options?.confirmBeforeShowing) {
              isOfflineRef.current = true;
              setIsOffline(true);
              setCountdown(5);
              stopRealtimeSync();
            }
          } finally {
            inFlightRef.current = false;
            setIsChecking(false);
          }
        }, [markConnected]);

    useEffect(() => {
      if (!isApiMode()) return;

      const handleHealthEvent = (event: Event) => {
        const healthy = (event as CustomEvent<boolean>).detail;
        if (healthy === true) {
          markConnected();
          return;
        }
        if (healthy === false) {
          if (isOfflineRef.current || inFlightRef.current) return;

          const currentUrl = resolveApiBaseUrl();
          const isLocal = currentUrl.includes('localhost') || currentUrl.includes('127.0.0.1');
          if (isLocal && Date.now() - mountedAtRef.current < 4000) return;
          if (Date.now() - lastFailureProbeRef.current < 2000) return;

          lastFailureProbeRef.current = Date.now();
          void verifyConnection({ confirmBeforeShowing: true });
        }
      };

      const handleBrowserOffline = () => {
        if (isOfflineRef.current || inFlightRef.current) return;
        void verifyConnection({ confirmBeforeShowing: true });
      };

      const handleBrowserOnline = () => {
        void verifyConnection({ manual: false });
      };

      const handleHashChange = () => {
        if (typeof window !== 'undefined' && window.location.hash.includes('/onboarding')) {
          isOfflineRef.current = false;
          setIsOffline(false);
        }
      };

      window.addEventListener('api-health-change', handleHealthEvent);
      window.addEventListener('offline', handleBrowserOffline);
      window.addEventListener('online', handleBrowserOnline);
      window.addEventListener('hashchange', handleHashChange);

      // Delayed startup check only for remote client URLs (non-localhost) not in onboarding
      const initialUrl = resolveApiBaseUrl();
      const isRemote = !initialUrl.includes('localhost') && !initialUrl.includes('127.0.0.1');
      let startupTimer: number | null = null;
      if (isRemote && !window.location.hash.includes('/onboarding')) {
        startupTimer = window.setTimeout(() => {
          if (!isOfflineRef.current && !inFlightRef.current) {
            void verifyConnection({ confirmBeforeShowing: true });
          }
        }, 4500);
      }

      return () => {
        if (startupTimer) window.clearTimeout(startupTimer);
        window.removeEventListener('api-health-change', handleHealthEvent);
        window.removeEventListener('offline', handleBrowserOffline);
        window.removeEventListener('online', handleBrowserOnline);
        window.removeEventListener('hashchange', handleHashChange);
      };
    }, [markConnected, verifyConnection]);

    // Auto-reconnect loop while offline
    useEffect(() => {
      if (!isOffline) return;

      const timer = window.setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            if (!inFlightRef.current) {
              void verifyConnection({ manual: false });
            }
            return 5;
          }
          return prev - 1;
        });
      }, 1000);

      return () => window.clearInterval(timer);
    }, [isOffline, verifyConnection]);

    if (!isOffline) return null;

    const companyTitle =
      settings?.companyName && settings.companyName !== 'شركة المتحدة'
        ? settings.companyName
        : 'شركة المتحدة للتجارة والتوريدات';

    return (
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center p-6 select-none bg-gradient-to-br from-slate-50 via-blue-50/40 to-slate-100"
        dir="rtl"
      >
        <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full bg-blue-500/5 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-96 h-96 rounded-full bg-emerald-500/5 blur-3xl pointer-events-none" />

        <div className="relative w-full max-w-sm rounded-2xl bg-white border border-slate-200 shadow-xl p-7 text-center text-slate-900 space-y-5">
          <div className="flex flex-col items-center gap-3">
            <CompanyLogo size={68} theme="light" />
            <h1 className="text-base font-black text-slate-900 tracking-tight">{companyTitle}</h1>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold">
              <ServerOff size={13} />
              <span>الجهاز الرئيسي غير متصل</span>
            </div>
          </div>

          <div className="space-y-2.5">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-slate-50 border border-slate-200 text-[11px] font-mono text-slate-600 dir-ltr">
              <Wifi size={12} className="text-slate-400" />
              <span>{serverUrl}</span>
            </div>
            <div className="flex items-center justify-center gap-2 text-xs font-semibold text-slate-500">
              <span className="w-1.5 h-1.5 rounded-full bg-[#1e40af] animate-ping" />
              <span>
                {isChecking ? 'جاري الاتصال...' : `إعادة المحاولة خلال ${countdown} ثوانٍ`}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 pt-1">
            <button
              type="button"
              onClick={() => void verifyConnection({ manual: true })}
              disabled={isChecking}
              className="flex-1 flex items-center justify-center gap-2 bg-[#1e40af] hover:bg-[#1d4ed8] text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-colors shadow-sm cursor-pointer disabled:opacity-60"
            >
              <RefreshCw size={14} className={isChecking ? 'animate-spin' : ''} />
              <span>{isChecking ? 'جاري الاتصال...' : 'إعادة الاتصال'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                isOfflineRef.current = false;
                setIsOffline(false);
                window.location.hash = '#/onboarding';
              }}
              className="flex items-center justify-center gap-1.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 px-3.5 py-2.5 rounded-xl text-xs font-bold transition-colors cursor-pointer"
            >
              <Settings size={14} className="text-slate-500" />
              <span>السيرفر</span>
            </button>
          </div>
        </div>
      </div>
    );
  }
