import React, { useEffect, useMemo, useState } from 'react';
import { Printer } from 'lucide-react';
import { Product, Sale } from '../types';
import { getProducts, getSales } from '../lib/storage';
import { api, isApiMode } from '../lib/apiClient';
import { useAuth } from '../context/AuthContext';
import { DatePicker } from '../components/DatePicker';
import LegalDocumentsPrintModal from '../components/LegalDocumentsPrintModal';
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

const getCurrentYearRange = () => {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), 0, 1);
  const lastDay = new Date(now.getFullYear(), 11, 31);

  return {
    from: formatLocalDate(firstDay),
    to: formatLocalDate(lastDay),
  };
};

export default function Sales() {
  const { settings } = useAuth();
  const currentMonthRange = useMemo(() => getCurrentMonthRange(), []);
  const currentYearRange = useMemo(() => getCurrentYearRange(), []);
  const [sales, setSales] = useState<Sale[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [dateFrom, setDateFrom] = useState(currentMonthRange.from);
  const [dateTo, setDateTo] = useState(currentMonthRange.to);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

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

  const loadData = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      if (isApiMode()) {
        const [apiSales, apiProducts] = await Promise.all([
          api.listSales(),
          api.listProducts(),
        ]);
        setSales(apiSales.map(mapApiSale).reverse());
        setProducts(apiProducts);
      } else {
        setSales(getSales().slice().reverse());
        setProducts(getProducts());
      }
    } catch (err: any) {
      console.error('Failed to load sales / products from API:', err);
      setLoadError('تعذر الاتصال بقاعدة البيانات لجلب المبيعات. يرجى التحقق من اتصال السيرفر.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
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
        if (!dateFrom && !dateTo) return true;
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

  const [saleForPrinting, setSaleForPrinting] = useState<Sale | null>(null);

  const saleLineRows = useMemo(
    () =>
      filteredSales.flatMap((sale) => {
        const items = sale.items && sale.items.length > 0 ? sale.items : [
          {
            productId: `fallback-${sale.id}`,
            productName: 'أجهزة وبضائع متنوعة',
            barcode: sale.invoiceNumber,
            quantity: 1,
            unitPrice: sale.subtotal > 0 ? sale.subtotal : sale.total,
            unitCost: sale.subtotal > 0 ? sale.subtotal : sale.total,
            discount: 0,
            tax: 0,
            total: sale.total,
          }
        ];

        return items.map((item) => {
          const product = productById.get(item.productId);
          const saleAmount = Number(item.total || 0);
          const purchaseUnitPrice = Number(product?.purchasePrice || (item as any).unitCost || item.unitPrice || 0);
          const quantity = Number(item.quantity || 1);
          const purchaseCost = purchaseUnitPrice * quantity;
          const saleUnitPrice = Number(product?.salePrice || item.unitPrice || 0);
          const lineBaseAmount = saleUnitPrice * quantity;
          const invoiceBaseAmount = items.reduce(
            (sum, saleItem) => {
              const saleItemProduct = productById.get(saleItem.productId);
              const saleItemUnitPrice = Number(saleItemProduct?.salePrice || saleItem.unitPrice || 0);
              return sum + saleItemUnitPrice * Number(saleItem.quantity || 1);
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
            sale,
            invoiceNumber: sale.invoiceNumber,
            customerName: sale.customerName,
            date: sale.date,
            productName: item.productName || 'بضاعة',
            quantity,
            purchaseUnitPrice,
            saleAmount,
            amountAfterUpfront,
            profit,
          };
        });
      }),
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
    setDateFrom('');
    setDateTo('');
  };

  return (
    <div className="desktop-view-container print:p-0 print:m-0 print:w-full print:max-w-full print:block">
      {/* Print-only Company & Report Header */}
      <div className="hidden print:flex items-center justify-between border-b-2 border-slate-800 pb-2.5 mb-3">
        <div>
          <h1 className="text-lg font-black text-slate-900">{settings.companyName || 'المتحدة للتجارة والتوزيع'}</h1>
          <h2 className="text-xs font-bold text-slate-700 mt-0.5">تقرير ربحية المبيعات التفصيلي</h2>
          <p className="text-[10px] text-slate-500 mt-0.5 font-medium">
            الفترة: <span className="font-bold text-slate-800">{!dateFrom && !dateTo ? 'كافة الفترات' : `${dateFrom ? formatDateDisplay(dateFrom) : 'البداية'} إلى ${dateTo ? formatDateDisplay(dateTo) : 'الآن'}`}</span>
          </p>
        </div>
        <div className="text-left text-[10px] text-slate-500 leading-tight">
          <p>تاريخ الطباعة: <span className="font-bold text-slate-700">{new Date().toLocaleDateString('ar-EG')}</span></p>
          <p>وقت الطباعة: <span className="font-bold text-slate-700">{new Date().toLocaleTimeString('ar-EG')}</span></p>
          <p className="text-indigo-700 font-bold mt-0.5">إجمالي العمليات: {saleLineRows.length}</p>
        </div>
      </div>

      {/* Tier 1: Fixed Compact Header & Filters */}
      <div className="erp-action-bar shrink-0 no-print print:hidden">
        <div>
          <h2 className="text-lg font-black text-slate-900">تقرير ربحية المبيعات</h2>
          <p className="text-xs text-slate-500">
            متابعة ربح كل صنف حسب العميل والتاريخ، بإجمالي ربح الفترة المحددة.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Quick presets */}
          <div className="flex items-center rounded-xl bg-slate-100 p-0.5 border border-slate-200">
            <button
              type="button"
              onClick={() => { setDateFrom(''); setDateTo(''); }}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${!dateFrom && !dateTo ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
            >
              الكل
            </button>
            <button
              type="button"
              onClick={() => { setDateFrom(currentYearRange.from); setDateTo(currentYearRange.to); }}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${dateFrom === currentYearRange.from && dateTo === currentYearRange.to ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
            >
              هذا العام
            </button>
            <button
              type="button"
              onClick={() => { setDateFrom(currentMonthRange.from); setDateTo(currentMonthRange.to); }}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${dateFrom === currentMonthRange.from && dateTo === currentMonthRange.to ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
            >
              هذا الشهر
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold text-slate-500">من:</span>
            <DatePicker value={dateFrom} onChange={setDateFrom} className="h-9 w-[125px] rounded-xl border-slate-200 text-xs font-bold" />
            <span className="text-xs font-bold text-slate-500">إلى:</span>
            <DatePicker value={dateTo} onChange={setDateTo} className="h-9 w-[125px] rounded-xl border-slate-200 text-xs font-bold" />
          </div>
          <button
            type="button"
            onClick={resetFilters}
            className="h-9 rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            مسح الفلاتر
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="flex items-center gap-1.5 h-9 rounded-xl bg-blue-600 hover:bg-blue-700 text-white px-3.5 text-xs font-bold shadow-2xs transition-all active:scale-95 cursor-pointer"
            title="طباعة تقرير ربحية المبيعات"
          >
            <Printer size={15} />
            <span>طباعة</span>
          </button>
        </div>
      </div>

      {/* Tier 2: Fixed Height KPI Metrics Bar */}
      <div className="grid gap-2.5 grid-cols-1 sm:grid-cols-3 shrink-0 print:grid-cols-3 print:gap-2.5 print:mb-3">
        <SalesMetric label="إجمالي المبيعات" value={formatCurrency(salesSummary.revenue)} tone="emerald" />
        <SalesMetric label="إجمالي التكلفة" value={formatCurrency(salesSummary.cost)} tone="slate" />
        <SalesMetric
          label={`صافي الربح - ${salesSummary.quantity.toLocaleString('ar-EG')} قطعة`}
          value={formatCurrency(salesSummary.profit)}
          tone={salesSummary.profit >= 0 ? 'sky' : 'rose'}
        />
      </div>

      {/* Tier 3: Flexible & Scrollable Table Card */}
      <div className="desktop-table-card print:border print:border-slate-300 print:rounded-lg print:p-0 print:shadow-none">
        <div className="desktop-table-scroll print:overflow-visible print:h-auto">
          <table className="w-full min-w-[860px] border-collapse print:min-w-0 print:w-full">
            <thead className="desktop-sticky-header print:static">
              <tr>
                <TableHead>التاريخ</TableHead>
                <TableHead>العميل</TableHead>
                <TableHead>الصنف</TableHead>
                <TableHead>سعر الشراء</TableHead>
                <TableHead>التكلفة</TableHead>
                <TableHead>الربح</TableHead>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 print:divide-slate-200">
              {saleLineRows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50 print:hover:bg-transparent print:break-inside-avoid">
                  <td className="px-3.5 py-2.5 text-xs text-slate-600 font-mono print:px-2 print:py-1.5 print:text-[10px]">{formatDateDisplay(row.date)}</td>
                  <td className="px-3.5 py-2.5 text-xs md:text-sm font-bold text-slate-800 print:px-2 print:py-1.5 print:text-[10px]">{row.customerName}</td>
                  <td className="px-3.5 py-2.5 text-xs md:text-sm text-slate-800 print:px-2 print:py-1.5 print:text-[10px]">
                    <div className="font-bold">{row.productName}</div>
                    <div className="text-[11px] text-slate-500 print:text-[9px]">الكمية: {row.quantity}</div>
                  </td>
                  <td className="px-3.5 py-2.5 text-xs text-slate-700 font-mono print:px-2 print:py-1.5 print:text-[10px]">{formatCurrency(row.purchaseUnitPrice)}</td>
                  <td className="px-3.5 py-2.5 text-xs font-bold text-slate-600 font-mono print:px-2 print:py-1.5 print:text-[10px]">{formatCurrency(row.amountAfterUpfront)}</td>
                  <td className={`px-3.5 py-2.5 text-xs md:text-sm font-black font-mono print:px-2 print:py-1.5 print:text-[10px] ${row.profit >= 0 ? 'text-sky-700' : 'text-rose-700'}`}>
                    {formatCurrency(row.profit)}
                  </td>
                </tr>
              ))}
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center text-xs font-bold text-slate-500">
                    <div className="flex flex-col items-center justify-center min-h-[200px] gap-2">
                      <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                      <p className="text-sm font-bold text-slate-700">جاري تحميل بيانات المبيعات والأرباح من قاعدة البيانات...</p>
                    </div>
                  </td>
                </tr>
              ) : loadError ? (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center text-xs font-bold text-rose-600">
                    <div className="flex flex-col items-center justify-center min-h-[200px] gap-2">
                      <p className="text-sm font-bold text-rose-700">{loadError}</p>
                      <button
                        onClick={() => void loadData()}
                        className="mt-2 px-4 py-1.5 bg-rose-600 text-white rounded-lg text-xs font-bold hover:bg-rose-700 transition-colors"
                      >
                        إعادة المحاولة
                      </button>
                    </div>
                  </td>
                </tr>
              ) : saleLineRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center text-xs font-bold text-slate-400">
                    <div className="flex flex-col items-center justify-center min-h-[220px] gap-2">
                      <p className="text-sm font-bold text-slate-700">لا توجد مبيعات مطابقة للفترة المحددة</p>
                      {(dateFrom || dateTo) && (
                        <p className="text-xs text-slate-500">
                          الفترة الحالية: {dateFrom ? formatDateDisplay(dateFrom) : 'البداية'} إلى {dateTo ? formatDateDisplay(dateTo) : 'الآن'}
                        </p>
                      )}
                      {(dateFrom || dateTo) && (
                        <button
                          type="button"
                          onClick={resetFilters}
                          className="mt-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-2xs transition-all active:scale-95 cursor-pointer"
                        >
                          عرض كافة المبيعات والأرباح (الكل)
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="erp-status-bar shrink-0 print:border-t-2 print:border-slate-800 print:bg-slate-50 print:py-2 print:px-3 print:text-[10px] print:flex print:justify-between">
          <span className="font-bold text-slate-700">عدد العمليات: <span className="text-blue-700 font-extrabold">{saleLineRows.length}</span></span>
          <span className="font-bold text-slate-700">صافي الربح الإجمالي: <span className={salesSummary.profit >= 0 ? 'text-sky-700 font-extrabold' : 'text-rose-700 font-extrabold'}>{formatCurrency(salesSummary.profit)}</span></span>
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
  return <th className="px-3.5 py-2.5 text-right text-xs font-black text-slate-700 print:px-2 print:py-1.5 print:text-[10px] print:bg-slate-100 print:border-b print:border-slate-300">{children}</th>;
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
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800 print:bg-emerald-50/50 print:border-emerald-200',
    slate: 'border-slate-200 bg-white text-slate-800 print:border-slate-300',
    sky: 'border-sky-200 bg-sky-50 text-sky-800 print:bg-sky-50/50 print:border-sky-200',
    rose: 'border-rose-200 bg-rose-50 text-rose-800 print:bg-rose-50/50 print:border-rose-200',
  }[tone];

  return (
    <div className={`rounded-xl border p-3.5 shadow-2xs print:p-2.5 print:rounded-lg ${toneClass}`}>
      <p className="text-xs font-bold opacity-75 print:text-[10px]">{label}</p>
      <p className="mt-1 text-xl font-black print:text-sm print:mt-0.5 tabular-nums">{value}</p>
    </div>
  );
}
