import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Plus, Trash2, Search, AlertCircle, RefreshCw, Printer } from 'lucide-react';
import { Expense } from '../types';
import { api, isApiMode } from '../lib/apiClient';
import { useAuth } from '../context/AuthContext';
import { useDialog } from '../context/DialogContext';
import { DatePicker } from '../components/DatePicker';
import { formatDateDisplay } from '../lib/dateUtils';
import { formatWholeCurrency } from '../lib/utils';
import { getExpenses } from '../lib/storage';
import LoadingState from '../components/LoadingState';

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
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [dateFrom, setDateFrom] = useState(initialMonthRange.from);
  const [dateTo, setDateTo] = useState(initialMonthRange.to);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [formData, setFormData] = useState({
    category: '',
    description: '',
    amount: 0,
    date: new Date().toISOString().split('T')[0],
  });

  const loadData = async () => {
    if (isApiMode()) {
      setIsLoading(true);
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

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F2') {
        event.preventDefault();
        setShowModal(true);
      }
      if (event.key === 'F5') {
        event.preventDefault();
        void loadData();
      }
      if (event.key === 'Escape' && showModal) setShowModal(false);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.category || !formData.description || formData.amount <= 0) {
      alert('يرجى ملء جميع الحقول المطلوبة بمبلغ صحيح');
      return;
    }

    setIsSubmitting(true);
    try {
      if (isApiMode()) {
        await api.createExpense({
          category: formData.category,
          description: formData.description,
          amount: formData.amount,
          date: formData.date,
        });
        await loadData();
      }
      setShowModal(false);
      setFormData({ category: '', description: '', amount: 0, date: new Date().toISOString().split('T')[0] });
    } catch (err: any) {
      console.error('Failed to save expense:', err);
      alert(err.message || 'فشل حفظ سند الصرف في قاعدة البيانات');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string, description: string) => {
    const isConfirmed = await confirmDialog({
      title: 'تأكيد حذف سند الصرف',
      message: `هل أنت متأكد من حذف سند الصرف: "${description}" نهائياً من قاعدة البيانات؟`,
      confirmText: 'نعم، حذف السند',
      cancelText: 'إلغاء',
      type: 'danger',
    });
    if (!isConfirmed) return;

    try {
      if (isApiMode()) {
        await api.deleteExpense(id);
        await loadData();
        showToast('تم حذف سند الصرف بنجاح', 'success');
      }
    } catch (err: any) {
      console.error('Failed to delete expense:', err);
      showToast(err.message || 'فشل حذف سند الصرف من قاعدة البيانات', 'error');
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
      <div className="erp-action-bar shrink-0 no-print print:hidden">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h2 className="text-lg font-black text-slate-900">المصروفات</h2>
            <p className="text-xs text-slate-500 hidden sm:block">سندات الصرف والتحكم في المصروفات التشغيلية</p>
          </div>

          <div className="relative w-52 sm:w-60">
            <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              ref={searchInputRef}
              autoFocus
              placeholder="بحث في الوصف أو التصنيف..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="input-ui h-9 w-full pr-9 pl-3 text-xs bg-slate-50/70 border-slate-200 focus:bg-white"
            />
          </div>

          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="h-9 px-3 text-xs font-bold rounded-xl border border-slate-200 bg-white text-slate-700 outline-none hover:border-slate-300 focus:border-blue-500 transition-all cursor-pointer shadow-2xs min-w-[125px]"
          >
            <option value="">كل التصنيفات</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Quick Period Presets */}
          <div className="flex items-center rounded-xl bg-slate-100 p-0.5 border border-slate-200">
            <button
              type="button"
              onClick={() => handlePresetClick('all')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                isPresetActive('all') ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              الكل
            </button>
            <button
              type="button"
              onClick={() => handlePresetClick('year')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                isPresetActive('year') ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              هذا العام
            </button>
            <button
              type="button"
              onClick={() => handlePresetClick('quarter')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                isPresetActive('quarter') ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              هذا الربع
            </button>
            <button
              type="button"
              onClick={() => handlePresetClick('month')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                isPresetActive('month') ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              هذا الشهر
            </button>
            <button
              type="button"
              onClick={() => handlePresetClick('today')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                isPresetActive('today') ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              اليوم
            </button>
          </div>

          {/* Date Range Inputs */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold text-slate-500">من:</span>
            <DatePicker
              value={dateFrom}
              onChange={setDateFrom}
              className="h-9 w-[130px] rounded-xl border-slate-200 text-xs font-bold bg-white"
            />
            <span className="text-xs font-bold text-slate-500">إلى:</span>
            <DatePicker
              value={dateTo}
              onChange={setDateTo}
              className="h-9 w-[130px] rounded-xl border-slate-200 text-xs font-bold bg-white"
            />
          </div>

          {(dateFrom || dateTo || selectedCategory || searchTerm) && (
            <button
              type="button"
              onClick={resetFilters}
              className="px-2.5 py-1.5 text-xs font-bold text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors border border-transparent hover:border-rose-200"
            >
              مسح الفلاتر
            </button>
          )}

          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg transition-colors text-xs font-bold border border-slate-200"
            title="طباعة كشف المصروفات"
          >
            <Printer size={14} />
            <span>طباعة</span>
          </button>

          {user?.role !== 'manager' && (
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-1.5 bg-blue-600 text-white px-3.5 py-1.5 rounded-lg hover:bg-blue-700 transition-colors text-xs font-bold shadow-xs whitespace-nowrap cursor-pointer"
            >
              <Plus size={15} />
              <span>+ إضافة سند صرف</span>
            </button>
          )}
        </div>
      </div>

      {/* Tier 2: Fixed Height KPI Metrics Bar */}
      <div className="grid gap-2.5 grid-cols-1 sm:grid-cols-3 shrink-0 print:grid-cols-3 print:gap-2.5 print:mb-3 no-print">
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
        <ExpensesMetric
          label="متوسط قيمة السند"
          value={formatCurrency(filteredExpenses.length > 0 ? Math.round(totalFilteredAmount / filteredExpenses.length) : 0)}
          tone="amber"
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
        <div className="desktop-table-scroll print:overflow-visible print:h-auto">
          <table className="w-full text-right border-collapse print:min-w-0 print:w-full">
            <thead className="desktop-sticky-header print:static">
              <tr>
                <th className="py-2.5 px-4 text-right text-xs font-black text-slate-700 tracking-wider">التاريخ</th>
                <th className="py-2.5 px-4 text-right text-xs font-black text-slate-700 tracking-wider">التصنيف</th>
                <th className="py-2.5 px-4 text-right text-xs font-black text-slate-700 tracking-wider">البيان / الوصف</th>
                <th className="py-2.5 px-4 text-right text-xs font-black text-slate-700 tracking-wider">المبلغ</th>
                <th className="py-2.5 px-4 text-center text-xs font-black text-slate-700 tracking-wider w-20 no-print print:hidden">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 print:divide-slate-200">
              {isLoading ? (
                <LoadingState variant="table" colSpan={5} />
              ) : filteredExpenses.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 px-4 text-center text-slate-400 text-xs font-bold">
                    {error ? 'تعذر جلب البيانات بسبب انقطاع الاتصال بقاعدة البيانات' : 'لا توجد سندات صرف مطابِقة للبحث والفترة المحددة'}
                  </td>
                </tr>
              ) : (
                filteredExpenses.map(expense => (
                  <tr key={expense.id} className="hover:bg-slate-50 transition-colors print:hover:bg-transparent print:break-inside-avoid">
                    <td className="py-2.5 px-4 text-xs md:text-sm text-slate-600 font-mono">{formatDateDisplay(expense.date)}</td>
                    <td className="py-2.5 px-4">
                      <span className="px-2.5 py-1 bg-slate-100 text-slate-700 rounded-md text-xs font-semibold">{expense.category}</span>
                    </td>
                    <td className="py-2.5 px-4 text-xs md:text-sm text-slate-800 font-bold">{expense.description}</td>
                    <td className="py-2.5 px-4 text-xs md:text-sm font-bold text-rose-700 font-mono">{formatCurrency(expense.amount)}</td>
                    <td className="py-2.5 px-4 text-center no-print print:hidden">
                      {user?.role !== 'manager' && (
                        <button
                          onClick={() => handleDelete(expense.id, expense.description)}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                          title="حذف سند الصرف"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))
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
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-md shadow-2xl overflow-hidden animate-fadeIn">
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <h3 className="text-base font-black text-slate-800">إضافة سند صرف جديد</h3>
              <button
                type="button"
                onClick={() => setShowModal(false)}
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
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  disabled={isSubmitting}
                  className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 text-xs font-bold transition-colors"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 text-xs font-bold shadow-2xs disabled:opacity-50 transition-colors"
                >
                  {isSubmitting ? 'جاري الحفظ...' : 'حفظ سند الصرف'}
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
      <p className="mt-0.5 text-xl font-black tabular-nums">{value}</p>
    </div>
  );
}
