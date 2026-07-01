import fs from 'fs';

// Helper function to define in the files
const normalizeHelperCode = `const normalizeArabic = (str: string): string => {
  if (!str) return '';
  return str
    .replace(/[أإآا]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[ىي]/g, 'ي')
    .trim()
    .toLowerCase();
};
`;

// 1. Update Invoices.tsx
const pathInvoices = 'al-muttahida-saas/src/pages/Invoices.tsx';
let contentInvoices = fs.readFileSync(pathInvoices, 'utf8');

// Insert normalize helper at the top (above component)
const searchTopInvoices = "export default function Invoices() {";
if (contentInvoices.includes(searchTopInvoices) && !contentInvoices.includes("const normalizeArabic")) {
  contentInvoices = contentInvoices.replace(searchTopInvoices, normalizeHelperCode + "\n" + searchTopInvoices);
  console.log("Added normalizeArabic helper to Invoices.tsx");
}

// Update customerSuggestions memo in Invoices.tsx
const suggestionsMemoInvoicesSearch = `  const customerSuggestions = useMemo(() => {
    const term = customerSearchTerm.trim().toLowerCase();
    if (term.length < 2) return [];
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(term) ||
        (c.phone && c.phone.includes(term))
    );
  }, [customers, customerSearchTerm]);`;

const suggestionsMemoInvoicesReplacement = `  const customerSuggestions = useMemo(() => {
    const term = normalizeArabic(customerSearchTerm);
    if (term.length < 1) return [];
    return customers.filter(
      (c) =>
        normalizeArabic(c.name).includes(term) ||
        (c.phone && c.phone.includes(term))
    );
  }, [customers, customerSearchTerm]);`;

if (contentInvoices.includes(suggestionsMemoInvoicesSearch)) {
  contentInvoices = contentInvoices.replace(suggestionsMemoInvoicesSearch, suggestionsMemoInvoicesReplacement);
  console.log("Updated customerSuggestions in Invoices.tsx to 1-char + normalize");
} else {
  // Let's do a more generic replacement or print to see what we have
  console.log("Could not find customerSuggestions memo in Invoices.tsx exactly as written, attempting flexible search.");
  // Fallback replace
  const termRegex = /const term = customerSearchTerm\.trim\(\)\.toLowerCase\(\);\s*if \(term\.length < 2\) return \[\];\s*return customers\.filter\([\s\S]*?\);/g;
  if (contentInvoices.match(termRegex)) {
    contentInvoices = contentInvoices.replace(termRegex, `const term = normalizeArabic(customerSearchTerm);
    if (term.length < 1) return [];
    return customers.filter(
      (c) =>
        normalizeArabic(c.name).includes(term) ||
        (c.phone && c.phone.includes(term))
    );`);
    console.log("Updated customerSuggestions via regex in Invoices.tsx");
  }
}

fs.writeFileSync(pathInvoices, contentInvoices, 'utf8');


// 2. Update CollectionStatement.tsx
const pathCollection = 'al-muttahida-saas/src/pages/CollectionStatement.tsx';
let contentCollection = fs.readFileSync(pathCollection, 'utf8');

const searchTopCollection = "export default function CollectionStatement() {";
if (contentCollection.includes(searchTopCollection) && !contentCollection.includes("const normalizeArabic")) {
  contentCollection = contentCollection.replace(searchTopCollection, normalizeHelperCode + "\n" + searchTopCollection);
  console.log("Added normalizeArabic helper to CollectionStatement.tsx");
}

// Update suggestions memo in CollectionStatement.tsx
const suggestionsMemoCollectionSearch = `  const suggestions = useMemo(() => {
    const term = invoiceSearchTerm.trim().toLowerCase();
    if (term.length < 2) return [];
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(term) ||
        (c.phone && c.phone.includes(term))
    );
  }, [customers, invoiceSearchTerm]);`;

const suggestionsMemoCollectionReplacement = `  const suggestions = useMemo(() => {
    const term = normalizeArabic(invoiceSearchTerm);
    if (term.length < 1) return [];
    return customers.filter(
      (c) =>
        normalizeArabic(c.name).includes(term) ||
        (c.phone && c.phone.includes(term))
    );
  }, [customers, invoiceSearchTerm]);`;

if (contentCollection.includes(suggestionsMemoCollectionSearch)) {
  contentCollection = contentCollection.replace(suggestionsMemoCollectionSearch, suggestionsMemoCollectionReplacement);
  console.log("Updated suggestions in CollectionStatement.tsx to 1-char + normalize");
} else {
  console.log("Could not find suggestions memo in CollectionStatement.tsx exactly as written");
}

fs.writeFileSync(pathCollection, contentCollection, 'utf8');
console.log("Fix Autocomplete Search script finished.");
