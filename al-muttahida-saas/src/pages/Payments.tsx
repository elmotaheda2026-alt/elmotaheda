import React, { useState, useEffect } from 'react';
import { Plus, Search, Banknote, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { Payment, Customer, Supplier } from '../types';
import { getPayments, createPayment, getCustomers, getSuppliers } from '../lib/storage';
import { useAuth } from '../context/AuthContext';

export default function Payments() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const { settings } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [paymentType, setPaymentType] = useState<'in' | 'out'>('in');
  const [formData, setFormData] = useState({
    referenceId: '',
    referenceName: '',
    description: '',
    amount: 0,
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = () => {
    setPayments(getPayments().reverse());
    setCustomers(getCustomers());
    setSuppliers(getSuppliers());
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ar-EG').format(amount) + ' ' + settings.currency;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.referenceId || formData.amount <= 0) {
      alert('يرجى ملء جميع الحقول المطلوبة');
      return;
    }

    const payment: Omit<Payment, 'id' | 'createdAt'> = {
      type: paymentType,
      amount: formData.amount,
      referenceId: formData.referenceId,
      referenceType: paymentType === 'in' ? 'customer' : 'supplier',
      description: formData.description,
      date: new Date().toISOString(),
      createdBy: 'current_user',
    };

    createPayment(payment);
    loadData();
    setShowModal(false);
    setFormData({ referenceId: '', referenceName: '', description: '', amount: 0 });
  };

  const filteredPayments = payments.filter(payment =>
    payment.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (paymentType === 'in'
      ? customers.find(c => c.id === payment.referenceId)?.name || ''
      : suppliers.find(s => s.id === payment.referenceId)?.name || ''
    ).toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalIn = payments.filter(p => p.type === 'in').reduce((sum, p) => sum + p.amount, 0);
  const totalOut = payments.filter(p => p.type === 'out').reduce((sum, p) => sum + p.amount, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">إدارة المدفوعات</h2>
          <p className="text-gray-500 text-sm mt-1">إجمالي {payments.length} حركة</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
        >
          <Plus size={20} />
          <span>إضافة حركة مالية</span>
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
              <ArrowDownLeft size={24} className="text-green-600" />
            </div>
            <div>
              <p className="text-gray-500 text-sm">إجمالي الوارد</p>
              <p className="text-xl font-bold text-green-600">{formatCurrency(totalIn)}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-red-100 rounded-xl flex items-center justify-center">
              <ArrowUpRight size={24} className="text-red-600" />
            </div>
            <div>
              <p className="text-gray-500 text-sm">إجمالي الصادر</p>
              <p className="text-xl font-bold text-red-600">{formatCurrency(totalOut)}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center">
              <Banknote size={24} className="text-indigo-600" />
            </div>
            <div>
              <p className="text-gray-500 text-sm">صافي الحركة</p>
              <p className="text-xl font-bold text-gray-800">{formatCurrency(totalIn - totalOut)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Type Tabs */}
      <div className="flex gap-2 bg-white rounded-xl p-2 shadow-sm border border-gray-100 w-fit">
        <button
          onClick={() => setPaymentType('in')}
          className={`px-6 py-2 rounded-lg transition-colors ${paymentType === 'in' ? 'bg-green-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
        >
          مدفوعات العملاء
        </button>
        <button
          onClick={() => setPaymentType('out')}
          className={`px-6 py-2 rounded-lg transition-colors ${paymentType === 'out' ? 'bg-red-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
        >
          مدفوعات الموردين
        </button>
      </div>

      {/* Search */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <div className="relative">
          <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="بحث..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pr-10 pl-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
          />
        </div>
      </div>

      {/* Payments Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className={paymentType === 'in' ? 'bg-green-50' : 'bg-red-50'}>
              <tr>
                <th className="px-4 py-4 text-right text-sm font-bold text-gray-700">الوصف</th>
                <th className="px-4 py-4 text-right text-sm font-bold text-gray-700">النوع</th>
                <th className="px-4 py-4 text-right text-sm font-bold text-gray-700">التاريخ</th>
                <th className="px-4 py-4 text-right text-sm font-bold text-gray-700">المبلغ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredPayments.map(payment => (
                <tr key={payment.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-4">
                    <p className="font-medium text-gray-800">{payment.description}</p>
                    <p className="text-xs text-gray-500">
                      {payment.type === 'in'
                        ? customers.find(c => c.id === payment.referenceId)?.name
                        : suppliers.find(s => s.id === payment.referenceId)?.name}
                    </p>
                  </td>
                  <td className="px-4 py-4">
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                      payment.type === 'in' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}>
                      {payment.type === 'in' ? 'وارد' : 'صادر'}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-gray-600">{new Date(payment.date).toLocaleDateString('ar-EG')}</td>
                  <td className="px-4 py-4">
                    <span className={`font-bold ${payment.type === 'in' ? 'text-green-600' : 'text-red-600'}`}>
                      {payment.type === 'in' ? '+' : '-'} {formatCurrency(payment.amount)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
            <div className={`p-6 border-b border-gray-100 ${paymentType === 'in' ? 'bg-green-600' : 'bg-red-600'} rounded-t-2xl`}>
              <h3 className="text-xl font-bold text-white">
                {paymentType === 'in' ? 'إضافة مدفوع من عميل' : 'إضافة مدفوع لمورد'}
              </h3>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {paymentType === 'in' ? 'العميل' : 'المورد'}
                </label>
                <select
                  value={formData.referenceId}
                  onChange={(e) => {
                    const ref = paymentType === 'in'
                      ? customers.find(c => c.id === e.target.value)
                      : suppliers.find(s => s.id === e.target.value);
                    setFormData({ ...formData, referenceId: e.target.value, referenceName: ref?.name || '' });
                  }}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                  required
                >
                  <option value="">اختر {paymentType === 'in' ? 'العميل' : 'المورد'}</option>
                  {(paymentType === 'in' ? customers : suppliers).map(ref => (
                    <option key={ref.id} value={ref.id}>{ref.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">المبلغ</label>
                <input
                  type="number"
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: parseFloat(e.target.value) || 0 })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">الوصف</label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                  required
                />
              </div>
              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">
                  إلغاء
                </button>
                <button type="submit" className={`flex-1 px-4 py-2 text-white rounded-lg hover:opacity-90 ${paymentType === 'in' ? 'bg-green-600' : 'bg-red-600'}`}>
                  حفظ
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
