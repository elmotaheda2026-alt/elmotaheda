import fs from 'fs';

const filePath = 'c:/Users/Administrator/Desktop/elmotaheda/al-muttahida-saas/src/pages/CollectionStatement.tsx';
let content = fs.readFileSync(filePath, 'utf8');
content = content.replace(/\r\n/g, '\n');

let success = true;

function applyReplace(target, replacement, name) {
  if (content.includes(target)) {
    content = content.replace(target, replacement);
    console.log('Success: Applied edit ' + name);
  } else {
    console.error('Error: Failed to find target for edit ' + name);
    success = false;
  }
}

// ---- EDIT 1: Replace the useEffect hooks section ----
const targetHooks = [
  '  useEffect(() => {',
  '    const loadData = async () => {',
  '      if (isApiMode()) {',
  '        await Promise.allSettled([syncCustomers(), syncSales(), syncSalesReps()]);',
  '      }',
  '',
  '      setCustomers(getCustomers());',
  "      setSales(getSales().filter((sale) => sale.status !== 'cancelled').slice().reverse());",
  '      setSalesReps(getSalesReps());',
  '    };',
  '',
  '    void loadData();',
  '',
  '    // Reload when user comes back to this tab/page (e.g. after making a payment)',
  '    const handleVisibilityChange = () => {',
  "      if (document.visibilityState === 'visible') {",
  '        void loadData();',
  '      }',
  '    };',
  '',
  '    // Reload when localStorage changes (e.g. payment saved in another tab/component)',
  '    const handleStorageChange = (e: StorageEvent) => {',
  "      if (e.key === null || e.key?.includes('sales') || e.key?.includes('payments')) {",
  '        void loadData();',
  '      }',
  '    };',
  '',
  "    document.addEventListener('visibilitychange', handleVisibilityChange);",
  "    window.addEventListener('storage', handleStorageChange);",
  '',
  '    return () => {',
  "      document.removeEventListener('visibilitychange', handleVisibilityChange);",
  "      window.removeEventListener('storage', handleStorageChange);",
  '    };',
  '  }, []);',
].join('\n');

const replacementHooks = [
  '  // New Search & Debounce States',
  "  const [searchQuery, setSearchQuery] = useState('');",
  "  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');",
  '  const [matchedCustomers, setMatchedCustomers] = useState<Customer[]>([]);',
  '  const [isLoadingSales, setIsLoadingSales] = useState(false);',
  '',
  '  // Debounce searchQuery -> debouncedSearchQuery',
  '  useEffect(() => {',
  '    const handler = setTimeout(() => {',
  '      setDebouncedSearchQuery(searchQuery);',
  '    }, 400);',
  '',
  '    return () => {',
  '      clearTimeout(handler);',
  '    };',
  '  }, [searchQuery]);',
  '',
  '  // Load Customers and SalesReps on mount (No Sales)',
  '  useEffect(() => {',
  '    const loadInitialData = async () => {',
  '      if (isApiMode()) {',
  '        await Promise.allSettled([syncCustomers(), syncSalesReps()]);',
  '      }',
  '      setCustomers(getCustomers());',
  '      setSalesReps(getSalesReps());',
  '    };',
  '    void loadInitialData();',
  '  }, []);',
  '',
  '  // Reload Sales for the currently matched customer IDs',
  '  const reloadSalesForMatchedCustomers = async (matchedIds: string[]) => {',
  '    if (matchedIds.length === 0) {',
  '      setSales([]);',
  '      return;',
  '    }',
  '    setIsLoadingSales(true);',
  '    try {',
  '      if (isApiMode()) {',
  '        await Promise.allSettled(matchedIds.map(id => syncSales(id)));',
  '      }',
  "      const salesData = getSales(matchedIds).filter((sale) => sale.status !== 'cancelled').slice().reverse();",
  '      setSales(salesData);',
  '    } catch (err) {',
  "      console.error('Error loading sales:', err);",
  '    } finally {',
  '      setIsLoadingSales(false);',
  '    }',
  '  };',
  '',
  '  // When debounced search query or customers list changes, find matching customers and load sales',
  '  useEffect(() => {',
  '    const query = debouncedSearchQuery.trim().toLowerCase();',
  '    if (!query) {',
  '      setMatchedCustomers([]);',
  '      setSales([]);',
  '      return;',
  '    }',
  '',
  '    const matched = customers.filter(c =>',
  '      c.name.toLowerCase().includes(query) ||',
  '      c.phone.includes(query) ||',
  '      c.customerNumber.toLowerCase().includes(query) ||',
  '      (c.nationalId && c.nationalId.includes(query))',
  '    );',
  '    setMatchedCustomers(matched);',
  '',
  '    const matchedIds = matched.map(c => c.id);',
  '    void reloadSalesForMatchedCustomers(matchedIds);',
  '  }, [debouncedSearchQuery, customers]);',
  '',
  '  // Reset selected customer filter when matched list changes',
  '  useEffect(() => {',
  "    setSelectedCustomerId('all');",
  '  }, [matchedCustomers]);',
  '',
  '  // Listener for page visibility / storage changes to reload sales for active search',
  '  useEffect(() => {',
  '    if (matchedCustomers.length === 0) return;',
  '',
  '    const matchedIds = matchedCustomers.map(c => c.id);',
  '',
  '    const handleVisibilityChange = () => {',
  "      if (document.visibilityState === 'visible') {",
  '        void reloadSalesForMatchedCustomers(matchedIds);',
  '      }',
  '    };',
  '',
  '    const handleStorageChange = (e: StorageEvent) => {',
  "      if (e.key === null || e.key?.includes('sales') || e.key?.includes('payments')) {",
  '        void reloadSalesForMatchedCustomers(matchedIds);',
  '      }',
  '    };',
  '',
  "    document.addEventListener('visibilitychange', handleVisibilityChange);",
  "    window.addEventListener('storage', handleStorageChange);",
  '',
  '    return () => {',
  "      document.removeEventListener('visibilitychange', handleVisibilityChange);",
  "      window.removeEventListener('storage', handleStorageChange);",
  '    };',
  '  }, [matchedCustomers]);',
].join('\n');

