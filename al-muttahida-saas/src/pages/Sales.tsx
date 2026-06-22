import React, { useEffect, useMemo, useState } from 'react';
import { Product, Sale } from '../types';
import { getProducts, getSales } from '../lib/storage';
import { api, isApiMode } from '../lib/apiClient';
import { useAuth } from '../context/AuthContext';
import { DatePicker } from '../components/DatePicker';
import { formatDateDisplay } from '../lib/dateUtils';
import { formatWholeCurrency } from '../lib/utils';

const pad = (value: number) => String(value).padStart(2, '0');

const formatLocalDate = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const getCurrentMonthRange = () => {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  return {
    from: formatLocalDate(firstDay),
    to: formatLocalDate(lastDay),
  };
};

export default function Sales() {
  const { settings } = useAuth();
  const currentMonthRange = useMemo(() => getCurrentMonthRange(), []);
  const [sales, setSales] = useState<Sale[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [dateFrom, setDateFrom] = useState(currentMonthRange.from);
  const [dateTo, setDateTo] = useState(currentMonthRange.to);

  const mapApiSale = (row: any): Sale => ({
    id: row.id,
    invoiceNumber: row.invoiceNumber || row.invoice_number,
    customerId: row.customerId || row.customer_id,
    customerName: row.customerName || row.customer_name,
    items: row.items || [],
    subtotal: Number(row.subtotal || row.total || 0),
    discount: Number(row.discount || 0),
    tax: Number(row.tax || 0),
    total: Number(row.total || 0),
    paid: Number(row.paid || 0),
    remaining: Number(row.remaining || 0),
    status: row.status,
    date: row.date,
    notes: row.notes || undefined,
    createdBy: row.createdBy || row.created_by || 'system',
    createdAt: row.createdAt || row.created_at || new Date().toISOString(),
    version: row.version,
    locked: !!row.locked,
    lastEditedBy: row.lastEditedBy || row.last_edited_by || undefined,
    lastEditedAt: row.lastEditedAt || row.last_edited_at || undefined,
    financing: row.financing,
  });

  useEffect(() => {
    const loadData = async () => {
      setSales(isApiMode() ? (await api.listSales()).map(mapApiSale).reverse() : getSales().slice().reverse());
      setProducts(getProducts());
    };

    void loadData();
  }, []);

  const formatCurrency = (amount: number) => formatWholeCurrency(amount, settings.currency);

  const productById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );

  const filteredSales = useMemo(
    () =>
      sales.filter((sale) => {
        const parsedDate = new Date(sale.date);
        const saleDate = !isNaN(parsedDate.getTime())
          ? `${parsedDate.getFullYear()}-${pad(parsedDate.getMonth() + 1)}-${pad(parsedDate.getDate())}`
          : sale.date.slice(0, 10);
        const matchesFrom = !dateFrom || saleDate >= dateFrom;
        const matchesTo = !dateTo || saleDate <= dateTo;

        return matchesFrom && matchesTo;
      }),
    [sales, dateFrom, dateTo],
  );

  const saleLineRows = useMemo(
    () =>
      filteredSales.flatMap((sale) =>
        sale.items.map((item) => {
          const product = productById.get(item.productId);
          const saleAmount = Number(item.total || 0);
          const purchaseUnitPrice = Number(product?.purchasePrice || 0);
          const quantity = Number(item.quantity || 0);
          const purchaseCost = purchaseUnitPrice * quantity;
          const saleUnitPrice = Number(product?.salePrice || item.unitPrice || 0);
          const lineBaseAmount = saleUnitPrice * quantity;
          const invoiceBaseAmount = (sale.items || []).reduce(
            (sum, saleItem) => {
              const saleItemProduct = productById.get(saleItem.productId);
              const saleItemUnitPrice = Number(saleItemProduct?.salePrice || saleItem.unitPrice || 0);
              return sum + saleItemUnitPrice * Number(saleItem.quantity || 0);
            },
            0,
          );
          const upfrontAmount = Number(sale.financing?.upfrontAmount ?? sale.paid ?? 0);
          const paidShare = invoiceBaseAmount > 0 ? (lineBaseAmount / invoiceBaseAmount) * upfrontAmount : 0;
          const amountAfterUpfront = Math.max(lineBaseAmount - paidShare, 0);
          const contractLineBase =
            Number(item.unitPrice || 0) * quantity -
            (Number(item.unitPrice || 0) * quantity * Number(item.discount || 0)) / 100;
          const profit = Number(Math.max(saleAmount - contractLineBase, 0).toFixed(2));

          return {
            id: `${sale.id}-${item.productId}`,
            customerName: sale.customerName,
            date: sale.date,
            productName: item.productName,
            quantity,
            purchaseUnitPrice,
            saleAmount,
            amountAfterUpfront,
            profit,
          };
        }),
      ),
    [filteredSales, productById],
  );

  const salesSummary = useMemo(
    () => ({
      revenue: saleLineRows.reduce((sum, row) => sum + row.saleAmount, 0),
      cost: saleLineRows.reduce((sum, row) => sum + row.amountAfterUpfront, 0),
      profit: saleLineRows.reduce((sum, row) => sum + row.profit, 0),
      quantity: saleLineRows.reduce((sum, row) => sum + row.quantity, 0),
    }),
    [saleLineRows],
  );

  const resetFilters = () => {
    setDateFrom(currentMonthRange.from);
    setDateTo(currentMonthRange.to);
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">تقرير ربحية المبيعات</h2>
        <p className="mt-1 text-sm text-slate-500">
          متابعة ربح كل صنف حسب العميل والتاريخ، بإجمالي ربح الفترة المحددة.
        </p>
      </div>

      <div className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-4">
          <DateInput label="من تاريخ" value={dateFrom} onChange={setDateFrom} />
          <DateInput label="إلى تاريخ" value={dateTo} onChange={setDateTo} />
          <button
            type="button"
            onClick={resetFilters}
            className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            مسح الفلاتر
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <SalesMetric label="إجمالي المبيعات" value={formatCurrency(salesSummary.revenue)} tone="emerald" />
        <SalesMetric label="إجمالي التكلفة" value={formatCurrency(salesSummary.cost)} tone="slate" />
        <SalesMetric
          label={`صافي الربح - ${salesSummary.quantity.toLocaleString('ar-EG')} قطعة`}
          value={formatCurrency(salesSummary.profit)}
          tone={salesSummary.profit >= 0 ? 'sky' : 'rose'}
        />
      </div>

      <div className="overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-3">
          <h3 className="font-bold text-slate-900">تفاصيل الأصناف</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px]">
            <thead className="bg-slate-100">
              <tr>
                <TableHead>التاريخ</TableHead>
                <TableHead>العميل</TableHead>
                <TableHead>الصنف</TableHead>
                <TableHead>سعر الشراء</TableHead>
                <TableHead>التكلفة</TableHead>
                <TableHead>الربح</TableHead>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {saleLineRows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="px-4 py-4 text-slate-600">{formatDateDisplay(row.date)}</td>
                  <td className="px-4 py-4 font-medium text-slate-800">{row.customerName}</td>
                  <td className="px-4 py-4 text-slate-800">
                    <div className="font-bold">{row.productName}</div>
                    <div className="mt-1 text-xs text-slate-500">الكمية: {row.quantity}</div>
                  </td>
                  <td className="px-4 py-4 text-slate-700">{formatCurrency(row.purchaseUnitPrice)}</td>
                  <td className="px-4 py-4 font-bold text-slate-600">{formatCurrency(row.amountAfterUpfront)}</td>
                  <td className={`px-4 py-4 font-black ${row.profit >= 0 ? 'text-sky-700' : 'text-rose-700'}`}>
                    {formatCurrency(row.profit)}
                  </td>
                </tr>
              ))}
              {saleLineRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
                    لا توجد مبيعات مطابقة للفلاتر الحالية.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block flex-1 min-w-[155px]">
      <span className="mb-1 block text-xs font-bold text-slate-500">{label}</span>
      <DatePicker value={value} onChange={onChange} className="w-full rounded-2xl border-slate-300 px-4 py-2 text-sm font-bold shadow-sm" />
    </label>
  );
}

function TableHead({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-4 text-right text-sm font-bold text-slate-700">{children}</th>;
}

function SalesMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'emerald' | 'slate' | 'sky' | 'rose';
}) {
  const toneClass = {
    emerald: 'border-emerald-100 bg-emerald-50 text-emerald-800',
    slate: 'border-slate-200 bg-white text-slate-800',
    sky: 'border-sky-100 bg-sky-50 text-sky-800',
    rose: 'border-rose-100 bg-rose-50 text-rose-800',
  }[tone];

  return (
    <div className={`rounded-[20px] border p-4 shadow-sm ${toneClass}`}>
      <p className="text-sm font-bold opacity-75">{label}</p>
      <p className="mt-2 text-2xl font-black">{value}</p>
    </div>
  );
}
