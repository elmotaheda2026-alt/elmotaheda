import fs from 'fs';

const filePath = 'al-muttahida-saas/src/pages/Payments.tsx';
let content = fs.readFileSync(filePath, 'utf8');
content = content.replace(/\r\n/g, "\n");

console.log("Original content length:", content.length);

// 1. Add normalizeArabic helper above the component
const targetExport = "export default function Payments() {";
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

if (content.includes(targetExport) && !content.includes("const normalizeArabic")) {
  content = content.replace(targetExport, helperCode + "\n" + targetExport);
  console.log("Added normalizeArabic helper.");
}

// 2. Add autocomplete states, memo, and typing-safe useEffect
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
      if (customerSearchTerm !== customer.name) {
        setCustomerSearchTerm(customer.name);
      }
    } else {
      if (!showCustomerSuggestions && customerSearchTerm !== '') {
        setCustomerSearchTerm('');
      }
    }
  }, [incomingForm.customerId, customers, showCustomerSuggestions]);`;

if (content.includes(targetIncomingFormState)) {
  content = content.replace(targetIncomingFormState, replacementIncomingFormState);
  console.log("Added customer autocomplete states & sync effect.");
}

// 3. Optimize loadData to load cached data instantly and sync in the background
const targetLoadData = `  const loadData = async () => {
    if (isApiMode()) {
      await Promise.all([syncCustomers(), syncSuppliers(), syncPayments(), syncSales(), syncClosingPeriods()]);
    }
    const nextPayments = getPayments().slice().reverse();
    const nextSales = getSales().slice().reverse();
    const nextCustomers = getCustomers();
    const nextSuppliers = getSuppliers();

    setPayments(nextPayments);
    setSales(nextSales);
    setCustomers(nextCustomers);
    setSuppliers(nextSuppliers);
    setClosedPeriods(getClosingPeriods());

    if (!incomingForm.customerId && nextCustomers.length > 0) {
      setIncomingForm((current) => ({ ...current, customerId: nextCustomers[0].id }));
    }

    if (!outgoingForm.supplierId && nextSuppliers.length > 0) {
      setOutgoingForm((current) => ({ ...current, supplierId: nextSuppliers[0].id }));
    }
  };`;

const replacementLoadData = `  const loadData = async () => {
    // 1. Load cached data immediately
    const nextPayments = getPayments().slice().reverse();
    const nextSales = getSales().slice().reverse();
    const nextCustomers = getCustomers();
    const nextSuppliers = getSuppliers();

    setPayments(nextPayments);
    setSales(nextSales);
    setCustomers(nextCustomers);
    setSuppliers(nextSuppliers);
    setClosedPeriods(getClosingPeriods());

    // 2. Perform background sync if in API mode
    if (isApiMode()) {
      try {
        await Promise.all([syncCustomers(), syncSuppliers(), syncPayments(), syncSales(), syncClosingPeriods()]);
        
        // 3. Update state with fresh synced data
        const freshPayments = getPayments().slice().reverse();
        const freshSales = getSales().slice().reverse();
        const freshCustomers = getCustomers();
        const freshSuppliers = getSuppliers();

        setPayments(freshPayments);
        setSales(freshSales);
        setCustomers(freshCustomers);
        setSuppliers(freshSuppliers);
        setClosedPeriods(getClosingPeriods());
      } catch (err) {
        console.error('[Payments DEBUG] Sync FAILED:', err);
      }
    }
  };`;

if (content.includes(targetLoadData)) {
  content = content.replace(targetLoadData, replacementLoadData);
  console.log("Optimized loadData with background sync and removed default selections on load.");
} else {
  // Let's try to match it without the default selections because we might have already modified it
  const targetLoadDataNoDefaults = `  const loadData = async () => {
    if (isApiMode()) {
      await Promise.all([syncCustomers(), syncSuppliers(), syncPayments(), syncSales(), syncClosingPeriods()]);
    }
    const nextPayments = getPayments().slice().reverse();
    const nextSales = getSales().slice().reverse();
    const nextCustomers = getCustomers();
    const nextSuppliers = getSuppliers();

    setPayments(nextPayments);
    setSales(nextSales);
    setCustomers(nextCustomers);
    setSuppliers(nextSuppliers);
    setClosedPeriods(getClosingPeriods());
  };`;

  if (content.includes(targetLoadDataNoDefaults)) {
    content = content.replace(targetLoadDataNoDefaults, replacementLoadData);
    console.log("Optimized loadData (without defaults version).");
  } else {
    console.log("Could NOT find loadData target for replacement.");
  }
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

if (content.includes(targetSelectCustomer)) {
  content = content.replace(targetSelectCustomer, replacementSelectCustomer);
  console.log("Replaced customer select dropdown with autocomplete input.");
} else {
  console.log("Could NOT find customer select dropdown.");
}

fs.writeFileSync(filePath, content, 'utf8');
console.log("Finished applying changes.");
