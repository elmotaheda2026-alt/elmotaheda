import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building, Landmark, Save, ArrowLeft, CheckCircle2, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { saveOpeningBalances } from '../lib/storage';

export default function OnboardingWizard() {
  const { settings, updateSettings } = useAuth();
  const navigate = useNavigate();

  const [companyInfo, setCompanyInfo] = useState({
    companyName: settings.companyName || 'شركة المتحدة',
    companyAddress: settings.companyAddress || '',
    companyPhone: settings.companyPhone || '01001207474',
    companyEmail: settings.companyEmail || 'info@almuttahida.com',
  });

  const [obData, setObData] = useState({
    startingCashBalance: 0,
    startingReceivables: 0,
    startingPayables: 0,
    startingInventoryValue: 0,
  });

  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      // 1. Save Company Settings and mark isConfigured
      updateSettings({
        ...settings,
        companyName: companyInfo.companyName,
        companyAddress: companyInfo.companyAddress,
        companyPhone: companyInfo.companyPhone,
        companyEmail: companyInfo.companyEmail,
        isConfigured: true,
      });

      // 2. Save Opening Balances
      saveOpeningBalances(obData);

      // 3. Mark configured flag in LocalStorage for quick startup checks
      localStorage.setItem('almuttahida_configured', 'true');

      // 4. Redirect to Main Dashboard
      setTimeout(() => {
        navigate('/', { replace: true });
      }, 500);
    } catch (err) {
      console.error('Failed to complete setup wizard:', err);
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center p-4 md:p-8 dir-rtl" dir="rtl">
      <div className="bg-slate-800 border border-slate-700 rounded-3xl max-w-2xl w-full p-6 md:p-10 shadow-2xl space-y-8">
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="w-16 h-16 bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 rounded-2xl flex items-center justify-center mx-auto shadow-inner">
            <ShieldCheck size={36} />
          </div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-white">
            مرحباً بك في نظام المتحدة إدارة المبيعات والأقساط
          </h1>
          <p className="text-slate-400 text-sm max-w-lg mx-auto leading-relaxed">
            يرجى ضبط بيانات الشركة والأرصدة الافتتاحية لبدء تشغيل النظام بدقة محاسبية 100%
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Section 1: Company Info */}
          <div className="bg-slate-800/80 rounded-2xl p-5 border border-slate-700/80 space-y-4">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Building size={20} className="text-indigo-400" />
              <span>1. بيانات الشركة والاتصال</span>
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-slate-200">
              <div>
                <label className="block text-xs font-semibold mb-1 text-slate-300">اسم الشركة</label>
                <input
                  type="text"
                  required
                  value={companyInfo.companyName}
                  onChange={(e) => setCompanyInfo({ ...companyInfo, companyName: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                  placeholder="شركة المتحدة"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1 text-slate-300">رقم الهاتف</label>
                <input
                  type="text"
                  required
                  value={companyInfo.companyPhone}
                  onChange={(e) => setCompanyInfo({ ...companyInfo, companyPhone: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                  placeholder="01001207474"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-semibold mb-1 text-slate-300">العنوان</label>
                <input
                  type="text"
                  value={companyInfo.companyAddress}
                  onChange={(e) => setCompanyInfo({ ...companyInfo, companyAddress: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                  placeholder="الشارع المقابل للبوابة الخلفية للمستشفى العام"
                />
              </div>
            </div>
          </div>

          {/* Section 2: Opening Balances */}
          <div className="bg-slate-800/80 rounded-2xl p-5 border border-slate-700/80 space-y-4">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Landmark size={20} className="text-emerald-400" />
              <span>2. الأرصدة الافتتاحية للنظام (ترحيل البيانات)</span>
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold mb-1 text-slate-300">
                  الرصيد الافتتاحي للخزينة (جنيه)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={obData.startingCashBalance}
                  onChange={(e) => setObData({ ...obData, startingCashBalance: Number(e.target.value) })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1 text-slate-300">
                  إجمالي ديون العملاء الافتتاحية (جنيه)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={obData.startingReceivables}
                  onChange={(e) => setObData({ ...obData, startingReceivables: Number(e.target.value) })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1 text-slate-300">
                  إجمالي مستحقات الموردين الافتتاحية (جنيه)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={obData.startingPayables}
                  onChange={(e) => setObData({ ...obData, startingPayables: Number(e.target.value) })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1 text-slate-300">
                  قيمة بضاعة أول المدة (المخزون الافتتاحي)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={obData.startingInventoryValue}
                  onChange={(e) => setObData({ ...obData, startingInventoryValue: Number(e.target.value) })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500"
                  placeholder="0.00"
                />
              </div>
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-4 rounded-2xl shadow-lg shadow-indigo-600/30 transition-all text-base disabled:opacity-50"
          >
            <CheckCircle2 size={20} />
            <span>{submitting ? 'جاري حفظ تهيئة النظام...' : 'إتمام التهيئة وبدء استخدام النظام'}</span>
          </button>
        </form>
      </div>
    </div>
  );
}
