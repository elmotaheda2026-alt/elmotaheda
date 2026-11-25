import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Save,
  Building,
  Trash2,
  Download,
  Upload,
  Landmark,
  CheckCircle2,
  Wifi,
  WifiOff,
  Copy,
  Server,
  Monitor,
  RefreshCw,
  AlertCircle,
  Clock,
  Folder,
  Play,
  Search,
  ExternalLink,
  RotateCcw,
  QrCode,
} from 'lucide-react';
import QRCode from 'qrcode';
import { useAuth } from '../context/AuthContext';
import { useDialog } from '../context/DialogContext';
import RolePermissionsManager from '../components/RolePermissionsManager';
import { Setting, OpeningBalances } from '../types';
import {
  clearAllData,
  downloadDatabaseBackup,
  restoreDatabaseBackup,
  getOpeningBalances,
  saveOpeningBalances,
} from '../lib/storage';
import {
  api,
  isApiMode,
  API_BASE,
  getApiToken,
  setServerApiUrl,
  clearServerApiUrl,
  getServerApiUrl,
  testServerUrl,
} from '../lib/apiClient';
import { hasPermission, isAdmin } from '../lib/permissions';
import { scanLanForServer } from '../lib/lanDiscovery';
import DocumentTemplatesManager from '../components/DocumentTemplatesManager';
import WhatsappControlCenter from '../components/WhatsappControlCenter';
import TelegramNotificationsManager from '../components/TelegramNotificationsManager';
import PaymentChannelsManager from '../components/PaymentChannelsManager';

async function fetchNetworkInfo(retries = 2, delayMs = 600) {
  const currentBase = getServerApiUrl();
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      let res = await fetch(`${currentBase}/system/network-info`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) {
        res = await fetch(`${currentBase}/api/system/network-info`, { signal: AbortSignal.timeout(3000) });
      }
      if (res.ok) {
        return (await res.json()) as {
          ok: boolean;
          mode?: 'server' | 'client';
          localIp: string;
          hostname: string;
          frontendUrl?: string;
          apiUrl?: string;
          dbConfig?: { mode?: string; host?: string; db?: { host: string; port: number; database: string } };
        };
      }
    } catch (e) {
      if (attempt === retries) throw e;
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error('Could not fetch network info');
}

