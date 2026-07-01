import fs from 'fs';

const filePath = 'al-muttahida-saas/src/pages/CollectionStatement.tsx';
let content = fs.readFileSync(filePath, 'utf8');

// Replace the UI block ternary branch without wrapping parenthesis
const targetStart = `) : (
                filteredRows.map((row) => {`;

const targetStartAlt = `) : (\r\n                filteredRows.map((row) => {`;

if (content.includes(targetStart)) {
  content = content.replace(targetStart, `) : filteredRows.map((row) => {`);
  console.log("Replaced targetStart");
} else if (content.includes(targetStartAlt)) {
  content = content.replace(targetStartAlt, `) : filteredRows.map((row) => {`);
  console.log("Replaced targetStartAlt");
} else {
  console.log("Could not find targetStart");
}

// Replace the end of the block
const targetEnd = `);\n              }))}`;
const targetEndAlt = `);\r\n              }))}`;

if (content.includes(targetEnd)) {
  content = content.replace(targetEnd, `);\n              })}`);
  console.log("Replaced targetEnd");
} else if (content.includes(targetEndAlt)) {
  content = content.replace(targetEndAlt, `);\r\n              })}`);
  console.log("Replaced targetEndAlt");
} else {
  console.log("Could not find targetEnd");
}

fs.writeFileSync(filePath, content, 'utf8');
console.log("Saved.");
