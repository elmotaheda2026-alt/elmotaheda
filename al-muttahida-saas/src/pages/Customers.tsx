import React, { useState, useEffect, useRef } from 'react';
import {
  Plus, Edit, Trash2, Search, Save, X, Camera, Upload, User,
  MapPin, Phone, Calendar, FileText, AlertTriangle, Gavel,
  Building, Users, DollarSign, UserCircle, CreditCard
} from 'lucide-react';
import { Customer, Guarantor } from '../types';
import { getCustomers, createCustomer, updateCustomer, deleteCustomer, syncCustomers } from '../lib/storage';
import { useAuth } from '../context/AuthContext';
import { DatePicker } from '../components/DatePicker';
import { formatWholeCurrency } from '../lib/utils';

const initialGuarantor: Guarantor = {
  name: '',
  address: '',
  nationalId: '',
  phone: '',
  relationship: ''
};

const calculateAgeFromDate = (dateOfBirth: string): number => {
  const [year, month, day] = dateOfBirth.split('-').map(Number);
  const birthDate = new Date(year, month - 1, day);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const hasHadBirthday =
    today.getMonth() > birthDate.getMonth() ||
    (today.getMonth() === birthDate.getMonth() && today.getDate() >= birthDate.getDate());

  return hasHadBirthday ? age : age - 1;
};

