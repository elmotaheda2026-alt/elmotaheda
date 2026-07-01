import fs from 'fs';

const filePath = 'al-muttahida-saas/src/pages/Invoices.tsx';
let content = fs.readFileSync(filePath, 'utf8');

console.log("Original content length:", content.length);

// 1. Remove the old declarations
const targetSalesRep = "  const [selectedSalesRepId, setSelectedSalesRepId] = useState('');\n";
const targetSalesRepAlt = "  const [selectedSalesRepId, setSelectedSalesRepId] = useState('');\r\n";
const targetSupplier = "  const [procurementSupplierId, setProcurementSupplierId] = useState('');\n";
const targetSupplierAlt = "  const [procurementSupplierId, setProcurementSupplierId] = useState('');\r\n";

let foundSalesRep = false;
let foundSupplier = false;

if (content.includes(targetSalesRep)) {
  content = content.replace(targetSalesRep, "");
  foundSalesRep = true;
} else if (content.includes(targetSalesRepAlt)) {
  content = content.replace(targetSalesRepAlt, "");
  foundSalesRep = true;
}

if (content.includes(targetSupplier)) {
  content = content.replace(targetSupplier, "");
  foundSupplier = true;
} else if (content.includes(targetSupplierAlt)) {
  content = content.replace(targetSupplierAlt, "");
  foundSupplier = true;
}

console.log(`Removal check - SalesRep: ${foundSalesRep}, Supplier: ${foundSupplier}`);

// 2. Insert them at the top right below selectedCustomerId
const topTarget = "  const [selectedCustomerId, setSelectedCustomerId] = useState('');";
const topReplacement = `  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [selectedSalesRepId, setSelectedSalesRepId] = useState('');
  const [procurementSupplierId, setProcurementSupplierId] = useState('');`;

if (content.includes(topTarget)) {
  content = content.replace(topTarget, topReplacement);
  console.log("Successfully moved state declarations to the top.");
} else {
  console.log("Could NOT find topTarget for insertion.");
}

fs.writeFileSync(filePath, content, 'utf8');
console.log("Done! Content length after adjustment:", content.length);
