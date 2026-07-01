import fs from 'fs';

const filePath = 'al-muttahida-saas/src/pages/Invoices.tsx';
let content = fs.readFileSync(filePath, 'utf8');

console.log("Original content length:", content.length);

// 1. Add state variables, suggestion memo, and sync effect
const stateSearch = "  const [selectedCustomerId, setSelectedCustomerId] = useState('');";
const stateReplacement = `  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [customerSearchTerm, setCustomerSearchTerm] = useState('');
  const [showCustomerSuggestions, setShowCustomerSuggestions] = useState(false);

  const customerSuggestions = useMemo(() => {
    const term = customerSearchTerm.trim().toLowerCase();
    if (term.length < 2) return [];
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(term) ||
        (c.phone && c.phone.includes(term))
    );
  }, [customers, customerSearchTerm]);

  useEffect(() => {
    const customer = customers.find((c) => c.id === selectedCustomerId);
    if (customer) {
      setCustomerSearchTerm(customer.name);
    } else {
      setCustomerSearchTerm('');
    }
  }, [selectedCustomerId, customers]);`;

if (content.includes(stateSearch)) {
  content = content.replace(stateSearch, stateReplacement);
  console.log("States and effects added to Invoices.tsx");
} else {
  console.log("Could not find state insertion point in Invoices.tsx");
}

// 2. Replace the old customer select dropdown with autocomplete input
const selectSearch = `              <Field label="العميل">
                <select value={selectedCustomerId} onChange={(e) => setSelectedCustomerId(e.target.value)} className="input-ui">
                  <option value="">اختر العميل</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name}
                    </option>
                  ))}
                </select>
              </Field>`;

const selectSearchAlt = `              <Field label="العميل">
                <select value={selectedCustomerId} onChange={(e) => setSelectedCustomerId(e.target.value)} className="input-ui">
                  <option value="">اختر العميل</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name}
                    </option>
                  ))}
                </select>
              </Field>`.replace(/\r\n/g, "\n");

const selectReplacement = `              <Field label="العميل">
                <div className="relative w-full">
                  <input
                    value={customerSearchTerm}
                    onChange={(e) => {
                      setCustomerSearchTerm(e.target.value);
                      setShowCustomerSuggestions(true);
                      if (e.target.value.trim() === '') {
                        setSelectedCustomerId('');
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
                            setSelectedCustomerId(c.id);
                            setCustomerSearchTerm(c.name);
                            setShowCustomerSuggestions(false);
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
              </Field>`;

const contentNormalized = content.replace(/\r\n/g, "\n");
if (contentNormalized.includes(selectSearch.replace(/\r\n/g, "\n"))) {
  content = contentNormalized.replace(selectSearch.replace(/\r\n/g, "\n"), selectReplacement);
  console.log("Customer select replaced successfully in Invoices.tsx");
} else if (contentNormalized.includes(selectSearchAlt)) {
  content = contentNormalized.replace(selectSearchAlt, selectReplacement);
  console.log("Customer select replaced via Alt successfully in Invoices.tsx");
} else {
  console.log("Could NOT find customer select dropdown in Invoices.tsx");
}

fs.writeFileSync(filePath, content, 'utf8');
console.log("File saved in UTF-8.");
