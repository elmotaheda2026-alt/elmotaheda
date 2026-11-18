import React, { useState, useEffect, useRef } from 'react';
import { Plus, Edit, Trash2, Search, UserCheck, Phone } from 'lucide-react';
import { SalesRep } from '../types';
import { getSalesReps, createSalesRep, updateSalesRep, deleteSalesRep, syncSalesReps } from '../lib/storage';
import { isApiMode } from '../lib/apiClient';
import { useAuth } from '../context/AuthContext';
import { useDialog } from '../context/DialogContext';
import { hasPermission, isAdmin } from '../lib/permissions';

export default function SalesReps() {
  const { user } = useAuth();
  const { confirmDialog, showToast } = useDialog();
  const canManageReps = hasPermission(user, 'users:manage');
  const canDelete = isAdmin(user);
  const [reps, setReps] = useState<SalesRep[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingRep, setEditingRep] = useState<SalesRep | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
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

  const loadData = async () => {
    if (isApiMode()) await syncSalesReps();
    setReps(getSalesReps());
  };

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F2' && canManageReps) {
        event.preventDefault();
        resetForm();
        setEditingRep(null);
        setShowModal(true);
      }
      if (event.key === 'F5') {
        event.preventDefault();
        void loadData();
      }
      if (event.key === 'Escape' && showModal) {
        setShowModal(false);
        setEditingRep(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showModal]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingRep) {
        await updateSalesRep(editingRep.id, formData);
        showToast('تم تحديث بيانات المندوب بنجاح', 'success');
      } else {
        await createSalesRep(formData);
        showToast('تم إضافة المندوب بنجاح', 'success');
      }
      await loadData();
      setShowModal(false);
      setEditingRep(null);
      resetForm();
    } catch (err: any) {
      showToast(err?.message || 'تعذر حفظ بيانات المندوب.', 'error');
    }
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

  const handleDelete = async (id: string) => {
    const isConfirmed = await confirmDialog({
      title: 'تأكيد حذف المندوب',
      message: 'هل أنت متأكد من حذف هذا المندوب؟',
      confirmText: 'نعم، حذف المندوب',
      cancelText: 'إلغاء',
      type: 'danger',
    });
    if (isConfirmed) {
      try {
        await deleteSalesRep(id);
        await loadData();
        showToast('تم حذف المندوب بنجاح', 'success');
      } catch (err: any) {
        showToast(err?.message || 'تعذر حذف المندوب.', 'error');
      }
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
    <div className="desktop-view-container">
      {/* Header with Search and Actions */}
      <div className="erp-action-bar shrink-0">
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-0">
          <h2 className="text-lg font-black text-slate-900 shrink-0">المناديب</h2>
          <div className="relative flex-1 min-w-[240px] max-w-sm">
            <Search size={15} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              ref={searchInputRef}
              autoFocus
              placeholder="بحث عن مندوب بالاسم أو المنطقة..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="input-ui h-9 w-full pr-10 pl-3.5 text-xs font-semibold bg-white border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 placeholder:text-slate-400"
            />
          </div>
        </div>
        {canManageReps && (
          <button
            onClick={() => { resetForm(); setShowModal(true); }}
            className="flex items-center gap-1.5 bg-[#1e40af] text-white h-9 px-4 rounded-xl hover:bg-[#1d4ed8] transition-colors text-xs font-bold shadow-xs shrink-0 cursor-pointer"
          >
            <Plus size={15} />
            <span>إضافة مندوب</span>
          </button>
        )}
      </div>

      {/* Reps Table (Desktop) & Cards (Mobile) */}
      <section className="desktop-table-card">
        {/* Mobile Cards View (< md) */}
        <div className="md:hidden flex-1 overflow-y-auto p-2.5 space-y-2.5 custom-scrollbar">
          {filteredReps.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-sm font-bold">لا يوجد مناديب مطابِقين</div>
          ) : (
            filteredReps.map((rep) => {
              const percentage = rep.target > 0 ? Math.min((rep.achieved / rep.target) * 100, 100) : 0;
              return (
                <div key={`mob-rep-${rep.id}`} className="bg-white border border-slate-200 rounded-2xl p-3.5 shadow-2xs space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-black text-slate-900 text-sm">{rep.name}</p>
                      <p className="text-xs text-slate-500 font-semibold mt-0.5">{rep.area || 'بدون منطقة'}</p>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold shrink-0 ${rep.isActive ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-slate-100 text-slate-500'}`}>
                      {rep.isActive ? 'نشط' : 'موقوف'}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-1.5 bg-slate-50 rounded-xl p-2 text-center text-xs border border-slate-100">
                    <div>
                      <span className="text-[10px] text-slate-400 block font-bold">الهدف</span>
                      <span className="font-bold text-slate-800">{rep.target.toLocaleString()}</span>
                    </div>
                    <div className="border-x border-slate-200">
                      <span className="text-[10px] text-slate-400 block font-bold">المحقق</span>
                      <span className="font-bold text-emerald-600">{rep.achieved.toLocaleString()}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block font-bold">النسبة</span>
                      <span className="font-black text-slate-700">{percentage.toFixed(0)}%</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-slate-100">
                    {rep.phone ? (
                      <a href={`tel:${rep.phone}`} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200/80 font-mono font-bold text-xs">
                        <Phone size={12} className="text-emerald-600 shrink-0" />
                        <span dir="ltr">{rep.phone}</span>
                      </a>
                    ) : <span />}
                    <div className="flex items-center gap-1.5">
                      {canManageReps && (
                        <button onClick={() => handleEdit(rep)} className="p-1.5 text-blue-600 bg-blue-50 rounded-lg" title="تعديل">
                          <Edit size={14} />
                        </button>
                      )}
                      {canDelete && (
                        <button onClick={() => handleDelete(rep.id)} className="p-1.5 text-red-600 bg-red-50 rounded-lg" title="حذف">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="hidden md:block desktop-table-scroll">
          <table className="w-full min-w-[800px] border-collapse">
            <thead className="desktop-sticky-header">
              <tr>
                <th className="py-3 px-4 text-right text-xs font-bold text-slate-700 tracking-wider">الاسم</th>
                <th className="py-3 px-4 text-right text-xs font-bold text-slate-700 tracking-wider">رقم الهاتف</th>
                <th className="py-3 px-4 text-right text-xs font-bold text-slate-700 tracking-wider">المنطقة</th>
                <th className="py-3 px-4 text-right text-xs font-bold text-slate-700 tracking-wider">الهدف الشهري</th>
                <th className="py-3 px-4 text-right text-xs font-bold text-slate-700 tracking-wider">المحقق</th>
                <th className="py-3 px-4 text-right text-xs font-bold text-slate-700 tracking-wider">نسبة التحقيق</th>
                <th className="py-3 px-4 text-center text-xs font-bold text-slate-700 tracking-wider">الحالة</th>
                <th className="py-3 px-4 text-center text-xs font-bold text-slate-700 tracking-wider">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredReps.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 px-4 text-center text-slate-400 text-xs font-bold">لا يوجد مناديب مطابِقين</td>
                </tr>
              ) : (
                filteredReps.map(rep => {
                  const percentage = rep.target > 0 ? Math.min((rep.achieved / rep.target) * 100, 100) : 0;
                  return (
                    <tr
                      key={rep.id}
                      onDoubleClick={() => canManageReps && handleEdit(rep)}
                      title={canManageReps ? 'انقر مرتين للتعديل' : ''}
                      className="group cursor-pointer hover:bg-slate-50 transition-colors"
                    >
                      <td className="py-3 px-4">
                        <span className="font-bold text-slate-900 text-xs sm:text-sm">{rep.name}</span>
                      </td>
                      <td className="py-3 px-4 text-xs sm:text-sm text-slate-700 font-mono">{rep.phone}</td>
                      <td className="py-3 px-4 text-xs sm:text-sm text-slate-600">{rep.area || '—'}</td>
                      <td className="py-3 px-4 text-xs sm:text-sm text-slate-900 font-bold">{rep.target.toLocaleString()}</td>
                      <td className="py-3 px-4 text-xs sm:text-sm text-emerald-600 font-bold">{rep.achieved.toLocaleString()}</td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-600 w-10 text-left">{percentage.toFixed(0)}%</span>
                          <div className="w-20 bg-slate-200 rounded-full h-1.5">
                            <div className="bg-emerald-500 h-1.5 rounded-full" style={{ width: `${percentage}%` }} />
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${rep.isActive ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-500'}`}>
                          {rep.isActive ? 'نشط' : 'موقوف'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="erp-icon-actions">
                          {canManageReps && (
                            <button onClick={() => handleEdit(rep)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer" title="تعديل">
                              <Edit size={15} />
                            </button>
                          )}
                          {canDelete && (
                            <button onClick={() => handleDelete(rep.id)} className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer" title="حذف">
                              <Trash2 size={15} />
                            </button>
                          )}
                          {!canManageReps && !canDelete && (
                            <span className="text-xs text-slate-400 font-bold">—</span>
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
        <div className="erp-status-bar shrink-0">
          <span className="font-bold text-slate-700">إجمالي المناديب: <span className="text-blue-700 font-extrabold">{reps.length}</span> (المعروض: {filteredReps.length})</span>
          <span className="font-bold text-slate-700">المناديب النشطون: <span className="text-emerald-700 font-extrabold">{reps.filter(r => r.isActive).length}</span></span>
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
                <button type="submit" className="flex-1 px-4 py-2 bg-[#1e40af] text-white rounded-lg hover:bg-[#1d4ed8] text-sm font-bold shadow-2xs cursor-pointer">
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
