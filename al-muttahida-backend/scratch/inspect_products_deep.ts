import { dbPromise } from '../src/db.js';

async function main() {
  const db = await dbPromise;
  
  const stats = await db.get(`
    SELECT 
      COUNT(*) as total_products,
      COUNT(CASE WHEN purchase_price = sale_price THEN 1 END) as equal_prices,
      COUNT(CASE WHEN purchase_price > sale_price THEN 1 END) as loss_prices,
      COUNT(CASE WHEN purchase_price < sale_price THEN 1 END) as profit_prices,
      COUNT(CASE WHEN quantity > 0 THEN 1 END) as positive_qty,
      COUNT(CASE WHEN quantity = 0 THEN 1 END) as zero_qty,
      COUNT(CASE WHEN quantity < 0 THEN 1 END) as negative_qty,
      COUNT(CASE WHEN fulfillment_type = 'on_demand' THEN 1 END) as on_demand_count,
      COUNT(CASE WHEN fulfillment_type = 'stocked' THEN 1 END) as stocked_count,
      COUNT(CASE WHEN barcode IS NULL OR barcode = '' THEN 1 END) as no_barcode
    FROM products
  `);
  console.log('PRODUCTS_STATS:', JSON.stringify(stats, null, 2));

  const sampleRows = await db.all(`
    SELECT TOP 10 id, name, barcode, category, fulfillment_type, unit, purchase_price, sale_price, quantity
    FROM products
    ORDER BY created_at DESC
  `);
  console.log('SAMPLE_PRODUCTS:', JSON.stringify(sampleRows, null, 2));

  // Check how products are related to sales
  const salesItemsStats = await db.get(`
    SELECT 
      COUNT(*) as total_sale_items,
      COUNT(DISTINCT product_id) as distinct_products_in_sales,
      COUNT(CASE WHEN p.id IS NULL THEN 1 END) as orphaned_sale_items
    FROM sale_items si
    LEFT JOIN products p ON p.id = si.product_id
  `);
  console.log('SALES_ITEMS_STATS:', JSON.stringify(salesItemsStats, null, 2));

  // Check purchases
  const purchaseItemsStats = await db.get(`
    SELECT 
      COUNT(*) as total_purchase_items,
      COUNT(DISTINCT product_id) as distinct_products_in_purchases
    FROM purchase_items
  `);
  console.log('PURCHASE_ITEMS_STATS:', JSON.stringify(purchaseItemsStats, null, 2));

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
