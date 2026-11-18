import React, { useEffect, useState } from 'react';
import { CheckCircle2, RotateCcw, Save, ShieldCheck, AlertCircle } from 'lucide-react';
import { Permission, User } from '../types';
import {
  DEFAULT_ROLE_PERMISSIONS,
  getRolePermissionsSnapshot,
  setDynamicRolePermissions,
} from '../lib/permissions';
import { useAuth } from '../context/AuthContext';
import { api, isApiMode } from '../lib/apiClient';

type EditableRole = Exclude<User['role'], 'admin'>;

const EDITABLE_ROLES: { key: EditableRole; label: string; desc: string }[] = [
  { key: 'manager', label: 'مدير', desc: 'إدارة ومتابعة' },
  { key: 'finance_manager', label: 'مدير مالي', desc: 'مالية وشركاء' },
  { key: 'accountant', label: 'محاسب', desc: 'خزينة وقيود' },
  { key: 'reviewer', label: 'مراجع', desc: 'تدقيق وجدولة' },
  { key: 'collector', label: 'محصّل', desc: 'تحصيل أقساط' },
  { key: 'user', label: 'مستخدم', desc: 'عرض أساسي' },
];

const PERMISSION_ITEMS: { key: Permission; label: string; category: string }[] = [
  { key: 'dashboard:view', label: 'عرض الرئيسية والإحصائيات', category: 'عام' },
  { key: 'notifications:read', label: 'عرض مركز التنبيهات', category: 'عام' },
  { key: 'sales:read', label: 'عرض المبيعات والعملاء', category: 'المبيعات' },
  { key: 'sales:write', label: 'إضافة وتعديل المبيعات والعملاء', category: 'المبيعات' },
  { key: 'sales:reschedule', label: 'ترحيل وإعادة جدولة الأقساط', category: 'المبيعات' },
  { key: 'payments:read', label: 'عرض الخزينة والمدفوعات', category: 'الخزينة' },
  { key: 'payments:write', label: 'تسجيل تحصيل وصرف نقدي', category: 'الخزينة' },
  { key: 'payments:reverse', label: 'عكس وإلغاء الحركات المالية', category: 'الخزينة' },
  { key: 'closing:write', label: 'إغلاق وفتح الفترات اليومية', category: 'الخزينة' },
  { key: 'inventory:manage', label: 'إدارة الأصناف والمخزون', category: 'المخزون' },
  { key: 'purchases:manage', label: 'إدارة المشتريات والموردين', category: 'المخزون' },
  { key: 'reports:read', label: 'عرض التقارير والقيود المالية', category: 'التقارير' },
  { key: 'shareholders:manage', label: 'إدارة حسابات الشركاء والمساهمين', category: 'الإدارة' },
  { key: 'users:manage', label: 'إدارة المستخدمين', category: 'الإدارة' },
  { key: 'settings:manage', label: 'تعديل إعدادات النظام', category: 'الإدارة' },
];

