import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  Check,
  AlertTriangle,
  Info,
  CheckCircle,
  Search,
  ArrowDownLeft,
  ArrowUpRight,
  RotateCcw,
  CalendarClock,
  FileText,
  Truck,
  ExternalLink,
} from 'lucide-react';
import { Notification } from '../types';
import { getNotifications, markNotificationRead, markAllNotificationsRead, syncNotifications } from '../lib/storage';
import { useAuth } from '../context/AuthContext';
import { canViewNotification } from '../lib/permissions';
import { formatDateDisplay, today } from '../lib/dateUtils';

type FilterType =
  | 'all'
  | 'unread'
  | 'treasury'
  | 'sales'
  | 'installments'
  | 'purchases'
  | 'warning';

type NotificationCategory =
  | 'treasury_in'
  | 'treasury_out'
  | 'returns'
  | 'installments'
  | 'sales'
  | 'purchases'
  | 'general';

interface CategoryMeta {
  category: NotificationCategory;
  filterGroup: 'treasury' | 'sales' | 'installments' | 'purchases' | 'general';
  label: string;
  titleClass: string;
  iconBoxClass: string;
  accentBorderClass: string;
  icon: React.ReactNode;
  route?: string;
  routeLabel?: string;
}

function classifyNotification(notification: Notification): CategoryMeta {
  const title = notification.title || '';
  const message = notification.message || '';
  const text = `${title} ${message}`;

  if (/مرتجع|إلغاء|استرداد|عكس/.test(text)) {
    return {
      category: 'returns',
      filterGroup: 'sales',
      label: 'مرتجع / إلغاء',
      titleClass: 'text-rose-700',
      iconBoxClass: 'bg-rose-50 text-rose-600 border-rose-200',
      accentBorderClass: 'border-r-rose-500',
      icon: <RotateCcw size={18} />,
      route: '/invoices',
      routeLabel: 'سجل المبيعات',
    };
  }

  if (/فاتورة جديدة/.test(title)) {
    return {
      category: 'sales',
      filterGroup: 'sales',
      label: 'مبيعات',
      titleClass: 'text-blue-700',
      iconBoxClass: 'bg-blue-50 text-blue-600 border-blue-200',
      accentBorderClass: 'border-r-blue-500',
      icon: <FileText size={18} />,
      route: '/invoices',
      routeLabel: 'سجل المبيعات',
    };
  }

  if (/شراء تلقائي|فاتورة شراء|مديونية المورد|توريد|مخزن|حد الطلب|INV-PO-/.test(text)) {
    return {
      category: 'purchases',
      filterGroup: 'purchases',
      label: 'مشتريات وموردين',
      titleClass: 'text-cyan-700',
      iconBoxClass: 'bg-cyan-50 text-cyan-600 border-cyan-200',
      accentBorderClass: 'border-r-cyan-500',
      icon: <Truck size={18} />,
      route: '/suppliers',
      routeLabel: 'الموردين',
    };
  }

  if (/خزينة صادر|صادر|دفعة للمورد|مصروف|سند صرف/.test(text)) {
    const isExpense = /مصروف|سند صرف/.test(text);
    return {
      category: 'treasury_out',
      filterGroup: 'treasury',
      label: 'صادر خزينة',
      titleClass: 'text-orange-700',
      iconBoxClass: 'bg-orange-50 text-orange-600 border-orange-200',
      accentBorderClass: 'border-r-orange-500',
      icon: <ArrowUpRight size={18} />,
      route: isExpense ? '/expenses' : '/payments',
      routeLabel: isExpense ? 'المصروفات' : 'الخزينة',
    };
  }

  if (/خزينة وارد|وارد|تحصيل|دفعة مقدمة|سند قبض/.test(text)) {
    return {
      category: 'treasury_in',
      filterGroup: 'treasury',
      label: 'وارد خزينة',
      titleClass: 'text-emerald-700',
      iconBoxClass: 'bg-emerald-50 text-emerald-600 border-emerald-200',
      accentBorderClass: 'border-r-emerald-500',
      icon: <ArrowDownLeft size={18} />,
      route: '/payments',
      routeLabel: 'الخزينة',
    };
  }

  if (/قسط|أقساط|جدولة|ترحيل|متأخر/.test(text)) {
    return {
      category: 'installments',
      filterGroup: 'installments',
      label: 'أقساط وجدولة',
      titleClass: 'text-violet-700',
      iconBoxClass: 'bg-violet-50 text-violet-600 border-violet-200',
      accentBorderClass: 'border-r-violet-500',
      icon: <CalendarClock size={18} />,
      route: '/collection-statement',
      routeLabel: 'متابعة التحصيل',
    };
  }

  if (/فاتورة|تعاقد|INV-|PB-/.test(text)) {
    return {
      category: 'sales',
      filterGroup: 'sales',
      label: 'مبيعات',
      titleClass: 'text-blue-700',
      iconBoxClass: 'bg-blue-50 text-blue-600 border-blue-200',
      accentBorderClass: 'border-r-blue-500',
      icon: <FileText size={18} />,
      route: '/invoices',
      routeLabel: 'سجل المبيعات',
    };
  }

  if (notification.type === 'warning' || notification.type === 'error') {
    return {
      category: 'general',
      filterGroup: 'general',
      label: 'تنبيه',
      titleClass: 'text-amber-700',
      iconBoxClass: 'bg-amber-50 text-amber-600 border-amber-200',
      accentBorderClass: 'border-r-amber-500',
      icon: <AlertTriangle size={18} />,
    };
  }

  if (notification.type === 'success') {
    return {
      category: 'general',
      filterGroup: 'general',
      label: 'إشعار',
      titleClass: 'text-emerald-700',
      iconBoxClass: 'bg-emerald-50 text-emerald-600 border-emerald-200',
      accentBorderClass: 'border-r-emerald-500',
      icon: <CheckCircle size={18} />,
    };
  }

  return {
    category: 'general',
    filterGroup: 'general',
    label: 'عام',
    titleClass: 'text-sky-700',
    iconBoxClass: 'bg-sky-50 text-sky-600 border-sky-200',
    accentBorderClass: 'border-r-sky-500',
    icon: <Info size={18} />,
  };
}

