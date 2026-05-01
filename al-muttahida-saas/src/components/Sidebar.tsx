import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Banknote,
  BarChart3,
  Bell,
  Calculator,
  ChevronDown,
  ClipboardList,
  FileSearch,
  LayoutDashboard,
  LogOut,
  Package,
  Receipt,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Truck,
  UserCheck,
  UserCircle,
  Users,
  Warehouse,
} from 'lucide-react';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

const menuGroups = [
  {
    title: 'مكتب المحاسب',
    defaultOpen: true,
    items: [
      { icon: LayoutDashboard, label: 'الرئيسية', path: '/' },
      { icon: Receipt, label: 'مركز التعاقد', path: '/invoices' },
      { icon: UserCircle, label: 'ملفات العملاء', path: '/customers' },
      { icon: Package, label: 'دليل الأصناف', path: '/products' },
      { icon: ShoppingCart, label: 'أوامر التوريد', path: '/purchases' },
    ],
  },
  {
    title: 'الخزينة والمتابعة',
    defaultOpen: false,
    items: [
      { icon: Banknote, label: 'الخزينة اليومية', path: '/payments' },
      { icon: FileSearch, label: 'متابعة التحصيل', path: '/collection-statement' },
      { icon: ClipboardList, label: 'المصروفات المعتمدة', path: '/expenses' },
      { icon: Calculator, label: 'الحسابات والقيود', path: '/accounts' },
    ],
  },
  {
    title: 'التشغيل التجاري',
    defaultOpen: false,
    items: [
      { icon: ShoppingBag, label: 'حركة المبيعات', path: '/sales' },
      { icon: Warehouse, label: 'إدارة المخزون', path: '/inventory' },
      { icon: Truck, label: 'شركاء التوريد', path: '/suppliers' },
      { icon: UserCheck, label: 'فريق المبيعات', path: '/sales-reps' },
    ],
  },
  {
    title: 'الإدارة والتحكم',
    defaultOpen: false,
    items: [
      { icon: Users, label: 'إدارة المستخدمين', path: '/users' },
      { icon: BarChart3, label: 'لوحة التقارير', path: '/reports' },
      { icon: Bell, label: 'مركز التنبيهات', path: '/notifications' },
      { icon: Settings, label: 'تهيئة النظام', path: '/settings' },
    ],
  },
];

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(
    () => Object.fromEntries(menuGroups.map((group) => [group.title, Boolean(group.defaultOpen)])),
  );

  const handleLogout = () => {
    if (confirm('هل تريد تسجيل الخروج؟')) {
      navigate('/login');
    }
  };

  const toggleGroup = (title: string) => {
    setOpenGroups((current) => {
      const isAlreadyOpen = !!current[title];
      // Close all and only open the clicked one if it wasn't open
      const newState: Record<string, boolean> = {};
      menuGroups.forEach(g => {
        newState[g.title] = false;
      });
      if (!isAlreadyOpen) {
        newState[title] = true;
      }
      return newState;
    });
  };

  return (
    <>
      {isOpen && <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={onClose} />}

      <aside
        className={`fixed right-0 top-0 z-50 flex h-full w-72 transform flex-col border-l border-slate-200 bg-gradient-to-b from-slate-100 via-white to-slate-100 text-slate-800 shadow-xl transition-transform duration-300 lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="border-b border-slate-200 px-6 py-8">
          <h1 className="text-center text-3xl font-extrabold leading-tight text-slate-900">شركة المتحدة</h1>
          <p className="mt-2 text-center text-sm text-slate-500">بوابات عمل متكاملة للمحاسبة والإدارة</p>
        </div>

        <nav className="flex-1 overflow-y-auto px-5 py-3 no-scrollbar">
          <div className="space-y-2">
            {menuGroups.map((group) => (
              <section key={group.title} className="border-b border-slate-200 pb-3 last:border-b-0">
                <button
                  type="button"
                  onClick={() => toggleGroup(group.title)}
                  className="flex w-full items-center justify-between py-2 text-right"
                >
                  <span className="text-sm font-bold text-slate-500">{group.title}</span>
                  <ChevronDown
                    size={18}
                    className={`text-slate-500 transition-transform ${openGroups[group.title] ? 'rotate-180' : ''}`}
                  />
                </button>

                {openGroups[group.title] && (
                  <div className="mt-1 space-y-1">
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      const isActive = location.pathname === item.path;

                      return (
                        <button
                          key={item.path}
                          onClick={() => {
                            navigate(item.path);
                            onClose();
                          }}
                          className={`flex w-full items-center justify-between rounded-2xl px-4 py-3.5 text-[1.03rem] font-semibold transition ${
                            isActive
                              ? 'bg-sky-600 text-white shadow-sm'
                              : 'text-slate-700 hover:bg-slate-200/70 hover:text-slate-900'
                          }`}
                        >
                          <span>{item.label}</span>
                          <Icon size={18} />
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>
            ))}
          </div>
        </nav>

        <div className="border-t border-slate-200 p-5">
          <button
            onClick={handleLogout}
            className="flex w-full items-center justify-between rounded-2xl bg-rose-100 px-4 py-3.5 text-base font-semibold text-rose-700 transition hover:bg-rose-200"
          >
            <span>تسجيل الخروج</span>
            <LogOut size={18} />
          </button>
        </div>
      </aside>
    </>
  );
}
