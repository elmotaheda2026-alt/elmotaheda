const fs = require('fs');

let c = fs.readFileSync('src/pages/CollectionStatement.tsx', 'utf8');

// 1. Add state
const targetState = 'const [printingInvoice, setPrintingInvoice] = useState<CollectionInvoiceView | null>(null);';
const replState = 'const [printingInvoice, setPrintingInvoice] = useState<CollectionInvoiceView | null>(null);\r\n  const [printingLegalReport, setPrintingLegalReport] = useState(false);';

if (!c.includes('printingLegalReport')) {
  c = c.replace(targetState, replState);
}

// 2. Change legal tab print button
const targetBtn = 'onClick={() => window.print()}';
// Only replace in the legal section
const legalSectionIdx = c.indexOf("{activeTab === 'legal'");
if (legalSectionIdx !== -1) {
  const btnIdx = c.indexOf(targetBtn, legalSectionIdx);
  if (btnIdx !== -1) {
    const replBtnAction = 'onClick={() => { setPrintingInvoice(null); setPrintingLegalReport(true); setTimeout(() => { window.print(); setPrintingLegalReport(false); }, 300); }}';
    c = c.substring(0, btnIdx) + replBtnAction + c.substring(btnIdx + targetBtn.length);
  }
}

// 3. Find printable section
const marker = '{/* PRINTABLE INVOICE STATEMENT */}';
const markerIdx = c.indexOf(marker);
if (markerIdx !== -1) {
  const elseIdx = c.indexOf(') : (', markerIdx);
  if (elseIdx !== -1) {
    const toInsert = `) : printingLegalReport || activeTab === 'legal' ? (
        /* PRINTABLE LEGAL AFFAIRS / LAWYER REPORT */
        <div className="hidden print:block bg-white text-slate-900 w-full text-right" dir="rtl">
          <div className="flex justify-between items-start border-b-2 border-slate-900 pb-3 mb-4">
            <div>
              <h1 className="text-2xl font-black text-slate-900 mb-0.5">{settings.companyName}</h1>
              <p className="text-slate-600 text-xs">{settings.companyAddress} | {settings.companyPhone}</p>
            </div>
            <div className="text-left">
              <h2 className="text-xl font-bold text-red-800 border-b-2 border-red-700 pb-0.5 mb-1 inline-block">كشف قضايا العملاء المحالين للشئون القانونية (كشف المحامي)</h2>
              <p className="text-slate-500 font-semibold text-[10px]">تاريخ الاستخراج والطباعة: {formatDateDisplay(new Date())}</p>
            </div>
          </div>

          <table className="w-full text-right border-collapse text-xs">
            <thead>
              <tr className="border-b-2 border-slate-800 bg-slate-100 text-slate-900 font-bold">
                <th className="p-2 w-8 text-center">#</th>
                <th className="p-2 text-right">اسم العميل</th>
                <th className="p-2 text-right">رقم الهاتف</th>
                <th className="p-2 text-right">العنوان</th>
                <th className="p-2 text-center w-20">عدد الفواتير</th>
                <th className="p-2 text-center w-28">تاريخ الإحالة</th>
                <th className="p-2 text-center w-36">إجمالي المديونية المعلقة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-300">
              {suedCustomersList.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-slate-500 font-bold">
                    لا يوجد أي عملاء محالين للشئون القانونية حالياً.
                  </td>
                </tr>
              ) : (
                suedCustomersList.map((customer, idx) => (
                  <tr key={customer.id} className="border-b border-slate-200">
                    <td className="p-2 text-center font-bold text-slate-700">{idx + 1}</td>
                    <td className="p-2 font-bold text-slate-900">{customer.name}</td>
                    <td className="p-2 text-slate-700 font-mono text-xs">{customer.phone}</td>
                    <td className="p-2 text-slate-600 text-xs">{customer.address || '-'}</td>
                    <td className="p-2 text-center font-bold text-slate-800">{customer.invoicesCount}</td>
                    <td className="p-2 text-center text-xs text-slate-600">{customer.suedDate ? formatDateDisplay(customer.suedDate) : '-'}</td>
                    <td className="p-2 text-center font-black text-red-700">{formatCurrency(customer.totalDebt)}</td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-900 bg-slate-50 font-bold">
                <td colSpan={4} className="p-2 text-right">إجمالي عدد العملاء المحالين للقضاء: {suedCustomersList.length} عميل</td>
                <td colSpan={3} className="p-2 text-center text-sm font-black text-red-800">
                  إجمالي المديونية المعلقة: {formatCurrency(suedCustomersList.reduce((s, c) => s + c.totalDebt, 0))}
                </td>
              </tr>
            </tfoot>
          </table>

          <div className="mt-8 pt-4 border-t border-slate-300 flex justify-between items-center text-xs text-slate-600">
            <div>توقيع واستلام المحامي: ................................................</div>
            <div>اعتماد الإدارة: ................................................</div>
          </div>
        </div>
      `;
    c = c.substring(0, elseIdx) + toInsert + c.substring(elseIdx);
    fs.writeFileSync('src/pages/CollectionStatement.tsx', c, 'utf8');
    console.log('Successfully injected printable legal report!');
  }
}