applyReplace(targetHooks, replacementHooks, 'Hooks');

// ---- EDIT 2: Replace suedCustomersList useMemo ----
applyReplace(
  '  }, [customers, rows]);',
  '  }, [matchedCustomers, rows]);',
  'SuedList-deps'
);

applyReplace(
  'return customers.filter(c => c.isSued)',
  'return matchedCustomers.filter(c => c.isSued)',
  'SuedList-filter'
);

// ---- EDIT 3: Replace customers dropdown ----
applyReplace(
  '{customers.map((customer) => (\n                  <option key={customer.id} value={customer.id}>\n                    {customer.name}\n                  </option>\n                ))}',
  '{matchedCustomers.map((customer) => (\n                  <option key={customer.id} value={customer.id}>\n                    {customer.name}\n                  </option>\n                ))}',
  'Dropdown'
);

// ---- EDIT 4: Add Global Search Bar & Empty State after title/tabs ----
// Insert a search bar between the title and the tabs
const titleBlock = [
  '        <div className="flex justify-between items-center print:hidden border-b border-slate-100 pb-2">',
  '          <h2 className="text-xl font-black text-slate-900">\u0645\u062A\u0627\u0628\u0639\u0629 \u0627\u0644\u062A\u062D\u0635\u064A\u0644</h2>',
  '        </div>',
  '',
  '        {/* TABS SECTION */}',
].join('\n');

