import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Permission } from '../types';
import { hasPermission as userHasPermission } from '../lib/permissions';
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

type PermissionKey = Permission;

const menuGroups: {
  title: string;
  defaultOpen: boolean;
  items: { icon: any; label: string; path: string; permission?: PermissionKey }[];
}[] = [
  {
    title: 'المبيعات والعملاء',
    defaultOpen: true,
    items: [
      { icon: UserCircle, label: 'العملاء', path: '/customers', permission: 'sales:read' },
      { icon: Receipt, label: 'العقود', path: '/invoices', permission: 'sales:read' },
      { icon: Truck, label: 'الموردين', path: '/suppliers', permission: 'sales:read' },
      { icon: UserCheck, label: 'المناديب', path: '/sales-reps', permission: 'sales:read' },
      { icon: Package, label: 'الأصناف', path: '/products-inventory', permission: 'inventory:manage' },
    ],
  },
  {
    title: 'الخزينة والتحصيل',
    defaultOpen: false,
    items: [
      { icon: Banknote, label: 'الخزينة', path: '/payments', permission: 'payments:read' },
      { icon: FileSearch, label: 'متابعة التحصيل', path: '/collection-statement', permission: 'payments:read' },
      { icon: ClipboardList, label: 'المصروفات', path: '/expenses', permission: 'payments:write' },
    ],
  },
  {
    title: 'التقارير والمالية',
    defaultOpen: false,
    items: [
      
      { icon: BarChart3, label: 'لوحة التقارير', path: '/reports', permission: 'reports:read' },
      { icon: ShoppingBag, label: 'سجل المبيعات', path: '/sales', permission: 'sales:read' },
      { icon: Calculator, label: 'الحسابات والقيود', path: '/accounts', permission: 'payments:read' },
      { icon: PieChart, label: 'حسابات الشركاء', path: '/shareholders', permission: 'shareholders:manage' },
    ],
  },
  {
    title: 'الإدارة',
    defaultOpen: false,
    items: [
      { icon: Users, label: 'المستخدمين', path: '/users', permission: 'users:manage' },
      { icon: Bell, label: 'مركز التنبيهات', path: '/notifications', permission: 'notifications:read' },
      { icon: Settings, label: 'الإعدادات', path: '/settings', permission: 'settings:manage' },
    ],
  },
];

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, settings } = useAuth();


  const hasPermission = (permission?: PermissionKey) => {
    if (!user) return false;
    if (!permission) return true;
    return userHasPermission(user, permission);
  };

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(
    () => Object.fromEntries(menuGroups.map((group) => [group.title, Boolean(group.defaultOpen)])),
  );

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
          <button
            type="button"
            onClick={() => { navigate('/'); onClose(); }}
            className="w-full text-center group transition-opacity hover:opacity-75 active:scale-95"
          >
            <h1 className="text-3xl font-extrabold leading-tight text-slate-900 group-hover:text-sky-700 transition-colors">{settings.companyName || 'شركة المتحدة'}</h1>
            <p className="mt-2 text-sm text-slate-500">بوابات عمل متكاملة للمحاسبة والإدارة</p>
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-5 py-3 no-scrollbar">
          <div className="space-y-2">
            {menuGroups.map((group) => {
              // If group is 'التقارير والمالية' and user lacks 'reports:read', hide the entire group
              if (group.title === 'التقارير والمالية' && !hasPermission('reports:read')) {
                return null;
              }

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

      </aside>
    </>
  );
}