export default function RolePermissionsManager() {
  const { user, settings, updateSettings } = useAuth();
  const [matrix, setMatrix] = useState<Record<User['role'], Permission[]>>(() => getRolePermissionsSnapshot());
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (settings?.rolePermissions) {
      setDynamicRolePermissions(settings.rolePermissions);
      setMatrix(getRolePermissionsSnapshot());
    }
  }, [settings?.rolePermissions]);

  const isAdminUser = user?.role === 'admin';

  const togglePermission = (role: EditableRole, perm: Permission) => {
    if (!isAdminUser) return;
    setSaved(false);
    setError(null);
    setMatrix((prev) => {
      const current = prev[role] || [];
      const exists = current.includes(perm);
      return {
        ...prev,
        [role]: exists ? current.filter((p) => p !== perm) : [...current, perm],
      };
    });
  };

  const toggleAllForRole = (role: EditableRole, grantAll: boolean) => {
    if (!isAdminUser) return;
    setSaved(false);
    setError(null);
    setMatrix((prev) => ({
      ...prev,
      [role]: grantAll ? PERMISSION_ITEMS.map((item) => item.key) : [],
    }));
  };

  const handleResetDefaults = () => {
    if (!isAdminUser) return;
    setSaved(false);
    setError(null);
    const cloned = Object.fromEntries(
      Object.entries(DEFAULT_ROLE_PERMISSIONS).map(([role, perms]) => [role, [...perms]])
    ) as Record<User['role'], Permission[]>;
    setMatrix(cloned);
  };

  const handleSave = async () => {
    if (!isAdminUser) return;
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      if (isApiMode()) {
        const res = await api.updateRolePermissions(matrix as Record<string, string[]>);
        const updated = (res.rolePermissions || matrix) as Partial<Record<User['role'], Permission[]>>;
        setDynamicRolePermissions(updated);
        await updateSettings({
          ...settings,
          rolePermissions: updated,
        });
      } else {
        setDynamicRolePermissions(matrix);
        await updateSettings({
          ...settings,
          rolePermissions: matrix,
        });
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      setError(err?.message || 'حدث خطأ أثناء حفظ صلاحيات الأدوار');
    } finally {
      setSaving(false);
    }
  };

  if (!isAdminUser) {
    return (
      <div className="p-6">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3 text-amber-800 text-sm font-bold">
          <AlertCircle size={18} />
          <span>تعديل صلاحيات الأدوار متاح لمدير النظام (Admin) فقط.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
            <ShieldCheck size={20} className="text-blue-600" />
            <span>مصفوفة صلاحيات أنواع الحسابات (الأدوار)</span>
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            تحكم في الصلاحيات الافتراضية لكل نوع حساب على مستوى النظام (الباك إند والواجهة معاً).
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleResetDefaults}
            disabled={saving}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
          >
            <RotateCcw size={14} />
            <span>استعادة الافتراضي</span>
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer disabled:opacity-50"
          >
            <Save size={14} />
            <span>{saving ? 'جاري الحفظ...' : 'حفظ صلاحيات الأدوار'}</span>
          </button>
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-xs text-blue-800 font-semibold flex items-center gap-2">
        <ShieldCheck size={16} className="text-blue-600 shrink-0" />
        <span>
          حساب <strong>مدير النظام (admin)</strong> يمتلك جميع الصلاحيات دائماً ولا يمكن تقييده لضمان عدم إغلاق النظام.
        </span>
      </div>

      {saved && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-xs text-emerald-800 font-bold flex items-center gap-2">
          <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
          <span>تم حفظ صلاحيات الأدوار وتطبيقها على الخادم وجميع الأجهزة بنجاح.</span>
        </div>
      )}

      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-xs text-rose-800 font-bold flex items-center gap-2">
          <AlertCircle size={16} className="text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="overflow-x-auto border border-slate-200 rounded-xl">
        <table className="w-full text-right border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="py-3 px-4 text-xs font-black text-slate-700 min-w-[230px]">
                الصلاحية
              </th>
              {EDITABLE_ROLES.map((role) => {
                const count = (matrix[role.key] || []).length;
                const allSelected = count === PERMISSION_ITEMS.length;
                return (
                  <th key={role.key} className="py-3 px-3 text-center min-w-[115px] border-r border-slate-200">
                    <div className="text-xs font-black text-slate-900">{role.label}</div>
                    <div className="text-[10px] font-medium text-slate-500 mt-0.5">{role.desc}</div>
                    <button
                      type="button"
                      onClick={() => toggleAllForRole(role.key, !allSelected)}
                      className="mt-1.5 text-[10px] font-bold text-blue-600 hover:underline cursor-pointer"
                    >
                      {allSelected ? 'إلغاء الكل' : 'تحديد الكل'} ({count}/{PERMISSION_ITEMS.length})
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {PERMISSION_ITEMS.map((perm) => (
              <tr key={perm.key} className="hover:bg-slate-50/70 transition-colors">
                <td className="py-2.5 px-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-800">{perm.label}</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 shrink-0">
                      {perm.category}
                    </span>
                  </div>
                </td>
                {EDITABLE_ROLES.map((role) => {
                  const checked = (matrix[role.key] || []).includes(perm.key);
                  return (
                    <td key={`${role.key}-${perm.key}`} className="py-2.5 px-3 text-center border-r border-slate-100">
                      <label className="inline-flex items-center justify-center cursor-pointer p-1">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => togglePermission(role.key, perm.key)}
                          className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                        />
                      </label>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
