import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  CalendarDays,
  CreditCard,
  Lock,
  Plus,
  Printer,
  Search,
  CheckCircle2,
} from 'lucide-react';
import { ClosingPeriod, Customer, InstallmentSchedule, Payment, Sale, Supplier } from '../types';
import { createPayment, getPayments, getCustomers, getSales, getSuppliers, syncCustomers, syncPayments, syncSales, syncSuppliers, getClosingPeriods, isDateClosed, syncClosingPeriods, closePeriodApi } from '../lib/storage';
import { api, isApiMode } from '../lib/apiClient';
import { useAuth } from '../context/AuthContext';
import { hasPermission } from '../lib/permissions';
import { formatDateDisplay } from '../lib/dateUtils';
import { DatePicker } from '../components/DatePicker';
import { formatWholeCurrency } from '../lib/utils';

type PaymentType = 'in' | 'out';
type IncomingSubmitMode = 'save' | 'save_print';

interface IncomingPaymentForm {
  customerId: string;
  saleId: string;
  installmentId: string;
  amount: number;
  date: string;
  description: string;
}

interface OutgoingPaymentForm {
  supplierId: string;
  amount: number;
  date: string;
  description: string;
}

const today = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Cairo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

const normalizeArabic = (str: string): string => {
  if (!str) return '';
  return str
    .replace(/[أإآا]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[ىي]/g, 'ي')
    .trim()
    .toLowerCase();
};

const displayArabic = (value?: string | null): string => {
  if (!value) return '';
  if (!/[طظ][\u0600-\u06FF\u00A0-\u00FF]/.test(value)) return value;

  try {
    const cp1256Decoder = new TextDecoder('windows-1256');
    const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
    const cp1256Chars = cp1256Decoder.decode(Uint8Array.from({ length: 128 }, (_, index) => index + 128));
    const reverseMap = new Map<string, number>();

    Array.from(cp1256Chars).forEach((char, index) => {
      if (char !== '�') reverseMap.set(char, index + 128);
    });

    const bytes = Array.from(value, (char) => {
      const code = char.charCodeAt(0);
      if (code < 128) return code;
      const mapped = reverseMap.get(char);
      if (mapped === undefined) throw new Error('Unsupported character');
      return mapped;
    });

    const repaired = utf8Decoder.decode(Uint8Array.from(bytes));
    return /[\u0600-\u06FF]/.test(repaired) ? repaired : value;
  } catch {
    return value;
  }
};

