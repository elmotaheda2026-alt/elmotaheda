import { dbPromise } from '../src/db.js';

async function check() {
  const db = await dbPromise;
  const sales = await db.all('SELECT id, invoice_number, date, customer_name FROM sales ORDER BY date DESC');
  console.log('SALES:');
  console.log(sales);

  const schedules = await db.all('SELECT * FROM installment_schedules ORDER BY due_date DESC');
  console.log('SCHEDULES:');
  console.log(schedules.slice(0, 10));
  
  process.exit(0);
}

check().catch(err => {
  console.error(err);
  process.exit(1);
});
