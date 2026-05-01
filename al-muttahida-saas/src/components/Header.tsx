import React, { useState } from 'react';
import { Bell, Menu, Search, User } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getNotifications } from '../lib/storage';

interface HeaderProps {
  onMenuClick: () => void;
  title?: string;
}

export default function Header({ onMenuClick, title }: HeaderProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [showNotifications, setShowNotifications] = useState(false);
  const notifications = getNotifications().slice(0, 5);
  const unreadCount = notifications.filter((notification) => !notification.isRead).length;

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1720px] items-center justify-between px-4 py-3 md:px-6 xl:px-8">
        <div className="flex items-center gap-4">
          <button onClick={onMenuClick} className="rounded-xl p-2 hover:bg-slate-100 lg:hidden">
            <Menu size={18} />
          </button>
          <div>
            <h1 className="text-xl font-bold text-slate-800">{title || 'لوحة التحكم'}</h1>
            <p className="hidden text-xs text-slate-500 md:block">واجهة محسنة للديسكتوب مع تنظيم أوضح للمحتوى</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden items-center rounded-full border border-slate-200 bg-slate-50 px-4 py-2 md:flex">
            <Search size={16} className="ml-2 text-slate-400" />
            <input type="text" placeholder="بحث سريع" className="w-48 bg-transparent text-sm outline-none xl:w-64" />
          </div>

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

          <div className="flex items-center gap-3 border-r border-slate-200 pr-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-100">
              <User size={16} className="text-sky-600" />
            </div>
            <div className="hidden sm:block">
              <p className="text-sm font-semibold text-slate-800">{user?.name}</p>
              <p className="text-xs text-slate-500">{user?.role === 'admin' ? 'مدير النظام' : 'مستخدم'}</p>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
