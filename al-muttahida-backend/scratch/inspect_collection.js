import fs from 'fs';
const content = fs.readFileSync('al-muttahida-saas/src/pages/CollectionStatement.tsx', 'utf8');
const lines = content.split('\n');
lines.forEach((line, index) => {
  if (line.includes('groupedDueRows')) {
    console.log(`Line ${index + 1}: ${line.trim()}`);
  }
});
