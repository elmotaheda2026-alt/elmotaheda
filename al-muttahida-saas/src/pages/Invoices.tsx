import React, { useState, useEffect } from 'react';
import { FileText, Search, Printer, Eye } from 'lucide-react';
import { Sale, Purchase } from '../types';
import { getSales, getPurchases } from '../lib/storage';
import { useAuth } from '../context/AuthContext';

export default function Invoices() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [tab, setTab] = useState<'sales' | 'purchases'>('sales');
  const { settings } = useAuth();

  useEffect(() => {
    setSales(getSales().reverse());
    setPurchases(getPurchases().reverse());
  }, []);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ar-EG').format(amount) + ' ' + settings.currency;
  };

  const filteredSales = sales.filter(sale =>
    sale.invoiceNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
    sale.customerName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredPurchases = purchases.filter(purchase =>
    purchase.invoiceNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
    purchase.supplierName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const renderInvoicePreview = (sale: Sale) => (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl">
        <div className="p-6 border-b border-gray-100 bg-gray-50 rounded-t-2xl flex justify-between items-center">
          <h3 className="font-bold text-gray-800">فاتورة {sale.invoiceNumber}</h3>
          <button className="p-2 hover:bg-gray-200 rounded-lg">
            <Printer size={20} />
          </button>
        </div>
        <div className="p-6">
          <div className="text-center mb-6">
            <h2 className="text-2xl font-bold text-indigo-600">{settings.companyName}</h2>
            <p className="text-gray-500 text-sm">{settings.companyAddress}</p>
            <p className="text-gray-500 text-sm">{settings.companyPhone}</p>
          </div>
          <div className="grid grid-cols-2 gap-4 mb-6 p-4 bg-gray-50 rounded-lg">
            <div>
              <p className="text-sm text-gray-500">رقم الفاتورة</p>
              <p className="font-bold">{sale.invoiceNumber}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">التاريخ</p>
              <p className="font-bold">{new Date(sale.date).toLocaleDateString('ar-EG')}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">العميل</p>
              <p className="font-bold">{sale.customerName}</p>
            </div>
          </div>
          <table className="w-full mb-6">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-4 py-2 text-right text-sm">المنتج</th>
                <th className="px-4 py-2 text-center text-sm">الكمية</th>
                <th className="px-4 py-2 text-left text-sm">السعر</th>
                <th className="px-4 py-2 text-left text-sm">الإجمالي</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sale.items.map((item, i) => (
                <tr key={i}>
                  <td className="px-4 py-2">{item.productName}</td>
                  <td className="px-4 py-2 text-center">{item.quantity}</td>
                  <td className="px-4 py-2 text-left">{formatCurrency(item.unitPrice)}</td>
                  <td className="px-4 py-2 text-left">{formatCurrency(item.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="space-y-2 border-t pt-4">
            <div className="flex justify-between"><span>المجموع الفرعي</span><span>{formatCurrency(sale.subtotal)}</span></div>
            <div className="flex justify-between text-red-600"><span>الخصم</span><span>- {formatCurrency(sale.discount)}</span></div>
            <div className="flex justify-between"><span>الضريبة</span><span>{formatCurrency(sale.tax)}</span></div>
            <div className="flex justify-between font-bold text-xl text-green-600 border-t pt-2"><span>الإجمالي</span><span>{formatCurrency(sale.total)}</span></div>
          </div>
          {settings.invoiceFooter && (
            <p className="text-center text-gray-500 text-sm mt-6 pt-4 border-t">{settings.invoiceFooter}</p>
          )}
        </div>
        <div className="p-4 border-t bg-gray-50 rounded-b-2xl">
          <button onClick={() => document.querySelector('[data-preview]')?.removeAttribute('data-preview')} className="w-full px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300">
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-800">الفواتير</h2>
        <p className="text-gray-500 text-sm mt-1">عرض وطباعة الفواتير</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 bg-white rounded-xl p-2 shadow-sm border border-gray-100 w-fit">
        <button onClick={() => setTab('sales')} className={`px-6 py-2 rounded-lg transition-colors ${tab === 'sales' ? 'bg-green-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
          فواتير المبيعات ({sales.length})
        </button>
        <button onClick={() => setTab('purchases')} className={`px-6 py-2 rounded-lg transition-colors ${tab === 'purchases' ? 'bg-orange-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
          فواتير المشتريات ({purchases.length})
        </button>
      </div>

      {/* Search */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <div className="relative">
          <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="بحث..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pr-10 pl-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className={tab === 'sales' ? 'bg-green-50' : 'bg-orange-50'}>
              <tr>
                <th className="px-4 py-4 text-right text-sm font-bold text-gray-700">رقم الفاتورة</th>
                <th className="px-4 py-4 text-right text-sm font-bold text-gray-700">{tab === 'sales' ? 'العميل' : 'المورد'}</th>
                <th className="px-4 py-4 text-right text-sm font-bold text-gray-700">التاريخ</th>
                <th className="px-4 py-4 text-right text-sm font-bold text-gray-700">الإجمالي</th>
                <th className="px-4 py-4 text-right text-sm font-bold text-gray-700">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(tab === 'sales' ? filteredSales : filteredPurchases).map(invoice => (
                <tr key={invoice.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-4 font-mono font-bold text-indigo-600">{invoice.invoiceNumber}</td>
                  <td className="px-4 py-4 font-medium text-gray-800">{tab === 'sales' ? (invoice as Sale).customerName : (invoice as Purchase).supplierName}</td>
                  <td className="px-4 py-4 text-gray-600">{new Date(invoice.date).toLocaleDateString('ar-EG')}</td>
                  <td className="px-4 py-4 font-bold text-green-600">{formatCurrency(invoice.total)}</td>
                  <td className="px-4 py-4">
                    <button className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                      <Printer size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
