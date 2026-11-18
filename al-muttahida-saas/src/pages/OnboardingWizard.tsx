import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import companyLogo from '../assets/company-logo-sm.jpg';
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
  ShieldCheck,
  Loader2,
  Settings,
  ChevronDown,
  ChevronUp,
  Save,
  KeyRound,
  Download,
  Play,
  ExternalLink
} from 'lucide-react';

interface SqlEnvStatus {
  sqlInstalled: boolean;
  sqlRunning: boolean;
  sqlReady: boolean;
  ssmsInstalled: boolean;
  sqlInstallerDownloaded: boolean;
  ssmsInstallerDownloaded: boolean;
  sqlInstallerPath: string;
  ssmsInstallerPath: string;
  recommendedStep: 'download_sql' | 'configure_sql' | 'download_ssms' | 'ready';
}

interface SqlProgressPayload {
  target?: 'sql' | 'ssms';
  step: string;
  percent: number;
  msg: string;
}

interface ElectronAPI {
  startApp: (config: { mode: 'server' | 'client'; serverIp?: string }) => void;
  checkSqlStatus: () => Promise<{ running: boolean; port?: number; error?: string }>;
  checkSqlEnvironment?: () => Promise<SqlEnvStatus>;
  configureSqlDatabase?: () => Promise<{ success: boolean; error?: string }>;
  downloadAndInstallSql: () => Promise<{ success: boolean; error?: string }>;
  downloadSsmsInstaller?: () => Promise<{ success: boolean; path?: string; error?: string }>;
  openDownloadedInstaller?: (target: 'sql' | 'ssms') => Promise<{ success: boolean; error?: string }>;
  openExternalUrl?: (url: string) => Promise<{ success: boolean; error?: string }>;
  saveCustomSqlConfig?: (cfg: {
    host?: string;
    instanceName?: string;
    port?: number;
    dbUser?: string;
    dbPassword?: string;
    database?: string;
    lastSuccessfulServer?: string;
  }) => Promise<{ success: boolean; error?: string }>;
  onSqlProgress: (callback: (data: SqlProgressPayload) => void) => (() => void) | void;
  scanNetwork: () => Promise<string | null>;
  testServerIp: (ip: string) => Promise<{ ok: boolean; error?: string }>;
  closeWindow: () => void;
  onStatus?: (callback: (msg: string) => void) => void;
  onError?: (callback: (err: string) => void) => void;
  onAppStarted?: (callback: (data: { success: boolean; mode: string; apiUrl: string }) => void) => void;
  onNavigate?: (callback: (route: string) => void) => void;
}

