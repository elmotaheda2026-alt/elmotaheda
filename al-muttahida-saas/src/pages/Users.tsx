import React, { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, Search, UserCheck, UserX, Shield } from 'lucide-react';
import { Permission, User, UserPermissions } from '../types';
import { getUsers, createUser, updateUser, toggleUserStatus as toggleUserStatusApi, deleteUser, syncUsers } from '../lib/storage';
import { useAuth } from '../context/AuthContext';
import { useDialog } from '../context/DialogContext';
import { getRolePermissionsSnapshot, hasPermission, isAdmin, PERMISSION_CATALOG } from '../lib/permissions';
import { useRealtimeSync } from '../lib/realtimeSync';

const ROLE_META: Record<User['role'], { label: string; badgeClass: string }> = {
  admin: { label: 'مدير نظام', badgeClass: 'bg-purple-50 text-purple-700 border border-purple-200' },
  manager: { label: 'مشرف عام', badgeClass: 'bg-blue-50 text-blue-700 border border-blue-200' },
  finance_manager: { label: 'مدير مالي', badgeClass: 'bg-indigo-50 text-indigo-700 border border-indigo-200' },
  accountant: { label: 'محاسب', badgeClass: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
  reviewer: { label: 'مراجع', badgeClass: 'bg-amber-50 text-amber-700 border border-amber-200' },
  collector: { label: 'محصل', badgeClass: 'bg-sky-50 text-sky-700 border border-sky-200' },
  user: { label: 'مستخدم', badgeClass: 'bg-slate-100 text-slate-700' },
};

function buildRoleDefaultPermissions(role: User['role']): Record<Permission, boolean> {
  const rolePerms = new Set(getRolePermissionsSnapshot()[role] || []);
  return PERMISSION_CATALOG.reduce((acc, item) => {
    acc[item.key] = rolePerms.has(item.key);
    return acc;
  }, {} as Record<Permission, boolean>);
}

export default function Users() {
  const { user: currentUser } = useAuth();
  const { confirmDialog, showToast } = useDialog();
  const canManageUsers = hasPermission(currentUser, 'users:manage');
  const canDelete = isAdmin(currentUser);
  const [users, setUsers] = useState<User[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [useCustomPermissions, setUseCustomPermissions] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    username: '',
    password: '',
    role: 'user' as User['role'],
    phone: '',
    isActive: true,
    permissions: buildRoleDefaultPermissions('user') as UserPermissions,
  });

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      await syncUsers();
    } catch (err) {
      console.error('Failed to sync users:', err);
    }
    const data = await getUsers();
    setUsers(data);
  };

  useRealtimeSync(['users'], () => {
    void loadUsers();
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    try {
      const payload = {
        ...formData,
        permissions:
          formData.role === 'admin' || !useCustomPermissions
            ? null
            : formData.permissions,
      };
      if (editingUser) {
        await updateUser(editingUser.id, payload);
      } else {
        await createUser({ ...payload });
      }
      await loadUsers();
      setShowModal(false);
      setEditingUser(null);
      resetForm();
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || 'حدث خطأ أثناء حفظ المستخدم. تأكد من إدخال البيانات بشكل صحيح.');
    }
  };

  const handleEdit = (user: User) => {
    const hasCustom = Boolean(
      user.role !== 'admin' &&
      user.permissions &&
      typeof user.permissions === 'object' &&
      Object.keys(user.permissions).length > 0
    );
    const roleDefaults = buildRoleDefaultPermissions(user.role);
    setEditingUser(user);
    setUseCustomPermissions(hasCustom);
    setFormData({
      name: user.name,
      username: user.username,
      password: '',
      role: user.role,
      phone: user.phone || '',
      isActive: user.isActive,
      permissions: hasCustom ? { ...roleDefaults, ...(user.permissions || {}) } : roleDefaults,
    });
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    const isConfirmed = await confirmDialog({
      title: 'تأكيد حذف المستخدم',
      message: 'هل أنت متأكد من حذف هذا المستخدم؟',
      subMessage: 'لن يتمكن هذا المستخدم من الدخول للنظام مرة أخرى.',
      confirmText: 'نعم، حذف المستخدم',
      cancelText: 'إلغاء',
      type: 'danger',
    });
    if (isConfirmed) {
      try {
        await deleteUser(id);
        await loadUsers();
        showToast('تم حذف المستخدم بنجاح', 'success');
      } catch (err: any) {
        showToast(err?.message || 'تعذر حذف المستخدم.', 'error');
      }
    }
  };

  const toggleUserStatus = async (user: User) => {
    try {
      const nextActive = !user.isActive;
      await toggleUserStatusApi(user.id, nextActive);
      await loadUsers();
      showToast(nextActive ? 'تم تفعيل حساب المستخدم بنجاح' : 'تم تعطيل حساب المستخدم بنجاح', 'success');
    } catch (err: any) {
      showToast(err?.message || 'تعذر تحديث حالة المستخدم.', 'error');
    }
  };

  const resetForm = () => {
    setErrorMsg('');
    setUseCustomPermissions(false);
    setFormData({
      name: '',
      username: '',
      password: '',
      role: 'user',
      phone: '',
      isActive: true,
      permissions: buildRoleDefaultPermissions('user'),
    });
  };

  const filteredUsers = users.filter(user =>
    user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.username.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center border-b border-slate-100 pb-2.5">
        <h2 className="text-xl font-black text-slate-900">المستخدمين</h2>
        {canManageUsers && (
          <button
            onClick={() => { resetForm(); setShowModal(true); }}
            className="flex items-center gap-1.5 bg-[#1e40af] text-white px-4 py-2 rounded-lg hover:bg-[#1d4ed8] transition-colors text-sm font-bold shadow-2xs cursor-pointer"
          >
            <Plus size={16} />
            <span>إضافة مستخدم</span>
          </button>
        )}
      </div>

      {/* Toolbar / Search */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="relative max-w-sm">
          <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="بحث عن مستخدم..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="input-ui pr-10 pl-4 py-2 text-sm w-full"
          />
        </div>
      </div>

      {/* Users Table (Desktop) & Cards (Mobile) */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {/* Mobile Cards View (< md) */}
        <div className="md:hidden p-2.5 space-y-2.5">
          {filteredUsers.map((user) => (
            <div key={`mob-usr-${user.id}`} className="bg-white border border-slate-200 rounded-2xl p-3.5 shadow-2xs space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 bg-indigo-50 rounded-full flex items-center justify-center shrink-0">
                    <span className="text-indigo-600 font-black text-sm">{user.name.charAt(0)}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-slate-900 text-sm truncate">{user.name}</p>
                    <p className="text-xs text-slate-500 font-mono">@{user.username} • {user.phone || 'بدون هاتف'}</p>
                  </div>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs font-bold shrink-0 ${(ROLE_META[user.role] || ROLE_META.user).badgeClass}`}>
                  {(ROLE_META[user.role] || ROLE_META.user).label}
                </span>
              </div>

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
                {canManageUsers && (isAdmin(currentUser) || user.role !== 'admin') ? (
                  <button
                    onClick={() => toggleUserStatus(user)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold cursor-pointer ${user.isActive ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}
                  >
                    {user.isActive ? <UserCheck size={13} /> : <UserX size={13} />}
                    {user.isActive ? 'نشط' : 'غير نشط'}
                  </button>
                ) : (
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${user.isActive ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                    {user.isActive ? <UserCheck size={13} /> : <UserX size={13} />}
                    {user.isActive ? 'نشط' : 'غير نشط'}
                  </span>
                )}

                <div className="flex items-center gap-1.5">
                  {canManageUsers && (isAdmin(currentUser) || user.role !== 'admin') && (
                    <button onClick={() => handleEdit(user)} className="p-1.5 text-blue-600 bg-blue-50 rounded-lg" title="تعديل">
                      <Edit size={14} />
                    </button>
                  )}
                  {canDelete && currentUser?.id !== user.id && (
                    <button onClick={() => handleDelete(user.id)} className="p-1.5 text-red-600 bg-red-50 rounded-lg" title="حذف">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="hidden md:block overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-5 py-3 text-right text-sm font-black text-slate-700">المستخدم</th>
                <th className="px-5 py-3 text-right text-sm font-black text-slate-700">اسم المستخدم</th>
                <th className="px-5 py-3 text-right text-sm font-black text-slate-700">الدور</th>
                <th className="px-5 py-3 text-right text-sm font-black text-slate-700">الحالة</th>
                <th className="px-5 py-3 text-center text-sm font-black text-slate-700">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredUsers.map(user => (
                <tr key={user.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-indigo-50 rounded-full flex items-center justify-center">
                        <span className="text-indigo-600 font-black text-sm">{user.name.charAt(0)}</span>
                      </div>
                      <div>
                        <p className="font-bold text-slate-900 text-sm">{user.name}</p>
                        <p className="text-xs text-slate-500">{user.phone || 'بدون هاتف'}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-sm text-slate-700 font-mono">{user.username}</td>
                  <td className="px-5 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${(ROLE_META[user.role] || ROLE_META.user).badgeClass}`}>
                      {(ROLE_META[user.role] || ROLE_META.user).label}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    {canManageUsers && (isAdmin(currentUser) || user.role !== 'admin') ? (
                      <button
                        onClick={() => toggleUserStatus(user)}
                        className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-bold cursor-pointer ${user.isActive ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
                          }`}
                      >
                        {user.isActive ? <UserCheck size={13} /> : <UserX size={13} />}
                        {user.isActive ? 'نشط' : 'غير نشط'}
                      </button>
                    ) : (
                      <span
                        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-bold ${user.isActive ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
                          }`}
                      >
                        {user.isActive ? <UserCheck size={13} /> : <UserX size={13} />}
                        {user.isActive ? 'نشط' : 'غير نشط'}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      {canManageUsers && (isAdmin(currentUser) || user.role !== 'admin') && (
                        <button
                          onClick={() => handleEdit(user)}
                          className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                          title="تعديل"
                        >
                          <Edit size={15} />
                        </button>
                      )}
                      {canDelete && currentUser?.id !== user.id && (
                        <button
                          onClick={() => handleDelete(user.id)}
                          className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                          title="حذف"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                      {!canManageUsers && !canDelete && (
                        <span className="text-xs text-slate-400 font-bold">—</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 sm:p-6">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-gray-100 shrink-0">
              <h3 className="text-xl font-bold text-gray-800">
                {editingUser ? 'تعديل مستخدم' : 'إضافة مستخدم جديد'}
              </h3>
            </div>
            <form onSubmit={handleSubmit} className="flex flex-col overflow-hidden">
              <div className="p-6 space-y-4 overflow-y-auto">
                {errorMsg && (
                  <div className="p-3 bg-red-50 border border-red-200 text-red-600 rounded-lg text-sm text-center">
                    {errorMsg}
                  </div>
                )}
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">اسم المستخدم</label>
                  <input
                    type="text"
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">كلمة المرور</label>
                  <input
                    type="password"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                    required={!editingUser}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">رقم الهاتف</label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value.replace(/\D/g, '') })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">الدور</label>
                  <select
                    value={formData.role}
                    onChange={(e) => {
                      const nextRole = e.target.value as User['role'];
                      setFormData((prev) => ({
                        ...prev,
                        role: nextRole,
                        permissions: useCustomPermissions ? prev.permissions : buildRoleDefaultPermissions(nextRole),
                      }));
                    }}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                  >
                    {(Object.entries(ROLE_META) as [User['role'], { label: string }][])
                      .filter(([roleKey]) => isAdmin(currentUser) || roleKey !== 'admin')
                      .map(([roleKey, meta]) => (
                        <option key={roleKey} value={roleKey}>{meta.label}</option>
                      ))}
                  </select>
                </div>

                {formData.role !== 'admin' && (
                  <div className="border-t border-slate-100 pt-4 mt-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                        <Shield size={16} className="text-indigo-600" />
                        <span>صلاحيات الحساب</span>
                      </h4>
                      <label className="inline-flex items-center gap-2 text-xs font-bold text-indigo-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={useCustomPermissions}
                          onChange={(e) => {
                            const enabled = e.target.checked;
                            setUseCustomPermissions(enabled);
                            if (enabled) {
                              setFormData((prev) => ({
                                ...prev,
                                permissions: buildRoleDefaultPermissions(prev.role),
                              }));
                            }
                          }}
                          className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500 cursor-pointer"
                        />
                        <span>تخصيص استثناء خاص</span>
                      </label>
                    </div>

                    {!useCustomPermissions ? (
                      <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-3 space-y-2">
                        <p className="text-xs font-bold text-emerald-900">
                          صلاحيات الدور من الإعدادات ({ROLE_META[formData.role]?.label}): يتبع هذا الحساب تلقائياً أي تعديل يُحفظ في مصفوفة الصلاحيات.
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {PERMISSION_CATALOG.filter((item) =>
                            (getRolePermissionsSnapshot()[formData.role] || []).includes(item.key)
                          ).map((item) => (
                            <span
                              key={item.key}
                              className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-white text-emerald-800 border border-emerald-200"
                            >
                              {item.label}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-1.5 bg-slate-50 p-3 rounded-xl border border-slate-200 max-h-60 overflow-y-auto">
                        {PERMISSION_CATALOG.map((item) => (
                          <label
                            key={item.key}
                            className="flex items-center justify-between gap-2 cursor-pointer p-2 rounded-lg hover:bg-white border border-transparent hover:border-slate-200 transition-colors"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <input
                                type="checkbox"
                                checked={Boolean(formData.permissions[item.key])}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  setFormData((prev) => ({
                                    ...prev,
                                    permissions: {
                                      ...prev.permissions,
                                      [item.key]: checked,
                                    },
                                  }));
                                }}
                                className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500 cursor-pointer shrink-0"
                              />
                              <span className="text-xs font-bold text-slate-700 truncate">{item.label}</span>
                            </div>
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200/70 text-slate-600 shrink-0">
                              {item.category}
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )}

              </div>

              <div className="p-6 border-t border-slate-100 shrink-0 flex gap-3 bg-slate-50/50 rounded-b-2xl">
                <button
                  type="button"
                  onClick={() => { setShowModal(false); setEditingUser(null); }}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 bg-white rounded-lg hover:bg-gray-50 transition-colors font-bold"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-[#1e40af] text-white rounded-lg hover:bg-[#1d4ed8] transition-colors font-bold shadow-2xs cursor-pointer"
                >
                  {editingUser ? 'تحديث' : 'إضافة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
