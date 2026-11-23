import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Plus, Trash2, Search, AlertCircle, RefreshCw, Printer, Pencil } from 'lucide-react';
import { Expense } from '../types';
import { api, isApiMode } from '../lib/apiClient';
import { useRealtimeSync } from '../lib/realtimeSync';
import { useAuth } from '../context/AuthContext';
import { useDialog } from '../context/DialogContext';
import { hasPermission, isAdmin } from '../lib/permissions';
import { DatePicker } from '../components/DatePicker';
import { formatDateDisplay } from '../lib/dateUtils';
import { formatWholeCurrency } from '../lib/utils';
import { getExpenses, createExpense, updateExpense, deleteExpense } from '../lib/storage';
import { printHtmlDocument } from '../lib/printHelper';
import LoadingState from '../components/LoadingState';
import CurrencyText from '../components/CurrencyText';
import PaymentChannelSelector from '../components/PaymentChannelSelector';
import { getPaymentChannelMeta, type TreasuryChannel } from '../lib/paymentChannels';
import { escapeHtml } from '../lib/htmlUtils';

type PresetKey = 'all' | 'year' | 'quarter' | 'month' | 'today' | 'custom';

const pad = (value: number) => String(value).padStart(2, '0');
const formatLocalDate = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

function getPresetRange(key: PresetKey): { from: string; to: string } {
  const now = new Date();
  const today = formatLocalDate(now);

  switch (key) {
    case 'today':
      return { from: today, to: today };

    case 'month': {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { from: formatLocalDate(firstDay), to: formatLocalDate(lastDay) };
    }

    case 'quarter': {
      const qMonth = Math.floor(now.getMonth() / 3) * 3;
      const firstDay = new Date(now.getFullYear(), qMonth, 1);
      const lastDay = new Date(now.getFullYear(), qMonth + 3, 0);
      return { from: formatLocalDate(firstDay), to: formatLocalDate(lastDay) };
    }

    case 'year': {
      const firstDay = new Date(now.getFullYear(), 0, 1);
      const lastDay = new Date(now.getFullYear(), 11, 31);
      return { from: formatLocalDate(firstDay), to: formatLocalDate(lastDay) };
    }

    case 'all':
    default:
      return { from: '', to: '' };
  }
}

const toYMD = (dateVal?: string | Date | null): string => {
  if (!dateVal) return '';
  if (typeof dateVal === 'string') {
    const trimmed = dateVal.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
      return trimmed.slice(0, 10);
    }
    const ddmmyyyy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
    if (ddmmyyyy) {
      return `${ddmmyyyy[3]}-${pad(Number(ddmmyyyy[2]))}-${pad(Number(ddmmyyyy[1]))}`;
    }
  }
  const d = dateVal instanceof Date ? dateVal : new Date(dateVal);
  if (isNaN(d.getTime()) || d.getFullYear() <= 1970) return '';
  return formatLocalDate(d);
};

