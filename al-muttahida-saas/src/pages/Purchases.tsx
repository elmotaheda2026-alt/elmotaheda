import React, { useState, useEffect } from 'react';
import { Plus, Search, ShoppingCart, Trash2, Printer } from 'lucide-react';
import { Purchase, PurchaseItem, Supplier, Product } from '../types';
import { getPurchases, createPurchase, getSuppliers, getProducts } from '../lib/storage';
import { useAuth } from '../context/AuthContext';
import { formatDateDisplay } from '../lib/dateUtils';
import { calculateDocumentTotals, calculateLineTotal } from '../lib/accounting';
import { formatWholeCurrency } from '../lib/utils';

export default function Purchases() {
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const { settings } = useAuth();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [formData, setFormData] = useState({
    supplierId: '',
    supplierName: '',
    notes: '',
  });
  const [purchaseItems, setPurchaseItems] = useState<PurchaseItem[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = () => {
    setPurchases(getPurchases().reverse());
    setSuppliers(getSuppliers());
    setProducts(getProducts());
  };

  const formatCurrency = (amount: number) => formatWholeCurrency(amount, settings.currency);

  const calculateTotals = () => {
    const totals = calculateDocumentTotals(purchaseItems);
    return { subtotal: totals.subtotal, totalDiscount: totals.discount, totalTax: totals.tax, total: totals.total };
  };

  const addItem = (product: Product) => {
    const existingItem = purchaseItems.find(item => item.productId === product.id);
    if (existingItem) {
      setPurchaseItems(purchaseItems.map(item =>
        item.productId === product.id
          ? { ...item, quantity: item.quantity + 1, total: calculateLineTotal(item.quantity + 1, item.unitPrice, item.discount, item.tax) }
          : item
      ));
    } else {
      const purchaseTax = 0;
      const newItem: PurchaseItem = {
        productId: product.id,
        productName: product.name,
        barcode: product.barcode,
        quantity: 1,
        unitPrice: product.purchasePrice,
        discount: product.discount,
        tax: purchaseTax,
        total: calculateLineTotal(1, product.purchasePrice, product.discount, purchaseTax),
      };
      setPurchaseItems([...purchaseItems, newItem]);
    }
  };

  const updateItemQuantity = (productId: string, quantity: number) => {
    if (quantity <= 0) {
      removeItem(productId);
      return;
    }
    setPurchaseItems(purchaseItems.map(item => {
      if (item.productId === productId) {
        return {
          ...item,
          quantity,
          total: calculateLineTotal(quantity, item.unitPrice, item.discount, item.tax),
        };
      }
      return item;
    }));
  };

  const removeItem = (productId: string) => {
    setPurchaseItems(purchaseItems.filter(item => item.productId !== productId));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (purchaseItems.length === 0) {
      alert('يرجى إضافة منتجات للشراء');
      return;
    }
    if (!formData.supplierId) {
      alert('يرجى اختيار المورد');
      return;
    }

    const totals = calculateTotals();
    const purchase: Omit<Purchase, 'id' | 'invoiceNumber' | 'createdAt'> = {
      supplierId: formData.supplierId,
      supplierName: formData.supplierName,
      items: purchaseItems,
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

    createPurchase(purchase);
    loadData();
    setShowModal(false);
    setPurchaseItems([]);
    setFormData({ supplierId: '', supplierName: '', notes: '' });
  };

  const filteredPurchases = purchases.filter(purchase =>
    purchase.invoiceNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
    purchase.supplierName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">المشتريات</h2>
          <p className="text-gray-500 text-sm mt-1">إجمالي {purchases.length} فاتورة</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
        >
          <Plus size={20} />
          <span>إضافة عملية شراء</span>
        </button>
      </div>

      {/* Search */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <div className="relative">
          <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="بحث برقم الفاتورة أو اسم المورد..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pr-10 pl-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
          />
        </div>
      </div>

      {/* Purchases Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-orange-50">
              <tr>
                <th className="px-4 py-4 text-right text-sm font-bold text-gray-700">رقم الفاتورة</th>
                <th className="px-4 py-4 text-right text-sm font-bold text-gray-700">المورد</th>
                <th className="px-4 py-4 text-right text-sm font-bold text-gray-700">التاريخ</th>
                <th className="px-4 py-4 text-right text-sm font-bold text-gray-700">الإجمالي</th>
                <th className="px-4 py-4 text-right text-sm font-bold text-gray-700">الحالة</th>
                <th className="px-4 py-4 text-right text-sm font-bold text-gray-700">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredPurchases.map(purchase => (
                <tr key={purchase.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-4 font-mono font-bold text-indigo-600">{purchase.invoiceNumber}</td>
                  <td className="px-4 py-4 font-medium text-gray-800">{purchase.supplierName}</td>
                  <td className="px-4 py-4 text-gray-600">{formatDateDisplay(purchase.date)}</td>
                  <td className="px-4 py-4 font-bold text-orange-600">{formatCurrency(purchase.total)}</td>
                  <td className="px-4 py-4">
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                      purchase.status === 'completed' ? 'bg-green-100 text-green-700' :
                      purchase.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-red-100 text-red-700'
                    }`}>
                      {purchase.status === 'completed' ? 'مكتمل' : purchase.status === 'pending' ? 'معلق' : 'ملغي'}
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

      {/* Purchase Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl w-full max-w-5xl shadow-2xl my-8">
            <div className="p-6 border-b border-gray-100 bg-gradient-to-r from-orange-600 to-amber-600 rounded-t-2xl">
              <h3 className="text-xl font-bold text-white">إضافة عملية شراء جديدة</h3>
            </div>
            <form onSubmit={handleSubmit} className="p-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left: Products */}
                <div>
                  <h4 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                    <ShoppingCart size={20} className="text-orange-600" />
                    المنتجات
                  </h4>
                  <div className="grid grid-cols-2 gap-3 max-h-96 overflow-y-auto">
                    {products.map(product => (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => addItem(product)}
                        className="p-3 border border-gray-200 rounded-lg hover:border-orange-500 hover:bg-orange-50 transition-all text-right"
                      >
                        <p className="font-medium text-gray-800 text-sm">{product.name}</p>
                        <p className="text-xs text-gray-500">{product.barcode}</p>
                        <p className="text-orange-600 font-bold mt-1">{formatCurrency(product.purchasePrice)}</p>
                        <p className="text-xs text-gray-400">المخزون: {product.quantity}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Right: Purchase Details */}
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">المورد</label>
                    <select
                      value={formData.supplierId}
                      onChange={(e) => {
                        const supplier = suppliers.find(s => s.id === e.target.value);
                        setFormData({ ...formData, supplierId: e.target.value, supplierName: supplier?.name || '' });
                      }}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none"
                      required
                    >
                      <option value="">اختر المورد</option>
                      {suppliers.map(supplier => (
                        <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <h4 className="font-bold text-gray-800 mb-2">المنتجات المختارة</h4>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {purchaseItems.map(item => (
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
                          <span className="font-bold text-orange-600 w-20 text-left">{formatCurrency(item.total)}</span>
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
                    <div className="flex justify-between font-bold text-xl text-orange-600 pt-2 border-t">
                      <span>الإجمالي</span>
                      <span>{formatCurrency(calculateTotals().total)}</span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">ملاحظات</label>
                    <textarea
                      value={formData.notes}
                      onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none"
                      rows={2}
                    />
                  </div>

                  <div className="flex gap-3 pt-4">
                    <button type="button" onClick={() => { setShowModal(false); setPurchaseItems([]); }} className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">
                      إلغاء
                    </button>
                    <button type="submit" className="flex-1 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700">
                      حفظ الشراء
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
