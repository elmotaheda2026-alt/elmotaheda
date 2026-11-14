import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Printer,
  RefreshCw,
  Search,
  DollarSign,
  ShoppingCart,
  FileText,
  Truck,
  ChevronDown,
  ChevronUp,
  Package,
  ArrowDownLeft,
  Phone,
  MapPin,
  Send,
  Scale,
} from 'lucide-react';
import { Supplier, SupplierStatement } from '../types';
import { getSupplierStatement } from '../lib/storage';
import { useAuth } from '../context/AuthContext';
import { useDialog } from '../context/DialogContext';
import { formatWholeCurrency } from '../lib/utils';
import { formatDateDisplay, today } from '../lib/dateUtils';
import { api, isApiMode } from '../lib/apiClient';
import { createPayment } from '../lib/storage/payments';
import { DatePicker } from './DatePicker';

interface SupplierStatementModalProps {
  supplier: Supplier | null;
  isOpen: boolean;
  onClose: () => void;
  onBalanceUpdated?: () => void;
}

export default function SupplierStatementModal({
  supplier,
  isOpen,
  onClose,
  onBalanceUpdated,
}: SupplierStatementModalProps) {
  const { settings, user } = useAuth();
  const { showToast } = useDialog();

  const [loading, setLoading] = useState<boolean>(true);
  const [statement, setStatement] = useState<SupplierStatement | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'purchases' | 'payments'>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [expandedInvoiceIds, setExpandedInvoiceIds] = useState<Set<string>>(new Set());

  // Quick Inline Payment State (Drawer inside modal, zero z-index conflicts)
  const [showPayDrawer, setShowPayDrawer] = useState<boolean>(false);
  const [payAmount, setPayAmount] = useState<number | ''>('');
  const [payDate, setPayDate] = useState<string>(today());
  const [payNotes, setPayNotes] = useState<string>('');
  const [submittingPayment, setSubmittingPayment] = useState<boolean>(false);

  useEffect(() => {
    if (isOpen && supplier) {
      loadStatement();
      setSearchQuery('');
      setTypeFilter('all');
      setStartDate('');
      setEndDate('');
      setExpandedInvoiceIds(new Set());
      setShowPayDrawer(false);
    } else {
      setStatement(null);
    }
  }, [isOpen, supplier?.id]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        if (showPayDrawer) {
          setShowPayDrawer(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, showPayDrawer, onClose]);

  const loadStatement = async () => {
    if (!supplier) return;
    try {
      setLoading(true);
      const data = await getSupplierStatement(supplier.id);
      setStatement(data);
    } catch (err: any) {
      showToast(err.message || 'فشل تحميل كشف حساب المورد', 'error');
    } finally {
      setLoading(false);
    }
  };

  const toggleInvoiceItems = (id: string) => {
    setExpandedInvoiceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const formatCurrency = (amt: number) => formatWholeCurrency(amt, settings?.currency || 'ج.م');

  // Filter transactions
  const filteredTransactions = useMemo(() => {
    if (!statement?.transactions) return [];

    return statement.transactions.filter((tx) => {
      // Type filter
      if (typeFilter === 'purchases' && tx.type !== 'purchase') return false;
      if (typeFilter === 'payments' && tx.type !== 'payment_out' && tx.type !== 'payment_in' && tx.type !== 'purchase_downpayment') return false;

      // Date range filter
      if (startDate && tx.rawDate && tx.rawDate.slice(0, 10) < startDate) return false;
      if (endDate && tx.rawDate && tx.rawDate.slice(0, 10) > endDate) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const doc = (tx.docNumber || '').toLowerCase();
        const desc = (tx.description || '').toLowerCase();
        const typeL = (tx.typeLabel || '').toLowerCase();
        const itemsMatch = tx.items?.some((it) => it.productName.toLowerCase().includes(q) || (it.barcode && it.barcode.includes(q)));
        if (!doc.includes(q) && !desc.includes(q) && !typeL.includes(q) && !itemsMatch) {
          return false;
        }
      }

      return true;
    });
  }, [statement?.transactions, typeFilter, startDate, endDate, searchQuery]);

  // Handle Quick Payment
  const handleSubmitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplier || !payAmount || Number(payAmount) <= 0) {
      showToast('يرجى إدخال مبلغ صحيح لسداد دفعة المورد', 'warning');
      return;
    }

    try {
      setSubmittingPayment(true);
      const amountNum = Number(payAmount);

      if (isApiMode()) {
        await api.createPayment({
          type: 'out',
          supplierId: supplier.id,
          amount: amountNum,
          description: payNotes.trim() || `سداد دفعة للمورد: ${supplier.name}`,
          date: payDate,
          channel: 'cash',
        });
      } else {
        createPayment({
          type: 'out',
          amount: amountNum,
          referenceId: supplier.id,
          referenceType: 'supplier',
          description: payNotes.trim() || `سداد دفعة للمورد: ${supplier.name}`,
          date: payDate,
          createdBy: user?.name || 'مدير النظام',
          supplierId: supplier.id,
        });
      }

      showToast(`تم تسجيل سداد دفعة بقيمة ${formatCurrency(amountNum)} للمورد بنجاح`, 'success');
      setShowPayDrawer(false);
      await loadStatement();
      if (onBalanceUpdated) {
        onBalanceUpdated();
      }
    } catch (err: any) {
      showToast(err.message || 'فشل تسجيل الدفعة', 'error');
    } finally {
      setSubmittingPayment(false);
    }
  };

  // Generate & Print Formal Account Statement Sheet (كشف حساب رسمي)
  const handlePrintStatement = () => {
    if (!supplier) return;

    const printWin = window.open('', '_blank', 'width=900,height=800');
    if (!printWin) {
      showToast('يرجى السماح بالنوافذ المنبثقة لطباعة كشف الحساب', 'warning');
      return;
    }

    const companyName = settings?.companyName || 'شركة المتحدة لتجارة وتوزيع البضائع';
    const companyPhone = settings?.companyPhone || '';
    const companyAddress = settings?.companyAddress || '';
    const printDate = new Date().toLocaleDateString('ar-EG');
    const printTime = new Date().toLocaleTimeString('ar-EG');
    const currencyStr = settings?.currency || 'ج.م';

    const periodLabel = startDate || endDate
      ? `الفترة: من ${startDate ? formatDateDisplay(startDate) : 'البداية'} إلى ${endDate ? formatDateDisplay(endDate) : 'الآن'}`
      : 'كشف حساب شامل لجميع الحركات';

    let rowsHtml = '';
    filteredTransactions.forEach((tx, idx) => {
      const typeLabel = tx.type === 'purchase'
        ? 'فاتورة مشتريات'
        : tx.type === 'payment_out' || tx.type === 'purchase_downpayment'
          ? 'سداد دفعة'
          : 'الرصيد';

      const docNumber = tx.docNumber && tx.docNumber !== '—' ? tx.docNumber : '-';
      const creditStr = tx.credit > 0 ? `+${formatWholeCurrency(tx.credit, currencyStr)}` : '-';
      const debitStr = tx.debit > 0 ? `-${formatWholeCurrency(tx.debit, currencyStr)}` : '-';
      const balanceStr = formatWholeCurrency(tx.runningBalance, currencyStr);

      let itemsHtml = '';
      if (tx.items && tx.items.length > 0) {
        const itemRows = tx.items.map((it) => `
          <tr style="background:#f8fafc; font-size:10px; color:#475569;">
            <td style="padding:3px 6px; border:1px solid #e2e8f0; text-align:right;">${it.productName}</td>
            <td style="padding:3px 6px; border:1px solid #e2e8f0; text-align:center;">${it.quantity}</td>
            <td style="padding:3px 6px; border:1px solid #e2e8f0; text-align:center;">${formatWholeCurrency(it.unitPrice, currencyStr)}</td>
            <td style="padding:3px 6px; border:1px solid #e2e8f0; text-align:center;">${formatWholeCurrency(it.total, currencyStr)}</td>
          </tr>
        `).join('');

        itemsHtml = `
          <table style="width:100%; border-collapse:collapse; margin-top:4px;">
            <tr style="background:#f1f5f9; font-size:10px; font-weight:bold;">
              <td style="padding:2px 6px; border:1px solid #cbd5e1; text-align:right;">الصنف</td>
              <td style="padding:2px 6px; border:1px solid #cbd5e1; text-align:center; width:40px;">الكمية</td>
              <td style="padding:2px 6px; border:1px solid #cbd5e1; text-align:center; width:70px;">السعر</td>
              <td style="padding:2px 6px; border:1px solid #cbd5e1; text-align:center; width:80px;">الإجمالي</td>
            </tr>
            ${itemRows}
          </table>
        `;
      }

      rowsHtml += `
        <tr style="border-bottom:1px solid #e2e8f0; ${idx % 2 === 1 ? 'background:#fbfcfe;' : ''}">
          <td style="padding:6px; text-align:center; font-family:monospace; font-size:11px;">${idx + 1}</td>
          <td style="padding:6px; text-align:center; font-family:monospace; font-size:11px; font-weight:bold;">${formatDateDisplay(tx.rawDate || tx.date)}</td>
          <td style="padding:6px; text-align:center; font-size:11px; font-weight:bold;">${typeLabel} (${docNumber})</td>
          <td style="padding:6px; text-align:right; font-size:11px;">
            ${tx.type === 'opening_balance' ? 'الرصيد السابق للمورد' : tx.description}
            ${itemsHtml}
          </td>
          <td style="padding:6px; text-align:center; font-family:monospace; font-weight:bold; color:#1e1b4b; font-size:11px; background:#faf5ff;">${creditStr}</td>
          <td style="padding:6px; text-align:center; font-family:monospace; font-weight:bold; color:#065f46; font-size:11px; background:#f0fdf4;">${debitStr}</td>
          <td style="padding:6px; text-align:center; font-family:monospace; font-weight:900; font-size:12px; background:#f8fafc;">${balanceStr}</td>
        </tr>
      `;
    });

    const totalPurchasesFormatted = formatWholeCurrency(statement?.summary?.totalPurchasesAmount ?? 0, currencyStr);
    const totalPaidFormatted = formatWholeCurrency(statement?.summary?.totalPaymentsAmount ?? 0, currencyStr);
    const currentBalanceFormatted = formatWholeCurrency(currentBal, currencyStr);

    const htmlContent = `
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="utf-8" />
        <title>كشف حساب مورد - ${supplier.name}</title>
        <style>
          @page { size: A4; margin: 12mm 10mm; }
          body {
            font-family: 'Segoe UI', Tahoma, Arial, sans-serif;
            color: #0f172a;
            margin: 0;
            padding: 0;
            direction: rtl;
            background: #fff;
          }
          .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            border-bottom: 2px solid #0f172a;
            padding-bottom: 10px;
            margin-bottom: 12px;
          }
          .title {
            text-align: center;
            margin: 4px 0 12px 0;
            font-size: 18px;
            font-weight: 900;
            color: #1e3a8a;
            border: 1.5px solid #1e3a8a;
            padding: 6px;
            border-radius: 8px;
            background: #f8fafc;
          }
          .meta-box {
            display: flex;
            justify-content: space-between;
            background: #f1f5f9;
            border: 1px solid #cbd5e1;
            border-radius: 8px;
            padding: 8px 14px;
            margin-bottom: 12px;
            font-size: 12px;
          }
          .summary-cards {
            display: flex;
            gap: 10px;
            margin-bottom: 14px;
          }
          .summary-card {
            flex: 1;
            padding: 8px 10px;
            border-radius: 8px;
            border: 1px solid #cbd5e1;
            text-align: center;
          }
          .summary-card span { display: block; font-size: 11px; font-weight: bold; }
          .summary-card strong { display: block; font-size: 15px; font-family: monospace; font-weight: 900; margin-top: 2px; }
          table.main-table {
            width: 100%;
            border-collapse: collapse;
            border: 1px solid #cbd5e1;
            margin-bottom: 20px;
          }
          table.main-table th {
            background: #f1f5f9;
            color: #1e293b;
            font-size: 11.5px;
            font-weight: bold;
            padding: 7px 6px;
            border: 1px solid #cbd5e1;
          }
          .signatures {
            display: flex;
            justify-content: space-between;
            margin-top: 35px;
            padding: 0 20px;
            font-size: 12px;
            font-weight: bold;
          }
          .sign-col { text-align: center; width: 180px; }
          .sign-line { border-bottom: 1px dashed #64748b; height: 35px; margin-top: 5px; }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <h2 style="margin:0; font-size:18px; color:#0f172a;">${companyName}</h2>
            <div style="font-size:11px; color:#475569; margin-top:3px;">${companyAddress}</div>
            <div style="font-size:11px; color:#475569; font-family:monospace;">${companyPhone}</div>
          </div>
          <div style="text-align:left; font-size:11px; color:#475569;">
            <div>تاريخ الاستخراج: <strong>${printDate}</strong></div>
            <div>توقيت الطباعة: <strong>${printTime}</strong></div>
          </div>
        </div>

        <div class="title">كشف حساب مورد رسمي</div>

        <div class="meta-box">
          <div><strong>اسم المورد:</strong> ${supplier.name}</div>
          <div><strong>رقم الهاتف:</strong> <span style="font-family:monospace;">${supplier.phone}</span></div>
          <div><strong>العنوان:</strong> ${supplier.address || '—'}</div>
          <div><strong>${periodLabel}</strong></div>
        </div>

        <div class="summary-cards">
          <div class="summary-card" style="background:#faf5ff; border-color:#d8b4fe;">
            <span style="color:#6b21a8;">إجمالي المشتريات</span>
            <strong style="color:#581c87;">${totalPurchasesFormatted}</strong>
          </div>
          <div class="summary-card" style="background:#f0fdf4; border-color:#86efac;">
            <span style="color:#15803d;">إجمالي المسدد</span>
            <strong style="color:#166534;">${totalPaidFormatted}</strong>
          </div>
          <div class="summary-card" style="background:#fff1f2; border-color:#fecdd3;">
            <span style="color:#be123c;">الرصيد المستحق</span>
            <strong style="color:#9f1239;">${currentBalanceFormatted}</strong>
          </div>
        </div>

        <table class="main-table">
          <thead>
            <tr>
              <th style="width:30px;">#</th>
              <th style="width:80px;">التاريخ</th>
              <th style="width:130px;">المستند / الحركة</th>
              <th>البيان والتفاصيل</th>
              <th style="width:95px;">مشتريات (+)</th>
              <th style="width:95px;">مسدد (-)</th>
              <th style="width:100px;">الرصيد</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || '<tr><td colspan="7" style="text-align:center; padding:20px; color:#64748b;">لا توجد حركات مسجلة.</td></tr>'}
          </tbody>
        </table>

        <div class="signatures">
          <div class="sign-col">
            <span>المحاسب المسؤول</span>
            <div class="sign-line"></div>
          </div>
          <div class="sign-col">
            <span>المدير المالي / الإدارة</span>
            <div class="sign-line"></div>
          </div>
          <div class="sign-col">
            <span>توقيع المورد بالاستلام والمطابقة</span>
            <div class="sign-line"></div>
          </div>
        </div>
      </body>
      </html>
    `;

    printWin.document.open();
    printWin.document.write(htmlContent);
    printWin.document.close();
    printWin.focus();
    setTimeout(() => {
      printWin.print();
    }, 250);
  };

  if (!isOpen || !supplier) return null;

  const currentBal = statement?.summary?.currentBalance ?? supplier.balance ?? 0;
  const totalPurchases = statement?.summary?.totalPurchasesAmount ?? 0;
  const totalPaid = statement?.summary?.totalPaymentsAmount ?? 0;

  // Filtered Totals for Footer
  const filteredPurchasesTotal = filteredTransactions
    .filter((t) => t.type === 'purchase')
    .reduce((acc, t) => acc + (t.credit || 0), 0);

  const filteredPaymentsTotal = filteredTransactions
    .filter((t) => t.type === 'payment_out' || t.type === 'purchase_downpayment')
    .reduce((acc, t) => acc + (t.debit || 0), 0);

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-2 sm:p-4 animate-fadeIn">
      <div className="bg-white rounded-2xl w-full max-w-5xl max-h-[92vh] shadow-2xl border border-slate-200 flex flex-col overflow-hidden relative">
        {/* Harmonious Header Bar */}
        <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold shrink-0 shadow-xs">
              <Truck size={20} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base sm:text-lg font-black text-slate-900">
                  كشف حساب المورد:
                </h3>
                <span className="text-base sm:text-lg font-extrabold text-blue-700">
                  {supplier.name}
                </span>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-xs font-black border ${
                    currentBal > 0
                      ? 'bg-rose-50 text-rose-700 border-rose-200'
                      : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  }`}
                >
                  {currentBal > 0 ? `الرصيد: ${formatCurrency(currentBal)}` : 'الحساب مصفى تماماً'}
                </span>
              </div>
              <div className="flex items-center gap-4 text-xs text-slate-500 mt-0.5 flex-wrap">
                <span className="flex items-center gap-1 font-mono font-bold text-slate-700">
                  <Phone size={12} className="text-blue-600" />
                  {supplier.phone}
                </span>
                {supplier.address && (
                  <span className="flex items-center gap-1 truncate max-w-xs text-slate-600">
                    <MapPin size={12} className="text-blue-600" />
                    {supplier.address}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Action buttons in header */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                if (!showPayDrawer) {
                  setPayAmount(currentBal > 0 ? currentBal : '');
                  setPayDate(today());
                  setPayNotes(`سداد دفعة نقدية للمورد: ${supplier.name}`);
                }
                setShowPayDrawer(!showPayDrawer);
              }}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer active:scale-95 ${
                showPayDrawer
                  ? 'bg-emerald-700 text-white ring-2 ring-emerald-300'
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white'
              }`}
              title="سداد دفعة نقدية للمورد وتخفيض حسابه"
            >
              <DollarSign size={14} />
              <span>{showPayDrawer ? 'إلغاء السداد' : '+ سداد دفعة'}</span>
            </button>

            <button
              type="button"
              onClick={handlePrintStatement}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold transition-all border border-slate-300 shadow-2xs cursor-pointer active:scale-95 disabled:opacity-50"
              title="طباعة كشف حساب مورد رسمي منسق A4"
            >
              <Printer size={14} />
              <span className="hidden sm:inline">طباعة الكشف</span>
            </button>

            <button
              type="button"
              onClick={loadStatement}
              disabled={loading}
              className="p-2 rounded-xl bg-white hover:bg-slate-100 text-slate-600 transition-all border border-slate-300 shadow-2xs cursor-pointer active:scale-95 disabled:opacity-50"
              title="تحديث البيانات"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin text-blue-600' : ''} />
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-100 hover:bg-rose-50 hover:text-rose-600 text-slate-500 transition-all cursor-pointer"
              title="إغلاق (Esc)"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Content Container (Simplified without horizontal scrolling) */}
        <div className="flex-1 overflow-y-auto flex flex-col p-4 space-y-3">
          {/* Quick Payment Inline Drawer */}
          {showPayDrawer && (
            <div className="bg-emerald-50/70 border border-emerald-300 rounded-2xl p-3.5 shadow-sm animate-fadeIn">
              <div className="flex items-center justify-between pb-2 mb-2.5 border-b border-emerald-200">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-emerald-600 text-white flex items-center justify-center">
                    <DollarSign size={14} />
                  </div>
                  <div>
                    <h4 className="text-xs font-black text-emerald-950">سداد دفعة نقدية للمورد ({supplier.name})</h4>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-600">
                    الرصيد المستحق: <strong className="font-mono text-rose-700">{formatCurrency(currentBal)}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowPayDrawer(false)}
                    className="text-slate-400 hover:text-slate-700 mr-2"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>

              <form onSubmit={handleSubmitPayment} className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 items-end">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    المبلغ المسدد نقداً ({settings?.currency || 'ج.م'}) *
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    required
                    autoFocus
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value === '' ? '' : Number(e.target.value))}
                    className="input-ui h-8 w-full text-sm font-black font-mono text-emerald-700 px-2.5 bg-white"
                    placeholder="0.00"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">تاريخ السند *</label>
                  <DatePicker
                    value={payDate}
                    onChange={setPayDate}
                    placeholder="يوم/شهر/سنة"
                    className="h-8 text-xs font-bold w-full"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">البيان / ملاحظات</label>
                  <input
                    type="text"
                    value={payNotes}
                    onChange={(e) => setPayNotes(e.target.value)}
                    className="input-ui h-8 w-full text-xs px-2.5 bg-white"
                    placeholder="دفعة للمورد..."
                  />
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    disabled={submittingPayment}
                    className="flex-1 h-8 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-all shadow-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {submittingPayment ? <RefreshCw size={12} className="animate-spin" /> : <Send size={12} />}
                    <span>تأكيد الصرف</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowPayDrawer(false)}
                    disabled={submittingPayment}
                    className="h-8 px-3 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg text-xs font-bold transition-colors cursor-pointer"
                  >
                    إلغاء
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* 3 Simplified KPI Summary Cards (إجمالي المشتريات | إجمالي المسدد | الرصيد) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {/* 1. Total Purchases */}
            <div className="bg-indigo-50/50 border border-indigo-200 rounded-xl p-3 flex items-center justify-between">
              <div>
                <span className="text-[11px] font-bold text-indigo-800 block">إجمالي المشتريات</span>
                <span className="text-base sm:text-lg font-black font-mono text-indigo-900">
                  {formatCurrency(totalPurchases)}
                </span>
                <span className="text-[10px] text-indigo-600 block mt-0.5">
                  عدد الفواتير: {statement?.summary?.purchasesCount ?? 0}
                </span>
              </div>
              <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
                <ShoppingCart size={16} />
              </div>
            </div>

            {/* 2. Total Paid */}
            <div className="bg-emerald-50/60 border border-emerald-200 rounded-xl p-3 flex items-center justify-between">
              <div>
                <span className="text-[11px] font-bold text-emerald-800 block">إجمالي المسدد</span>
                <span className="text-base sm:text-lg font-black font-mono text-emerald-700">
                  {formatCurrency(totalPaid)}
                </span>
                <span className="text-[10px] text-emerald-600 block mt-0.5">
                  سندات الصرف: {statement?.summary?.paymentsCount ?? 0}
                </span>
              </div>
              <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                <ArrowDownLeft size={16} />
              </div>
            </div>

            {/* 3. The Balance (الرصيد) */}
            <div
              className={`border rounded-xl p-3 flex items-center justify-between ${
                currentBal > 0
                  ? 'bg-rose-50 border-rose-200'
                  : 'bg-emerald-50 border-emerald-200'
              }`}
            >
              <div>
                <span
                  className={`text-[11px] font-bold block ${
                    currentBal > 0 ? 'text-rose-800' : 'text-emerald-800'
                  }`}
                >
                  الرصيد
                </span>
                <span
                  className={`text-base sm:text-lg font-black font-mono ${
                    currentBal > 0 ? 'text-rose-700' : 'text-emerald-700'
                  }`}
                >
                  {formatCurrency(currentBal)}
                </span>
                <span className="text-[10px] text-slate-500 block mt-0.5">
                  {currentBal > 0 ? 'مبلغ مستحق للمورد' : 'الحساب مصفى تماماً'}
                </span>
              </div>
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                  currentBal > 0 ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'
                }`}
              >
                <Scale size={16} />
              </div>
            </div>
          </div>

          {/* Interactive Filters Strip with System DatePicker (يوم/شهر/سنة) */}
          <div className="bg-slate-50 rounded-xl p-2.5 border border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
            {/* Search Input */}
            <div className="relative flex-1 min-w-[160px] max-w-xs">
              <Search size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="بحث برقم الفاتورة، السند، الصنف..."
                className="input-ui h-8 w-full pr-8 pl-2 text-xs bg-white border-slate-200"
              />
            </div>

            {/* Type Filter Buttons */}
            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-bold shrink-0">
              <button
                type="button"
                onClick={() => setTypeFilter('all')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  typeFilter === 'all'
                    ? 'bg-blue-600 text-white shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                الكل ({statement?.transactions?.length ?? 0})
              </button>
              <button
                type="button"
                onClick={() => setTypeFilter('purchases')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  typeFilter === 'purchases'
                    ? 'bg-blue-600 text-white shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                فواتير مشتريات ({statement?.summary?.purchasesCount ?? 0})
              </button>
              <button
                type="button"
                onClick={() => setTypeFilter('payments')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  typeFilter === 'payments'
                    ? 'bg-blue-600 text-white shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                سدادات ومدفوعات ({statement?.summary?.paymentsCount ?? 0})
              </button>
            </div>

            {/* Date Range Filters using DatePicker (يوم/شهر/سنة) */}
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[11px] text-slate-500 font-bold">من:</span>
              <DatePicker
                value={startDate}
                onChange={setStartDate}
                placeholder="يوم/شهر/سنة"
                className="h-8 text-xs font-bold w-[110px]"
              />
              <span className="text-[11px] text-slate-500 font-bold">إلى:</span>
              <DatePicker
                value={endDate}
                onChange={setEndDate}
                placeholder="يوم/شهر/سنة"
                className="h-8 text-xs font-bold w-[110px]"
              />
              {(startDate || endDate || searchQuery || typeFilter !== 'all') && (
                <button
                  type="button"
                  onClick={() => {
                    setStartDate('');
                    setEndDate('');
                    setSearchQuery('');
                    setTypeFilter('all');
                  }}
                  className="px-2 py-1 text-[11px] text-rose-600 hover:bg-rose-50 rounded font-bold transition-colors cursor-pointer"
                >
                  إلغاء التصفية
                </button>
              )}
            </div>
          </div>

          {/* Streamlined Ledger Table: ZERO Horizontal Scrolling (w-full table-fixed min-w-0) */}
          <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-2xs">
            <div className="max-h-[48vh] overflow-y-auto">
              <table className="w-full text-right border-collapse table-fixed min-w-0">
                <thead className="bg-slate-100 text-slate-700 text-xs font-bold sticky top-0 z-10 border-b border-slate-200 shadow-2xs">
                  <tr>
                    <th className="py-2.5 px-3 text-center whitespace-nowrap w-[95px]">التاريخ</th>
                    <th className="py-2.5 px-3 text-center whitespace-nowrap w-[140px]">المستند / الحركة</th>
                    <th className="py-2.5 px-3">البيان والتفاصيل</th>
                    <th className="py-2.5 px-3 text-center whitespace-nowrap w-[110px] bg-indigo-50/70 text-indigo-900 border-x border-indigo-100">
                      مشتريات (+)
                    </th>
                    <th className="py-2.5 px-3 text-center whitespace-nowrap w-[110px] bg-emerald-50/70 text-emerald-900 border-l border-emerald-100">
                      مسدد (-)
                    </th>
                    <th className="py-2.5 px-3 text-center whitespace-nowrap w-[120px] bg-slate-200/80 text-slate-900">
                      الرصيد
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-slate-400 font-bold">
                        <div className="flex flex-col items-center justify-center gap-2">
                          <RefreshCw size={24} className="animate-spin text-blue-600" />
                          <span>جاري تحميل سجل محاسبات المورد...</span>
                        </div>
                      </td>
                    </tr>
                  ) : filteredTransactions.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-slate-400 font-bold">
                        <FileText size={32} className="mx-auto mb-2 text-slate-300" />
                        <span>لا توجد حركات مسجلة مطابقة للبحث الحالي</span>
                      </td>
                    </tr>
                  ) : (
                    filteredTransactions.map((tx, idx) => {
                      const hasItems = tx.items && tx.items.length > 0;
                      const isExpanded = expandedInvoiceIds.has(tx.id);
                      const displayDate = formatDateDisplay(tx.rawDate || tx.date);

                      return (
                        <React.Fragment key={tx.id || idx}>
                          <tr className={`hover:bg-slate-50 transition-colors ${idx % 2 === 1 ? 'bg-slate-50/40' : 'bg-white'}`}>
                            {/* 1. Date (DD/MM/YYYY) */}
                            <td className="py-2.5 px-2 font-mono text-center text-slate-700 whitespace-nowrap font-bold text-[11px]">
                              {displayDate}
                            </td>

                            {/* 2. Document & Movement Type Combined */}
                            <td className="py-2.5 px-2 text-center whitespace-nowrap">
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold ${
                                  tx.type === 'purchase'
                                    ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                                    : tx.type === 'payment_out' || tx.type === 'purchase_downpayment'
                                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                      : 'bg-slate-100 text-slate-700 border border-slate-300'
                                }`}
                              >
                                {tx.type === 'purchase' ? (
                                  <ShoppingCart size={10} />
                                ) : tx.type === 'payment_out' || tx.type === 'purchase_downpayment' ? (
                                  <ArrowDownLeft size={10} />
                                ) : (
                                  <FileText size={10} />
                                )}
                                <span>
                                  {tx.type === 'opening_balance'
                                    ? 'الرصيد'
                                    : tx.docNumber && tx.docNumber !== '—'
                                      ? tx.docNumber
                                      : tx.typeLabel}
                                </span>
                              </span>
                            </td>

                            {/* 3. Description & Items Button */}
                            <td className="py-2.5 px-3 text-slate-700 leading-snug truncate">
                              <div className="flex items-center justify-between gap-1.5 overflow-hidden">
                                <span className="truncate" title={tx.type === 'opening_balance' ? 'الرصيد المسجل للمورد' : tx.description}>
                                  {tx.type === 'opening_balance' ? 'الرصيد المسجل للمورد' : tx.description}
                                </span>
                                {hasItems && (
                                  <button
                                    type="button"
                                    onClick={() => toggleInvoiceItems(tx.id)}
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 transition-colors shrink-0 cursor-pointer"
                                    title="عرض أو إخفاء تفاصيل أصناف الفاتورة"
                                  >
                                    <Package size={10} />
                                    <span>{tx.items?.length} صنف</span>
                                    {isExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                                  </button>
                                )}
                              </div>
                            </td>

                            {/* 4. Purchases (+) */}
                            <td className="py-2.5 px-2 text-center font-mono font-bold text-indigo-900 bg-indigo-50/20 border-x border-indigo-100 text-xs">
                              {tx.credit > 0 ? `+${formatCurrency(tx.credit)}` : '—'}
                            </td>

                            {/* 5. Paid (-) */}
                            <td className="py-2.5 px-2 text-center font-mono font-bold text-emerald-800 bg-emerald-50/20 border-l border-emerald-100 text-xs">
                              {tx.debit > 0 ? `-${formatCurrency(tx.debit)}` : '—'}
                            </td>

                            {/* 6. Running Balance */}
                            <td className="py-2.5 px-2 text-center font-mono font-black text-slate-900 bg-slate-100/60 text-xs">
                              <span
                                className={`px-2 py-0.5 rounded text-xs ${
                                  tx.runningBalance > 0
                                    ? 'text-rose-700 font-black'
                                    : 'text-emerald-700 font-bold'
                                }`}
                              >
                                {formatCurrency(tx.runningBalance)}
                              </span>
                            </td>
                          </tr>

                          {/* Nested Items Accordion for Purchases */}
                          {hasItems && isExpanded && (
                            <tr className="bg-blue-50/30 border-y border-blue-100">
                              <td colSpan={6} className="p-2.5">
                                <div className="bg-white rounded-lg border border-blue-200 p-2 shadow-2xs">
                                  <div className="flex items-center gap-1.5 mb-1.5 text-xs font-bold text-blue-900 border-b border-slate-100 pb-1">
                                    <Package size={12} className="text-blue-600" />
                                    <span>أصناف الفاتورة ({tx.docNumber}):</span>
                                  </div>
                                  <table className="w-full text-xs text-right">
                                    <thead className="bg-slate-50 text-slate-600 font-bold text-[11px] border-b border-slate-100">
                                      <tr>
                                        <th className="py-1 px-2">اسم الصنف</th>
                                        <th className="py-1 px-2 font-mono">الباركود</th>
                                        <th className="py-1 px-2 text-center w-16">الكمية</th>
                                        <th className="py-1 px-2 text-center w-24">سعر الشراء</th>
                                        <th className="py-1 px-2 text-center w-24">الإجمالي</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                      {tx.items!.map((it, itemIdx) => (
                                        <tr key={itemIdx} className="hover:bg-slate-50">
                                          <td className="py-1 px-2 font-bold text-slate-800">{it.productName}</td>
                                          <td className="py-1 px-2 font-mono text-slate-500 text-[11px]">{it.barcode || '—'}</td>
                                          <td className="py-1 px-2 text-center font-mono font-bold text-slate-700">{it.quantity}</td>
                                          <td className="py-1 px-2 text-center font-mono text-slate-700">{formatCurrency(it.unitPrice)}</td>
                                          <td className="py-1 px-2 text-center font-mono font-bold text-blue-900">{formatCurrency(it.total)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Bottom Totals Footer Strip (Simplified, Consistent, Zero Clutter) */}
            <div className="bg-slate-100 border-t border-slate-200 p-2.5 flex flex-wrap items-center justify-between gap-3 text-xs font-bold text-slate-700">
              <div className="flex items-center gap-4 flex-wrap">
                <span>
                  الحركات: <strong className="text-blue-700">{filteredTransactions.length}</strong>
                </span>
                <span>
                  إجمالي المشتريات: <strong className="text-indigo-800 font-mono">{formatCurrency(filteredPurchasesTotal)}</strong>
                </span>
                <span>
                  إجمالي المسدد: <strong className="text-emerald-700 font-mono">{formatCurrency(filteredPaymentsTotal)}</strong>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span>الرصيد المستحق:</span>
                <span
                  className={`text-sm font-black font-mono px-3 py-0.5 rounded-md ${
                    currentBal > 0
                      ? 'bg-rose-100 text-rose-800 border border-rose-200'
                      : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                  }`}
                >
                  {formatCurrency(currentBal)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Outer Bottom Bar */}
        <div className="px-5 py-2.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3 shrink-0">
          <div className="text-[11px] text-slate-500 font-medium">
            * يتم تحديث الرصيد وحسابات المورد آلياً بمجرد تسجيل فواتير الشراء أو سداد الدفعات النقدية.
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrintStatement}
              className="px-4 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5 shadow-2xs"
            >
              <Printer size={13} />
              <span>طباعة كشف الحساب</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg text-xs font-bold transition-colors cursor-pointer"
            >
              إغلاق
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
