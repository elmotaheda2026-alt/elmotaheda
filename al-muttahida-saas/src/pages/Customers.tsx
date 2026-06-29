import React, { useState, useEffect, useRef } from 'react';
import {
  Plus, Edit, Trash2, Search, Save, X, Camera, Upload, User,
  MapPin, Phone, Calendar, FileText, AlertTriangle, Gavel,
  Building, Users, DollarSign, UserCircle, CreditCard,
  Grid, List, TrendingUp, UserCheck, Coins, Eye
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
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');
  const [filterTab, setFilterTab] = useState<'all' | 'debtor' | 'creditor' | 'sued'>('all');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    if (showForm) {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [showForm]);

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
      balance: isEditing && selectedCustomer ? selectedCustomer.balance : 0,
      balanceType: isEditing && selectedCustomer ? selectedCustomer.balanceType : 'debtor',
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
    const cleanedValue = (field === 'phone' || field === 'nationalId') ? value.replace(/\D/g, '') : value;
    const newGuarantors = [...formData.guarantors] as [Guarantor | null, Guarantor | null, Guarantor | null];
    if (!newGuarantors[index]) {
      newGuarantors[index] = { ...initialGuarantor };
    }
    newGuarantors[index] = { ...newGuarantors[index]!, [field]: cleanedValue };
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

  const filteredCustomers = customers.filter(c => {
    const matchesSearch = 
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.phone.includes(searchTerm) ||
      c.customerNumber?.toLowerCase().includes(searchTerm.toLowerCase());
      
    if (!matchesSearch) return false;
    
    if (filterTab === 'debtor') return c.balanceType === 'debtor' && c.balance > 0;
    if (filterTab === 'creditor') return c.balanceType === 'creditor' && c.balance > 0;
    if (filterTab === 'sued') return !!c.isSued;
    
    return true;
  });

  const formatCurrency = (amount: number) => formatWholeCurrency(amount, settings.currency);

  const nextCustomerNumber = selectedCustomer?.customerNumber || generateCustomerNumber();

  // Statistics calculations
  const totalCustomersCount = customers.length;
  const suedCustomersCount = customers.filter(c => c.isSued).length;
  const activeCustomersCount = customers.filter(c => c.balance > 0 && !c.isSued).length;
  const totalDebtsAmount = customers.reduce((sum, c) => {
    if (c.balanceType === 'debtor') {
      return sum + (c.balance || 0);
    }
    return sum;
  }, 0);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex justify-between items-center border-b border-slate-100 pb-3">
        <h2 className="text-xl font-black text-slate-900">العملاء</h2>
        <button
          onClick={handleNew}
          className="flex items-center gap-1.5 bg-indigo-600 text-white px-4 py-2 rounded-xl hover:bg-indigo-700 transition-colors text-sm font-bold shadow-sm"
        >
          <Plus size={16} />
          <span>عميل جديد</span>
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Customers */}
        <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm hover:shadow-md transition-shadow flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-bold text-slate-500 block">إجمالي العملاء</span>
            <span className="text-2xl font-black text-slate-900">{totalCustomersCount}</span>
          </div>
          <div className="w-12 h-12 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600">
            <Users size={22} />
          </div>
        </div>

        {/* Active Customers */}
        <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm hover:shadow-md transition-shadow flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-bold text-slate-500 block">العملاء النشطون</span>
            <span className="text-2xl font-black text-slate-900">{activeCustomersCount}</span>
          </div>
          <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600">
            <UserCheck size={22} />
          </div>
        </div>

        {/* Total Debts */}
        <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm hover:shadow-md transition-shadow flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-bold text-slate-500 block">إجمالي المديونيات</span>
            <span className="text-xl font-black text-slate-900">{formatCurrency(totalDebtsAmount)}</span>
          </div>
          <div className="w-12 h-12 bg-amber-50 rounded-2xl flex items-center justify-center text-amber-600">
            <Coins size={22} />
          </div>
        </div>

        {/* Sued Customers */}
        <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm hover:shadow-md transition-shadow flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-bold text-slate-500 block">قضايا ونزاعات</span>
            <span className="text-2xl font-black text-rose-600">{suedCustomersCount}</span>
          </div>
          <div className="w-12 h-12 bg-rose-50 rounded-2xl flex items-center justify-center text-rose-600">
            <Gavel size={22} />
          </div>
        </div>
      </div>

      {/* Toolbar / Search & Filter Tabs */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Search */}
        <div className="relative w-full md:max-w-xs">
          <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="بحث باسم العميل، رقم العميل، أو الهاتف..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pr-10 pl-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all bg-slate-50/50"
          />
        </div>

        {/* Filter Tabs & View Toggle */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex bg-slate-100 rounded-xl p-1 shrink-0">
            <button
              onClick={() => setFilterTab('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${filterTab === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}
            >
              الكل
            </button>
            <button
              onClick={() => setFilterTab('debtor')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${filterTab === 'debtor' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}
            >
              مدينون
            </button>
            <button
              onClick={() => setFilterTab('creditor')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${filterTab === 'creditor' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}
            >
              دائنون
            </button>
            <button
              onClick={() => setFilterTab('sued')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${filterTab === 'sued' ? 'bg-white text-rose-600 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}
            >
              شئون قانونية ({suedCustomersCount})
            </button>
          </div>

          <div className="h-6 w-px bg-slate-200 hidden sm:block"></div>

          {/* View Switcher Toggle */}
          <div className="flex bg-slate-100 rounded-xl p-1 shrink-0">
            <button
              onClick={() => setViewMode('table')}
              className={`p-1.5 rounded-lg transition-all ${viewMode === 'table' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
              title="عرض جدول"
            >
              <List size={16} />
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded-lg transition-all ${viewMode === 'grid' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
              title="عرض بطاقات"
            >
              <Grid size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Customers List / Grid */}
      {viewMode === 'table' ? (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-slate-50/75 border-b border-slate-100">
                  <th className="px-6 py-4 text-right text-xs font-black text-slate-500 tracking-wider">رقم العميل</th>
                  <th className="px-6 py-4 text-right text-xs font-black text-slate-500 tracking-wider">الاسم</th>
                  <th className="px-6 py-4 text-right text-xs font-black text-slate-500 tracking-wider">رقم الهاتف</th>
                  <th className="px-6 py-4 text-right text-xs font-black text-slate-500 tracking-wider">العنوان</th>
                  <th className="px-6 py-4 text-right text-xs font-black text-slate-500 tracking-wider">الرصيد الحالي</th>
                  <th className="px-6 py-4 text-center text-xs font-black text-slate-500 tracking-wider">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredCustomers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-16 text-center text-slate-400">
                      <Users size={40} className="mx-auto mb-3 text-slate-300" />
                      <p className="text-sm font-bold">لا يوجد عملاء مطابِقين للبحث الحالي</p>
                    </td>
                  </tr>
                ) : (
                  filteredCustomers.map(customer => (
                    <tr key={customer.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-indigo-50 text-indigo-600 border border-indigo-100/50 font-mono">
                          {customer.customerNumber}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-sm border ${customer.isSued ? 'bg-red-50 text-red-600 border-red-100' : 'bg-indigo-50 text-indigo-600 border-indigo-100'}`}>
                            {customer.isSued ? <Gavel size={16} /> : <User size={16} />}
                          </div>
                          <div className="flex flex-col">
                            <span className={`font-semibold text-sm ${customer.isSued ? 'text-red-600 line-through' : 'text-slate-800'}`}>{customer.name}</span>
                            {customer.isSued && <span className="text-[10px] text-red-500 font-bold flex items-center gap-1 mt-0.5"><AlertTriangle size={10} /> محال للقضاء</span>}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600 font-mono">{customer.phone}</td>
                      <td className="px-6 py-4 text-sm text-slate-500 truncate max-w-[200px]">{customer.address || '—'}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-black shadow-sm/5 border ${customer.balanceType === 'debtor' ? (customer.balance > 0 ? 'bg-rose-50 text-rose-700 border-rose-100/50' : 'bg-slate-50 text-slate-500 border-slate-100') : 'bg-emerald-50 text-emerald-700 border-emerald-100/50'}`}>
                          {formatCurrency(customer.balance)} {customer.balanceType === 'debtor' ? (customer.balance > 0 ? 'مدين' : '') : 'دائن'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => handleEdit(customer)}
                            className="p-2 text-indigo-600 hover:bg-indigo-50 border border-transparent hover:border-indigo-100 rounded-xl transition-all"
                            title="تعديل"
                          >
                            <Edit size={14} />
                          </button>
                          <button
                            onClick={() => handleDelete(customer.id)}
                            className="p-2 text-red-500 hover:bg-red-50 border border-transparent hover:border-red-100 rounded-xl transition-all"
                            title="حذف"
                          >
                            <Trash2 size={14} />
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
      ) : (
        /* Grid View of Cards */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredCustomers.length === 0 ? (
            <div className="col-span-full bg-white rounded-2xl border border-slate-100 p-12 text-center text-slate-400 shadow-sm">
              <Users size={40} className="mx-auto mb-3 text-slate-300" />
              <p className="text-sm font-bold">لا يوجد عملاء مطابِقين للبحث الحالي</p>
            </div>
          ) : (
            filteredCustomers.map(customer => (
              <div key={customer.id} className={`bg-white rounded-2xl border p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between gap-4 group ${customer.isSued ? 'border-red-100 hover:border-red-200' : 'border-slate-100 hover:border-slate-200'}`}>
                {/* Card Header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 shadow-sm border ${customer.isSued ? 'bg-red-50 text-red-600 border-red-100' : 'bg-indigo-50 text-indigo-600 border-indigo-100'}`}>
                      {customer.isSued ? <Gavel size={18} /> : <User size={18} />}
                    </div>
                    <div className="flex flex-col">
                      <span className="inline-flex w-fit px-2 py-0.5 rounded-lg text-[10px] font-bold bg-indigo-50 text-indigo-600 border border-indigo-100/30 font-mono mb-1">
                        {customer.customerNumber}
                      </span>
                      <h4 className={`font-bold text-sm leading-tight text-slate-800 ${customer.isSued ? 'line-through text-slate-400' : ''}`}>
                        {customer.name}
                      </h4>
                      {customer.isSued && (
                        <span className="text-[10px] text-red-500 font-bold flex items-center gap-1 mt-0.5">
                          <AlertTriangle size={10} /> محال للقضاء
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions Dropdown / Icons */}
                  <div className="flex gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleEdit(customer)}
                      className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-lg"
                      title="تعديل"
                    >
                      <Edit size={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(customer.id)}
                      className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg"
                      title="حذف"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Card Content info */}
                <div className="space-y-2 text-xs text-slate-500 border-t border-b border-slate-50 py-3 my-1">
                  <div className="flex items-center gap-2">
                    <Phone size={13} className="text-slate-400 shrink-0" />
                    <span className="font-mono">{customer.phone}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MapPin size={13} className="text-slate-400 shrink-0" />
                    <span className="truncate">{customer.address || 'غير محدد'}</span>
                  </div>
                </div>

                {/* Card Balance Badge */}
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px] font-bold text-slate-400">الرصيد المالي:</span>
                  <span className={`px-3 py-1 rounded-full text-xs font-black border ${customer.balanceType === 'debtor' ? (customer.balance > 0 ? 'bg-rose-50 text-rose-700 border-rose-100/50' : 'bg-slate-50 text-slate-500 border-slate-100') : 'bg-emerald-50 text-emerald-700 border-emerald-100/50'}`}>
                    {formatCurrency(customer.balance)} {customer.balanceType === 'debtor' ? (customer.balance > 0 ? 'مدين' : '') : 'دائن'}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Customer Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-5xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            {/* Form Header */}
            <div className="bg-indigo-600 text-white py-4 px-6 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-white/20 rounded-lg flex items-center justify-center">
                  <UserCircle size={20} />
                </div>
                <h2 className="font-bold text-lg">
                  {isEditing ? 'تعديل بيانات العميل' : 'إضافة عميل جديد'}
                </h2>
              </div>
              <div className="flex items-center gap-2">
                {isEditing && (
                  <button
                    type="button"
                    onClick={() => handleDelete(selectedCustomer!.id)}
                    className="flex items-center gap-1.5 px-3 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors text-sm font-medium"
                  >
                    <Trash2 size={15} />
                    <span>حذف</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleClose}
                  className="p-2 hover:bg-white/20 rounded-lg transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
              {error && (
                <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm font-medium flex items-center gap-2 shrink-0">
                  <AlertTriangle className="text-red-500 shrink-0" size={18} />
                  <span>{error}</span>
                </div>
              )}
              <div className="flex flex-col lg:flex-row gap-6">
                {/* Right Side - Photo placeholder */}
                <div className="w-full lg:w-40 shrink-0">
                  <div className="border-2 border-dashed border-indigo-200 rounded-xl p-4 text-center bg-indigo-50">
                    <div className="w-full aspect-square bg-gradient-to-br from-indigo-100 to-indigo-200 rounded-lg flex items-center justify-center mb-3">
                      <User size={48} className="text-indigo-400" />
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
                      className="w-full px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                    >
                      <Camera size={14} className="inline ml-1" />
                      الكاميرا
                    </button>
                  </div>
                </div>

                {/* Left Side - Form Fields */}
                <div className="flex-1 space-y-6">
                  {/* Customer Number & Name */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
                      <label className="block text-sm font-medium text-gray-600 mb-2">رقم العميل</label>
                      <div className="text-2xl font-bold text-indigo-600">{nextCustomerNumber}</div>
                    </div>
                    <div className="md:col-span-2 space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-600 mb-1">اسم العميل *</label>
                          <input
                            type="text"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-600 mb-1">النوع</label>
                          <div className="flex gap-4 h-10 items-center">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="radio"
                                name="gender"
                                value="male"
                                checked={formData.gender === 'male'}
                                onChange={() => setFormData({ ...formData, gender: 'male' })}
                                className="w-4 h-4 text-indigo-600"
                              />
                              <span className="text-sm">ذكر</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="radio"
                                name="gender"
                                value="female"
                                checked={formData.gender === 'female'}
                                onChange={() => setFormData({ ...formData, gender: 'female' })}
                                className="w-4 h-4 text-indigo-600"
                              />
                              <span className="text-sm">أنثى</span>
                            </label>
                          </div>
                        </div>
                      </div>

                      {/* Legal Status Toggle */}
                      <div className="p-4 rounded-xl border border-red-200 bg-red-50 flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-red-100 text-red-600 rounded-full flex items-center justify-center shrink-0">
                            <Gavel size={20} />
                          </div>
                          <div>
                            <h4 className="font-bold text-red-800 text-sm">الشئون القانونية والنزاعات</h4>
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
                  <div className="border border-gray-300 rounded-xl p-4">
                    <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                      <CreditCard size={18} className="text-indigo-600" />
                      البيانات الشخصية
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-600 mb-1">العنوان *</label>
                        <input
                          type="text"
                          value={formData.address}
                          onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-600 mb-1">المدينة *</label>
                        <input
                          type="text"
                          value={formData.city}
                          onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-600 mb-1">المحافظة *</label>
                        <input
                          type="text"
                          value={formData.governorate}
                          onChange={(e) => setFormData({ ...formData, governorate: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-600 mb-1">المنطقة *</label>
                        <input
                          type="text"
                          value={formData.region}
                          onChange={(e) => setFormData({ ...formData, region: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-600 mb-1">رقم الهاتف *</label>
                        <input
                          type="tel"
                          value={formData.phone}
                          onChange={(e) => setFormData({ ...formData, phone: e.target.value.replace(/\D/g, '') })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-600 mb-1">الإيميل</label>
                        <input
                          type="email"
                          value={formData.email}
                          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  {/* ID & Financial Info Section */}
                  <div className="border border-gray-300 rounded-xl p-4">
                    <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                      <FileText size={18} className="text-indigo-600" />
                      البيانات الثبوتية والمالية
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-600 mb-1">الرقم القومى *</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={14}
                          value={formData.nationalId}
                          onChange={(e) => handleNationalIdChange(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
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
                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1">ملاحظات</label>
                    <textarea
                      value={formData.notes}
                      onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                      rows={2}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none resize-none"
                    />
                  </div>

                  {/* Guarantors Section */}
                  <div className="border border-gray-300 rounded-xl p-4">
                    <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                      <Users size={18} className="text-indigo-600" />
                      الضامنين
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                      {/* Guarantor 1 */}
                      <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 space-y-3">
                        <h4 className="font-medium text-gray-700">الضامن الأول</h4>
                        <input
                          type="text"
                          placeholder="الاسم"
                          value={formData.guarantors[0]?.name || ''}
                          onChange={(e) => updateGuarantor(0, 'name', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm"
                        />
                        <input
                          type="text"
                          placeholder="العنوان"
                          value={formData.guarantors[0]?.address || ''}
                          onChange={(e) => updateGuarantor(0, 'address', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm"
                        />
                        <input
                          type="text"
                          placeholder="الرقم القومى"
                          value={formData.guarantors[0]?.nationalId || ''}
                          onChange={(e) => updateGuarantor(0, 'nationalId', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm"
                        />
                        <input
                          type="tel"
                          placeholder="رقم الهاتف"
                          value={formData.guarantors[0]?.phone || ''}
                          onChange={(e) => updateGuarantor(0, 'phone', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm"
                        />
                        <input
                          type="text"
                          placeholder="صلة القرابة"
                          value={formData.guarantors[0]?.relationship || ''}
                          onChange={(e) => updateGuarantor(0, 'relationship', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm"
                        />
                      </div>

                      {/* Guarantor 2 */}
                      <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 space-y-3">
                        <h4 className="font-medium text-gray-700">الضامن الثانى</h4>
                        <input
                          type="text"
                          placeholder="الاسم"
                          value={formData.guarantors[1]?.name || ''}
                          onChange={(e) => updateGuarantor(1, 'name', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm"
                        />
                        <input
                          type="text"
                          placeholder="العنوان"
                          value={formData.guarantors[1]?.address || ''}
                          onChange={(e) => updateGuarantor(1, 'address', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm"
                        />
                        <input
                          type="text"
                          placeholder="الرقم القومى"
                          value={formData.guarantors[1]?.nationalId || ''}
                          onChange={(e) => updateGuarantor(1, 'nationalId', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm"
                        />
                        <input
                          type="tel"
                          placeholder="رقم الهاتف"
                          value={formData.guarantors[1]?.phone || ''}
                          onChange={(e) => updateGuarantor(1, 'phone', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm"
                        />
                        <input
                          type="text"
                          placeholder="صلة القرابة"
                          value={formData.guarantors[1]?.relationship || ''}
                          onChange={(e) => updateGuarantor(1, 'relationship', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm"
                        />
                      </div>
                    </div>

                    {/* Guarantor 3 */}
                    <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 space-y-3">
                      <h4 className="font-medium text-gray-700">الضامن الثالث</h4>
                      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                        <input
                          type="text"
                          placeholder="الاسم"
                          value={formData.guarantors[2]?.name || ''}
                          onChange={(e) => updateGuarantor(2, 'name', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm"
                        />
                        <input
                          type="text"
                          placeholder="العنوان"
                          value={formData.guarantors[2]?.address || ''}
                          onChange={(e) => updateGuarantor(2, 'address', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm"
                        />
                        <input
                          type="text"
                          placeholder="الرقم القومى"
                          value={formData.guarantors[2]?.nationalId || ''}
                          onChange={(e) => updateGuarantor(2, 'nationalId', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm"
                        />
                        <input
                          type="tel"
                          placeholder="رقم الهاتف"
                          value={formData.guarantors[2]?.phone || ''}
                          onChange={(e) => updateGuarantor(2, 'phone', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm"
                        />
                        <input
                          type="text"
                          placeholder="صلة القرابة"
                          value={formData.guarantors[2]?.relationship || ''}
                          onChange={(e) => updateGuarantor(2, 'relationship', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Form Actions Footer */}
              <div className="border-t border-slate-100 pt-4 flex gap-3 shrink-0 justify-end bg-slate-50 p-4 -mx-6 -mb-6">
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-6 py-2 border border-gray-300 text-gray-700 bg-white rounded-lg hover:bg-gray-50 transition-colors font-bold"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-bold flex items-center gap-1.5"
                >
                  <Save size={16} />
                  <span>حفظ البيانات</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none mb-4"
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
                        <div className="text-sm font-semibold text-indigo-600">{customer.customerNumber}</div>
                        <div className={`text-sm ${customer.balanceType === 'debtor' ? 'text-red-600' : 'text-emerald-600'}`}>
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