const SQL_EXPRESS_URL = 'https://go.microsoft.com/fwlink/p/?linkid=2216019';
const SSMS_DOWNLOAD_URL = 'https://aka.ms/ssmsfullsetup';

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

  // Server & smart SQL/SSMS detection state
  const [sqlStatus, setSqlStatus] = useState<'idle' | 'checking' | 'ready' | 'error'>('idle');
  const [sqlMessage, setSqlMessage] = useState<string>('جاري فحص بيئة قواعد البيانات على الجهاز...');
  const [sqlEnv, setSqlEnv] = useState<SqlEnvStatus | null>(null);
  const [activeProgress, setActiveProgress] = useState<{
    target: 'sql' | 'ssms';
    percent: number;
    msg: string;
  } | null>(null);
  const [downloadingTarget, setDownloadingTarget] = useState<'sql' | 'ssms' | null>(null);
  const [configuringSql, setConfiguringSql] = useState<boolean>(false);
  const [skipSsms, setSkipSsms] = useState<boolean>(false);
  const [sqlSubError, setSqlSubError] = useState<string | null>(null);
  const autoConfigAttemptedRef = useRef<boolean>(false);

  // Advanced SQL configuration
  const [showAdvancedSql, setShowAdvancedSql] = useState<boolean>(false);
  const [customHost, setCustomHost] = useState<string>('localhost');
  const [customInstance, setCustomInstance] = useState<string>('SQLEXPRESS');
  const [customPort, setCustomPort] = useState<string>('1433');
  const [customUser, setCustomUser] = useState<string>('alm_app');
  const [customPassword, setCustomPassword] = useState<string>('Alm@2026#App');
  const [customDbName, setCustomDbName] = useState<string>('AlMuttahida_New');
  const [isSavingCustomSql, setIsSavingCustomSql] = useState<boolean>(false);
  const [customSqlMsg, setCustomSqlMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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

  useEffect(() => {
    if (!window.electronAPI?.onSqlProgress) return;
    const unsubscribe = window.electronAPI.onSqlProgress((data) => {
      setActiveProgress({
        target: data.target || 'sql',
        percent: Math.min(100, Math.max(0, data.percent || 0)),
        msg: data.msg || '',
      });
    });
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, []);

  // Configure existing SQL Server engine and database
  const handleConfigureSql = useCallback(async () => {
    if (!window.electronAPI?.configureSqlDatabase) return;
    setConfiguringSql(true);
    setSqlSubError(null);
    setActiveProgress({ target: 'sql', percent: 35, msg: 'جاري تفعيل خدمة SQL Server وتهيئة قاعدة البيانات...' });
    try {
      const res = await window.electronAPI.configureSqlDatabase();
      if (res && res.success) {
        setActiveProgress({ target: 'sql', percent: 100, msg: 'تم تشغيل وتهيئة قاعدة البيانات بنجاح!' });
        const env = await window.electronAPI.checkSqlEnvironment?.();
        if (env) {
          setSqlEnv(env);
          if (env.sqlReady) {
            setSqlStatus('ready');
            setSqlMessage(
              env.ssmsInstalled
                ? 'محرك SQL Server وأداة SSMS جاهزان للعمل بالكامل.'
                : 'تم تجهيز محرك SQL Server بنجاح! انتقل الآن لتحميل أداة SSMS.'
            );
          }
        } else {
          setSqlStatus('ready');
          setSqlMessage('محرك البيانات وقاعدة بيانات AlMuttahida_New جاهزان للعمل بنجاح.');
        }
        setTimeout(() => setActiveProgress(null), 900);
      } else {
        setSqlSubError(res?.error || 'تعذر تهيئة SQL Server تلقائياً. يرجى التأكد من اكتمال التثبيت ثم إعادة الفحص.');
        setActiveProgress(null);
      }
    } catch (err: any) {
      setSqlSubError('حدث خطأ أثناء تهيئة SQL Server: ' + (err?.message || String(err)));
      setActiveProgress(null);
    } finally {
      setConfiguringSql(false);
    }
  }, []);

  // Smart SQL + SSMS environment check
  const checkSqlEngine = useCallback(
    async (silent = false) => {
      if (!silent) {
        setSqlStatus('checking');
        setSqlSubError(null);
        setSqlMessage('جاري فحص SQL Server وأداة SSMS على هذا الجهاز...');
      }

      if (!window.electronAPI) {
        // Running inside browser / web mode
        setTimeout(() => {
          setSqlStatus('ready');
          setSqlMessage('النظام متصل بالخادم بنجاح عبر المتصفح.');
        }, 400);
        return;
      }

      if (window.electronAPI.checkSqlEnvironment) {
        try {
          const env = await window.electronAPI.checkSqlEnvironment();
          setSqlEnv(env);

          if (env.sqlReady) {
            setSqlStatus('ready');
            setSqlMessage(
              env.ssmsInstalled
                ? 'تم التحقق: محرك SQL Server وأداة SSMS وقاعدة البيانات جاهزون للعمل بنجاح.'
                : 'محرك SQL Server جاهز للعمل. الخطوة التالية هي تثبيت أداة الإدارة SSMS.'
            );
          } else if (env.sqlInstalled) {
            setSqlStatus('error');
            setSqlMessage('تم العثور على SQL Server مثبّتاً على الجهاز، وجاري أو يلزم تفعيل الخدمة وتهيئة قاعدة البيانات.');
            if (!autoConfigAttemptedRef.current && !configuringSql && !downloadingTarget) {
              autoConfigAttemptedRef.current = true;
              void handleConfigureSql();
            }
          } else {
            autoConfigAttemptedRef.current = false;
            setSqlStatus('error');
            setSqlMessage(
              env.sqlInstallerDownloaded
                ? 'ملف تثبيت SQL Server جاهز على جهازك. اضغط تشغيل المثبت ثم أكمل خطوات التثبيت.'
                : 'لم يتم العثور على SQL Server على هذا الجهاز. يرجى تحميله وتثبيته أولاً.'
            );
          }
          return;
        } catch (err: any) {
          if (!silent) {
            setSqlStatus('error');
            setSqlMessage('تعذر فحص بيئة البيانات: ' + (err?.message || String(err)));
          }
          return;
        }
      }

      // Fallback for older IPC
      if (window.electronAPI.checkSqlStatus) {
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
          setSqlMessage('تعذر الاتصال بمحرك البيانات: ' + (err?.message || String(err)));
        }
      }
    },
    [configuringSql, downloadingTarget, handleConfigureSql]
  );

  // Auto-poll environment while waiting for user to finish installing SQL Server or SSMS
  useEffect(() => {
    if (currentStep !== 'connection' || selectedMode !== 'server') return;
    if (!window.electronAPI?.checkSqlEnvironment) return;

    const timer = window.setInterval(() => {
      if (!downloadingTarget && !configuringSql) {
        void checkSqlEngine(true);
      }
    }, 3500);

    return () => window.clearInterval(timer);
  }, [currentStep, selectedMode, downloadingTarget, configuringSql, checkSqlEngine]);

  // Download SQL Server Express and launch installer (or auto-configure if already present)
  const handleDownloadOrStartSql = async () => {
    if (!window.electronAPI?.downloadAndInstallSql) {
      window.open(SQL_EXPRESS_URL, '_blank', 'noopener,noreferrer');
      return;
    }

    setDownloadingTarget('sql');
    setSqlSubError(null);
    setActiveProgress({ target: 'sql', percent: 5, msg: 'جاري بدء تحميل SQL Server Express من مايكروسوفت...' });

    try {
      const res = await window.electronAPI.downloadAndInstallSql();
      if (res && res.success) {
        setTimeout(() => {
          setActiveProgress(null);
          void checkSqlEngine(true);
        }, 900);
      } else {
        setSqlSubError(res?.error || 'تعذر تحميل أو تشغيل مثبّت SQL Server.');
        setActiveProgress(null);
      }
    } catch (e: any) {
      setSqlSubError('حدث خطأ أثناء تحميل SQL Server: ' + (e?.message || String(e)));
      setActiveProgress(null);
    } finally {
      setDownloadingTarget(null);
    }
  };

  // Download SSMS installer and launch it
  const handleDownloadSsms = async () => {
    if (!window.electronAPI?.downloadSsmsInstaller) {
      window.open(SSMS_DOWNLOAD_URL, '_blank', 'noopener,noreferrer');
      return;
    }

    setDownloadingTarget('ssms');
    setSqlSubError(null);
    setActiveProgress({ target: 'ssms', percent: 5, msg: 'جاري تحميل أداة SSMS من مايكروسوفت...' });

    try {
      const res = await window.electronAPI.downloadSsmsInstaller();
      if (res && res.success) {
        setTimeout(() => {
          setActiveProgress(null);
          void checkSqlEngine(true);
        }, 900);
      } else {
        setSqlSubError(res?.error || 'تعذر تحميل أو تشغيل مثبّت SSMS.');
        setActiveProgress(null);
      }
    } catch (e: any) {
      setSqlSubError('حدث خطأ أثناء تحميل SSMS: ' + (e?.message || String(e)));
      setActiveProgress(null);
    } finally {
      setDownloadingTarget(null);
    }
  };

  // Re-launch already downloaded installer (.exe)
  const handleOpenInstaller = async (target: 'sql' | 'ssms') => {
    setSqlSubError(null);
    if (!window.electronAPI?.openDownloadedInstaller) {
      if (target === 'sql') await handleDownloadOrStartSql();
      else await handleDownloadSsms();
      return;
    }
    try {
      const res = await window.electronAPI.openDownloadedInstaller(target);
      if (!res?.success) {
        setSqlSubError(res?.error || 'تعذر فتح المثبت المحمّل. يمكنك إعادة التحميل.');
      }
    } catch (err: any) {
      setSqlSubError(err?.message || String(err));
    }
  };

  // Save custom SQL connection settings
  const handleSaveCustomSql = async () => {
    setIsSavingCustomSql(true);
    setCustomSqlMsg(null);
    try {
      const host = customHost.trim() || 'localhost';
      const instance = customInstance.trim();
      const portNum = customPort.trim() ? Number(customPort.trim()) : 1433;
      const fullTarget = instance ? `${host}\\${instance}` : host;

      if (window.electronAPI?.saveCustomSqlConfig) {
        const res = await window.electronAPI.saveCustomSqlConfig({
          host,
          instanceName: instance || undefined,
          port: portNum,
          dbUser: customUser.trim() || 'alm_app',
          dbPassword: customPassword,
          database: customDbName.trim() || 'AlMuttahida_New',
          lastSuccessfulServer: fullTarget,
        });

        if (res && res.success) {
          setCustomSqlMsg({ type: 'success', text: 'تم حفظ إعدادات الاتصال بنجاح! جاري فحص الاتصال الآن...' });
          setShowAdvancedSql(false);
          setTimeout(() => {
            checkSqlEngine();
          }, 800);
        } else {
          setCustomSqlMsg({ type: 'error', text: res?.error || 'فشل حفظ الإعدادات' });
        }
      } else {
        setCustomSqlMsg({ type: 'success', text: 'تم حفظ الإعدادات تجريبياً! جاري فحص الاتصال...' });
        setShowAdvancedSql(false);
        setTimeout(() => {
          checkSqlEngine();
        }, 800);
      }
    } catch (err: any) {
      setCustomSqlMsg({ type: 'error', text: 'خطأ: ' + (err.message || String(err)) });
    } finally {
      setIsSavingCustomSql(false);
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
    } else if (selectedMode === 'server') {
      localStorage.removeItem('server_api_url');
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
    <div className="h-[100dvh] overflow-y-auto overflow-x-hidden bg-slate-50 text-slate-800 flex flex-col justify-between p-4 md:p-8 custom-scrollbar" dir="rtl">
      {/* Top Header */}
      <div className="max-w-3xl mx-auto w-full pt-4">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl overflow-hidden shadow-md shadow-blue-500/20 border border-slate-200/70 bg-[#0f245c] shrink-0">
              <img
                src={companyLogo}
                alt="شركة المتحدة"
                className="w-full h-full object-cover"
              />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">شركة المتحدة ERP</h1>
              <p className="text-xs text-slate-500 font-medium">معالج الإعداد والتهيئة التلقائية للنظام</p>
            </div>
          </div>
        </div>

        {/* Stepper Progress Bar */}
        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm mb-6">
          <div className="flex items-center justify-between relative">
            <div className="absolute top-[18px] right-8 left-8 -translate-y-1/2 h-0.5 bg-slate-100 -z-0 overflow-hidden rounded-full">
              <div
                className="h-full bg-blue-600 transition-all duration-500 rounded-full"
                style={{
                  width: currentStep === 'role' ? '0%' : currentStep === 'connection' ? '50%' : '100%'
                }}
              />
            </div>

            {/* Step 1 */}
            <div className="relative z-10 flex flex-col items-center gap-1.5 bg-white px-2">
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold transition-all ${
                  currentStep === 'role'
                    ? 'bg-[#1e40af] text-white shadow-md shadow-blue-600/30'
                    : 'bg-blue-100 text-blue-800'
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
                    ? 'bg-[#1e40af] text-white shadow-md shadow-blue-600/30'
                    : currentStep === 'launch'
                    ? 'bg-blue-100 text-blue-800'
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
                    ? 'bg-[#1e40af] text-white shadow-md shadow-blue-600/30'
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
                      ? 'border-blue-600 bg-blue-50/40 shadow-sm'
                      : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/50'
                  }`}
                >
                  {selectedMode === 'server' && (
                    <span className="absolute top-4 left-4 w-6 h-6 rounded-full bg-[#1e40af] text-white flex items-center justify-center text-xs">
                      <CheckCircle2 className="w-4 h-4" />
                    </span>
                  )}
                  <div>
                    <div className="w-12 h-12 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center mb-4">
                      <Server className="w-6 h-6" />
                    </div>
                    <h3 className="text-base font-bold text-slate-900 mb-1.5">جهاز رئيسي (خادم / Server)</h3>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      الجهاز الأساسي اللي عليه البيانات والمعاملات. يشغل محرك SQL Server وتتصل به باقي الأجهزة في المنشأة.
                    </p>
                  </div>
                  <span className="mt-4 text-[11px] font-semibold text-blue-700 bg-blue-100/70 py-1 px-2.5 rounded-lg w-fit">
                    موصى به للجهاز الرئيسي
                  </span>
                </div>

                {/* Client Card */}
                <div
                  onClick={() => setSelectedMode('client')}
                  className={`p-6 rounded-2xl border-2 cursor-pointer transition-all relative flex flex-col justify-between ${
                    selectedMode === 'client'
                      ? 'border-blue-600 bg-blue-50/40 shadow-sm'
                      : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/50'
                  }`}
                >
                  {selectedMode === 'client' && (
                    <span className="absolute top-4 left-4 w-6 h-6 rounded-full bg-[#1e40af] text-white flex items-center justify-center text-xs">
                      <CheckCircle2 className="w-4 h-4" />
                    </span>
                  )}
                  <div>
                    <div className="w-12 h-12 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center mb-4">
                      <Laptop className="w-6 h-6" />
                    </div>
                    <h3 className="text-base font-bold text-slate-900 mb-1.5">جهاز فرعي (عميل / Client)</h3>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      أي جهاز كاشير أو كمبيوتر آخر في المحل. لا يحتاج تثبيت SQL Server ويتصل مباشرة بالسيرفر عبر الراوتر.
                    </p>
                  </div>
                  <span className="mt-4 text-[11px] font-semibold text-indigo-700 bg-indigo-100/70 py-1 px-2.5 rounded-lg w-fit">
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
                <div className="space-y-5">
                  <div className="text-center max-w-lg mx-auto mb-2">
                    <h2 className="text-xl font-bold text-slate-900 mb-1.5">التجهيز الذكي لمحرك قواعد البيانات</h2>
                    <p className="text-sm text-slate-500 leading-relaxed">
                      يفحص النظام جهازك تلقائياً ويقودك خطوة بخطوة لتجهيز <strong className="text-slate-700">SQL Server</strong> وأداة الإدارة <strong className="text-slate-700">SSMS</strong>.
                    </p>
                  </div>

                  {/* Overall Smart Status Banner */}
                  <div
                    className={`p-4 rounded-2xl border transition-colors ${
                      sqlStatus === 'ready'
                        ? 'border-emerald-200 bg-emerald-50/50'
                        : sqlStatus === 'error'
                        ? 'border-amber-200 bg-amber-50/40'
                        : 'border-slate-200 bg-slate-50'
                    }`}
                  >
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
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <span className="text-sm font-bold text-slate-900">حالة بيئة البيانات</span>
                            <span
                              className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${
                                sqlStatus === 'ready'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : sqlStatus === 'error'
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-blue-100 text-blue-800'
                              }`}
                            >
                              {sqlStatus === 'ready'
                                ? 'المحرك جاهز'
                                : sqlStatus === 'error'
                                ? 'يحتاج خطوة إعداد'
                                : 'جاري الفحص...'}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600 leading-relaxed">{sqlMessage}</p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => void checkSqlEngine(false)}
                        disabled={sqlStatus === 'checking' || Boolean(downloadingTarget) || configuringSql}
                        className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-1.5 transition shrink-0 disabled:opacity-50"
                      >
                        <RefreshCw
                          className={`w-3.5 h-3.5 ${
                            sqlStatus === 'checking' || configuringSql ? 'animate-spin' : ''
                          }`}
                        />
                        إعادة فحص
                      </button>
                    </div>
                  </div>

                  {/* Inline Action Error Notice */}
                  {sqlSubError && (
                    <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2.5">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span className="leading-relaxed">{sqlSubError}</span>
                    </div>
                  )}

                  {/* Smart Step-by-Step Checklist */}
                  {window.electronAPI?.checkSqlEnvironment ? (
                    <div className="space-y-3">
                      {/* STEP A: SQL Server Engine */}
                      {(() => {
                        const sqlDone = Boolean(sqlEnv?.sqlReady);
                        const sqlActive = !sqlDone;
                        const sqlProgress = activeProgress?.target === 'sql' ? activeProgress : null;
                        return (
                          <div
                            className={`rounded-2xl border p-4 transition-all ${
                              sqlDone
                                ? 'border-emerald-200 bg-emerald-50/30'
                                : sqlActive
                                ? 'border-blue-300 bg-blue-50/30 shadow-sm'
                                : 'border-slate-200 bg-white'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-start gap-3">
                                <div
                                  className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 ${
                                    sqlDone
                                      ? 'bg-emerald-600 text-white'
                                      : 'bg-[#1e40af] text-white'
                                  }`}
                                >
                                  {sqlDone ? <CheckCircle2 className="w-4 h-4" /> : '1'}
                                </div>
                                <div className="space-y-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <h3 className="text-sm font-bold text-slate-900">
                                      محرك قواعد البيانات (SQL Server Express)
                                    </h3>
                                    {sqlDone && (
                                      <span className="text-[11px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                                        مكتمل ويعمل
                                      </span>
                                    )}
                                    {!sqlDone && sqlEnv?.sqlInstalled && (
                                      <span className="text-[11px] font-bold text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">
                                        مثبّت وبانتظار التشغيل
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-xs text-slate-600 leading-relaxed">
                                    {sqlDone
                                      ? 'تم تثبيت المحرك وتشغيل الخدمة وربط قاعدة البيانات بنجاح.'
                                      : sqlEnv?.sqlInstalled
                                      ? 'تم العثور على SQL Server مثبّتاً على جهازك. سيقوم النظام بتفعيله وتجهيز قاعدة البيانات.'
                                      : 'لم يتم العثور على SQL Server على هذا الجهاز. يلزم تحميله وتثبيته ليتمكن الجهاز الرئيسي من حفظ البيانات.'}
                                  </p>
                                </div>
                              </div>
                            </div>

                            {sqlProgress && (
                              <div className="mt-3 pt-3 border-t border-blue-200/60">
                                <div className="flex justify-between text-xs text-slate-700 font-medium mb-1.5">
                                  <span>{sqlProgress.msg}</span>
                                  <span className="font-bold text-blue-700">{sqlProgress.percent}%</span>
                                </div>
                                <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-gradient-to-r from-blue-600 to-indigo-600 transition-all duration-300"
                                    style={{ width: `${sqlProgress.percent}%` }}
                                  />
                                </div>
                              </div>
                            )}

                            {!sqlDone && !sqlProgress && (
                              <div className="mt-3.5 flex flex-wrap items-center gap-2.5 pr-11">
                                {sqlEnv?.sqlInstalled ? (
                                  <button
                                    type="button"
                                    onClick={() => void handleConfigureSql()}
                                    disabled={configuringSql}
                                    className="px-4 py-2 rounded-xl bg-[#1e40af] hover:bg-[#1d4ed8] text-white text-xs font-bold shadow-sm transition flex items-center gap-2 disabled:opacity-60"
                                  >
                                    {configuringSql ? (
                                      <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                      <ShieldCheck className="w-4 h-4" />
                                    )}
                                    تفعيل وتشغيل قاعدة البيانات الآن
                                  </button>
                                ) : sqlEnv?.sqlInstallerDownloaded ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => void handleOpenInstaller('sql')}
                                      disabled={Boolean(downloadingTarget)}
                                      className="px-4 py-2 rounded-xl bg-[#1e40af] hover:bg-[#1d4ed8] text-white text-xs font-bold shadow-sm transition flex items-center gap-2"
                                    >
                                      <Play className="w-3.5 h-3.5" />
                                      تشغيل مثبّت SQL Server
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void handleDownloadOrStartSql()}
                                      disabled={Boolean(downloadingTarget)}
                                      className="px-3 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition flex items-center gap-1.5"
                                    >
                                      <Download className="w-3.5 h-3.5" />
                                      إعادة التحميل
                                    </button>
                                    <span className="text-[11px] text-slate-500">
                                      أكمل خطوات التثبيت في النافذة المفتوحة وسيتقدم المعالج تلقائياً.
                                    </span>
                                  </>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => void handleDownloadOrStartSql()}
                                    disabled={Boolean(downloadingTarget)}
                                    className="px-5 py-2.5 rounded-xl bg-[#1e40af] hover:bg-[#1d4ed8] text-white text-xs font-bold shadow-sm shadow-blue-600/20 transition flex items-center gap-2 disabled:opacity-60"
                                  >
                                    <Download className="w-4 h-4" />
                                    تحميل وتثبيت SQL Server
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* STEP B: SSMS Tool */}
                      {(() => {
                        const sqlDone = Boolean(sqlEnv?.sqlReady);
                        const ssmsDone = Boolean(sqlEnv?.ssmsInstalled);
                        const ssmsActive = sqlDone && !ssmsDone && !skipSsms;
                        const ssmsProgress = activeProgress?.target === 'ssms' ? activeProgress : null;
                        return (
                          <div
                            className={`rounded-2xl border p-4 transition-all ${
                              ssmsDone
                                ? 'border-emerald-200 bg-emerald-50/30'
                                : ssmsActive
                                ? 'border-blue-300 bg-blue-50/30 shadow-sm'
                                : 'border-slate-200 bg-white/80'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-start gap-3">
                                <div
                                  className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 ${
                                    ssmsDone
                                      ? 'bg-emerald-600 text-white'
                                      : ssmsActive
                                      ? 'bg-[#1e40af] text-white'
                                      : 'bg-slate-200 text-slate-600'
                                  }`}
                                >
                                  {ssmsDone ? <CheckCircle2 className="w-4 h-4" /> : '2'}
                                </div>
                                <div className="space-y-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <h3 className="text-sm font-bold text-slate-900">
                                      أداة إدارة قاعدة البيانات (SSMS)
                                    </h3>
                                    {ssmsDone ? (
                                      <span className="text-[11px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                                        مثبّت وجاهز
                                      </span>
                                    ) : skipSsms ? (
                                      <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full">
                                        تم التخطي مؤقتاً
                                      </span>
                                    ) : (
                                      <span className="text-[11px] font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full">
                                        مطلوب للإدارة والنسخ الاحتياطي
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-xs text-slate-600 leading-relaxed">
                                    {ssmsDone
                                      ? 'أداة SQL Server Management Studio (SSMS) مثبّتة وجاهزة على جهازك.'
                                      : 'تحتاج أيضاً إلى تحميل وتثبيت أداة SSMS لسهولة إدارة قاعدة البيانات، متابعة الجداول، واستعادة النسخ الاحتياطية.'}
                                  </p>
                                </div>
                              </div>
                            </div>

                            {ssmsProgress && (
                              <div className="mt-3 pt-3 border-t border-blue-200/60">
                                <div className="flex justify-between text-xs text-slate-700 font-medium mb-1.5">
                                  <span>{ssmsProgress.msg}</span>
                                  <span className="font-bold text-blue-700">{ssmsProgress.percent}%</span>
                                </div>
                                <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-gradient-to-r from-blue-600 to-indigo-600 transition-all duration-300"
                                    style={{ width: `${ssmsProgress.percent}%` }}
                                  />
                                </div>
                              </div>
                            )}

                            {!ssmsDone && !ssmsProgress && (
                              <div className="mt-3.5 flex flex-wrap items-center gap-2.5 pr-11">
                                {sqlEnv?.ssmsInstallerDownloaded ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => void handleOpenInstaller('ssms')}
                                      disabled={Boolean(downloadingTarget)}
                                      className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
                                        ssmsActive
                                          ? 'bg-[#1e40af] hover:bg-[#1d4ed8] text-white shadow-sm'
                                          : 'border border-slate-300 bg-white hover:bg-slate-50 text-slate-700'
                                      }`}
                                    >
                                      <Play className="w-3.5 h-3.5" />
                                      تشغيل مثبّت SSMS
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void handleDownloadSsms()}
                                      disabled={Boolean(downloadingTarget)}
                                      className="px-3 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition flex items-center gap-1.5"
                                    >
                                      <Download className="w-3.5 h-3.5" />
                                      إعادة التحميل
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => void handleDownloadSsms()}
                                    disabled={Boolean(downloadingTarget)}
                                    className={`px-5 py-2.5 rounded-xl text-xs font-bold transition flex items-center gap-2 disabled:opacity-60 ${
                                      ssmsActive
                                        ? 'bg-[#1e40af] hover:bg-[#1d4ed8] text-white shadow-sm shadow-blue-600/20'
                                        : 'border border-blue-300 bg-white hover:bg-blue-50 text-blue-700'
                                    }`}
                                  >
                                    <Download className="w-4 h-4" />
                                    تحميل وتثبيت SSMS
                                  </button>
                                )}

                                {sqlDone && !skipSsms && (
                                  <button
                                    type="button"
                                    onClick={() => setSkipSsms(true)}
                                    className="px-3 py-2 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition"
                                  >
                                    تخطي الآن والمتابعة
                                  </button>
                                )}
                                {skipSsms && (
                                  <button
                                    type="button"
                                    onClick={() => setSkipSsms(false)}
                                    className="px-3 py-2 rounded-xl text-xs font-semibold text-blue-600 hover:bg-blue-50 transition"
                                  >
                                    الرجوع لخيار التثبيت
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* STEP C: Ready Summary */}
                      <div
                        className={`rounded-2xl border p-4 transition-all ${
                          sqlStatus === 'ready' && (sqlEnv?.ssmsInstalled || skipSsms)
                            ? 'border-emerald-200 bg-emerald-50/40'
                            : 'border-slate-200 bg-slate-50/60'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <div
                              className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold shrink-0 ${
                                sqlStatus === 'ready' && (sqlEnv?.ssmsInstalled || skipSsms)
                                  ? 'bg-emerald-600 text-white'
                                  : 'bg-slate-200 text-slate-600'
                              }`}
                            >
                              {sqlStatus === 'ready' && (sqlEnv?.ssmsInstalled || skipSsms) ? (
                                <CheckCircle2 className="w-4 h-4" />
                              ) : (
                                '3'
                              )}
                            </div>
                            <div>
                              <h3 className="text-sm font-bold text-slate-900">
                                قاعدة بيانات المتحدة والجاهزية النهائية
                              </h3>
                              <p className="text-xs text-slate-600">
                                {sqlStatus === 'ready' && (sqlEnv?.ssmsInstalled || skipSsms)
                                  ? 'جميع المتطلبات جاهزة! يمكنك الضغط على (متابعة) للبدء فوراً.'
                                  : !sqlEnv?.sqlReady
                                  ? 'سيتم ربط قاعدة البيانات تلقائياً بمجرد اكتمال تثبيت SQL Server.'
                                  : 'تم ربط قاعدة البيانات بنجاح. أكمل تثبيت SSMS أو اختر التخطي للمتابعة.'}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* Clean Browser / Web Mode Fallback */
                    <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50/70 space-y-3">
                      <p className="text-xs text-slate-600 leading-relaxed">
                        أنت تستخدم المعالج عبر المتصفح. لتثبيت متطلبات قاعدة البيانات محلياً على السيرفر يمكنك التحميل مباشرة:
                      </p>
                      <div className="flex flex-wrap gap-2.5">
                        <a
                          href={SQL_EXPRESS_URL}
                          target="_blank"
                          rel="noreferrer"
                          className="px-4 py-2 rounded-xl bg-[#1e40af] hover:bg-[#1d4ed8] text-white text-xs font-bold inline-flex items-center gap-2 transition"
                        >
                          <Download className="w-3.5 h-3.5" />
                          تحميل SQL Server Express
                          <ExternalLink className="w-3 h-3 opacity-80" />
                        </a>
                        <a
                          href={SSMS_DOWNLOAD_URL}
                          target="_blank"
                          rel="noreferrer"
                          className="px-4 py-2 rounded-xl border border-blue-300 bg-white hover:bg-blue-50 text-blue-700 text-xs font-bold inline-flex items-center gap-2 transition"
                        >
                          <Download className="w-3.5 h-3.5" />
                          تحميل أداة SSMS
                          <ExternalLink className="w-3 h-3 opacity-80" />
                        </a>
                      </div>
                    </div>
                  )}

                  {/* Advanced Custom SQL Configuration Card */}
                  <div className="rounded-2xl border border-slate-200 overflow-hidden bg-white mb-4">
                    <button
                      type="button"
                      onClick={() => setShowAdvancedSql(!showAdvancedSql)}
                      className="w-full px-5 py-3.5 bg-slate-50/70 hover:bg-slate-100/70 flex items-center justify-between text-xs font-bold text-slate-700 transition"
                    >
                      <div className="flex items-center gap-2">
                        <Settings className="w-4 h-4 text-slate-500" />
                        <span>إعدادات الاتصال المتقدمة بمحرك SQL Server (تخصيص الخادم / النسخة / المستخدم)</span>
                      </div>
                      {showAdvancedSql ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                    </button>

                    {showAdvancedSql && (
                      <div className="p-5 border-t border-slate-200 space-y-4 bg-slate-50/30">
                        <p className="text-[11px] text-slate-500 leading-relaxed">
                          إذا قمت بتثبيت SQL Server بشكل يدوي باسم نسخة معين (مثل <code className="font-mono bg-slate-100 px-1 py-0.5 rounded text-blue-700">SQLEXPRESS</code>) أو مستخدم مخصص، يمكنك حفظ إعداداته هنا مباشرة وسيقوم النظام بربطها فوراً.
                        </p>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                          <div>
                            <label className="block font-bold text-slate-700 mb-1">اسم الخادم / Server Host:</label>
                            <input
                              type="text"
                              value={customHost}
                              onChange={(e) => setCustomHost(e.target.value)}
                              placeholder="localhost أو 127.0.0.1"
                              className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-mono bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                              dir="ltr"
                            />
                          </div>

                          <div>
                            <label className="block font-bold text-slate-700 mb-1">اسم النسخة / Instance Name (اختياري):</label>
                            <input
                              type="text"
                              value={customInstance}
                              onChange={(e) => setCustomInstance(e.target.value)}
                              placeholder="SQLEXPRESS أو اتركه فارغاً"
                              className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-mono bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                              dir="ltr"
                            />
                          </div>

                          <div>
                            <label className="block font-bold text-slate-700 mb-1">المستخدم / DB User:</label>
                            <input
                              type="text"
                              value={customUser}
                              onChange={(e) => setCustomUser(e.target.value)}
                              placeholder="alm_app أو sa"
                              className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-mono bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                              dir="ltr"
                            />
                          </div>

                          <div>
                            <label className="block font-bold text-slate-700 mb-1">كلمة المرور / Password:</label>
                            <div className="relative">
                              <input
                                type="password"
                                value={customPassword}
                                onChange={(e) => setCustomPassword(e.target.value)}
                                placeholder="Alm@2026#App"
                                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-mono bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                dir="ltr"
                              />
                              <KeyRound className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                            </div>
                          </div>

                          <div>
                            <label className="block font-bold text-slate-700 mb-1">منفذ TCP Port (افتراضي 1433):</label>
                            <input
                              type="text"
                              value={customPort}
                              onChange={(e) => setCustomPort(e.target.value)}
                              placeholder="1433"
                              className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-mono bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                              dir="ltr"
                            />
                          </div>

                          <div>
                            <label className="block font-bold text-slate-700 mb-1">اسم قاعدة البيانات / Database Name:</label>
                            <input
                              type="text"
                              value={customDbName}
                              onChange={(e) => setCustomDbName(e.target.value)}
                              placeholder="AlMuttahida_New"
                              className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-mono bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                              dir="ltr"
                            />
                          </div>
                        </div>

                        {customSqlMsg && (
                          <div
                            className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                              customSqlMsg.type === 'success'
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                : 'bg-rose-50 text-rose-700 border border-rose-200'
                            }`}
                          >
                            {customSqlMsg.type === 'success' ? (
                              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                            ) : (
                              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                            )}
                            <span>{customSqlMsg.text}</span>
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={handleSaveCustomSql}
                          disabled={isSavingCustomSql}
                          className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition flex items-center gap-1.5 shadow-sm disabled:opacity-50"
                        >
                          {isSavingCustomSql ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                          حفظ الإعدادات وفحص الاتصال
                        </button>
                      </div>
                    )}
                  </div>
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
                        className="text-xs font-semibold text-blue-700 hover:text-blue-800 flex items-center gap-1 bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-200"
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
                        className="flex-1 px-4 py-2.5 rounded-xl border border-slate-300 text-sm font-mono text-left focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
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
              <div className="flex items-center gap-3">
                {selectedMode === 'server' &&
                  currentStep === 'connection' &&
                  sqlStatus === 'ready' &&
                  Boolean(window.electronAPI?.checkSqlEnvironment) &&
                  !sqlEnv?.ssmsInstalled &&
                  !skipSsms && (
                    <span className="text-[11px] text-amber-700 font-medium hidden sm:inline">
                      ثبّت أداة SSMS أو اختر تخطي للمتابعة
                    </span>
                  )}
                <button
                  onClick={goToNextStep}
                  disabled={
                    selectedMode === 'server' &&
                    currentStep === 'connection' &&
                    (sqlStatus !== 'ready' ||
                      (Boolean(window.electronAPI?.checkSqlEnvironment) &&
                        !sqlEnv?.ssmsInstalled &&
                        !skipSsms))
                  }
                  className="px-6 py-2.5 rounded-xl bg-[#1e40af] hover:bg-[#1d4ed8] text-white text-xs font-bold shadow-md shadow-blue-600/20 transition flex items-center gap-1.5 disabled:opacity-40 disabled:pointer-events-none"
                >
                  متابعة
                  <ArrowLeft className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                onClick={handleLaunchApp}
                disabled={isLaunching}
                className="w-full md:w-auto px-8 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-700 hover:from-blue-700 hover:to-indigo-800 text-white text-sm font-bold shadow-lg shadow-blue-600/25 transition flex items-center justify-center gap-2"
              >
                {isLaunching ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{launchStatusText || 'جاري إطلاق النظام...'}</span>
                  </>
                ) : (
                  <>
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
