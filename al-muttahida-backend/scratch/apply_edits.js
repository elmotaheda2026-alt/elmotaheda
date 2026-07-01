import fs from 'fs';

const filePath = 'al-muttahida-saas/src/pages/CollectionStatement.tsx';
let content = fs.readFileSync(filePath, 'utf8');

// Fix 1: Revert invoiceRows to return [] when no lookup
content = content.replace(
  "if (!hasInvoiceLookup) return rows;",
  "if (!hasInvoiceLookup) return [];"
);
console.log("Fix 1: Reverted invoiceRows fallback to []");

// Fix 2: Add the "search first" placeholder before loading state
const oldUiBlock = `{isInvoiceLoading ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-16 text-center shadow-sm">
                  <Clock3 size={40} className="text-sky-400 mx-auto mb-4 animate-pulse" />
                  <p className="text-slate-500 font-medium">جاري تحميل فواتير العملاء...</p>
                </div>
              ) : filteredRows.length === 0 ? (`;

const newUiBlock = `{!hasInvoiceLookup ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-gradient-to-b from-slate-50 to-white p-16 text-center shadow-sm">
                  <div className="w-16 h-16 rounded-2xl bg-sky-50 flex items-center justify-center mx-auto mb-5">
                    <Search size={32} className="text-sky-400" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-800 mb-2">ابحث عن عميل لعرض فواتيره</h3>
                  <p className="text-slate-500 text-sm max-w-md mx-auto">اكتب اسم العميل أو رقم الفاتورة في خانة البحث بالأعلى، أو اختر عميل من القائمة لعرض كشف حسابه وحالة أقساطه.</p>
                </div>
              ) : isInvoiceLoading ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-16 text-center shadow-sm">
                  <Clock3 size={40} className="text-sky-400 mx-auto mb-4 animate-pulse" />
                  <p className="text-slate-500 font-medium">جاري تحميل فواتير العميل...</p>
                </div>
              ) : filteredRows.length === 0 ? (`;

if (content.includes(oldUiBlock)) {
  content = content.replace(oldUiBlock, newUiBlock);
  console.log("Fix 2: Added search-first placeholder message");
} else {
  console.log("Fix 2: Could NOT find old UI block");
}

fs.writeFileSync(filePath, content, 'utf8');
console.log("Done! File saved.");
