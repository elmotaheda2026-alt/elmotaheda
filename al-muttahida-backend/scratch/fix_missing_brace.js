import fs from 'fs';

const filePath = 'al-muttahida-saas/src/pages/CollectionStatement.tsx';
let content = fs.readFileSync(filePath, 'utf8');

// Find all occurrences of "isInvoiceLoading ? ("
const index = content.indexOf("isInvoiceLoading ? (");
if (index !== -1) {
  // Let's check if the character before it is already '{'
  const charBefore = content.charAt(index - 1);
  const twoCharsBefore = content.substring(index - 2, index);
  console.log(`Character before: "${charBefore}", Two chars before: "${twoCharsBefore}"`);
  
  if (!twoCharsBefore.includes('{')) {
    // Replace it
    content = content.substring(0, index) + "{" + content.substring(index);
    console.log("Inserted opening brace '{'");
  } else {
    console.log("Brace is already present!");
  }
} else {
  console.log("Could not find 'isInvoiceLoading ? ('");
}

fs.writeFileSync(filePath, content, 'utf8');