export default function Expenses() {
  const { settings, user } = useAuth();
  const { confirmDialog, showToast } = useDialog();
  const searchInputRef = useRef<HTMLInputElement>(null);

  const initialMonthRange = useMemo(() => getPresetRange('month'), []);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [dateFrom, setDateFrom] = useState(initialMonthRange.from);
  const [dateTo, setDateTo] = useState(initialMonthRange.to);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [formData, setFormData] = useState<{
    category: string;
    description: string;
    amount: number;
    date: string;
    channel: TreasuryChannel;
  }>({
    category: '',
    description: '',
    amount: 0,
    date: new Date().toISOString().split('T')[0],
    channel: 'cash',
  });

  const loadData = async (silent = false) => {
    if (isApiMode()) {
      if (!silent) {
        setIsLoading(true);
      }
      setError(null);
      try {
        const data = await api.listExpenses();
        setExpenses(Array.isArray(data) ? data : []);
      } catch (err: any) {
        console.error('Failed to load expenses from SQL Server API:', err);
        const errMsg = String(err?.message || '');
        if (errMsg.includes('403') || errMsg.includes('Forbidden') || errMsg.includes('صلاحية')) {
          setError('ليس لديك صلاحية لعرض المصروفات. يرجى مراجعة مدير النظام.');
        } else {
          setError('تعذر جلب المصروفات من السيرفر. يرجى التحقق من اتصال الخادم وقاعدة البيانات.');
        }
        setExpenses([]);
      } finally {
        setIsLoading(false);
      }
    } else {
      setExpenses(getExpenses().reverse());
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  useRealtimeSync(['expenses', 'payments'], () => {
    void loadData(true);
  });

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F2' && hasPermission(user, 'payments:write')) {
        event.preventDefault();
        openAddModal();
      }
      if (event.key === 'F5') {
        event.preventDefault();
        void loadData();
      }
      if (event.key === 'Escape' && showModal) closeExpenseModal();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showModal]);

  const formatCurrency = (amount: number) => formatWholeCurrency(amount, settings.currency);

  const isPresetActive = (key: PresetKey) => {
    if (key === 'all') return !dateFrom && !dateTo;
    const range = getPresetRange(key);
    return dateFrom === range.from && dateTo === range.to;
  };

  const handlePresetClick = (key: PresetKey) => {
    const range = getPresetRange(key);
    setDateFrom(range.from);
    setDateTo(range.to);
  };

  const resetFilters = () => {
    setDateFrom('');
    setDateTo('');
    setSelectedCategory('');
    setSearchTerm('');
  };

  const openAddModal = () => {
    setEditingExpense(null);
    setFormData({ category: '', description: '', amount: 0, date: new Date().toISOString().split('T')[0], channel: 'cash' });
    setShowModal(true);
  };

  const openEditModal = (expense: Expense) => {
    setEditingExpense(expense);
    setFormData({
      category: expense.category || '',
      description: expense.description || '',
      amount: Number(expense.amount || 0),
      date: toYMD(expense.date) || new Date().toISOString().split('T')[0],
      channel: getPaymentChannelMeta(expense.channel).id,
    });
    setShowModal(true);
  };

  const closeExpenseModal = () => {
    setShowModal(false);
    setEditingExpense(null);
    setFormData({ category: '', description: '', amount: 0, date: new Date().toISOString().split('T')[0], channel: 'cash' });
  };

  const handlePrintVoucher = async (expense: Expense) => {
    const voucherNo = `EXP-${String(expense.id).slice(-6).toUpperCase()}`;
    const channelMeta = getPaymentChannelMeta(expense.channel);
    const html = `
      <!DOCTYPE html>
      <html lang="ar" dir="rtl">
      <head>
        <meta charset="UTF-8" />
        <title>سند صرف نقدية ${voucherNo}</title>
        <style>
          body { font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif; padding: 28px; color: #0f172a; }
          .voucher { max-width: 680px; margin: 0 auto; border: 2px solid #1e293b; border-radius: 12px; padding: 24px; }
          .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #e2e8f0; padding-bottom: 14px; margin-bottom: 18px; }
          .title { font-size: 20px; font-weight: 800; color: #b91c1c; }
          .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 18px; }
          .box { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px 14px; }
          .label { font-size: 12px; color: #64748b; margin-bottom: 4px; }
          .val { font-size: 15px; font-weight: 700; }
          .signs { display: flex; justify-content: space-between; margin-top: 36px; padding-top: 12px; font-size: 13px; color: #475569; }
        </style>
      </head>
      <body>
        <div class="voucher">
          <div class="header">
            <div>
              <div style="font-weight:800;font-size:18px;">${escapeHtml(settings.companyName || 'شركة المتحدة')}</div>
              <div style="font-size:12px;color:#64748b;">سند صرف مصروفات تشغيلية</div>
            </div>
            <div class="title">سند صرف رقم #${escapeHtml(voucherNo)}</div>
          </div>
          <div class="grid">
            <div class="box"><div class="label">التاريخ</div><div class="val">${escapeHtml(formatDateDisplay(expense.date))}</div></div>
            <div class="box"><div class="label">التصنيف</div><div class="val">${escapeHtml(expense.category)}</div></div>
            <div class="box"><div class="label">المبلغ المصروف</div><div class="val" style="color:#b91c1c;">${escapeHtml(formatCurrency(expense.amount))}</div></div>
            <div class="box"><div class="label">طريقة الصرف / الخزنة</div><div class="val">${escapeHtml(channelMeta.label)}</div></div>
            <div class="box" style="grid-column: span 2;"><div class="label">سُجل بواسطة</div><div class="val">${escapeHtml(expense.createdBy || user?.name || '-')}</div></div>
          </div>
          <div class="box" style="margin-bottom:18px;">
            <div class="label">البيان / الوصف</div>
            <div class="val">${escapeHtml(expense.description)}</div>
          </div>
          <div class="signs">
            <div>توقيع المستلم: ___________________</div>
            <div>اعتماد الحسابات / الإدارة: ___________________</div>
          </div>
        </div>
      </body>
      </html>
    `;
    const opened = await printHtmlDocument(html, { title: `سند صرف ${voucherNo}`, width: 800, height: 600 });
    if (!opened) showToast('يرجى السماح بالنوافذ المنبثقة للطباعة', 'warning');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.category || !formData.description || formData.amount <= 0) {
      showToast('يرجى ملء جميع الحقول المطلوبة بمبلغ صحيح', 'warning');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        category: formData.category,
        description: formData.description,
        amount: formData.amount,
        date: formData.date,
        channel: formData.channel,
      };
      if (editingExpense) {
        await updateExpense(editingExpense.id, payload);
        showToast('تم تحديث سند الصرف بنجاح', 'success');
      } else {
        await createExpense({
          ...payload,
          createdBy: user?.name || 'مدير النظام',
        });
        showToast('تم حفظ سند الصرف بنجاح', 'success');
      }
      await loadData();
      closeExpenseModal();
    } catch (err: any) {
      console.error('Failed to save expense:', err);
      showToast(err?.message || 'فشل حفظ سند الصرف في قاعدة البيانات', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string, description: string) => {
    if (!isAdmin(user)) {
      showToast('حذف سندات الصرف متاح لمدير النظام فقط', 'warning');
      return;
    }
    const isConfirmed = await confirmDialog({
      title: 'تأكيد حذف سند الصرف',
      message: `هل أنت متأكد من حذف سند الصرف: "${description}" نهائياً من قاعدة البيانات؟`,
      confirmText: 'نعم، حذف السند',
      cancelText: 'إلغاء',
      type: 'danger',
    });
    if (!isConfirmed) return;

    try {
      await deleteExpense(id);
      await loadData();
      showToast('تم حذف سند الصرف بنجاح', 'success');
    } catch (err: any) {
      console.error('Failed to delete expense:', err);
      showToast(err?.message || 'فشل حذف سند الصرف من قاعدة البيانات', 'error');
    }
  };

  const categories = useMemo(() => {
    const defaultCats = ['رواتب', 'إيجار', 'مرافق', 'نقل', 'صيانة', 'تسويق', 'أخرى'];
    const expenseCats = expenses.map(e => e.category).filter(Boolean) as string[];
    return Array.from(new Set([...defaultCats, ...expenseCats]));
  }, [expenses]);

  const filteredExpenses = useMemo(() => {
    return expenses.filter(expense => {
      // 1. Search term filter
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const matches =
          (expense.description || '').toLowerCase().includes(term) ||
          (expense.category || '').toLowerCase().includes(term);
        if (!matches) return false;
      }

      // 2. Category filter
      if (selectedCategory && expense.category !== selectedCategory) {
        return false;
      }

      // 3. Date range filter
      if (dateFrom || dateTo) {
        const expDate = toYMD(expense.date) || toYMD(expense.createdAt);
        if (expDate) {
          if (dateFrom && expDate < dateFrom) return false;
          if (dateTo && expDate > dateTo) return false;
        }
      }

      return true;
    });
  }, [expenses, searchTerm, selectedCategory, dateFrom, dateTo]);

  const totalFilteredAmount = useMemo(
    () => filteredExpenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0),
    [filteredExpenses]
  );

  const totalAllAmount = useMemo(
    () => expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0),
    [expenses]
  );

  return (
    <div className="desktop-view-container print:p-0 print:m-0 print:w-full print:max-w-full print:block">
      {/* Print-only Company & Report Header */}
      <div className="hidden print:flex items-center justify-between border-b-2 border-slate-800 pb-2.5 mb-3">
        <div>
          <h1 className="text-lg font-black text-slate-900">{settings.companyName || 'المتحدة للتجارة والتوزيع'}</h1>
          <h2 className="text-xs font-bold text-slate-700 mt-0.5">كشف سندات الصرف والمصروفات</h2>
          <p className="text-[10px] text-slate-500 mt-0.5 font-medium">
            الفترة: <span className="font-bold text-slate-800">{!dateFrom && !dateTo ? 'كافة الفترات' : `${dateFrom ? formatDateDisplay(dateFrom) : 'البداية'} إلى ${dateTo ? formatDateDisplay(dateTo) : 'الآن'}`}</span>
            {selectedCategory && <span className="mr-2">| التصنيف: <span className="font-bold text-slate-800">{selectedCategory}</span></span>}
          </p>
        </div>
        <div className="text-left text-[10px] text-slate-500 leading-tight">
          <p>تاريخ الطباعة: <span className="font-bold text-slate-700">{new Date().toLocaleDateString('ar-EG')}</span></p>
          <p>وقت الطباعة: <span className="font-bold text-slate-700">{new Date().toLocaleTimeString('ar-EG')}</span></p>
          <p className="text-rose-700 font-bold mt-0.5">إجمالي المصروفات: {formatCurrency(totalFilteredAmount)}</p>
        </div>
      </div>

      {/* Tier 1: Fixed Compact Header & Filters */}
      <div className="bg-white border border-slate-200/90 rounded-2xl px-4 py-3 space-y-2.5 shadow-xs shrink-0 no-print print:hidden">
        {/* Row 1: Title, Search & Primary Actions */}
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-3 flex-1 min-w-0">
            <div className="shrink-0">
              <h2 className="text-lg font-black text-slate-900 leading-tight">المصروفات</h2>
              <p className="text-[11px] text-slate-500 hidden sm:block">سندات الصرف والتحكم في المصروفات التشغيلية</p>
            </div>

            <div className="relative flex-1 min-w-[220px] max-w-sm">
              <Search size={15} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="text"
                ref={searchInputRef}
                autoFocus
                placeholder="بحث في الوصف أو التصنيف..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="input-ui h-9 w-full pr-10 pl-3.5 text-xs font-semibold bg-slate-50/70 hover:bg-white focus:bg-white border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 placeholder:text-slate-400"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => window.print()}
              className="h-9 px-3.5 bg-white hover:bg-slate-50 text-slate-700 rounded-xl transition-colors text-xs font-bold border border-slate-200 flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              title="طباعة كشف المصروفات"
            >
              <Printer size={14} className="text-slate-500" />
              <span>طباعة</span>
            </button>

            {hasPermission(user, 'payments:write') && (
              <button
                type="button"
                onClick={openAddModal}
                className="flex items-center gap-1.5 bg-[#1e40af] text-white h-9 px-4 rounded-xl hover:bg-[#1d4ed8] transition-colors text-xs font-bold shadow-xs whitespace-nowrap cursor-pointer"
              >
                <Plus size={15} />
                <span>إضافة سند صرف</span>
              </button>
            )}
          </div>
        </div>

        {/* Row 2: Period Presets, Category & Date Range */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 border-t border-slate-100">
          <div className="flex flex-wrap items-center gap-2">
            {/* Quick Period Presets */}
            <div className="inline-flex h-9 items-center rounded-xl bg-slate-100/90 p-0.5 border border-slate-200/70">
              <button
                type="button"
                onClick={() => handlePresetClick('all')}
                className={`h-full px-3 text-xs font-bold rounded-lg transition-all whitespace-nowrap cursor-pointer ${
                  isPresetActive('all') ? 'bg-white text-[#1e40af] shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                الكل
              </button>
              <button
                type="button"
                onClick={() => handlePresetClick('year')}
                className={`h-full px-3 text-xs font-bold rounded-lg transition-all whitespace-nowrap cursor-pointer ${
                  isPresetActive('year') ? 'bg-white text-[#1e40af] shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                هذا العام
              </button>
              <button
                type="button"
                onClick={() => handlePresetClick('quarter')}
                className={`h-full px-3 text-xs font-bold rounded-lg transition-all whitespace-nowrap cursor-pointer ${
                  isPresetActive('quarter') ? 'bg-white text-[#1e40af] shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                هذا الربع
              </button>
              <button
                type="button"
                onClick={() => handlePresetClick('month')}
                className={`h-full px-3 text-xs font-bold rounded-lg transition-all whitespace-nowrap cursor-pointer ${
                  isPresetActive('month') ? 'bg-white text-[#1e40af] shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                هذا الشهر
              </button>
              <button
                type="button"
                onClick={() => handlePresetClick('today')}
                className={`h-full px-3 text-xs font-bold rounded-lg transition-all whitespace-nowrap cursor-pointer ${
                  isPresetActive('today') ? 'bg-white text-[#1e40af] shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                اليوم
              </button>
            </div>

            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="h-9 px-3 text-xs font-bold rounded-xl border border-slate-200/90 bg-slate-50/70 hover:bg-white focus:bg-white text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 transition-all cursor-pointer min-w-[135px]"
            >
              <option value="">كل التصنيفات</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Unified Date Range Pill */}
            <div className="flex h-9 items-center gap-1.5 bg-slate-50/70 border border-slate-200/90 rounded-xl px-2.5 text-xs">
              <span className="text-[11px] font-semibold text-slate-500">الفترة:</span>
              <DatePicker
                value={dateFrom}
                onChange={setDateFrom}
                className="h-7 w-[112px] rounded-lg border border-slate-200/70 bg-white text-xs font-bold text-slate-700 text-center"
              />
              <span className="text-[11px] font-bold text-slate-400">←</span>
              <DatePicker
                value={dateTo}
                onChange={setDateTo}
                className="h-7 w-[112px] rounded-lg border border-slate-200/70 bg-white text-xs font-bold text-slate-700 text-center"
              />
            </div>

            {(dateFrom || dateTo || selectedCategory || searchTerm) && (
              <button
                type="button"
                onClick={resetFilters}
                className="h-9 px-3 text-xs font-bold text-rose-600 bg-rose-50/70 hover:bg-rose-100/80 rounded-xl transition-colors border border-rose-200/80 whitespace-nowrap cursor-pointer"
              >
                مسح الفلاتر
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Tier 2: Fixed Height KPI Metrics Bar */}
      <div className="grid gap-2.5 grid-cols-1 sm:grid-cols-2 shrink-0 print:grid-cols-2 print:gap-2.5 print:mb-3 no-print">
        <ExpensesMetric
          label="إجمالي مصروفات الفترة"
          value={formatCurrency(totalFilteredAmount)}
          tone="rose"
        />
        <ExpensesMetric
          label="عدد سندات الصرف"
          value={`${filteredExpenses.length} سند`}
          tone="slate"
        />
      </div>

      {/* Offline / Error Banner */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-xs font-bold flex items-center justify-between no-print">
          <div className="flex items-center gap-2">
            <AlertCircle size={16} className="text-red-500 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={() => void loadData()}
            className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-xs transition-colors shrink-0"
          >
            إعادة المحاولة
          </button>
        </div>
      )}

      {/* Tier 3: Flexible & Scrollable Table Card */}
      <div className="desktop-table-card print:border print:border-slate-300 print:rounded-lg print:p-0 print:shadow-none">
        {/* Mobile Cards View (< md) */}
        <div className="md:hidden flex-1 min-h-0 overflow-y-auto p-2.5 space-y-2.5 custom-scrollbar print:hidden">
          {isLoading ? (
            <div className="py-10 text-center text-slate-400 text-xs font-bold">جاري التحميل...</div>
          ) : filteredExpenses.length === 0 ? (
            <div className="py-10 px-4 text-center text-slate-400 text-xs font-bold">
              {error ? 'تعذر جلب البيانات بسبب انقطاع الاتصال بقاعدة البيانات' : 'لا توجد سندات صرف مطابِقة للبحث والفترة المحددة'}
            </div>
          ) : (
            filteredExpenses.map((expense) => {
              const channelMeta = getPaymentChannelMeta(expense.channel);
              return (
              <div key={`mob-exp-${expense.id}`} className="bg-white border border-slate-200 rounded-2xl p-3.5 shadow-2xs space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap mb-1">
                      <span className="inline-block px-2 py-0.5 bg-slate-100 text-slate-700 rounded-md text-[11px] font-bold">
                        {expense.category}
                      </span>
                      <span className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-bold border ${channelMeta.badgeClass}`}>
                        {channelMeta.label}
                      </span>
                    </div>
                    <p className="text-sm text-slate-800 font-bold break-words">{expense.description}</p>
                  </div>
                  <span className="text-sm font-black text-rose-700 font-mono shrink-0">{formatCurrency(expense.amount)}</span>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                  <span className="text-slate-500 font-mono font-semibold">{formatDateDisplay(expense.date)}</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handlePrintVoucher(expense)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-bold transition-colors"
                    >
                      <Printer size={13} />
                      طباعة
                    </button>
                    {hasPermission(user, 'payments:write') && (
                      <button
                        type="button"
                        onClick={() => openEditModal(expense)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg text-xs font-bold transition-colors"
                      >
                        <Pencil size={13} />
                        تعديل
                      </button>
                    )}
                    {isAdmin(user) && (
                      <button
                        type="button"
                        onClick={() => handleDelete(expense.id, expense.description)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg text-xs font-bold transition-colors"
                      >
                        <Trash2 size={13} />
                        حذف
                      </button>
                    )}
                  </div>
                </div>
              </div>
              );
            })
          )}
        </div>

        <div className="hidden md:block desktop-table-scroll print:block print:overflow-visible print:h-auto">
          <table className="w-full text-right border-collapse print:min-w-0 print:w-full">
            <thead className="desktop-sticky-header print:static">
              <tr>
                <th className="py-2.5 px-4 text-right text-xs font-black text-slate-700 tracking-wider">التاريخ</th>
                <th className="py-2.5 px-4 text-right text-xs font-black text-slate-700 tracking-wider">التصنيف</th>
                <th className="py-2.5 px-4 text-right text-xs font-black text-slate-700 tracking-wider">البيان / الوصف</th>
                <th className="py-2.5 px-4 text-right text-xs font-black text-slate-700 tracking-wider">طريقة الصرف</th>
                <th className="py-2.5 px-4 text-right text-xs font-black text-slate-700 tracking-wider">المبلغ</th>
                <th className="py-2.5 px-4 text-center text-xs font-black text-slate-700 tracking-wider w-20 no-print print:hidden">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 print:divide-slate-200">
              {isLoading ? (
                <LoadingState variant="table" colSpan={6} />
              ) : filteredExpenses.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 px-4 text-center text-slate-400 text-xs font-bold">
                    {error ? 'تعذر جلب البيانات بسبب انقطاع الاتصال بقاعدة البيانات' : 'لا توجد سندات صرف مطابِقة للبحث والفترة المحددة'}
                  </td>
                </tr>
              ) : (
                filteredExpenses.map(expense => {
                  const channelMeta = getPaymentChannelMeta(expense.channel);
                  return (
                  <tr key={expense.id} className="hover:bg-slate-50 transition-colors print:hover:bg-transparent print:break-inside-avoid">
                    <td className="py-2.5 px-4 text-xs md:text-sm text-slate-600 font-mono">{formatDateDisplay(expense.date)}</td>
                    <td className="py-2.5 px-4">
                      <span className="px-2.5 py-1 bg-slate-100 text-slate-700 rounded-md text-xs font-semibold">{expense.category}</span>
                    </td>
                    <td className="py-2.5 px-4 text-xs md:text-sm text-slate-800 font-bold">{expense.description}</td>
                    <td className="py-2.5 px-4">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold border ${channelMeta.badgeClass}`}>
                        {channelMeta.label}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-xs md:text-sm font-bold text-rose-700 font-mono">{formatCurrency(expense.amount)}</td>
                    <td className="py-2.5 px-4 text-center no-print print:hidden">
                      <div className="inline-flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => handlePrintVoucher(expense)}
                          className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                          title="طباعة سند الصرف"
                        >
                          <Printer size={15} />
                        </button>
                        {hasPermission(user, 'payments:write') && (
                          <button
                            type="button"
                            onClick={() => openEditModal(expense)}
                            className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                            title="تعديل سند الصرف"
                          >
                            <Pencil size={15} />
                          </button>
                        )}
                        {isAdmin(user) && (
                          <button
                            type="button"
                            onClick={() => handleDelete(expense.id, expense.description)}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                            title="حذف سند الصرف"
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Sticky Summary Footer Bar */}
        <div className="erp-status-bar no-print print:hidden">
          <span className="font-bold text-slate-700">
            عدد السندات المعروضة: <span className="text-blue-700 font-extrabold">{filteredExpenses.length}</span>
            {filteredExpenses.length !== expenses.length && (
              <span className="text-slate-400 font-normal mr-1.5">(من أصل {expenses.length} مسجلة)</span>
            )}
          </span>
          <span className="font-bold text-slate-700">
            إجمالي المصروفات للفترة: <span className="text-rose-700 font-extrabold text-sm">{formatCurrency(totalFilteredAmount)}</span>
            {filteredExpenses.length !== expenses.length && (
              <span className="text-slate-400 font-normal mr-2 text-[11px]">(إجمالي الكل: {formatCurrency(totalAllAmount)})</span>
            )}
          </span>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-md shadow-2xl overflow-hidden animate-fadeIn">
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <h3 className="text-base font-black text-slate-800">{editingExpense ? 'تعديل سند الصرف' : 'إضافة سند صرف جديد'}</h3>
              <button
                type="button"
                onClick={closeExpenseModal}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-200/60 transition-colors"
                title="إغلاق"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-4 space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">التصنيف</label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs md:text-sm font-bold text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 hover:border-slate-300 transition-all cursor-pointer"
                  required
                >
                  <option value="">اختر التصنيف</option>
                  {categories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">الوصف / البيان</label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs md:text-sm font-bold text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 hover:border-slate-300 transition-all"
                  placeholder="بيان سند الصرف..."
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">المبلغ</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={formData.amount === 0 ? '' : formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: parseFloat(e.target.value) || 0 })}
                  className="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs md:text-sm font-bold font-mono text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 hover:border-slate-300 transition-all"
                  onKeyDown={(e) => ['e', 'E', '+', '-'].includes(e.key) && e.preventDefault()}
                  placeholder="0.00"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">التاريخ</label>
                <DatePicker
                  value={formData.date}
                  onChange={(date) => setFormData({ ...formData, date })}
                  className="w-full h-10 rounded-xl border-slate-200 px-3 text-xs md:text-sm font-bold"
                />
              </div>
              <PaymentChannelSelector
                compact
                label="خزنة الصرف"
                value={formData.channel}
                onChange={(channel) => setFormData({ ...formData, channel })}
              />
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeExpenseModal}
                  disabled={isSubmitting}
                  className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 text-xs font-bold transition-colors"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 px-4 py-2.5 bg-[#1e40af] text-white rounded-xl hover:bg-[#1d4ed8] text-xs font-bold shadow-2xs disabled:opacity-50 transition-colors"
                >
                  {isSubmitting ? 'جاري الحفظ...' : editingExpense ? 'حفظ التعديلات' : 'حفظ سند الصرف'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function ExpensesMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'rose' | 'slate' | 'amber';
}) {
  const toneClass = {
    rose: 'border-rose-200 bg-rose-50 text-rose-800 print:bg-rose-50/50 print:border-rose-200',
    slate: 'border-slate-200 bg-white text-slate-800 print:border-slate-300',
    amber: 'border-amber-200 bg-amber-50 text-amber-800 print:bg-amber-50/50 print:border-amber-200',
  }[tone];

  return (
    <div className={`rounded-xl border p-3 shadow-2xs ${toneClass}`}>
      <p className="text-xs font-bold opacity-75">{label}</p>
      <p className="mt-0.5 text-xl font-black tabular-nums"><CurrencyText value={value} /></p>
    </div>
  );
}
