import fs from 'fs';

const filePath = 'al-muttahida-saas/src/pages/CollectionStatement.tsx';
let content = fs.readFileSync(filePath, 'utf8');
content = content.replace(/\r\n/g, "\n");

const targetFunc = `const toISODateOnly = (dateStr: string | Date | null | undefined): string => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return \`\${y}-\${m}-\${d}\`;
};`;

const replacementFunc = `const toISODateOnly = (dateStr: string | Date | null | undefined): string => {
  if (!dateStr) return '';
  if (typeof dateStr === 'string') {
    return dateStr.slice(0, 10);
  }
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return \`\${y}-\${m}-\${d}\`;
};`;

if (content.includes(targetFunc)) {
  content = content.replace(targetFunc, replacementFunc);
  console.log("Updated toISODateOnly to be timezone-safe.");
} else {
  console.log("Could NOT find target function toISODateOnly.");
}

fs.writeFileSync(filePath, content, 'utf8');
console.log("Saved.");
