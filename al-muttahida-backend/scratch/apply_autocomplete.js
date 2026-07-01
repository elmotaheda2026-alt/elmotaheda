import fs from 'fs';

const filePath = 'al-muttahida-saas/src/pages/CollectionStatement.tsx';
let content = fs.readFileSync(filePath, 'utf8');

console.log("Original length:", content.length);

// 1. Add state variable and memo for suggestions
const stateSearch = "  const [printingInvoice, setPrintingInvoice] = useState<CollectionInvoiceView | null>(null);";
const stateReplacement = `  const [printingInvoice, setPrintingInvoice] = useState<CollectionInvoiceView | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const suggestions = useMemo(() => {
    const term = invoiceSearchTerm.trim().toLowerCase();
    if (term.length < 2) return [];
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(term) ||
        (c.phone && c.phone.includes(term))
    );
  }, [customers, invoiceSearchTerm]);`;

if (content.includes(stateSearch)) {
  content = content.replace(stateSearch, stateReplacement);
  console.log("State variables and memo added successfully.");
} else {
  console.log("Could not find state insertion point");
}

// 2. Locate the old toolbar and replace it with the new premium toolbar
const toolbarSearch = `{/* Toolbar for Invoices */}
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row gap-4 items-center">
              <div className="relative w-full md:w-80">
                <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={invoiceSearchTerm}
                  onChange={(e) => setInvoiceSearchTerm(e.target.value)}
                  className="input-ui pr-10 h-10 text-sm"
                  placeholder="بحث برقم الفاتورة، اسم، رقم، أو عنوان..."
                />
              </div>
              <select
                value={selectedCustomerId}
                onChange={(e) => setSelectedCustomerId(e.target.value)}
                className="w-full md:w-64 rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 font-bold outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100 transition shadow-sm"
              >
                <option value="all">كل العملاء</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </select>

              <div className="flex gap-2 w-full md:w-auto justify-center mr-auto">
                <label className="flex items-center gap-2 cursor-pointer bg-red-50 px-4 py-2 rounded-xl border border-red-100 hover:bg-red-100 transition-colors">
                  <input
                    type="checkbox"
                    checked={hideSuedCustomers}
                    onChange={(e) => setHideSuedCustomers(e.target.checked)}
                    className="h-4 w-4 rounded text-red-600 accent-red-600"
                  />
                  <span className="text-sm font-bold text-red-800 whitespace-nowrap">إخفاء القضايا</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer bg-slate-50 px-4 py-2 rounded-xl border border-slate-200 hover:bg-slate-100 transition-colors">
                  <input
                    type="checkbox"
                    checked={showOnlyDue}
                    onChange={(e) => setShowOnlyDue(e.target.checked)}
                    className="h-4 w-4 rounded text-sky-600"
                  />
                  <span className="text-sm font-bold text-slate-700 whitespace-nowrap">إظهار المتبقي فقط</span>
                </label>
              </div>
            </div>`;

const toolbarSearchAlt = `{/* Toolbar for Invoices */}
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row gap-4 items-center">
              <div className="relative w-full md:w-80">
                <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={invoiceSearchTerm}
                  onChange={(e) => setInvoiceSearchTerm(e.target.value)}
                  className="input-ui pr-10 h-10 text-sm"
                  placeholder="بحث برقم الفاتورة، اسم، رقم، أو عنوان..."
                />
              </div>
              <select
                value={selectedCustomerId}
                onChange={(e) => setSelectedCustomerId(e.target.value)}
                className="w-full md:w-64 rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 font-bold outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100 transition shadow-sm"
              >
                <option value="all">كل العملاء</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </select>

              <div className="flex gap-2 w-full md:w-auto justify-center mr-auto">
                <label className="flex items-center gap-2 cursor-pointer bg-red-50 px-4 py-2 rounded-xl border border-red-100 hover:bg-red-100 transition-colors">
                  <input
                    type="checkbox"
                    checked={hideSuedCustomers}
                    onChange={(e) => setHideSuedCustomers(e.target.checked)}
                    className="h-4 w-4 rounded text-red-600 accent-red-600"
                  />
                  <span className="text-sm font-bold text-red-800 whitespace-nowrap">إخفاء القضايا</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer bg-slate-50 px-4 py-2 rounded-xl border border-slate-200 hover:bg-slate-100 transition-colors">
                  <input
                    type="checkbox"
                    checked={showOnlyDue}
                    onChange={(e) => setShowOnlyDue(e.target.checked)}
                    className="h-4 w-4 rounded text-sky-600"
                  />
                  <span className="text-sm font-bold text-slate-700 whitespace-nowrap">إظهار المتبقي فقط</span>
                </label>
              </div>
            </div>`.replace(/\r\n/g, "\n");

