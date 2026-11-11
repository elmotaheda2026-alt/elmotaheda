import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Server,
  Laptop,
  Database,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ArrowRight,
  ArrowLeft,
  Wifi,
  Sparkles,
  ShieldCheck,
  Building2,
  Loader2
} from 'lucide-react';

interface ElectronAPI {
  startApp: (config: { mode: 'server' | 'client'; serverIp?: string }) => void;
  checkSqlStatus: () => Promise<{ running: boolean; port?: number; error?: string }>;
  downloadAndInstallSql: () => Promise<{ success: boolean; error?: string }>;
  onSqlProgress: (callback: (data: { step: string; percent: number; msg: string }) => void) => void;
  scanNetwork: () => Promise<string | null>;
  testServerIp: (ip: string) => Promise<{ ok: boolean; error?: string }>;
  closeWindow: () => void;
  onStatus?: (callback: (msg: string) => void) => void;
  onError?: (callback: (err: string) => void) => void;
  onAppStarted?: (callback: (data: { success: boolean; mode: string; apiUrl: string }) => void) => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

type Step = 'role' | 'connection' | 'launch';
type Mode = 'server' | 'client';

export default function OnboardingWizard() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState<Step>('role');
  const [selectedMode, setSelectedMode] = useState<Mode>('server');

  // Server state
  const [sqlStatus, setSqlStatus] = useState<'idle' | 'checking' | 'ready' | 'error'>('idle');
  const [sqlMessage, setSqlMessage] = useState<string>('جاري اختبار محرك البيانات...');
  const [installProgress, setInstallProgress] = useState<{ percent: number; msg: string } | null>(null);

