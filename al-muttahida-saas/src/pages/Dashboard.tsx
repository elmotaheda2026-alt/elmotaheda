import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Receipt,
  UserCircle,
  Truck,
  Banknote,
  ClipboardList,
  PieChart,
  Plus,
  Calendar,
  CheckCircle2,
  Keyboard,
  ArrowLeft,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { formatDateDisplay } from '../lib/dateUtils';

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, settings } = useAuth();
  const todayStr = new Date().toISOString().split('T')[0];

  const roleLabel =
    user?.role === 'admin'
      ? 'مدير النظام'
      : user?.role === 'manager'
        ? 'مشرف'
        : user?.role === 'accountant'
          ? 'محاسب'
          : 'مستخدم';

  const quickCards = [
    {
      title: 'إصدار فاتورة بيع',
      description: 'إنشاء وعرض فواتير البيع للعملاء',
      path: '/invoices',
      icon: Receipt,
      iconBg: 'bg-blue-50 text-blue-600 border-blue-100',
    },
    {
      title: 'دليل العملاء',
      description: 'متابعة بيانات العملاء والسداد',
      path: '/customers',
      icon: UserCircle,
      iconBg: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    },
    {
      title: 'سجل الموردين',
      description: 'إدارة الموردين وحسابات التوريد',
      path: '/suppliers',
      icon: Truck,
      iconBg: 'bg-amber-50 text-amber-600 border-amber-100',
    },
    {
      title: 'حركة الخزينة',
      description: 'إدارة التحصيلات والنقدية',
      path: '/payments',
      icon: Banknote,
      iconBg: 'bg-purple-50 text-purple-600 border-purple-100',
    },
    {
      title: 'سجل المصروفات',
      description: 'تسجيل ومتابعة المصاريف التشغيلية',
      path: '/expenses',
      icon: ClipboardList,
      iconBg: 'bg-rose-50 text-rose-600 border-rose-100',
    },
    {
      title: 'التقارير الشاملة',
      description: 'عرض تقارير الحركة اليومية',
      path: '/accounts',
      icon: PieChart,
      iconBg: 'bg-indigo-50 text-indigo-600 border-indigo-100',
    },
  ];

  return (
    <div className="space-y-6 pb-6 animate-fadeIn">
      {/* 1. Hero Header Banner (Premium Look without heavy dark shadows) */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950 to-blue-900 p-6 sm:p-8 text-white border border-slate-800 shadow-none">
        {/* Subtle decorative background light */}
        <div className="absolute -left-10 -top-10 h-48 w-48 rounded-full bg-blue-500/10 blur-2xl pointer-events-none" />
        <div className="absolute right-1/3 bottom-0 h-40 w-40 rounded-full bg-indigo-500/10 blur-xl pointer-events-none" />

        <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1 text-xs font-semibold text-blue-200 backdrop-blur-xs border border-white/10">
              <Calendar size={14} />
              <span>{formatDateDisplay(todayStr)}</span>
            </div>
            <h1 className="text-2xl font-black tracking-tight sm:text-3xl text-white">
              {settings.companyName || 'شركة المتحدة'} لإدارة المبيعات والحسابات
            </h1>
            <p className="text-sm font-medium text-slate-300 leading-relaxed">
              مرحباً بك، {user?.name || roleLabel} 👋 — بيئة عمل مخصصة لإدارة العمليات والمبيعات اليومية بسرعة وسهولة.
            </p>
          </div>

          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={() => navigate('/invoices')}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white transition-all hover:bg-blue-500 active:scale-98 border border-blue-500/30"
            >
              <Plus size={18} />
              <span>إصدار فاتورة جديدة</span>
              <ArrowLeft size={16} />
            </button>
          </div>
        </div>
      </section>

      {/* 2. Quick Access Modules Grid (6 Clean Border Cards) */}
      <section>
        <h2 className="mb-3 text-sm font-bold text-slate-500 px-1">الوصول السريع إلى أقسام النظام</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {quickCards.map((card) => {
            const Icon = card.icon;
            return (
              <div
                key={card.title}
                onClick={() => navigate(card.path)}
                className="group flex items-center gap-4 rounded-xl border border-slate-200/80 bg-white p-5 shadow-none transition-all duration-200 hover:border-slate-300 cursor-pointer"
              >
                <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border ${card.iconBg}`}>
                  <Icon size={22} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-bold text-sm text-slate-900 group-hover:text-blue-600 transition-colors truncate">
                      {card.title}
                    </h3>
                    <ArrowLeft size={15} className="text-slate-300 group-hover:text-blue-600 group-hover:-translate-x-1 transition-all shrink-0" />
                  </div>
                  <p className="mt-1 text-xs text-slate-500 truncate font-medium">{card.description}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 3. Desktop Power-User Info Footer Strip */}
      <section className="flex flex-col sm:flex-row items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-white px-5 py-3 text-xs font-bold text-slate-600 shadow-none">
        <div className="flex items-center gap-2 text-emerald-700 bg-emerald-50/80 px-3 py-1.5 rounded-lg border border-emerald-100">
          <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
          <span>النظام يعمل بنجاح — التزامن نشط</span>
        </div>

        <div className="flex items-center gap-3 text-slate-500 font-mono">
          <div className="flex items-center gap-1.5">
            <Keyboard size={15} className="text-slate-400 shrink-0" />
            <span>اختصارات لوحة التحكم:</span>
          </div>
          <span className="bg-slate-100 px-2 py-0.5 rounded text-slate-700 font-bold border border-slate-200/60">F2: فاتورة جديدة</span>
          <span className="text-slate-300">|</span>
          <span className="bg-slate-100 px-2 py-0.5 rounded text-slate-700 font-bold border border-slate-200/60">F5: تحديث</span>
          <span className="text-slate-300">|</span>
          <span className="bg-slate-100 px-2 py-0.5 rounded text-slate-700 font-bold border border-slate-200/60">Esc: إغلاق</span>
        </div>
      </section>
    </div>
  );
}
