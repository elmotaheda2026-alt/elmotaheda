import React, { useState, useEffect, useMemo } from 'react';
import { Bell, Check, AlertTriangle, Info, CheckCircle, Search, Filter } from 'lucide-react';
import { Notification } from '../types';
import { getNotifications, markNotificationRead, markAllNotificationsRead, syncNotifications } from '../lib/storage';
import { formatDateTimeDisplay } from '../lib/dateUtils';

type FilterType = 'all' | 'unread' | 'warning' | 'error' | 'info';

export default function Notifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');

  useEffect(() => {
    let active = true;
    const loadNotifications = async () => {
      try {
        await syncNotifications();
      } catch (error) {
        console.error('Failed to sync notifications:', error);
      }
      if (active) setNotifications(getNotifications());
    };

    loadNotifications();
    return () => {
      active = false;
    };
  }, []);

  const handleMarkRead = async (id: string) => {
    setNotifications((current) =>
      current.map((notification) => (notification.id === id ? { ...notification, isRead: true } : notification)),
    );
    try {
      await markNotificationRead(id);
    } finally {
      setNotifications(getNotifications());
    }
  };

  const handleMarkAllRead = async () => {
    setNotifications((current) => current.map((notification) => ({ ...notification, isRead: true })));
    try {
      await markAllNotificationsRead();
    } finally {
      setNotifications(getNotifications());
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'warning': return <AlertTriangle size={18} className="text-amber-500" />;
      case 'success': return <CheckCircle size={18} className="text-emerald-500" />;
      case 'error': return <AlertTriangle size={18} className="text-rose-500" />;
      default: return <Info size={18} className="text-sky-500" />;
    }
  };

  const unreadCount = notifications.filter(n => !n.isRead).length;

  const filteredNotifications = useMemo(() => {
    return notifications.filter((item) => {
      // Filter by type or unread status
      if (activeFilter === 'unread' && item.isRead) return false;
      if (activeFilter === 'warning' && item.type !== 'warning') return false;
      if (activeFilter === 'error' && item.type !== 'error') return false;
      if (activeFilter === 'info' && item.type !== 'info' && item.type !== 'success') return false;

      // Filter by search query
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        const matchesTitle = item.title?.toLowerCase().includes(query);
        const matchesMsg = item.message?.toLowerCase().includes(query);
        return matchesTitle || matchesMsg;
      }

      return true;
    });
  }, [notifications, activeFilter, searchTerm]);

  return (
    <div className="desktop-view-container">
      {/* Header & Action Bar */}
      <section className="erp-action-bar shrink-0">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600">
              <Bell size={18} />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-900 leading-tight">الإشعارات والتنبيهات</h2>
              <p className="text-xs text-slate-500">
                {unreadCount > 0 ? `${unreadCount} إشعارات غير مقروءة` : 'جميع الإشعارات مقروءة'}
              </p>
            </div>
          </div>

          {/* Search Input */}
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="بحث في محتوى الإشعارات..."
              className="input-ui h-9 w-full pr-9 pl-3 text-xs bg-white border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Quick Filters */}
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-bold text-slate-600">
            <button
              type="button"
              onClick={() => setActiveFilter('all')}
              className={`px-2.5 py-1 rounded-md transition-colors ${activeFilter === 'all' ? 'bg-white text-slate-900 shadow-2xs' : 'hover:text-slate-900'}`}
            >
              الكل ({notifications.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveFilter('unread')}
              className={`px-2.5 py-1 rounded-md transition-colors ${activeFilter === 'unread' ? 'bg-white text-blue-700 shadow-2xs font-extrabold' : 'hover:text-slate-900'}`}
            >
              غير مقروء ({unreadCount})
            </button>
            <button
              type="button"
              onClick={() => setActiveFilter('warning')}
              className={`px-2.5 py-1 rounded-md transition-colors ${activeFilter === 'warning' ? 'bg-white text-amber-700 shadow-2xs' : 'hover:text-slate-900'}`}
            >
              تحذيرات
            </button>
          </div>

          {unreadCount > 0 && (
            <button
              type="button"
              onClick={handleMarkAllRead}
              className="flex items-center gap-1.5 bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 transition-colors text-xs font-bold shadow-xs active:scale-95"
            >
              <Check size={14} />
              <span>تحديد الكل كمقروء</span>
            </button>
          )}
        </div>
      </section>

      {/* Main Card with Scrollable Notification Items List */}
      <section className="flex-1 min-h-0 flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100">
          {filteredNotifications.length === 0 ? (
            <div className="p-16 text-center">
              <div className="w-14 h-14 bg-slate-50 border border-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <Bell size={26} className="text-slate-300" />
              </div>
              <p className="text-sm font-bold text-slate-600">لا توجد إشعارات مطابقة</p>
              <p className="text-xs text-slate-400 mt-1">ستظهر هنا التنبيهات والأقساط المستحقة والإشعارات فور توفرها</p>
            </div>
          ) : (
            filteredNotifications.map((notification) => (
              <div
                key={notification.id}
                className={`p-4 transition-colors group ${
                  notification.isRead ? 'bg-white hover:bg-slate-50/70' : 'bg-blue-50/50 hover:bg-blue-50/80 border-r-4 border-r-blue-600'
                }`}
              >
                <div className="flex items-start gap-3.5">
                  <div className="w-9 h-9 bg-white rounded-xl border border-slate-200/80 flex items-center justify-center shadow-2xs shrink-0 mt-0.5">
                    {getIcon(notification.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <h4 className={`text-xs md:text-sm font-black truncate ${notification.isRead ? 'text-slate-800' : 'text-blue-950 font-black'}`}>
                        {notification.title}
                      </h4>
                      <span className="text-[11px] font-medium text-slate-400 whitespace-nowrap shrink-0">
                        {formatDateTimeDisplay(notification.createdAt)}
                      </span>
                    </div>
                    <p className="text-slate-600 text-xs md:text-sm leading-relaxed break-words">{notification.message}</p>
                  </div>
                  {!notification.isRead && (
                    <button
                      type="button"
                      onClick={() => handleMarkRead(notification.id)}
                      className="p-1.5 text-blue-600 hover:text-white hover:bg-blue-600 bg-blue-50 rounded-lg transition-all shrink-0 active:scale-95"
                      title="تحديد كمقروء"
                    >
                      <Check size={16} />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Pinned Bottom Status Bar */}
        <div className="erp-status-bar shrink-0">
          <span className="font-bold text-slate-700">
            إجمالي الإشعارات: <span className="text-blue-700 font-extrabold">{notifications.length}</span> (المعروض: {filteredNotifications.length})
          </span>
          <span className="font-bold text-slate-700">
            غير المقروءة: <span className={unreadCount > 0 ? 'text-amber-600 font-extrabold' : 'text-emerald-600 font-extrabold'}>{unreadCount}</span>
          </span>
        </div>
      </section>
    </div>
  );
}


