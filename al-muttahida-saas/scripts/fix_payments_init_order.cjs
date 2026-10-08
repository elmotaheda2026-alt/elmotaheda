const fs = require('fs');

let c = fs.readFileSync('src/pages/Payments.tsx', 'utf8');

// 1. We want to remove closingDateYYYYMMDD, closingDatePayments, closingTotalIn, closingTotalOut, closingNet from line 839-843
const targetOldClosingVars = `  const closingDateYYYYMMDD = toYYYYMMDD(closingDate);
  const closingDatePayments = payments.filter((p) => toYYYYMMDD(p.date) === closingDateYYYYMMDD);
  const closingTotalIn = closingDatePayments.filter((p) => p.type === 'in').reduce((sum, p) => sum + p.amount, 0);
  const closingTotalOut = closingDatePayments.filter((p) => p.type === 'out').reduce((sum, p) => sum + p.amount, 0);
  const closingNet = closingTotalIn - closingTotalOut;`;

if (c.includes(targetOldClosingVars)) {
  c = c.replace(targetOldClosingVars, '');
} else {
  // Try CRLF / LF flexible replace
  const re = /const closingDateYYYYMMDD = toYYYYMMDD\(closingDate\);[\r\n\s]+const closingDatePayments = payments\.filter\(\(p\) => toYYYYMMDD\(p\.date\) === closingDateYYYYMMDD\);[\r\n\s]+const closingTotalIn = closingDatePayments\.filter\(\(p\) => p\.type === 'in'\)\.reduce\(\(sum, p\) => sum \+ p\.amount, 0\);[\r\n\s]+const closingTotalOut = closingDatePayments\.filter\(\(p\) => p\.type === 'out'\)\.reduce\(\(sum, p\) => sum \+ p\.amount, 0\);[\r\n\s]+const closingNet = closingTotalIn - closingTotalOut;/;
  c = c.replace(re, '');
}

// 2. Put helper toYYYYMMDD and closing variables right above handleClosePeriod
const toYYYYMMDDFn = `  const toYYYYMMDD = (dateStr: string) => {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return \`\${year}-\${month}-\${day}\`;
  };

  const closingDateYYYYMMDD = toYYYYMMDD(closingDate);
  const closingDatePayments = payments.filter((p) => toYYYYMMDD(p.date) === closingDateYYYYMMDD);
  const closingTotalIn = closingDatePayments.filter((p) => p.type === 'in').reduce((sum, p) => sum + p.amount, 0);
  const closingTotalOut = closingDatePayments.filter((p) => p.type === 'out').reduce((sum, p) => sum + p.amount, 0);
  const closingNet = closingTotalIn - closingTotalOut;`;

// Remove original definition of toYYYYMMDD around line 363 to avoid duplicate declaration
const originalToYYYYMMDD = `  const toYYYYMMDD = (dateStr: string) => {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return \`\${year}-\${month}-\${day}\`;
  };`;

if (c.includes(originalToYYYYMMDD)) {
  c = c.replace(originalToYYYYMMDD, '');
} else {
  // Regex replacement for original toYYYYMMDD
  const reToDate = /const toYYYYMMDD = \(dateStr: string\) => \{[\r\n\s]+const d = new Date\(dateStr\);[\r\n\s]+if \(isNaN\(d\.getTime\(\)\)\) return '';[\r\n\s]+const year = d\.getFullYear\(\);[\r\n\s]+const month = String\(d\.getMonth\(\) \+ 1\)\.padStart\(2, '0'\);[\r\n\s]+const day = String\(d\.getDate\(\)\)\.padStart\(2, '0'\);[\r\n\s]+return `\$\{year\}-\$\{month\}-\$\{day\}`;[\r\n\s]+\};/;
  c = c.replace(reToDate, '');
}

// Now insert toYYYYMMDDFn right before const handleClosePeriod
const targetBeforeHandleClose = '  const handleClosePeriod = async (event: React.FormEvent) => {';
if (c.includes(targetBeforeHandleClose)) {
  c = c.replace(targetBeforeHandleClose, toYYYYMMDDFn + '\r\n\r\n' + targetBeforeHandleClose);
} else {
  console.log('targetBeforeHandleClose not found!');
}

fs.writeFileSync('src/pages/Payments.tsx', c, 'utf8');
console.log('Successfully reordered variables in Payments.tsx');
