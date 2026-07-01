import fs from 'fs';

const filePath = 'al-muttahida-saas/src/pages/Invoices.tsx';
let content = fs.readFileSync(filePath, 'utf8');
content = content.replace(/\r\n/g, "\n");

console.log("Original content length:", content.length);

// 1. Add state variables, memo, and effect for the quick product supplier selection
const searchInsert = `  // Autocomplete for Supplier
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

const insertionCode = `

  // Autocomplete for Quick Product Supplier (On-demand)
  const [quickSupplierSearchTerm, setQuickSupplierSearchTerm] = useState('');
  const [showQuickSupplierSuggestions, setShowQuickSupplierSuggestions] = useState(false);

  const quickSupplierSuggestions = useMemo(() => {
    const term = normalizeArabic(quickSupplierSearchTerm);
    if (term.length < 1) return [];
    return suppliers.filter((s) => normalizeArabic(s.name).includes(term));
  }, [suppliers, quickSupplierSearchTerm]);

  useEffect(() => {
    const supplier = suppliers.find((s) => s.id === quickProduct.supplierId);
    if (supplier) {
      setQuickSupplierSearchTerm(supplier.name);
    } else {
      setQuickSupplierSearchTerm('');
    }
  }, [quickProduct.supplierId, suppliers]);`;

if (content.includes(searchInsert)) {
  content = content.replace(searchInsert, searchInsert + insertionCode);
  console.log("Added quick product supplier autocomplete state & effect.");
} else {
  console.log("Could NOT find insert point for states.");
}

// 2. Replace the HTML select element in the "expected supplier" field
const searchSelect = `                    <Field label="المورد المتوقع">
                      <select
                        value={quickProduct.supplierId}
                        onChange={(e) => setQuickProduct((current) => ({ ...current, supplierId: e.target.value }))}
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

const selectReplacement = `                    <Field label="المورد المتوقع">
                      <div className="relative w-full">
                        <input
                          value={quickSupplierSearchTerm}
                          onChange={(e) => {
                            setQuickSupplierSearchTerm(e.target.value);
                            setShowQuickSupplierSuggestions(true);
                            if (e.target.value.trim() === '') {
                              setQuickProduct((current) => ({ ...current, supplierId: '' }));
                            }
                          }}
                          onFocus={() => setShowQuickSupplierSuggestions(true)}
                          onBlur={() => setTimeout(() => setShowQuickSupplierSuggestions(false), 200)}
                          className="input-ui w-full"
                          placeholder="اكتب اسم المورد للبحث..."
                        />
                        {showQuickSupplierSuggestions && quickSupplierSuggestions.length > 0 && (
                          <div className="absolute right-0 left-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-50 max-h-40 overflow-y-auto divide-y divide-slate-100">
                            {quickSupplierSuggestions.map((s) => (
                              <button
                                key={s.id}
                                type="button"
                                onClick={() => {
                                  setQuickProduct((current) => ({ ...current, supplierId: s.id }));
                                  setQuickSupplierSearchTerm(s.name);
                                  setShowQuickSupplierSuggestions(false);
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

const searchSelectNormalized = searchSelect.replace(/\r\n/g, "\n");
if (content.includes(searchSelectNormalized)) {
  content = content.replace(searchSelectNormalized, selectReplacement);
  console.log("Replaced the expected supplier select element successfully.");
} else {
  console.log("Could NOT find the expected supplier select element.");
}

fs.writeFileSync(filePath, content, 'utf8');
console.log("File saved.");
