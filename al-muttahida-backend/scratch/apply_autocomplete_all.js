import fs from 'fs';

// 1. Update CollectionStatement.tsx to hide phone numbers in autocomplete dropdown
const pathCollection = 'al-muttahida-saas/src/pages/CollectionStatement.tsx';
let contentCollection = fs.readFileSync(pathCollection, 'utf8');

const searchPhoneCol = `                      <button
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
                      </button>`;

const replacementPhoneCol = `                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setSelectedCustomerId(c.id);
                          setInvoiceSearchTerm(c.name);
                          setShowSuggestions(false);
                        }}
                        className="w-full text-right px-4 py-2.5 text-sm text-slate-700 hover:bg-sky-50 hover:text-sky-700 font-medium transition-colors"
                      >
                        <span>{c.name}</span>
                      </button>`;

contentCollection = contentCollection.replace(/\r\n/g, "\n");
if (contentCollection.includes(searchPhoneCol.replace(/\r\n/g, "\n"))) {
  contentCollection = contentCollection.replace(searchPhoneCol.replace(/\r\n/g, "\n"), replacementPhoneCol);
  console.log("Updated CollectionStatement.tsx suggestions layout successfully.");
} else {
  console.log("Could NOT find target suggestions layout in CollectionStatement.tsx");
}
fs.writeFileSync(pathCollection, contentCollection, 'utf8');


// 2. Update Invoices.tsx
const pathInvoices = 'al-muttahida-saas/src/pages/Invoices.tsx';
let contentInvoices = fs.readFileSync(pathInvoices, 'utf8');
contentInvoices = contentInvoices.replace(/\r\n/g, "\n");

// A. Remove phone number from customer suggestions dropdown in Invoices.tsx
const searchPhoneInv = `                          className="w-full text-right px-4 py-2.5 text-sm text-slate-700 hover:bg-sky-50 hover:text-sky-700 font-medium transition-colors flex items-center justify-between"
                        >
                          <span>{c.name}</span>
                          {c.phone && <span className="text-xs text-slate-400 font-normal">{c.phone}</span>}
                        </button>`;

const replacementPhoneInv = `                          className="w-full text-right px-4 py-2.5 text-sm text-slate-700 hover:bg-sky-50 hover:text-sky-700 font-medium transition-colors"
                        >
                          <span>{c.name}</span>
                        </button>`;

if (contentInvoices.includes(searchPhoneInv)) {
  contentInvoices = contentInvoices.replace(searchPhoneInv, replacementPhoneInv);
  console.log("Removed phone numbers from customer suggestions in Invoices.tsx");
} else {
  console.log("Could NOT find customer suggestions phone wrapper in Invoices.tsx");
}

// B. Insert State & Effects for SalesRep and Supplier in Invoices.tsx
// We can insert them right below our previous customer suggestions effect.
const insertPoint = `  useEffect(() => {
    const customer = customers.find((c) => c.id === selectedCustomerId);
    if (customer) {
      setCustomerSearchTerm(customer.name);
    } else {
      setCustomerSearchTerm('');
    }
  }, [selectedCustomerId, customers]);`;

const statesAndEffectsToInsert = `

  // Autocomplete for Sales Representative
  const [salesRepSearchTerm, setSalesRepSearchTerm] = useState('');
  const [showSalesRepSuggestions, setShowSalesRepSuggestions] = useState(false);

  const salesRepSuggestions = useMemo(() => {
    const term = normalizeArabic(salesRepSearchTerm);
    if (term.length < 1) return [];
    return salesReps.filter((r) => normalizeArabic(r.name).includes(term));
  }, [salesReps, salesRepSearchTerm]);

  useEffect(() => {
    const rep = salesReps.find((r) => r.id === selectedSalesRepId);
    if (rep) {
      setSalesRepSearchTerm(rep.name);
    } else {
      setSalesRepSearchTerm('');
    }
  }, [selectedSalesRepId, salesReps]);

  // Autocomplete for Supplier
  const [supplierSearchTerm, setSupplierSearchTerm] = useState('');
  const [showSupplierSuggestions, setShowSupplierSuggestions] = useState(false);

  const supplierSuggestions = useMemo(() => {
    const term = normalizeArabic(supplierSearchTerm);
    if (term.length < 1) return [];
    return suppliers.filter((s) => normalizeArabic(s.name).includes(term));
  }, [suppliers, supplierSearchTerm]);

  useEffect(() => {
    const supplier = suppliers.find((s) => s.id === procurementSupplierId);
    if (supplier) {
      setSupplierSearchTerm(supplier.name);
    } else {
      setSupplierSearchTerm('');
    }
  }, [procurementSupplierId, suppliers]);`;

