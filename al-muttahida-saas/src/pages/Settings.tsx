import React, { useEffect, useRef, useState } from 'react';
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
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Setting, OpeningBalances } from '../types';
import {
  clearAllData,
  downloadDatabaseBackup,
  restoreDatabaseBackup,
  getOpeningBalances,
  saveOpeningBalances,
} from '../lib/storage';
import { isApiMode } from '../lib/apiClient';

const API_BASE = (window as any).__API_BASE_URL__ || import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';

async function fetchNetworkInfo(retries = 3, delayMs = 800) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      let res = await fetch(`${API_BASE}/system/network-info`);
      if (!res.ok) {
        res = await fetch(`${API_BASE}/api/system/network-info`);
      }
      if (res.ok) {
        return (await res.json()) as {
          ok: boolean;
          localIp: string;
          hostname: string;
          dbConfig: { mode?: string; db?: { host: string; port: number; database: string } };
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
  let res = await fetch(`${API_BASE}/system/db-config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    res = await fetch(`${API_BASE}/api/system/db-config`, {
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
  const { settings, updateSettings } = useAuth();
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

  const [activeTab, setActiveTab] = useState<'company' | 'network' | 'backup' | 'balances' | 'danger'>('company');
  const [networkInfo, setNetworkInfo] = useState<{ localIp: string; hostname: string } | null>(null);
  const [networkLoading, setNetworkLoading] = useState(false);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [machineMode, setMachineMode] = useState<'server' | 'client'>('server');
  const [clientIp, setClientIp] = useState('192.168.1.100');
  const [clientPort, setClientPort] = useState(1433);
  const [clientDb, setClientDb] = useState('AlMuttahida_New');
  const [connStatus, setConnStatus] = useState<'idle' | 'testing' | 'connected' | 'failed'>('idle');
  const [connSaved, setConnSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadNetworkInfo = async () => {
    setNetworkLoading(true);
    setNetworkError(null);
    try {
      const data = await fetchNetworkInfo();
      setNetworkInfo({ localIp: data.localIp, hostname: data.hostname });
      if (data.dbConfig?.mode) setMachineMode(data.dbConfig.mode as 'server' | 'client');
      const cfg: any = data.dbConfig || {};
      const host = cfg.host || cfg.db?.host;
      const port = cfg.port || cfg.db?.port;
      const database = cfg.database || cfg.db?.database;
      if (host) setClientIp(host);
      if (port) setClientPort(Number(port));
      if (database) setClientDb(database);
    } catch {
      setNetworkError('تعذر الاتصال بالخادم للحصول على معلومات الشبكة.');
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

  const handleTestAndSave = async () => {
    setConnStatus('testing');
    try {
      const ok = await testConnection(clientIp);
      if (!ok) throw new Error('connection failed');
      setConnStatus('connected');
      await saveDbConfig({ host: clientIp, port: clientPort, database: clientDb, mode: 'client' });
      setConnSaved(true);
      setTimeout(() => setConnSaved(false), 4000);
    } catch {
      setConnStatus('failed');
      setTimeout(() => setConnStatus('idle'), 5000);
    }
  };

  const handleSaveModeServer = async () => {
    try {
      const localIp = networkInfo?.localIp ?? '127.0.0.1';
      await saveDbConfig({ host: localIp, port: clientPort, database: clientDb, mode: 'server' });
      setMachineMode('server');
      setConnSaved(true);
      setTimeout(() => setConnSaved(false), 3000);
    } catch (err: any) {
      alert('تعذر حفظ الاعدادات: ' + (err.message || ''));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const updated = { ...formData, taxRate: 0 };
    updateSettings(updated);
    setFormData(updated);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const handleObSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveOpeningBalances(obData);
    setObSaved(true);
    setTimeout(() => setObSaved(false), 3000);
  };

  const handleExportBackup = async () => {
    try {
      setBackupBusy(true);
      await downloadDatabaseBackup();
    } catch (err: any) {
      alert(err.message || 'تعذر تصدير الباك أب.');
    } finally {
      setBackupBusy(false);
    }
  };

  const handleImportBackup = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!confirm('استيراد الباك أب سيستبدل بيانات النظام الحالية. هل تريد المتابعة؟')) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await restoreDatabaseBackup(String(reader.result || ''));
        alert('تم استيراد الباك أب بنجاح. ستتم اعادة تحميل النظام.');
        window.location.reload();
      } catch (err: any) {
        alert(err.message || 'تعذر استيراد ملف الباك أب.');
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
              <button
                type="submit"
                className="flex items-center gap-2 bg-indigo-600 text-white px-6 py-2.5 rounded-lg hover:bg-indigo-700 transition-colors font-bold text-sm"
              >
                <Save size={16} />
                حفظ الاعدادات
              </button>
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
                <h3 className="font-bold text-slate-800">اعدادات الشبكة والاتصال</h3>
              </div>
              <button
                type="button"
                onClick={() => void loadNetworkInfo()}
                disabled={networkLoading}
                className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-blue-600 px-3 py-1.5 rounded-lg border border-slate-200 hover:border-blue-300 transition-colors"
              >
                <RefreshCw size={13} className={networkLoading ? 'animate-spin' : ''} />
                تحديث
              </button>
            </div>

            {networkError && (
              <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-700 rounded-lg px-4 py-3 text-sm font-bold">
                <AlertCircle size={16} />
                {networkError}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setMachineMode('server')}
                className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                  machineMode === 'server'
                    ? 'border-blue-600 bg-blue-50 text-blue-700'
                    : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                }`}
              >
                <Server size={28} className={machineMode === 'server' ? 'text-blue-600' : 'text-slate-400'} />
                <span className="font-black text-sm">جهاز رئيسي (Server)</span>
                <span className="text-xs text-center opacity-70">يحمل قاعدة البيانات وتعمل عليه جميع الاجهزة</span>
              </button>
              <button
                type="button"
                onClick={() => setMachineMode('client')}
                className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                  machineMode === 'client'
                    ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                    : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                }`}
              >
                <Monitor size={28} className={machineMode === 'client' ? 'text-indigo-600' : 'text-slate-400'} />
                <span className="font-black text-sm">جهاز فرعي (Client)</span>
                <span className="text-xs text-center opacity-70">يتصل بالجهاز الرئيسي عبر الشبكة</span>
              </button>
            </div>

            {machineMode === 'server' && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 space-y-4">
                <p className="text-blue-800 font-bold text-sm flex items-center gap-2">
                  <Server size={16} />
                  هذا الجهاز يعمل كخادم رئيسي
                </p>
                <div>
                  <label className="block text-xs font-bold text-blue-700 mb-2">
                    عنوان IP الجهاز الرئيسي (شارك هذا العنوان مع الاجهزة الفرعية)
                  </label>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-white border border-blue-300 rounded-lg px-4 py-2.5 font-mono font-black text-lg text-blue-900 select-all">
                      {networkLoading ? (
                        <span className="text-slate-400 text-sm font-normal">جاري التحميل...</span>
                      ) : (
                        networkInfo?.localIp ?? 'قم بالضغط على تحديث'
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={handleCopyIp}
                      disabled={!networkInfo}
                      className={`flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-bold transition-all ${
                        copied
                          ? 'bg-emerald-600 text-white'
                          : 'bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50'
                      }`}
                    >
                      {copied ? <CheckCircle2 size={16} /> : <Copy size={16} />}
                      {copied ? 'تم النسخ!' : 'نسخ'}
                    </button>
                  </div>
                  {networkInfo && (
                    <p className="text-xs text-blue-600 mt-1.5">
                      اسم الجهاز: <span className="font-bold">{networkInfo.hostname}</span>
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => void handleSaveModeServer()}
                  className="flex items-center gap-2 bg-blue-600 text-white px-5 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-bold"
                >
                  <Save size={15} />
                  حفظ وضع الجهاز الرئيسي
                </button>
                {connSaved && (
                  <span className="flex items-center gap-1 text-emerald-600 font-bold text-sm">
                    <CheckCircle2 size={15} />
                    تم الحفظ بنجاح
                  </span>
                )}
              </div>
            )}

            {machineMode === 'client' && (
              <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-5 space-y-4">
                <p className="text-indigo-800 font-bold text-sm flex items-center gap-2">
                  <Monitor size={16} />
                  ادخل عنوان الجهاز الرئيسي للاتصال
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="md:col-span-1">
                    <label className="block text-xs font-bold text-indigo-700 mb-1">
                      IP الجهاز الرئيسي
                    </label>
                    <input
                      type="text"
                      value={clientIp}
                      onChange={(e) => { setClientIp(e.target.value); setConnStatus('idle'); }}
                      placeholder="192.168.1.100"
                      className="input-ui w-full font-mono"
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-indigo-700 mb-1">
                      بورت قاعدة البيانات
                    </label>
                    <input
                      type="number"
                      value={clientPort}
                      onChange={(e) => setClientPort(Number(e.target.value))}
                      className="input-ui w-full font-mono"
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-indigo-700 mb-1">
                      اسم قاعدة البيانات
                    </label>
                    <input
                      type="text"
                      value={clientDb}
                      onChange={(e) => setClientDb(e.target.value)}
                      className="input-ui w-full font-mono"
                      dir="ltr"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    type="button"
                    onClick={() => void handleTestAndSave()}
                    disabled={connStatus === 'testing' || !clientIp}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold transition-all ${
                      connStatus === 'testing'
                        ? 'bg-slate-200 text-slate-500 cursor-wait'
                        : 'bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50'
                    }`}
                  >
                    {connStatus === 'testing' ? (
                      <RefreshCw size={15} className="animate-spin" />
                    ) : (
                      <Wifi size={15} />
                    )}
                    {connStatus === 'testing' ? 'جاري الاختبار...' : 'اختبار الاتصال والحفظ'}
                  </button>

                  {connStatus === 'connected' && (
                    <span className="flex items-center gap-1.5 text-emerald-600 font-black text-sm bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-lg">
                      <Wifi size={15} />
                      متصل بنجاح{connSaved ? ' — تم الحفظ' : ''}
                    </span>
                  )}
                  {connStatus === 'failed' && (
                    <span className="flex items-center gap-1.5 text-rose-600 font-black text-sm bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-lg">
                      <WifiOff size={15} />
                      فشل الاتصال — تحقق من IP والشبكة
                    </span>
                  )}
                  {connStatus === 'idle' && (
                    <span className="flex items-center gap-1.5 text-slate-400 text-sm">
                      <WifiOff size={14} />
                      لم يتم الاختبار بعد
                    </span>
                  )}
                </div>

                <div className="bg-white border border-indigo-100 rounded-lg p-3 text-xs text-indigo-700 space-y-1">
                  <p className="font-bold">تعليمات الاتصال:</p>
                  <ol className="list-decimal list-inside space-y-0.5 text-indigo-600">
                    <li>افتح اعدادات الشبكة على الجهاز الرئيسي وانسخ عنوان IP</li>
                    <li>ادخل العنوان في الحقل اعلاه</li>
                    <li>اضغط اختبار الاتصال والحفظ</li>
                    <li>اعد تشغيل التطبيق لتطبيق التغييرات</li>
                  </ol>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'balances' && (
          <form onSubmit={handleObSubmit} className="p-6 space-y-5">
            <div className="flex items-center gap-2 mb-2">
              <Landmark size={18} className="text-indigo-600" />
              <h3 className="font-bold text-slate-800">الارصدة الافتتاحية</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">رصيد الخزينة الافتتاحي</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={obData.startingCashBalance}
                  onChange={(e) => setObData({ ...obData, startingCashBalance: Number(e.target.value) })}
                  className="input-ui w-full"
                  placeholder="0.00"
                />
                <p className="text-xs text-slate-400 mt-1">النقد الفعلي في الخزينة عند بداية استخدام النظام</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">اجمالي رصيد العملاء الافتتاحي</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={obData.startingReceivables}
                  onChange={(e) => setObData({ ...obData, startingReceivables: Number(e.target.value) })}
                  className="input-ui w-full"
                  placeholder="0.00"
                />
                <p className="text-xs text-slate-400 mt-1">مستحقات على عملاء قبل بداية النظام</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">اجمالي رصيد الموردين الافتتاحي</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={obData.startingPayables}
                  onChange={(e) => setObData({ ...obData, startingPayables: Number(e.target.value) })}
                  className="input-ui w-full"
                  placeholder="0.00"
                />
                <p className="text-xs text-slate-400 mt-1">مستحقات للموردين من قبل بداية النظام</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">قيمة بضاعة اول المدة</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={obData.startingInventoryValue}
                  onChange={(e) => setObData({ ...obData, startingInventoryValue: Number(e.target.value) })}
                  className="input-ui w-full"
                  placeholder="0.00"
                />
                <p className="text-xs text-slate-400 mt-1">تقييم المخزون عند بداية استخدام النظام</p>
              </div>
            </div>
            <div className="flex items-center gap-4 pt-2">
              <button
                type="submit"
                className="flex items-center gap-2 bg-indigo-600 text-white px-6 py-2.5 rounded-lg hover:bg-indigo-700 transition-colors font-bold text-sm"
              >
                <Save size={16} />
                حفظ الارصدة الافتتاحية
              </button>
              {obSaved && (
                <span className="flex items-center gap-1 text-emerald-600 font-bold text-sm">
                  <CheckCircle2 size={16} />
                  تم الحفظ بنجاح
                </span>
              )}
            </div>
          </form>
        )}

        {activeTab === 'backup' && (
          <div className="p-6 space-y-5">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              <Download size={18} className="text-indigo-600" />
              النسخ الاحتياطي
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="border border-slate-200 rounded-xl p-5 space-y-3">
                <p className="font-bold text-slate-700 text-sm">تصدير نسخة احتياطية</p>
                <p className="text-slate-500 text-xs">تحميل جميع بيانات النظام في ملف واحد قابل للاستيراد لاحقا.</p>
                <button
                  type="button"
                  onClick={() => void handleExportBackup()}
                  disabled={backupBusy}
                  className="flex items-center gap-2 bg-emerald-600 text-white px-5 py-2 rounded-lg hover:bg-emerald-700 transition-colors text-sm font-bold disabled:opacity-50"
                >
                  <Download size={15} />
                  {backupBusy ? 'جاري التصدير...' : 'تصدير الباك اب'}
                </button>
              </div>
              <div className="border border-slate-200 rounded-xl p-5 space-y-3">
                <p className="font-bold text-slate-700 text-sm">استيراد نسخة احتياطية</p>
                <p className="text-slate-500 text-xs">استعادة البيانات من ملف باك اب سابق. سيستبدل البيانات الحالية.</p>
                <input
                  ref={backupInputRef}
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={handleImportBackup}
                />
                <button
                  type="button"
                  onClick={() => backupInputRef.current?.click()}
                  className="flex items-center gap-2 bg-amber-500 text-white px-5 py-2 rounded-lg hover:bg-amber-600 transition-colors text-sm font-bold"
                >
                  <Upload size={15} />
                  استيراد باك اب
                </button>
              </div>
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
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="flex items-center gap-2 bg-rose-600 text-white px-6 py-2 rounded-lg hover:bg-rose-700 transition-colors text-sm font-bold"
              >
                <Trash2 size={16} />
                مسح جميع البيانات
              </button>
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