function pad(v){return String(v).padStart(2,'0');}
function addMonths(dateStr, months){
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  date.setMonth(date.getMonth() + months);
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  console.log(`${y}-${pad(m)}-${pad(d)}`);
}
addMonths('2023-01-31', 1);
addMonths('2023-01-31', 2);
addMonths('2023-07-15', 3);