function formatNotificationTime(dateStr?: string | null): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return String(dateStr);
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const formattedDate = formatDateDisplay(date);
  if (hours === 0 && minutes === 0) {
    return formattedDate;
  }
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')} • ${formattedDate}`;
}

function getDateGroupLabel(dateStr?: string | null): { key: string; label: string } {
  if (!dateStr) return { key: 'unknown', label: 'سابقاً' };
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return { key: 'unknown', label: 'سابقاً' };

  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const isoDay = `${y}-${m}-${d}`;

  const todayIso = today();
  const yesterdayDate = new Date(`${todayIso}T00:00:00`);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayIso = `${yesterdayDate.getFullYear()}-${String(yesterdayDate.getMonth() + 1).padStart(2, '0')}-${String(yesterdayDate.getDate()).padStart(2, '0')}`;

  if (isoDay === todayIso) {
    return { key: isoDay, label: `اليوم — ${formatDateDisplay(isoDay)}` };
  }
  if (isoDay === yesterdayIso) {
    return { key: isoDay, label: `أمس — ${formatDateDisplay(isoDay)}` };
  }
  return { key: isoDay, label: formatDateDisplay(isoDay) };
}

function renderHighlightedMessage(message: string): React.ReactNode {
  if (!message) return null;
  const pattern = /((?:INV-PO-|INV-|PB-|RCPT-)\d+|[0-9\u0660-\u0669,.\u066B\u066C]+\s*جنيه)/g;
  const parts = message.split(pattern);

  return parts.map((part, idx) => {
    if (!part) return null;
    if (/^(?:INV-PO-|INV-|PB-|RCPT-)\d+$/.test(part)) {
      return (
        <span
          key={idx}
          dir="ltr"
          className="inline-block font-mono font-bold text-[11px] text-slate-800 bg-slate-100 border border-slate-200/80 px-1.5 py-0.5 rounded mx-0.5"
        >
          {part}
        </span>
      );
    }
    if (/^[0-9\u0660-\u0669,.\u066B\u066C]+\s*جنيه$/.test(part)) {
      return (
        <span key={idx} className="font-extrabold text-slate-900">
          {part}
        </span>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

export default function Notifications() {
  const { user } = useAuth();
  const navigate = useNavigate();
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
      if (active) {
        setNotifications(getNotifications().filter((n) => canViewNotification(user, n)));
      }
    };

    loadNotifications();
    return () => {
      active = false;
    };
  }, [user]);

  const handleMarkRead = async (id: string) => {
    setNotifications((current) =>
      current.map((notification) => (notification.id === id ? { ...notification, isRead: true } : notification)),
    );
    try {
      await markNotificationRead(id);
    } finally {
      setNotifications(getNotifications().filter((n) => canViewNotification(user, n)));
    }
  };

  const handleMarkAllRead = async () => {
    setNotifications((current) => current.map((notification) => ({ ...notification, isRead: true })));
    try {
      await markAllNotificationsRead();
    } finally {
      setNotifications(getNotifications().filter((n) => canViewNotification(user, n)));
    }
  };

  const classifiedItems = useMemo(() => {
    return notifications.map((notification) => ({
      notification,
      meta: classifyNotification(notification),
    }));
  }, [notifications]);

  const counts = useMemo(() => {
    let unread = 0;
    let treasury = 0;
    let sales = 0;
    let installments = 0;
    let purchases = 0;
    let warning = 0;

    for (const { notification, meta } of classifiedItems) {
      if (!notification.isRead) unread += 1;
      if (meta.filterGroup === 'treasury') treasury += 1;
      if (meta.filterGroup === 'sales') sales += 1;
      if (meta.filterGroup === 'installments') installments += 1;
      if (meta.filterGroup === 'purchases') purchases += 1;
      if (notification.type === 'warning' || notification.type === 'error' || meta.category === 'returns') {
        warning += 1;
      }
    }

    return { unread, treasury, sales, installments, purchases, warning };
  }, [classifiedItems]);

  const filteredItems = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();

    return classifiedItems.filter(({ notification, meta }) => {
      if (activeFilter === 'unread' && notification.isRead) return false;
      if (activeFilter === 'treasury' && meta.filterGroup !== 'treasury') return false;
      if (activeFilter === 'sales' && meta.filterGroup !== 'sales') return false;
      if (activeFilter === 'installments' && meta.filterGroup !== 'installments') return false;
      if (activeFilter === 'purchases' && meta.filterGroup !== 'purchases') return false;
      if (
        activeFilter === 'warning' &&
        notification.type !== 'warning' &&
        notification.type !== 'error' &&
        meta.category !== 'returns'
      ) {
        return false;
      }

      if (query) {
        const matchesTitle = notification.title?.toLowerCase().includes(query);
        const matchesMsg = notification.message?.toLowerCase().includes(query);
        const matchesCategory = meta.label.toLowerCase().includes(query);
        return matchesTitle || matchesMsg || matchesCategory;
      }

      return true;
    });
  }, [classifiedItems, activeFilter, searchTerm]);

  const groupedItems = useMemo(() => {
    const groups: Array<{ key: string; label: string; items: typeof filteredItems }> = [];
    const indexByKey = new Map<string, number>();

    for (const entry of filteredItems) {
      const { key, label } = getDateGroupLabel(entry.notification.createdAt);
      const existingIdx = indexByKey.get(key);
      if (existingIdx !== undefined) {
        groups[existingIdx].items.push(entry);
      } else {
        indexByKey.set(key, groups.length);
        groups.push({ key, label, items: [entry] });
      }
    }

    return groups;
  }, [filteredItems]);

  const filterButtons: Array<{
    id: FilterType;
    label: string;
    count?: number;
    dotClass?: string;
    activeClass: string;
    countActiveClass: string;
  }> = [
    {
      id: 'all',
      label: 'الكل',
      count: notifications.length,
      activeClass: 'bg-slate-900 text-white border-slate-900 shadow-xs',
      countActiveClass: 'bg-white/20 text-white',
    },
    {
      id: 'unread',
      label: 'غير مقروء',
      count: counts.unread,
      dotClass: 'bg-blue-500',
      activeClass: 'bg-blue-600 text-white border-blue-600 shadow-xs',
      countActiveClass: 'bg-white/20 text-white',
    },
    {
      id: 'treasury',
      label: 'الخزينة',
      count: counts.treasury,
      dotClass: 'bg-emerald-500',
      activeClass: 'bg-emerald-600 text-white border-emerald-600 shadow-xs',
      countActiveClass: 'bg-white/20 text-white',
    },
    {
      id: 'sales',
      label: 'المبيعات',
      count: counts.sales,
      dotClass: 'bg-blue-500',
      activeClass: 'bg-blue-600 text-white border-blue-600 shadow-xs',
      countActiveClass: 'bg-white/20 text-white',
    },
    {
      id: 'installments',
      label: 'الأقساط',
      count: counts.installments,
      dotClass: 'bg-violet-500',
      activeClass: 'bg-violet-600 text-white border-violet-600 shadow-xs',
      countActiveClass: 'bg-white/20 text-white',
    },
    {
      id: 'purchases',
      label: 'المشتريات',
      count: counts.purchases,
      dotClass: 'bg-cyan-500',
      activeClass: 'bg-cyan-600 text-white border-cyan-600 shadow-xs',
      countActiveClass: 'bg-white/20 text-white',
    },
    {
      id: 'warning',
      label: 'تحذيرات ومرتجعات',
      count: counts.warning,
      dotClass: 'bg-rose-500',
      activeClass: 'bg-rose-600 text-white border-rose-600 shadow-xs',
      countActiveClass: 'bg-white/20 text-white',
    },
  ];

  return (
    <div className="desktop-view-container">
      {/* Header & Action Bar */}
      <section className="erp-action-bar shrink-0 flex-col items-stretch gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600">
              <Bell size={18} />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-900 leading-tight">الإشعارات والتنبيهات</h2>
              <p className="text-xs text-slate-500">
                {counts.unread > 0 ? `${counts.unread} إشعارات غير مقروءة` : 'جميع الإشعارات مقروءة'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-1 sm:flex-initial justify-end">
            {/* Search Input */}
            <div className="relative flex-1 sm:w-72">
              <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="بحث برقم الفاتورة، العميل، أو المحتوى..."
                className="input-ui h-9 w-full pr-9 pl-3 text-xs bg-white border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>

            {counts.unread > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="flex items-center gap-1.5 bg-[#1e40af] text-white px-3 h-9 rounded-lg hover:bg-[#1d4ed8] transition-colors text-xs font-bold shadow-xs active:scale-95 shrink-0"
              >
                <Check size={14} />
                <span>تحديد الكل كمقروء</span>
              </button>
            )}
          </div>
        </div>

        {/* Clean Single-Line Category Filter Strip */}
        <div className="flex flex-wrap items-center gap-1.5 pt-2.5 border-t border-slate-100">
          {filterButtons.map((btn) => {
            const isActive = activeFilter === btn.id;
            return (
              <button
                key={btn.id}
                type="button"
                onClick={() => setActiveFilter(btn.id)}
                className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap ${
                  isActive
                    ? btn.activeClass
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                {!isActive && btn.dotClass && <span className={`w-2 h-2 rounded-full ${btn.dotClass}`} />}
                <span>{btn.label}</span>
                {typeof btn.count === 'number' && btn.count > 0 && (
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-full font-extrabold leading-none ${
                      isActive ? btn.countActiveClass : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {btn.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* Main Card with Grouped Notification Cards */}
      <section className="flex-1 min-h-0 flex flex-col rounded-xl border border-slate-200 bg-slate-50/60 shadow-sm overflow-hidden">
        <div className="flex-1 min-h-0 overflow-y-auto p-3 md:p-4 space-y-5">
          {filteredItems.length === 0 ? (
            <div className="p-16 text-center bg-white rounded-xl border border-slate-200/80">
              <div className="w-14 h-14 bg-slate-50 border border-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <Bell size={26} className="text-slate-300" />
              </div>
              <p className="text-sm font-bold text-slate-600">لا توجد إشعارات مطابقة</p>
              <p className="text-xs text-slate-400 mt-1">ستظهر هنا التنبيهات والأقساط المستحقة والإشعارات فور توفرها</p>
            </div>
          ) : (
            groupedItems.map((group) => (
              <div key={group.key} className="space-y-2.5">
                <div className="flex items-center gap-2 px-1">
                  <span className="text-xs font-black text-slate-500 bg-white border border-slate-200/80 px-2.5 py-1 rounded-full shadow-2xs">
                    {group.label}
                  </span>
                  <div className="h-px flex-1 bg-slate-200/70" />
                  <span className="text-[11px] font-bold text-slate-400">{group.items.length}</span>
                </div>

                <div className="space-y-2">
                  {group.items.map(({ notification, meta }) => (
                    <div
                      key={notification.id}
                      className={`rounded-xl border border-slate-200/90 border-r-4 ${meta.accentBorderClass} p-3.5 transition-all group ${
                        notification.isRead
                          ? 'bg-white hover:shadow-xs hover:border-slate-300'
                          : 'bg-blue-50/40 shadow-2xs hover:bg-blue-50/60'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 mt-0.5 ${meta.iconBoxClass}`}
                        >
                          {meta.icon}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                            <div className="flex items-center gap-2 min-w-0">
                              {!notification.isRead && (
                                <span className="w-2 h-2 rounded-full bg-blue-600 shrink-0" title="غير مقروء" />
                              )}
                              <h4 className={`text-sm font-black truncate ${meta.titleClass}`}>
                                {notification.title}
                              </h4>
                            </div>

                            <span className="text-[11px] font-medium text-slate-400 whitespace-nowrap shrink-0">
                              {formatNotificationTime(notification.createdAt)}
                            </span>
                          </div>

                          <p className="text-slate-600 text-xs md:text-[13px] leading-relaxed break-words">
                            {renderHighlightedMessage(notification.message)}
                          </p>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {meta.route && meta.routeLabel && (
                            <button
                              type="button"
                              onClick={() => navigate(meta.route!)}
                              className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold text-slate-600 hover:text-blue-700 bg-slate-100/80 hover:bg-blue-50 border border-slate-200/80 hover:border-blue-200 rounded-lg transition-colors"
                              title={meta.routeLabel}
                            >
                              <span>{meta.routeLabel}</span>
                              <ExternalLink size={12} />
                            </button>
                          )}

                          {!notification.isRead && (
                            <button
                              type="button"
                              onClick={() => handleMarkRead(notification.id)}
                              className="p-1.5 text-blue-600 hover:text-white hover:bg-blue-600 bg-blue-50 border border-blue-200/60 rounded-lg transition-all shrink-0 active:scale-95"
                              title="تحديد كمقروء"
                            >
                              <Check size={15} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Pinned Bottom Status Bar */}
        <div className="erp-status-bar shrink-0">
          <span className="font-bold text-slate-700">
            إجمالي الإشعارات: <span className="text-blue-700 font-extrabold">{notifications.length}</span> (المعروض: {filteredItems.length})
          </span>
          <span className="font-bold text-slate-700">
            غير المقروءة: <span className={counts.unread > 0 ? 'text-amber-600 font-extrabold' : 'text-emerald-600 font-extrabold'}>{counts.unread}</span>
          </span>
        </div>
      </section>
    </div>
  );
}


