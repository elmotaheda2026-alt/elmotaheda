import { dbPromise } from '../src/db.js';

async function main() {
  const db = await dbPromise;

  const salesCols = await db.all(`
    SELECT COLUMN_NAME, DATA_TYPE 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'sales'
  `);
  console.log('SALES_COLUMNS:', salesCols.map(c => c.COLUMN_NAME));

  const totalSales = await db.get(`SELECT COUNT(*) as cnt FROM sales`);
  console.log('TOTAL_SALES_COUNT:', totalSales);

  const sampleSales = await db.all(`SELECT TOP 3 * FROM sales`);
  console.log('SAMPLE_SALES:', JSON.stringify(sampleSales, null, 2));

  const salesWithoutItems = await db.get(`
    SELECT COUNT(*) as sales_without_items
    FROM sales s
    WHERE NOT EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = s.id)
  `);
  console.log('SALES_WITHOUT_ITEMS:', salesWithoutItems);

  const salesWithItems = await db.get(`
    SELECT COUNT(*) as sales_with_items
    FROM sales s
    WHERE EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = s.id)
  `);
  console.log('SALES_WITH_ITEMS:', salesWithItems);

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
