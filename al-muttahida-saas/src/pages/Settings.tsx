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
  ShieldCheck,
  Users,
  Plus,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useDialog } from '../context/DialogContext';
import { Setting, OpeningBalances } from '../types';
import {
  clearAllData,
  downloadDatabaseBackup,
  restoreDatabaseBackup,
  getOpeningBalances,
  saveOpeningBalances,
  createShareholder,
  updateShareholder,
} from '../lib/storage';
import {
  api,
  isApiMode,
  API_BASE,
  setServerApiUrl,
  clearServerApiUrl,
  getServerApiUrl,
  testServerUrl,
} from '../lib/apiClient';
import { scanLanForServer } from '../lib/lanDiscovery';

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
  let res = await fetch(`${currentBase}/system/db-config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    res = await fetch(`${currentBase}/api/system/db-config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function testConnection(ip: string) {
  try {
    const res = await fetch(`http://${ip}:4000/health`, { signal: AbortSignal.timeout(4000) });
    if (res.ok) return true;
  } catch (_) {}
  try {
    const res2 = await fetch(`http://${ip}:4000/api/health`, { signal: AbortSignal.timeout(4000) });
    return res2.ok;
  } catch (_) {
    return false;
  }
}

export default function Settings() {
  const { settings, updateSettings, user } = useAuth();
  const { confirmDialog, showToast } = useDialog();
  const [formData, setFormData] = useState<Setting>(settings);
  const [saved, setSaved] = useState(false);
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

  interface FoundingPartnerRow {
    id: string;
    name: string;
    phone: string;
    isFounder: boolean;
    sharePercentage: number;
    capital: number;
    notes?: string;
  }

  const [partners, setPartners] = useState<FoundingPartnerRow[]>([]);

  const loadOpeningBalancesAndPartners = async () => {
    setObLoading(true);
    try {
      if (isApiMode()) {
        const [backendOb, backendShareholders] = await Promise.allSettled([
          api.getOpeningBalances(),
          api.listShareholders(),
        ]);

        if (backendOb.status === 'fulfilled' && backendOb.value) {
          setObData({
            startingCashBalance: Number(backendOb.value.startingCashBalance || 0),
            startingReceivables: Number(backendOb.value.startingReceivables || 0),
            startingPayables: Number(backendOb.value.startingPayables || 0),
            startingInventoryValue: Number(backendOb.value.startingInventoryValue || 0),
          });
        }

        if (
          backendShareholders.status === 'fulfilled' &&
          Array.isArray(backendShareholders.value) &&
          backendShareholders.value.length > 0
        ) {
          setPartners(
            backendShareholders.value.map((sh: any, index: number) => ({
              id: sh.id || `partner-${index}`,
              name: sh.name || '',
              phone: sh.phone || '',
              isFounder: sh.isFounder !== false,
              sharePercentage: Number(sh.sharePercentage || 0),
              capital: Number(sh.capital || 0),
              notes: sh.notes || 'شريك تأسيسي',
            }))
          );
        } else {
          setPartners([
            {
              id: 'init-1',
              name: '',
              phone: '',
              isFounder: true,
              sharePercentage: 100,
              capital: 0,
              notes: 'شريك تأسيسي',
            },
          ]);
        }
      }
    } catch (e) {
      console.error('Failed to load opening balances or partners in Settings:', e);
    } finally {
      setObLoading(false);
    }
  };

  const founders = partners.filter((p) => p.isFounder);
  const investors = partners.filter((p) => !p.isFounder);

  const foundersTotalCapital = founders.reduce((sum, p) => sum + (Number(p.capital) || 0), 0);
  const foundersTotalShare = Number(
    founders.reduce((sum, p) => sum + (Number(p.sharePercentage) || 0), 0).toFixed(2)
  );

  const investorsTotalCapital = investors.reduce((sum, p) => sum + (Number(p.capital) || 0), 0);
  const totalCompanyCapital = foundersTotalCapital + investorsTotalCapital;

  const addFounderRow = () => {
    const remainingShare = Math.max(0, Number((100 - foundersTotalShare).toFixed(2)));
    setPartners([
      ...partners,
      {
        id: `temp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        name: '',
        phone: '',
        isFounder: true,
        sharePercentage: remainingShare,
        capital: 0,
        notes: 'شريك أساسي',
      },
    ]);
  };

  const addInvestorRow = () => {
    setPartners([
      ...partners,
      {
        id: `temp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        name: '',
        phone: '',
        isFounder: false,
        sharePercentage: 20,
        capital: 0,
        notes: 'مساهم بالتمويل',
      },
    ]);
  };

  const removePartnerRow = (id: string) => {
    setPartners(partners.filter((p) => p.id !== id));
  };

  const updatePartnerField = (id: string, field: keyof FoundingPartnerRow, value: any) => {
    setPartners(partners.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
  };

  const [searchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab') as 'company' | 'network' | 'backup' | 'balances' | 'danger' | null;
  const [activeTab, setActiveTab] = useState<'company' | 'network' | 'backup' | 'balances' | 'danger'>(() => {
    if (requestedTab && ['company', 'network', 'backup', 'balances', 'danger'].includes(requestedTab)) {
      return requestedTab;
    }
    return 'company';
  });

  useEffect(() => {
    if (requestedTab && ['company', 'network', 'backup', 'balances', 'danger'].includes(requestedTab)) {
      setActiveTab(requestedTab);
    }
  }, [requestedTab]);

  useEffect(() => {
    if (activeTab === 'balances') {
      void loadOpeningBalancesAndPartners();
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
  const [clientIp, setClientIp] = useState(() => {
    const saved = localStorage.getItem('server_api_url');
    if (saved) return saved.replace(/^https?:\/\//, '').replace(/:4000$/, '');
    return '192.168.1.9';
  });
  const [connStatus, setConnStatus] = useState<'idle' | 'testing' | 'connected' | 'failed'>('idle');
  const [connSaved, setConnSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
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
  const [manualBackupRunning, setManualBackupRunning] = useState(false);
  const [manualBackupSuccessMsg, setManualBackupSuccessMsg] = useState<string | null>(null);

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
        frontendUrl: data.frontendUrl || `http://${data.localIp}:5173`,
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

  useEffect(() => {
    if (activeTab === 'network') void loadNetworkInfo();
  }, [activeTab]);

  const handleCopyIp = () => {
    if (!networkInfo) return;
    navigator.clipboard.writeText(networkInfo.localIp).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleCopyUrl = () => {
    const url = networkInfo?.frontendUrl || `http://${networkInfo?.localIp || '192.168.1.9'}:5173`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    });
  };

  const handleSaveModeServer = async () => {
    setNetworkLoading(true);
    try {
      clearServerApiUrl();
      await saveDbConfig({ host: '127.0.0.1', port: 1433, database: 'AlMuttahida_New', mode: 'server' }).catch(() => null);
      setMachineMode('server');
      setConnSaved(true);
      setTimeout(() => setConnSaved(false), 3000);
      void loadNetworkInfo();
    } catch (err: any) {
      alert('تعذر حفظ الاعدادات: ' + (err.message || ''));
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
      setConnStatus('connected');
      setConnSaved(true);
      await saveDbConfig({ host: clientIp.trim(), port: 1433, database: 'AlMuttahida_New', mode: 'client' }).catch(() => null);
      setTimeout(() => setConnSaved(false), 4000);
    } catch (e: any) {
      setConnStatus('failed');
      setNetworkError('فشل الاتصال بالخادم على: ' + clientIp + ' — تأكد أن الجهازين متصلان بنفس شبكة الراوتر وأن السيرفر قيد التشغيل على الجهاز الرئيسي.');
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const updated = { ...formData, taxRate: 0 };
    updateSettings(updated);
    setFormData(updated);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const handleObSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setObSubmitting(true);
    try {
      if (isApiMode()) {
        await api.updateOpeningBalances(obData);
      }
      saveOpeningBalances(obData);

      const validPartners = partners.filter((p) => p.name.trim().length > 0);
      for (const partner of validPartners) {
        const payload = {
          name: partner.name.trim(),
          phone: partner.phone.trim() || '01000000000',
          sharePercentage: Number(partner.sharePercentage) || 0,
          managementFeePercentage: partner.isFounder ? 0 : Math.max(0, 100 - (Number(partner.sharePercentage) || 0)),
          capital: Number(partner.capital) || 0,
          currentBalance: 0,
          joinedDate: new Date().toISOString().slice(0, 10),
          isFounder: Boolean(partner.isFounder),
          notes: partner.notes?.trim() || 'شريك تأسيسي / رصيد افتتاحي دفتري',
          isOpeningBalance: true,
          affectsTreasury: false,
        };

        if (isApiMode()) {
          if (partner.id && !partner.id.startsWith('temp-') && !partner.id.startsWith('init-')) {
            await api.updateShareholder(partner.id, payload);
          } else {
            await api.createShareholder(payload);
          }
        } else {
          await createShareholder(payload);
        }
      }

      setObSaved(true);
      setTimeout(() => setObSaved(false), 4000);
      await loadOpeningBalancesAndPartners();
    } catch (err: any) {
      console.error('Failed to save opening balances and partners:', err);
      window.alert(err?.message || 'حدث خطأ أثناء حفظ الأرصدة والشركاء');
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
      try {
        await restoreDatabaseBackup(String(reader.result || ''));
        showToast('تم استيراد النسخة الاحتياطية بنجاح. ستتم إعادة تحميل النظام.', 'success');
        setTimeout(() => window.location.reload(), 1500);
      } catch (err: any) {
        showToast(err.message || 'تعذر استيراد ملف النسخة الاحتياطية.', 'error');
      }
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
    { key: 'network' as const, label: 'اعدادات الشبكة' },
    { key: 'balances' as const, label: 'الارصدة الافتتاحية' },
    { key: 'backup' as const, label: 'النسخ الاحتياطي' },
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
          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            <div className="flex items-center gap-2 mb-2">
              <Building size={18} className="text-indigo-600" />
              <h3 className="font-bold text-slate-800">معلومات الشركة</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">اسم الشركة</label>
                <input
                  type="text"
                  value={formData.companyName}
                  onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                  className="input-ui w-full"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">عنوان الشركة</label>
                <input
                  type="text"
                  value={formData.companyAddress}
                  onChange={(e) => setFormData({ ...formData, companyAddress: e.target.value })}
                  className="input-ui w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">رقم الهاتف</label>
                <input
                  type="text"
                  value={(formData as any).companyPhone ?? ''}
                  onChange={(e) => setFormData({ ...formData, companyPhone: e.target.value } as any)}
                  className="input-ui w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">العملة</label>
                <select
                  value={formData.currency ?? 'EGP'}
                  onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                  className="input-ui w-full"
                >
                  <option value="EGP">جنيه مصري (EGP)</option>
                  <option value="USD">دولار امريكي (USD)</option>
                  <option value="SAR">ريال سعودي (SAR)</option>
                  <option value="AED">درهم اماراتي (AED)</option>
                </select>
              </div>
            </div>
            <div className="flex items-center gap-4 pt-2">
              {user?.role !== 'manager' ? (
                <button
                  type="submit"
                  className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2.5 rounded-lg hover:bg-blue-700 transition-colors font-bold text-sm shadow-2xs cursor-pointer"
                >
                  <Save size={16} />
                  حفظ الاعدادات
                </button>
              ) : (
                <span className="text-xs font-bold text-amber-700 bg-amber-50 px-3.5 py-2 rounded-lg border border-amber-200">
                  حساب المشرف: وضع العرض فقط (لا يمكن تعديل الإعدادات)
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

            {/* Mode Selection Cards */}
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
                  <div className={`p-2.5 rounded-xl ${machineMode === 'server' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
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
                  <div className={`p-2.5 rounded-xl ${machineMode === 'client' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
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
                  <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
                    <label className="block text-xs font-bold text-slate-500">
                      رابط تشغيل النظام من أي متصفح في المكتب
                    </label>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 font-mono font-black text-blue-700 text-xs truncate" dir="ltr">
                        {networkInfo?.frontendUrl || `http://${networkInfo?.localIp || '192.168.1.9'}:5173`}
                      </div>
                      <button
                        type="button"
                        onClick={handleCopyUrl}
                        className={`flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                          copiedUrl ? 'bg-emerald-600 text-white' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                        }`}
                      >
                        {copiedUrl ? <CheckCircle2 size={14} /> : <Copy size={14} />}
                        {copiedUrl ? 'تم النسخ' : 'نسخ الرابط'}
                      </button>
                    </div>
                    <p className="text-[11px] text-slate-400 font-medium">
                      افتح Google Chrome على أي جهاز آخر متصل بالراوتر واكتب هذا الرابط.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => void handleSaveModeServer()}
                    disabled={networkLoading}
                    className="flex items-center gap-2 bg-blue-600 text-white px-5 py-2.5 rounded-xl hover:bg-blue-700 transition-colors text-xs font-bold cursor-pointer shadow-sm"
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
                        : 'bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50'
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
          </div>
        )}

        {activeTab === 'balances' && (
          <form onSubmit={handleObSubmit} className="p-6 space-y-6">
            {/* Header info */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold shadow-xs">
                  <Landmark size={20} />
                </div>
                <div>
                  <h3 className="font-black text-slate-800 text-base">الأرصدة الافتتاحية والشركاء التأسيسيون</h3>
                  <p className="text-xs text-slate-500">
                    المرجع الموحد لترحيل أرقام الشركة القديمة، أرصدة الخزينة والديون، وحصص ورؤوس أموال الشركاء التأسيسيين بدقة محاسبية 100%
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void loadOpeningBalancesAndPartners()}
                disabled={obLoading}
                className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-blue-600 px-3 py-1.5 rounded-lg border border-slate-200 hover:border-blue-300 transition-colors cursor-pointer"
              >
                <RefreshCw size={13} className={obLoading ? 'animate-spin text-blue-600' : ''} />
                <span>تحديث البيانات</span>
              </button>
            </div>

            {/* Section 1: Financial Opening Balances */}
            <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-5 space-y-4">
              <div className="flex items-center gap-2">
                <Landmark size={18} className="text-emerald-600" />
                <h4 className="font-bold text-slate-800 text-sm">
                  1. الأرصدة المالية الافتتاحية (ترحيل أرقام الشركة القديمة)
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

            {/* Section 2: Primary Partners (Owners - 100% Equity Pool) */}
            <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={18} className="text-blue-600" />
                  <div>
                    <h4 className="font-bold text-slate-800 text-sm">
                      2. الشركاء الأساسيون أصحاب المنشأة (توزيع الملكية 100%)
                    </h4>
                    <p className="text-[11px] text-slate-400">
                      اقتسام صافي أرباح المنشأة وحقوق الملكية بين الشركاء الأساسيين (مجموع حصص الشركاء يجب أن يساوي 100%)
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={addFounderRow}
                  className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-3 py-1.5 rounded-xl transition-all cursor-pointer shadow-sm"
                >
                  <Plus size={14} />
                  <span>إضافة شريك أساسي</span>
                </button>
              </div>

              {/* KPI Badges for Founders */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-white border border-slate-200 rounded-xl p-3 text-center">
                  <span className="text-[11px] text-slate-500 block font-bold">إجمالي رأس مال الشركاء الأساسيين</span>
                  <span className="text-sm font-black text-slate-800 block mt-0.5" dir="ltr">
                    {foundersTotalCapital.toLocaleString()} جنيه
                  </span>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-3 text-center">
                  <span className="text-[11px] text-slate-500 block font-bold">مجموع حصص الشركاء الأساسيين</span>
                  <div className="flex items-center justify-center gap-1.5 mt-0.5">
                    <span
                      className={`text-sm font-black ${
                        foundersTotalShare === 100
                          ? 'text-emerald-600'
                          : foundersTotalShare > 100
                          ? 'text-rose-600'
                          : 'text-amber-600'
                      }`}
                    >
                      %{foundersTotalShare}
                    </span>
                    {foundersTotalShare === 100 ? (
                      <span className="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded font-bold">
                        مكتمل 100%
                      </span>
                    ) : (
                      <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-bold">
                        {foundersTotalShare < 100 ? 'أقل من 100%' : 'أكبر من 100%'}
                      </span>
                    )}
                  </div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-3 text-center">
                  <span className="text-[11px] text-slate-500 block font-bold">عدد الشركاء الأساسيين</span>
                  <span className="text-sm font-black text-blue-700 block mt-0.5">
                    {founders.length} شريك رئيسي
                  </span>
                </div>
              </div>

              {/* Founders List */}
              <div className="space-y-3 pt-1">
                {founders.map((partner, index) => (
                  <div
                    key={partner.id}
                    className="bg-white border border-blue-200/60 rounded-xl p-3.5 space-y-3 shadow-2xs"
                  >
                    <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                      <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                        <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center text-[11px]">
                          {index + 1}
                        </span>
                        <span>شريك أساسي #{index + 1}</span>
                      </span>
                      {founders.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removePartnerRow(partner.id)}
                          className="text-slate-400 hover:text-rose-600 p-1 rounded transition-colors cursor-pointer"
                          title="حذف هذا الشريك"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                      <div className="md:col-span-2">
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">اسم الشريك الأساسي</label>
                        <input
                          type="text"
                          required
                          value={partner.name}
                          onChange={(e) => updatePartnerField(partner.id, 'name', e.target.value)}
                          placeholder="مثال: أحمد محمود"
                          className="input-ui w-full text-xs font-bold"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">رقم الهاتف</label>
                        <input
                          type="tel"
                          value={partner.phone}
                          onChange={(e) =>
                            updatePartnerField(partner.id, 'phone', e.target.value.replace(/\D/g, ''))
                          }
                          placeholder="010..."
                          className="input-ui w-full text-xs font-bold"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">
                          نسبة الملكية من الشركة %
                        </label>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          value={partner.sharePercentage === 0 ? '' : partner.sharePercentage}
                          onChange={(e) =>
                            updatePartnerField(partner.id, 'sharePercentage', Number(e.target.value))
                          }
                          placeholder="مثال: 50"
                          className="input-ui w-full text-xs font-black text-center text-blue-700 bg-blue-50/50"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">
                          رأس المال التأسيسي الدفتري (جنيه)
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={partner.capital === 0 ? '' : partner.capital}
                          onChange={(e) => updatePartnerField(partner.id, 'capital', Number(e.target.value))}
                          placeholder="0.00"
                          className="input-ui w-full text-xs font-bold"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">
                          ملاحظات الشريك (اختياري)
                        </label>
                        <input
                          type="text"
                          value={partner.notes || ''}
                          onChange={(e) => updatePartnerField(partner.id, 'notes', e.target.value)}
                          placeholder="شريك أساسي مؤسس..."
                          className="input-ui w-full text-xs"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Section 3: Silent Investors / Shareholders (Capital ROI Model) */}
            <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200">
                <div className="flex items-center gap-2">
                  <Users size={18} className="text-purple-600" />
                  <div>
                    <h4 className="font-bold text-slate-800 text-sm">
                      3. المساهمون بالتمويل والمضاربة (عائد تشغيل رأس المال)
                    </h4>
                    <p className="text-[11px] text-slate-400">
                      مستثمرون برؤوس أموالهم — يحصل كل مساهم على نسبته من أرباح أمواله فقط، والباقي يعود للمنشأة كنسبة إدارة
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={addInvestorRow}
                  className="flex items-center gap-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold px-3 py-1.5 rounded-xl transition-all cursor-pointer shadow-sm"
                >
                  <Plus size={14} />
                  <span>إضافة مساهم تمويل</span>
                </button>
              </div>

              {/* Explanatory banner */}
              <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 text-xs text-purple-900 space-y-1">
                <div className="flex items-center gap-2 font-bold text-purple-800">
                  <ShieldCheck size={16} className="text-purple-600 shrink-0" />
                  <span>قاعدة حساب أرباح المساهمين (مفصولة تماماً عن نسبة الـ 100% للشركاء):</span>
                </div>
                <p className="leading-relaxed text-[11px] text-purple-700 pr-6">
                  المساهم يدخل برأس مال محدد، ويأخذ نسبته المتفق عليها من عائد تشغيل رأس ماله هو فقط، والمنشأة تحتفظ بالباقي كـ (نسبة إدارة) تضاف لأرباح الشركاء الأساسيين. <strong>لذلك لا تُجمع نسب المساهمين مع حصص الشركاء الأساسيين ولا تنقص من نسبتكم الـ 100%.</strong>
                </p>
              </div>

              {/* KPI Badges for Investors */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-white border border-slate-200 rounded-xl p-3 text-center">
                  <span className="text-[11px] text-slate-500 block font-bold">إجمالي رؤوس أموال المساهمين</span>
                  <span className="text-sm font-black text-purple-700 block mt-0.5" dir="ltr">
                    {investorsTotalCapital.toLocaleString()} جنيه
                  </span>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-3 text-center">
                  <span className="text-[11px] text-slate-500 block font-bold">عدد المساهمين بالتمويل</span>
                  <span className="text-sm font-black text-slate-800 block mt-0.5">
                    {investors.length} مساهم
                  </span>
                </div>
              </div>

              {/* Investors List */}
              {investors.length === 0 ? (
                <div className="text-center py-6 border border-dashed border-slate-200 rounded-xl bg-white text-slate-400 text-xs">
                  لا يوجد مساهمون بالتمويل حالياً. اضغط على "إضافة مساهم تمويل" إذا كان هناك مستثمرون خارجيون.
                </div>
              ) : (
                <div className="space-y-3 pt-1">
                  {investors.map((investor, index) => {
                    const investorShare = Number(investor.sharePercentage || 0);
                    const mgmtFee = Math.max(0, 100 - investorShare);
                    return (
                      <div
                        key={investor.id}
                        className="bg-white border border-purple-200/60 rounded-xl p-3.5 space-y-3 shadow-2xs"
                      >
                        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                          <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                            <span className="w-5 h-5 rounded-full bg-purple-100 text-purple-700 font-bold flex items-center justify-center text-[11px]">
                              {index + 1}
                            </span>
                            <span>مساهم تمويل #{index + 1}</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => removePartnerRow(investor.id)}
                            className="text-slate-400 hover:text-rose-600 p-1 rounded transition-colors cursor-pointer"
                            title="حذف هذا المساهم"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
                          <div className="md:col-span-2">
                            <label className="block text-[11px] font-bold text-slate-600 mb-1">اسم المساهم</label>
                            <input
                              type="text"
                              required
                              value={investor.name}
                              onChange={(e) => updatePartnerField(investor.id, 'name', e.target.value)}
                              placeholder="مثال: أحمد علي"
                              className="input-ui w-full text-xs font-bold"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-bold text-slate-600 mb-1">رقم الهاتف</label>
                            <input
                              type="tel"
                              value={investor.phone}
                              onChange={(e) =>
                                updatePartnerField(investor.id, 'phone', e.target.value.replace(/\D/g, ''))
                              }
                              placeholder="010..."
                              className="input-ui w-full text-xs font-bold"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-bold text-slate-600 mb-1">
                              نسبة ربح المساهم %
                            </label>
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="0.01"
                              value={investor.sharePercentage === 0 ? '' : investor.sharePercentage}
                              onChange={(e) =>
                                updatePartnerField(investor.id, 'sharePercentage', Number(e.target.value))
                              }
                              placeholder="مثال: 20"
                              className="input-ui w-full text-xs font-black text-center text-purple-700 bg-purple-50/50"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-bold text-slate-600 mb-1">
                              نسبة إدارة المنشأة %
                            </label>
                            <div className="h-9 flex items-center justify-center bg-slate-100 rounded-xl text-xs font-black text-slate-700 border border-slate-200">
                              %{mgmtFee}
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                          <div>
                            <label className="block text-[11px] font-bold text-slate-600 mb-1">
                              رأس المال المستثمر (جنيه)
                            </label>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={investor.capital === 0 ? '' : investor.capital}
                              onChange={(e) => updatePartnerField(investor.id, 'capital', Number(e.target.value))}
                              placeholder="0.00"
                              className="input-ui w-full text-xs font-bold text-emerald-700 bg-emerald-50/30"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-bold text-slate-600 mb-1">
                              ملاحظات المساهم (اختياري)
                            </label>
                            <input
                              type="text"
                              value={investor.notes || ''}
                              onChange={(e) => updatePartnerField(investor.id, 'notes', e.target.value)}
                              placeholder="مساهم تمويل - عقد مضاربة..."
                              className="input-ui w-full text-xs"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Submit Bar */}
            <div className="flex items-center gap-4 pt-2">
              {user?.role !== 'manager' ? (
                <button
                  type="submit"
                  disabled={obSubmitting}
                  className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-xl font-bold text-sm shadow-md transition-all cursor-pointer disabled:opacity-50"
                >
                  <Save size={18} />
                  <span>{obSubmitting ? 'جاري الحفظ...' : 'حفظ الأرصدة والشركاء التأسيسيين'}</span>
                </button>
              ) : (
                <span className="text-xs font-bold text-amber-700 bg-amber-50 px-3.5 py-2 rounded-lg border border-amber-200">
                  حساب المشرف: وضع العرض فقط (لا يمكن تعديل الأرصدة الافتتاحية)
                </span>
              )}
              {obSaved && (
                <span className="flex items-center gap-1.5 text-emerald-600 font-black text-sm">
                  <CheckCircle2 size={18} />
                  <span>تم حفظ الأرصدة والشركاء التأسيسيين بنجاح 100%!</span>
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
                {user?.role !== 'manager' ? (
                  <button
                    type="button"
                    onClick={() => backupInputRef.current?.click()}
                    className="flex items-center gap-2 bg-amber-500 text-white px-5 py-2 rounded-lg hover:bg-amber-600 transition-colors text-sm font-bold cursor-pointer"
                  >
                    <Upload size={15} />
                    استيراد نسخة احتياطية
                  </button>
                ) : (
                  <span className="text-xs font-bold text-slate-400 block pt-1">
                    غير مصرح للمشرف باستيراد النسخ الاحتياطية
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

                <label className="flex items-center gap-2 cursor-pointer select-none self-start sm:self-auto bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
                  <input
                    type="checkbox"
                    checked={autoBackupConfig.enabled}
                    onChange={(e) => setAutoBackupConfig({ ...autoBackupConfig, enabled: e.target.checked })}
                    className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                  />
                  <span className="text-xs font-bold text-slate-700">تفعيل النسخ التلقائي</span>
                </label>
              </div>

              {autoBackupConfig.enabled && (
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
                      className="flex items-center gap-1.5 bg-blue-600 text-white px-5 py-2 rounded-lg hover:bg-blue-700 transition-colors text-xs font-bold disabled:opacity-50 shadow-2xs cursor-pointer"
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

        {activeTab === 'danger' && (
          <div className="p-6">
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-5 space-y-4">
              <h3 className="font-bold text-rose-800 flex items-center gap-2">
                <Trash2 size={18} className="text-rose-600" />
                منطقة الخطر
              </h3>
              <p className="text-rose-700 text-sm">مسح كامل البيانات سيحذف جميع السجلات نهائيا. لا يمكن التراجع.</p>
              {user?.role !== 'manager' ? (
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
                  غير مصرح للمشرف بمسح البيانات
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
    </div>
  );
}