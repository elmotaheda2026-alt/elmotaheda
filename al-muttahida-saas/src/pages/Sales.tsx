import React, { useState, useEffect } from 'react';
import { Plus, Search, ShoppingBag, Trash2, Printer } from 'lucide-react';
import { Sale, SaleItem, Customer, Product } from '../types';
import { getSales, createSale, getCustomers, getProducts } from '../lib/storage';
import { useAuth } from '../context/AuthContext';

export default function Sales() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const { settings } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [formData, setFormData] = useState({
    customerId: '',
    customerName: '',
    notes: '',
  });
  const [saleItems, setSaleItems] = useState<SaleItem[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = () => {
    setSales(getSales().reverse());
    setCustomers(getCustomers());
    setProducts(getProducts());
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ar-EG').format(amount) + ' ' + settings.currency;
  };

  const calculateTotals = () => {
    const subtotal = saleItems.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
    const totalDiscount = saleItems.reduce((sum, item) => sum + (item.discount * item.quantity), 0);
    const totalTax = saleItems.reduce((sum, item) => sum + (item.tax * item.quantity), 0);
    const total = subtotal - totalDiscount + totalTax;
    return { subtotal, totalDiscount, totalTax, total };
  };

  const addItem = (product: Product) => {
    const existingItem = saleItems.find(item => item.productId === product.id);
    if (existingItem) {
      setSaleItems(saleItems.map(item =>
        item.productId === product.id
          ? { ...item, quantity: item.quantity + 1, total: (item.quantity + 1) * item.unitPrice - (item.quantity + 1) * item.discount + (item.quantity + 1) * item.tax }
          : item
      ));
    } else {
      const newItem: SaleItem = {
        productId: product.id,
        productName: product.name,
        barcode: product.barcode,
        quantity: 1,
        unitPrice: product.salePrice,
        discount: product.discount,
        tax: (product.salePrice - product.discount) * (product.tax / 100),
        total: product.salePrice - product.discount + (product.salePrice - product.discount) * (product.tax / 100),
      };
      setSaleItems([...saleItems, newItem]);
    }
  };

  const updateItemQuantity = (productId: string, quantity: number) => {
    if (quantity <= 0) {
      removeItem(productId);
      return;
    }
    setSaleItems(saleItems.map(item => {
      if (item.productId === productId) {
        return {
          ...item,
          quantity,
          total: quantity * item.unitPrice - quantity * item.discount + quantity * item.tax,
        };
      }
      return item;
    }));
  };

  const removeItem = (productId: string) => {
    setSaleItems(saleItems.filter(item => item.productId !== productId));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (saleItems.length === 0) {
      alert('يرجى إضافة منتجات للبيع');
      return;
    }
    if (!formData.customerId) {
      alert('يرجى اختيار عميل');
      return;
    }

    const totals = calculateTotals();
    const sale: Omit<Sale, 'id' | 'invoiceNumber' | 'createdAt'> = {
      customerId: formData.customerId,
      customerName: formData.customerName,
      items: saleItems,
      subtotal: totals.subtotal,
      discount: totals.totalDiscount,
      tax: totals.totalTax,
      total: totals.total,
      paid: 0,
      remaining: totals.total,
      status: 'pending',
      date: new Date().toISOString(),
      notes: formData.notes,
      createdBy: 'current_user',
    };

    createSale(sale);
    loadData();
    setShowModal(false);
    setSaleItems([]);
    setFormData({ customerId: '', customerName: '', notes: '' });
  };

  const filteredSales = sales.filter(sale =>
    sale.invoiceNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
    sale.customerName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">المبيعات</h2>
          <p className="text-gray-500 text-sm mt-1">إجمالي {sales.length} فاتورة</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
        >
          <Plus size={20} />
          <span>إضافة عملية بيع</span>
        </button>
      </div>

      {/* Search */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <div className="relative">
          <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="بحث برقم الفاتورة أو اسم العميل..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pr-10 pl-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
          />
        </div>
      </div>

      {/* Sales Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-green-50">
              <tr>
                <th className="px-4 py-4 text-right text-sm font-bold text-gray-700">رقم الفاتورة</th>
                <th className="px-4 py-4 text-right text-sm font-bold text-gray-700">العميل</th>
                <th className="px-4 py-4 text-right text-sm font-bold text-gray-700">التاريخ</th>
                <th className="px-4 py-4 text-right text-sm font-bold text-gray-700">الإجمالي</th>
                <th className="px-4 py-4 text-right text-sm font-bold text-gray-700">الحالة</th>
                <th className="px-4 py-4 text-right text-sm font-bold text-gray-700">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredSales.map(sale => (
                <tr key={sale.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-4 font-mono font-bold text-indigo-600">{sale.invoiceNumber}</td>
                  <td className="px-4 py-4 font-medium text-gray-800">{sale.customerName}</td>
                  <td className="px-4 py-4 text-gray-600">{new Date(sale.date).toLocaleDateString('ar-EG')}</td>
                  <td className="px-4 py-4 font-bold text-green-600">{formatCurrency(sale.total)}</td>
                  <td className="px-4 py-4">
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                      sale.status === 'completed' ? 'bg-green-100 text-green-700' :
                      sale.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-red-100 text-red-700'
                    }`}>
                      {sale.status === 'completed' ? 'مكتمل' : sale.status === 'pending' ? 'معلق' : 'ملغي'}
                    </span>
                  </td>
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

      {/* Sale Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl w-full max-w-5xl shadow-2xl my-8">
            <div className="p-6 border-b border-gray-100 bg-gradient-to-r from-green-600 to-emerald-600 rounded-t-2xl">
              <h3 className="text-xl font-bold text-white">إضافة عملية بيع جديدة</h3>
            </div>
            <form onSubmit={handleSubmit} className="p-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left: Products */}
                <div>
                  <h4 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                    <ShoppingBag size={20} className="text-green-600" />
                    المنتجات
                  </h4>
                  <div className="grid grid-cols-2 gap-3 max-h-96 overflow-y-auto">
                    {products.map(product => (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => addItem(product)}
                        className="p-3 border border-gray-200 rounded-lg hover:border-green-500 hover:bg-green-50 transition-all text-right"
                      >
                        <p className="font-medium text-gray-800 text-sm">{product.name}</p>
                        <p className="text-xs text-gray-500">{product.barcode}</p>
                        <p className="text-green-600 font-bold mt-1">{formatCurrency(product.salePrice)}</p>
                        <p className="text-xs text-gray-400">المخزون: {product.quantity}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Right: Sale Details */}
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">العميل</label>
                    <select
                      value={formData.customerId}
                      onChange={(e) => {
                        const customer = customers.find(c => c.id === e.target.value);
                        setFormData({ ...formData, customerId: e.target.value, customerName: customer?.name || '' });
                      }}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                      required
                    >
                      <option value="">اختر العميل</option>
                      {customers.map(customer => (
                        <option key={customer.id} value={customer.id}>{customer.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <h4 className="font-bold text-gray-800 mb-2">المنتجات المختارة</h4>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {saleItems.map(item => (
                        <div key={item.productId} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                          <div className="flex-1">
                            <p className="font-medium text-gray-800 text-sm">{item.productName}</p>
                            <p className="text-xs text-gray-500">{formatCurrency(item.unitPrice)}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <button type="button" onClick={() => updateItemQuantity(item.productId, item.quantity - 1)} className="w-8 h-8 bg-gray-200 rounded">-</button>
                            <span className="w-8 text-center">{item.quantity}</span>
                            <button type="button" onClick={() => updateItemQuantity(item.productId, item.quantity + 1)} className="w-8 h-8 bg-gray-200 rounded">+</button>
                          </div>
                          <button type="button" onClick={() => removeItem(item.productId)} className="p-1 text-red-600 hover:bg-red-50 rounded">
                            <Trash2 size={16} />
                          </button>
                          <span className="font-bold text-green-600 w-20 text-left">{formatCurrency(item.total)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="border-t pt-4 space-y-2">
                    <div className="flex justify-between text-gray-600">
                      <span>المجموع الفرعي</span>
                      <span>{formatCurrency(calculateTotals().subtotal)}</span>
                    </div>
                    <div className="flex justify-between text-red-600">
                      <span>الخصم</span>
                      <span>- {formatCurrency(calculateTotals().totalDiscount)}</span>
                    </div>
                    <div className="flex justify-between text-gray-600">
                      <span>الضريبة</span>
                      <span>{formatCurrency(calculateTotals().totalTax)}</span>
                    </div>
                    <div className="flex justify-between font-bold text-xl text-green-600 pt-2 border-t">
                      <span>الإجمالي</span>
                      <span>{formatCurrency(calculateTotals().total)}</span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">ملاحظات</label>
                    <textarea
                      value={formData.notes}
                      onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                      rows={2}
                    />
                  </div>

                  <div className="flex gap-3 pt-4">
                    <button type="button" onClick={() => { setShowModal(false); setSaleItems([]); }} className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">
                      إلغاء
                    </button>
                    <button type="submit" className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">
                      حفظ البيع
                    </button>
                  </div>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
