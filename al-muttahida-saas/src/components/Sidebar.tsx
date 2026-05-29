import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { UserPermissions } from '../types';
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
  PieChart,
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

type PermissionKey = keyof UserPermissions;

const menuGroups: {
  title: string;
  defaultOpen: boolean;
  items: { icon: any; label: string; path: string; permission?: PermissionKey }[];
}[] = [
  {
    title: 'مكتب المحاسب',
    defaultOpen: true,
    items: [
      { icon: LayoutDashboard, label: 'الرئيسية', path: '/', permission: 'dashboard' },
      { icon: Receipt, label: 'مركز التعاقد', path: '/invoices', permission: 'sales' },
      { icon: UserCircle, label: 'ملفات العملاء', path: '/customers', permission: 'customers' },
      { icon: Package, label: 'دليل الأصناف', path: '/products', permission: 'inventory' },
      { icon: ShoppingCart, label: 'أوامر التوريد', path: '/purchases', permission: 'purchases' },
    ],
  },
  {
    title: 'الخزينة والمتابعة',
    defaultOpen: false,
    items: [
      { icon: Banknote, label: 'الخزينة اليومية', path: '/payments', permission: 'treasury' },
      { icon: FileSearch, label: 'متابعة التحصيل', path: '/collection-statement', permission: 'treasury' },
      { icon: ClipboardList, label: 'المصروفات المعتمدة', path: '/expenses', permission: 'treasury' },
      { icon: Calculator, label: 'الحسابات والقيود', path: '/accounts', permission: 'treasury' },
      { icon: PieChart, label: 'حسابات الشركاء', path: '/shareholders', permission: 'shareholders' },
    ],
  },
  {
    title: 'التشغيل التجاري',
    defaultOpen: false,
    items: [
      { icon: ShoppingBag, label: 'حركة المبيعات', path: '/sales', permission: 'sales' },
      { icon: Warehouse, label: 'إدارة المخزون', path: '/inventory', permission: 'inventory' },
      { icon: Truck, label: 'شركاء التوريد', path: '/suppliers', permission: 'suppliers' },
      { icon: UserCheck, label: 'فريق المبيعات', path: '/sales-reps', permission: 'sales' },
    ],
  },
  {
    title: 'الإدارة والتحكم',
    defaultOpen: false,
    items: [
      { icon: Users, label: 'إدارة المستخدمين', path: '/users', permission: 'users' },
      { icon: BarChart3, label: 'لوحة التقارير', path: '/reports', permission: 'reports' },
      { icon: Bell, label: 'مركز التنبيهات', path: '/notifications' },
      { icon: Settings, label: 'تهيئة النظام', path: '/settings', permission: 'settings' },
    ],
  },
];

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
const { user, logout } = useAuth();
  
  const hasPermission = (permission?: PermissionKey) => {
    if (!user) return false;
    if (user.role === 'admin') return true;
    if (!permission) return true;
    return !!user.permissions?.[permission];
  };

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(
    () => Object.fromEntries(menuGroups.map((group) => [group.title, Boolean(group.defaultOpen)])),
  );

  const handleLogout = () => {
    if (confirm('هل تريد تسجيل الخروج؟')) {
      logout();
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
        className={`fixed right-0 top-0 z-50 flex h-full w-72 transform flex-col border-l border-white/20 bg-white/70 backdrop-blur-xl text-slate-800 shadow-[0_0_40px_rgba(0,0,0,0.05)] transition-transform duration-300 lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="border-b border-slate-200 px-6 py-8">
          <h1 className="text-center text-3xl font-extrabold leading-tight text-slate-900">شركة المتحدة</h1>
          <p className="mt-2 text-center text-sm text-slate-500">بوابات عمل متكاملة للمحاسبة والإدارة</p>
        </div>

        <nav className="flex-1 overflow-y-auto px-5 py-3 no-scrollbar">
          <div className="space-y-2">
            {menuGroups.map((group) => {
              const allowedItems = group.items.filter(item => hasPermission(item.permission));
              
              if (allowedItems.length === 0) return null;

              return (
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
                    {allowedItems.map((item) => {
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
            )})}
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
