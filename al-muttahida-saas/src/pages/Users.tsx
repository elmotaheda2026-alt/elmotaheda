import React, { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, Search, UserCheck, UserX, Shield } from 'lucide-react';
import { User, UserPermissions } from '../types';
import { getUsers, createUser, updateUser, deleteUser } from '../lib/storage';
import { useAuth } from '../context/AuthContext';
import { hasPermission } from '../lib/permissions';

export default function Users() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const defaultPermissions: UserPermissions = {
    'dashboard:view': true,
    'sales:read': false,
    'sales:write': false,
    'sales:reschedule': false,
    'payments:read': false,
    'payments:write': false,
    'payments:reverse': false,
    'reports:read': false,
    'closing:write': false,
    'users:manage': false,
    'inventory:manage': false,
    'purchases:manage': false,
    'settings:manage': false,
    'shareholders:manage': false,
    'notifications:read': false,
  };

  const [formData, setFormData] = useState({
    name: '',
    username: '',
    password: '',
    role: 'user' as User['role'],
    phone: '',
    isActive: true,
    permissions: defaultPermissions,
  });

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    const data = await getUsers();
    setUsers(data);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingUser) {
      await updateUser(editingUser.id, formData);
    } else {
      await createUser({ ...formData });
    }
    await loadUsers();
    setShowModal(false);
    setEditingUser(null);
    resetForm();
  };

  const handleEdit = (user: User) => {
    setEditingUser(user);
    setFormData({
      name: user.name,
      username: user.username,
      password: user.password,
      role: user.role,
      phone: user.phone || '',
      isActive: user.isActive,
      permissions: user.permissions || defaultPermissions,
    });
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    if (confirm('هل أنت متأكد من حذف هذا المستخدم؟')) {
      await deleteUser(id);
      await loadUsers();
    }
  };

  const toggleUserStatus = async (user: User) => {
    await updateUser(user.id, { isActive: !user.isActive });
    await loadUsers();
  };

  const resetForm = () => {
    setFormData({
      name: '',
      username: '',
      password: '',
      role: 'user',
      phone: '',
      isActive: true,
      permissions: defaultPermissions,
    });
  };

  const filteredUsers = users.filter(user =>
    user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.username.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">إدارة المستخدمين</h2>
          <p className="text-gray-500 text-sm mt-1">إجمالي {users.length} مستخدم</p>
        </div>
        <button
          onClick={() => { resetForm(); setShowModal(true); }}
          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
        >
          <Plus size={20} />
          <span>إضافة مستخدم</span>
        </button>
      </div>

      {/* Search */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <div className="relative">
          <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="بحث عن مستخدم..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pr-10 pl-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
          />
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-indigo-50">
              <tr>
                <th className="px-6 py-4 text-right text-sm font-bold text-gray-700">المستخدم</th>
                <th className="px-6 py-4 text-right text-sm font-bold text-gray-700">اسم المستخدم</th>
                <th className="px-6 py-4 text-right text-sm font-bold text-gray-700">الدور</th>
                <th className="px-6 py-4 text-right text-sm font-bold text-gray-700">الحالة</th>
                <th className="px-6 py-4 text-right text-sm font-bold text-gray-700">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredUsers.map(user => (
                <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center">
                        <span className="text-indigo-600 font-bold">{user.name.charAt(0)}</span>
                      </div>
                      <div>
                        <p className="font-medium text-gray-800">{user.name}</p>
                        <p className="text-xs text-gray-500">{user.phone || 'بدون هاتف'}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-gray-600">{user.username}</td>
                  <td className="px-6 py-4">
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                      user.role === 'admin' ? 'bg-purple-100 text-purple-700' :
                      user.role === 'manager' ? 'bg-blue-100 text-blue-700' :
                      user.role === 'accountant' ? 'bg-emerald-100 text-emerald-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {user.role === 'admin' ? 'مدير' : user.role === 'manager' ? 'مشرف' : user.role === 'accountant' ? 'محاسب' : 'مستخدم'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <button
                      onClick={() => toggleUserStatus(user)}
                      className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium ${
                        user.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {user.isActive ? <UserCheck size={14} /> : <UserX size={14} />}
                      {user.isActive ? 'نشط' : 'غير نشط'}
                    </button>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      {hasPermission(currentUser, 'users:manage') && (
                        <button
                          onClick={() => handleEdit(user)}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        >
                          <Edit size={18} />
                        </button>
                      )}
                      {hasPermission(currentUser, 'users:manage') && currentUser?.id !== user.id && (
                        <button
                          onClick={() => handleDelete(user.id)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <Trash2 size={18} />
                        </button>
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
                  onChange={(e) => setFormData({ ...formData, role: e.target.value as any })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                >
                  <option value="user">مستخدم</option>
                  <option value="accountant">محاسب</option>
                  <option value="manager">مشرف</option>
                  <option value="admin">مدير</option>
                </select>
              </div>

              {formData.role !== 'admin' && (
  <div className="border-t border-slate-100 pt-4 mt-4">
    <h4 className="font-bold text-slate-800 mb-3 text-sm flex items-center gap-2">
      <Shield size={16} className="text-indigo-600" />
      تخصيص صلاحيات المستخدم الدقيقة
    </h4>
    <div className="grid grid-cols-1 gap-2 bg-slate-50 p-3 rounded-xl border border-slate-100">
      {/* المبيعات والعملاء */}
      <label className="flex items-center gap-2 cursor-pointer p-2 rounded-lg hover:bg-white border border-transparent hover:border-slate-200 transition-colors">
        <input
          type="checkbox"
          checked={formData.permissions['sales:read'] && formData.permissions['sales:write'] && formData.permissions['sales:reschedule']}
          onChange={(e) => {
            const checked = e.target.checked;
            setFormData({
              ...formData,
              permissions: {
                ...formData.permissions,
                'sales:read': checked,
                'sales:write': checked,
                'sales:reschedule': checked,
                'inventory:manage': checked,
                'purchases:manage': checked,
              },
            });
          }}
          className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500 cursor-pointer"
        />
        <span className="text-sm font-medium text-slate-700">المبيعات والعملاء</span>
      </label>
      {/* الخزينة والتحصيل */}
      <label className="flex items-center gap-2 cursor-pointer p-2 rounded-lg hover:bg-white border border-transparent hover:border-slate-200 transition-colors">
        <input
          type="checkbox"
          checked={formData.permissions['payments:read'] && formData.permissions['payments:write'] && formData.permissions['payments:reverse']}
          onChange={(e) => {
            const checked = e.target.checked;
            setFormData({
              ...formData,
              permissions: {
                ...formData.permissions,
                'payments:read': checked,
                'payments:write': checked,
                'payments:reverse': checked,
                'closing:write': checked,
              },
            });
          }}
          className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500 cursor-pointer"
        />
        <span className="text-sm font-medium text-slate-700">الخزينة والتحصيل</span>
      </label>
      {/* التقارير والمالية */}
      <label className="flex items-center gap-2 cursor-pointer p-2 rounded-lg hover:bg-white border border-transparent hover:border-slate-200 transition-colors">
        <input
          type="checkbox"
          checked={formData.permissions['reports:read'] && formData.permissions['closing:write']}
          onChange={(e) => {
            const checked = e.target.checked;
            setFormData({
              ...formData,
              permissions: {
                ...formData.permissions,
                'reports:read': checked,
                'closing:write': checked,
              },
            });
          }}
          className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500 cursor-pointer"
        />
        <span className="text-sm font-medium text-slate-700">التقارير والمالية</span>
      </label>
      {/* الإدارة */}
      <label className="flex items-center gap-2 cursor-pointer p-2 rounded-lg hover:bg-white border border-transparent hover:border-slate-200 transition-colors">
        <input
          type="checkbox"
          checked={formData.permissions['users:manage']}
          onChange={(e) => {
            const checked = e.target.checked;
            const allPermissions = Object.keys(formData.permissions).reduce((acc, key) => {
              acc[key as keyof typeof formData.permissions] = checked;
              return acc;
            }, {} as typeof formData.permissions);
            setFormData({
              ...formData,
              permissions: allPermissions,
            });
          }}
          className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500 cursor-pointer"
        />
        <span className="text-sm font-medium text-slate-700">الإدارة</span>
      </label>
    </div>
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
                  className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-bold"
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
