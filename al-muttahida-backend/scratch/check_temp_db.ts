import { dbPromise } from '../src/db.js';

async function main() {
  const db = await dbPromise;

  try {
    const legacyProducts = await db.all(`
      SELECT TOP 10 PID, ProductCode, Barcode, ProductName, CostPrice, SellingPrice, Discount, VAT, OpeningStock
      FROM [INV_DB_IMPORT_TEMP].[dbo].[Product]
    `);
    console.log('LEGACY_PRODUCTS_SAMPLE:', JSON.stringify(legacyProducts, null, 2));

    const legacyStats = await db.get(`
      SELECT 
        COUNT(*) as total_products,
        COUNT(CASE WHEN CostPrice = SellingPrice THEN 1 END) as equal_prices,
        COUNT(CASE WHEN CostPrice < SellingPrice THEN 1 END) as selling_higher,
        COUNT(CASE WHEN CostPrice > SellingPrice THEN 1 END) as cost_higher,
        AVG(CASE WHEN CostPrice > 0 THEN CostPrice END) as avg_cost,
        AVG(CASE WHEN SellingPrice > 0 THEN SellingPrice END) as avg_selling
      FROM [INV_DB_IMPORT_TEMP].[dbo].[Product]
    `);
    console.log('LEGACY_PRODUCT_STATS:', legacyStats);

    const legacyInvoices = await db.get(`
      SELECT COUNT(*) as total_invoices FROM [INV_DB_IMPORT_TEMP].[dbo].[InvoiceInfo]
    `);
    console.log('LEGACY_INVOICES_COUNT:', legacyInvoices);

    const legacyInvoiceProducts = await db.get(`
      SELECT COUNT(*) as total_invoice_products FROM [INV_DB_IMPORT_TEMP].[dbo].[Invoice_Product]
    `);
    console.log('LEGACY_INVOICE_PRODUCTS_COUNT:', legacyInvoiceProducts);

    const sampleInvoiceProducts = await db.all(`
      SELECT TOP 10 * FROM [INV_DB_IMPORT_TEMP].[dbo].[Invoice_Product]
    `);
    console.log('SAMPLE_LEGACY_INVOICE_PRODUCTS:', JSON.stringify(sampleInvoiceProducts, null, 2));

  } catch (e) {
    console.log('Error:', e.message);
  }

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
