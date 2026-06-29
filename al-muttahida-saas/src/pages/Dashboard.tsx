import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  ArrowLeft,
  Boxes,
  CheckCircle2,
  ClipboardCheck,
  CreditCard,
  FileText,
  LifeBuoy,
  PackagePlus,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  UserPlus,
  Users,
  WalletCards,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getPurchases, getSales } from '../lib/storage';

type QuickAction = {
  title: string;
  description: string;
  path: string;
  icon: React.ElementType;
  tone: string;
};

type AttentionItem = {
  title: string;
  description: string;
  path: string;
  icon: React.ElementType;
};

const quickActions: QuickAction[] = [
  {
    title: 'إنشاء فاتورة',
    description: 'ابدأ عملية بيع جديدة من شاشة الفواتير.',
    path: '/sales',
    icon: ReceiptText,
    tone: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  },
  {
    title: 'إضافة عميل',
    description: 'سجل بيانات عميل جديد وجهز ملف التعامل.',
    path: '/customers',
    icon: UserPlus,
    tone: 'bg-sky-50 text-sky-700 border-sky-100',
  },
  {
    title: 'تسجيل دفعة',
    description: 'انتقل مباشرة لإدارة التحصيلات والمدفوعات.',
    path: '/payments',
    icon: CreditCard,
    tone: 'bg-violet-50 text-violet-700 border-violet-100',
  },
  {
    title: 'إضافة منتج',
    description: 'حدث الأصناف أو أضف منتجًا جديدًا للمخزون.',
    path: '/products-inventory',
    icon: PackagePlus,
    tone: 'bg-amber-50 text-amber-700 border-amber-100',
  },
  {
    title: 'مراجعة الطلبات',
    description: 'راجع عمليات البيع والشراء قيد المتابعة.',
    path: '/invoices',
    icon: ClipboardCheck,
    tone: 'bg-rose-50 text-rose-700 border-rose-100',
  },
  {
    title: 'فتح التقارير',
    description: 'اعرض التقارير عند الحاجة من مكان واحد.',
    path: '/reports',
    icon: FileText,
    tone: 'bg-slate-100 text-slate-700 border-slate-200',
  },
];

const workflow = ['عميل', 'عرض سعر', 'فاتورة', 'تحصيل', 'متابعة'];