if (contentInvoices.includes(insertPoint)) {
  contentInvoices = contentInvoices.replace(insertPoint, insertPoint + statesAndEffectsToInsert);
  console.log("Added SalesRep and Supplier states & effects to Invoices.tsx");
} else {
  console.log("Could NOT find insert point in Invoices.tsx for states");
}

// C. Replace Sales Representative Select dropdown
const selectSalesRepSearch = `              <Field label="مندوب المبيعات">
                <select value={selectedSalesRepId} onChange={(e) => setSelectedSalesRepId(e.target.value)} className="input-ui">
                  <option value="">بدون مندوب</option>
                  {salesReps.map((rep) => (
                    <option key={rep.id} value={rep.id}>
                      {rep.name}
                    </option>
                  ))}
                </select>
              </Field>`;

const selectSalesRepReplacement = `              <Field label="مندوب المبيعات">
                <div className="relative w-full">
                  <input
                    value={salesRepSearchTerm}
                    onChange={(e) => {
                      setSalesRepSearchTerm(e.target.value);
                      setShowSalesRepSuggestions(true);
                      if (e.target.value.trim() === '') {
                        setSelectedSalesRepId('');
                      }
                    }}
                    onFocus={() => setShowSalesRepSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowSalesRepSuggestions(false), 200)}
                    className="input-ui w-full"
                    placeholder="اكتب اسم المندوب..."
                  />
                  {showSalesRepSuggestions && salesRepSuggestions.length > 0 && (
                    <div className="absolute right-0 left-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-50 max-h-60 overflow-y-auto divide-y divide-slate-100">
                      {salesRepSuggestions.map((rep) => (
                        <button
                          key={rep.id}
                          type="button"
                          onClick={() => {
                            setSelectedSalesRepId(rep.id);
                            setSalesRepSearchTerm(rep.name);
                            setShowSalesRepSuggestions(false);
                          }}
                          className="w-full text-right px-4 py-2.5 text-sm text-slate-700 hover:bg-sky-50 hover:text-sky-700 font-medium transition-colors"
                        >
                          <span>{rep.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </Field>`;

if (contentInvoices.includes(selectSalesRepSearch)) {
  contentInvoices = contentInvoices.replace(selectSalesRepSearch, selectSalesRepReplacement);
  console.log("Replaced SalesRep select dropdown in Invoices.tsx");
} else {
  console.log("Could NOT find SalesRep select dropdown in Invoices.tsx");
}

// D. Replace Supplier Select dropdown
const selectSupplierSearch = `                  <Field label="المورد الذي سيُنشأ له الشراء">
                    <select
                      value={procurementSupplierId}
                      onChange={(e) => setProcurementSupplierId(e.target.value)}
                      className="input-ui"
                    >
                      <option value="">اختر المورد</option>
                      {suppliers.map((supplier) => (
                        <option key={supplier.id} value={supplier.id}>
                          {supplier.name}
                        </option>
                      ))}
                    </select>
                  </Field>`;

const selectSupplierReplacement = `                  <Field label="المورد الذي سيُنشأ له الشراء">
                    <div className="relative w-full">
                      <input
                        value={supplierSearchTerm}
                        onChange={(e) => {
                          setSupplierSearchTerm(e.target.value);
                          setShowSupplierSuggestions(true);
                          if (e.target.value.trim() === '') {
                            setProcurementSupplierId('');
                          }
                        }}
                        onFocus={() => setShowSupplierSuggestions(true)}
                        onBlur={() => setTimeout(() => setShowSupplierSuggestions(false), 200)}
                        className="input-ui w-full"
                        placeholder="اكتب اسم المورد للبحث..."
                      />
                      {showSupplierSuggestions && supplierSuggestions.length > 0 && (
                        <div className="absolute right-0 left-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-50 max-h-40 overflow-y-auto divide-y divide-slate-100">
                          {supplierSuggestions.map((s) => (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => {
                                setProcurementSupplierId(s.id);
                                setSupplierSearchTerm(s.name);
                                setShowSupplierSuggestions(false);
                              }}
                              className="w-full text-right px-4 py-2.5 text-sm text-slate-700 hover:bg-sky-50 hover:text-sky-700 font-medium transition-colors"
                            >
                              <span>{s.name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </Field>`;

// Normalize selectSupplierSearch indentation and match
const normalizedSelectSupplier = selectSupplierSearch.replace(/\r\n/g, "\n");
if (contentInvoices.includes(normalizedSelectSupplier)) {
  contentInvoices = contentInvoices.replace(normalizedSelectSupplier, selectSupplierReplacement);
  console.log("Replaced Supplier select dropdown in Invoices.tsx");
} else {
  console.log("Could NOT find Supplier select dropdown in Invoices.tsx");
}

fs.writeFileSync(pathInvoices, contentInvoices, 'utf8');
console.log("All replacements applied.");