async function saveDbConfig(payload: {
  host: string;
  port: number;
  database: string;
  mode: 'server' | 'client';
}) {
  const currentBase = getServerApiUrl();
  const token = getApiToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res = await fetch(`${currentBase}/system/db-config`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (res.status === 404) {
    res = await fetch(`${currentBase}/api/system/db-config`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message || `HTTP ${res.status}`);
  }
  return res.json();
}

async function testConnection(ip: string) {
  try {
    const res = await fetch(`http://${ip}:4000/health`, { signal: AbortSignal.timeout(4000) });
    if (res.ok) return true;
  } catch {
    // Fallback to /api/health
  }
  try {
    const res2 = await fetch(`http://${ip}:4000/api/health`, { signal: AbortSignal.timeout(4000) });
    return res2.ok;
  } catch {
    return false;
  }
}

export default function Settings() {
  const { settings, updateSettings, user } = useAuth();
  const { confirmDialog, showToast } = useDialog();
  const [formData, setFormData] = useState<Setting>(settings);
  useEffect(() => {
    setFormData(settings);
  }, [settings]);
  const [saved, setSaved] = useState(false);
  const [companyCollapsed, setCompanyCollapsed] = useState<boolean>(() => Boolean(settings?.companyName));
  const [backupBusy, setBackupBusy] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const backupInputRef = useRef<HTMLInputElement | null>(null);

  const [obData, setObData] = useState<Omit<OpeningBalances, 'updatedAt'>>(() => {
    const ob = getOpeningBalances();
    return {
      startingCashBalance: ob.startingCashBalance,
      startingReceivables: ob.startingReceivables,
      startingPayables: ob.startingPayables,
      startingInventoryValue: ob.startingInventoryValue,
    };
  });
  const [obSaved, setObSaved] = useState(false);
  const [obLoading, setObLoading] = useState(false);
  const [obSubmitting, setObSubmitting] = useState(false);

  const loadOpeningBalances = async () => {
    setObLoading(true);
    try {
      if (isApiMode()) {
        const backendOb = await api.getOpeningBalances();
        if (backendOb) {
          setObData({
            startingCashBalance: Number(backendOb.startingCashBalance || 0),
            startingReceivables: Number(backendOb.startingReceivables || 0),
            startingPayables: Number(backendOb.startingPayables || 0),
            startingInventoryValue: Number(backendOb.startingInventoryValue || 0),
          });
        }
      }
    } catch (e) {
      console.error('Failed to load opening balances in Settings:', e);
    } finally {
      setObLoading(false);
    }
  };

  const [searchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab') as 'company' | 'channels' | 'documents' | 'network' | 'backup' | 'balances' | 'whatsapp' | 'telegram' | 'roles' | 'danger' | null;
  const [activeTab, setActiveTab] = useState<'company' | 'channels' | 'documents' | 'network' | 'backup' | 'balances' | 'whatsapp' | 'telegram' | 'roles' | 'danger'>(() => {
    if (requestedTab && ['company', 'channels', 'documents', 'network', 'backup', 'balances', 'whatsapp', 'telegram', 'roles', 'danger'].includes(requestedTab)) {
      return requestedTab;
    }
    return 'company';
  });

  useEffect(() => {
    if (requestedTab && ['company', 'channels', 'documents', 'network', 'backup', 'balances', 'whatsapp', 'telegram', 'roles', 'danger'].includes(requestedTab)) {
      setActiveTab(requestedTab);
    }
  }, [requestedTab]);

  useEffect(() => {
    if (activeTab === 'balances') {
      void loadOpeningBalances();
    }
  }, [activeTab]);
  const [networkInfo, setNetworkInfo] = useState<{
    localIp: string;
    hostname: string;
    frontendUrl?: string;
    apiUrl?: string;
  } | null>(null);
  const [networkLoading, setNetworkLoading] = useState(false);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [machineMode, setMachineMode] = useState<'server' | 'client'>('server');
  const [allowModeSwitch, setAllowModeSwitch] = useState(false);
  const [clientIp, setClientIp] = useState(() => {
    const saved = localStorage.getItem('server_api_url');
    if (saved) return saved.replace(/^https?:\/\//, '').replace(/:4000$/, '');
    return '192.168.1.9';
  });
  const [connStatus, setConnStatus] = useState<'idle' | 'testing' | 'connected' | 'failed'>('idle');
  const [connSaved, setConnSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [showQrModal, setShowQrModal] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);

  interface AutoBackupSettings {
    enabled: boolean;
    destinationPath: string;
    frequency: 'daily' | 'twice_daily' | 'hourly';
    backupTime: string;
    retentionDays: number;
    lastBackupAt: string | null;
    lastBackupStatus: 'success' | 'failed' | null;
    lastBackupFileName: string | null;
  }

  const [autoBackupConfig, setAutoBackupConfig] = useState<AutoBackupSettings>({
    enabled: true,
    destinationPath: 'D:\\AlMuttahida_Backups',
    frequency: 'daily',
    backupTime: '23:00',
    retentionDays: 30,
    lastBackupAt: null,
    lastBackupStatus: null,
    lastBackupFileName: null,
  });
  const [autoBackupLoading, setAutoBackupLoading] = useState(false);
  const [autoBackupSaved, setAutoBackupSaved] = useState(false);
  const [obCollapsed, setObCollapsed] = useState<boolean>(() => localStorage.getItem('almuttahida_ob_collapsed') === '1');
  const [autoBackupCollapsed, setAutoBackupCollapsed] = useState<boolean>(() => localStorage.getItem('almuttahida_autobackup_collapsed') === '1');
  const [manualBackupRunning, setManualBackupRunning] = useState(false);
  const [manualBackupSuccessMsg, setManualBackupSuccessMsg] = useState<string | null>(null);

  const toggleObCollapsed = (collapsed: boolean) => {
    setObCollapsed(collapsed);
    if (collapsed) {
      localStorage.setItem('almuttahida_ob_collapsed', '1');
    } else {
      localStorage.removeItem('almuttahida_ob_collapsed');
    }
  };

  const toggleAutoBackupCollapsed = (collapsed: boolean) => {
    setAutoBackupCollapsed(collapsed);
    if (collapsed) {
      localStorage.setItem('almuttahida_autobackup_collapsed', '1');
    } else {
      localStorage.removeItem('almuttahida_autobackup_collapsed');
    }
  };

  const loadAutoBackupConfig = async () => {
    try {
      setAutoBackupLoading(true);
      const res = await api.getAutoBackupConfig();
      if (res) {
        setAutoBackupConfig({
          enabled: res.enabled ?? true,
          destinationPath: res.destinationPath || 'D:\\AlMuttahida_Backups',
          frequency: res.frequency || 'daily',
          backupTime: res.backupTime || '23:00',
          retentionDays: res.retentionDays || 30,
          lastBackupAt: res.lastBackupAt || null,
          lastBackupStatus: res.lastBackupStatus || null,
          lastBackupFileName: res.lastBackupFileName || null,
        });
      }
    } catch (e) {
      console.warn('Could not load auto backup config:', e);
    } finally {
      setAutoBackupLoading(false);
    }
  };

  const handleSaveAutoBackup = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    try {
      setAutoBackupLoading(true);
      const res = await api.updateAutoBackupConfig(autoBackupConfig);
      if (res?.config) {
        setAutoBackupConfig(res.config);
      }
      setAutoBackupSaved(true);
      setTimeout(() => setAutoBackupSaved(false), 3500);
      toggleAutoBackupCollapsed(true);
    } catch (err: any) {
      alert(err.message || 'تعذر حفظ إعدادات النسخ التلقائي.');
    } finally {
      setAutoBackupLoading(false);
    }
  };

  const handleBrowseFolder = async () => {
    try {
      const electronAPI = (window as any).electronAPI;
      if (electronAPI?.selectDirectory) {
        const selected = await electronAPI.selectDirectory();
        if (selected) {
          setAutoBackupConfig((prev) => ({ ...prev, destinationPath: selected }));
        }
      } else {
        const manual = prompt('أدخل مسار مجلد حفظ النسخ الاحتياطية:', autoBackupConfig.destinationPath);
        if (manual && manual.trim()) {
          setAutoBackupConfig((prev) => ({ ...prev, destinationPath: manual.trim() }));
        }
      }
    } catch (e: any) {
      console.warn('Folder selection error:', e);
    }
  };

  const handleRunAutoBackupNow = async () => {
    try {
      setManualBackupRunning(true);
      setManualBackupSuccessMsg(null);
      const res = await api.runAutoBackupNow();
      setManualBackupSuccessMsg(`تم إنشاء وحفظ النسخة الاحتياطية بنجاح: ${res.fileName}`);
      await loadAutoBackupConfig();
      setTimeout(() => setManualBackupSuccessMsg(null), 6000);
    } catch (err: any) {
      alert(err.message || 'فشل تشغيل النسخ الاحتياطي التلقائي.');
    } finally {
      setManualBackupRunning(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'backup') {
      void loadAutoBackupConfig();
    }
  }, [activeTab]);

  const loadNetworkInfo = async () => {
    setNetworkLoading(true);
    setNetworkError(null);
    try {
      const data = await fetchNetworkInfo();
      setNetworkInfo({
        localIp: data.localIp,
        hostname: data.hostname,
        frontendUrl: data.frontendUrl || `http://${data.localIp}:4000`,
        apiUrl: data.apiUrl || `http://${data.localIp}:4000`,
      });
      if (data.mode) {
        setMachineMode(data.mode);
      } else if (data.dbConfig?.mode) {
        setMachineMode(data.dbConfig.mode as 'server' | 'client');
      }
    } catch {
      const saved = localStorage.getItem('server_api_url');
      if (saved) {
        setMachineMode('client');
      }
    } finally {
      setNetworkLoading(false);
    }
  };

  const [appVersion, setAppVersion] = useState<string>('');
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateCheckMsg, setUpdateCheckMsg] = useState<string | null>(null);

  useEffect(() => {
    if (activeTab === 'network') {
      void loadNetworkInfo();
      const apiBridge = (window as any)?.electronAPI;
      if (apiBridge?.getAppVersion) {
        void apiBridge.getAppVersion().then((v: string) => setAppVersion(v || '')).catch(() => {});
      }
    }
  }, [activeTab]);

  const handleCheckForUpdates = async () => {
    const apiBridge = (window as any)?.electronAPI;
    if (!apiBridge?.checkForUpdates) {
      setUpdateCheckMsg('الفحص التلقائي متاح في تطبيق سطح المكتب المثبت (EXE) فقط.');
      return;
    }
    setCheckingUpdate(true);
    setUpdateCheckMsg(null);
    try {
      const isNewerVersion = (remote: string, current: string) => {
        const r = remote.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
        const c = current.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
        for (let i = 0; i < Math.max(r.length, c.length); i++) {
          const rv = r[i] || 0;
          const cv = c[i] || 0;
          if (rv > cv) return true;
          if (rv < cv) return false;
        }
        return false;
      };

      const res = await apiBridge.checkForUpdates();
      if (res?.error) {
        const errText = String(res.error);
        const isOfflineErr = /ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ENOTFOUND/i.test(errText);
        setUpdateCheckMsg(isOfflineErr ? 'تعذر الفحص: لا يوجد اتصال بالإنترنت حالياً.' : `تعذر الفحص: ${errText}`);
      } else if (res?.supported === false) {
        setUpdateCheckMsg(res?.message || 'الفحص التلقائي يعمل في النسخة المثبتة فقط');
      } else if (res?.version && appVersion && isNewerVersion(res.version, appVersion)) {
        setUpdateCheckMsg(`يتوفر إصدار أحدث (${res.version}) — جاري التحميل في الخلفية...`);
      } else {
        setUpdateCheckMsg(`النظام محدّث على آخر إصدار (v${appVersion || res?.version || 'الحالي'}).`);
      }
    } catch (err: any) {
      setUpdateCheckMsg(err?.message || 'حدث خطأ أثناء فحص التحديثات');
    } finally {
      setCheckingUpdate(false);
    }
  };

  const browserLanUrl =
    networkInfo?.frontendUrl || `http://${networkInfo?.localIp || 'localhost'}:4000`;

  useEffect(() => {
    let cancelled = false;
    if (activeTab !== 'network' || !browserLanUrl) return;
    QRCode.toDataURL(browserLanUrl, {
      width: 240,
      margin: 1,
      color: { dark: '#0f1f4a', light: '#ffffff' },
    })
      .then((dataUrl) => {
        if (!cancelled) setQrDataUrl(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl('');
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, browserLanUrl]);

  const handleCopyIp = () => {
    if (!networkInfo) return;
    navigator.clipboard.writeText(networkInfo.localIp).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleCopyUrl = () => {
    const url = networkInfo?.frontendUrl || `http://${networkInfo?.localIp || 'localhost'}:4000`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    });
  };

  const handleSaveModeServer = async () => {
    setNetworkLoading(true);
    setNetworkError(null);
    try {
      clearServerApiUrl();
      await saveDbConfig({ host: '127.0.0.1', port: 1433, database: 'AlMuttahida_New', mode: 'server' });
      setMachineMode('server');
      setConnSaved(true);
      setTimeout(() => setConnSaved(false), 3000);
      showToast('تم حفظ وضع الجهاز الرئيسي بنجاح', 'success');
      void loadNetworkInfo();
    } catch (err: any) {
      const msg = err?.message || 'تعذر حفظ الإعدادات';
      setNetworkError(msg);
      showToast(msg, 'error');
    } finally {
      setNetworkLoading(false);
    }
  };

  const handleTestAndSaveClient = async () => {
    if (!clientIp.trim()) return;
    setConnStatus('testing');
    setNetworkError(null);
    try {
      const testRes = await testServerUrl(clientIp);
      if (!testRes.ok) throw new Error(testRes.message || 'connection failed');
      setServerApiUrl(clientIp);
      await saveDbConfig({ host: clientIp.trim(), port: 1433, database: 'AlMuttahida_New', mode: 'client' });
      setConnStatus('connected');
      setConnSaved(true);
      showToast('تم ربط الجهاز الفرعي بالخادم الرئيسي وحفظ الإعدادات بنجاح', 'success');
      setTimeout(() => setConnSaved(false), 4000);
    } catch (e: any) {
      setConnStatus('failed');
      setNetworkError('فشل الاتصال أو الحفظ على: ' + clientIp + (e?.message ? ` (${e.message})` : '') + ' — تأكد أن السيرفر قيد التشغيل على الجهاز الرئيسي.');
      setTimeout(() => setConnStatus('idle'), 6000);
    }
  };

  const handleAutoScan = async () => {
    setScanLoading(true);
    setNetworkError(null);
    setConnStatus('testing');
    try {
      const discoveredUrl = await scanLanForServer();
      if (discoveredUrl) {
        const cleanHost = discoveredUrl.replace(/^https?:\/\//, '').replace(/:4000$/, '');
        setClientIp(cleanHost);
        setServerApiUrl(discoveredUrl);
        setConnStatus('connected');
        setConnSaved(true);
        setTimeout(() => setConnSaved(false), 4000);
      } else {
        setConnStatus('failed');
        setNetworkError('لم يتم العثور على سيرفر نشط في الشبكة المحلية تلقائياً. تأكد من تشغيل السيرفر على الجهاز الرئيسي ثم ادخل رقم الـ IP يدوياً.');
        setTimeout(() => setConnStatus('idle'), 5000);
      }
    } catch (e: any) {
      setConnStatus('failed');
      setNetworkError('حدث خطأ أثناء فحص الشبكة: ' + e.message);
    } finally {
      setScanLoading(false);
    }
  };

  const handleResetToLocalhost = () => {
    clearServerApiUrl();
    window.location.reload();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const updated = { ...formData };
    try {
      await updateSettings(updated);
      setFormData(updated);
      setSaved(true);
      setCompanyCollapsed(true);
      showToast('تم حفظ إعدادات النظام بنجاح', 'success');
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      showToast(err?.message || 'تعذر حفظ الإعدادات. يرجى التحقق من الصلاحيات واتصال الخادم.', 'error');
    }
  };

  const handleObSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setObSubmitting(true);
    try {
      if (isApiMode()) {
        await api.updateOpeningBalances(obData);
      }
      saveOpeningBalances(obData);

      setObSaved(true);
      showToast('تم حفظ الأرصدة الافتتاحية بنجاح', 'success');
      setTimeout(() => setObSaved(false), 4000);
      toggleObCollapsed(true);
    } catch (err: any) {
      console.error('Failed to save opening balances:', err);
      window.alert(err?.message || 'حدث خطأ أثناء حفظ الأرصدة الافتتاحية');
    } finally {
      setObSubmitting(false);
    }
  };

  const handleExportBackup = async () => {
    try {
      setBackupBusy(true);
      await downloadDatabaseBackup();
    } catch (err: any) {
      alert(err.message || 'تعذر تصدير النسخة الاحتياطية.');
    } finally {
      setBackupBusy(false);
    }
  };

  const handleImportBackup = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const isConfirmed = await confirmDialog({
      title: 'استيراد نسخة احتياطية',
      message: 'استيراد النسخة الاحتياطية سيستبدل بيانات النظام الحالية بالكامل.',
      subMessage: 'هل تريد المتابعة واستبدال البيانات الحالية؟',
      confirmText: 'نعم، استيراد واستبدال',
      cancelText: 'إلغاء',
      type: 'warning',
    });
    if (!isConfirmed) return;

    const reader = new FileReader();
    reader.onload = async () => {
      setBackupBusy(true);
      try {
        await restoreDatabaseBackup(String(reader.result || ''));
        showToast('تم استيراد النسخة الاحتياطية بنجاح. ستتم إعادة تحميل النظام.', 'success');
        setTimeout(() => window.location.reload(), 1500);
      } catch (err: any) {
        showToast(err.message || 'تعذر استيراد ملف النسخة الاحتياطية.', 'error');
      } finally {
        setBackupBusy(false);
      }
    };
    reader.onerror = () => {
      setBackupBusy(false);
      showToast('تعذر قراءة ملف النسخة الاحتياطية.', 'error');
    };
    reader.readAsText(file);
  };

  const handleClearData = async () => {
    try {
      await clearAllData();
      setShowDeleteConfirm(false);
      window.location.reload();
    } catch (err: any) {
      alert(err.message || 'تعذر مسح البيانات.');
    }
  };

  const tabs = [
    { key: 'company' as const, label: 'معلومات الشركة' },
    { key: 'backup' as const, label: 'النسخ الاحتياطي' },
    { key: 'channels' as const, label: 'قنوات الدفع والخزائن' },
    { key: 'whatsapp' as const, label: 'رسائل الواتساب' },
    { key: 'telegram' as const, label: 'إشعارات تليجرام' },
    { key: 'network' as const, label: 'اعدادات الشبكة' },
    { key: 'documents' as const, label: 'قوالب المستندات' },
    ...(user?.role === 'admin' ? [{ key: 'roles' as const, label: 'صلاحيات الأدوار' }] : []),
    { key: 'balances' as const, label: 'الارصدة الافتتاحية' },
    { key: 'danger' as const, label: 'منطقة الخطر' },
  ];

  return (
    <div className="space-y-4" dir="rtl">
      <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
        <h2 className="text-xl font-black text-slate-900">الاعدادات</h2>
        <p className="text-slate-500 text-sm mt-0.5">ادارة اعدادات النظام والاتصال بالشبكة</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="flex border-b border-slate-100 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`flex-shrink-0 px-5 py-3 text-sm font-bold transition-colors ${
                activeTab === tab.key
                  ? 'border-b-2 border-blue-600 text-blue-700 bg-blue-50/50'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'company' && (
          <div className="p-6">
            <div className="border border-slate-200 rounded-xl p-5 space-y-4 bg-slate-50/60">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
                    <Building size={19} />
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-800 text-sm">معلومات الشركة ({formData.companyName || 'غير محدد'})</h4>
                    <p className="text-xs text-slate-500">
                      {formData.companyAddress || 'اسم الشركة، العنوان، الهاتف، والعملة المستخدمة في الفواتير والمستندات.'}
                    </p>
                  </div>
                </div>

                {companyCollapsed && (
                  <div className="flex items-center gap-2 self-start sm:self-auto">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold">
                      <CheckCircle2 size={14} />
                      <span>مفعّل ومحفوظ</span>
                    </span>
                    {hasPermission(user, 'settings:manage') && (
                      <button
                        type="button"
                        onClick={() => setCompanyCollapsed(false)}
                        className="px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-bold shadow-xs transition-colors cursor-pointer"
                      >
                        تعديل الإعدادات
                      </button>
                    )}
                  </div>
                )}
              </div>

              {!companyCollapsed && (
                <form onSubmit={handleSubmit} className="space-y-5 pt-1">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">اسم الشركة</label>
                      <input
                        type="text"
                        value={formData.companyName}
                        onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                        className="input-ui w-full bg-white"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">عنوان الشركة</label>
                      <input
                        type="text"
                        value={formData.companyAddress}
                        onChange={(e) => setFormData({ ...formData, companyAddress: e.target.value })}
                        className="input-ui w-full bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">رقم الهاتف</label>
                      <input
                        type="text"
                        value={(formData as any).companyPhone ?? ''}
                        onChange={(e) => setFormData({ ...formData, companyPhone: e.target.value } as any)}
                        className="input-ui w-full bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">العملة</label>
                      <select
                        value={formData.currency || 'جنيه'}
                        onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                        className="input-ui w-full bg-white"
                      >
                        <option value="جنيه">جنيه مصري (جنيه)</option>
                        <option value="EGP">جنيه مصري (EGP)</option>
                        <option value="USD">دولار امريكي (USD)</option>
                        <option value="SAR">ريال سعودي (SAR)</option>
                        <option value="AED">درهم اماراتي (AED)</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 pt-2">
                    {hasPermission(user, 'settings:manage') ? (
                      <>
                        <button
                          type="submit"
                          className="flex items-center gap-2 bg-[#1e40af] text-white px-6 py-2.5 rounded-lg hover:bg-[#1d4ed8] transition-colors font-bold text-sm shadow-2xs cursor-pointer"
                        >
                          <Save size={16} />
                          حفظ الاعدادات
                        </button>
                        <button
                          type="button"
                          onClick={() => setCompanyCollapsed(true)}
                          className="px-4 py-2.5 rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-bold cursor-pointer"
                        >
                          إلغاء
                        </button>
                      </>
                    ) : (
                      <span className="text-xs font-bold text-amber-700 bg-amber-50 px-3.5 py-2 rounded-lg border border-amber-200">
                        وضع العرض فقط (ليس لديك صلاحية تعديل الإعدادات)
                      </span>
                    )}
                    {saved && (
                      <span className="flex items-center gap-1 text-emerald-600 font-bold text-sm">
                        <CheckCircle2 size={16} />
                        تم الحفظ بنجاح
                      </span>
                    )}
                  </div>
                </form>
              )}
            </div>
          </div>
        )}

        {activeTab === 'network' && (
          <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Wifi size={18} className="text-blue-600" />
                <h3 className="font-bold text-slate-800">اعدادات الشبكة وربط الأجهزة</h3>
              </div>
              <button
                type="button"
                onClick={() => void loadNetworkInfo()}
                disabled={networkLoading}
                className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-blue-600 px-3 py-1.5 rounded-lg border border-slate-200 hover:border-blue-300 transition-colors cursor-pointer"
              >
                <RefreshCw size={13} className={networkLoading ? 'animate-spin text-blue-600' : ''} />
                تحديث معلومات الشبكة
              </button>
            </div>

            {networkError && (
              <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-xs font-bold">
                <AlertCircle size={16} className="text-amber-600 shrink-0" />
                <span>{networkError}</span>
              </div>
            )}

            {/* Mode Status (Read-Only by default) or Selection Cards (when unlocked) */}
            {!allowModeSwitch ? (
              <div className={`flex flex-wrap items-center justify-between gap-4 p-5 rounded-2xl border-2 ${
                machineMode === 'server'
                  ? 'border-blue-200 bg-blue-50/50'
                  : 'border-indigo-200 bg-indigo-50/50'
              }`}>
                <div className="flex items-start gap-3.5">
                  <div className={`p-3 rounded-xl shrink-0 ${
                    machineMode === 'server' ? 'bg-[#1e40af] text-white' : 'bg-[#1e40af] text-white'
                  }`}>
                    {machineMode === 'server' ? <Server size={22} /> : <Monitor size={22} />}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-black text-base text-slate-800">
                        {machineMode === 'server' ? 'جهاز رئيسي (Server)' : 'جهاز فرعي (Client)'}
                      </span>
                      <span className={`text-[11px] font-black px-2.5 py-0.5 rounded-full border ${
                        machineMode === 'server'
                          ? 'text-blue-700 bg-blue-100 border-blue-200'
                          : 'text-indigo-700 bg-indigo-100 border-indigo-200'
                      }`}>
                        الوضع النشط
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500 leading-relaxed font-semibold">
                      {machineMode === 'server'
                        ? 'الجهاز الأساسي الذي يحمل قاعدة البيانات ومحرك النظام. تشارك منه الرابط لبقية الأجهزة في المكتب.'
                        : 'جهاز فرعي يتصل بالجهاز الرئيسي عبر الشبكة لحفظ واستعراض الفواتير والبيانات.'}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={async () => {
                    const ok = await confirmDialog({
                      title: 'تغيير وضع الجهاز (إعداد متقدم)',
                      message: 'يتم تحديد وضع الجهاز (رئيسي أو فرعي) أثناء التثبيت الأولي للنظام.',
                      subMessage: 'تغيير هذا الوضع قد يقطع الاتصال بقاعدة البيانات إذا تم عن طريق الخطأ. هل تريد فتح خيارات التبديل؟',
                    });
                    if (ok) {
                      setAllowModeSwitch(true);
                    }
                  }}
                  className="text-xs font-bold text-slate-600 hover:text-slate-900 bg-white border border-slate-200 hover:border-slate-300 px-3.5 py-2 rounded-xl transition-all cursor-pointer shadow-2xs shrink-0"
                >
                  تغيير وضع الجهاز (متقدم)
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-xs">
                  <span className="font-bold text-amber-800">
                    وضع التعديل المتقدم مفتوح — اختر وضع الجهاز ثم قم بالتأكيد
                  </span>
                  <button
                    type="button"
                    onClick={() => setAllowModeSwitch(false)}
                    className="font-bold text-slate-600 hover:text-slate-900 bg-white border border-slate-200 px-3 py-1 rounded-lg cursor-pointer"
                  >
                    إلغاء / قفل التعديل
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <button
                    type="button"
                    onClick={() => setMachineMode('server')}
                    className={`flex flex-col items-start p-5 rounded-2xl border-2 transition-all cursor-pointer text-right ${
                      machineMode === 'server'
                        ? 'border-blue-600 bg-blue-50/60 shadow-sm'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full mb-3">
                      <div className={`p-2.5 rounded-xl ${machineMode === 'server' ? 'bg-[#1e40af] text-white' : 'bg-slate-100 text-slate-500'}`}>
                        <Server size={22} />
                      </div>
                      {machineMode === 'server' && (
                        <span className="text-xs font-black text-blue-700 bg-blue-100 border border-blue-200 px-2.5 py-0.5 rounded-full">
                          الوضع النشط
                        </span>
                      )}
                    </div>
                    <span className="font-black text-base text-slate-800">جهاز رئيسي (Server)</span>
                    <p className="mt-1 text-xs text-slate-500 leading-relaxed font-semibold">
                      الجهاز الأساسي الذي يحمل قاعدة البيانات ومحرك النظام. تشارك منه الرابط لبقية الأجهزة في المكتب.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setMachineMode('client')}
                    className={`flex flex-col items-start p-5 rounded-2xl border-2 transition-all cursor-pointer text-right ${
                      machineMode === 'client'
                        ? 'border-indigo-600 bg-indigo-50/60 shadow-sm'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full mb-3">
                      <div className={`p-2.5 rounded-xl ${machineMode === 'client' ? 'bg-[#1e40af] text-white' : 'bg-slate-100 text-slate-500'}`}>
                        <Monitor size={22} />
                      </div>
                      {machineMode === 'client' && (
                        <span className="text-xs font-black text-indigo-700 bg-indigo-100 border border-indigo-200 px-2.5 py-0.5 rounded-full">
                          الوضع النشط
                        </span>
                      )}
                    </div>
                    <span className="font-black text-base text-slate-800">جهاز فرعي (Client)</span>
                    <p className="mt-1 text-xs text-slate-500 leading-relaxed font-semibold">
                      جهاز كمبيوتر آخر أو لابتوب في المكتب يتصل بالجهاز الرئيسي عبر الشبكة لحفظ واستعراض الفواتير والبيانات.
                    </p>
                  </button>
                </div>
              </div>
            )}

            {/* SERVER MODE DETAILS */}
            {machineMode === 'server' && (
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 space-y-5">
                <div className="flex items-center gap-2 pb-3 border-b border-slate-200">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                  <p className="text-sm font-black text-slate-800">
                    هذا الجهاز يعمل كخادم رئيسي (Server)
                  </p>
                  {networkInfo?.hostname && (
                    <span className="mr-auto text-xs text-slate-400 font-bold">
                      اسم الجهاز: <strong className="text-slate-600 font-mono">{networkInfo.hostname}</strong>
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* IP Display Card */}
                  <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
                    <label className="block text-xs font-bold text-slate-500">
                      عنوان IP السيرفر بالشبكة المحلية
                    </label>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 font-mono font-black text-slate-800 text-base" dir="ltr">
                        {networkLoading ? '...' : (networkInfo?.localIp || '127.0.0.1')}
                      </div>
                      <button
                        type="button"
                        onClick={handleCopyIp}
                        disabled={!networkInfo?.localIp}
                        className={`flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                          copied ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        }`}
                      >
                        {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
                        {copied ? 'تم النسخ' : 'نسخ IP'}
                      </button>
                    </div>
                    <p className="text-[11px] text-slate-400 font-medium">
                      أدخل هذا العنوان في أي جهاز فرعي للربط المباشر.
                    </p>
                  </div>

                  {/* Browser Web Link Card */}
                  <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0 space-y-2">
                      <label className="block text-xs font-bold text-slate-500">
                        رابط تشغيل النظام من أي متصفح في المكتب
                      </label>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 font-mono font-black text-blue-700 text-xs truncate" dir="ltr">
                          {browserLanUrl}
                        </div>
                        <button
                          type="button"
                          onClick={handleCopyUrl}
                          className={`flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer shrink-0 ${
                            copiedUrl ? 'bg-emerald-600 text-white' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                          }`}
                        >
                          {copiedUrl ? <CheckCircle2 size={14} /> : <Copy size={14} />}
                          {copiedUrl ? 'تم النسخ' : 'نسخ الرابط'}
                        </button>
                      </div>
                      <p className="text-[11px] text-slate-400 font-medium">
                        افتح Google Chrome على أي جهاز متصل بالراوتر واكتب الرابط، أو امسح كود QR بكاميرا الموبايل مباشرة.
                      </p>
                    </div>

                    {qrDataUrl && (
                      <button
                        type="button"
                        onClick={() => setShowQrModal(true)}
                        className="shrink-0 flex flex-col items-center gap-1 p-1.5 rounded-xl border border-slate-200 bg-white hover:border-blue-400 hover:shadow-xs transition-all cursor-pointer group"
                        title="اضغط لتكبير QR Code"
                      >
                        <img src={qrDataUrl} alt="QR Code لرابط النظام" className="w-20 h-20 rounded" />
                        <span className="text-[10px] font-bold text-slate-500 group-hover:text-blue-700 flex items-center gap-1">
                          <QrCode size={11} /> تكبير QR
                        </span>
                      </button>
                    )}
                  </div>

                  {showQrModal && qrDataUrl && (
                    <div
                      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4"
                      onClick={() => setShowQrModal(false)}
                    >
                      <div
                        className="bg-white rounded-2xl p-6 max-w-sm w-full text-center space-y-4 shadow-2xl border border-slate-200"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <h4 className="font-black text-slate-900 text-base">امسح الكود للدخول للنظام</h4>
                        <div className="inline-block p-3 rounded-2xl border-2 border-slate-200 bg-white">
                          <img src={qrDataUrl} alt="QR Code لرابط النظام" className="w-56 h-56 mx-auto" />
                        </div>
                        <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-mono font-black text-blue-700 text-sm break-all" dir="ltr">
                          {browserLanUrl}
                        </div>
                        <p className="text-xs text-slate-500 font-medium">
                          وجّه كاميرا الموبايل أو التابلت المتصل بنفس الراوتر نحو الكود لفتح النظام فوراً.
                        </p>
                        <button
                          type="button"
                          onClick={() => setShowQrModal(false)}
                          className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold cursor-pointer"
                        >
                          إغلاق
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {allowModeSwitch && (
                  <div className="flex items-center gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => void handleSaveModeServer()}
                      disabled={networkLoading}
                      className="flex items-center gap-2 bg-[#1e40af] text-white px-5 py-2.5 rounded-xl hover:bg-[#1d4ed8] transition-colors text-xs font-bold cursor-pointer shadow-sm"
                    >
                      <Save size={15} />
                      تأكيد وتثبيت وضع الجهاز الرئيسي
                    </button>
                    {connSaved && (
                      <span className="flex items-center gap-1 text-emerald-600 font-bold text-xs bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-lg">
                        <CheckCircle2 size={15} />
                        تم تثبيت وضع الجهاز الرئيسي بنجاح
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* CLIENT MODE DETAILS */}
            {machineMode === 'client' && (
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200">
                  <div className="flex items-center gap-2">
                    <Monitor size={18} className="text-indigo-600" />
                    <p className="text-sm font-black text-slate-800">
                      إعدادات اتصال الجهاز الفرعي بالخادم الرئيسي
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-xs font-mono font-bold text-slate-600 bg-white border border-slate-200 px-3 py-1 rounded-lg">
                    <span>السيرفر الحالي:</span>
                    <span className="text-indigo-700" dir="ltr">{getServerApiUrl()}</span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-2">
                    عنوان IP الخادم الرئيسي أو رابطه (مثال: 192.168.1.9)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={clientIp}
                      onChange={(e) => {
                        setClientIp(e.target.value);
                        setConnStatus('idle');
                      }}
                      placeholder="192.168.1.9"
                      className="input-ui flex-1 font-mono text-sm"
                      dir="ltr"
                    />
                  </div>
                  <p className="text-[11px] text-slate-400 font-medium mt-1.5">
                    انسخ عنوان IP من صفحة إعدادات الشبكة على الجهاز الرئيسي وضعه هنا.
                  </p>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  {/* Test & Save */}
                  <button
                    type="button"
                    onClick={() => void handleTestAndSaveClient()}
                    disabled={connStatus === 'testing' || !clientIp.trim()}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-sm ${
                      connStatus === 'testing'
                        ? 'bg-slate-200 text-slate-500 cursor-wait'
                        : 'bg-[#1e40af] text-white hover:bg-[#1d4ed8] disabled:opacity-50'
                    }`}
                  >
                    {connStatus === 'testing' ? (
                      <RefreshCw size={15} className="animate-spin" />
                    ) : (
                      <Wifi size={15} />
                    )}
                    {connStatus === 'testing' ? 'جاري الفحص والربط...' : 'اختبار الاتصال وربط السيرفر'}
                  </button>

                  {/* Auto-scan LAN */}
                  <button
                    type="button"
                    onClick={() => void handleAutoScan()}
                    disabled={scanLoading || connStatus === 'testing'}
                    className="flex items-center gap-2 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 text-indigo-700 px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer"
                  >
                    <Search size={15} className={scanLoading ? 'animate-spin' : ''} />
                    {scanLoading ? 'جاري فحص الشبكة المحلية...' : 'فحص واكتشاف السيرفر تلقائياً (Auto-Scan)'}
                  </button>

                  {/* Reset to Localhost */}
                  <button
                    type="button"
                    onClick={handleResetToLocalhost}
                    className="flex items-center gap-1.5 text-slate-500 hover:text-slate-700 text-xs font-bold px-3 py-2 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer mr-auto"
                    title="إعادة التعيين للوضع المحلي الافتراضي"
                  >
                    <RotateCcw size={14} />
                    استعادة الوضع الافتراضي
                  </button>
                </div>

                {/* Status Indicator Banners */}
                {connStatus === 'connected' && (
                  <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl px-4 py-3 text-xs font-bold">
                    <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                    <span>تم الاتصال بالسيرفر بنجاح وتم حفظ الرابط للجهاز الفرعي. يرجى إعادة تحميل الصفحة لتطبيق الربط.</span>
                    <button
                      type="button"
                      onClick={() => window.location.reload()}
                      className="mr-auto bg-emerald-600 text-white px-3 py-1 rounded-lg text-xs font-bold hover:bg-emerald-700 transition-colors cursor-pointer"
                    >
                      تحديث الصفحة الآن
                    </button>
                  </div>
                )}

                {connStatus === 'failed' && (
                  <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl px-4 py-3 text-xs font-bold">
                    <WifiOff size={16} className="text-rose-600 shrink-0" />
                    <span>فشل الاتصال بالسيرفر. تأكد من صحة رقم الـ IP وأن السيرفر قيد التشغيل على الجهاز الرئيسي.</span>
                  </div>
                )}

                {/* Instructions Box */}
                <div className="bg-white border border-slate-200 rounded-xl p-4 text-xs text-slate-600 space-y-2">
                  <p className="font-black text-slate-800">خطوات تشغيل جهاز فرعي في المكتب:</p>
                  <ol className="list-decimal list-inside space-y-1 text-slate-500 font-semibold pr-1">
                    <li>تأكد من تشغيل ملف السيستم على الجهاز الرئيسي وتوصيل كلا الجهازين بنفس الراوتر (Wi-Fi أو كابل).</li>
                    <li>افتح صفحة إعدادات الشبكة على الجهاز الرئيسي وانسخ عنوان IP.</li>
                    <li>ألصق عنوان IP في الحقل أعلاه واضغط <strong className="text-slate-700">"اختبار الاتصال وربط السيرفر"</strong>، أو اضغط <strong className="text-slate-700">"فحص واكتشاف السيرفر تلقائياً"</strong>.</li>
                  </ol>
                </div>
              </div>
            )}

            {/* System Updates Card */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-1">
                <h4 className="text-sm font-black text-slate-900 flex items-center gap-2">
                  <RefreshCw size={16} className="text-blue-600" />
                  <span>تحديثات النظام</span>
                  {appVersion && (
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                      الإصدار الحالي: v{appVersion}
                    </span>
                  )}
                </h4>
                <p className="text-xs text-slate-500">
                  يفحص وجود إصدارات أحدث من الخادم الرسمي عند الاتصال بالإنترنت.
                </p>
                {updateCheckMsg && (
                  <p className="text-xs font-bold text-blue-700 mt-1">{updateCheckMsg}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => void handleCheckForUpdates()}
                disabled={checkingUpdate}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer disabled:opacity-50"
              >
                <RefreshCw size={14} className={checkingUpdate ? 'animate-spin' : ''} />
                <span>{checkingUpdate ? 'جاري الفحص...' : 'فحص التحديثات الآن'}</span>
              </button>
            </div>
          </div>
        )}

        {activeTab === 'balances' && obCollapsed && (
          <div className="p-6">
            <div className="bg-emerald-50/70 border border-emerald-200 rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                  <CheckCircle2 size={22} />
                </div>
                <div>
                  <h3 className="font-black text-slate-800 text-sm">تم حفظ الأرصدة الافتتاحية بنجاح</h3>
                  <p className="text-xs text-slate-600 mt-0.5">
                    الأرصدة المالية محفوظة ومعتمدة في النظام. يمكنك إعادة فتح النموذج عند الحاجة للتعديل.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => toggleObCollapsed(false)}
                className="px-4 py-2 rounded-xl bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-bold shadow-xs transition-colors cursor-pointer"
              >
                عرض / تعديل الأرصدة
              </button>
            </div>
          </div>
        )}

        {activeTab === 'balances' && !obCollapsed && (
          <form onSubmit={handleObSubmit} className="p-6 space-y-6">
            {/* Header info */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold shadow-xs">
                  <Landmark size={20} />
                </div>
                <div>
                  <h3 className="font-black text-slate-800 text-base">الأرصدة الافتتاحية</h3>
                  <p className="text-xs text-slate-500">
                    ترحيل الأرصدة المالية الافتتاحية للشركة (الخزينة، العملاء، الموردين، المخزون)
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void loadOpeningBalances()}
                disabled={obLoading}
                className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-blue-600 px-3 py-1.5 rounded-lg border border-slate-200 hover:border-blue-300 transition-colors cursor-pointer"
              >
                <RefreshCw size={13} className={obLoading ? 'animate-spin text-blue-600' : ''} />
                <span>تحديث البيانات</span>
              </button>
            </div>

            {/* Financial Opening Balances */}
            <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-5 space-y-4">
              <div className="flex items-center gap-2">
                <Landmark size={18} className="text-emerald-600" />
                <h4 className="font-bold text-slate-800 text-sm">
                  الأرصدة المالية الافتتاحية (ترحيل أرقام الشركة القديمة)
                </h4>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    الرصيد الافتتاحي للخزينة (النقدية الفعلية بالدرج)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={obData.startingCashBalance === 0 ? '' : obData.startingCashBalance}
                    onChange={(e) => setObData({ ...obData, startingCashBalance: Number(e.target.value) })}
                    className="input-ui w-full font-bold"
                    placeholder="0.00"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">النقد الفعلي الموجود في الخزينة لبدء العمليات</p>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    إجمالي ديون العملاء الافتتاحية (المتبقي الفعلي على العملاء)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={obData.startingReceivables === 0 ? '' : obData.startingReceivables}
                    onChange={(e) => setObData({ ...obData, startingReceivables: Number(e.target.value) })}
                    className="input-ui w-full font-bold"
                    placeholder="0.00"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">الديون المستحقة على العملاء من فواتير النظام القديم</p>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    إجمالي مستحقات الموردين الافتتاحية (ديون على شركتنا)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={obData.startingPayables === 0 ? '' : obData.startingPayables}
                    onChange={(e) => setObData({ ...obData, startingPayables: Number(e.target.value) })}
                    className="input-ui w-full font-bold"
                    placeholder="0.00"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">مستحقات الموردين القديمة الواجب سدادها</p>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    قيمة بضاعة أول المدة (المخزون الافتتاحي)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={obData.startingInventoryValue === 0 ? '' : obData.startingInventoryValue}
                    onChange={(e) => setObData({ ...obData, startingInventoryValue: Number(e.target.value) })}
                    className="input-ui w-full font-bold"
                    placeholder="0.00"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">القيمة الإجمالية لسعر تكلفة البضائع المتوفرة بالمخازن</p>
                </div>
              </div>
            </div>

            {/* Submit Bar */}
            <div className="flex items-center gap-4 pt-2">
              {hasPermission(user, 'settings:manage') ? (
                <button
                  type="submit"
                  disabled={obSubmitting}
                  className="flex items-center gap-2 bg-[#1e40af] hover:bg-[#1d4ed8] text-white px-8 py-3 rounded-xl font-bold text-sm shadow-md transition-all cursor-pointer disabled:opacity-50"
                >
                  <Save size={18} />
                  <span>{obSubmitting ? 'جاري الحفظ...' : 'حفظ الأرصدة الافتتاحية'}</span>
                </button>
              ) : (
                <span className="text-xs font-bold text-amber-700 bg-amber-50 px-3.5 py-2 rounded-lg border border-amber-200">
                  وضع العرض فقط (ليس لديك صلاحية تعديل الإعدادات)
                </span>
              )}
              {obSaved && (
                <span className="flex items-center gap-1.5 text-emerald-600 font-black text-sm">
                  <CheckCircle2 size={18} />
                  <span>تم حفظ الأرصدة الافتتاحية بنجاح!</span>
                </span>
              )}
            </div>
          </form>
        )}

        {activeTab === 'backup' && (
          <div className="p-6 space-y-5">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              <Download size={18} className="text-indigo-600" />
              النسخ الاحتياطي لقاعدة البيانات
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="border border-slate-200 rounded-xl p-5 space-y-3">
                <p className="font-bold text-slate-700 text-sm">تصدير نسخة احتياطية</p>
                <p className="text-slate-500 text-xs">تحميل جميع بيانات النظام وقاعدة البيانات في ملف SQL (.sql) شامل لجميع الجداول والعمليات.</p>
                <button
                  type="button"
                  onClick={() => void handleExportBackup()}
                  disabled={backupBusy}
                  className="flex items-center gap-2 bg-emerald-600 text-white px-5 py-2 rounded-lg hover:bg-emerald-700 transition-colors text-sm font-bold disabled:opacity-50"
                >
                  <Download size={15} />
                  {backupBusy ? 'جاري التصدير...' : 'تصدير نسخة احتياطية'}
                </button>
              </div>
              <div className="border border-slate-200 rounded-xl p-5 space-y-3">
                <p className="font-bold text-slate-700 text-sm">استيراد نسخة احتياطية</p>
                <p className="text-slate-500 text-xs">استعادة البيانات من ملف نسخة احتياطية (.sql). سيتم استبدال البيانات الحالية بالكامل.</p>
                <input
                  ref={backupInputRef}
                  type="file"
                  accept=".sql,.json"
                  className="hidden"
                  onChange={handleImportBackup}
                />
                {isAdmin(user) ? (
                  <button
                    type="button"
                    disabled={backupBusy}
                    onClick={() => backupInputRef.current?.click()}
                    className="flex items-center gap-2 bg-amber-500 text-white px-5 py-2 rounded-lg hover:bg-amber-600 transition-colors text-sm font-bold cursor-pointer disabled:opacity-50"
                  >
                    <Upload size={15} />
                    {backupBusy ? 'جاري الاستيراد...' : 'استيراد نسخة احتياطية'}
                  </button>
                ) : (
                  <span className="text-xs font-bold text-slate-400 block pt-1">
                    استعادة النسخ الاحتياطية متاحة لمدير النظام فقط
                  </span>
                )}
              </div>
            </div>

            {/* Automated Scheduled Backup Card */}
            <div className="border border-slate-200 rounded-xl p-5 space-y-4 bg-slate-50/60">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
                    <Clock size={19} />
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-800 text-sm">النسخ الاحتياطي التلقائي المجدول (Auto-Backup Scheduler)</h4>
                    <p className="text-xs text-slate-500">حفظ نسخة احتياطية لقاعدة البيانات تلقائياً على قرص آمن (مثل D:\) دون مقاطعة العمل.</p>
                  </div>
                </div>

                {autoBackupCollapsed ? (
                  <div className="flex items-center gap-2 self-start sm:self-auto">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold">
                      <CheckCircle2 size={14} />
                      <span>{autoBackupConfig.enabled ? 'مفعّل ومحفوظ' : 'متوقف ومحفوظ'}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleAutoBackupCollapsed(false)}
                      className="px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-bold shadow-xs transition-colors cursor-pointer"
                    >
                      تعديل الإعدادات
                    </button>
                  </div>
                ) : (
                  <label className="flex items-center gap-2 cursor-pointer select-none self-start sm:self-auto bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
                    <input
                      type="checkbox"
                      checked={autoBackupConfig.enabled}
                      onChange={(e) => setAutoBackupConfig({ ...autoBackupConfig, enabled: e.target.checked })}
                      className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                    />
                    <span className="text-xs font-bold text-slate-700">تفعيل النسخ التلقائي</span>
                  </label>
                )}
              </div>

              {!autoBackupCollapsed && autoBackupConfig.enabled && (
                <div className="space-y-4 pt-1">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      مسار مجلد الحفظ التلقائي (Destination Directory)
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={autoBackupConfig.destinationPath}
                        onChange={(e) => setAutoBackupConfig({ ...autoBackupConfig, destinationPath: e.target.value })}
                        placeholder="D:\AlMuttahida_Backups"
                        className="input-ui flex-1 font-mono text-sm"
                        dir="ltr"
                      />
                      <button
                        type="button"
                        onClick={handleBrowseFolder}
                        className="flex items-center gap-1.5 px-3.5 py-2 bg-white border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 text-xs font-bold transition-colors shadow-sm"
                        title="اختر المجلد من جهازك"
                      >
                        <Folder size={15} className="text-amber-500" />
                        تصفح
                      </button>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      يُفضل اختيار قرص غير قرص النظام الأساسي (مثل <span className="font-bold text-slate-600 font-mono">D:\AlMuttahida_Backups</span>) أو وسيط تخزين خارجي لحماية البيانات عند تعطل الويندوز.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">تكرار النسخ الاحتياطي</label>
                      <select
                        value={autoBackupConfig.frequency}
                        onChange={(e) => setAutoBackupConfig({ ...autoBackupConfig, frequency: e.target.value as any })}
                        className="input-ui w-full text-xs"
                      >
                        <option value="daily">يومياً (موصى به)</option>
                        <option value="twice_daily">مرتين يومياً (كل 12 ساعة)</option>
                        <option value="hourly">كل ساعة</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">وقت النسخ اليومي</label>
                      <input
                        type="time"
                        value={autoBackupConfig.backupTime}
                        onChange={(e) => setAutoBackupConfig({ ...autoBackupConfig, backupTime: e.target.value })}
                        className="input-ui w-full text-xs font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">مدة الاحتفاظ (أقصى عدد نسخ)</label>
                      <input
                        type="number"
                        min="1"
                        max="365"
                        value={autoBackupConfig.retentionDays}
                        onChange={(e) => setAutoBackupConfig({ ...autoBackupConfig, retentionDays: Number(e.target.value) || 30 })}
                        className="input-ui w-full text-xs"
                      />
                      <span className="text-[10px] text-slate-400">حذف النسخ الأقدم تلقائياً لتوفير مساحة القرص</span>
                    </div>
                  </div>

                  {/* Status Strip */}
                  <div className="bg-white border border-slate-200 rounded-lg p-3 text-xs flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500">حالة آخر عملية نسخ:</span>
                      {autoBackupConfig.lastBackupAt ? (
                        <span className="font-bold text-slate-800">
                          {new Date(autoBackupConfig.lastBackupAt).toLocaleString('ar-EG')}
                          {autoBackupConfig.lastBackupFileName && (
                            <span className="text-indigo-600 font-mono text-[11px] mr-1.5 font-normal">
                              ({autoBackupConfig.lastBackupFileName})
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-slate-400">لم يتم إجراء نسخ تلقائي بعد</span>
                      )}
                    </div>
                    <div>
                      {autoBackupConfig.lastBackupStatus === 'success' && (
                        <span className="inline-flex items-center gap-1 text-emerald-600 font-bold bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200 text-[11px]">
                          <CheckCircle2 size={13} /> ناجحة
                        </span>
                      )}
                      {autoBackupConfig.lastBackupStatus === 'failed' && (
                        <span className="inline-flex items-center gap-1 text-rose-600 font-bold bg-rose-50 px-2.5 py-0.5 rounded-full border border-rose-200 text-[11px]">
                          <AlertCircle size={13} /> حدث خطأ في النسخ السابق
                        </span>
                      )}
                    </div>
                  </div>

                  {manualBackupSuccessMsg && (
                    <div className="p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs font-bold flex items-center gap-2">
                      <CheckCircle2 size={16} className="text-emerald-600" />
                      {manualBackupSuccessMsg}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <button
                      type="button"
                      onClick={() => void handleSaveAutoBackup()}
                      disabled={autoBackupLoading}
                      className="flex items-center gap-1.5 bg-[#1e40af] text-white px-5 py-2 rounded-lg hover:bg-[#1d4ed8] transition-colors text-xs font-bold disabled:opacity-50 shadow-2xs cursor-pointer"
                    >
                      <Save size={14} />
                      {autoBackupLoading ? 'جاري الحفظ...' : 'حفظ إعدادات النسخ التلقائي'}
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleRunAutoBackupNow()}
                      disabled={manualBackupRunning || autoBackupLoading}
                      className="flex items-center gap-1.5 bg-white border border-slate-300 text-slate-700 px-4 py-2 rounded-lg hover:bg-slate-50 transition-colors text-xs font-bold disabled:opacity-50 shadow-sm"
                    >
                      {manualBackupRunning ? (
                        <RefreshCw size={14} className="animate-spin text-indigo-600" />
                      ) : (
                        <Play size={14} className="text-emerald-600" />
                      )}
                      {manualBackupRunning ? 'جاري إنشاء النسخة...' : 'تشغيل وحفظ نسخة احتياطية الآن بالمجلد'}
                    </button>

                    {autoBackupSaved && (
                      <span className="flex items-center gap-1 text-emerald-600 font-bold text-xs">
                        <CheckCircle2 size={14} />
                        تم حفظ الإعدادات بنجاح
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'channels' && <PaymentChannelsManager />}

        {activeTab === 'documents' && <DocumentTemplatesManager />}

        {activeTab === 'whatsapp' && (
          <WhatsappControlCenter
            formData={formData}
            setFormData={setFormData}
            onSave={handleSubmit}
            saved={saved}
            canManage={hasPermission(user, 'settings:manage')}
          />
        )}

        {activeTab === 'telegram' && (
          <TelegramNotificationsManager canManage={hasPermission(user, 'settings:manage')} />
        )}

        {activeTab === 'roles' && <RolePermissionsManager />}

        {activeTab === 'danger' && (
          <div className="p-6">
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-5 space-y-4">
              <h3 className="font-bold text-rose-800 flex items-center gap-2">
                <Trash2 size={18} className="text-rose-600" />
                منطقة الخطر
              </h3>
              <p className="text-rose-700 text-sm">مسح كامل البيانات سيحذف جميع السجلات نهائيا. لا يمكن التراجع.</p>
              {isAdmin(user) ? (
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="flex items-center gap-2 bg-rose-600 text-white px-6 py-2 rounded-lg hover:bg-rose-700 transition-colors text-sm font-bold cursor-pointer"
                >
                  <Trash2 size={16} />
                  مسح جميع البيانات
                </button>
              ) : (
                <span className="text-xs font-bold text-slate-500 block pt-1">
                  مسح جميع البيانات متاح لمدير النظام فقط
                </span>
              )}
            </div>

            {showDeleteConfirm && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                <div className="bg-white rounded-xl p-6 max-w-sm mx-4 shadow-2xl">
                  <h4 className="text-lg font-black text-slate-800 mb-2">تاكيد المسح الكامل</h4>
                  <p className="text-slate-600 mb-4 text-sm">سيتم حذف جميع البيانات التالية نهائيا:</p>
                  <ul className="text-sm text-slate-600 mb-6 list-disc list-inside space-y-1">
                    <li>سجلات المبيعات</li>
                    <li>بيانات العملاء</li>
                    <li>بيانات الموردين</li>
                    <li>سجلات المدفوعات</li>
                    <li>المصروفات</li>
                    <li>كتالوج الاصناف</li>
                    <li>بيانات المناديب</li>
                  </ul>
                  <p className="text-rose-600 font-bold text-sm mb-6">لا يمكن التراجع عن هذا الاجراء!</p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => void handleClearData()}
                      className="flex-1 bg-rose-600 text-white px-4 py-2 rounded-lg hover:bg-rose-700 transition-colors font-bold text-sm"
                    >
                      نعم، امسح كل شيء
                    </button>
                    <button
                      onClick={() => setShowDeleteConfirm(false)}
                      className="flex-1 bg-slate-100 text-slate-800 px-4 py-2 rounded-lg hover:bg-slate-200 transition-colors font-bold text-sm"
                    >
                      الغاء
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Developer Credit Footer */}
      <div className="bg-white rounded-xl border border-slate-200 px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 shadow-2xs">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-600">تم تطوير وتنفيذ النظام بواسطة:</span>
          <a
            href="https://www.soratics.com/"
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              const api = (window as unknown as { electronAPI?: { openExternalUrl?: (url: string) => Promise<void> } }).electronAPI;
              if (api?.openExternalUrl) {
                e.preventDefault();
                void api.openExternalUrl('https://www.soratics.com/');
              }
            }}
            className="inline-flex items-center gap-1.5 font-black text-blue-700 hover:text-blue-800 hover:underline"
          >
            <span>Soratics</span>
            <ExternalLink size={13} />
          </a>
        </div>
        <a
          href="https://www.soratics.com/"
          target="_blank"
          rel="noopener noreferrer"
          dir="ltr"
          onClick={(e) => {
            const api = (window as unknown as { electronAPI?: { openExternalUrl?: (url: string) => Promise<void> } }).electronAPI;
            if (api?.openExternalUrl) {
              e.preventDefault();
              void api.openExternalUrl('https://www.soratics.com/');
            }
          }}
          className="font-mono text-[11px] text-slate-400 hover:text-blue-600 transition-colors"
        >
          www.soratics.com
        </a>
      </div>
    </div>
  );
}