export default function Dashboard() {
  const { settings } = useAuth();
  const navigate = useNavigate();
  const hasLowStock = false;
  const hasSales = getSales().length > 0;
  const hasPurchases = getPurchases().length > 0;

  const attentionItems: AttentionItem[] = [
    {
      title: 'فواتير تحتاج مراجعة',
      description: hasSales ? 'توجد عمليات بيع يمكن مراجعة حالتها وتفاصيلها.' : 'ابدأ بتسجيل أول عملية بيع عند جاهزية البيانات.',
      path: '/sales',
      icon: ReceiptText,
    },
    {
      title: 'طلبات بانتظار إجراء',
      description: hasPurchases ? 'راجع طلبات الشراء وتأكد من اكتمال خطواتها.' : 'يمكنك تجهيز طلبات الشراء من شاشة المشتريات.',
      path: '/invoices',
      icon: ShoppingBag,
    },
    {
      title: 'بيانات مخزون تحتاج متابعة',
      description: hasLowStock ? 'هناك أصناف تستحق مراجعة المخزون وتحديث بياناتها.' : 'المخزون جاهز للمتابعة من شاشة إدارة الأصناف.',
      path: '/products-inventory',
      icon: Boxes,
    },
  ];

  const recentActivities = [
    {
      title: hasSales ? 'تم تسجيل حركة بيع مؤخرًا' : 'شاشة المبيعات جاهزة لاستقبال العمليات',
      description: 'راجع التفاصيل أو أنشئ عملية جديدة عند الحاجة.',
      icon: ReceiptText,
      path: '/sales',
    },
    {
      title: hasPurchases ? 'تم تحديث حركة شراء مؤخرًا' : 'شاشة المشتريات جاهزة للتوريد',
      description: 'تابع الموردين وطلبات الشراء من نفس المسار.',
      icon: ShoppingBag,
      path: '/reports',
    },
    {
      title: 'بيانات العملاء متاحة للإدارة',
      description: 'افتح ملفات العملاء لمراجعة البيانات والتعاملات.',
      icon: Users,
      path: '/customers',
    },
  ];

  const systemStatus = [
    { label: 'النظام يعمل بشكل طبيعي', icon: CheckCircle2, color: 'text-emerald-600 bg-emerald-50' },
    { label: 'قاعدة البيانات متصلة', icon: Activity, color: 'text-sky-600 bg-sky-50' },
    { label: 'الصلاحيات مفعلة', icon: ShieldCheck, color: 'text-violet-600 bg-violet-50' },
    { label: 'النسخ الاحتياطي جاهز', icon: RefreshCw, color: 'text-amber-600 bg-amber-50' },
  ];

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="bg-slate-950 px-6 py-7 text-white sm:px-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-3xl">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-sm font-semibold text-slate-100">
                <Sparkles size={16} />
                مركز التشغيل اليومي
              </div>
              <h1 className="text-2xl font-black leading-relaxed sm:text-3xl">
                مرحبًا بك في {settings.companyName}
              </h1>
              <p className="mt-2 text-base font-medium leading-8 text-slate-300">
                لوحة موحدة تساعدك تبدأ العمل بسرعة، تراجع ما يحتاج انتباهك، وتنتقل لأهم أقسام النظام بدون عرض أي أرقام تخص الشركة.
              </p>
            </div>
            <button
              onClick={() => navigate('/sales')}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 font-bold text-slate-900 transition hover:bg-slate-100 sm:w-auto"
            >
              <ReceiptText size={20} />
              بدء عملية جديدة
            </button>
          </div>
        </div>

        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
          {systemStatus.map(item => (
            <div key={item.label} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${item.color}`}>
                <item.icon size={20} />
              </div>
              <p className="font-bold text-slate-700">{item.label}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-black text-slate-900">إجراءات سريعة</h2>
            <p className="text-sm font-semibold text-slate-500">اختصارات مباشرة لأهم مهام التشغيل اليومية.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {quickActions.map(action => (
            <button
              key={action.title}
              onClick={() => navigate(action.path)}
              className="group flex min-h-[132px] items-start gap-4 rounded-xl border border-slate-200 bg-white p-5 text-right shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
            >
              <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border ${action.tone}`}>
                <action.icon size={23} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-black text-slate-900">{action.title}</h3>
                  <ArrowLeft size={18} className="mt-1 shrink-0 text-slate-300 transition group-hover:-translate-x-1 group-hover:text-slate-500" />
                </div>
                <p className="mt-2 text-sm font-medium leading-7 text-slate-500">{action.description}</p>
              </div>
            </button>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-black text-slate-900">ما يحتاج انتباهك</h2>
              <p className="text-sm font-semibold text-slate-500">تنبيهات تشغيلية عامة بدون مبالغ أو أعداد.</p>
            </div>
            <LifeBuoy className="text-slate-400" size={24} />
          </div>

          <div className="space-y-3">
            {attentionItems.map(item => (
              <button
                key={item.title}
                onClick={() => navigate(item.path)}
                className="flex w-full items-center gap-4 rounded-xl border border-slate-100 bg-slate-50 p-4 text-right transition hover:border-slate-200 hover:bg-white"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white text-slate-700 shadow-sm">
                  <item.icon size={21} />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-black text-slate-800">{item.title}</h3>
                  <p className="mt-1 text-sm font-medium leading-6 text-slate-500">{item.description}</p>
                </div>
                <ArrowLeft size={18} className="shrink-0 text-slate-300" />
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-5">
            <h2 className="text-xl font-black text-slate-900">سير العمل</h2>
            <p className="text-sm font-semibold text-slate-500">مسار مختصر يوضح دورة التشغيل داخل النظام.</p>
          </div>

          <div className="space-y-3">
            {workflow.map((step, index) => (
              <div key={step} className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white">
                  <WalletCards size={19} />
                </div>
                <div className="flex-1 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <p className="font-black text-slate-800">{step}</p>
                </div>
                {index < workflow.length - 1 && <ArrowLeft size={18} className="hidden text-slate-300 sm:block" />}
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-black text-slate-900">آخر الأنشطة</h2>
            <p className="text-sm font-semibold text-slate-500">متابعة عامة لحركة النظام بدون عرض تفاصيل حساسة.</p>
          </div>
          <Activity className="text-slate-400" size={24} />
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {recentActivities.map(activity => (
            <button
              key={activity.title}
              onClick={() => navigate(activity.path)}
              className="flex items-start gap-3 rounded-xl border border-slate-100 bg-slate-50 p-4 text-right transition hover:border-slate-200 hover:bg-white"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-slate-700 shadow-sm">
                <activity.icon size={20} />
              </div>
              <div>
                <h3 className="font-black text-slate-800">{activity.title}</h3>
                <p className="mt-1 text-sm font-medium leading-6 text-slate-500">{activity.description}</p>
              </div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
