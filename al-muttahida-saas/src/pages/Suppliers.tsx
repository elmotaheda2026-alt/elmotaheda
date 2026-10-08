import React, { useState, useEffect, useRef } from 'react';
import { Plus, Edit, Trash2, Search, Phone, MapPin, DollarSign, Truck } from 'lucide-react';
import { Supplier } from '../types';
import { getSuppliers, createSupplier, updateSupplier, deleteSupplier, syncSuppliers } from '../lib/storage';
import { useAuth } from '../context/AuthContext';
import { hasPermission, isAdmin } from '../lib/permissions';
import { formatDateDisplay } from '../lib/dateUtils';
import { formatWholeCurrency } from '../lib/utils';

export default function Suppliers() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    address: '',
    notes: '',
  });
  const { settings, user } = useAuth();
  const canDelete = isAdmin(user);

  useEffect(() => {
    loadSuppliers();
  }, []);

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F2') {
        event.preventDefault();
        resetForm();
        setEditingSupplier(null);
        setShowModal(true);
      }
      if (event.key === 'F5') {
        event.preventDefault();
        void loadSuppliers();
      }
      if (event.key === 'Escape' && showModal) {
        setShowModal(false);
        setEditingSupplier(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showModal]);

  const loadSuppliers = async () => {
    await syncSuppliers();
    const data = getSuppliers();
    setSuppliers(data);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingSupplier) {
      await updateSupplier(editingSupplier.id, formData);
    } else {
      await createSupplier(formData);
    }
    await loadSuppliers();
    setShowModal(false);
    setEditingSupplier(null);
    resetForm();
  };

  const handleEdit = (supplier: Supplier) => {
    setEditingSupplier(supplier);
    setFormData({
      name: supplier.name,
      phone: supplier.phone,
      address: supplier.address,
      notes: supplier.notes || '',
    });
    setShowModal(true);
  };

  const handleDelete = async (supplier: Supplier) => {
    if (Number(supplier.balance || 0) !== 0) {
      alert('لا يمكن حذف المورد قبل تصفية رصيد حساب المورد.');
      return;
    }

    if (!confirm('هل أنت متأكد من حذف هذا المورد؟ سيتم حذف المشتريات والمدفوعات المرتبطة به من النظام.')) return;

    try {
      await deleteSupplier(supplier.id);
      await loadSuppliers();
    } catch (err: any) {
      alert(err.message || 'حدث خطأ أثناء حذف المورد.');
    }
  };

  const resetForm = () => {
    setFormData({ name: '', phone: '', address: '', notes: '' });
  };

  const filteredSuppliers = suppliers.filter(supplier =>
    supplier.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    supplier.phone.includes(searchTerm)
  );

  const formatCurrency = (amount: number) => formatWholeCurrency(amount, settings.currency);
  const totalSuppliersBalance = suppliers.reduce((sum, s) => sum + Number(s.balance || 0), 0);

  return (
    <div className="space-y-2">
      {/* Unified Compact Action Bar Header Strip */}
      <div className="erp-action-bar">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-black text-slate-900 shrink-0">الموردين</h2>
          <div className="relative flex-1 min-w-[240px] max-w-md">
            <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              ref={searchInputRef}
              autoFocus
              placeholder="بحث باسم المورد أو رقم الهاتف..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="input-ui h-9 w-full pr-9 pl-3 text-xs bg-white border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>
        </div>
        <button
          onClick={() => { resetForm(); setShowModal(true); }}
          className="flex items-center gap-1.5 bg-blue-600 text-white px-3.5 py-1.5 rounded-lg hover:bg-blue-700 transition-colors text-xs font-bold shadow-xs"
        >
          <Plus size={15} />
          <span>+ إضافة مورد</span>
        </button>
      </div>

      {/* Suppliers High-Density Table */}
      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xs">
        <div className="overflow-auto h-[calc(100vh-210px)]">
          <table className="w-full min-w-[700px]">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="py-2.5 px-4 text-right text-xs font-bold text-slate-700 tracking-wider">اسم المورد</th>
                <th className="py-2.5 px-4 text-right text-xs font-bold text-slate-700 tracking-wider">رقم الهاتف</th>
                <th className="py-2.5 px-4 text-right text-xs font-bold text-slate-700 tracking-wider">العنوان</th>
                <th className="py-2.5 px-4 text-right text-xs font-bold text-slate-700 tracking-wider">رصيد المورد</th>
                <th className="py-2.5 px-4 text-center text-xs font-bold text-slate-700 tracking-wider">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredSuppliers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 px-4 text-center text-slate-400 text-xs font-bold">لا يوجد موردين مطابِقين للبحث</td>
                </tr>
              ) : (
                filteredSuppliers.map(supplier => (
                  <tr
                    key={supplier.id}
                    onDoubleClick={() => hasPermission(user, 'sales:write') && handleEdit(supplier)}
                    title="انقر مرتين للتعديل"
                    className="group cursor-pointer hover:bg-slate-50 transition-colors"
                  >
                    <td className="py-2.5 px-4 font-bold text-slate-900 text-xs md:text-sm">{supplier.name}</td>
                    <td className="py-2.5 px-4 text-xs md:text-sm text-slate-700 font-mono">{supplier.phone}</td>
                    <td className="py-2.5 px-4 text-xs md:text-sm text-slate-600 truncate max-w-[240px]">{supplier.address || '—'}</td>
                    <td className="py-2.5 px-4 text-xs md:text-sm font-bold">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold ${supplier.balance > 0 ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
                        {formatCurrency(supplier.balance)}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-center">
                      <div className="erp-icon-actions">
                        {hasPermission(user, 'sales:write') && (
                          <button onClick={() => handleEdit(supplier)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-md transition-colors" title="تعديل">
                            <Edit size={15} />
                          </button>
                        )}
                        {canDelete && (
                          <button onClick={() => handleDelete(supplier)} className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-md transition-colors" title="حذف">
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="erp-status-bar">
          <span className="font-bold text-slate-700">إجمالي الموردين: <span className="text-blue-700 font-extrabold">{suppliers.length}</span> (المعروض: {filteredSuppliers.length})</span>
          <span className="font-bold text-slate-700">إجمالي مستحقات الموردين: <span className="text-rose-700 font-extrabold">{formatCurrency(totalSuppliersBalance)}</span></span>
        </div>
      </section>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-md shadow-2xl overflow-hidden animate-fadeIn">
            <div className="p-4 border-b border-slate-200 bg-slate-50">
              <h3 className="text-base font-black text-slate-800">
                {editingSupplier ? 'تعديل مورد' : 'إضافة مورد جديد'}
              </h3>
            </div>
            <form onSubmit={handleSubmit} className="p-4 space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">الاسم</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="input-ui text-xs h-9 w-full"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">رقم الهاتف</label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value.replace(/\D/g, '') })}
                  className="input-ui text-xs h-9 w-full"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">العنوان</label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="input-ui text-xs h-9 w-full"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">ملاحظات</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="input-ui text-xs w-full p-2"
                  rows={2}
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowModal(false); setEditingSupplier(null); }}
                  className="flex-1 px-4 py-2 border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors text-xs font-bold"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-xs font-bold shadow-2xs"
                >
                  {editingSupplier ? 'تحديث' : 'إضافة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
