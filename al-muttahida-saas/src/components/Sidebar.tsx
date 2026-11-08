import React, { useState, useRef, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Permission } from '../types';
import { hasPermission as userHasPermission, isAdmin } from '../lib/permissions';
import CompanyLogo from './CompanyLogo';
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
  Pin,
  PinOff,
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
  accent: {
    dot: string;
    activeBorder: string;
    activeBg: string;
    activeText: string;
    activeIcon: string;
  };
  items: { icon: any; label: string; path: string; permission?: PermissionKey; adminOnly?: boolean }[];
}[] = [
  {
    title: 'المبيعات والعملاء',
    defaultOpen: true,
    accent: {
      dot: 'bg-slate-400',
      activeBorder: 'border-blue-600',
      activeBg: 'bg-blue-50/80',
      activeText: 'text-blue-700',
      activeIcon: 'text-blue-600',
    },
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
    accent: {
      dot: 'bg-slate-400',
      activeBorder: 'border-blue-600',
      activeBg: 'bg-blue-50/80',
      activeText: 'text-blue-700',
      activeIcon: 'text-blue-600',
    },
    items: [
      { icon: Banknote, label: 'الخزينة', path: '/payments', permission: 'payments:read' },
      { icon: FileSearch, label: 'متابعة التحصيل', path: '/collection-statement', permission: 'payments:read' },
      { icon: ClipboardList, label: 'المصروفات', path: '/expenses', permission: 'payments:write' },
    ],
  },
  {
    title: 'التقارير والمالية',
    defaultOpen: true,
    accent: {
      dot: 'bg-slate-400',
      activeBorder: 'border-blue-600',
      activeBg: 'bg-blue-50/80',
      activeText: 'text-blue-700',
      activeIcon: 'text-blue-600',
    },
    items: [
      { icon: ShoppingBag, label: 'سجل المبيعات', path: '/sales', permission: 'sales:read', adminOnly: true },
      { icon: Calculator, label: 'التقارير والقيود المالية', path: '/accounts', permission: 'payments:read', adminOnly: true },
      { icon: PieChart, label: 'الشركاء والمساهمين', path: '/shareholders', permission: 'shareholders:manage' },
    ],
  },
  {
    title: 'الإدارة',
    defaultOpen: true,
    accent: {
      dot: 'bg-slate-400',
      activeBorder: 'border-blue-600',
      activeBg: 'bg-blue-50/80',
      activeText: 'text-blue-700',
      activeIcon: 'text-blue-600',
    },
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

  const [isHovered, setIsHovered] = useState(false);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const isExpanded = isOpen || isHovered;

  const handleMouseEnter = () => {
    if (isOpen || window.innerWidth < 1024) return;
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = setTimeout(() => {
      setIsHovered(true);
    }, 80);
  };

  const handleMouseLeave = () => {
    if (window.innerWidth < 1024) return;
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = setTimeout(() => {
      setIsHovered(false);
    }, 140);
  };

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    };
  }, []);

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
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={`fixed right-0 top-0 z-50 flex h-full transform flex-col border-l border-slate-200 bg-white text-slate-800 transition-all duration-200 ${
          isExpanded ? 'w-60 translate-x-0' : 'w-16 translate-x-full lg:translate-x-0'
        } ${!isOpen && isHovered ? 'shadow-2xl ring-1 ring-slate-900/10' : 'shadow-none'}`}
      >
        {/* Header / Branding with Custom Corporate Logo */}
        <div className={`flex items-center justify-between border-b border-slate-200 ${isExpanded ? 'px-3.5 py-3.5' : 'px-2 py-3.5 justify-center'}`}>
          <button
            type="button"
            onClick={() => {
              navigate('/');
              setIsHovered(false);
              if (window.innerWidth < 1024) onClose();
            }}
            className="flex items-center gap-2.5 overflow-hidden text-right transition-opacity hover:opacity-85 cursor-pointer"
            title={settings.companyName || 'شركة المتحدة'}
          >
            <CompanyLogo
              size={38}
              variant={isExpanded ? 'full' : 'emblem'}
              companyName={settings.companyName || 'شركة المتحدة'}
              subTitle="نظام ERP المتكامل"
            />
          </button>
        </div>

        {/* Navigation Items */}
        <nav className={`flex-1 overflow-y-auto py-3 custom-scrollbar ${isExpanded ? 'px-2.5' : 'px-2'}`}>
          <div className="space-y-3">
            {menuGroups.map((group) => {
              const allowedItems = group.items.filter(
                (item) => (!item.adminOnly || isAdmin(user) || user?.role === 'manager') && hasPermission(item.permission)
              );
              if (allowedItems.length === 0) return null;

              return (
                <section key={group.title} className="space-y-1">
                  {isExpanded ? (
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.title)}
                      className="flex w-full items-center justify-between px-2.5 py-1 text-right text-xs font-bold text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      <span className="flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${group.accent.dot}`} />
                        <span>{group.title}</span>
                      </span>
                      <ChevronDown
                        size={14}
                        className={`transition-transform duration-200 ${openGroups[group.title] ? 'rotate-180' : ''}`}
                      />
                    </button>
                  ) : (
                    <div className="my-2.5 flex justify-center items-center">
                      <span className={`w-1.5 h-1.5 rounded-full ${group.accent.dot} opacity-60`} />
                    </div>
                  )}

                  {(isExpanded ? openGroups[group.title] : true) && (
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
                              setIsHovered(false);
                              if (window.innerWidth < 1024) {
                                onClose();
                              }
                            }}
                            className={`group flex w-full items-center gap-3 rounded-lg font-bold transition-all duration-150 cursor-pointer ${
                              isExpanded ? 'px-3 py-2 text-sm' : 'justify-center px-2 py-2.5 text-xs'
                            } ${
                              isActive
                                ? `border-r-4 ${group.accent.activeBorder} ${group.accent.activeBg} ${group.accent.activeText} font-bold shadow-2xs`
                                : 'border-r-4 border-transparent text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                            }`}
                          >
                            <Icon
                              size={18}
                              className={`shrink-0 transition-colors ${
                                isActive ? group.accent.activeIcon : 'text-slate-500 group-hover:text-slate-800'
                              }`}
                            />
                            {isExpanded && <span className="truncate text-sm font-bold">{item.label}</span>}
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

        {/* Footer / Toggle & Pin Button */}
        <div className="border-t border-slate-200 p-2.5 bg-slate-50/70">
          <button
            type="button"
            onClick={() => {
              setIsHovered(false);
              onToggle();
            }}
            className={`flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold transition shadow-2xs active:scale-95 cursor-pointer ${
              isOpen
                ? 'text-blue-700 hover:border-blue-300 hover:bg-blue-50'
                : 'text-slate-600 hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900'
            }`}
            title={isOpen ? 'تصغير القائمة (تفعيل التوسيع التلقائي بالماوس)' : 'تثبيت القائمة مفتوحة دائماً'}
          >
            {isOpen ? (
              <PinOff size={16} className="text-blue-600 shrink-0" />
            ) : (
              <Pin size={16} className="text-slate-500 shrink-0" />
            )}
            {isExpanded && (
              <span className="truncate">
                {isOpen ? 'تصغير (توسيع بالماوس)' : 'تثبيت القائمة'}
              </span>
            )}
          </button>
        </div>
      </aside>
    </>
  );
}
