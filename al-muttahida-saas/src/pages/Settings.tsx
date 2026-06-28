import React, { useRef, useState } from 'react';
import { Save, Building, FileText, Trash2, MessageCircle, Download, Upload } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Setting } from '../types';
import { clearAllData, downloadDatabaseBackup, restoreDatabaseBackup } from '../lib/storage';

export default function Settings() {
  const { settings, updateSettings } = useAuth();
  const [formData, setFormData] = useState<Setting>(settings);
  const [saved, setSaved] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const backupInputRef = useRef<HTMLInputElement | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const updated = { ...formData, taxRate: 0 };
    updateSettings(updated);
    setFormData(updated);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };


  const handleExportBackup = async () => {
    try {
      setBackupBusy(true);
      await downloadDatabaseBackup();
    } catch (err: any) {
      alert(err.message || '\u062a\u0639\u0630\u0631 \u062a\u0635\u062f\u064a\u0631 \u0627\u0644\u0628\u0627\u0643 \u0623\u0628.');
    } finally {
      setBackupBusy(false);
    }
  };

  const handleImportBackup = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!confirm('\u0627\u0633\u062a\u064a\u0631\u0627\u062f \u0627\u0644\u0628\u0627\u0643 \u0623\u0628 \u0633\u064a\u0633\u062a\u0628\u062f\u0644 \u0628\u064a\u0627\u0646\u0627\u062a \u0627\u0644\u0646\u0638\u0627\u0645 \u0627\u0644\u062d\u0627\u0644\u064a\u0629. \u0647\u0644 \u062a\u0631\u064a\u062f \u0627\u0644\u0645\u062a\u0627\u0628\u0639\u0629\u061f')) return;

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await restoreDatabaseBackup(String(reader.result || '')); 
        alert('\u062a\u0645 \u0627\u0633\u062a\u064a\u0631\u0627\u062f \u0627\u0644\u0628\u0627\u0643 \u0623\u0628 \u0628\u0646\u062c\u0627\u062d. \u0633\u064a\u062a\u0645 \u0625\u0639\u0627\u062f\u0629 \u062a\u062d\u0645\u064a\u0644 \u0627\u0644\u0646\u0638\u0627\u0645 \u0627\u0644\u0622\u0646.');
        window.location.reload();
      } catch (err: any) {
        alert(err.message || '\u062a\u0639\u0630\u0631 \u0627\u0633\u062a\u064a\u0631\u0627\u062f \u0645\u0644\u0641 \u0627\u0644\u0628\u0627\u0643 \u0623\u0628.');
      }
    };
    reader.readAsText(file);
  };
  const handleClearData = async () => {
    try {
      await clearAllData();
      setShowDeleteConfirm(false);
      // Reload page
      window.location.reload();
    } catch (err: any) {
      alert(err.message || 'حدث خطأ أثناء حذف البيانات من قاعدة البيانات.');
    }
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
            <MessageCircle size={20} className="text-green-600" />
            &#x62A;&#x630;&#x643;&#x64A;&#x631;&#x627;&#x62A; &#x648;&#x627;&#x62A;&#x633;&#x627;&#x628; &#x644;&#x644;&#x623;&#x642;&#x633;&#x627;&#x637;
          </h3>
          <div className="space-y-4">
            <label className="flex items-center gap-3 text-sm font-medium text-gray-700">
              <input
                type="checkbox"
                checked={!!formData.whatsappRemindersEnabled}
                onChange={(e) => setFormData({ ...formData, whatsappRemindersEnabled: e.target.checked })}
                className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
              />
              &#x62A;&#x634;&#x63A;&#x64A;&#x644; &#x627;&#x644;&#x625;&#x631;&#x633;&#x627;&#x644; &#x627;&#x644;&#x62A;&#x644;&#x642;&#x627;&#x626;&#x64A; &#x64A;&#x648;&#x645; &#x627;&#x644;&#x62A;&#x62D;&#x635;&#x64A;&#x644;
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">WhatsApp Phone Number ID</label>
                <input
                  type="text"
                  value={formData.whatsappPhoneNumberId || ''}
                  onChange={(e) => setFormData({ ...formData, whatsappPhoneNumberId: e.target.value.trim() })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                  placeholder="&#x645;&#x62B;&#x627;&#x644;: 123456789012345"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Access Token</label>
                <input
                  type="password"
                  value={formData.whatsappAccessToken || ''}
                  onChange={(e) => setFormData({ ...formData, whatsappAccessToken: e.target.value.trim() })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                  placeholder="Meta permanent token"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Template Name</label>
                <input
                  type="text"
                  value={formData.whatsappTemplateName || 'installment_reminder'}
                  onChange={(e) => setFormData({ ...formData, whatsappTemplateName: e.target.value.trim() })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Template Language</label>
                <input
                  type="text"
                  value={formData.whatsappTemplateLanguage || 'ar'}
                  onChange={(e) => setFormData({ ...formData, whatsappTemplateLanguage: e.target.value.trim() })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                  placeholder="ar"
                />
              </div>
            </div>
            <p className="text-xs text-gray-500 leading-6">
              &#x644;&#x627;&#x632;&#x645; &#x62A;&#x639;&#x645;&#x644; template &#x645;&#x639;&#x62A;&#x645;&#x62F; &#x641;&#x64A; Meta &#x628;&#x646;&#x641;&#x633; &#x627;&#x644;&#x627;&#x633;&#x645; &#x648;&#x64A;&#x62D;&#x62A;&#x648;&#x64A; 4 &#x645;&#x62A;&#x63A;&#x64A;&#x631;&#x627;&#x62A; &#x628;&#x627;&#x644;&#x62A;&#x631;&#x62A;&#x64A;&#x628;: &#x627;&#x633;&#x645; &#x627;&#x644;&#x639;&#x645;&#x64A;&#x644;&#x60C; &#x645;&#x628;&#x644;&#x63A; &#x627;&#x644;&#x642;&#x633;&#x637;&#x60C; &#x62A;&#x627;&#x631;&#x64A;&#x62E; &#x627;&#x644;&#x627;&#x633;&#x62A;&#x62D;&#x642;&#x627;&#x642;&#x60C; &#x631;&#x642;&#x645; &#x627;&#x644;&#x641;&#x627;&#x62A;&#x648;&#x631;&#x629;.
            </p>
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

      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
        <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
          <Download size={20} className="text-sky-600" />
          &#x646;&#x633;&#x62E;&#x629; &#x627;&#x62D;&#x62A;&#x64A;&#x627;&#x637;&#x64A;&#x629; &#x645;&#x646; &#x627;&#x644;&#x628;&#x64A;&#x627;&#x646;&#x627;&#x62A;
        </h3>
        <p className="text-sm text-gray-500 mb-4">
          &#x64A;&#x645;&#x643;&#x646;&#x643; &#x62A;&#x635;&#x62F;&#x64A;&#x631; &#x645;&#x644;&#x641; JSON &#x628;&#x643;&#x644; &#x628;&#x64A;&#x627;&#x646;&#x627;&#x62A; &#x627;&#x644;&#x646;&#x638;&#x627;&#x645;&#x60C; &#x623;&#x648; &#x627;&#x633;&#x62A;&#x64A;&#x631;&#x627;&#x62F; &#x646;&#x633;&#x62E;&#x629; &#x633;&#x627;&#x628;&#x642;&#x629; &#x644;&#x627;&#x633;&#x62A;&#x631;&#x62C;&#x627;&#x639;&#x647;&#x627;.
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleExportBackup}
            disabled={backupBusy}
            className="flex items-center gap-2 bg-sky-600 text-white px-5 py-2 rounded-lg hover:bg-sky-700 transition-colors text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Download size={16} />
            <span>{backupBusy ? 'Preparing...' : '����� Backup'}</span>
          </button>
          <button
            type="button"
            onClick={() => backupInputRef.current?.click()}
            className="flex items-center gap-2 bg-slate-700 text-white px-5 py-2 rounded-lg hover:bg-slate-800 transition-colors text-sm font-medium"
          >
            <Upload size={16} />
            <span>&#x627;&#x633;&#x62A;&#x64A;&#x631;&#x627;&#x62F; Backup</span>
          </button>
          <input
            ref={backupInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleImportBackup}
            className="hidden"
          />
        </div>
      </div>
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
