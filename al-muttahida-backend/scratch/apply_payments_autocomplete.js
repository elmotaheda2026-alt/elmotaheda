import fs from 'fs';

const filePath = 'al-muttahida-saas/src/pages/Payments.tsx';
let content = fs.readFileSync(filePath, 'utf8');
content = content.replace(/\r\n/g, "\n");

console.log("Original content length:", content.length);

// 1. Add normalizeArabic helper
const targetPaymentsExport = "export default function Payments() {";
const helperCode = `const normalizeArabic = (str: string): string => {
  if (!str) return '';
  return str
    .replace(/[أإآا]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[ىي]/g, 'ي')
    .trim()
    .toLowerCase();
};
`;

if (content.includes(targetPaymentsExport) && !content.includes("const normalizeArabic")) {
  content = content.replace(targetPaymentsExport, helperCode + "\n" + targetPaymentsExport);
  console.log("Added normalizeArabic helper to Payments.tsx");
}

// 2. Add state variables, memo, and effect for autocomplete search
const targetIncomingFormState = `  const [incomingForm, setIncomingForm] = useState<IncomingPaymentForm>({
    customerId: '',
    saleId: '',
    installmentId: '',
    amount: 0,
    date: today(),
    description: '',
  });`;

const replacementIncomingFormState = `  const [incomingForm, setIncomingForm] = useState<IncomingPaymentForm>({
    customerId: '',
    saleId: '',
    installmentId: '',
    amount: 0,
    date: today(),
    description: '',
  });

  // Autocomplete for customer payment selection
  const [customerSearchTerm, setCustomerSearchTerm] = useState('');
  const [showCustomerSuggestions, setShowCustomerSuggestions] = useState(false);

  const customerSuggestions = useMemo(() => {
    const term = normalizeArabic(customerSearchTerm);
    if (term.length < 1) return [];
    return customers.filter((c) => normalizeArabic(c.name).includes(term));
  }, [customers, customerSearchTerm]);

  useEffect(() => {
    const customer = customers.find((c) => c.id === incomingForm.customerId);
    if (customer) {
      setCustomerSearchTerm(customer.name);
    } else {
      setCustomerSearchTerm('');
    }
  }, [incomingForm.customerId, customers]);`;

if (content.includes(targetIncomingFormState)) {
  content = content.replace(targetIncomingFormState, replacementIncomingFormState);
  console.log("Added customer autocomplete states & effect to Payments.tsx");
} else {
  console.log("Could NOT find targetIncomingFormState for insertion.");
}

// 3. Remove default customer and supplier selection on load
const targetDefaultCustomerOnLoad = `    if (!incomingForm.customerId && nextCustomers.length > 0) {
      setIncomingForm((current) => ({ ...current, customerId: nextCustomers[0].id }));
    }`;

const targetDefaultSupplierOnLoad = `    if (!outgoingForm.supplierId && nextSuppliers.length > 0) {
      setOutgoingForm((current) => ({ ...current, supplierId: nextSuppliers[0].id }));
    }`;

if (content.includes(targetDefaultCustomerOnLoad)) {
  content = content.replace(targetDefaultCustomerOnLoad, "");
  console.log("Removed default customer selection on mount.");
}

if (content.includes(targetDefaultSupplierOnLoad)) {
  content = content.replace(targetDefaultSupplierOnLoad, "");
  console.log("Removed default supplier selection on mount.");
}

// 4. Replace the HTML select field with the new autocomplete input
const targetSelectCustomer = `                          <Field label="العميل">
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
                          </Field>`;

const replacementSelectCustomer = `                          <Field label="العميل">
                            <div className="relative w-full">
                              <input
                                value={customerSearchTerm}
                                onChange={(e) => {
                                  setCustomerSearchTerm(e.target.value);
                                  setShowCustomerSuggestions(true);
                                  if (e.target.value.trim() === '') {
                                    setIncomingForm((current) => ({
                                      ...current,
                                      customerId: '',
                                      saleId: '',
                                      installmentId: '',
                                      amount: 0,
                                      description: '',
                                    }));
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
                                        setIncomingForm((current) => ({
                                          ...current,
                                          customerId: c.id,
                                          saleId: '',
                                          installmentId: '',
                                          amount: 0,
                                          description: '',
                                        }));
                                        setCustomerSearchTerm(c.name);
                                        setShowCustomerSuggestions(false);
                                      }}
                                      className="w-full text-right px-4 py-2.5 text-sm text-slate-700 hover:bg-sky-50 hover:text-sky-700 font-medium transition-colors"
                                    >
                                      <span>{c.name}</span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          </Field>`;

const targetSelectCustomerNormalized = targetSelectCustomer.replace(/\r\n/g, "\n");
if (content.includes(targetSelectCustomerNormalized)) {
  content = content.replace(targetSelectCustomerNormalized, replacementSelectCustomer);
  console.log("Replaced client select dropdown in Payments.tsx successfully.");
} else {
  console.log("Could NOT find client select dropdown in Payments.tsx.");
}

fs.writeFileSync(filePath, content, 'utf8');
console.log("File saved.");
