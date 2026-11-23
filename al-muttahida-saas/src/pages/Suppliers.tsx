import React, { useState, useEffect, useRef } from 'react';
import { Plus, Edit, Trash2, Search, Phone, MapPin, DollarSign, Truck, FileText } from 'lucide-react';
import { Supplier } from '../types';
import { getSuppliers, createSupplier, updateSupplier, deleteSupplier, syncSuppliers } from '../lib/storage';
import { useAuth } from '../context/AuthContext';
import { useDialog } from '../context/DialogContext';
import { hasPermission, isAdmin } from '../lib/permissions';
import { formatDateDisplay } from '../lib/dateUtils';
import { formatWholeCurrency } from '../lib/utils';
import SupplierStatementModal from '../components/SupplierStatementModal';
import { useRealtimeSync } from '../lib/realtimeSync';

export default function Suppliers() {
  const { confirmDialog, showToast } = useDialog();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [inspectingSupplier, setInspectingSupplier] = useState<Supplier | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    address: '',
    notes: '',
    balance: 0,
  });
  const { settings, user } = useAuth();
  const canDelete = isAdmin(user);
  const canWriteSupplier = hasPermission(user, 'sales:write') || hasPermission(user, 'purchases:manage');

  useEffect(() => {
    loadSuppliers();
  }, []);

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F2' && canWriteSupplier) {
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

  useRealtimeSync(['suppliers', 'payments', 'sales'], () => {
    void loadSuppliers();
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingSupplier) {
        const { balance: _ignoredBalance, ...editableFields } = formData;
        await updateSupplier(editingSupplier.id, editableFields);
        showToast('تم تحديث بيانات المورد بنجاح', 'success');
      } else {
        await createSupplier(formData);
        showToast('تم إضافة المورد بنجاح', 'success');
      }
      await loadSuppliers();
      setShowModal(false);
      setEditingSupplier(null);
      resetForm();
    } catch (err: any) {
      showToast(err?.message || 'تعذر حفظ بيانات المورد.', 'error');
    }
  };

  const handleEdit = (supplier: Supplier) => {
    setEditingSupplier(supplier);
    setFormData({
      name: supplier.name,
      phone: supplier.phone,
      address: supplier.address,
      notes: supplier.notes || '',
      balance: Number(supplier.balance || 0),
    });
    setShowModal(true);
  };

  const handleDelete = async (supplier: Supplier) => {
    if (Number(supplier.balance || 0) !== 0) {
      showToast('لا يمكن حذف المورد قبل تصفية رصيد حسابه.', 'warning');
      return;
    }

    const isConfirmed = await confirmDialog({
      title: 'تأكيد حذف المورد',
      message: `هل أنت متأكد من حذف المورد "${supplier.name}"؟`,
      subMessage: 'سيتم حذف المشتريات والمدفوعات المرتبطة به من النظام نهائياً.',
      confirmText: 'نعم، حذف المورد',
      cancelText: 'إلغاء',
      type: 'danger',
    });
    if (!isConfirmed) return;

    try {
      await deleteSupplier(supplier.id);
      await loadSuppliers();
      showToast('تم حذف المورد بنجاح', 'success');
    } catch (err: any) {
      showToast(err.message || 'حدث خطأ أثناء حذف المورد.', 'error');
    }
  };

  const resetForm = () => {
    setFormData({ name: '', phone: '', address: '', notes: '', balance: 0 });
  };

  const filteredSuppliers = suppliers.filter(supplier =>
    supplier.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    supplier.phone.includes(searchTerm)
  );

  const formatCurrency = (amount: number) => formatWholeCurrency(amount, settings.currency);
  const totalSuppliersPayable = suppliers.reduce(
    (sum, s) => sum + (Number(s.balance || 0) > 0 ? Number(s.balance || 0) : 0),
    0
  );
  const totalSuppliersCredit = suppliers.reduce(
    (sum, s) => sum + (Number(s.balance || 0) < 0 ? Math.abs(Number(s.balance || 0)) : 0),
    0
  );

  return (
    <div className="desktop-view-container">
      {/* Unified Compact Action Bar Header Strip */}
      <div className="erp-action-bar shrink-0">
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-0">
          <h2 className="text-lg font-black text-slate-900 shrink-0">الموردين</h2>
          <div className="relative flex-1 min-w-[240px] max-w-sm">
            <Search size={15} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              ref={searchInputRef}
              autoFocus
              placeholder="بحث باسم المورد أو رقم الهاتف..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="input-ui h-9 w-full pr-10 pl-3.5 text-xs font-semibold bg-white border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 placeholder:text-slate-400"
            />
          </div>
        </div>
        {canWriteSupplier && (
          <button
            onClick={() => { resetForm(); setShowModal(true); }}
            className="flex items-center gap-1.5 bg-[#1e40af] text-white h-9 px-4 rounded-xl hover:bg-[#1d4ed8] transition-colors text-xs font-bold shadow-xs shrink-0 cursor-pointer"
          >
            <Plus size={15} />
            <span>إضافة مورد</span>
          </button>
        )}
      </div>

      {/* Suppliers High-Density Table (Desktop) & Cards (Mobile) */}
      <section className="desktop-table-card">
        {/* Mobile Cards View (< md) */}
        <div className="md:hidden flex-1 overflow-y-auto p-2.5 space-y-2.5 custom-scrollbar">
          {filteredSuppliers.length === 0 ? (
            <div className="py-12 px-4 text-center text-slate-400 text-xs font-bold">لا يوجد موردين مطابِقين للبحث</div>
          ) : (
            filteredSuppliers.map((supplier) => (
              <div key={`mob-sup-${supplier.id}`} className="bg-white border border-slate-200 rounded-2xl p-3.5 shadow-2xs space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-black text-slate-900 text-sm break-words">{supplier.name}</p>
                    {supplier.address && (
                      <p className="text-xs text-slate-500 mt-0.5 break-words flex items-center gap-1">
                        <MapPin size={11} className="text-slate-400 shrink-0" />
                        <span>{supplier.address}</span>
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setInspectingSupplier(supplier)}
                    className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold shrink-0 ${supplier.balance > 0 ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}
                  >
                    {supplier.balance < 0
                      ? `${formatCurrency(Math.abs(supplier.balance))} (رصيد لنا)`
                      : formatCurrency(supplier.balance)}
                  </button>
                </div>

                <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
                  {supplier.phone ? (
                    <a href={`tel:${supplier.phone}`} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200/80 font-mono font-bold text-xs">
                      <Phone size={12} className="text-emerald-600 shrink-0" />
                      <span dir="ltr">{supplier.phone}</span>
                    </a>
                  ) : <span />}

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setInspectingSupplier(supplier)}
                      className="px-2.5 py-1 text-indigo-700 bg-indigo-50 rounded-lg text-xs font-bold inline-flex items-center gap-1"
                    >
                      <FileText size={13} />
                      كشف الحساب
                    </button>
                    {canWriteSupplier && (
                      <button onClick={() => handleEdit(supplier)} className="p-1.5 text-blue-600 bg-blue-50 rounded-lg" title="تعديل">
                        <Edit size={14} />
                      </button>
                    )}
                    {canDelete && (
                      <button onClick={() => handleDelete(supplier)} className="p-1.5 text-rose-600 bg-rose-50 rounded-lg" title="حذف">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="hidden md:block desktop-table-scroll">
          <table className="w-full min-w-[700px] border-collapse">
            <thead className="desktop-sticky-header">
              <tr>
                <th className="py-3 px-4 text-right text-xs font-bold text-slate-700 tracking-wider">اسم المورد</th>
                <th className="py-3 px-4 text-right text-xs font-bold text-slate-700 tracking-wider">رقم الهاتف</th>
                <th className="py-3 px-4 text-right text-xs font-bold text-slate-700 tracking-wider">العنوان</th>
                <th className="py-3 px-4 text-right text-xs font-bold text-slate-700 tracking-wider">رصيد المورد</th>
                <th className="py-3 px-4 text-center text-xs font-bold text-slate-700 tracking-wider">إجراءات</th>
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
                    onDoubleClick={() => canWriteSupplier && handleEdit(supplier)}
                    title={canWriteSupplier ? 'انقر مرتين للتعديل' : ''}
                    className="group cursor-pointer hover:bg-slate-50 transition-colors"
                  >
                    <td className="py-3 px-4 font-bold text-slate-900 text-xs sm:text-sm">{supplier.name}</td>
                    <td className="py-3 px-4 text-xs sm:text-sm text-slate-700 font-mono">{supplier.phone}</td>
                    <td className="py-3 px-4 text-xs sm:text-sm text-slate-600 truncate max-w-[240px]">{supplier.address || '—'}</td>
                    <td className="py-3 px-4 text-xs sm:text-sm font-bold">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setInspectingSupplier(supplier);
                        }}
                        className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer hover:opacity-85 transition-opacity ${supplier.balance > 0 ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}
                        title="انقر لعرض سجل المحاسبات وكشف الحساب"
                      >
                        {supplier.balance < 0
                          ? `${formatCurrency(Math.abs(supplier.balance))} (رصيد لنا)`
                          : formatCurrency(supplier.balance)}
                      </button>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <div className="erp-icon-actions">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setInspectingSupplier(supplier);
                          }}
                          className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                          title="سجل محاسبات وكشف حساب المورد"
                        >
                          <FileText size={15} />
                        </button>
                        {canWriteSupplier && (
                          <button onClick={() => handleEdit(supplier)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer" title="تعديل">
                            <Edit size={15} />
                          </button>
                        )}
                        {canDelete && (
                          <button onClick={() => handleDelete(supplier)} className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer" title="حذف">
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
        <div className="erp-status-bar shrink-0">
          <span className="font-bold text-slate-700">إجمالي الموردين: <span className="text-blue-700 font-extrabold">{suppliers.length}</span> (المعروض: {filteredSuppliers.length})</span>
          <div className="flex flex-wrap items-center gap-4">
            <span className="font-bold text-slate-700">إجمالي مستحقات الموردين: <span className="text-rose-700 font-extrabold">{formatCurrency(totalSuppliersPayable)}</span></span>
            {totalSuppliersCredit > 0 && (
              <span className="font-bold text-slate-700">رصيد لنا عند الموردين: <span className="text-emerald-700 font-extrabold">{formatCurrency(totalSuppliersCredit)}</span></span>
            )}
          </div>
        </div>
      </section>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
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
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  {editingSupplier ? 'الرصيد الحالي للمورد (للقراءة فقط)' : 'الرصيد الافتتاحي (المستحق للمورد حالياً إن وُجد)'}
                </label>
                <input
                  type="number"
                  min={editingSupplier ? undefined : 0}
                  step="any"
                  value={editingSupplier ? formData.balance : (formData.balance || '')}
                  disabled={Boolean(editingSupplier)}
                  onChange={(e) => setFormData({ ...formData, balance: Number(e.target.value) || 0 })}
                  className="input-ui text-xs h-9 w-full font-bold disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed"
                  placeholder="0.00"
                />
                <p className="text-[10px] text-slate-400 mt-0.5">
                  {editingSupplier
                    ? 'لتعديل رصيد المورد استخدم دفعة مورد أو فاتورة شراء لضمان تطابق السجلات.'
                    : 'المبلغ المستحق لهذا المورد من حسابات الفترة السابقة'}
                </p>
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
                  className="flex-1 px-4 py-2 bg-[#1e40af] text-white rounded-lg hover:bg-[#1d4ed8] transition-colors text-xs font-bold shadow-2xs"
                >
                  {editingSupplier ? 'تحديث' : 'إضافة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Supplier Statement Ledger Modal */}
      <SupplierStatementModal
        supplier={inspectingSupplier}
        isOpen={!!inspectingSupplier}
        onClose={() => setInspectingSupplier(null)}
        onBalanceUpdated={loadSuppliers}
      />
    </div>
  );
}
