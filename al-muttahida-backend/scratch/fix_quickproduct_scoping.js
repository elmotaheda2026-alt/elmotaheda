import fs from 'fs';

const filePath = 'al-muttahida-saas/src/pages/Invoices.tsx';
let content = fs.readFileSync(filePath, 'utf8');
content = content.replace(/\r\n/g, "\n");

console.log("Original content length:", content.length);

// 1. Remove the old quickProduct declaration
const oldDeclaration = `  const [quickProduct, setQuickProduct] = useState<QuickProductForm>({
    name: '',
    purchasePrice: 0,
    salePrice: 0,
    supplierId: '',
  });\n`;

let found = false;
if (content.includes(oldDeclaration)) {
  content = content.replace(oldDeclaration, "");
  found = true;
}
console.log("Removal status:", found);

// 2. Insert it at the top right below procurementSupplierId
const targetTop = "  const [procurementSupplierId, setProcurementSupplierId] = useState('');";
const targetTopReplacement = `  const [procurementSupplierId, setProcurementSupplierId] = useState('');
  const [quickProduct, setQuickProduct] = useState<QuickProductForm>({
    name: '',
    purchasePrice: 0,
    salePrice: 0,
    supplierId: '',
  });`;

if (content.includes(targetTop)) {
  content = content.replace(targetTop, targetTopReplacement);
  console.log("Successfully moved quickProduct declaration to the top.");
} else {
  console.log("Could NOT find targetTop for insertion.");
}

fs.writeFileSync(filePath, content, 'utf8');
console.log("File saved.");
