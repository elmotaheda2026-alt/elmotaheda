import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Permission } from '../types';
import { hasPermission as userHasPermission, isAdmin } from '../lib/permissions';
import {
  Banknote,
  Bell,
  Calculator,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  ClipboardList,
  FileSearch,
  Package,
  PieChart,
  Receipt,
  Settings,
  ShoppingBag,
  Truck,
  UserCheck,
  UserCircle,
  Users,
  Warehouse,
} from 'lucide-react';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onToggle: () => void;
}

type PermissionKey = Permission;

const menuGroups: {
  title: string;
  defaultOpen: boolean;
  items: { icon: any; label: string; path: string; permission?: PermissionKey; adminOnly?: boolean }[];
}[] = [
  {
    title: 'المبيعات والعملاء',
    defaultOpen: true,
    items: [
      { icon: Warehouse, label: 'الرئيسية', path: '/' },
      { icon: UserCircle, label: 'العملاء', path: '/customers', permission: 'sales:read' },
      { icon: Receipt, label: 'إصدار فاتورة', path: '/invoices', permission: 'sales:read' },
      { icon: Truck, label: 'الموردين', path: '/suppliers', permission: 'sales:read' },
      { icon: UserCheck, label: 'المناديب', path: '/sales-reps', permission: 'sales:read' },
      { icon: Package, label: 'الأصناف والمخزون', path: '/products-inventory', permission: 'inventory:manage' },
    ],
  },
  {
    title: 'الخزينة والتحصيل',
    defaultOpen: true,
    items: [
      { icon: Banknote, label: 'الخزينة', path: '/payments', permission: 'payments:read' },
      { icon: FileSearch, label: 'متابعة التحصيل', path: '/collection-statement', permission: 'payments:read' },
      { icon: ClipboardList, label: 'المصروفات', path: '/expenses', permission: 'payments:write' },
    ],
  },
  {
    title: 'التقارير والمالية',
    defaultOpen: true,
    items: [
      { icon: ShoppingBag, label: 'سجل المبيعات', path: '/sales', permission: 'sales:read', adminOnly: true },
      { icon: Calculator, label: 'التقارير والقيود المالية', path: '/accounts', permission: 'payments:read', adminOnly: true },
      { icon: PieChart, label: 'حسابات الشركاء', path: '/shareholders', permission: 'shareholders:manage' },
    ],
  },
  {
    title: 'الإدارة',
    defaultOpen: true,
    items: [
      { icon: Users, label: 'المستخدمين', path: '/users', permission: 'users:manage' },
      { icon: Bell, label: 'مركز التنبيهات', path: '/notifications', permission: 'notifications:read' },
      { icon: Settings, label: 'الإعدادات', path: '/settings', permission: 'settings:manage' },
    ],
  },
];

export default function Sidebar({ isOpen, onClose, onToggle }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, settings } = useAuth();

  const hasPermission = (permission?: PermissionKey) => {
    if (!user) return false;
    if (!permission) return true;
    return userHasPermission(user, permission);
  };

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(
    () => Object.fromEntries(menuGroups.map((group) => [group.title, true])),
  );

  const toggleGroup = (title: string) => {
    setOpenGroups((current) => ({
      ...current,
      [title]: !current[title],
    }));
  };

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && <div className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-xs lg:hidden" onClick={onClose} />}

      <aside
        className={`fixed right-0 top-0 z-50 flex h-full transform flex-col border-l border-slate-200 bg-white text-slate-800 transition-all duration-300 ${
          isOpen ? 'w-64 translate-x-0 xl:w-72' : 'w-16 translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Header / Branding */}
        <div className={`flex items-center justify-between border-b border-slate-200 ${isOpen ? 'px-4 py-4' : 'px-2 py-4 justify-center'}`}>
          <button
            type="button"
            onClick={() => {
              navigate('/');
              onClose();
            }}
            className="flex items-center gap-3 overflow-hidden text-right transition-opacity hover:opacity-85"
            title={settings.companyName || 'شركة المتحدة'}
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-md shadow-blue-500/20">
              <Warehouse size={22} />
            </div>
            {isOpen && (
              <div className="flex flex-col truncate">
                <h1 className="truncate text-base font-extrabold tracking-tight text-slate-900">
                  {settings.companyName || 'شركة المتحدة'}
                </h1>
                <span className="text-[11px] font-medium text-slate-500">نظام ERP المتكامل</span>
              </div>
            )}
          </button>
        </div>

        {/* Navigation Items */}
        <nav className={`flex-1 overflow-y-auto py-3 custom-scrollbar ${isOpen ? 'px-3' : 'px-2'}`}>
          <div className="space-y-3">
            {menuGroups.map((group) => {
              const allowedItems = group.items.filter((item) => (!item.adminOnly || isAdmin(user)) && hasPermission(item.permission));
              if (allowedItems.length === 0) return null;

              return (
                <section key={group.title} className="space-y-1">
                  {isOpen ? (
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.title)}
                      className="flex w-full items-center justify-between px-2 py-1.5 text-right text-xs font-bold text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      <span>{group.title}</span>
                      <ChevronDown
                        size={14}
                        className={`transition-transform duration-200 ${openGroups[group.title] ? 'rotate-180' : ''}`}
                      />
                    </button>
                  ) : (
                    <div className="my-2 border-t border-slate-100" />
                  )}

                  {(isOpen ? openGroups[group.title] : true) && (
                    <div className="space-y-0.5">
                      {allowedItems.map((item) => {
                        const Icon = item.icon;
                        const isActive = location.pathname === item.path;

                        return (
                          <button
                            key={item.path}
                            type="button"
                            title={item.label}
                            onClick={() => {
                              navigate(item.path);
                              onClose();
                            }}
                            className={`group flex w-full items-center gap-3 rounded-lg font-bold transition-all duration-150 ${
                              isOpen ? 'px-3 py-2 text-sm' : 'justify-center px-2 py-2.5 text-xs'
                            } ${
                              isActive
                                ? 'border-r-4 border-blue-600 bg-blue-50 text-blue-700 font-bold shadow-sm'
                                : 'border-r-4 border-transparent text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                            }`}
                          >
                            <Icon
                              size={19}
                              className={`shrink-0 transition-colors ${
                                isActive ? 'text-blue-600' : 'text-slate-500 group-hover:text-slate-700'
                              }`}
                            />
                            {isOpen && <span className="truncate">{item.label}</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </nav>

        {/* Footer / Toggle Button */}
        <div className="border-t border-slate-200 p-2.5 bg-slate-50/50">
          <button
            type="button"
            onClick={onToggle}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-xs transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600 active:scale-98"
            title={isOpen ? 'تصغير القائمة' : 'توسيع القائمة'}
          >
            {isOpen ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
            {isOpen && <span>تصغير القائمة</span>}
          </button>
        </div>
      </aside>
    </>
  );
}
