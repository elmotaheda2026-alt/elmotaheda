import React, { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, Search, UserCheck } from 'lucide-react';
import { SalesRep } from '../types';
import { getSalesReps, createSalesRep, updateSalesRep, deleteSalesRep, syncSalesReps } from '../lib/storage';
import { isApiMode } from '../lib/apiClient';

export default function SalesReps() {
  const [reps, setReps] = useState<SalesRep[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingRep, setEditingRep] = useState<SalesRep | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    address: '',
    area: '',
    target: 0,
    commission: 0,
    isActive: true,
  });

  useEffect(() => {
    const load = async () => {
      if (isApiMode()) await syncSalesReps();
      setReps(getSalesReps());
    };
    load();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingRep) {
      await updateSalesRep(editingRep.id, formData);
    } else {
      await createSalesRep(formData);
    }
    setReps(getSalesReps());
    setShowModal(false);
    setEditingRep(null);
    resetForm();
  };

  const handleEdit = (rep: SalesRep) => {
    setEditingRep(rep);
    setFormData({
      name: rep.name,
      phone: rep.phone,
      email: rep.email || '',
      address: rep.address,
      area: rep.area,
      target: rep.target,
      commission: rep.commission,
      isActive: rep.isActive,
    });
    setShowModal(true);
  };

  const handleDelete = (id: string) => {
    if (confirm('هل أنت متأكد من حذف هذا المندوب؟')) {
      deleteSalesRep(id);
      setReps(getSalesReps());
    }
  };

  const resetForm = () => {
    setFormData({ name: '', phone: '', email: '', address: '', area: '', target: 0, commission: 0, isActive: true });
  };

  const filteredReps = reps.filter(rep =>
    rep.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    rep.phone.includes(searchTerm) ||
    rep.area.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center border-b border-slate-100 pb-2.5">
        <h2 className="text-xl font-black text-slate-900">المناديب</h2>
        <button
          onClick={() => { resetForm(); setShowModal(true); }}
          className="flex items-center gap-1.5 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors text-sm font-bold shadow-sm"
        >
          <Plus size={16} />
          <span>إضافة مندوب</span>
        </button>
      </div>

      {/* Toolbar / Search */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="relative max-w-sm">
          <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="بحث عن مندوب..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="input-ui pr-10 pl-4 py-2 text-sm w-full"
          />
        </div>
      </div>

      {/* Reps Table */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px]">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-5 py-3 text-right text-sm font-black text-slate-700">الاسم</th>
                <th className="px-5 py-3 text-right text-sm font-black text-slate-700">رقم الهاتف</th>
                <th className="px-5 py-3 text-right text-sm font-black text-slate-700">المنطقة</th>
                <th className="px-5 py-3 text-right text-sm font-black text-slate-700">الهدف الشهري</th>
                <th className="px-5 py-3 text-right text-sm font-black text-slate-700">المحقق</th>
                <th className="px-5 py-3 text-right text-sm font-black text-slate-700">نسبة التحقيق</th>
                <th className="px-5 py-3 text-center text-sm font-black text-slate-700">الحالة</th>
                <th className="px-5 py-3 text-center text-sm font-black text-slate-700">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredReps.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center text-slate-500">لا يوجد مناديب مطابِقين</td>
                </tr>
              ) : (
                filteredReps.map(rep => {
                  const percentage = rep.target > 0 ? Math.min((rep.achieved / rep.target) * 100, 100) : 0;
                  return (
                    <tr key={rep.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-5 py-3">
                        <span className="font-bold text-slate-900 text-sm">{rep.name}</span>
                      </td>
                      <td className="px-5 py-3 text-sm text-slate-700 font-mono">{rep.phone}</td>
                      <td className="px-5 py-3 text-sm text-slate-600">{rep.area || '—'}</td>
                      <td className="px-5 py-3 text-sm text-slate-900 font-bold">{rep.target.toLocaleString()}</td>
                      <td className="px-5 py-3 text-sm text-emerald-600 font-bold">{rep.achieved.toLocaleString()}</td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-600 w-10 text-left">{percentage.toFixed(0)}%</span>
                          <div className="w-20 bg-slate-200 rounded-full h-1.5">
                            <div className="bg-emerald-500 h-1.5 rounded-full" style={{ width: `${percentage}%` }} />
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${rep.isActive ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-slate-100 text-slate-500'}`}>
                          {rep.isActive ? 'نشط' : 'موقوف'}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => handleEdit(rep)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="تعديل">
                            <Edit size={15} />
                          </button>
                          <button onClick={() => handleDelete(rep.id)} className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="حذف">
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="p-5 border-b border-gray-100 bg-slate-50">
              <h3 className="text-base font-black text-slate-800">
                {editingRep ? 'تعديل مندوب' : 'إضافة مندوب جديد'}
              </h3>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">الاسم</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="input-ui text-sm h-10 w-full"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">رقم الهاتف</label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value.replace(/\D/g, '') })}
                  className="input-ui text-sm h-10 w-full"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">المنطقة</label>
                <input
                  type="text"
                  value={formData.area}
                  onChange={(e) => setFormData({ ...formData, area: e.target.value })}
                  className="input-ui text-sm h-10 w-full"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">الهدف الشهري</label>
                  <input
                    type="number"
                    value={formData.target === 0 ? '' : formData.target}
                    onChange={(e) => setFormData({ ...formData, target: parseFloat(e.target.value) || 0 })}
                    onKeyDown={(e) => ['e', 'E', '+', '-'].includes(e.key) && e.preventDefault()}
                    className="input-ui text-sm h-10 w-full"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">نسبة العمولة %</label>
                  <input
                    type="number"
                    value={formData.commission === 0 ? '' : formData.commission}
                    onChange={(e) => setFormData({ ...formData, commission: parseFloat(e.target.value) || 0 })}
                    onKeyDown={(e) => ['e', 'E', '+', '-'].includes(e.key) && e.preventDefault()}
                    className="input-ui text-sm h-10 w-full"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={formData.isActive}
                  onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                  className="h-4 w-4 rounded text-indigo-600"
                />
                <label htmlFor="isActive" className="text-sm font-bold text-slate-700 cursor-pointer">مندوب نشط حالياً</label>
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => { setShowModal(false); setEditingRep(null); }} className="flex-1 px-4 py-2 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 text-sm font-bold">
                  إلغاء
                </button>
                <button type="submit" className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-bold">
                  {editingRep ? 'تحديث' : 'إضافة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
