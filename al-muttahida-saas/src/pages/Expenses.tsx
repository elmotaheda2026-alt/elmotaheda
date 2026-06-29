import React, { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, Search, Receipt } from 'lucide-react';
import { Expense } from '../types';
import { getExpenses, createExpense, syncExpenses } from '../lib/storage';
import { isApiMode } from '../lib/apiClient';
import { useAuth } from '../context/AuthContext';
import { DatePicker } from '../components/DatePicker';
import { formatDateDisplay } from '../lib/dateUtils';
import { formatWholeCurrency } from '../lib/utils';

export default function Expenses() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const { settings } = useAuth();
  const [formData, setFormData] = useState({
    category: '',
    description: '',
    amount: 0,
    date: new Date().toISOString().split('T')[0],
  });

  useEffect(() => {
    const loadData = async () => {
      if (isApiMode()) {
        try {
          await syncExpenses();
        } catch (err) {
          console.error('Failed to sync expenses:', err);
        }
      }
      setExpenses(getExpenses().reverse());
    };
    void loadData();
  }, []);

  const formatCurrency = (amount: number) => formatWholeCurrency(amount, settings.currency);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await createExpense({
      category: formData.category,
      description: formData.description,
      amount: formData.amount,
      date: formData.date,
      createdBy: 'current_user',
    });
    setExpenses(getExpenses().reverse());
    setShowModal(false);
    setFormData({ category: '', description: '', amount: 0, date: new Date().toISOString().split('T')[0] });
  };

  const filteredExpenses = expenses.filter(expense =>
    expense.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
    expense.category.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const categories = ['رواتب', 'إيجار', 'مرافق', 'نقل', 'صيانة', 'تسويق', 'أخرى'];
  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center border-b border-slate-100 pb-2.5">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-black text-slate-900">المصروفات</h2>
          <span className="text-xs bg-slate-100 px-2 py-1 rounded-md font-bold text-slate-600">
            إجمالي المصروفات: {formatCurrency(totalExpenses)}
          </span>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors text-sm font-bold shadow-sm"
        >
          <Plus size={16} />
          <span>إضافة سند صرف</span>
        </button>
      </div>

      {/* Toolbar / Search */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="relative max-w-sm">
          <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="بحث..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="input-ui pr-10 pl-4 py-2 text-sm w-full"
          />
        </div>
      </div>

      {/* Expenses Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-5 py-3 text-right text-sm font-black text-slate-700">التاريخ</th>
                <th className="px-5 py-3 text-right text-sm font-black text-slate-700">التصنيف</th>
                <th className="px-5 py-3 text-right text-sm font-black text-slate-700">الوصف</th>
                <th className="px-5 py-3 text-right text-sm font-black text-slate-700">المبلغ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredExpenses.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-5 py-12 text-center text-slate-500">لا توجد سندات صرف مطابِقة</td>
                </tr>
              ) : (
                filteredExpenses.map(expense => (
                  <tr key={expense.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-5 py-3 text-sm text-slate-600 font-mono">{formatDateDisplay(expense.date)}</td>
                    <td className="px-5 py-3">
                      <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full text-xs font-bold">{expense.category}</span>
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-900 font-bold">{expense.description}</td>
                    <td className="px-5 py-3 text-sm font-black text-red-600">{formatCurrency(expense.amount)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="p-5 border-b border-gray-100 bg-slate-50">
              <h3 className="text-base font-black text-slate-800">إضافة سند صرف جديد</h3>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">التصنيف</label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="input-ui text-sm h-10 w-full"
                  required
                >
                  <option value="">اختر التصنيف</option>
                  {categories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">الوصف</label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="input-ui text-sm h-10 w-full"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">المبلغ</label>
                <input
                  type="number"
                  value={formData.amount === 0 ? '' : formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: parseFloat(e.target.value) || 0 })}
                  className="input-ui text-sm h-10 w-full"
                  onKeyDown={(e) => ['e', 'E', '+', '-'].includes(e.key) && e.preventDefault()}
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">التاريخ</label>
                <DatePicker
                  value={formData.date}
                  onChange={(date) => setFormData({ ...formData, date })}
                  className="w-full border-gray-300 px-4 py-2"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 px-4 py-2 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 text-sm font-bold">
                  إلغاء
                </button>
                <button type="submit" className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-bold">
                  حفظ
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