const getBirthDateFromEgyptianNationalId = (nationalId: string): string => {
  const digits = nationalId.replace(/\D/g, '');
  if (digits.length !== 14) return '';

  const centuryCode = digits[0];
  const century = centuryCode === '2' ? 1900 : centuryCode === '3' ? 2000 : null;
  if (!century) return '';

  const year = century + Number(digits.slice(1, 3));
  const month = Number(digits.slice(3, 5));
  const day = Number(digits.slice(5, 7));
  const birthDate = new Date(year, month - 1, day);

  if (
    birthDate.getFullYear() !== year ||
    birthDate.getMonth() !== month - 1 ||
    birthDate.getDate() !== day ||
    birthDate > new Date()
  ) {
    return '';
  }

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

export default function Customers() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [searchModal, setSearchModal] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const emptyForm = {
    name: '',
    phone: '',
    email: '',
    address: '',
    gender: 'male' as 'male' | 'female',
    city: '',
    governorate: '',
    region: '',
    dateOfBirth: '',
    nationalId: '',
    age: '',
    pensionDate: '',
    balance: '',
    balanceType: 'debtor' as 'debtor' | 'creditor',
    notes: '',
    guarantors: [null, null, null] as [Guarantor | null, Guarantor | null, Guarantor | null],
    isSued: false,
    suedDate: '',
  };

  const [formData, setFormData] = useState(emptyForm);
  const { settings } = useAuth();

  useEffect(() => {
    loadCustomers();
  }, []);

  const loadCustomers = async () => {
    await syncCustomers();
    const data = getCustomers();
    // Generate customer numbers for existing customers without one
    const updated = data.map((c, index) => ({
      ...c,
      customerNumber: c.customerNumber || `C-${String(index + 1).padStart(4, '0')}`
    }));
    setCustomers(updated);
  };

  const generateCustomerNumber = () => {
    const maxNum = customers.reduce((max, c) => {
      const num = parseInt(c.customerNumber?.replace('C-', '') || '0');
      return num > max ? num : max;
    }, 0);
    return `C-${String(maxNum + 1).padStart(4, '0')}`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const customerData: Partial<Customer> = {
      name: formData.name,
      phone: formData.phone,
      email: formData.email || undefined,
      address: formData.address,
      gender: formData.gender,
      city: formData.city,
      governorate: formData.governorate,
      region: formData.region,
      dateOfBirth: formData.dateOfBirth,
      nationalId: formData.nationalId,
      age: parseInt(formData.age) || 0,
      pensionDate: '',
      balance: 0,
      balanceType: 'debtor',
      notes: formData.notes || undefined,
      guarantors: formData.guarantors,
      isSued: formData.isSued,
      suedDate: formData.isSued ? (formData.suedDate || new Date().toISOString()) : undefined
    };

    try {
      if (isEditing && selectedCustomer) {
        await updateCustomer(selectedCustomer.id, customerData);
      } else {
        await createCustomer({
          ...customerData,
          customerNumber: generateCustomerNumber(),
          balance: 0,
          balanceType: 'debtor'
        } as Customer);
      }

      await loadCustomers();
      handleClose();
    } catch (err: any) {
      setError(err.message || 'حدث خطأ أثناء حفظ بيانات العميل. يرجى التحقق من صحة البيانات المدخلة.');
    }
  };

  const handleEdit = (customer: Customer) => {
    setSelectedCustomer(customer);
    setFormData({
      name: customer.name,
      phone: customer.phone,
      email: customer.email || '',
      address: customer.address,
      gender: customer.gender,
      city: customer.city || '',
      governorate: customer.governorate || '',
      region: customer.region || '',
      dateOfBirth: customer.dateOfBirth || '',
      nationalId: customer.nationalId || '',
      age: customer.age?.toString() || '',
      pensionDate: customer.pensionDate || '',
      balance: customer.balance?.toString() || '',
      balanceType: customer.balanceType || 'debtor',
      notes: customer.notes || '',
      guarantors: customer.guarantors || [null, null, null],
      isSued: customer.isSued || false,
      suedDate: customer.suedDate || '',
    });
    setIsEditing(true);
    setShowForm(true);
    setError(null);
  };

  const handleDelete = async (id: string) => {
    if (confirm('هل أنت متأكد من حذف هذا العميل؟')) {
      try {
        await deleteCustomer(id);
        await loadCustomers();
        handleClose();
      } catch (err: any) {
        alert(err.message || 'حدث خطأ أثناء حذف العميل.');
      }
    }
  };

  const handleClose = () => {
    setShowForm(false);
    setIsEditing(false);
    setSelectedCustomer(null);
    setFormData(emptyForm);
    setError(null);
  };

  const handleNew = () => {
    setFormData(emptyForm);
    setSelectedCustomer(null);
    setIsEditing(false);
    setShowForm(true);
    setError(null);
  };

  const updateGuarantor = (index: number, field: keyof Guarantor, value: string) => {
    const newGuarantors = [...formData.guarantors] as [Guarantor | null, Guarantor | null, Guarantor | null];
    if (!newGuarantors[index]) {
      newGuarantors[index] = { ...initialGuarantor };
    }
    newGuarantors[index] = { ...newGuarantors[index]!, [field]: value };
    setFormData({ ...formData, guarantors: newGuarantors });
  };

  const handleNationalIdChange = (value: string) => {
    const nationalId = value.replace(/\D/g, '').slice(0, 14);
    const dateOfBirth = getBirthDateFromEgyptianNationalId(nationalId);

    setFormData((current) => ({
      ...current,
      nationalId,
      ...(dateOfBirth
        ? {
            dateOfBirth,
            age: String(calculateAgeFromDate(dateOfBirth)),
          }
        : {}),
    }));
  };

  const filteredCustomers = customers.filter(c =>
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.phone.includes(searchTerm) ||
    c.customerNumber?.includes(searchTerm)
  );

  const formatCurrency = (amount: number) => formatWholeCurrency(amount, settings.currency);

  // Get next customer number for display
  const nextCustomerNumber = selectedCustomer?.customerNumber || generateCustomerNumber();

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <div className="bg-gradient-to-l from-pink-600 to-pink-500 text-white py-4 px-6 shadow-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Users className="text-2xl" />
            <h1 className="text-xl font-bold">تكويد بيانات العملاء</h1>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="opacity-80">إجمالي العملاء:</span>
            <span className="font-bold text-lg bg-white/20 px-3 py-1 rounded-full">
              {customers.length}
            </span>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="p-6">
        {/* Action Buttons Bar */}
        <div className="bg-white rounded-xl shadow-sm p-4 mb-6">
          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleNew}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              <Plus size={18} />
              <span>جديد</span>
            </button>
            <button
              onClick={() => setSearchModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Search size={18} />
              <span>بحث</span>
            </button>
          </div>
        </div>

        {/* Customers List */}
        {!showForm && (
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-800">قائمة العملاء</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">رقم العميل</th>
                    <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">الاسم</th>
                    <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">رقم الهاتف</th>
                    <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">العنوان</th>
                    <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">الرصيد</th>
                    <th className="px-4 py-3 text-center text-sm font-semibold text-gray-600">الإجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredCustomers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                        لا يوجد عملاء
                      </td>
                    </tr>
                  ) : (
                    filteredCustomers.map(customer => (
                      <tr key={customer.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 text-sm font-medium text-blue-600">
                          {customer.customerNumber}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${customer.isSued ? 'bg-red-100' : 'bg-pink-100'}`}>
                              {customer.isSued ? <Gavel size={16} className="text-red-600" /> : <User size={16} className="text-pink-600" />}
                            </div>
                            <div className="flex flex-col">
                               <span className={`font-medium ${customer.isSued ? 'text-red-600 line-through' : 'text-gray-800'}`}>{customer.name}</span>
                               {customer.isSued && <span className="text-xs text-red-500 font-bold flex items-center gap-1"><AlertTriangle size={10} /> محال للقضاء</span>}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">{customer.phone}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{customer.address || '-'}</td>
                        <td className="px-4 py-3">
                          <span className={`text-sm font-medium ${customer.balanceType === 'debtor' ? 'text-red-600' : 'text-green-600'}`}>
                            {formatCurrency(customer.balance)} {customer.balanceType === 'debtor' ? 'مدين' : 'دائن'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => handleEdit(customer)}
                              className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            >
                              <Edit size={16} />
                            </button>
                            <button
                              onClick={() => handleDelete(customer.id)}
                              className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Customer Form */}
        {showForm && (
          <div className="bg-white rounded-xl shadow-lg overflow-hidden">
            {/* Form Header */}
            <div className="bg-gray-800 text-white py-3 px-6 flex items-center justify-between">
              <h2 className="font-bold text-lg">
                {isEditing ? 'تعديل بيانات العميل' : 'إضافة عميل جديد'}
              </h2>
              <button
                onClick={handleClose}
                className="p-2 hover:bg-white/20 rounded-lg transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6">
              {error && (
                <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm font-medium flex items-center gap-2">
                  <AlertTriangle className="text-red-500 shrink-0" size={18} />
                  <span>{error}</span>
                </div>
              )}
              <div className="flex gap-6">
                {/* Right Side - Action Buttons */}
                <div className="w-32 flex flex-col gap-3">
                  <button
                    type="submit"
                    className="flex items-center justify-center gap-2 px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
                  >
                    <Save size={18} />
                    <span>حفظ</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleNew}
                    className="flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                  >
                    <Plus size={18} />
                    <span>جديد</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSearchModal(true)}
                    className="flex items-center justify-center gap-2 px-4 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium"
                  >
                    <Search size={18} />
                    <span>بحث</span>
                  </button>
                  {isEditing && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleEdit(selectedCustomer!)}
                        className="flex items-center justify-center gap-2 px-4 py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors font-medium"
                      >
                        <Edit size={18} />
                        <span>تعديل</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(selectedCustomer!.id)}
                        className="flex items-center justify-center gap-2 px-4 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
                      >
                        <Trash2 size={18} />
                        <span>حذف</span>
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={handleClose}
                    className="flex items-center justify-center gap-2 px-4 py-3 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors font-medium"
                  >
                    <X size={18} />
                    <span>إغلاق</span>
                  </button>
                </div>

                {/* Left Side - Form Fields */}
                <div className="flex-1">
                  {/* Customer Number & Photo */}
                  <div className="flex gap-6 mb-6">
                    {/* Photo Area */}
                    <div className="w-40">
                      <div className="border-2 border-dashed border-gray-300 rounded-xl p-4 text-center bg-gray-50">
                        <div className="w-full aspect-square bg-gradient-to-br from-pink-100 to-pink-200 rounded-lg flex items-center justify-center mb-3">
                          <User size={48} className="text-pink-400" />
                        </div>
                        <button
                          type="button"
                          className="w-full px-3 py-1.5 text-xs bg-white border border-gray-300 rounded-lg hover:bg-gray-50 mb-2"
                        >
                          من ملف
                        </button>
                        <button
                          type="button"
                          className="w-full px-3 py-1.5 text-xs bg-white border border-gray-300 rounded-lg hover:bg-gray-50 mb-2"
                        >
                          حذف
                        </button>
                        <div className="text-xs text-gray-400 my-2">أو</div>
                        <button
                          type="button"
                          className="w-full px-3 py-1.5 text-xs bg-pink-600 text-white rounded-lg hover:bg-pink-700"
                        >
                          <Camera size={14} className="inline ml-1" />
                          الكاميرا
                        </button>
                      </div>
                    </div>

                    {/* Customer Number */}
                    <div className="flex-1">
                      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4">
                        <label className="block text-sm font-medium text-gray-600 mb-2">رقم العميل</label>
                        <div className="text-2xl font-bold text-blue-600">{nextCustomerNumber}</div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-600 mb-1">اسم العميل *</label>
                          <input
                            type="text"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500 outline-none"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-600 mb-1">النوع</label>
                          <div className="flex gap-4">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="radio"
                                name="gender"
                                value="male"
                                checked={formData.gender === 'male'}
                                onChange={() => setFormData({ ...formData, gender: 'male' })}
                                className="w-4 h-4 text-pink-600"
                              />
                              <UserCircle size={16} className="text-blue-600" />
                              <span className="text-sm">ذكر</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="radio"
                                name="gender"
                                value="female"
                                checked={formData.gender === 'female'}
                                onChange={() => setFormData({ ...formData, gender: 'female' })}
                                className="w-4 h-4 text-pink-600"
                              />
                              <User size={16} className="text-pink-600" />
                              <span className="text-sm">أنثى</span>
                            </label>
                          </div>
                        </div>
                      </div>

                      {/* Legal Status Toggle */}
                      <div className="mt-4 p-4 rounded-xl border border-red-200 bg-red-50 flex flex-col sm:flex-row items-center justify-between gap-4">
                         <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-red-100 text-red-600 rounded-full flex items-center justify-center shrink-0">
                               <Gavel size={20} />
                            </div>
                            <div>
                               <h4 className="font-bold text-red-800">الشئون القانونية والنزاعات</h4>
                               <p className="text-xs text-red-600">تفعيل هذا الخيار سيضع العميل في القائمة السوداء ويمنع التعامل معه.</p>
                            </div>
                         </div>
                         <label className="flex items-center cursor-pointer">
                            <div className="relative">
                               <input 
                                 type="checkbox" 
                                 className="sr-only" 
                                 checked={formData.isSued} 
                                 onChange={(e) => setFormData({...formData, isSued: e.target.checked})} 
                               />
                               <div className={`block w-14 h-8 rounded-full transition-colors ${formData.isSued ? 'bg-red-500' : 'bg-gray-300'}`}></div>
                               <div className={`dot absolute left-1 top-1 bg-white w-6 h-6 rounded-full transition-transform ${formData.isSued ? 'transform translate-x-6' : ''}`}></div>
                            </div>
                         </label>
                      </div>

                    </div>
                  </div>

                  {/* Personal Info Section */}
                  <div className="border border-gray-300 rounded-xl p-4 mb-4">
                    <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                      <CreditCard size={18} className="text-pink-600" />
                      البيانات الشخصية
                    </h3>
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-600 mb-1">العنوان *</label>
                        <input
                          type="text"
                          value={formData.address}
                          onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500 outline-none"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-600 mb-1">المدينة *</label>
                        <input
                          type="text"
                          value={formData.city}
                          onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500 outline-none"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-600 mb-1">المحافظة *</label>
                        <input
                          type="text"
                          value={formData.governorate}
                          onChange={(e) => setFormData({ ...formData, governorate: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500 outline-none"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-600 mb-1">المنطقة *</label>
                        <input
                          type="text"
                          value={formData.region}
                          onChange={(e) => setFormData({ ...formData, region: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500 outline-none"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-600 mb-1">رقم الهاتف *</label>
                        <input
                          type="tel"
                          value={formData.phone}
                          onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500 outline-none"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-600 mb-1">الإيميل</label>
                        <input
                          type="email"
                          value={formData.email}
                          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500 outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  {/* ID & Financial Info Section */}
                  <div className="border border-gray-300 rounded-xl p-4 mb-4">
                    <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                      <FileText size={18} className="text-pink-600" />
                      البيانات الثبوتية والمالية
                    </h3>
                    <div className="grid grid-cols-4 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-600 mb-1">الرقم القومى *</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={14}
                          value={formData.nationalId}
                          onChange={(e) => handleNationalIdChange(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500 outline-none"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-600 mb-1">تاريخ الميلاد *</label>
                        <DatePicker
                          value={formData.dateOfBirth}
                          onChange={(date) =>
                            setFormData({
                              ...formData,
                              dateOfBirth: date,
                              age: date ? String(calculateAgeFromDate(date)) : '',
                            })
                          }
                          className="w-full border-gray-300 px-3 py-2"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-600 mb-1">العمر *</label>
                        <input
                          type="number"
                          value={formData.age}
                          readOnly
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-700 outline-none"
                          required
                        />
                      </div>
                    </div>
                  </div>

                  {/* Notes */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-600 mb-1">ملاحظات</label>
                    <textarea
                      value={formData.notes}
                      onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                      rows={3}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500 outline-none resize-none"
                    />
                  </div>

                  {/* Guarantors Section */}
                  <div className="border border-gray-300 rounded-xl p-4">
                    <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                      <Users size={18} className="text-pink-600" />
                      الضامنين
                    </h3>

                    {/* First & Second Guarantor */}
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      {/* Guarantor 1 */}
                      <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                        <h4 className="font-medium text-gray-700 mb-3">الضامن الأول</h4>
                        <div className="space-y-3">
                          <input
                            type="text"
                            placeholder="الاسم"
                            value={formData.guarantors[0]?.name || ''}
                            onChange={(e) => updateGuarantor(0, 'name', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500 outline-none text-sm"
                          />
                          <input
                            type="text"
                            placeholder="العنوان"
                            value={formData.guarantors[0]?.address || ''}
                            onChange={(e) => updateGuarantor(0, 'address', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500 outline-none text-sm"
                          />
                          <input
                            type="text"
                            placeholder="الرقم القومى"
                            value={formData.guarantors[0]?.nationalId || ''}
                            onChange={(e) => updateGuarantor(0, 'nationalId', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500 outline-none text-sm"
                          />
                          <input
                            type="tel"
                            placeholder="رقم الهاتف"
                            value={formData.guarantors[0]?.phone || ''}
                            onChange={(e) => updateGuarantor(0, 'phone', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500 outline-none text-sm"
                          />
                          <input
                            type="text"
                            placeholder="صلة القرابة"
                            value={formData.guarantors[0]?.relationship || ''}
                            onChange={(e) => updateGuarantor(0, 'relationship', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500 outline-none text-sm"
                          />
                        </div>
                      </div>

                      {/* Guarantor 2 */}
                      <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                        <h4 className="font-medium text-gray-700 mb-3">الضامن الثانى</h4>
                        <div className="space-y-3">
                          <input
                            type="text"
                            placeholder="الاسم"
                            value={formData.guarantors[1]?.name || ''}
                            onChange={(e) => updateGuarantor(1, 'name', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500 outline-none text-sm"
                          />
                          <input
                            type="text"
                            placeholder="العنوان"
                            value={formData.guarantors[1]?.address || ''}
                            onChange={(e) => updateGuarantor(1, 'address', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500 outline-none text-sm"
                          />
                          <input
                            type="text"
                            placeholder="الرقم القومى"
                            value={formData.guarantors[1]?.nationalId || ''}
                            onChange={(e) => updateGuarantor(1, 'nationalId', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500 outline-none text-sm"
                          />
                          <input
                            type="tel"
                            placeholder="رقم الهاتف"
                            value={formData.guarantors[1]?.phone || ''}
                            onChange={(e) => updateGuarantor(1, 'phone', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500 outline-none text-sm"
                          />
                          <input
                            type="text"
                            placeholder="صلة القرابة"
                            value={formData.guarantors[1]?.relationship || ''}
                            onChange={(e) => updateGuarantor(1, 'relationship', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500 outline-none text-sm"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Guarantor 3 */}
                    <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                      <h4 className="font-medium text-gray-700 mb-3">الضامن الثالث</h4>
                      <div className="grid grid-cols-5 gap-3">
                        <input
                          type="text"
                          placeholder="الاسم"
                          value={formData.guarantors[2]?.name || ''}
                          onChange={(e) => updateGuarantor(2, 'name', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500 outline-none text-sm"
                        />
                        <input
                          type="text"
                          placeholder="العنوان"
                          value={formData.guarantors[2]?.address || ''}
                          onChange={(e) => updateGuarantor(2, 'address', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500 outline-none text-sm"
                        />
                        <input
                          type="text"
                          placeholder="الرقم القومى"
                          value={formData.guarantors[2]?.nationalId || ''}
                          onChange={(e) => updateGuarantor(2, 'nationalId', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500 outline-none text-sm"
                        />
                        <input
                          type="tel"
                          placeholder="رقم الهاتف"
                          value={formData.guarantors[2]?.phone || ''}
                          onChange={(e) => updateGuarantor(2, 'phone', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500 outline-none text-sm"
                        />
                        <input
                          type="text"
                          placeholder="صلة القرابة"
                          value={formData.guarantors[2]?.relationship || ''}
                          onChange={(e) => updateGuarantor(2, 'relationship', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500 outline-none text-sm"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </form>
          </div>
        )}
      </div>

      {/* Search Modal */}
      {searchModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-2xl shadow-2xl">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-bold text-lg text-gray-800">بحث عن عميل</h3>
              <button
                onClick={() => setSearchModal(false)}
                className="p-2 hover:bg-gray-100 rounded-lg"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-4">
              <input
                type="text"
                placeholder="أدخل رقم العميل أو الاسم أو رقم الهاتف..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500 outline-none mb-4"
                autoFocus
              />
              <div className="max-h-80 overflow-y-auto border border-gray-200 rounded-lg">
                {filteredCustomers.map(customer => (
                  <div
                    key={customer.id}
                    onClick={() => {
                      handleEdit(customer);
                      setSearchModal(false);
                    }}
                    className="p-4 border-b border-gray-100 hover:bg-gray-50 cursor-pointer last:border-b-0"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-bold text-gray-800">{customer.name}</div>
                        <div className="text-sm text-gray-500">{customer.phone}</div>
                      </div>
                      <div className="text-left">
                        <div className="text-sm font-medium text-blue-600">{customer.customerNumber}</div>
                        <div className={`text-sm ${customer.balanceType === 'debtor' ? 'text-red-600' : 'text-green-600'}`}>
                          {formatCurrency(customer.balance)}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                {filteredCustomers.length === 0 && (
                  <div className="p-8 text-center text-gray-500">
                    لا توجد نتائج
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