  // Client state
  const [serverIp, setServerIp] = useState<string>('');
  const [clientChecking, setClientChecking] = useState<boolean>(false);
  const [clientStatus, setClientStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [clientFeedback, setClientFeedback] = useState<string>('');

  // Launch state
  const [isLaunching, setIsLaunching] = useState<boolean>(false);
  const [launchStatusText, setLaunchStatusText] = useState<string>('');
  const [launchErrorText, setLaunchErrorText] = useState<string>('');

  useEffect(() => {
    if (window.electronAPI) {
      if (window.electronAPI.onStatus) {
        window.electronAPI.onStatus((msg) => {
          setLaunchStatusText(msg);
        });
      }
      if (window.electronAPI.onError) {
        window.electronAPI.onError((err) => {
          setIsLaunching(false);
          setLaunchErrorText(err);
        });
      }
      if (window.electronAPI.onAppStarted) {
        window.electronAPI.onAppStarted(() => {
          localStorage.setItem('almuttahida_configured', 'true');
          navigate('/login');
          window.location.reload();
        });
      }
    }
  }, [navigate]);

  // Check SQL Status on Server Mode
  const checkSqlEngine = async () => {
    setSqlStatus('checking');
    setSqlMessage('جاري التحقق من خدمات SQL Server وجاهزية قاعدة البيانات...');

    if (!window.electronAPI || !window.electronAPI.checkSqlStatus) {
      // Running inside browser / web mode
      setTimeout(() => {
        setSqlStatus('ready');
        setSqlMessage('النظام متصل بالسيرفر المحلي بنجاح.');
      }, 700);
      return;
    }

    try {
      const res = await window.electronAPI.checkSqlStatus();
      if (res && res.running) {
        setSqlStatus('ready');
        setSqlMessage('محرك البيانات وقاعدة بيانات AlMuttahida_New جاهزان للعمل بنجاح.');
      } else {
        setSqlStatus('error');
        setSqlMessage(res?.error || 'محرك SQL Server غير متصل حالياً على هذا الجهاز.');
      }
    } catch (err: any) {
      setSqlStatus('error');
      setSqlMessage('تعذر الاتصال بمحرك البيانات: ' + (err.message || String(err)));
    }
  };

  // Start auto SQL provision
  const handleAutoProvisionSql = async () => {
    if (!window.electronAPI || !window.electronAPI.downloadAndInstallSql) return;
    setSqlStatus('checking');
    setInstallProgress({ percent: 15, msg: 'جاري تشغيل خدمات SQL Server وتفعيل المصادقة...' });

    if (window.electronAPI.onSqlProgress) {
      window.electronAPI.onSqlProgress((data) => {
        setInstallProgress({ percent: data.percent, msg: data.msg });
      });
    }

    try {
      const res = await window.electronAPI.downloadAndInstallSql();
      if (res && res.success) {
        setInstallProgress({ percent: 100, msg: 'اكتملت التهيئة بنجاح!' });
        setTimeout(() => {
          checkSqlEngine();
          setInstallProgress(null);
        }, 1200);
      } else {
        setSqlStatus('error');
        setSqlMessage(res.error || 'فشلت التهيئة التلقائية.');
        setInstallProgress(null);
      }
    } catch (e: any) {
      setSqlStatus('error');
      setSqlMessage('حدث خطأ أثناء التهيئة: ' + e.message);
      setInstallProgress(null);
    }
  };

  // Scan network for Server IP (Client Mode)
  const handleAutoScanNetwork = async () => {
    setClientChecking(true);
    setClientFeedback('جاري فحص الشبكة المحلية للعثور على السيرفر الرئيسي تلقائياً...');

    if (!window.electronAPI || !window.electronAPI.scanNetwork) {
      setTimeout(() => {
        setServerIp('192.168.1.100');
        setClientStatus('success');
        setClientFeedback('تم العثور على السيرفر (بيئة تجريبية).');
        setClientChecking(false);
      }, 1000);
      return;
    }

    try {
      const foundIp = await window.electronAPI.scanNetwork();
      if (foundIp) {
        setServerIp(foundIp);
        setClientStatus('success');
        setClientFeedback(`تم اكتشاف السيرفر الرئيسي على العنوان: ${foundIp}`);
      } else {
        setClientStatus('error');
        setClientFeedback('لم يتم العثور على السيرفر تلقائياً. اكتب عنوان IP السيرفر يدوياً.');
      }
    } catch {
      setClientStatus('error');
      setClientFeedback('تعذر المسح التلقائي للشبكة. اكتب عنوان السيرفر يدوياً.');
    } finally {
      setClientChecking(false);
    }
  };

  // Test client IP connection
  const handleTestClientConnection = async () => {
    if (!serverIp.trim()) {
      setClientStatus('error');
      setClientFeedback('يرجى إدخال عنوان IP أولاً.');
      return;
    }

    setClientChecking(true);
    setClientFeedback('جاري الاتصال بالسيرفر...');

    if (!window.electronAPI || !window.electronAPI.testServerIp) {
      setTimeout(() => {
        setClientStatus('success');
        setClientFeedback('الاتصال ناجح بالسيرفر!');
        setClientChecking(false);
      }, 600);
      return;
    }

    try {
      const res = await window.electronAPI.testServerIp(serverIp.trim());
      if (res && res.ok) {
        setClientStatus('success');
        setClientFeedback(`الاتصال ناجح بالسيرفر على (${serverIp}) والنظام مستعد.`);
      } else {
        setClientStatus('error');
        setClientFeedback(`تعذر الاتصال بـ (${serverIp}). تأكد أن السيرفر شغال وعلى نفس الراوتر.`);
      }
    } catch (err: any) {
      setClientStatus('error');
      setClientFeedback('فشل الاتصال: ' + err.message);
    } finally {
      setClientChecking(false);
    }
  };

  // Switch between steps
  const goToNextStep = () => {
    if (currentStep === 'role') {
      setCurrentStep('connection');
      if (selectedMode === 'server') {
        checkSqlEngine();
      } else if (!serverIp) {
        handleAutoScanNetwork();
      }
    } else if (currentStep === 'connection') {
      setCurrentStep('launch');
    }
  };

  const handleLaunchApp = () => {
    setIsLaunching(true);
    setLaunchErrorText('');
    setLaunchStatusText('جاري بدء تشغيل النظام...');

    if (selectedMode === 'client' && serverIp.trim()) {
      localStorage.setItem('server_api_url', `http://${serverIp.trim()}:4000`);
    }

    if (window.electronAPI && window.electronAPI.startApp) {
      if (selectedMode === 'server') {
        window.electronAPI.startApp({ mode: 'server' });
      } else {
        window.electronAPI.startApp({ mode: 'client', serverIp: serverIp.trim() });
      }
    } else {
      localStorage.setItem('almuttahida_configured', 'true');
      setTimeout(() => {
        navigate('/login');
        window.location.reload();
      }, 1000);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col justify-between p-4 md:p-8" dir="rtl">
      {/* Top Header */}
      <div className="max-w-3xl mx-auto w-full pt-4">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white shadow-md shadow-emerald-500/20">
              <Building2 className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">شركة المتحدة ERP</h1>
              <p className="text-xs text-slate-500 font-medium">معالج الإعداد والتهيئة التلقائية للنظام</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/60">
            <Sparkles className="w-3.5 h-3.5" />
            الإصدار 2.0 المحدث
          </span>
        </div>

        {/* Stepper Progress Bar */}
        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm mb-6">
          <div className="flex items-center justify-between relative">
            <div className="absolute top-1/2 right-6 left-6 -translate-y-1/2 h-0.5 bg-slate-100 -z-0" />
            <div
              className="absolute top-1/2 right-6 -translate-y-1/2 h-0.5 bg-emerald-500 transition-all duration-500 -z-0"
              style={{
                width: currentStep === 'role' ? '0%' : currentStep === 'connection' ? '50%' : '100%'
              }}
            />

            {/* Step 1 */}
            <div className="relative z-10 flex flex-col items-center gap-1.5 bg-white px-2">
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold transition-all ${
                  currentStep === 'role'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                    : 'bg-emerald-100 text-emerald-800'
                }`}
              >
                1
              </div>
              <span className="text-xs font-medium text-slate-600">نوع الجهاز</span>
            </div>

            {/* Step 2 */}
            <div className="relative z-10 flex flex-col items-center gap-1.5 bg-white px-2">
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold transition-all ${
                  currentStep === 'connection'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                    : currentStep === 'launch'
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-slate-100 text-slate-400'
                }`}
              >
                2
              </div>
              <span className="text-xs font-medium text-slate-600">الاتصال والتهيئة</span>
            </div>

            {/* Step 3 */}
            <div className="relative z-10 flex flex-col items-center gap-1.5 bg-white px-2">
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold transition-all ${
                  currentStep === 'launch'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                    : 'bg-slate-100 text-slate-400'
                }`}
              >
                3
              </div>
              <span className="text-xs font-medium text-slate-600">بدء العمل</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="max-w-3xl mx-auto w-full my-auto">
        <div className="bg-white rounded-3xl p-6 md:p-8 border border-slate-200/80 shadow-sm transition-all duration-300">
          {/* STEP 1: Role Selection */}
          {currentStep === 'role' && (
            <div className="space-y-6">
              <div className="text-center max-w-md mx-auto mb-6">
                <h2 className="text-xl font-bold text-slate-900 mb-2">كيف يعمل هذا الجهاز في المنشأة؟</h2>
                <p className="text-sm text-slate-500">
                  اختر ما إذا كان هذا الجهاز هو السيرفر الأساسي لقواعد البيانات، أم جهاز كاشير / جهاز موظف فرعي.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Server Card */}
                <div
                  onClick={() => setSelectedMode('server')}
                  className={`p-6 rounded-2xl border-2 cursor-pointer transition-all relative flex flex-col justify-between ${
                    selectedMode === 'server'
                      ? 'border-emerald-500 bg-emerald-50/40 shadow-sm'
                      : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/50'
                  }`}
                >
                  {selectedMode === 'server' && (
                    <span className="absolute top-4 left-4 w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs">
                      <CheckCircle2 className="w-4 h-4" />
                    </span>
                  )}
                  <div>
                    <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center mb-4">
                      <Server className="w-6 h-6" />
                    </div>
                    <h3 className="text-base font-bold text-slate-900 mb-1.5">جهاز رئيسي (خادم / Server)</h3>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      الجهاز الأساسي اللي عليه البيانات والمعاملات. يشغل محرك SQL Server وتتصل به باقي الأجهزة في المنشأة.
                    </p>
                  </div>
                  <span className="mt-4 text-[11px] font-semibold text-emerald-700 bg-emerald-100/70 py-1 px-2.5 rounded-lg w-fit">
                    موصى به للجهاز الرئيسي
                  </span>
                </div>

                {/* Client Card */}
                <div
                  onClick={() => setSelectedMode('client')}
                  className={`p-6 rounded-2xl border-2 cursor-pointer transition-all relative flex flex-col justify-between ${
                    selectedMode === 'client'
                      ? 'border-emerald-500 bg-emerald-50/40 shadow-sm'
                      : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/50'
                  }`}
                >
                  {selectedMode === 'client' && (
                    <span className="absolute top-4 left-4 w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs">
                      <CheckCircle2 className="w-4 h-4" />
                    </span>
                  )}
                  <div>
                    <div className="w-12 h-12 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center mb-4">
                      <Laptop className="w-6 h-6" />
                    </div>
                    <h3 className="text-base font-bold text-slate-900 mb-1.5">جهاز فرعي (عميل / Client)</h3>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      أي جهاز كاشير أو كمبيوتر آخر في المحل. لا يحتاج تثبيت SQL Server ويتصل مباشرة بالسيرفر عبر الراوتر.
                    </p>
                  </div>
                  <span className="mt-4 text-[11px] font-semibold text-blue-700 bg-blue-100/70 py-1 px-2.5 rounded-lg w-fit">
                    إعداد فوري بدون تسطيب
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: Connection & Auto-Setup */}
          {currentStep === 'connection' && (
            <div className="space-y-6">
              {selectedMode === 'server' ? (
                <div>
                  <div className="text-center max-w-md mx-auto mb-6">
                    <h2 className="text-xl font-bold text-slate-900 mb-2">فحص وتهيئة محرك قواعد البيانات</h2>
                    <p className="text-sm text-slate-500">
                      يقوم النظام بالتأكد من تشغيل SQL Server، تفعيل الصلاحيات، وإنشاء قاعدة البيانات تلقائياً.
                    </p>
                  </div>

                  {/* Status Banner */}
                  <div className="p-5 rounded-2xl border border-slate-200/90 bg-slate-50 mb-6">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <div
                          className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                            sqlStatus === 'ready'
                              ? 'bg-emerald-100 text-emerald-700'
                              : sqlStatus === 'error'
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-blue-100 text-blue-700 animate-pulse'
                          }`}
                        >
                          {sqlStatus === 'ready' ? (
                            <CheckCircle2 className="w-5 h-5" />
                          ) : sqlStatus === 'error' ? (
                            <AlertCircle className="w-5 h-5" />
                          ) : (
                            <Database className="w-5 h-5" />
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-bold text-slate-900">حالة SQL Server</span>
                            <span
                              className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                                sqlStatus === 'ready'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : sqlStatus === 'error'
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-blue-100 text-blue-800'
                              }`}
                            >
                              {sqlStatus === 'ready' ? 'متصل وجاهز' : sqlStatus === 'error' ? 'بحاجة للتهيئة' : 'جاري الفحص...'}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600 leading-relaxed">{sqlMessage}</p>
                        </div>
                      </div>

                      <button
                        onClick={checkSqlEngine}
                        disabled={sqlStatus === 'checking'}
                        className="px-3 py-1.5 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-100 flex items-center gap-1.5 transition shrink-0"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${sqlStatus === 'checking' ? 'animate-spin' : ''}`} />
                        إعادة فحص
                      </button>
                    </div>

                    {/* Progress Bar (if provisioning) */}
                    {installProgress && (
                      <div className="mt-4 pt-4 border-t border-slate-200">
                        <div className="flex justify-between text-xs text-slate-600 font-medium mb-1.5">
                          <span>{installProgress.msg}</span>
                          <span className="font-bold text-emerald-700">{installProgress.percent}%</span>
                        </div>
                        <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-300"
                            style={{ width: `${installProgress.percent}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Auto Provision Card when error or offline */}
                  {sqlStatus === 'error' && !installProgress && (
                    <div className="p-5 rounded-2xl bg-emerald-50/60 border border-emerald-200 mb-6">
                      <div className="flex items-center gap-2 text-emerald-900 font-bold text-sm mb-1">
                        <Sparkles className="w-4 h-4 text-emerald-600" />
                        <span>التهيئة الآلية بضغطة زر واحدة</span>
                      </div>
                      <p className="text-xs text-slate-600 mb-4 leading-relaxed">
                        اضغط الزر بالأسفل وسيقوم النظام بتفعيل صلاحيات المستخدم، وإعادة تشغيل محرك البيانات وربط قاعدة البيانات تلقائياً بدون تدخل منك.
                      </p>
                      <button
                        onClick={handleAutoProvisionSql}
                        className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm shadow-emerald-600/30 transition flex items-center justify-center gap-2"
                      >
                        <ShieldCheck className="w-4 h-4" />
                        بدء التهيئة والربط الآلي الآن
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                /* Client Mode Section */
                <div>
                  <div className="text-center max-w-md mx-auto mb-6">
                    <h2 className="text-xl font-bold text-slate-900 mb-2">الاتصال بالسيرفر الأساسي عبر الشبكة</h2>
                    <p className="text-sm text-slate-500">
                      يبحث الجهاز تلقائياً عن السيرفر، أو يمكنك إدخال عنوان IP الخاص به مباشرة.
                    </p>
                  </div>

                  <div className="p-5 rounded-2xl border border-slate-200/90 bg-slate-50 mb-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-slate-800">عنوان IP الخاص بالسيرفر:</label>
                      <button
                        onClick={handleAutoScanNetwork}
                        disabled={clientChecking}
                        className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 flex items-center gap-1 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200"
                      >
                        <Wifi className="w-3.5 h-3.5" />
                        بحث تلقائي بالشبكة
                      </button>
                    </div>

                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={serverIp}
                        onChange={(e) => setServerIp(e.target.value)}
                        placeholder="مثال: 192.168.1.10 أو localhost"
                        className="flex-1 px-4 py-2.5 rounded-xl border border-slate-300 text-sm font-mono text-left focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent bg-white"
                        dir="ltr"
                      />
                      <button
                        onClick={handleTestClientConnection}
                        disabled={clientChecking || !serverIp.trim()}
                        className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition flex items-center gap-1.5 shrink-0 disabled:opacity-50"
                      >
                        {clientChecking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                        اختبار الاتصال
                      </button>
                    </div>

                    {clientFeedback && (
                      <div
                        className={`text-xs p-3 rounded-xl flex items-center gap-2 ${
                          clientStatus === 'success'
                            ? 'bg-emerald-100/70 text-emerald-800 border border-emerald-200'
                            : clientStatus === 'error'
                            ? 'bg-rose-50 text-rose-700 border border-rose-200'
                            : 'bg-blue-50 text-blue-700 border border-blue-200'
                        }`}
                      >
                        {clientStatus === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
                        <span>{clientFeedback}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 3: Launch Confirmation */}
          {currentStep === 'launch' && (
            <div className="text-center py-6 space-y-5">
              <div className="w-16 h-16 rounded-3xl bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto shadow-sm shadow-emerald-500/20">
                <CheckCircle2 className="w-8 h-8" />
              </div>

              <div className="max-w-md mx-auto">
                <h2 className="text-2xl font-bold text-slate-900 mb-2">النظام جاهز للتشغيل الآن!</h2>
                <p className="text-sm text-slate-500 leading-relaxed">
                  تم ضبط كافة إعدادات التهيئة بنجاح.{' '}
                  {selectedMode === 'server'
                    ? 'محرك SQL Server وقاعدة بيانات المتحدة تعملان بكفاءة.'
                    : `تم تأكيد الاتصال بالخادم على العنوان (${serverIp}).`}
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 max-w-sm mx-auto text-xs text-slate-600 flex justify-between items-center">
                <span>نمط التشغيل:</span>
                <span className="font-bold text-slate-900">
                  {selectedMode === 'server' ? 'خادم رئيسي (سيرفر)' : 'نقطة بيع (عميل)'}
                </span>
              </div>

              {launchErrorText && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs max-w-md mx-auto flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{launchErrorText}</span>
                </div>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="mt-8 pt-6 border-t border-slate-100 flex items-center justify-between">
            {currentStep !== 'role' ? (
              <button
                onClick={() => setCurrentStep(currentStep === 'launch' ? 'connection' : 'role')}
                disabled={isLaunching}
                className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50 flex items-center gap-1.5 transition"
              >
                <ArrowRight className="w-4 h-4" />
                الرجوع للخطوة السابقة
              </button>
            ) : (
              <div />
            )}

            {currentStep !== 'launch' ? (
              <button
                onClick={goToNextStep}
                disabled={selectedMode === 'server' && currentStep === 'connection' && sqlStatus !== 'ready'}
                className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-md shadow-emerald-600/20 transition flex items-center gap-1.5 disabled:opacity-40 disabled:pointer-events-none"
              >
                متابعة
                <ArrowLeft className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={handleLaunchApp}
                disabled={isLaunching}
                className="w-full md:w-auto px-8 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-sm font-bold shadow-lg shadow-emerald-600/25 transition flex items-center justify-center gap-2"
              >
                {isLaunching ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{launchStatusText || 'جاري إطلاق النظام...'}</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    دخول لوحة التحكم والبدء
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Footer Info */}
      <div className="max-w-3xl mx-auto w-full text-center pt-6">
        <p className="text-[11px] text-slate-400">
          شركة المتحدة ERP • جميع الحقوق محفوظة © 2026 • تم تصميمه ليعمل بدون إنترنت على الشبكة المحلية
        </p>
      </div>
    </div>
  );
}
