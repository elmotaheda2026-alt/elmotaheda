import fs from 'fs';

// 1. Update Payments.tsx
const pathPayments = 'al-muttahida-saas/src/pages/Payments.tsx';
let contentPayments = fs.readFileSync(pathPayments, 'utf8');
contentPayments = contentPayments.replace(/\r\n/g, "\n");

const targetEffectPayments = `  useEffect(() => {
    const customer = customers.find((c) => c.id === incomingForm.customerId);
    if (customer) {
      setCustomerSearchTerm(customer.name);
    } else {
      setCustomerSearchTerm('');
    }
  }, [incomingForm.customerId, customers]);`;

const replacementEffectPayments = `  useEffect(() => {
    const customer = customers.find((c) => c.id === incomingForm.customerId);
    if (customer) {
      if (customerSearchTerm !== customer.name) {
        setCustomerSearchTerm(customer.name);
      }
    } else {
      // Only clear if the user is not currently focusing/typing in the search field
      if (!showCustomerSuggestions && customerSearchTerm !== '') {
        setCustomerSearchTerm('');
      }
    }
  }, [incomingForm.customerId, customers, showCustomerSuggestions]);`;

if (contentPayments.includes(targetEffectPayments)) {
  contentPayments = contentPayments.replace(targetEffectPayments, replacementEffectPayments);
  console.log("Updated sync useEffect in Payments.tsx successfully.");
} else {
  console.log("Could NOT find targetEffectPayments in Payments.tsx");
}
fs.writeFileSync(pathPayments, contentPayments, 'utf8');


// 2. Update Invoices.tsx
const pathInvoices = 'al-muttahida-saas/src/pages/Invoices.tsx';
let contentInvoices = fs.readFileSync(pathInvoices, 'utf8');
contentInvoices = contentInvoices.replace(/\r\n/g, "\n");

const targetEffectInvoices = `  useEffect(() => {
    const customer = customers.find((c) => c.id === selectedCustomerId);
    if (customer) {
      setCustomerSearchTerm(customer.name);
    } else {
      setCustomerSearchTerm('');
    }
  }, [selectedCustomerId, customers]);`;

const replacementEffectInvoices = `  useEffect(() => {
    const customer = customers.find((c) => c.id === selectedCustomerId);
    if (customer) {
      if (customerSearchTerm !== customer.name) {
        setCustomerSearchTerm(customer.name);
      }
    } else {
      if (!showCustomerSuggestions && customerSearchTerm !== '') {
        setCustomerSearchTerm('');
      }
    }
  }, [selectedCustomerId, customers, showCustomerSuggestions]);`;

if (contentInvoices.includes(targetEffectInvoices)) {
  contentInvoices = contentInvoices.replace(targetEffectInvoices, replacementEffectInvoices);
  console.log("Updated customer sync useEffect in Invoices.tsx successfully.");
} else {
  console.log("Could NOT find targetEffectInvoices in Invoices.tsx");
}

// SalesRep sync in Invoices.tsx
const targetEffectSalesRep = `  useEffect(() => {
    const rep = salesReps.find((r) => r.id === selectedSalesRepId);
    if (rep) {
      setSalesRepSearchTerm(rep.name);
    } else {
      setSalesRepSearchTerm('');
    }
  }, [selectedSalesRepId, salesReps]);`;

const replacementEffectSalesRep = `  useEffect(() => {
    const rep = salesReps.find((r) => r.id === selectedSalesRepId);
    if (rep) {
      if (salesRepSearchTerm !== rep.name) {
        setSalesRepSearchTerm(rep.name);
      }
    } else {
      if (!showSalesRepSuggestions && salesRepSearchTerm !== '') {
        setSalesRepSearchTerm('');
      }
    }
  }, [selectedSalesRepId, salesReps, showSalesRepSuggestions]);`;

if (contentInvoices.includes(targetEffectSalesRep)) {
  contentInvoices = contentInvoices.replace(targetEffectSalesRep, replacementEffectSalesRep);
  console.log("Updated salesRep sync useEffect in Invoices.tsx successfully.");
}

// Supplier sync in Invoices.tsx
const targetEffectSupplier = `  useEffect(() => {
    const supplier = suppliers.find((s) => s.id === procurementSupplierId);
    if (supplier) {
      setSupplierSearchTerm(supplier.name);
    } else {
      setSupplierSearchTerm('');
    }
  }, [procurementSupplierId, suppliers]);`;

const replacementEffectSupplier = `  useEffect(() => {
    const supplier = suppliers.find((s) => s.id === procurementSupplierId);
    if (supplier) {
      if (supplierSearchTerm !== supplier.name) {
        setSupplierSearchTerm(supplier.name);
      }
    } else {
      if (!showSupplierSuggestions && supplierSearchTerm !== '') {
        setSupplierSearchTerm('');
      }
    }
  }, [procurementSupplierId, suppliers, showSupplierSuggestions]);`;

if (contentInvoices.includes(targetEffectSupplier)) {
  contentInvoices = contentInvoices.replace(targetEffectSupplier, replacementEffectSupplier);
  console.log("Updated supplier sync useEffect in Invoices.tsx successfully.");
}

// Quick Supplier sync in Invoices.tsx
const targetEffectQuickSupplier = `  useEffect(() => {
    const supplier = suppliers.find((s) => s.id === quickProduct.supplierId);
    if (supplier) {
      setQuickSupplierSearchTerm(supplier.name);
    } else {
      setQuickSupplierSearchTerm('');
    }
  }, [quickProduct.supplierId, suppliers]);`;

const replacementEffectQuickSupplier = `  useEffect(() => {
    const supplier = suppliers.find((s) => s.id === quickProduct.supplierId);
    if (supplier) {
      if (quickSupplierSearchTerm !== supplier.name) {
        setQuickSupplierSearchTerm(supplier.name);
      }
    } else {
      if (!showQuickSupplierSuggestions && quickSupplierSearchTerm !== '') {
        setQuickSupplierSearchTerm('');
      }
    }
  }, [quickProduct.supplierId, suppliers, showQuickSupplierSuggestions]);`;

if (contentInvoices.includes(targetEffectQuickSupplier)) {
  contentInvoices = contentInvoices.replace(targetEffectQuickSupplier, replacementEffectQuickSupplier);
  console.log("Updated quickSupplier sync useEffect in Invoices.tsx successfully.");
}

fs.writeFileSync(pathInvoices, contentInvoices, 'utf8');
console.log("All sync updates applied.");
