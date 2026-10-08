import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Plus, Edit, Trash2, Search, Save, X, Camera, Upload, User,
  MapPin, Phone, Calendar, FileText, AlertTriangle, Gavel,
  Building, Users, DollarSign, UserCircle, CreditCard,
  Grid, List, TrendingUp, UserCheck, Coins, Eye
} from 'lucide-react';
import { Customer, Guarantor } from '../types';
import { getCustomers, createCustomer, updateCustomer, deleteCustomer } from '../lib/storage';
import { useAuth } from '../context/AuthContext';
import { isAdmin } from '../lib/permissions';
import { DatePicker } from '../components/DatePicker';
import { formatWholeCurrency } from '../lib/utils';
import { api, isApiMode } from '../lib/apiClient';

const CUSTOMER_RENDER_LIMIT = 100;
const SEARCH_MODAL_LIMIT = 50;

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
  const [visibleLimit, setVisibleLimit] = useState(CUSTOMER_RENDER_LIMIT);
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');
  const [filterTab, setFilterTab] = useState<'all' | 'debtor' | 'sued'>('all');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const didLoadRef = useRef(false);
  const pendingRenderMeasureRef = useRef(false);
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
    balanceType: 'debtor' as 'debtor',
    notes: '',
    guarantors: [null, null, null] as [Guarantor | null, Guarantor | null, Guarantor | null],
    isSued: false,
    suedDate: '',
  };

  const [formData, setFormData] = useState(emptyForm);
  const { settings, user } = useAuth();
  const canDelete = isAdmin(user);

  useEffect(() => {
    if (didLoadRef.current) return;
    didLoadRef.current = true;
    void loadCustomers();
  }, []);

  useEffect(() => {
    if (showForm) {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [showForm]);

  useEffect(() => {
    if (!pendingRenderMeasureRef.current) return;
    pendingRenderMeasureRef.current = false;
    requestAnimationFrame(() => {
      console.timeEnd('Customers.initialRenderCommit');
    });
  });

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  const loadCustomers = async () => {
    console.time('Customers.totalLoad');
    try {
      console.time('Customers.networkApiCall');
      const data = isApiMode() ? await api.listCustomers() : getCustomers();
      console.timeEnd('Customers.networkApiCall');
      const payloadBytes = new Blob([JSON.stringify(data)]).size;
      console.info(`Customers payload: ${payloadBytes} bytes for ${data.length} rows`);

      console.time('Customers.transformAndState');
      const updated = data.map((c: Customer, index: number) => ({
        ...c,
        customerNumber: c.customerNumber || `C-${String(index + 1).padStart(4, '0')}`,
      }));
      pendingRenderMeasureRef.current = true;
      console.time('Customers.initialRenderCommit');
      setCustomers(updated);
      console.timeEnd('Customers.transformAndState');
    } finally {
      console.timeEnd('Customers.totalLoad');
    }
  };

  const nextGeneratedCustomerNumber = useMemo(() => {
    if (!showForm || isEditing) return '';
    console.time('Customers.generateCustomerNumber');
    const maxNum = customers.reduce((max, c) => {
      const num = parseInt(c.customerNumber?.replace('C-', '') || '0');
      return num > max ? num : max;
    }, 0);
    const nextNumber = `C-${String(maxNum + 1).padStart(4, '0')}`;
    console.timeEnd('Customers.generateCustomerNumber');
    return nextNumber;
  }, [customers, isEditing, showForm]);

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
      balanceType: 'debtor' as 'debtor',
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
          customerNumber: nextGeneratedCustomerNumber,
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

  const handleEdit = async (customer: Customer) => {
    console.time('Customers.editDetailFetch');
    const fullCustomer = isApiMode() ? await api.getCustomer(customer.id) as Customer : customer;
    console.timeEnd('Customers.editDetailFetch');
    setSelectedCustomer(fullCustomer);
    setFormData({
      name: fullCustomer.name,
      phone: fullCustomer.phone,
      email: fullCustomer.email || '',
      address: fullCustomer.address,
      gender: fullCustomer.gender,
      city: fullCustomer.city || '',
      governorate: fullCustomer.governorate || '',
      region: fullCustomer.region || '',
      dateOfBirth: fullCustomer.dateOfBirth || '',
      nationalId: fullCustomer.nationalId || '',
      age: fullCustomer.age?.toString() || '',
      pensionDate: fullCustomer.pensionDate || '',
      balance: fullCustomer.balance?.toString() || '',
      balanceType: 'debtor' as 'debtor',
      notes: fullCustomer.notes || '',
      guarantors: fullCustomer.guarantors || [null, null, null],
      isSued: fullCustomer.isSued || false,
      suedDate: fullCustomer.suedDate || '',
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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F2') {
        event.preventDefault();
        handleNew();
      }
      if (event.key === 'F5') {
        event.preventDefault();
        void loadCustomers();
      }
      if (event.key === 'Escape') {
        if (searchModal) setSearchModal(false);
        if (showForm) handleClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [searchModal, showForm]);

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

  const filteredCustomers = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return customers.filter((customer) => {
      const matchesSearch =
        !term ||
        customer.name.toLowerCase().includes(term) ||
        customer.phone.includes(term) ||
        (customer.customerNumber || '').toLowerCase().includes(term);

      if (!matchesSearch) return false;
      if (filterTab === 'debtor') return Math.round(Number(customer.balance)) > 0;
      if (filterTab === 'sued') return !!customer.isSued;
      return true;
    });
  }, [customers, filterTab, searchTerm]);

  const visibleCustomers = useMemo(
    () => filteredCustomers.slice(0, visibleLimit),
    [filteredCustomers, visibleLimit],
  );

  const modalCustomers = useMemo(
    () => (searchModal ? filteredCustomers.slice(0, SEARCH_MODAL_LIMIT) : []),
    [filteredCustomers, searchModal],
  );

  const formatCurrency = (amount: number) => formatWholeCurrency(amount, settings.currency);

  const nextCustomerNumber = showForm ? selectedCustomer?.customerNumber || nextGeneratedCustomerNumber : '';

  const customerStats = useMemo(
    () => customers.reduce(
      (stats, customer) => {
        const balance = Number(customer.balance || 0);
        stats.totalCustomersCount += 1;
        if (customer.isSued) stats.suedCustomersCount += 1;
        if (Math.round(balance) > 0 && !customer.isSued) stats.activeCustomersCount += 1;
        return stats;
      },
      { totalCustomersCount: 0, suedCustomersCount: 0, activeCustomersCount: 0 },
    ),
    [customers],
  );

  const { totalCustomersCount, suedCustomersCount, activeCustomersCount } = customerStats;

  return (
    <div className="space-y-2">
      {/* Unified Compact Header Strip */}
      <div className="erp-action-bar">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-black text-slate-900 shrink-0">العملاء</h2>
          <div className="flex bg-slate-100 rounded-lg p-0.5 shrink-0">
            <button
              onClick={() => {
                setFilterTab('all');
                setVisibleLimit(CUSTOMER_RENDER_LIMIT);
              }}
              className={`px-2.5 py-1 rounded-md text-xs font-bold transition-all ${filterTab === 'all' ? 'bg-white text-blue-600 shadow-xs' : 'text-slate-500 hover:text-slate-900'}`}
            >
              الكل ({totalCustomersCount})
            </button>
            <button
              onClick={() => {
                setFilterTab('debtor');
                setVisibleLimit(CUSTOMER_RENDER_LIMIT);
              }}
              className={`px-2.5 py-1 rounded-md text-xs font-bold transition-all ${filterTab === 'debtor' ? 'bg-white text-blue-600 shadow-xs' : 'text-slate-500 hover:text-slate-900'}`}
            >
              مدينون ({activeCustomersCount})
            </button>
            <button
              onClick={() => {
                setFilterTab('sued');
                setVisibleLimit(CUSTOMER_RENDER_LIMIT);
              }}
              className={`px-2.5 py-1 rounded-md text-xs font-bold transition-all ${filterTab === 'sued' ? 'bg-white text-rose-600 shadow-xs' : 'text-slate-500 hover:text-slate-900'}`}
            >
              نزاعات ({suedCustomersCount})
            </button>
          </div>
          <div className="relative flex-1 min-w-[240px] max-w-md">
            <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              ref={searchInputRef}
              autoFocus
              placeholder="بحث باسم العميل، رقم العميل، أو الهاتف..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setVisibleLimit(CUSTOMER_RENDER_LIMIT);
              }}
              className="input-ui h-9 w-full pr-9 pl-3 text-xs bg-white border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleNew}
            className="flex items-center gap-1.5 bg-blue-600 text-white px-3.5 py-1.5 rounded-lg hover:bg-blue-700 transition-colors text-xs font-bold shadow-xs"
          >
            <Plus size={15} />
            <span>+ عميل جديد</span>
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="hidden grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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

      {/* Customers List / Grid */}
      {viewMode === 'table' ? (
        <div className="bg-white rounded-lg shadow-2xs border border-slate-200 overflow-hidden">
          <div className="overflow-auto h-[calc(100vh-210px)]">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="py-2.5 px-4 text-right text-xs font-bold text-slate-700 tracking-wider">كود العميل</th>
                  <th className="py-2.5 px-4 text-right text-xs font-bold text-slate-700 tracking-wider">اسم العميل</th>
                  <th className="py-2.5 px-4 text-right text-xs font-bold text-slate-700 tracking-wider">رقم الهاتف</th>
                  <th className="py-2.5 px-4 text-right text-xs font-bold text-slate-700 tracking-wider">العنوان</th>
                  <th className="py-2.5 px-4 text-right text-xs font-bold text-slate-700 tracking-wider">الرصيد الحالي</th>
                  <th className="py-2.5 px-4 text-center text-xs font-bold text-slate-700 tracking-wider">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredCustomers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 px-4 text-center text-slate-400">
                      <Users size={36} className="mx-auto mb-2 text-slate-300" />
                      <p className="text-xs font-bold">لا يوجد عملاء مطابِقين للبحث الحالي</p>
                    </td>
                  </tr>
                ) : (
                  visibleCustomers.map(customer => (
                    <tr
                      key={customer.id}
                      onDoubleClick={() => handleEdit(customer)}
                      title="انقر مرتين للتعديل"
                      className="group cursor-pointer hover:bg-slate-50 transition-colors"
                    >
                      <td className="py-2.5 px-4">
                        <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold bg-blue-50 text-blue-700 font-mono border border-blue-100">
                          {customer.customerNumber}
                        </span>
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border ${customer.isSued ? 'bg-red-50 text-red-600 border-red-200' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                            {customer.isSued ? <Gavel size={14} /> : <User size={14} />}
                          </div>
                          <div className="flex flex-col">
                            <span className={`font-bold text-xs md:text-sm ${customer.isSued ? 'text-red-600 line-through' : 'text-slate-800'}`}>{customer.name}</span>
                            {customer.isSued && <span className="text-[10px] text-red-500 font-bold flex items-center gap-1"><AlertTriangle size={10} /> محال للقضاء</span>}
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 px-4 text-xs md:text-sm text-slate-600 font-mono">{customer.phone}</td>
                      <td className="py-2.5 px-4 text-xs md:text-sm text-slate-500 truncate max-w-[200px]">{customer.address || '—'}</td>
                      <td className="py-2.5 px-4">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold ${Number(customer.balance) > 0 ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-slate-100 text-slate-600'}`}>
                          {formatCurrency(customer.balance)} {Math.round(Number(customer.balance)) > 0 ? 'مدين' : ''}
                        </span>
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="erp-icon-actions">
                          <button
                            onClick={() => handleEdit(customer)}
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                            title="تعديل"
                          >
                            <Edit size={15} />
                          </button>
                          {canDelete && (
                          <button
                            onClick={() => handleDelete(customer.id)}
                            className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-md transition-colors"
                            title="حذف"
                          >
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
          {filteredCustomers.length > visibleCustomers.length && (
            <div className="border-t border-slate-100 bg-slate-50 px-4 py-2 text-center">
              <button
                type="button"
                onClick={() => setVisibleLimit((limit) => limit + CUSTOMER_RENDER_LIMIT)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100"
              >
                عرض المزيد ({filteredCustomers.length - visibleCustomers.length})
              </button>
            </div>
          )}
          {/* Sticky Summary Footer Bar */}
          <div className="erp-status-bar">
            <span className="font-bold text-slate-700">إجمالي السجلات: <span className="text-blue-700 font-extrabold">{filteredCustomers.length}</span> (المعروض: {visibleCustomers.length})</span>
          </div>
        </div>
      ) : (
        /* Grid View of Cards */
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredCustomers.length === 0 ? (
              <div className="col-span-full bg-white rounded-2xl border border-slate-100 p-12 text-center text-slate-400 shadow-sm">
                <Users size={40} className="mx-auto mb-3 text-slate-300" />
                <p className="text-sm font-bold">لا يوجد عملاء مطابِقين للبحث الحالي</p>
              </div>
            ) : (
              visibleCustomers.map(customer => (
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
                      {canDelete && (
                      <button
                        onClick={() => handleDelete(customer.id)}
                        className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg"
                        title="حذف"
                      >
                        <Trash2 size={14} />
                      </button>
                      )}
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
                    <span className={`px-3 py-1 rounded-full text-xs font-black border ${Number(customer.balance) > 0 ? 'bg-rose-50 text-rose-700 border-rose-100/5' : 'bg-slate-50 text-slate-500 border-slate-100'}`}>
                      {formatCurrency(customer.balance)} {Math.round(Number(customer.balance)) > 0 ? 'مدين' : ''}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
          {filteredCustomers.length > visibleCustomers.length && (
            <div className="text-center pt-2">
              <button
                type="button"
                onClick={() => setVisibleLimit((limit) => limit + CUSTOMER_RENDER_LIMIT)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50"
              >
                عرض المزيد ({filteredCustomers.length - visibleCustomers.length})
              </button>
            </div>
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
                {isEditing && canDelete && (
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
                {modalCustomers.map(customer => (
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
                        <div className={`text-sm ${Math.round(Number(customer.balance)) > 0 ? 'text-red-600' : 'text-slate-500'}`}>
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
