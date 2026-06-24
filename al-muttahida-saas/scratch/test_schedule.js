function pad(v){return String(v).padStart(2,'0');}
function addMonths(dateStr, months){
  const origDate = new Date(dateStr);
  if (isNaN(origDate.getTime())) return dateStr;
  const originalDay = origDate.getDate();
  const newDate = new Date(origDate);
  newDate.setMonth(newDate.getMonth() + months);
  const daysInTargetMonth = new Date(newDate.getFullYear(), newDate.getMonth()+1, 0).getDate();
  newDate.setDate(Math.min(originalDay, daysInTargetMonth));
  const year = newDate.getFullYear();
  const month = newDate.getMonth() + 1;
  const day = newDate.getDate();
  return `${year}-${pad(month)}-${pad(day)}`;
}
function generateId(){return Math.random().toString(36).substr(2,9);}
function buildInstallmentSchedule(startDate, amount, months){
  if (months <= 0 || amount <= 0) return [];
  const baseAmount = Number((amount / months).toFixed(2));
  let remaining = Number(amount.toFixed(2));
  return Array.from({ length: months }, (_, index) => {
    const installmentAmount = index === months - 1 ? Number(remaining.toFixed(2)) : baseAmount;
    remaining = Number((remaining - installmentAmount).toFixed(2));
    return {
      id: generateId(),
      monthIndex: index + 1,
      label: `القسط ${index + 1}`,
      dueDate: addMonths(startDate, index),
      amount: installmentAmount,
      paidAmount: 0,
      status: 'unpaid',
    };
  });
}
const schedule = buildInstallmentSchedule('2023-01-31', 300, 3);
console.log(schedule);
