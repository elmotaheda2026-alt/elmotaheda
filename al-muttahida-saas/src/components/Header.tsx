import React, { useEffect, useRef, useState } from 'react';
import { Bell, LogOut, Mail, Menu, Search, Shield, User } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getNotifications, syncNotifications } from '../lib/storage';

interface HeaderProps {
  onMenuClick: () => void;
  title?: string;
}

export default function Header({ onMenuClick, title }: HeaderProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [showNotifications, setShowNotifications] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const [notifications, setNotifications] = useState(() => getNotifications().slice(0, 5));
  const unreadCount = notifications.filter((notification) => !notification.isRead).length;
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
      if (active) setNotifications(getNotifications().slice(0, 5));
    };

    loadNotifications();
    const interval = window.setInterval(loadNotifications, 30000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
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

  return (
    <header className="w-full border-b border-slate-200/60 bg-slate-100/80 backdrop-blur-md shadow-sm">
      <div className="mx-auto flex w-full max-w-[1720px] items-center justify-between px-4 py-2 md:px-6 xl:px-8">
        <div className="flex items-center gap-4">
          <button onClick={onMenuClick} className="rounded-xl p-2 hover:bg-slate-200/80 text-slate-700 transition-colors">
            <Menu size={18} />
          </button>
          {title && (
            <div>
              <h1 className="text-xl font-bold text-slate-800">{title}</h1>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <button onClick={() => setShowNotifications((current) => !current)} className="relative rounded-xl p-2 hover:bg-slate-100">
              <Bell size={18} className="text-slate-600" />
              {unreadCount > 0 && (
                <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] text-white">
                  {unreadCount}
                </span>
              )}
            </button>

            {showNotifications && (
              <div className="absolute left-0 top-full z-50 mt-2 w-80 rounded-2xl border border-slate-200 bg-white shadow-xl">
                <div className="border-b border-slate-100 p-4">
                  <h3 className="font-bold text-slate-800">الإشعارات</h3>
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <p className="p-4 text-center text-sm text-slate-500">لا توجد إشعارات حاليًا</p>
                  ) : (
                    notifications.map((notification) => (
                      <button
                        key={notification.id}
                        onClick={() => navigate('/notifications')}
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

          <div ref={userMenuRef} className="relative flex items-center gap-3 border-r border-slate-200 pr-3">
            <button
              type="button"
              onClick={() => {
                setShowUserMenu((current) => !current);
                setShowNotifications(false);
              }}
              className="absolute inset-0 z-10 rounded-2xl transition-colors hover:bg-slate-100"
              aria-label="فتح بيانات المستخدم"
            />
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-100">
              <User size={16} className="text-sky-600" />
            </div>
            <div className="hidden sm:block">
              <p className="text-sm font-semibold text-slate-800">{user?.name}</p>
              <p className="text-xs text-slate-500">{roleLabel}</p>
            </div>
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
    </header>
  );
}


