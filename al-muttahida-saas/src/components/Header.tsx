import React, { useEffect, useRef, useState } from 'react';
import { Bell, HelpCircle, LogOut, Mail, Menu, Moon, Search, Shield, Sun, User, Wifi, WifiOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getNotifications, markAllNotificationsRead, markNotificationRead, syncNotifications } from '../lib/storage';
import { checkBackendHealth, isMobileDevice } from '../lib/apiClient';
import { canViewNotification } from '../lib/permissions';
import HelpGuideDrawer from './HelpGuideDrawer';

interface HeaderProps {
  onMenuClick: () => void;
  title?: string;
}

export default function Header({ onMenuClick, title }: HeaderProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [isConnected, setIsConnected] = useState<boolean | null>(true);
  const [isDark, setIsDark] = useState(() => {
    try {
      return localStorage.getItem('almuttahida_theme') === 'dark';
    } catch {
      return false;
    }
  });
  const [showNotifications, setShowNotifications] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    try {
      localStorage.setItem('almuttahida_theme', isDark ? 'dark' : 'light');
    } catch {
      // Ignore storage errors
    }
  }, [isDark]);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showHelpGuide, setShowHelpGuide] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);
  const [notifications, setNotifications] = useState(() =>
    getNotifications().filter((n) => canViewNotification(user, n)).slice(0, 5),
  );
  const unreadCount = notifications.filter((notification) => !notification.isRead).length;

  useEffect(() => {
    let active = true;
    const testConnection = async () => {
      const ok = await checkBackendHealth();
      if (active) setIsConnected(ok);
    };
    const handleHealthEvent = (event: Event) => {
      const detail = (event as CustomEvent<boolean>).detail;
      if (active && typeof detail === 'boolean') {
        setIsConnected(detail);
      }
    };
    const handleOnline = () => {
      void testConnection();
    };
    const handleOffline = () => {
      if (active) setIsConnected(false);
    };

    void testConnection();
    const interval = window.setInterval(testConnection, 5000);
    window.addEventListener('api-health-change', handleHealthEvent);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('focus', handleOnline);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('api-health-change', handleHealthEvent);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('focus', handleOnline);
    };
  }, []);
  const roleLabel =
    user?.role === 'admin'
      ? 'مدير النظام'
      : user?.role === 'manager'
        ? 'مشرف'
        : user?.role === 'accountant'
          ? 'محاسب'
          : user?.role === 'collector'
            ? 'محصل'
            : user?.role === 'reviewer'
              ? 'مراجع'
              : user?.role === 'finance_manager'
                ? 'مدير مالي'
                : 'مستخدم';

  useEffect(() => {
    let active = true;
    const loadNotifications = async () => {
      try {
        await syncNotifications();
      } catch (error) {
        console.error('Failed to sync notifications:', error);
      }
      if (active && !showNotifications) {
        setNotifications(getNotifications().filter((n) => canViewNotification(user, n)).slice(0, 5));
      }
    };

    loadNotifications();
    const interval = window.setInterval(loadNotifications, 30000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [showNotifications, user]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
      if (notificationsRef.current && !notificationsRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = () => {
    logout();
    setShowUserMenu(false);
    navigate('/login');
  };

  const refreshNotificationState = () => {
    setNotifications(getNotifications().filter((n) => canViewNotification(user, n)).slice(0, 5));
  };

  const openNotifications = () => {
    const nextOpen = !showNotifications;
    setShowNotifications(nextOpen);
    if (nextOpen) {
      refreshNotificationState();
    }
  };

  const handleMarkAllRead = async () => {
    setNotifications((current) => current.map((notification) => ({ ...notification, isRead: true })));
    try {
      await markAllNotificationsRead();
    } catch (error) {
      console.error('Failed to mark notifications read:', error);
    } finally {
      refreshNotificationState();
    }
  };

  const openNotificationPage = async (id: string) => {
    setNotifications((current) =>
      current.map((notification) => (notification.id === id ? { ...notification, isRead: true } : notification)),
    );
    try {
      await markNotificationRead(id);
    } catch (error) {
      console.error('Failed to mark notification read:', error);
    }
    setShowNotifications(false);
    navigate('/notifications');
  };

  return (
    <header className="w-full border-b border-slate-200 bg-white/95 backdrop-blur-md h-14 flex items-center">
      <div className="mx-auto flex w-full max-w-[1920px] items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <button onClick={onMenuClick} className="rounded-lg p-1.5 hover:bg-slate-100 text-slate-600 transition-colors">
            <Menu size={19} />
          </button>
          {title && (
            <div>
              <h1 className="text-xl font-bold text-slate-800">{title}</h1>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {isMobileDevice() && (
            <div className="flex items-center gap-1 bg-amber-50 text-amber-800 border border-amber-200/90 px-2.5 py-1 rounded-full text-[11px] font-bold shadow-2xs">
              <Shield size={12} className="text-amber-600 shrink-0" />
              <span>وضع العرض فقط</span>
            </div>
          )}

          {/* Dynamic Sync/Network Status Badge */}
          <button
            type="button"
            onClick={() => navigate('/settings?tab=network')}
            title="انقر لفتح إعدادات الشبكة وحالة الخادم"
            className="cursor-pointer transition-all hover:scale-105 active:scale-95"
          >
            {isConnected ? (
              <div className="hidden sm:flex items-center gap-1.5 bg-emerald-50 hover:bg-emerald-100/80 text-emerald-700 border border-emerald-200/80 px-2.5 py-1 rounded-full text-xs font-bold shadow-2xs">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span>النظام متصل</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 bg-rose-50 hover:bg-rose-100/80 text-rose-700 border border-rose-200/80 px-2.5 py-1 rounded-full text-xs font-bold shadow-2xs animate-pulse">
                <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                <span>غير متصل بالخادم</span>
              </div>
            )}
          </button>

          <button
            type="button"
            onClick={() => setIsDark((prev) => !prev)}
            title={isDark ? 'تفعيل الوضع النهاري' : 'تفعيل الوضع الليلي'}
            aria-label={isDark ? 'تفعيل الوضع النهاري' : 'تفعيل الوضع الليلي'}
            className="rounded-xl p-2 text-slate-600 hover:bg-slate-100 hover:text-blue-700 transition-colors cursor-pointer"
          >
            {isDark ? <Sun size={18} className="text-amber-400" /> : <Moon size={18} />}
          </button>

          <button
            type="button"
            onClick={() => setShowHelpGuide(true)}
            title="دليل المستخدم — شرح الصفحة الحالية"
            aria-label="دليل المستخدم"
            className="rounded-xl p-2 text-slate-600 hover:bg-slate-100 hover:text-blue-700 transition-colors cursor-pointer"
          >
            <HelpCircle size={18} />
          </button>

          <div className="relative">
            <button onClick={openNotifications} className="relative rounded-xl p-2 hover:bg-slate-100">
              <Bell size={18} className="text-slate-600" />
              {unreadCount > 0 && (
                <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] text-white">
                  {unreadCount}
                </span>
              )}
            </button>

            {showNotifications && (
               <div ref={notificationsRef} className="absolute left-0 top-full z-50 mt-2 w-80 rounded-2xl border border-slate-200 bg-white shadow-xl">
                <div className="border-b border-slate-100 p-4 flex items-center justify-between gap-2">
                  <h3 className="font-bold text-slate-800">الإشعارات</h3>
                  {unreadCount > 0 && (
                    <button
                      type="button"
                      onClick={handleMarkAllRead}
                      className="text-xs font-bold text-blue-600 hover:text-blue-800 cursor-pointer"
                    >
                      تحديد الكل كمقروء
                    </button>
                  )}
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <p className="p-4 text-center text-sm text-slate-500">لا توجد إشعارات حاليًا</p>
                  ) : (
                    notifications.map((notification) => (
                      <button
                        key={notification.id}
                        onClick={() => openNotificationPage(notification.id)}
                        className={`block w-full border-b border-slate-50 p-4 text-right hover:bg-slate-50 ${!notification.isRead ? 'bg-sky-50' : ''}`}
                      >
                        <p className="text-sm font-semibold text-slate-800">{notification.title}</p>
                        <p className="mt-1 text-xs text-slate-500">{notification.message}</p>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          <div ref={userMenuRef} className="relative border-r border-slate-200 pr-2">
            <button
              type="button"
              onClick={() => {
                setShowUserMenu((current) => !current);
                setShowNotifications(false);
              }}
              className="flex items-center gap-3 rounded-2xl px-2.5 py-1.5 transition-colors hover:bg-slate-100 cursor-pointer"
              aria-label="فتح بيانات المستخدم"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-100 shrink-0">
                <User size={16} className="text-sky-600" />
              </div>
              <div className="hidden sm:block text-right">
                <p className="text-sm font-semibold text-slate-800">{user?.name}</p>
                <p className="text-xs text-slate-500">{roleLabel}</p>
              </div>
            </button>
            {showUserMenu && (
              <div className="absolute left-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-2xl border border-slate-200 bg-white text-right shadow-xl">
                <div className="bg-slate-50 p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-sky-100">
                      <User size={18} className="text-sky-600" />
                    </div>
                    <div>
                      <p className="font-bold text-slate-800">{user?.name || '-'}</p>
                      <p className="text-xs text-slate-500">بيانات المستخدم الحالي</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-3 p-4">
                  <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white p-3">
                    <User size={16} className="text-slate-400" />
                    <div>
                      <p className="text-xs text-slate-500">اسم المستخدم</p>
                      <p className="text-sm font-semibold text-slate-800">{user?.username || '-'}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white p-3">
                    <Shield size={16} className="text-slate-400" />
                    <div>
                      <p className="text-xs text-slate-500">الصلاحية</p>
                      <p className="text-sm font-semibold text-slate-800">{roleLabel}</p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleLogout}
                    className="relative z-20 flex w-full items-center justify-center gap-2 rounded-xl bg-red-50 px-4 py-2.5 text-sm font-bold text-red-600 transition-colors hover:bg-red-100"
                  >
                    <LogOut size={16} />
                    تسجيل الخروج
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <HelpGuideDrawer isOpen={showHelpGuide} onClose={() => setShowHelpGuide(false)} />
    </header>
  );
}


