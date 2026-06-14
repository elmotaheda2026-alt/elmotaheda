import React, { useState, useEffect } from 'react';
import { PieChart as PieChartIcon, ArrowDownToLine, ArrowUpFromLine, Users, Plus, TrendingUp, Calculator, Wallet, Search, Edit } from 'lucide-react';
import { Shareholder, ShareholderTransaction, Sale, Purchase, Expense, Product } from '../types';
import { getShareholders, createShareholder, updateShareholder, getShareholderTransactions, addShareholderTransaction, getSales, getPurchases, getExpenses, getProducts } from '../lib/storage';
import { useAuth } from '../context/AuthContext';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend } from 'recharts';
import { formatDateDisplay } from '../lib/dateUtils';
import { calculateNetProfit } from '../lib/accounting';
import { formatWholeCurrency } from '../lib/utils';

const TypedPieChart = PieChart as any;
const TypedPie = Pie as any;
const TypedCell = Cell as any;
const TypedResponsiveContainer = ResponsiveContainer as any;
const TypedTooltip = RechartsTooltip as any;
const TypedLegend = Legend as any;

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#3b82f6', '#14b8a6'];

export default function Shareholders() {
  const { settings, user } = useAuth();
  const [shareholders, setShareholders] = useState<Shareholder[]>([]);
  const [transactions, setTransactions] = useState<ShareholderTransaction[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  
  const [activeTab, setActiveTab] = useState<'overview' | 'transactions'>('overview');
  
  // Modals state
  const [showShareholderModal, setShowShareholderModal] = useState(false);
  const [editingShareholder, setEditingShareholder] = useState<Shareholder | null>(null);
  
  const [showTransactionModal, setShowTransactionModal] = useState(false);
  const [transactionType, setTransactionType] = useState<'capital_deposit' | 'capital_withdrawal' | 'profit_withdrawal'>('capital_deposit');
  const [selectedShareholderId, setSelectedShareholderId] = useState<string>('');

  // Forms state
  const [shareholderForm, setShareholderForm] = useState({
    name: '', phone: '', sharePercentage: 0, managementFeePercentage: 50, capital: 0, notes: ''
  });
  
  const [transactionForm, setTransactionForm] = useState({
    amount: 0, description: ''
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = () => {
    setShareholders(getShareholders());
    setTransactions(getShareholderTransactions());
    setSales(getSales());
    setPurchases(getPurchases());
    setExpenses(getExpenses());
    setProducts(getProducts());
  };

  const formatCurrency = (amount: number) => formatWholeCurrency(amount, settings.currency);

  const handleShareholderSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingShareholder) {
      updateShareholder(editingShareholder.id, shareholderForm);
    } else {
      createShareholder(shareholderForm);
    }
    loadData();
    setShowShareholderModal(false);
  };

  const handleTransactionSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedShareholderId || transactionForm.amount <= 0) return;
    
    addShareholderTransaction({
      shareholderId: selectedShareholderId,
      shareholderName: shareholders.find(s => s.id === selectedShareholderId)?.name || '',
      type: transactionType,
      amount: transactionForm.amount,
      description: transactionForm.description || (
        transactionType === 'capital_deposit' ? 'إيداع رأس مال' : 
        transactionType === 'capital_withdrawal' ? 'سحب رأس مال' : 'سحب أرباح'
      ),
      createdBy: user?.name || 'النظام'
    });
    
    loadData();
    setShowTransactionModal(false);
    setTransactionForm({ amount: 0, description: '' });
  };

  // Live Financial Calculation Engine
  const systemLiveNetProfit = calculateNetProfit(sales, products, expenses);

  const totalCapital = shareholders.reduce((sum, s) => sum + s.capital, 0);
  const systemLiveRoi = totalCapital > 0 ? (systemLiveNetProfit / totalCapital) : 0;

  // Process Shareholders Live Data
  const liveShareholders = shareholders.map(s => {
    // Calculate total withdrawn profits from transactions
    const withdrawnProfits = transactions
      .filter(tx => tx.shareholderId === s.id && tx.type === 'profit_withdrawal')
      .reduce((sum, tx) => sum + tx.amount, 0);

    const grossProfit = s.capital * systemLiveRoi;
    const mgmtFee = grossProfit > 0 ? grossProfit * ((s.managementFeePercentage || 0) / 100) : 0;
    const netProfit = grossProfit > 0 ? grossProfit - mgmtFee : 0;
    
    // Available to withdraw is their all-time net profit MINUS what they already withdrew
    const availableProfit = Math.max(0, netProfit - withdrawnProfits);
    const totalNetValue = s.capital + availableProfit;

    return {
      ...s,
      grossProfit,
      mgmtFee,
      netProfit,
      withdrawnProfits,
      availableProfit,
      totalNetValue
    };
  });

  const totalAvailableProfits = liveShareholders.reduce((sum, s) => sum + s.availableProfit, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">شاشة تداول المساهمين اللحظية</h2>
          <p className="text-gray-500 text-sm mt-1">تتصل هذه الشاشة بدفاتر المبيعات لتوليد وحساب الأرباح لحظياً.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setEditingShareholder(null);
              setShareholderForm({ name: '', phone: '', sharePercentage: 0, managementFeePercentage: 50, capital: 0, notes: '' });
              setShowShareholderModal(true);
            }}
            className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
          >
            <Plus size={20} />
            <span>إضافة مساهم</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center">
              <Wallet size={24} className="text-indigo-600" />
            </div>
            <div>
              <p className="text-gray-500 text-sm">إجمالي رأس المال المكتتب</p>
              <p className="text-xl font-bold text-gray-800">{formatCurrency(totalCapital)}</p>
            </div>
          </div>
        </div>
        <div className="bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-xl p-6 shadow-sm border border-emerald-600 text-white relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-20">
            <TrendingUp size={80} />
          </div>
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-1">
              <span className="bg-white/20 px-2 py-1 rounded text-xs font-bold uppercase tracking-wider">Live</span>
              <p className="text-emerald-50 text-sm font-medium">إجمالي أرباح الشركة الحية (غير الموزعة)</p>
            </div>
            <p className="text-3xl font-black mb-1">{formatCurrency(systemLiveNetProfit)}</p>
            <p className="text-emerald-100 text-sm flex items-center gap-1 font-bold">
              معدل العائد (ROI): <span className="text-white">{(systemLiveRoi * 100).toFixed(2)}%</span>
            </p>
          </div>
        </div>
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-sky-100 rounded-xl flex items-center justify-center">
              <Wallet size={24} className="text-sky-600" />
            </div>
            <div>
              <p className="text-gray-500 text-sm">أرباح الشركاء المتاحة للسحب</p>
              <p className="text-xl font-bold text-gray-800">{formatCurrency(totalAvailableProfits)}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center">
              <Users size={24} className="text-purple-600" />
            </div>
            <div>
              <p className="text-gray-500 text-sm">عدد المساهمين</p>
              <p className="text-xl font-bold text-gray-800">{shareholders.length} مساهم</p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="flex border-b border-gray-100">
          <button
            onClick={() => setActiveTab('overview')}
            className={`flex items-center gap-2 px-6 py-4 text-sm font-semibold transition-colors ${
              activeTab === 'overview' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50/50' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <PieChartIcon size={18} />
            <span>نظرة عامة والشركاء</span>
          </button>
          <button
            onClick={() => setActiveTab('transactions')}
            className={`flex items-center gap-2 px-6 py-4 text-sm font-semibold transition-colors ${
              activeTab === 'transactions' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50/50' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <ArrowDownToLine size={18} />
            <span>سجل المعاملات</span>
          </button>
        </div>

        <div className="p-6">
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Landscape Chart Banner at the top */}
              <div className="bg-slate-50 rounded-xl p-6 border border-slate-100 flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="md:w-1/3 text-right">
                  <h3 className="text-lg font-bold text-slate-800">توزيع حصص رأس المال</h3>
                  <p className="text-xs text-slate-500 mt-1">يظهر هذا الرسم البياني نسبة مساهمة كل شريك بناءً على رأس المال الفعلي المدفوع حالياً في الشركة.</p>
                </div>
                <div className="w-full md:w-2/3 h-48">
                  <TypedResponsiveContainer width="100%" height="100%">
                    <TypedPieChart>
                      <TypedPie
                        data={shareholders}
                        cx="50%"
                        cy="50%"
                        innerRadius={45}
                        outerRadius={65}
                        paddingAngle={5}
                        dataKey="capital"
                        nameKey="name"
                      >
                        {shareholders.map((entry: any, index: number) => (
                          <TypedCell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </TypedPie>
                      <TypedTooltip formatter={(value: number) => formatCurrency(value)} />
                      <TypedLegend layout="horizontal" align="center" verticalAlign="bottom" />
                    </TypedPieChart>
                  </TypedResponsiveContainer>
                </div>
              </div>
              
              {/* Spacious 3-Column Shareholders Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {liveShareholders.map((shareholder, index) => (
                  <div key={shareholder.id} className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden">
                    {/* Live indicator dot */}
                    <div className="absolute top-4 left-4 w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                    
                    <div className="flex justify-between items-start mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold" style={{ backgroundColor: COLORS[index % COLORS.length] }}>
                          {shareholder.name.charAt(0)}
                        </div>
                        <div>
                          <h4 className="font-bold text-gray-800">{shareholder.name}</h4>
                          <p className="text-xs text-gray-500 font-medium">الربح: {shareholder.sharePercentage}% | الإدارة: {shareholder.managementFeePercentage || 0}%</p>
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          setEditingShareholder(shareholder);
                          setShareholderForm({
                            name: shareholder.name, phone: shareholder.phone, sharePercentage: shareholder.sharePercentage, managementFeePercentage: shareholder.managementFeePercentage || 50, capital: shareholder.capital, notes: shareholder.notes || ''
                          });
                          setShowShareholderModal(true);
                        }}
                        className="text-gray-400 hover:text-indigo-600 transition-colors"
                      >
                        <Edit size={16} />
                      </button>
                    </div>
                    
                    <div className="space-y-2 mb-4 bg-slate-50 p-3 rounded-lg border border-slate-100">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600 font-medium">رأس المال:</span>
                        <span className="font-bold text-gray-900">{formatCurrency(shareholder.capital)}</span>
                      </div>
                      <div className="flex justify-between text-sm border-t border-slate-200 pt-2 mt-2">
                        <span className="text-gray-500">إجمالي الربح اللحظي:</span>
                        <span className="font-bold text-slate-700">{formatCurrency(shareholder.grossProfit)}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-500">رسوم الإدارة ({shareholder.managementFeePercentage || 0}%):</span>
                        <span className="font-bold text-rose-500">-{formatCurrency(shareholder.mgmtFee)}</span>
                      </div>
                      {shareholder.withdrawnProfits > 0 && (
                        <div className="flex justify-between text-xs border-t border-slate-100 pt-1 mt-1">
                          <span className="text-gray-500">أرباح تم سحبها مسبقاً:</span>
                          <span className="font-bold text-amber-600">-{formatCurrency(shareholder.withdrawnProfits)}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-xs border-t border-slate-100 pt-1 mt-1">
                        <span className="text-gray-600 font-medium">أرباح متاحة للسحب:</span>
                        <span className="font-bold text-emerald-600">+{formatCurrency(shareholder.availableProfit)}</span>
                      </div>
                      <div className="flex justify-between text-sm border-t border-emerald-100 pt-2 mt-2 bg-emerald-50/50 -mx-3 -mb-3 p-3 rounded-b-lg">
                        <span className="text-emerald-800 font-bold">إجمالي أموال المساهم:</span>
                        <span className="font-black text-emerald-700">{formatCurrency(shareholder.totalNetValue)}</span>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-2 pt-3 border-t border-gray-50">
                      <button
                        onClick={() => {
                          setSelectedShareholderId(shareholder.id);
                          setTransactionType('capital_deposit');
                          setShowTransactionModal(true);
                        }}
                        className="flex items-center justify-center gap-1 py-1.5 bg-slate-50 hover:bg-indigo-50 text-indigo-700 rounded text-xs font-semibold transition-colors"
                      >
                        <ArrowDownToLine size={14} />
                        <span>إيداع رأسمال</span>
                      </button>
                      <button
                        onClick={() => {
                          setSelectedShareholderId(shareholder.id);
                          setTransactionType('profit_withdrawal');
                          setShowTransactionModal(true);
                        }}
                        className="flex items-center justify-center gap-1 py-1.5 bg-slate-50 hover:bg-emerald-50 text-emerald-700 rounded text-xs font-semibold transition-colors"
                      >
                        <ArrowUpFromLine size={14} />
                        <span>سحب أرباح</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'transactions' && (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 border-y border-gray-100">
                    <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">التاريخ</th>
                    <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">المساهم</th>
                    <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">نوع الحركة</th>
                    <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">المبلغ</th>
                    <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">البيان</th>
                    <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">بواسطة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {transactions.map(tx => (
                    <tr key={tx.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-4 py-3 text-sm text-gray-600">{formatDateDisplay(tx.date)}</td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-800">{tx.shareholderName}</td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          tx.type === 'capital_deposit' ? 'bg-indigo-100 text-indigo-700' :
                          tx.type === 'capital_withdrawal' ? 'bg-rose-100 text-rose-700' :
                          tx.type === 'profit_distribution' ? 'bg-emerald-100 text-emerald-700' :
                          'bg-amber-100 text-amber-700'
                        }`}>
                          {tx.type === 'capital_deposit' ? 'إيداع رأس مال' :
                           tx.type === 'capital_withdrawal' ? 'سحب رأس مال' :
                           tx.type === 'profit_distribution' ? 'توزيع أرباح' : 'سحب أرباح'}
                        </span>
                      </td>
                      <td className={`px-4 py-3 text-sm font-bold ${
                        tx.type === 'capital_deposit' || tx.type === 'profit_distribution' ? 'text-emerald-600' : 'text-rose-600'
                      }`}>
                        {formatCurrency(tx.amount)}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">{tx.description}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{tx.createdBy}</td>
                    </tr>
                  ))}
                  {transactions.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                        لا توجد حركات مسجلة بعد
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Shareholder Modal */}
      {showShareholderModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-gray-100">
              <h3 className="text-xl font-bold text-gray-800">
                {editingShareholder ? 'تعديل بيانات المساهم' : 'إضافة مساهم جديد'}
              </h3>
            </div>
            <form onSubmit={handleShareholderSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">الاسم</label>
                  <input type="text" required value={shareholderForm.name} onChange={e => setShareholderForm({...shareholderForm, name: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">الهاتف</label>
                  <input type="text" required value={shareholderForm.phone} onChange={e => setShareholderForm({...shareholderForm, phone: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">نسبة ربح المساهم %</label>
                  <input 
                    type="number" step="0.01" min="0" max="100" required 
                    value={shareholderForm.sharePercentage} 
                    onChange={e => {
                      const val = Number(e.target.value);
                      setShareholderForm({
                        ...shareholderForm, 
                        sharePercentage: val,
                        managementFeePercentage: 100 - val
                      });
                    }} 
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" 
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">نسبة ربح الشركة (الإدارة) %</label>
                  <input 
                    type="number" step="0.01" min="0" max="100" required 
                    value={shareholderForm.managementFeePercentage} 
                    onChange={e => {
                      const val = Number(e.target.value);
                      setShareholderForm({
                        ...shareholderForm, 
                        managementFeePercentage: val,
                        sharePercentage: 100 - val
                      });
                    }} 
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none bg-indigo-50" 
                  />
                </div>
              </div>
              {!editingShareholder && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">رأس المال الافتتاحي</label>
                  <input type="number" min="0" required value={shareholderForm.capital} onChange={e => setShareholderForm({...shareholderForm, capital: Number(e.target.value)})} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ملاحظات (اختياري)</label>
                <textarea value={shareholderForm.notes} onChange={e => setShareholderForm({...shareholderForm, notes: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" rows={2} />
              </div>
              <div className="flex gap-3 pt-4 border-t border-gray-50">
                <button type="button" onClick={() => setShowShareholderModal(false)} className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors">إلغاء</button>
                <button type="submit" className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">{editingShareholder ? 'حفظ التعديلات' : 'إضافة المساهم'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Transaction Modal */}
      {showTransactionModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-gray-100">
              <h3 className="text-xl font-bold text-gray-800">
                {transactionType === 'capital_deposit' ? 'إيداع رأس مال' : transactionType === 'capital_withdrawal' ? 'سحب رأس مال' : 'سحب أرباح'}
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                المساهم: <span className="font-bold text-indigo-600">{shareholders.find(s => s.id === selectedShareholderId)?.name}</span>
              </p>
            </div>
            <form onSubmit={handleTransactionSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">المبلغ</label>
                <input type="number" min="1" required value={transactionForm.amount} onChange={e => setTransactionForm({...transactionForm, amount: Number(e.target.value)})} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none text-lg font-bold text-indigo-700" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">البيان / ملاحظات</label>
                <input type="text" required value={transactionForm.description} onChange={e => setTransactionForm({...transactionForm, description: e.target.value})} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" placeholder="مثال: تحويل بنكي، شيك نقدي..." />
              </div>
              <div className="bg-amber-50 text-amber-800 p-3 rounded-lg text-xs flex items-start gap-2">
                <Wallet size={16} className="mt-0.5 shrink-0" />
                <p>إتمام هذه العملية سيقوم تلقائياً بتوليد حركة في <strong>الخزينة اليومية</strong> لضمان مطابقة الحسابات.</p>
              </div>
              <div className="flex gap-3 pt-4 border-t border-gray-50">
                <button type="button" onClick={() => setShowTransactionModal(false)} className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors">إلغاء</button>
                <button type="submit" className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">تأكيد العملية</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Distribute Profits Modal is removed in favor of Live NAV System */}
    </div>
  );
}
