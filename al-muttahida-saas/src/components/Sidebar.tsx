import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  UserCircle,
  Truck,
  Package,
  ShoppingCart,
  Receipt,
  Warehouse,
  Banknote,
  BarChart3,
  Settings,
  LogOut,
  ShoppingBag,
  ClipboardList,
  UserCheck,
  Bell,
  Calculator,
  FileSearch,
} from 'lucide-react';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

const menuItems = [
  { icon: LayoutDashboard, label: 'الرئيسية', path: '/' },
  { icon: Users, label: 'المستخدمين', path: '/users' },
  { icon: UserCircle, label: 'العملاء', path: '/customers' },
  { icon: UserCheck, label: 'مناديب المبيعات', path: '/sales-reps' },
  { icon: Truck, label: 'الموردين', path: '/suppliers' },
  { icon: Package, label: 'الأصناف', path: '/products' },
  { icon: Warehouse, label: 'المخزن', path: '/inventory' },
  { icon: ShoppingCart, label: 'المشتريات', path: '/purchases' },
  { icon: ShoppingBag, label: 'المبيعات', path: '/sales' },
  { icon: Receipt, label: 'الفواتير', path: '/invoices' },
  { icon: Banknote, label: 'المدفوعات', path: '/payments' },
  { icon: ClipboardList, label: 'سندات الصرف', path: '/expenses' },
  { icon: Calculator, label: 'الحسابات', path: '/accounts' },
  { icon: FileSearch, label: 'كشف التحصيل', path: '/collection-statement' },
  { icon: BarChart3, label: 'التقارير', path: '/reports' },
  { icon: Bell, label: 'الإشعارات', path: '/notifications' },
  { icon: Settings, label: 'الإعدادات', path: '/settings' },
];

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    if (confirm('هل تريد تسجيل الخروج؟')) {
      navigate('/login');
    }
  };

  return (
    <>
      {/* Mobile Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-0 right-0 h-full w-64 bg-gradient-to-b from-indigo-900 to-purple-900 text-white z-50 transform transition-transform duration-300 lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Logo */}
        <div className="p-6 border-b border-white/10">
          <h1 className="text-xl font-bold text-center">شركة المتحدة</h1>
          <p className="text-xs text-center text-white/70 mt-1">نظام إدارة متكامل</p>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <button
                key={item.path}
                onClick={() => {
                  navigate(item.path);
                  onClose();
                }}
                className={`w-full flex items-center gap-3 px-6 py-3 hover:bg-white/10 transition-colors ${
                  isActive ? 'bg-white/20 border-r-4 border-yellow-400' : ''
                }`}
              >
                <Icon size={20} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Logout */}
        <div className="p-4 border-t border-white/10">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-3 bg-red-500/20 hover:bg-red-500/30 rounded-lg transition-colors text-red-300"
          >
            <LogOut size={20} />
            <span>تسجيل الخروج</span>
          </button>
        </div>
      </aside>
    </>
  );
}
