import React, { useState, useEffect } from 'react';
import { FileText, Search, Download, Printer, User, Phone, Calendar, DollarSign, Users, Filter } from 'lucide-react';
import { Customer, Sale, Payment } from '../types';
import { getCustomers, getSales, getPayments } from '../lib/storage';
import { useAuth } from '../context/AuthContext';

interface CustomerStatement {
  customerId: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  totalInvoice: number;
  totalPaid: number;
  remaining: number;
  invoices: InvoiceDetail[];
}

interface InvoiceDetail {
  invoiceNumber: string;
  invoiceDate: string;
  invoiceTotal: number;
  amountPaid: number;
  remaining: number;
  dueDate?: string;
  status: 'paid' | 'partial' | 'unpaid';
}

export default function CollectionStatement() {
  const { settings } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [statements, setStatements] = useState<CustomerStatement[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showOnlyDue, setShowOnlyDue] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = () => {
    const c = getCustomers();
    const s = getSales().filter(sale => sale.status !== 'cancelled');
    const p = getPayments();
    setCustomers(c);
    setSales(s);
    setPayments(p);
    generateStatements(c, s, p);
  };

  const generateStatements = (cust: Customer[], sal: Sale[], pay: Payment[]) => {
    const filteredSales = sal.filter(s => {
      if (selectedCustomer !== 'all' && s.customerId !== selectedCustomer) return false;
      if (dateFrom && s.date < dateFrom) return false;
      if (dateTo && s.date > dateTo) return false;
      return true;
    });

    const customerStatements: CustomerStatement[] = cust.map(customer => {
      const customerSales = filteredSales.filter(s => s.customerId === customer.id);
      const customerPayments = pay.filter(p => p.referenceId === customer.id && p.type === 'in');

      const totalInvoice = customerSales.reduce((sum: number, s: Sale) => sum + s.total, 0);
      const totalPaid = customerPayments.reduce((sum: number, p: Payment) => sum + p.amount, 0);
      const remaining = totalInvoice - totalPaid;

      const invoices: InvoiceDetail[] = customerSales.map(sale => {
        const paidForThisInvoice = customerPayments
          .filter(p => p.referenceId === sale.id)
          .reduce((sum, p) => sum + p.amount, 0) || (sale.total - sale.remaining);

        let status: 'paid' | 'partial' | 'unpaid' = 'unpaid';
        if (paidForThisInvoice >= sale.total) status = 'paid';
        else if (paidForThisInvoice > 0) status = 'partial';

        return {
          invoiceNumber: sale.invoiceNumber,
          invoiceDate: sale.date,
          invoiceTotal: sale.total,
          amountPaid: paidForThisInvoice,
          remaining: sale.total - paidForThisInvoice,
          dueDate: calculateDueDate(sale.date),
          status,
        };
      });

      return {
        customerId: customer.id,
        customerName: customer.name,
        customerPhone: customer.phone,
        customerAddress: customer.address,
        totalInvoice,
        totalPaid,
        remaining,
        invoices,
      };
    }).filter(stmt => {
      if (showOnlyDue && stmt.remaining <= 0) return false;
      if (searchTerm) {
        return stmt.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
               stmt.customerPhone.includes(searchTerm);
      }
      return true;
    });

    setStatements(customerStatements.sort((a, b) => b.remaining - a.remaining));
  };

  const calculateDueDate = (invoiceDate: string): string => {
    const date = new Date(invoiceDate);
    date.setDate(date.getDate() + 30);
    return date.toISOString().split('T')[0];
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ar-EG').format(amount) + ' ' + settings.currency;
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('ar-EG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const handleFilter = () => {
    const cust = getCustomers();
    const sal = getSales().filter(s => s.status !== 'cancelled');
    const pay = getPayments();
    generateStatements(cust, sal, pay);
  };

  const totalDue = statements.reduce((sum, s) => sum + s.remaining, 0);
  const totalCustomers = statements.filter(s => s.remaining > 0).length;

  const handlePrint = () => {
    window.print();
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'paid':
        return <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs">مدفوع</span>;
      case 'partial':
        return <span className="px-2 py-1 bg-yellow-100 text-yellow-700 rounded-full text-xs">جزئي</span>;
      default:
        return <span className="px-2 py-1 bg-red-100 text-red-700 rounded-full text-xs">غير مدفوع</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">كشف التحصيل</h2>
          <p className="text-gray-500 text-sm mt-1">كشف بأسماء العملاء المستحقين مبالغهم</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors no-print"
          >
            <Printer size={20} />
            <span>طباعة</span>
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gradient-to-br from-red-500 to-red-600 rounded-xl p-6 text-white shadow-lg">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
              <DollarSign size={24} />
            </div>
            <div>
              <p className="text-white/80 text-sm">إجمالي المستحق</p>
              <p className="text-2xl font-bold">{formatCurrency(totalDue)}</p>
            </div>
          </div>
        </div>
        <div className="bg-gradient-to-br from-orange-500 to-orange-600 rounded-xl p-6 text-white shadow-lg">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
              <Users size={24} />
            </div>
            <div>
              <p className="text-white/80 text-sm">عدد العملاء المستحقين</p>
              <p className="text-2xl font-bold">{totalCustomers}</p>
            </div>
          </div>
        </div>
        <div className="bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-xl p-6 text-white shadow-lg">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
              <FileText size={24} />
            </div>
            <div>
              <p className="text-white/80 text-sm">إجمالي الفواتير</p>
              <p className="text-2xl font-bold">{statements.reduce((sum, s) => sum + s.invoices.length, 0)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 no-print">
        <div className="flex items-center gap-4 mb-4">
          <Filter size={20} className="text-gray-500" />
          <h3 className="font-bold text-gray-800">تصفية النتائج</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">العميل</label>
            <select
              value={selectedCustomer}
              onChange={(e) => {
                setSelectedCustomer(e.target.value);
                setTimeout(handleFilter, 100);
              }}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            >
              <option value="all">جميع العملاء</option>
              {customers.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">من تاريخ</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">إلى تاريخ</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">بحث</label>
            <div className="relative">
              <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="اسم العميل أو الهاتف..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pr-10 pl-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
              />
            </div>
          </div>
          <div className="flex items-end">
            <button
              onClick={handleFilter}
              className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
            >
              تطبيق الفلتر
            </button>
          </div>
        </div>
        <div className="mt-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showOnlyDue}
              onChange={(e) => {
                setShowOnlyDue(e.target.checked);
                setTimeout(handleFilter, 100);
              }}
              className="w-5 h-5 text-indigo-600 rounded focus:ring-indigo-500"
            />
            <span className="text-sm text-gray-700">عرض العملاء الذين عليهم مبالغ فقط</span>
          </label>
        </div>
      </div>

      {/* Report Content */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden" id="printableArea">
        {/* Report Header */}
        <div className="p-6 border-b border-gray-200 bg-gray-50">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-xl font-bold text-gray-800">{settings.companyName}</h1>
              <p className="text-gray-500 text-sm">{settings.companyAddress}</p>
              <p className="text-gray-500 text-sm">ت: {settings.companyPhone}</p>
            </div>
            <div className="text-left">
              <h2 className="text-lg font-bold text-indigo-600">كشف تحصيل</h2>
              <p className="text-gray-500 text-sm">تاريخ التقرير: {new Date().toLocaleDateString('ar-EG')}</p>
              {selectedCustomer !== 'all' && (
                <p className="text-gray-500 text-sm">
                  عميل: {customers.find(c => c.id === selectedCustomer)?.name}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Statements List */}
        <div className="divide-y divide-gray-100">
          {statements.length === 0 ? (
            <div className="p-12 text-center">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <FileText size={32} className="text-gray-400" />
              </div>
              <p className="text-gray-500">لا توجد نتائج</p>
            </div>
          ) : (
            statements.map(statement => (
              <div key={statement.customerId} className="p-6">
                {/* Customer Header */}
                <div className="flex flex-wrap justify-between items-start gap-4 mb-4 pb-4 border-b border-gray-200">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center">
                      <User size={24} className="text-indigo-600" />
                    </div>
                    <div>
                      <h3 className="font-bold text-gray-800 text-lg">{statement.customerName}</h3>
                      <div className="flex items-center gap-4 text-sm text-gray-500">
                        <span className="flex items-center gap-1">
                          <Phone size={14} />
                          {statement.customerPhone}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="text-left">
                    <div className="flex gap-4">
                      <div>
                        <p className="text-xs text-gray-500">إجمالي الفواتير</p>
                        <p className="font-bold text-gray-800">{formatCurrency(statement.totalInvoice)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">المدفوع</p>
                        <p className="font-bold text-green-600">{formatCurrency(statement.totalPaid)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">الباقي</p>
                        <p className={`font-bold ${statement.remaining > 0 ? 'text-red-600' : 'text-green-600'}`}>
                          {formatCurrency(statement.remaining)}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Invoices Table */}
                {statement.invoices.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-right text-xs font-bold text-gray-700">رقم الفاتورة</th>
                          <th className="px-4 py-3 text-right text-xs font-bold text-gray-700">تاريخ الفاتورة</th>
                          <th className="px-4 py-3 text-right text-xs font-bold text-gray-700">تاريخ الاستحقاق</th>
                          <th className="px-4 py-3 text-right text-xs font-bold text-gray-700">مبلغ الفاتورة</th>
                          <th className="px-4 py-3 text-right text-xs font-bold text-gray-700">المدفوع</th>
                          <th className="px-4 py-3 text-right text-xs font-bold text-gray-700">الباقي</th>
                          <th className="px-4 py-3 text-right text-xs font-bold text-gray-700">الحالة</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {statement.invoices.map((invoice, idx) => (
                          <tr key={idx} className="hover:bg-gray-50">
                            <td className="px-4 py-3 font-mono text-sm text-indigo-600">{invoice.invoiceNumber}</td>
                            <td className="px-4 py-3 text-sm text-gray-600">{formatDate(invoice.invoiceDate)}</td>
                            <td className="px-4 py-3 text-sm text-gray-600">{invoice.dueDate ? formatDate(invoice.dueDate) : '-'}</td>
                            <td className="px-4 py-3 text-sm font-medium text-gray-800">{formatCurrency(invoice.invoiceTotal)}</td>
                            <td className="px-4 py-3 text-sm font-medium text-green-600">{formatCurrency(invoice.amountPaid)}</td>
                            <td className="px-4 py-3 text-sm font-bold text-red-600">{formatCurrency(invoice.remaining)}</td>
                            <td className="px-4 py-3">{getStatusBadge(invoice.status)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Customer Total */}
                <div className="mt-4 pt-4 border-t border-gray-200 flex justify-end">
                  <div className="bg-gray-50 px-6 py-3 rounded-lg">
                    <span className="text-gray-600">إجمالي الباقي للعميل: </span>
                    <span className={`font-bold text-lg ${statement.remaining > 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {formatCurrency(statement.remaining)}
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Report Footer */}
        <div className="p-6 border-t border-gray-200 bg-gray-50">
          <div className="flex justify-between items-center">
            <div>
              <p className="text-sm text-gray-500">
                إجمالي المستحق: <span className="font-bold text-red-600">{formatCurrency(totalDue)}</span>
              </p>
              <p className="text-sm text-gray-500">
                عدد العملاء: <span className="font-bold">{totalCustomers}</span>
              </p>
            </div>
            {settings.invoiceFooter && (
              <p className="text-sm text-gray-500">{settings.invoiceFooter}</p>
            )}
          </div>
        </div>
      </div>

      {/* Print Styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          .shadow-sm, .shadow-lg { box-shadow: none !important; }
          .border { border: 1px solid #ddd !important; }
          .bg-gray-50, .bg-gray-100 { background: #f5f5f5 !important; }
          @page { margin: 1cm; }
        }
      `}</style>
    </div>
  );
}
