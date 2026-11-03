import React, { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, Search, AlertCircle, RefreshCw } from 'lucide-react';
import { Expense } from '../types';
import { api, isApiMode } from '../lib/apiClient';
import { useAuth } from '../context/AuthContext';
import { DatePicker } from '../components/DatePicker';
import { formatDateDisplay } from '../lib/dateUtils';
import { formatWholeCurrency } from '../lib/utils';
import { getExpenses } from '../lib/storage';

export default function Expenses() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { settings, user } = useAuth();
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
        setError('تعذر الاتصال بقاعدة البيانات لجلب المصروفات. يرجى التحقق من اتصال الخادم وقاعدة البيانات.');
        setExpenses([]); // Strictly never fall back to local storage!
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
    if (!window.confirm(`هل أنت متأكد من حذف سند الصرف: "${description}" نهائياً من قاعدة البيانات؟`)) {
      return;
    }

    try {
      if (isApiMode()) {
        await api.deleteExpense(id);
        await loadData();
      }
    } catch (err: any) {
      console.error('Failed to delete expense:', err);
      alert(err.message || 'فشل حذف سند الصرف من قاعدة البيانات');
    }
  };

  const filteredExpenses = expenses.filter(expense =>
    (expense.description || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (expense.category || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const categories = ['رواتب', 'إيجار', 'مرافق', 'نقل', 'صيانة', 'تسويق', 'أخرى'];
  const totalExpenses = expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

  return (
    <div className="space-y-2">
      {/* Unified Compact Action Bar Header Strip */}
      <div className="erp-action-bar">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-black text-slate-900 shrink-0">المصروفات</h2>
          <div className="relative flex-1 min-w-[240px] max-w-md">
            <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              ref={searchInputRef}
              autoFocus
              placeholder="بحث في التصنيف أو وصف المصروف..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="input-ui h-9 w-full pr-9 pl-3 text-xs bg-white border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void loadData()}
            disabled={isLoading}
            className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg transition-colors text-xs font-bold border border-slate-200"
            title="تحديث البيانات من السيرفر (F5)"
          >
            <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
            <span>تحديث</span>
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-1.5 bg-blue-600 text-white px-3.5 py-1.5 rounded-lg hover:bg-blue-700 transition-colors text-xs font-bold shadow-xs"
          >
            <Plus size={15} />
            <span>+ إضافة سند صرف</span>
          </button>
        </div>
      </div>

      {/* Offline / Error Banner */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-xs font-bold flex items-center justify-between">
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

      {/* Expenses High-Density Grid Table */}
      <div className="bg-white rounded-lg shadow-xs border border-slate-200 overflow-hidden">
        <div className="overflow-auto h-[calc(100vh-210px)]">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="py-2.5 px-4 text-right text-xs font-bold text-slate-700 tracking-wider">التاريخ</th>
                <th className="py-2.5 px-4 text-right text-xs font-bold text-slate-700 tracking-wider">التصنيف</th>
                <th className="py-2.5 px-4 text-right text-xs font-bold text-slate-700 tracking-wider">البيان / الوصف</th>
                <th className="py-2.5 px-4 text-right text-xs font-bold text-slate-700 tracking-wider">المبلغ</th>
                <th className="py-2.5 px-4 text-center text-xs font-bold text-slate-700 tracking-wider w-20">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="py-12 px-4 text-center text-slate-400 text-xs font-bold">
                    <div className="flex items-center justify-center gap-2">
                      <RefreshCw size={16} className="animate-spin text-blue-600" />
                      <span>جاري جلب المصروفات من قاعدة البيانات...</span>
                    </div>
                  </td>
                </tr>
              ) : filteredExpenses.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 px-4 text-center text-slate-400 text-xs font-bold">
                    {error ? 'تعذر جلب البيانات بسبب انقطاع الاتصال بقاعدة البيانات' : 'لا توجد سندات صرف مطابِقة للبحث'}
                  </td>
                </tr>
              ) : (
                filteredExpenses.map(expense => (
                  <tr key={expense.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2.5 px-4 text-xs md:text-sm text-slate-600 font-mono">{formatDateDisplay(expense.date)}</td>
                    <td className="py-2.5 px-4">
                      <span className="px-2.5 py-1 bg-slate-100 text-slate-700 rounded-md text-xs font-semibold">{expense.category}</span>
                    </td>
                    <td className="py-2.5 px-4 text-xs md:text-sm text-slate-800 font-bold">{expense.description}</td>
                    <td className="py-2.5 px-4 text-xs md:text-sm font-bold text-rose-700">{formatCurrency(expense.amount)}</td>
                    <td className="py-2.5 px-4 text-center">
                      <button
                        onClick={() => handleDelete(expense.id, expense.description)}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="حذف سند الصرف"
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {/* Sticky Summary Footer Bar */}
        <div className="erp-status-bar">
          <span className="font-bold text-slate-700">إجمالي سندات الصرف: <span className="text-blue-700 font-extrabold">{expenses.length}</span> (المعروض: {filteredExpenses.length})</span>
          <span className="font-bold text-slate-700">إجمالي المبالغ المصروفة: <span className="text-rose-700 font-extrabold">{formatCurrency(totalExpenses)}</span></span>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-md shadow-2xl overflow-hidden animate-fadeIn">
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <h3 className="text-base font-black text-slate-800">إضافة سند صرف جديد</h3>
              <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                متصل بـ SQL Server
              </span>
            </div>
            <form onSubmit={handleSubmit} className="p-4 space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">التصنيف</label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="input-ui text-xs h-9 w-full"
                  required
                >
                  <option value="">اختر التصنيف</option>
                  {categories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">الوصف</label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="input-ui text-xs h-9 w-full"
                  placeholder="بيان سند الصرف..."
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">المبلغ</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={formData.amount === 0 ? '' : formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: parseFloat(e.target.value) || 0 })}
                  className="input-ui text-xs h-9 w-full"
                  onKeyDown={(e) => ['e', 'E', '+', '-'].includes(e.key) && e.preventDefault()}
                  placeholder="0.00"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">التاريخ</label>
                <DatePicker
                  value={formData.date}
                  onChange={(date) => setFormData({ ...formData, date })}
                  className="w-full border-slate-200 px-3 py-1.5 text-xs"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  disabled={isSubmitting}
                  className="flex-1 px-4 py-2 border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 text-xs font-bold"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-xs font-bold shadow-2xs disabled:opacity-50"
                >
                  {isSubmitting ? 'جاري الحفظ في SQL Server...' : 'حفظ السند في الداتا بيز'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
