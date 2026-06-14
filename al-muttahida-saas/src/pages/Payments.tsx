import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  CalendarDays,
  CreditCard,
  Plus,
  Printer,
  Search,
} from 'lucide-react';
import { Customer, InstallmentSchedule, Payment, Sale, Supplier } from '../types';
import { createPayment, getCustomers, getPayments, getSales, getSuppliers } from '../lib/storage';
import { api, isApiMode } from '../lib/apiClient';
import { useAuth } from '../context/AuthContext';
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

const today = () => new Date().toISOString().split('T')[0];

export default function Payments() {
  const { settings, user } = useAuth();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [paymentType, setPaymentType] = useState<PaymentType>('in');
  const [searchTerm, setSearchTerm] = useState('');
  const [incomingSubmitMode, setIncomingSubmitMode] = useState<IncomingSubmitMode>('save');

  const [incomingForm, setIncomingForm] = useState<IncomingPaymentForm>({
    customerId: '',
    saleId: '',
    installmentId: '',
    amount: 0,
    date: today(),
    description: '',
  });

  const [outgoingForm, setOutgoingForm] = useState<OutgoingPaymentForm>({
    supplierId: '',
    amount: 0,
    date: today(),
    description: '',
  });

  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const mapApiSale = (row: any): Sale => ({
    id: row.id,
    invoiceNumber: row.invoice_number,
    customerId: row.customer_id,
    customerName: row.customer_name,
    items: [],
    subtotal: Number(row.total || 0),
    discount: 0,
    tax: 0,
    total: Number(row.total || 0),
    paid: Number(row.paid || 0),
    remaining: Number(row.remaining || 0),
    status: row.status,
    date: row.date,
    notes: undefined,
    createdBy: row.created_by || 'system',
    createdAt: row.created_at || new Date().toISOString(),
    version: row.version,
    locked: !!row.locked,
    lastEditedBy: row.last_edited_by || undefined,
    lastEditedAt: row.last_edited_at || undefined,
  });

  const mapApiPayment = (row: any): Payment => ({
    id: row.id,
    type: row.type,
    amount: Number(row.amount || 0),
    referenceId: row.sale_id || row.id,
    referenceType: row.sale_id ? 'sale' : 'other',
    description: row.description || '',
    date: row.date,
    createdBy: row.created_by || 'system',
    createdAt: row.created_at || new Date().toISOString(),
    saleId: row.sale_id || undefined,
    installmentId: row.installment_id || undefined,
    invoiceNumber: undefined,
    receiptNumber: row.receipt_number || undefined,
    status: row.status || 'posted',
    channel: row.channel || 'cash',
  });

  const loadData = async () => {
    const nextPayments = isApiMode() ? (await api.listPayments()).map(mapApiPayment).reverse() : getPayments().slice().reverse();
    const nextSales = isApiMode() ? (await api.listSales()).map(mapApiSale).reverse() : getSales().slice().reverse();
    const nextCustomers = getCustomers();
    const nextSuppliers = getSuppliers();

    setPayments(nextPayments);
    setSales(nextSales);
    setCustomers(nextCustomers);
    setSuppliers(nextSuppliers);

    if (!incomingForm.customerId && nextCustomers.length > 0) {
      setIncomingForm((current) => ({ ...current, customerId: nextCustomers[0].id }));
    }

    if (!outgoingForm.supplierId && nextSuppliers.length > 0) {
      setOutgoingForm((current) => ({ ...current, supplierId: nextSuppliers[0].id }));
    }
  };

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const filteredPayments = payments.filter((payment) => {
    const customerName =
      customers.find((customer) => customer.id === (payment.customerId || payment.referenceId))?.name || '';
    const supplierName =
      suppliers.find((supplier) => supplier.id === (payment.supplierId || payment.referenceId))?.name || '';
    const invoiceNumber = payment.invoiceNumber || '';
    const search = searchTerm.toLowerCase();

    return (
      payment.description.toLowerCase().includes(search) ||
      customerName.toLowerCase().includes(search) ||
      supplierName.toLowerCase().includes(search) ||
      invoiceNumber.toLowerCase().includes(search)
    );
  });

  const totalIn = payments.filter((payment) => payment.type === 'in').reduce((sum, payment) => sum + payment.amount, 0);
  const totalOut = payments.filter((payment) => payment.type === 'out').reduce((sum, payment) => sum + payment.amount, 0);

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

    if (!outgoingForm.supplierId || outgoingForm.amount <= 0) {
      setMessage({ type: 'error', text: 'اختر المورد وأدخل مبلغًا صحيحًا.' });
      return;
    }

    if (isApiMode()) {
      await api.createPayment({
        type: 'out',
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">إدارة المدفوعات</h2>
          <p className="mt-1 text-sm text-slate-500">
            إدارة المقبوضات والمدفوعات مع ربط ذكي بالفواتير والأقساط الشهرية.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => openModal('in')}
            className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-700"
          >
            <Plus size={18} />
            سداد عميل
          </button>
          <button
            onClick={() => openModal('out')}
            className="inline-flex items-center gap-2 rounded-2xl bg-rose-600 px-4 py-2 text-white hover:bg-rose-700"
          >
            <Plus size={18} />
            دفعة مورد
          </button>
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

      <div className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="relative">
          <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="بحث بالعميل أو الفاتورة أو الوصف"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            className="input-ui pr-10"
          />
        </div>
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
              {filteredPayments.map((payment) => {
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
                      <p className="font-medium text-slate-800">{payment.description}</p>
                      <p className="mt-1 text-xs text-slate-500">{payment.type === 'in' ? 'وارد' : 'صادر'}</p>
                    </td>
                    <td className="px-4 py-4 text-sm text-slate-700">
                      {payment.type === 'in' ? customerName : supplierName}
                    </td>
                    <td className="px-4 py-4">
                      <div className="space-y-1 text-sm">
                        <p className="font-semibold text-slate-700">{payment.invoiceNumber || '-'}</p>
                        <p className="text-xs text-slate-500">{linkedSchedule?.label || '-'}</p>
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
                            <select
                              value={incomingForm.customerId}
                              onChange={(event) =>
                                setIncomingForm({
                                  customerId: event.target.value,
                                  saleId: '',
                                  installmentId: '',
                                  amount: 0,
                                  date: incomingForm.date,
                                  description: '',
                                })
                              }
                              className="input-ui"
                            >
                              <option value="">اختر العميل</option>
                              {customers.map((customer) => (
                                <option key={customer.id} value={customer.id}>
                                  {customer.name}
                                </option>
                              ))}
                            </select>
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
                              value={incomingForm.amount}
                              onChange={(event) =>
                                setIncomingForm((current) => ({ ...current, amount: Number(event.target.value) || 0 }))
                              }
                              className="input-ui"
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
                          value={outgoingForm.amount}
                          onChange={(event) => setOutgoingForm((current) => ({ ...current, amount: Number(event.target.value) || 0 }))}
                          className="input-ui"
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
