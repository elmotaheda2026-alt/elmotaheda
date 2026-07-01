import fs from 'fs';

const filePath = 'al-muttahida-saas/src/pages/Invoices.tsx';
let content = fs.readFileSync(filePath, 'utf8');

console.log("Original content length:", content.length);

// Remove default customer selection on mount
const searchCust = `      if (loadedCustomers.length > 0) {
        setSelectedCustomerId(loadedCustomers[0].id);
      }`;

// Remove default supplier selection on mount
const searchSupp = `      if (loadedSuppliers.length > 0) {
        setProcurementSupplierId(loadedSuppliers[0].id);
        setQuickProduct((current) => ({ ...current, supplierId: current.supplierId || loadedSuppliers[0].id }));
      }`;

content = content.replace(/\r\n/g, "\n");
if (content.includes(searchCust.replace(/\r\n/g, "\n"))) {
  content = content.replace(searchCust.replace(/\r\n/g, "\n"), "");
  console.log("Removed default customer selection on mount successfully.");
} else {
  console.log("Could NOT find default customer selection block.");
}

if (content.includes(searchSupp.replace(/\r\n/g, "\n"))) {
  // Let's modify it to only set quickProduct supplier id without selecting the default supplier for the main form
  const replacementSupp = `      if (loadedSuppliers.length > 0) {
        setQuickProduct((current) => ({ ...current, supplierId: current.supplierId || loadedSuppliers[0].id }));
      }`;
  content = content.replace(searchSupp.replace(/\r\n/g, "\n"), replacementSupp);
  console.log("Removed default supplier selection on mount successfully.");
} else {
  console.log("Could NOT find default supplier selection block.");
}

fs.writeFileSync(filePath, content, 'utf8');
console.log("Done.");
