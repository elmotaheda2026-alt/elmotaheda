import React, { useEffect, useMemo, useState } from 'react';
import { Printer, Search } from 'lucide-react';
import { Product, Sale, SalesRep } from '../types';
import { getProducts, getSales, getSalesReps } from '../lib/storage';
import { api, isApiMode } from '../lib/apiClient';
import { useRealtimeSync } from '../lib/realtimeSync';
import { useAuth } from '../context/AuthContext';
import { DatePicker } from '../components/DatePicker';
import { formatDateDisplay } from '../lib/dateUtils';
import { formatWholeCurrency } from '../lib/utils';
import LoadingState from '../components/LoadingState';
import CurrencyText from '../components/CurrencyText';

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
  const [salesReps, setSalesReps] = useState<SalesRep[]>([]);
  const [dateFrom, setDateFrom] = useState(currentMonthRange.from);
  const [dateTo, setDateTo] = useState(currentMonthRange.to);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRepId, setSelectedRepId] = useState('all');
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

  const loadData = async (silent = false) => {
    if (!silent) {
      setIsLoading(true);
    }
    setLoadError(null);
    try {
      if (isApiMode()) {
        const [apiSales, apiProducts, apiReps] = await Promise.all([
          api.listSales(),
          api.listProducts(),
          api.listSalesReps(),
        ]);
        setSales(apiSales.map(mapApiSale).reverse());
        setProducts(apiProducts);
        setSalesReps(apiReps);
      } else {
        setSales(getSales().slice().reverse());
        setProducts(getProducts());
        setSalesReps(getSalesReps());
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

  useRealtimeSync(['sales', 'payments', 'customers', 'products', 'sales-reps'], () => {
    void loadData(true);
  });

  const formatCurrency = (amount: number) => formatWholeCurrency(amount, settings.currency);

  const productById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );

  const filteredSales = useMemo(
    () =>
      sales.filter((sale) => {
        if (sale.status === 'cancelled') return false;
        if (selectedRepId !== 'all' && sale.financing?.salesRepId !== selectedRepId) return false;
        const q = searchQuery.trim().toLowerCase();
        if (q) {
          const matchesSearch =
            (sale.customerName || '').toLowerCase().includes(q) ||
            (sale.invoiceNumber || '').toLowerCase().includes(q) ||
            (sale.financing?.salesRepName || '').toLowerCase().includes(q) ||
            (sale.items || []).some((it) => (it.productName || '').toLowerCase().includes(q));
          if (!matchesSearch) return false;
        }
        if (!dateFrom && !dateTo) return true;
        const parsedDate = new Date(sale.date);
        const saleDate = !isNaN(parsedDate.getTime())
          ? `${parsedDate.getFullYear()}-${pad(parsedDate.getMonth() + 1)}-${pad(parsedDate.getDate())}`
          : sale.date.slice(0, 10);
        const matchesFrom = !dateFrom || saleDate >= dateFrom;
        const matchesTo = !dateTo || saleDate <= dateTo;

        return matchesFrom && matchesTo;
      }),
    [sales, dateFrom, dateTo, searchQuery, selectedRepId],
  );

  const saleLineRows = useMemo(
    () =>
      filteredSales.flatMap((sale) => {
        const isSettledEarly = sale.status === 'settled_early';
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

        const saleContractTotal = Number(sale.total || 0);
        const saleEffectiveTotal = isSettledEarly ? Number(sale.paid || 0) : saleContractTotal;
        const earlyFactor = saleContractTotal > 0 ? saleEffectiveTotal / saleContractTotal : 1;

        return items.map((item) => {
          const product = productById.get(item.productId);
          const contractAmount = Number(item.total || 0);
          const effectiveSaleAmount = isSettledEarly
            ? Number((items.length === 1 ? saleEffectiveTotal : contractAmount * earlyFactor).toFixed(2))
            : contractAmount;
          const purchaseUnitPrice = Number(
            (item as any).unitCost ||
              product?.purchasePrice ||
              (items.length === 1 && sale.subtotal > 0 ? sale.subtotal : item.unitPrice) ||
              0,
          );
          const quantity = Number(item.quantity || 1);
          const purchaseCost = Number((purchaseUnitPrice * quantity).toFixed(2));
          const profit = Number((effectiveSaleAmount - purchaseCost).toFixed(2));

          return {
            id: `${sale.id}-${item.productId}`,
            sale,
            isSettledEarly,
            invoiceNumber: sale.invoiceNumber,
            customerName: sale.customerName,
            date: sale.date,
            productName: item.productName || 'بضاعة',
            quantity,
            purchaseUnitPrice,
            contractAmount,
            saleAmount: effectiveSaleAmount,
            purchaseCost,
            profit,
          };
        });
      }),
    [filteredSales, productById],
  );

  const salesSummary = useMemo(
    () => {
      const revenue = saleLineRows.reduce((sum, row) => sum + row.saleAmount, 0);
      const grossRevenue = saleLineRows.reduce((sum, row) => sum + row.contractAmount, 0);
      const cost = saleLineRows.reduce((sum, row) => sum + row.purchaseCost, 0);
      const profit = saleLineRows.reduce((sum, row) => sum + row.profit, 0);
      const quantity = saleLineRows.reduce((sum, row) => sum + row.quantity, 0);
      return {
        revenue: Number(revenue.toFixed(2)),
        grossRevenue: Number(grossRevenue.toFixed(2)),
        earlyDiscounts: Number(Math.max(0, grossRevenue - revenue).toFixed(2)),
        cost: Number(cost.toFixed(2)),
        profit: Number(profit.toFixed(2)),
        quantity,
      };
    },
    [saleLineRows],
  );

  const resetFilters = () => {
    setDateFrom('');
    setDateTo('');
    setSearchQuery('');
    setSelectedRepId('all');
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
      <div className="bg-white border border-slate-200/90 rounded-2xl px-4 py-3 space-y-2.5 shadow-xs shrink-0 no-print print:hidden">
        {/* Row 1: Title, Search & Print Action */}
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-3 flex-1 min-w-0">
            <div className="shrink-0">
              <h2 className="text-lg font-black text-slate-900 leading-tight">تقرير ربحية المبيعات</h2>
              <p className="text-[11px] text-slate-500 hidden sm:block">
                متابعة ربح كل صنف حسب العميل والتاريخ، بإجمالي ربح الفترة المحددة.
              </p>
            </div>

            <div className="relative flex-1 min-w-[220px] max-w-sm">
              <Search size={15} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="بحث بالعميل / الفاتورة / الصنف..."
                className="input-ui h-9 w-full pr-10 pl-3.5 text-xs font-semibold bg-slate-50/70 hover:bg-white focus:bg-white border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 placeholder:text-slate-400"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => window.print()}
              className="flex items-center gap-1.5 h-9 rounded-xl bg-[#1e40af] hover:bg-[#1d4ed8] text-white px-4 text-xs font-bold shadow-xs transition-all active:scale-95 whitespace-nowrap cursor-pointer"
              title="طباعة تقرير ربحية المبيعات"
            >
              <Printer size={15} />
              <span>طباعة</span>
            </button>
          </div>
        </div>

        {/* Row 2: Period Presets, Sales Rep & Unified Date Range */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 border-t border-slate-100">
          <div className="flex flex-wrap items-center gap-2">
            {/* Quick Period Presets */}
            <div className="inline-flex h-9 items-center rounded-xl bg-slate-100/90 p-0.5 border border-slate-200/70">
              <button
                type="button"
                onClick={() => { setDateFrom(''); setDateTo(''); }}
                className={`h-full px-3 text-xs font-bold rounded-lg transition-all whitespace-nowrap cursor-pointer ${!dateFrom && !dateTo ? 'bg-white text-[#1e40af] shadow-2xs' : 'text-slate-600 hover:text-slate-900'}`}
              >
                الكل
              </button>
              <button
                type="button"
                onClick={() => { setDateFrom(currentYearRange.from); setDateTo(currentYearRange.to); }}
                className={`h-full px-3 text-xs font-bold rounded-lg transition-all whitespace-nowrap cursor-pointer ${dateFrom === currentYearRange.from && dateTo === currentYearRange.to ? 'bg-white text-[#1e40af] shadow-2xs' : 'text-slate-600 hover:text-slate-900'}`}
              >
                هذا العام
              </button>
              <button
                type="button"
                onClick={() => { setDateFrom(currentMonthRange.from); setDateTo(currentMonthRange.to); }}
                className={`h-full px-3 text-xs font-bold rounded-lg transition-all whitespace-nowrap cursor-pointer ${dateFrom === currentMonthRange.from && dateTo === currentMonthRange.to ? 'bg-white text-[#1e40af] shadow-2xs' : 'text-slate-600 hover:text-slate-900'}`}
              >
                هذا الشهر
              </button>
            </div>

            {salesReps.length > 0 && (
              <select
                value={selectedRepId}
                onChange={(e) => setSelectedRepId(e.target.value)}
                className="h-9 px-3 text-xs font-bold rounded-xl border border-slate-200/90 bg-slate-50/70 hover:bg-white focus:bg-white text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 transition-all cursor-pointer min-w-[135px]"
              >
                <option value="all">كل المناديب</option>
                {salesReps.map((rep) => (
                  <option key={rep.id} value={rep.id}>{rep.name}</option>
                ))}
              </select>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Unified Date Range Pill */}
            <div className="flex h-9 items-center gap-1.5 bg-slate-50/70 border border-slate-200/90 rounded-xl px-2.5 text-xs">
              <span className="text-[11px] font-semibold text-slate-500">الفترة:</span>
              <DatePicker
                value={dateFrom}
                onChange={setDateFrom}
                className="h-7 w-[112px] rounded-lg border border-slate-200/70 bg-white text-xs font-bold text-slate-700 text-center"
              />
              <span className="text-[11px] font-bold text-slate-400">←</span>
              <DatePicker
                value={dateTo}
                onChange={setDateTo}
                className="h-7 w-[112px] rounded-lg border border-slate-200/70 bg-white text-xs font-bold text-slate-700 text-center"
              />
            </div>

            {(dateFrom || dateTo || searchQuery || selectedRepId !== 'all') && (
              <button
                type="button"
                onClick={resetFilters}
                className="h-9 px-3 text-xs font-bold text-rose-600 bg-rose-50/70 hover:bg-rose-100/80 rounded-xl transition-colors border border-rose-200/80 whitespace-nowrap cursor-pointer"
              >
                مسح الفلاتر
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Tier 2: Fixed Height KPI Metrics Bar */}
      <div className="grid gap-2.5 grid-cols-1 sm:grid-cols-[repeat(auto-fit,minmax(220px,1fr))] shrink-0 print:grid-cols-3 print:gap-2.5 print:mb-3">
        <SalesMetric
          label="صافي المبيعات"
          value={formatCurrency(salesSummary.revenue)}
          subtitle={
            salesSummary.earlyDiscounts > 0
              ? `التعاقدي ${formatCurrency(salesSummary.grossRevenue)} − خصم سداد مبكر ${formatCurrency(salesSummary.earlyDiscounts)}`
              : undefined
          }
          tone="emerald"
        />
        <SalesMetric label="إجمالي التكلفة" value={formatCurrency(salesSummary.cost)} tone="slate" />
        <SalesMetric
          label={`إجمالي ربح المبيعات - ${salesSummary.quantity.toLocaleString('ar-EG')} قطعة`}
          value={formatCurrency(salesSummary.profit)}
          tone={salesSummary.profit >= 0 ? 'sky' : 'rose'}
        />
      </div>

      {/* Tier 3: Flexible & Scrollable Table Card */}
      <div className="desktop-table-card print:border print:border-slate-300 print:rounded-lg print:p-0 print:shadow-none">
        {/* Mobile Cards View (< md) */}
        <div className="md:hidden flex-1 min-h-0 overflow-y-auto p-2.5 space-y-2.5 custom-scrollbar print:hidden">
          {isLoading ? (
            <div className="py-10 text-center text-slate-400 text-xs font-bold">جاري التحميل...</div>
          ) : saleLineRows.length === 0 ? (
            <div className="py-12 px-4 text-center text-xs font-bold text-slate-400">
              لا توجد مبيعات مطابقة للفترة المحددة
            </div>
          ) : (
            saleLineRows.map((row) => (
              <div key={`mob-sale-${row.id}`} className="bg-white border border-slate-200 rounded-2xl p-3.5 shadow-2xs space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono text-[11px] font-black text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">{row.invoiceNumber}</span>
                      <p className="font-black text-slate-900 text-sm break-words">{row.customerName}</p>
                    </div>
                    <p className="text-xs font-bold text-slate-700 mt-0.5">{row.productName} (الكمية: {row.quantity})</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[11px] font-mono text-slate-500">{formatDateDisplay(row.date)}</span>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-1.5 bg-slate-50 rounded-xl p-2 text-center text-xs border border-slate-100">
                  <div>
                    <span className="text-[10px] text-slate-400 block font-bold">صافي البيع</span>
                    <span className="font-bold text-slate-700">{formatCurrency(row.saleAmount)}</span>
                  </div>
                  <div className="border-x border-slate-200">
                    <span className="text-[10px] text-slate-400 block font-bold">التكلفة</span>
                    <span className="font-bold text-slate-600">{formatCurrency(row.purchaseCost)}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block font-bold">الربح</span>
                    <span className={`font-black ${row.profit >= 0 ? 'text-sky-700' : 'text-rose-700'}`}>{formatCurrency(row.profit)}</span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="hidden md:block desktop-table-scroll print:block print:overflow-visible print:h-auto">
          <table className="w-full min-w-[860px] border-collapse print:min-w-0 print:w-full">
            <thead className="desktop-sticky-header print:static">
              <tr>
                <TableHead>رقم الفاتورة</TableHead>
                <TableHead>التاريخ</TableHead>
                <TableHead>العميل</TableHead>
                <TableHead>الصنف</TableHead>
                <TableHead>صافي البيع</TableHead>
                <TableHead>التكلفة</TableHead>
                <TableHead>الربح</TableHead>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 print:divide-slate-200">
              {saleLineRows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50 print:hover:bg-transparent print:break-inside-avoid">
                  <td className="px-3.5 py-2.5 text-xs font-mono font-black text-blue-700 print:px-2 print:py-1.5 print:text-[10px]">{row.invoiceNumber || '-'}</td>
                  <td className="px-3.5 py-2.5 text-xs text-slate-600 font-mono print:px-2 print:py-1.5 print:text-[10px]">{formatDateDisplay(row.date)}</td>
                  <td className="px-3.5 py-2.5 text-xs md:text-sm font-bold text-slate-800 print:px-2 print:py-1.5 print:text-[10px]">
                    <div>{row.customerName}</div>
                    {row.sale.financing?.salesRepName && (
                      <div className="text-[10px] text-slate-400 font-semibold">{row.sale.financing.salesRepName}</div>
                    )}
                  </td>
                  <td className="px-3.5 py-2.5 text-xs md:text-sm text-slate-800 print:px-2 print:py-1.5 print:text-[10px]">
                    <div className="font-bold">{row.productName}</div>
                    <div className="text-[11px] text-slate-500 print:text-[9px]">الكمية: {row.quantity}</div>
                  </td>
                  <td className="px-3.5 py-2.5 text-xs text-slate-700 font-mono print:px-2 print:py-1.5 print:text-[10px]">
                    <div className="font-bold">{formatCurrency(row.saleAmount)}</div>
                    {row.isSettledEarly && row.contractAmount > row.saleAmount && (
                      <div className="text-[10px] text-amber-700 font-semibold">سداد مبكر (بدلاً من {formatCurrency(row.contractAmount)})</div>
                    )}
                  </td>
                  <td className="px-3.5 py-2.5 text-xs font-bold text-slate-600 font-mono print:px-2 print:py-1.5 print:text-[10px]">{formatCurrency(row.purchaseCost)}</td>
                  <td className={`px-3.5 py-2.5 text-xs md:text-sm font-black font-mono print:px-2 print:py-1.5 print:text-[10px] ${row.profit >= 0 ? 'text-sky-700' : 'text-rose-700'}`}>
                    {formatCurrency(row.profit)}
                  </td>
                </tr>
              ))}
              {isLoading ? (
                <LoadingState variant="table" colSpan={7} />
              ) : loadError ? (
                <tr>
                  <td colSpan={7} className="px-4 py-16 text-center text-xs font-bold text-rose-600">
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
                  <td colSpan={7} className="px-4 py-16 text-center text-xs font-bold text-slate-400">
                    <div className="flex flex-col items-center justify-center min-h-[220px] gap-2">
                      <p className="text-sm font-bold text-slate-700">لا توجد مبيعات مطابقة للفترة المحددة</p>
                      {(dateFrom || dateTo || searchQuery || selectedRepId !== 'all') && (
                        <p className="text-xs text-slate-500">
                          الفترة الحالية: {dateFrom ? formatDateDisplay(dateFrom) : 'البداية'} إلى {dateTo ? formatDateDisplay(dateTo) : 'الآن'}
                        </p>
                      )}
                      {(dateFrom || dateTo || searchQuery || selectedRepId !== 'all') && (
                        <button
                          type="button"
                          onClick={resetFilters}
                          className="mt-2 px-4 py-2 bg-[#1e40af] hover:bg-[#1d4ed8] text-white rounded-xl text-xs font-bold shadow-2xs transition-all active:scale-95 cursor-pointer"
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

function TableHead({ children }: { children: React.ReactNode }) {
  return <th className="px-3.5 py-2.5 text-right text-xs font-black text-slate-700 print:px-2 print:py-1.5 print:text-[10px] print:bg-slate-100 print:border-b print:border-slate-300">{children}</th>;
}

function SalesMetric({
  label,
  value,
  subtitle,
  tone,
}: {
  label: string;
  value: string;
  subtitle?: string;
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
      <p className="mt-1 text-xl font-black print:text-sm print:mt-0.5 tabular-nums"><CurrencyText value={value} /></p>
      {subtitle && <p className="mt-0.5 text-[10px] font-semibold opacity-80">{subtitle}</p>}
    </div>
  );
}
