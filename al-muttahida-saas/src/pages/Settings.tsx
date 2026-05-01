import React, { useState } from 'react';
import { Save, Building, Phone, Mail, MapPin, Percent, FileText, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Setting } from '../types';
import { clearAllData } from '../lib/storage';

export default function Settings() {
  const { settings, updateSettings } = useAuth();
  const [formData, setFormData] = useState<Setting>(settings);
  const [saved, setSaved] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateSettings(formData);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const handleClearData = () => {
    clearAllData();
    setShowDeleteConfirm(false);
    // Reload page
    window.location.reload();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
        <h2 className="text-2xl font-bold text-gray-800">إعدادات النظام</h2>
        <p className="text-gray-500 text-sm mt-1">تخصيص إعدادات الشركة والفوترة</p>
      </div>

      {/* Settings Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Company Info */}
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
            <Building size={20} className="text-indigo-600" />
            معلومات الشركة
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">اسم الشركة</label>
              <input
                type="text"
                value={formData.companyName}
                onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">عنوان الشركة</label>
              <input
                type="text"
                value={formData.companyAddress}
                onChange={(e) => setFormData({ ...formData, companyAddress: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">رقم الهاتف</label>
              <input
                type="tel"
                value={formData.companyPhone}
                onChange={(e) => setFormData({ ...formData, companyPhone: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">البريد الإلكتروني</label>
              <input
                type="email"
                value={formData.companyEmail}
                onChange={(e) => setFormData({ ...formData, companyEmail: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
              />
            </div>
          </div>
        </div>

        {/* Invoice Settings */}
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
            <FileText size={20} className="text-indigo-600" />
            إعدادات الفواتير
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">بادئة الفاتورة</label>
              <input
                type="text"
                value={formData.invoicePrefix}
                onChange={(e) => setFormData({ ...formData, invoicePrefix: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">نسبة الضريبة %</label>
              <input
                type="number"
                value={formData.taxRate}
                onChange={(e) => setFormData({ ...formData, taxRate: parseFloat(e.target.value) || 0 })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">العملة</label>
              <input
                type="text"
                value={formData.currency}
                onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
              />
            </div>
          </div>
          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">نص الفوتر</label>
            <textarea
              value={formData.invoiceFooter || ''}
              onChange={(e) => setFormData({ ...formData, invoiceFooter: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
              rows={3}
              placeholder="شكراً للتعامل معنا - شركة المتحدة"
            />
          </div>
        </div>

        {/* Save Button */}
        <div className="flex items-center gap-4">
          <button
            type="submit"
            className="flex items-center gap-2 bg-indigo-600 text-white px-6 py-3 rounded-lg hover:bg-indigo-700 transition-colors"
          >
            <Save size={20} />
            <span>حفظ الإعدادات</span>
          </button>
          {saved && (
            <span className="text-green-600 font-medium">✓ تم الحفظ بنجاح</span>
          )}
        </div>
      </form>

      {/* Danger Zone - Clear Data */}
      <div className="bg-red-50 border border-red-200 rounded-xl p-6">
        <h3 className="font-bold text-red-800 mb-2 flex items-center gap-2">
          <Trash2 size={20} className="text-red-600" />
          منطقة الخطر
        </h3>
        <p className="text-red-700 text-sm mb-4">حذف جميع البيانات الافتراضية والبدء من جديد. لا يمكن التراجع عن هذا الإجراء.</p>
        <button
          onClick={() => setShowDeleteConfirm(true)}
          className="flex items-center gap-2 bg-red-600 text-white px-6 py-2 rounded-lg hover:bg-red-700 transition-colors text-sm"
        >
          <Trash2 size={16} />
          <span>حذف جميع البيانات</span>
        </button>

        {/* Delete Confirmation Modal */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 rounded-lg">
            <div className="bg-white rounded-xl p-6 max-w-sm mx-4 shadow-xl">
              <h4 className="text-lg font-bold text-gray-800 mb-2">تأكيد حذف البيانات</h4>
              <p className="text-gray-600 mb-6">هل أنت متأكد من حذف جميع البيانات؟ سيتم حذف:</p>
              <ul className="text-sm text-gray-600 mb-6 list-disc list-inside space-y-1">
                <li>جميع العملاء</li>
                <li>جميع الموردين</li>
                <li>جميع المنتجات</li>
                <li>جميع المبيعات</li>
                <li>جميع المشتريات</li>
                <li>جميع الدفعات</li>
                <li>جميع المصروفات</li>
              </ul>
              <p className="text-red-600 font-medium text-sm mb-6">لا يمكن التراجع عن هذا الإجراء!</p>
              <div className="flex gap-3">
                <button
                  onClick={handleClearData}
                  className="flex-1 bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors font-medium"
                >
                  حذف نهائياً
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 bg-gray-200 text-gray-800 px-4 py-2 rounded-lg hover:bg-gray-300 transition-colors font-medium"
                >
                  إلغاء
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
