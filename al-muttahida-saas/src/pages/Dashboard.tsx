import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Receipt,
  UserCircle,
  Truck,
  Banknote,
  ClipboardList,
  PieChart,
  Calculator,
  Plus,
  Calendar,
  ArrowLeft,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { formatDateDisplay } from '../lib/dateUtils';
import { isAdmin } from '../lib/permissions';
import CompanyLogo from '../components/CompanyLogo';

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
      title: 'التقارير والقيود المالية',
      description: 'متابعة الأرباح والسيولة وميزان المراجعة',
      path: '/accounts',
      icon: Calculator,
      iconBg: 'bg-indigo-50 text-indigo-600 border-indigo-100',
      adminOnly: true,
    },
  ].filter((card) => !card.adminOnly || isAdmin(user) || user?.role === 'manager');

  return (
    <div className="space-y-6 pb-6 animate-fadeIn">
      {/* 1. Executive Branded Hero Section with Ambient Background */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-l from-slate-900 via-indigo-950 to-blue-950 p-6 sm:p-7 border border-slate-800/80 shadow-md text-white">
        {/* Atmospheric Ambient Glows */}
        <div className="absolute -top-24 -left-20 w-80 h-80 rounded-full bg-blue-500/20 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-20 w-80 h-80 rounded-full bg-indigo-500/25 blur-3xl pointer-events-none" />
        {/* Subtle Geometric Dot Pattern */}
        <div className="absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:20px_20px] pointer-events-none" />

        {/* Decorative Brand Emblem Watermark in Background */}
        <div className="absolute left-6 -bottom-6 opacity-10 pointer-events-none scale-150 rotate-12 select-none hidden md:block">
          <CompanyLogo size={160} />
        </div>

        <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2.5 max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-1 text-xs font-bold text-blue-200 border border-white/15 backdrop-blur-md shadow-xs">
              <Calendar size={14} className="text-blue-300" />
              <span>{formatDateDisplay(todayStr)}</span>
            </div>
            <h1 className="text-2xl font-black tracking-tight sm:text-3xl text-white drop-shadow-xs">
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
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 px-5 py-3 text-sm font-bold text-white transition-all hover:shadow-lg hover:shadow-blue-500/30 active:scale-98 shadow-sm cursor-pointer border border-white/20"
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
    </div>
  );
}
