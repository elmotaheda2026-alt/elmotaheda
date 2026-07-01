import fs from 'fs';

const filePath = 'al-muttahida-saas/src/pages/Payments.tsx';
let content = fs.readFileSync(filePath, 'utf8');
content = content.replace(/\r\n/g, "\n");

const targetFieldInput = `                                className="input-ui w-full"
                                placeholder="اكتب اسم العميل للبحث..."
                              />`;

const replacementFieldInput = `                                className="input-ui w-full"
                                placeholder="اكتب اسم العميل للبحث..."
                              />
                              <div className="text-[10px] text-slate-400 mt-1 flex justify-between px-2">
                                <span>قاعدة البيانات: {customers.length} عميل</span>
                                <span>نص البحث: "{customerSearchTerm}"</span>
                                <span>المطابقات: {customerSuggestions.length}</span>
                              </div>`;

if (content.includes(targetFieldInput)) {
  content = content.replace(targetFieldInput, replacementFieldInput);
  console.log("Added diagnostic helper line to Payments.tsx");
} else {
  console.log("Could NOT find target field input in Payments.tsx");
}

fs.writeFileSync(filePath, content, 'utf8');
console.log("File saved.");