export default function Payments() {
  const { settings, user } = useAuth();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [dailyPayments, setDailyPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [sales, setSales] = useState<Sale[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [paymentType, setPaymentType] = useState<PaymentType>('in');
  const [closedPeriodSearch, setClosedPeriodSearch] = useState('');
  const [incomingSubmitMode, setIncomingSubmitMode] = useState<IncomingSubmitMode>('save');

  // Daily Closing states
  const [showClosingModal, setShowClosingModal] = useState(false);
  const [closingDate, setClosingDate] = useState(today());
  const [closingNotes, setClosingNotes] = useState('');
  const [closedPeriods, setClosedPeriods] = useState<ClosingPeriod[]>([]);

  const [incomingForm, setIncomingForm] = useState<IncomingPaymentForm>({
    customerId: '',
    saleId: '',
    installmentId: '',
    amount: 0,
    date: today(),
    description: '',
  });

  // Autocomplete for customer payment selection
  const [customerSearchTerm, setCustomerSearchTerm] = useState('');
  const [showCustomerSuggestions, setShowCustomerSuggestions] = useState(false);

  const customerSuggestions = useMemo(() => {
    const term = normalizeArabic(customerSearchTerm);
    if (term.length < 1) return [];
    return customers.filter((c) => normalizeArabic(c.name).includes(term));
  }, [customers, customerSearchTerm]);

  useEffect(() => {
    const customer = customers.find((c) => c.id === incomingForm.customerId);
    if (customer) {
      if (customerSearchTerm !== customer.name) {
        setCustomerSearchTerm(customer.name);
      }
    } else {
      if (!showCustomerSuggestions && customerSearchTerm !== '') {
        setCustomerSearchTerm('');
      }
    }
  }, [incomingForm.customerId, customers, showCustomerSuggestions]);

  const [outgoingForm, setOutgoingForm] = useState<OutgoingPaymentForm>({
    supplierId: '',
    amount: 0,
    date: today(),
    description: '',
  });

  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadData = async () => {
    setLoading(true);
    // 1. Load cached data for non-payment data immediately (payments skip localStorage due to size)
    const nextSales = getSales().slice().reverse();
    const nextCustomers = getCustomers();
    const nextSuppliers = getSuppliers();

    setSales(nextSales);
    setCustomers(nextCustomers);
    setSuppliers(nextSuppliers);
    setClosedPeriods(getClosingPeriods());

    if (isApiMode()) {
      try {
        // Fetch payments directly from API to avoid localStorage quota issues
        // (payments list can be very large - 1.7MB+)
        const [freshPaymentsRaw] = await Promise.all([
          api.listPayments({ date: today(), limit: 500 }),
          syncCustomers(),
          syncSuppliers(),
          syncSales(),
          syncClosingPeriods(),
        ]);

        // Clear old stale payments cache if it exists
        try { localStorage.removeItem('almuttahida_payments'); } catch { /* ignore */ }

        setPayments(freshPaymentsRaw);
        setDailyPayments(freshPaymentsRaw);
        setSales(getSales().slice().reverse());
        setCustomers(getCustomers());
        setSuppliers(getSuppliers());
        setClosedPeriods(getClosingPeriods());
      } catch (err: any) {
        console.error('[Payments] Sync FAILED:', err);
        setMessage({ type: 'error', text: `فشل تحميل البيانات: ${err?.message || 'خطأ في الاتصال بالخادم'}` });
      }
    } else {
      // Local mode: load from localStorage
      const localPayments = getPayments().slice().reverse();
      const todayYYYYMMDD = today();
      const localDailyPayments = localPayments.filter((payment) => toYYYYMMDD(payment.date) === todayYYYYMMDD);
      setPayments(localDailyPayments);
      setDailyPayments(localDailyPayments);
    }
    setLoading(false);
  };

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClosePeriod = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await closePeriodApi('daily', closingDate, user?.name || 'مدير النظام', closingNotes);
      await loadData();
      setShowClosingModal(false);
      setClosingNotes('');
      setMessage({ type: 'success', text: 'تم إغلاق اليومية بنجاح.' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'حدث خطأ أثناء إغلاق اليومية.' });
    }
  };

  const formatCurrency = (amount: number) => formatWholeCurrency(amount, settings.currency);

  const formatDate = formatDateDisplay;

  const customerSales = useMemo(
    () =>
      sales.filter(
        (sale) =>
          (!incomingForm.customerId || sale.customerId === incomingForm.customerId) &&
          sale.status !== 'cancelled' &&
          sale.remaining > 0,
      ),
    [incomingForm.customerId, sales],
  );

  const selectedCustomer = customers.find((customer) => customer.id === incomingForm.customerId) || null;
  const selectedSale = customerSales.find((sale) => sale.id === incomingForm.saleId) || null;

  const selectedSchedules = selectedSale?.financing?.schedules?.length
    ? selectedSale.financing.schedules
    : selectedSale
      ? [
          {
            id: `${selectedSale.id}-full`,
            monthIndex: 1,
            label: 'دفعة كاملة',
            dueDate: selectedSale.date,
            amount: selectedSale.total,
            paidAmount: selectedSale.paid,
            paidAt: selectedSale.paid > 0 ? selectedSale.date : undefined,
            status: (selectedSale.remaining <= 0 ? 'paid' : selectedSale.paid > 0 ? 'partial' : 'unpaid') as InstallmentSchedule['status'],
          },
        ]
      : [];

  const selectedInstallment =
    selectedSchedules.find((schedule) => schedule.id === incomingForm.installmentId) || null;

  const selectedInstallmentRemaining = selectedInstallment
    ? Number(Math.max(selectedInstallment.amount - selectedInstallment.paidAmount, 0).toFixed(2))
    : 0;

  const pendingSchedules = selectedSchedules.filter((schedule) => schedule.status !== 'paid');

  const toYYYYMMDD = (dateStr: string) => {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  const closedPeriodSearchTerm = closedPeriodSearch.trim().toLowerCase();
  const filteredClosedPeriods = closedPeriods.filter((period) => {
    if (!closedPeriodSearchTerm) return true;
    return (
      formatDateDisplay(period.periodDate).toLowerCase().includes(closedPeriodSearchTerm) ||
      period.periodDate.toLowerCase().includes(closedPeriodSearchTerm) ||
      period.closedBy.toLowerCase().includes(closedPeriodSearchTerm) ||
      (period.notes || '').toLowerCase().includes(closedPeriodSearchTerm)
    );
  });

  const todayYYYYMMDD = today();
  const todayPayments = dailyPayments.filter((payment) => toYYYYMMDD(payment.date) === todayYYYYMMDD);
  const totalIn = todayPayments.filter((payment) => payment.type === 'in').reduce((sum, payment) => sum + payment.amount, 0);
  const totalOut = todayPayments.filter((payment) => payment.type === 'out').reduce((sum, payment) => sum + payment.amount, 0);

  const openModal = (type: PaymentType) => {
    setPaymentType(type);
    setShowModal(true);
    setIncomingSubmitMode('save');
    setMessage(null);
  };

  const closeModal = () => {
    setShowModal(false);
  };

  const printInstallmentReceipt = (params: {
    payment: Payment;
    sale: Sale;
    installment: InstallmentSchedule | null;
    customerName: string;
    remainingInstallments: number;
  }) => {
    const { payment, sale, installment, customerName, remainingInstallments } = params;
    const receiptNo = payment.id.slice(-8).toUpperCase();
    const installmentLabel = installment?.label || 'القسط';
    const dueDate = installment?.dueDate || '-';
    const installmentAmount = installment?.amount ?? payment.amount;
    const contractDate = sale.date;
    const paymentDate = payment.date;
    const companyName = settings.companyName || 'شركة المتحدة';
    const companyPhone = settings.companyPhone || '';

    const printWindow = window.open('', '_blank', 'width=420,height=760');
    if (!printWindow) {
      setMessage({ type: 'error', text: 'تعذر فتح نافذة الطباعة. تأكد من السماح بالنوافذ المنبثقة.' });
      return;
    }

    const html = `
      <!doctype html>
      <html lang="ar" dir="rtl">
      <head>
        <meta charset="utf-8" />
        <title>إيصال سداد قسط</title>
        <style>
          @page { size: 80mm auto; margin: 0; }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            padding: 0;
            width: 80mm;
            background: #fff;
            color: #000;
            font-family: Tahoma, Arial, sans-serif;
            font-size: 12px;
            line-height: 1.35;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .receipt {
            width: 72mm;
            margin: 0 auto;
            padding: 3mm 0 4mm;
          }
          .head {
            text-align: center;
            border: 1px solid #000;
            padding: 2.5mm 2mm 2mm;
            margin-bottom: 2.5mm;
          }
          .company { font-size: 14px; font-weight: 700; margin-bottom: 1mm; }
          .title { font-size: 13px; font-weight: 800; margin-bottom: 1mm; }
          .meta { font-size: 11px; margin-top: 1mm; }
          .box { border: 1px solid #000; padding: 0; }
          .row {
            display: grid;
            grid-template-columns: 26mm 1fr;
            align-items: center;
            min-height: 8.6mm;
            border-bottom: 1px solid #000;
          }
          .row:last-child { border-bottom: 0; }
          .label {
            border-left: 1px solid #000;
            font-weight: 700;
            padding: 1.2mm 1.6mm;
            font-size: 11.4px;
          }
          .value {
            padding: 1.2mm 1.6mm;
            font-weight: 600;
            font-size: 11.4px;
            overflow-wrap: anywhere;
          }
          .amount-row .value { font-size: 12.2px; font-weight: 800; }
          .note {
            margin-top: 2.5mm;
            border-top: 1px dashed #000;
            padding-top: 2mm;
            font-size: 10.4px;
            text-align: center;
          }
          .signatures {
            margin-top: 4.5mm;
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 2mm;
            font-size: 10.7px;
            font-weight: 700;
            text-align: center;
          }
          .sig {
            border-top: 1px solid #000;
            padding-top: 1.5mm;
            min-height: 9mm;
          }
          @media print {
            html, body { width: 80mm; }
            .receipt { width: 72mm; margin: 0 auto; }
          }
        </style>
      </head>
      <body>
        <main class="receipt">
          <header class="head">
            <div class="company">${companyName}</div>
            <div class="title">إيصال سداد قسط</div>
            <div class="meta">رقم الإيصال: ${receiptNo}</div>
            <div class="meta">تاريخ الإصدار: ${formatDate(paymentDate)}</div>
            ${companyPhone ? `<div class="meta">هاتف الشركة: ${companyPhone}</div>` : ''}
          </header>

          <section class="box">
            <div class="row"><div class="label">اسم العميل</div><div class="value">${customerName}</div></div>
            <div class="row"><div class="label">رقم الفاتورة</div><div class="value">${sale.invoiceNumber}</div></div>
            <div class="row"><div class="label">رقم القسط</div><div class="value">${installmentLabel}</div></div>
            <div class="row amount-row"><div class="label">قيمة القسط</div><div class="value">${formatCurrency(installmentAmount)}</div></div>
            <div class="row"><div class="label">المبلغ المسدد</div><div class="value">${formatCurrency(payment.amount)}</div></div>
            <div class="row"><div class="label">الاستحقاق</div><div class="value">${formatDate(dueDate)}</div></div>
            <div class="row"><div class="label">تاريخ السداد</div><div class="value">${formatDate(paymentDate)}</div></div>
            <div class="row"><div class="label">تاريخ التعاقد</div><div class="value">${formatDate(contractDate)}</div></div>
            <div class="row"><div class="label">الأقساط الباقية</div><div class="value">${remainingInstallments} قسط</div></div>
          </section>

          <div class="note">تم استلام المبلغ المذكور من العميل أعلاه.</div>

          <section class="signatures">
            <div class="sig">توقيع المستلم</div>
            <div class="sig">توقيع واعتماد</div>
          </section>
        </main>
      </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    printWindow.onload = () => {
      printWindow.print();
    };
  };

  const handleIncomingSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (user?.role !== 'admin' && isDateClosed(incomingForm.date)) {
      setMessage({ type: 'error', text: 'لا يمكن إجراء حركة مالية في تاريخ مغلق ماليًا.' });
      return;
    }

    if (!incomingForm.customerId || !incomingForm.saleId || !incomingForm.installmentId) {
      setMessage({ type: 'error', text: 'اختر العميل والفاتورة والقسط المطلوب سداده.' });
      return;
    }

    if (incomingForm.amount <= 0) {
      setMessage({ type: 'error', text: 'أدخل مبلغًا صحيحًا للسداد.' });
      return;
    }

    if (!selectedSale || !selectedInstallment) {
      setMessage({ type: 'error', text: 'تعذر تحديد بيانات القسط المختار.' });
      return;
    }

    if (incomingForm.amount > selectedInstallmentRemaining) {
      setMessage({
        type: 'error',
        text: `المبلغ أكبر من المتبقي لهذا الشهر (${formatCurrency(selectedInstallmentRemaining)}).`,
      });
      return;
    }

    if (isApiMode()) {
      const created = await api.createPayment({
        type: 'in',
        amount: incomingForm.amount,
        saleId: selectedSale.id,
        installmentId: selectedInstallment.id,
        description:
          incomingForm.description.trim() ||
          `سداد ${selectedInstallment.label} من الفاتورة ${selectedSale.invoiceNumber}`,
        date: incomingForm.date,
        channel: 'cash',
      });

      await loadData();
      closeModal();
      setIncomingForm((current) => ({
        customerId: current.customerId,
        saleId: '',
        installmentId: '',
        amount: 0,
        date: today(),
        description: '',
      }));
      setIncomingSubmitMode('save');
      setMessage({ type: 'success', text: `تم تسجيل السداد برقم إيصال ${created.receiptNumber}.` });
      return;
    }

    const createdPayment = createPayment({
      type: 'in',
      amount: incomingForm.amount,
      referenceId: selectedSale.id,
      referenceType: 'sale',
      description:
        incomingForm.description.trim() ||
        `سداد ${selectedInstallment.label} من الفاتورة ${selectedSale.invoiceNumber}`,
      date: incomingForm.date,
      createdBy: user?.name || 'مدير النظام',
      customerId: incomingForm.customerId,
      saleId: selectedSale.id,
      installmentId: selectedInstallment.id,
      invoiceNumber: selectedSale.invoiceNumber,
      affectsCustomerBalance: true,
      channel: 'cash',
    });

    const updatedSale = getSales().find((sale) => sale.id === selectedSale.id) || selectedSale;
    const updatedInstallment =
      updatedSale.financing?.schedules?.find((schedule) => schedule.id === selectedInstallment.id) || null;
    const remainingInstallments =
      updatedSale.financing?.schedules?.filter((schedule) => schedule.status !== 'paid').length || 0;

    loadData();
    closeModal();

    setIncomingForm((current) => ({
      customerId: current.customerId,
      saleId: '',
      installmentId: '',
      amount: 0,
      date: today(),
      description: '',
    }));

    if (incomingSubmitMode === 'save_print') {
      printInstallmentReceipt({
        payment: createdPayment,
        sale: updatedSale,
        installment: updatedInstallment,
        customerName: selectedCustomer?.name || selectedSale.customerName,
        remainingInstallments,
      });
    }

    setIncomingSubmitMode('save');
    setMessage({
      type: 'success',
      text: `تم تسجيل سداد ${selectedInstallment.label} وربطه بالفاتورة ${selectedSale.invoiceNumber}.`,
    });
  };

  const handleOutgoingSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (user?.role !== 'admin' && isDateClosed(outgoingForm.date)) {
      setMessage({ type: 'error', text: 'لا يمكن إجراء حركة مالية في تاريخ مغلق ماليًا.' });
      return;
    }

    if (!outgoingForm.supplierId || outgoingForm.amount <= 0) {
      setMessage({ type: 'error', text: 'اختر المورد وأدخل مبلغًا صحيحًا.' });
      return;
    }

    if (isApiMode()) {
      await api.createPayment({
        type: 'out',
        supplierId: outgoingForm.supplierId,
        amount: outgoingForm.amount,
        description: outgoingForm.description.trim() || 'دفعة للمورد',
        date: outgoingForm.date,
        channel: 'cash',
      });

      await loadData();
      closeModal();
      setOutgoingForm((current) => ({
        supplierId: current.supplierId,
        amount: 0,
        date: today(),
        description: '',
      }));
      setMessage({ type: 'success', text: 'تم حفظ دفعة المورد بنجاح.' });
      return;
    }

    createPayment({
      type: 'out',
      amount: outgoingForm.amount,
      referenceId: outgoingForm.supplierId,
      referenceType: 'supplier',
      description: outgoingForm.description.trim() || 'دفعة للمورد',
      date: outgoingForm.date,
      createdBy: user?.name || 'مدير النظام',
      supplierId: outgoingForm.supplierId,
      channel: 'cash',
    });

    loadData();
    closeModal();

    setOutgoingForm((current) => ({
      supplierId: current.supplierId,
      amount: 0,
      date: today(),
      description: '',
    }));

    setMessage({ type: 'success', text: 'تم حفظ دفعة المورد بنجاح.' });
  };

  const closingDateYYYYMMDD = toYYYYMMDD(closingDate);
  const closingDatePayments = payments.filter((p) => toYYYYMMDD(p.date) === closingDateYYYYMMDD);
  const closingTotalIn = closingDatePayments.filter((p) => p.type === 'in').reduce((sum, p) => sum + p.amount, 0);
  const closingTotalOut = closingDatePayments.filter((p) => p.type === 'out').reduce((sum, p) => sum + p.amount, 0);
  const closingNet = closingTotalIn - closingTotalOut;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center border-b border-slate-100 pb-2.5">
        <h2 className="text-xl font-black text-slate-900">الخزينة</h2>
        <div className="flex gap-2">
          <button
            onClick={() => openModal('in')}
            className="flex items-center gap-1.5 bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 transition-colors text-sm font-bold shadow-sm"
          >
            <Plus size={16} />
            <span>سداد عميل</span>
          </button>
          <button
            onClick={() => openModal('out')}
            className="flex items-center gap-1.5 bg-rose-600 text-white px-4 py-2 rounded-lg hover:bg-rose-700 transition-colors text-sm font-bold shadow-sm"
          >
            <Plus size={16} />
            <span>دفعة مورد</span>
          </button>
          {hasPermission(user, 'closing:write') && (
            <button
              onClick={() => {
                setClosingDate(today());
                setClosingNotes('');
                setShowClosingModal(true);
              }}
              className="flex items-center gap-1.5 bg-slate-700 text-white px-4 py-2 rounded-lg hover:bg-slate-800 transition-colors text-sm font-bold shadow-sm"
            >
              <Lock size={16} />
              <span>إغلاق اليومية</span>
            </button>
          )}
        </div>
      </div>

      {message && (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm ${
            message.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <StatCard
          icon={<ArrowDownLeft size={22} className="text-emerald-600" />}
          label="إجمالي الوارد"
          value={formatCurrency(totalIn)}
          tone="emerald"
        />
        <StatCard
          icon={<ArrowUpRight size={22} className="text-rose-600" />}
          label="إجمالي الصادر"
          value={formatCurrency(totalOut)}
          tone="rose"
        />
        <StatCard
          icon={<Banknote size={22} className="text-sky-600" />}
          label="صافي الحركة"
          value={formatCurrency(totalIn - totalOut)}
          tone="sky"
        />
      </div>

      <div className="rounded-[26px] border border-slate-200 bg-white p-5 text-sm font-semibold text-slate-600 shadow-sm">
        المعروض الآن معاملات اليوم فقط. السجلات السابقة يمكن مراجعتها من نافذة إغلاق اليومية.
      </div>

      <div className="overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[950px]">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-4 py-4 text-right text-sm font-bold">الوصف</th>
                <th className="px-4 py-4 text-right text-sm font-bold">الجهة</th>
                <th className="px-4 py-4 text-right text-sm font-bold">الفاتورة / القسط</th>
                <th className="px-4 py-4 text-right text-sm font-bold">التاريخ</th>
                <th className="px-4 py-4 text-right text-sm font-bold">المبلغ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-slate-400 text-sm">
                    <div className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-5 w-5 text-slate-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                      </svg>
                      <span>جاري تحميل الحركات المالية...</span>
                    </div>
                  </td>
                </tr>
              ) : payments.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-slate-400 text-sm">
                    لا توجد معاملات بتاريخ اليوم
                  </td>
                </tr>
              ) : payments.map((payment) => {
                const customerName =
                  customers.find((customer) => customer.id === (payment.customerId || payment.referenceId))?.name || '-';
                const supplierName =
                  suppliers.find((supplier) => supplier.id === (payment.supplierId || payment.referenceId))?.name || '-';

                const linkedSchedule = payment.saleId
                  ? sales
                      .find((sale) => sale.id === payment.saleId)
                      ?.financing?.schedules?.find((schedule) => schedule.id === payment.installmentId)
                  : null;

                return (
                  <tr key={payment.id} className="hover:bg-slate-50">
                    <td className="px-4 py-4">
                      <p className="font-medium text-slate-800">{displayArabic(payment.description)}</p>
                      <p className="mt-1 text-xs text-slate-500">{payment.type === 'in' ? 'وارد' : 'صادر'}</p>
                    </td>
                    <td className="px-4 py-4 text-sm text-slate-700">
                      {displayArabic(payment.type === 'in' ? customerName : supplierName)}
                    </td>
                    <td className="px-4 py-4">
                      <div className="space-y-1 text-sm">
                        <p className="font-semibold text-slate-700">{payment.invoiceNumber || '-'}</p>
                        <p className="text-xs text-slate-500">{displayArabic(linkedSchedule?.label) || '-'}</p>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-sm text-slate-600">{formatDateDisplay(payment.date)}</td>
                    <td className="px-4 py-4">
                      <span className={`font-bold ${payment.type === 'in' ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {payment.type === 'in' ? '+' : '-'} {formatCurrency(payment.amount)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/45 p-3 sm:p-5">
          <div className="flex min-h-full items-center justify-center">
            <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-[30px] bg-white shadow-2xl">
              <div className={`px-6 py-5 text-white ${paymentType === 'in' ? 'bg-emerald-600' : 'bg-rose-600'}`}>
                <h3 className="text-xl font-bold">{paymentType === 'in' ? 'تسجيل سداد عميل' : 'تسجيل دفعة مورد'}</h3>
                <p className="mt-1 text-sm text-white/85">
                  {paymentType === 'in'
                    ? 'اختر العميل والفاتورة والقسط، ثم احفظ السداد مع ربطه بالشهر الصحيح.'
                    : 'سجل دفعة المورد بسرعة مع تفاصيل أساسية فقط.'}
                </p>
              </div>

              <div className="overflow-y-auto">
                {paymentType === 'in' ? (
                  <form onSubmit={handleIncomingSubmit} className="space-y-6 p-6">
                    <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
                      <section className="space-y-5">
                        <div className="grid gap-4 md:grid-cols-2">
                          <Field label="العميل">
                            <div className="relative w-full">
                              <input
                                value={customerSearchTerm}
                                onChange={(e) => {
                                  setCustomerSearchTerm(e.target.value);
                                  setShowCustomerSuggestions(true);
                                  if (e.target.value.trim() === '') {
                                    setIncomingForm((current) => ({
                                      ...current,
                                      customerId: '',
                                      saleId: '',
                                      installmentId: '',
                                      amount: 0,
                                      description: '',
                                    }));
                                  }
                                }}
                                onFocus={() => setShowCustomerSuggestions(true)}
                                onBlur={() => setTimeout(() => setShowCustomerSuggestions(false), 200)}
                                className="input-ui w-full"
                                placeholder="اكتب اسم العميل للبحث..."
                              />
                              {showCustomerSuggestions && customerSuggestions.length > 0 && (
                                <div className="absolute right-0 left-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-50 max-h-60 overflow-y-auto divide-y divide-slate-100">
                                  {customerSuggestions.map((c) => (
                                    <button
                                      key={c.id}
                                      type="button"
                                      onClick={() => {
                                        setIncomingForm((current) => ({
                                          ...current,
                                          customerId: c.id,
                                          saleId: '',
                                          installmentId: '',
                                          amount: 0,
                                          description: '',
                                        }));
                                        setCustomerSearchTerm(c.name);
                                        setShowCustomerSuggestions(false);
                                      }}
                                      className="w-full text-right px-4 py-2.5 text-sm text-slate-700 hover:bg-sky-50 hover:text-sky-700 font-medium transition-colors"
                                    >
                                      <span>{c.name}</span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          </Field>

                          <Field label="الفاتورة">
                            <select
                              value={incomingForm.saleId}
                              onChange={(event) =>
                                setIncomingForm((current) => ({
                                  ...current,
                                  saleId: event.target.value,
                                  installmentId: '',
                                  amount: 0,
                                  description: '',
                                }))
                              }
                              className="input-ui"
                            >
                              <option value="">اختر الفاتورة</option>
                              {customerSales.map((sale) => (
                                <option key={sale.id} value={sale.id}>
                                  {sale.invoiceNumber} - المتبقي {formatCurrency(sale.remaining)}
                                </option>
                              ))}
                            </select>
                          </Field>

                          <Field label="الشهر / القسط">
                            <select
                              value={incomingForm.installmentId}
                              onChange={(event) => {
                                const installment = selectedSchedules.find((schedule) => schedule.id === event.target.value);
                                const remainingAmount = installment
                                  ? Number(Math.max(installment.amount - installment.paidAmount, 0).toFixed(2))
                                  : 0;

                                setIncomingForm((current) => ({
                                  ...current,
                                  installmentId: event.target.value,
                                  amount: remainingAmount,
                                  description:
                                    installment && selectedSale
                                      ? `سداد ${installment.label} من الفاتورة ${selectedSale.invoiceNumber}`
                                      : '',
                                }));
                              }}
                              className="input-ui"
                            >
                              <option value="">اختر الشهر</option>
                              {pendingSchedules.map((schedule) => (
                                <option key={schedule.id} value={schedule.id}>
                                  {schedule.label} - {formatDateDisplay(schedule.dueDate)} - المتبقي{' '}
                                  {formatCurrency(Math.max(schedule.amount - schedule.paidAmount, 0))}
                                </option>
                              ))}
                            </select>
                          </Field>

                          <Field label="تاريخ السداد">
                            <DatePicker
                              value={incomingForm.date}
                              onChange={(date) => setIncomingForm((current) => ({ ...current, date }))}
                              className="w-full border-slate-200 px-4 py-2"
                            />
                          </Field>

                          <Field label="المبلغ المدفوع">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={incomingForm.amount === 0 ? '' : incomingForm.amount}
                              onChange={(event) =>
                                setIncomingForm((current) => ({ ...current, amount: Number(event.target.value) || 0 }))
                              }
                              className="input-ui"
                              onKeyDown={(e) => ['e', 'E', '+', '-'].includes(e.key) && e.preventDefault()}
                            />
                          </Field>

                          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <div className="flex items-center gap-2 text-slate-700">
                              <CalendarDays size={16} />
                              <span className="text-sm font-bold">مؤشر سريع</span>
                            </div>
                            <div className="mt-3 space-y-2 text-sm">
                              <QuickInfo label="الأقساط المفتوحة" value={String(pendingSchedules.length)} />
                              <QuickInfo
                                label="إجمالي المتبقي"
                                value={selectedSale ? formatCurrency(selectedSale.remaining) : '-'}
                              />
                            </div>
                          </div>
                        </div>

                        <Field label="الوصف">
                          <input
                            type="text"
                            value={incomingForm.description}
                            onChange={(event) => setIncomingForm((current) => ({ ...current, description: event.target.value }))}
                            className="input-ui"
                            placeholder="سيُنشأ وصف مناسب تلقائيًا ويمكن تعديله"
                          />
                        </Field>
                      </section>

                      <aside className="space-y-4">
                        <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                          <div className="flex items-center gap-2 text-slate-800">
                            <CreditCard size={16} />
                            <h4 className="font-bold">ملخص السداد</h4>
                          </div>
                          <div className="mt-4 space-y-2">
                            <QuickInfo label="العميل" value={selectedCustomer?.name || '-'} />
                            <QuickInfo label="الفاتورة" value={selectedSale?.invoiceNumber || '-'} />
                            <QuickInfo label="القسط" value={selectedInstallment?.label || '-'} />
                            <QuickInfo label="تاريخ الاستحقاق" value={formatDateDisplay(selectedInstallment?.dueDate)} />
                            <QuickInfo
                              label="المدفوع سابقًا"
                              value={selectedInstallment ? formatCurrency(selectedInstallment.paidAmount) : '-'}
                            />
                            <QuickInfo
                              label="المتبقي لهذا الشهر"
                              value={selectedInstallment ? formatCurrency(selectedInstallmentRemaining) : '-'}
                            />
                          </div>
                        </div>

                        <div className="rounded-[24px] border border-slate-200 bg-white p-4">
                          <div className="mb-3">
                            <h4 className="font-bold text-slate-800">حالة الأقساط</h4>
                            <p className="text-xs text-slate-500">عرض مختصر لتوفير المساحة داخل نافذة السداد.</p>
                          </div>

                          {selectedSchedules.length > 0 ? (
                            <div className="max-h-[320px] overflow-y-auto rounded-2xl border border-slate-100">
                              <table className="w-full text-sm">
                                <thead className="sticky top-0 bg-slate-50 text-slate-600">
                                  <tr>
                                    <th className="px-3 py-3 text-right font-bold">القسط</th>
                                    <th className="px-3 py-3 text-right font-bold">الاستحقاق</th>
                                    <th className="px-3 py-3 text-right font-bold">المتبقي</th>
                                    <th className="px-3 py-3 text-right font-bold">الحالة</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {selectedSchedules.map((schedule) => (
                                    <tr
                                      key={schedule.id}
                                      className={incomingForm.installmentId === schedule.id ? 'bg-emerald-50/70' : 'bg-white'}
                                    >
                                      <td className="px-3 py-3 font-semibold text-slate-800">{schedule.label}</td>
                                      <td className="px-3 py-3 text-slate-600">{formatDateDisplay(schedule.dueDate)}</td>
                                      <td className="px-3 py-3 text-slate-600">
                                        {formatCurrency(Math.max(schedule.amount - schedule.paidAmount, 0))}
                                      </td>
                                      <td className="px-3 py-3">
                                        <StatusBadge status={schedule.status} />
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <p className="text-sm text-slate-500">اختر فاتورة لعرض جدول الأشهر الخاصة بها.</p>
                          )}
                        </div>
                      </aside>
                    </div>

                    <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-4 sm:flex-row">
                      <button
                        type="button"
                        onClick={closeModal}
                        className="rounded-2xl border border-slate-300 px-4 py-3 text-slate-700 hover:bg-slate-50 sm:w-48"
                      >
                        إلغاء
                      </button>
                      <button
                        type="submit"
                        onClick={() => setIncomingSubmitMode('save')}
                        className="rounded-2xl bg-emerald-600 px-4 py-3 font-bold text-white hover:bg-emerald-700 sm:w-56"
                      >
                        حفظ السداد
                      </button>
                      <button
                        type="submit"
                        onClick={() => setIncomingSubmitMode('save_print')}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl bg-sky-600 px-4 py-3 font-bold text-white hover:bg-sky-700 sm:w-56"
                      >
                        <Printer size={17} />
                        حفظ وطباعة
                      </button>
                    </div>
                  </form>
                ) : (
                  <form onSubmit={handleOutgoingSubmit} className="space-y-6 p-6">
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field label="المورد">
                        <select
                          value={outgoingForm.supplierId}
                          onChange={(event) => setOutgoingForm((current) => ({ ...current, supplierId: event.target.value }))}
                          className="input-ui"
                        >
                          <option value="">اختر المورد</option>
                          {suppliers.map((supplier) => (
                            <option key={supplier.id} value={supplier.id}>
                              {supplier.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="تاريخ الدفع">
                        <DatePicker
                          value={outgoingForm.date}
                          onChange={(date) => setOutgoingForm((current) => ({ ...current, date }))}
                          className="w-full border-slate-200 px-4 py-2"
                        />
                      </Field>
                      <Field label="المبلغ">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={outgoingForm.amount === 0 ? '' : outgoingForm.amount}
                          onChange={(event) => setOutgoingForm((current) => ({ ...current, amount: Number(event.target.value) || 0 }))}
                          className="input-ui"
                          onKeyDown={(e) => ['e', 'E', '+', '-'].includes(e.key) && e.preventDefault()}
                        />
                      </Field>
                      <Field label="الوصف">
                        <input
                          type="text"
                          value={outgoingForm.description}
                          onChange={(event) => setOutgoingForm((current) => ({ ...current, description: event.target.value }))}
                          className="input-ui"
                          placeholder="مثال: دفعة توريد أو سداد فاتورة شراء"
                        />
                      </Field>
                    </div>

                    <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-4 sm:flex-row">
                      <button
                        type="button"
                        onClick={closeModal}
                        className="rounded-2xl border border-slate-300 px-4 py-3 text-slate-700 hover:bg-slate-50 sm:w-48"
                      >
                        إلغاء
                      </button>
                      <button
                        type="submit"
                        className="rounded-2xl bg-rose-600 px-4 py-3 font-bold text-white hover:bg-rose-700 sm:w-56"
                      >
                        حفظ الدفعة
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {showClosingModal && (
        <div className="fixed inset-0 z-50 bg-black/45 p-3 sm:p-5">
          <div className="flex min-h-full items-center justify-center">
            <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-[30px] bg-white shadow-2xl">
              <div className="bg-slate-800 px-6 py-5 text-white">
                <h3 className="text-xl font-bold flex items-center gap-2">
                  <Lock size={20} />
                  إغلاق الخزينة اليومية
                </h3>
                <p className="mt-1 text-sm text-white/85">
                  قم بتسوية وإغلاق المعاملات المالية ليوم محدد. لن يُسمح بأي تعديلات بعد الإغلاق.
                </p>
              </div>

              <div className="overflow-y-auto p-6 space-y-6">
                <form onSubmit={handleClosePeriod} className="space-y-6">
                  <div className="grid gap-6 md:grid-cols-2">
                    <Field label="تاريخ الإغلاق">
                      <DatePicker
                        value={closingDate}
                        onChange={(date) => setClosingDate(date)}
                        className="w-full border-slate-200 px-4 py-2"
                      />
                    </Field>
                    
                    <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 text-sm text-amber-800 flex items-start gap-2">
                      <Lock size={18} className="mt-0.5 shrink-0 text-amber-600" />
                      <div>
                        <p className="font-bold">تنبيه هام</p>
                        <p className="mt-1">
                          إغلاق اليومية يمنع إضافة، تعديل، سداد، أو عكس أي حركات مالية في التاريخ المحدد نهائيًا.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4">
                      <p className="text-xs text-slate-500 font-bold">إجمالي الوارد (مقبوضات اليوم)</p>
                      <p className="mt-1 text-lg font-extrabold text-emerald-600">{formatCurrency(closingTotalIn)}</p>
                    </div>
                    <div className="rounded-2xl border border-rose-100 bg-rose-50/40 p-4">
                      <p className="text-xs text-slate-500 font-bold">إجمالي الصادر (مدفوعات اليوم)</p>
                      <p className="mt-1 text-lg font-extrabold text-rose-600">{formatCurrency(closingTotalOut)}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-xs text-slate-500 font-bold">صافي حركة اليوم</p>
                      <p className="mt-1 text-lg font-extrabold text-slate-800">{formatCurrency(closingNet)}</p>
                    </div>
                  </div>

                  <Field label="ملاحظات وتفاصيل الإغلاق">
                    <textarea
                      value={closingNotes}
                      onChange={(e) => setClosingNotes(e.target.value)}
                      className="input-ui min-h-[80px] w-full"
                      placeholder="اكتب أي ملاحظات حول تسوية اليومية أو فروق العجز والزيادة إن وجدت..."
                    />
                  </Field>

                  <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-4 sm:flex-row">
                    <button
                      type="button"
                      onClick={() => setShowClosingModal(false)}
                      className="rounded-2xl border border-slate-300 px-4 py-3 text-slate-700 hover:bg-slate-50 sm:w-48"
                    >
                      إلغاء
                    </button>
                    <button
                      type="submit"
                      className="rounded-2xl bg-slate-800 px-4 py-3 font-bold text-white hover:bg-slate-900 sm:w-56"
                    >
                      تأكيد إغلاق اليومية
                    </button>
                  </div>
                </form>

                <div className="border-t border-slate-100 pt-6">
                  <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <h4 className="font-bold text-slate-800 flex items-center gap-1.5">
                      <CheckCircle2 size={16} className="text-slate-600" />
                      السجلات المغلقة مؤخرًا
                    </h4>
                    <div className="relative sm:w-72">
                      <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        value={closedPeriodSearch}
                        onChange={(event) => setClosedPeriodSearch(event.target.value)}
                        className="input-ui h-10 pr-9 text-sm"
                        placeholder="بحث في السجلات المغلقة"
                      />
                    </div>
                  </div>
                  {closedPeriods.length === 0 ? (
                    <p className="text-sm text-slate-500">لا توجد فترات مغلقة مسبقًا.</p>
                  ) : filteredClosedPeriods.length === 0 ? (
                    <p className="text-sm text-slate-500">لا توجد سجلات مغلقة مطابقة للبحث.</p>
                  ) : (
                    <div className="max-h-[200px] overflow-y-auto rounded-2xl border border-slate-100">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-slate-50 text-slate-600">
                          <tr>
                            <th className="px-4 py-3 text-right font-bold">التاريخ</th>
                            <th className="px-4 py-3 text-right font-bold">بواسطة</th>
                            <th className="px-4 py-3 text-right font-bold">تاريخ الإغلاق</th>
                            <th className="px-4 py-3 text-right font-bold">الملاحظات</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-slate-700">
                          {filteredClosedPeriods.slice(0, 20).map((period) => (
                            <tr key={period.id} className="hover:bg-slate-50/50">
                              <td className="px-4 py-3 font-semibold text-slate-800">{formatDateDisplay(period.periodDate)}</td>
                              <td className="px-4 py-3">{period.closedBy}</td>
                              <td className="px-4 py-3 text-xs text-slate-500">{formatDateDisplay(period.closedAt.slice(0, 10))}</td>
                              <td className="px-4 py-3 text-xs text-slate-500">{period.notes || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: 'emerald' | 'rose' | 'sky';
}) {
  const toneClass = {
    emerald: 'border-emerald-100 bg-emerald-50',
    rose: 'border-rose-100 bg-rose-50',
    sky: 'border-sky-100 bg-sky-50',
  }[tone];

  return (
    <div className={`rounded-[24px] border p-5 ${toneClass}`}>
      <div className="flex items-center gap-4">
        <div className="rounded-2xl bg-white p-3 shadow-sm">{icon}</div>
        <div>
          <p className="text-sm text-slate-500">{label}</p>
          <p className="mt-1 text-xl font-bold text-slate-800">{value}</p>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-bold text-slate-700">{label}</span>
      {children}
    </label>
  );
}

function QuickInfo({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2">
      <span className="text-slate-500">{label}</span>
      <span className="text-left font-semibold text-slate-800">{value}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: InstallmentSchedule['status'] }) {
  const toneClass = {
    paid: 'bg-emerald-100 text-emerald-700',
    partial: 'bg-amber-100 text-amber-700',
    unpaid: 'bg-rose-100 text-rose-700',
  }[status];

  const label = {
    paid: 'مدفوع',
    partial: 'جزئي',
    unpaid: 'غير مدفوع',
  }[status];

  return <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${toneClass}`}>{label}</span>;
}