const toolbarReplacement = `{/* Toolbar for Invoices */}
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row gap-4 items-center">
              <div className="relative w-full md:w-80">
                <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={invoiceSearchTerm}
                  onChange={(e) => {
                    setInvoiceSearchTerm(e.target.value);
                    setShowSuggestions(true);
                    if (e.target.value.trim() === '') {
                      setSelectedCustomerId('all');
                    }
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                  className="input-ui pr-10 h-10 text-sm w-full"
                  placeholder="ابحث عن العميل بالاسم أو رقم الفاتورة..."
                />
                {showSuggestions && suggestions.length > 0 && (
                  <div className="absolute right-0 left-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-50 max-h-60 overflow-y-auto divide-y divide-slate-100">
                    {suggestions.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setSelectedCustomerId(c.id);
                          setInvoiceSearchTerm(c.name);
                          setShowSuggestions(false);
                        }}
                        className="w-full text-right px-4 py-2.5 text-sm text-slate-700 hover:bg-sky-50 hover:text-sky-700 font-medium transition-colors flex items-center justify-between"
                      >
                        <span>{c.name}</span>
                        {c.phone && <span className="text-xs text-slate-400 font-normal">{c.phone}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex gap-3 w-full md:w-auto justify-center mr-auto">
                <label className="flex items-center gap-2 cursor-pointer bg-red-50/50 hover:bg-red-50 text-red-800 px-4 py-2 rounded-xl border border-red-100/60 transition-all select-none shadow-sm">
                  <input
                    type="checkbox"
                    checked={hideSuedCustomers}
                    onChange={(e) => setHideSuedCustomers(e.target.checked)}
                    className="h-4 w-4 rounded text-red-600 accent-red-600 cursor-pointer"
                  />
                  <span className="text-sm font-bold whitespace-nowrap">إخفاء القضايا</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer bg-sky-50/50 hover:bg-sky-50 text-sky-800 px-4 py-2 rounded-xl border border-sky-100/60 transition-all select-none shadow-sm">
                  <input
                    type="checkbox"
                    checked={showOnlyDue}
                    onChange={(e) => setShowOnlyDue(e.target.checked)}
                    className="h-4 w-4 rounded text-sky-600 accent-sky-600 cursor-pointer"
                  />
                  <span className="text-sm font-bold whitespace-nowrap">إظهار المتبقي فقط</span>
                </label>
              </div>
            </div>`;

// Normalize content line endings before search to avoid issues
const contentNormalized = content.replace(/\r\n/g, "\n");
if (contentNormalized.includes(toolbarSearch.replace(/\r\n/g, "\n"))) {
  content = contentNormalized.replace(toolbarSearch.replace(/\r\n/g, "\n"), toolbarReplacement);
  console.log("Toolbar replaced successfully.");
} else if (contentNormalized.includes(toolbarSearchAlt)) {
  content = contentNormalized.replace(toolbarSearchAlt, toolbarReplacement);
  console.log("Toolbar replaced via Alt successfully.");
} else {
  console.log("Could NOT find toolbar section");
}

fs.writeFileSync(filePath, content, 'utf8');
console.log("Done! File saved. Final length:", content.length);
