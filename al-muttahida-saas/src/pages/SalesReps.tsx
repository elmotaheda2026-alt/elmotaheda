import React, { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, Search, UserCheck } from 'lucide-react';
import { SalesRep } from '../types';
import { getSalesReps, createSalesRep, updateSalesRep, deleteSalesRep } from '../lib/storage';

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
    setReps(getSalesReps());
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingRep) {
      updateSalesRep(editingRep.id, formData);
    } else {
      createSalesRep(formData);
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">مناديب المبيعات</h2>
          <p className="text-gray-500 text-sm mt-1">إجمالي {reps.length} مندوب</p>
        </div>
        <button
          onClick={() => { resetForm(); setShowModal(true); }}
          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
        >
          <Plus size={20} />
          <span>إضافة مندوب</span>
        </button>
      </div>

      {/* Search */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <div className="relative">
          <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="بحث عن مندوب..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pr-10 pl-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
          />
        </div>
      </div>

      {/* Reps Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredReps.map(rep => (
          <div key={rep.id} className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-full flex items-center justify-center">
                  <span className="text-white font-bold text-lg">{rep.name.charAt(0)}</span>
                </div>
                <div>
                  <h3 className="font-bold text-gray-800">{rep.name}</h3>
                  <p className="text-xs text-gray-500">{rep.area}</p>
                </div>
              </div>
              <span className={`px-3 py-1 rounded-full text-xs font-medium ${rep.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                {rep.isActive ? 'نشط' : 'غير نشط'}
              </span>
            </div>

            <div className="space-y-2 text-sm">
              <p className="text-gray-600">📱 {rep.phone}</p>
              <p className="text-gray-600">📍 {rep.area}</p>
              <div className="flex justify-between pt-2 border-t border-gray-100">
                <span className="text-gray-500">الهدف:</span>
                <span className="font-bold text-indigo-600">{rep.target.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">المحقق:</span>
                <span className="font-bold text-green-600">{rep.achieved.toLocaleString()}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                <div className="bg-green-500 h-2 rounded-full" style={{ width: `${Math.min((rep.achieved / rep.target) * 100, 100)}%` }} />
              </div>
            </div>

            <div className="flex gap-2 mt-4 pt-4 border-t border-gray-100">
              <button onClick={() => handleEdit(rep)} className="flex-1 flex items-center justify-center gap-1 px-3 py-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                <Edit size={16} />
                تعديل
              </button>
              <button onClick={() => handleDelete(rep.id)} className="flex-1 flex items-center justify-center gap-1 px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                <Trash2 size={16} />
                حذف
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
            <div className="p-6 border-b border-gray-100">
              <h3 className="text-xl font-bold text-gray-800">
                {editingRep ? 'تعديل مندوب' : 'إضافة مندوب جديد'}
              </h3>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">الاسم</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">رقم الهاتف</label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">المنطقة</label>
                <input
                  type="text"
                  value={formData.area}
                  onChange={(e) => setFormData({ ...formData, area: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">الهدف الشهري</label>
                  <input
                    type="number"
                    value={formData.target}
                    onChange={(e) => setFormData({ ...formData, target: parseFloat(e.target.value) || 0 })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">نسبة العمولة %</label>
                  <input
                    type="number"
                    value={formData.commission}
                    onChange={(e) => setFormData({ ...formData, commission: parseFloat(e.target.value) || 0 })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                  />
                </div>
              </div>
              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => { setShowModal(false); setEditingRep(null); }} className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">
                  إلغاء
                </button>
                <button type="submit" className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
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