const titleBlockReplacement = [
  '        <div className="flex justify-between items-center print:hidden border-b border-slate-100 pb-2">',
  '          <h2 className="text-xl font-black text-slate-900">\u0645\u062A\u0627\u0628\u0639\u0629 \u0627\u0644\u062A\u062D\u0635\u064A\u0644</h2>',
  '        </div>',
  '',
  '        {/* Global Search Bar */}',
  '        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm print:hidden">',
  '          <label className="block">',
  '            <span className="mb-2 block text-sm font-bold text-slate-700">\u0627\u0644\u0628\u062D\u062B \u0639\u0646 \u0639\u0645\u064A\u0644 \u0644\u0644\u0628\u062F\u0621</span>',
  '            <div className="relative max-w-xl">',
  '              <Search size={18} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" />',
  '              <input',
  '                type="text"',
  '                value={searchQuery}',
  '                onChange={(e) => setSearchQuery(e.target.value)}',
  '                className="w-full rounded-2xl border border-slate-300 bg-white pr-11 pl-10 py-2.5 text-sm font-medium outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100 transition shadow-sm"',
  '                placeholder="\u0623\u062F\u062E\u0644 \u0627\u0633\u0645 \u0627\u0644\u0639\u0645\u064A\u0644\u060C \u0631\u0642\u0645 \u0627\u0644\u0647\u0627\u062A\u0641\u060C \u0623\u0648 \u0627\u0644\u0631\u0642\u0645 \u0627\u0644\u0642\u0648\u0645\u064A..."',
  '              />',
  '              {searchQuery && (',
  '                <button',
  "                  onClick={() => setSearchQuery('')}",
  '                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 font-bold text-sm"',
  '                >',
  '                  \u0645\u0633\u062D',
  '                </button>',
  '              )}',
  '            </div>',
  '          </label>',
  '        </div>',
  '',
  '        {!debouncedSearchQuery.trim() ? (',
  '          <div className="flex flex-col items-center justify-center py-16 px-4 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200 text-center animate-in fade-in duration-300 print:hidden">',
  '            <div className="w-16 h-16 bg-sky-50 text-sky-600 rounded-full flex items-center justify-center mb-4">',
  '              <Search size={32} />',
  '            </div>',
  '            <h3 className="text-lg font-bold text-slate-800 mb-2">\u0627\u0644\u0628\u062D\u062B \u0639\u0646 \u0639\u0645\u064A\u0644 \u0644\u0644\u0628\u062F\u0621</h3>',
  '            <p className="text-slate-500 max-w-md text-sm">',
  '              \u0627\u0644\u0631\u062C\u0627\u0621 \u0643\u062A\u0627\u0628\u0629 \u0627\u0633\u0645 \u0627\u0644\u0639\u0645\u064A\u0644\u060C \u0631\u0642\u0645 \u0627\u0644\u0647\u0627\u062A\u0641\u060C \u0623\u0648 \u0627\u0644\u0631\u0642\u0645 \u0627\u0644\u0642\u0648\u0645\u064A \u0641\u064A \u062E\u0627\u0646\u0629 \u0627\u0644\u0628\u062D\u062B \u0623\u0639\u0644\u0627\u0647 \u0644\u0639\u0631\u0636 \u0643\u0634\u0641 \u0627\u0644\u062D\u0633\u0627\u0628 \u0648\u0627\u0644\u062A\u062D\u0635\u064A\u0644\u0627\u062A.',
  '            </p>',
  '          </div>',
  '        ) : matchedCustomers.length === 0 ? (',
  '          <div className="flex flex-col items-center justify-center py-16 px-4 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200 text-center animate-in fade-in duration-300 print:hidden">',
  '            <div className="w-16 h-16 bg-amber-50 text-amber-600 rounded-full flex items-center justify-center mb-4">',
  '              <UserRound size={32} />',
  '            </div>',
  '            <h3 className="text-lg font-bold text-slate-800 mb-2">\u0644\u0627 \u062A\u0648\u062C\u062F \u0646\u062A\u0627\u0626\u062C</h3>',
  '            <p className="text-slate-500 max-w-md text-sm">',
  '              \u0644\u0645 \u0646\u062A\u0645\u0643\u0646 \u0645\u0646 \u0627\u0644\u0639\u062B\u0648\u0631 \u0639\u0644\u0649 \u0623\u064A \u0639\u0645\u064A\u0644 \u064A\u0637\u0627\u0628\u0642 \u0627\u0644\u0628\u062D\u062B. \u062A\u0623\u0643\u062F \u0645\u0646 \u0643\u062A\u0627\u0628\u0629 \u0627\u0644\u0627\u0633\u0645 \u0623\u0648 \u0627\u0644\u0631\u0642\u0645 \u0628\u0634\u0643\u0644 \u0635\u062D\u064A\u062D.',
  '            </p>',
  '          </div>',
  '        ) : isLoadingSales ? (',
  '          <div className="flex flex-col items-center justify-center py-16 print:hidden">',
  '            <div className="w-10 h-10 border-4 border-sky-600 border-t-transparent rounded-full animate-spin mb-3"></div>',
  '            <p className="text-slate-600 font-medium">\u062C\u0627\u0631\u064A \u062A\u062D\u0645\u064A\u0644 \u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0639\u0645\u064A\u0644...</p>',
  '          </div>',
  '        ) : (',
  '          <>',
  '',
  '        {/* TABS SECTION */}',
].join('\n');

applyReplace(titleBlock, titleBlockReplacement, 'SearchBar');

// ---- EDIT 5: Close the conditional JSX wrapper ----
// We need to add a closing </> before </div> at the end of the tabs content
// The tabs content ends right before the printable view section
const closingTarget = '      </div>\n\n      {/* PRINTABLE INVOICE STATEMENT */}';
const closingReplacement = '      </>)}\n      </div>\n\n      {/* PRINTABLE INVOICE STATEMENT */}';

applyReplace(closingTarget, closingReplacement, 'ClosingWrapper');

if (success) {
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('All edits applied successfully!');
} else {
  console.log('Some edits failed. File NOT saved.');
  process.exit(1);
}
