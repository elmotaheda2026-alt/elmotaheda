import React, { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, Search, Phone, MapPin, DollarSign, Truck } from 'lucide-react';
import { Supplier } from '../types';
import { getSuppliers, createSupplier, updateSupplier, deleteSupplier, syncSuppliers } from '../lib/storage';
import { useAuth } from '../context/AuthContext';
import { hasPermission } from '../lib/permissions';
import { formatDateDisplay } from '../lib/dateUtils';
import { formatWholeCurrency } from '../lib/utils';

export default function Suppliers() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    address: '',
    notes: '',
  });
  const { settings, user } = useAuth();

  useEffect(() => {
    loadSuppliers();
  }, []);

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

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center border-b border-slate-100 pb-2.5">
        <h2 className="text-xl font-black text-slate-900">الموردين</h2>
        <button
          onClick={() => { resetForm(); setShowModal(true); }}
          className="flex items-center gap-1.5 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors text-sm font-bold shadow-sm"
        >
          <Plus size={16} />
          <span>إضافة مورد</span>
        </button>
      </div>

      {/* Toolbar / Search */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="relative max-w-sm">
          <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="بحث عن مورد..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="input-ui pr-10 pl-4 py-2 text-sm w-full"
          />
        </div>
      </div>

      {/* Suppliers Table */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px]">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-5 py-3 text-right text-sm font-black text-slate-700">الاسم</th>
                <th className="px-5 py-3 text-right text-sm font-black text-slate-700">رقم الهاتف</th>
                <th className="px-5 py-3 text-right text-sm font-black text-slate-700">العنوان</th>
                <th className="px-5 py-3 text-right text-sm font-black text-slate-700">الرصيد</th>
                <th className="px-5 py-3 text-center text-sm font-black text-slate-700">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredSuppliers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-slate-500">لا يوجد موردين مطابِقين</td>
                </tr>
              ) : (
                filteredSuppliers.map(supplier => (
                  <tr key={supplier.id} className="hover:bg-slate-50/50 transition-colors">
                     <td className="px-5 py-3">
                       <span className="font-bold text-slate-900 text-sm">{supplier.name}</span>
                     </td>
                     <td className="px-5 py-3 text-sm text-slate-700 font-mono">{supplier.phone}</td>
                     <td className="px-5 py-3 text-sm text-slate-600">{supplier.address || '—'}</td>
                     <td className="px-5 py-3 text-sm font-black">
                       <span className={supplier.balance > 0 ? 'text-red-600' : 'text-green-600'}>
                         {formatCurrency(supplier.balance)}
                       </span>
                     </td>
                     <td className="px-5 py-3 text-center">
                       <div className="flex items-center justify-center gap-1">
                         {hasPermission(user, 'sales:write') && (
                           <button onClick={() => handleEdit(supplier)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="تعديل">
                             <Edit size={15} />
                           </button>
                         )}
                         {(hasPermission(user, 'users:manage') || hasPermission(user, 'purchases:manage')) && (
                           <button onClick={() => handleDelete(supplier)} className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="حذف">
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
      </section>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="p-5 border-b border-gray-100 bg-slate-50">
              <h3 className="text-base font-black text-slate-800">
                {editingSupplier ? 'تعديل مورد' : 'إضافة مورد جديد'}
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
                <label className="block text-xs font-bold text-slate-500 mb-1">العنوان</label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="input-ui text-sm h-10 w-full"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">ملاحظات</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="input-ui text-sm w-full p-2.5"
                  rows={3}
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowModal(false); setEditingSupplier(null); }}
                  className="flex-1 px-4 py-2 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm font-bold"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-bold"
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
