import crypto from 'node:crypto';
import sql from 'mssql';

const sourceDatabase = 'INV_DB_IMPORT_TEMP';
const targetDatabase = process.env.TARGET_DB || 'AlMuttahida_New';

const clean = (value) => String(value ?? '').trim();
const money = (value) => Number(Number(value || 0).toFixed(2));
const iso = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
};

function imageData(value) {
  if (!Buffer.isBuffer(value) || value.length === 0) return null;
  return `data:image/jpeg;base64,${value.toString('base64')}`;
}

function scheduleStatus(row) {
  const text = clean(row.status);
  const paid = money(row.kima_msd);
  const amount = money(row.kima_ins);
  if (text.includes('دفع') || paid >= amount) return 'paid';
  if (paid > 0) return 'partial';
  return 'unpaid';
}

const config = {
  server: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 1433),
  user: process.env.DB_USER || 'sallam',
  password: process.env.DB_PASSWORD || 'ah123',
  database: 'master',
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
};

const pool = await sql.connect(config);
const transaction = new sql.Transaction(pool);

try {
  const products = await pool.request().query(`
    SELECT
      p.*,
      sc.Category,
      pj.Photo,
      COALESCE(stock_in.qty, 0) AS stock_in_qty,
      COALESCE(sold.qty, 0) AS sold_qty
    FROM [${sourceDatabase}].[dbo].[Product] p
    LEFT JOIN [${sourceDatabase}].[dbo].[SubCategory] sc ON sc.ID = p.SubCategoryID
    LEFT JOIN [${sourceDatabase}].[dbo].[Product_Join] pj ON pj.ProductID = p.PID
    LEFT JOIN (
      SELECT ProductID, SUM(Qty) AS qty
      FROM [${sourceDatabase}].[dbo].[Stock_Product]
      GROUP BY ProductID
    ) stock_in ON stock_in.ProductID = p.PID
    LEFT JOIN (
      SELECT ProductID, SUM(Qty) AS qty
      FROM [${sourceDatabase}].[dbo].[Invoice_Product]
      GROUP BY ProductID
    ) sold ON sold.ProductID = p.PID
    ORDER BY p.PID
  `);

  const sales = await pool.request().query(`
    SELECT
      i.*,
      c.CustomerID AS CustomerNumber,
      c.Name AS CustomerName,
      sm.SalesMan_ID AS SalesRepCode,
      sm.Name AS SalesRepName,
      sm.CommissionPer,
      comm.Commission
    FROM [${sourceDatabase}].[dbo].[InvoiceInfo] i
    LEFT JOIN [${sourceDatabase}].[dbo].[Customer] c ON c.ID = i.CustomerID
    LEFT JOIN [${sourceDatabase}].[dbo].[SalesMan] sm ON sm.SM_ID = i.SalesmanID
    LEFT JOIN [${sourceDatabase}].[dbo].[Salesman_Commission] comm ON comm.InvoiceID = i.Inv_ID
    ORDER BY i.Inv_ID
  `);

  const saleItems = await pool.request().query(`
    SELECT ip.*, p.ProductName
    FROM [${sourceDatabase}].[dbo].[Invoice_Product] ip
    LEFT JOIN [${sourceDatabase}].[dbo].[Product] p ON p.PID = ip.ProductID
    ORDER BY ip.InvoiceID, ip.IPo_ID
  `);

  const schedules = await pool.request().query(`
    SELECT *
    FROM [${sourceDatabase}].[dbo].[installment]
    ORDER BY InvoiceNo, id
  `);

  await transaction.begin();

  let productsInserted = 0;
  let productsSkipped = 0;
  let salesInserted = 0;
  let salesSkipped = 0;
  let salesMissingCustomer = 0;
  let saleItemsInserted = 0;
  let schedulesInserted = 0;
  let customerBalancesUpdated = 0;

  const productIdByOldId = new Map();

  for (const row of products.recordset) {
    const barcode = clean(row.Barcode) || clean(row.ProductCode) || `OLD-P-${row.PID}`;
    const existing = await new sql.Request(transaction)
      .input('barcode', sql.NVarChar, barcode)
      .query(`SELECT id FROM [${targetDatabase}].[dbo].[products] WHERE barcode = @barcode`);

    if (existing.recordset[0]?.id) {
      productIdByOldId.set(row.PID, existing.recordset[0].id);
      productsSkipped += 1;
      continue;
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const quantity = Math.max(0, Number(row.OpeningStock || 0) + Number(row.stock_in_qty || 0) - Number(row.sold_qty || 0));

    await new sql.Request(transaction)
      .input('id', sql.NVarChar, id)
      .input('name', sql.NVarChar, clean(row.ProductName) || barcode)
      .input('barcode', sql.NVarChar, barcode)
      .input('category', sql.NVarChar, clean(row.Category) || null)
      .input('unit', sql.NVarChar, 'قطعة')
      .input('purchasePrice', sql.Decimal(18, 2), money(row.CostPrice))
      .input('salePrice', sql.Decimal(18, 2), money(row.SellingPrice))
      .input('discount', sql.Decimal(18, 2), money(row.Discount))
      .input('tax', sql.Decimal(18, 2), money(row.VAT))
      .input('quantity', sql.Decimal(18, 2), quantity)
      .input('minQuantity', sql.Decimal(18, 2), Number(row.ReorderPoint || 0))
      .input('image', sql.NVarChar(sql.MAX), imageData(row.Photo))
      .input('description', sql.NVarChar, clean(row.Description) || null)
      .input('createdAt', sql.NVarChar, now)
      .input('updatedAt', sql.NVarChar, now)
      .query(`
        INSERT INTO [${targetDatabase}].[dbo].[products] (
          id, name, barcode, category, fulfillment_type, unit, purchase_price,
          sale_price, discount, tax, quantity, min_quantity, image, description,
          created_at, updated_at
        )
        VALUES (
          @id, @name, @barcode, @category, 'stocked', @unit, @purchasePrice,
          @salePrice, @discount, @tax, @quantity, @minQuantity, @image, @description,
          @createdAt, @updatedAt
        )
      `);

    productIdByOldId.set(row.PID, id);
    productsInserted += 1;
  }

  const itemsByInvoice = new Map();
  for (const item of saleItems.recordset) {
    const current = itemsByInvoice.get(item.InvoiceID) || [];
    current.push(item);
    itemsByInvoice.set(item.InvoiceID, current);
  }

  const schedulesByInvoice = new Map();
  for (const schedule of schedules.recordset) {
    const key = clean(schedule.InvoiceNo);
    const current = schedulesByInvoice.get(key) || [];
    current.push(schedule);
    schedulesByInvoice.set(key, current);
  }

  for (const row of sales.recordset) {
    const invoiceNumber = clean(row.InvoiceNo) || `OLD-S-${row.Inv_ID}`;
    const existing = await new sql.Request(transaction)
      .input('invoiceNumber', sql.NVarChar, invoiceNumber)
      .query(`SELECT id FROM [${targetDatabase}].[dbo].[sales] WHERE invoice_number = @invoiceNumber`);

    if (existing.recordset.length > 0) {
      salesSkipped += 1;
      continue;
    }

    const customerNumber = clean(row.CustomerNumber);
    const customer = await new sql.Request(transaction)
      .input('customerNumber', sql.NVarChar, customerNumber)
      .query(`SELECT id, name FROM [${targetDatabase}].[dbo].[customers] WHERE customer_number = @customerNumber`);

    if (!customer.recordset[0]?.id) {
      salesMissingCustomer += 1;
      continue;
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const total = money(row.GrandTotal);
    const remaining = money(row.Balance);
    const paid = money(total - remaining);
    const date = iso(row.InvoiceDate);
    const invoiceItems = itemsByInvoice.get(row.Inv_ID) || [];
    const invoiceSchedules = schedulesByInvoice.get(invoiceNumber) || [];
    const firstScheduleDate = invoiceSchedules[0]?.date_ins ? iso(invoiceSchedules[0].date_ins) : null;
    const monthlyInstallment = invoiceSchedules.length ? money(invoiceSchedules[0].kima_ins) : null;
    const status = remaining <= 0 ? 'completed' : 'pending';
    const salesRepName = clean(row.SalesRepName) || null;
    const salesRepCode = clean(row.SalesRepCode) || null;

    await new sql.Request(transaction)
      .input('id', sql.NVarChar, id)
      .input('invoiceNumber', sql.NVarChar, invoiceNumber)
      .input('customerId', sql.NVarChar, customer.recordset[0].id)
      .input('customerName', sql.NVarChar, customer.recordset[0].name || clean(row.CustomerName) || customerNumber)
      .input('total', sql.Decimal(18, 2), total)
      .input('paid', sql.Decimal(18, 2), paid)
      .input('remaining', sql.Decimal(18, 2), remaining)
      .input('status', sql.NVarChar, status)
      .input('date', sql.NVarChar, date)
      .input('notes', sql.NVarChar, clean(row.Remarks) || null)
      .input('createdBy', sql.NVarChar, 'import')
      .input('createdAt', sql.NVarChar, now)
      .input('subtotal', sql.Decimal(18, 2), money(invoiceItems.reduce((sum, item) => sum + money(item.Amount), 0)) || total)
      .input('discount', sql.Decimal(18, 2), money(invoiceItems.reduce((sum, item) => sum + money(item.Discount), 0)))
      .input('tax', sql.Decimal(18, 2), money(invoiceItems.reduce((sum, item) => sum + money(item.VAT), 0)))
      .input('manualInvoiceRef', sql.NVarChar, clean(row.Manual_Inv) || clean(row.Inv_ID_2) || null)
      .input('salesRepId', sql.NVarChar, salesRepCode)
      .input('salesRepName', sql.NVarChar, salesRepName)
      .input('commissionRate', sql.Decimal(18, 2), row.CommissionPer == null ? null : money(row.CommissionPer))
      .input('commissionAmount', sql.Decimal(18, 2), row.Commission == null ? null : money(row.Commission))
      .input('installmentMonths', sql.Int, invoiceSchedules.length || null)
      .input('installmentStartDate', sql.NVarChar, firstScheduleDate)
      .input('upfrontAmount', sql.Decimal(18, 2), invoiceItems[0]?.TotalPaid == null ? paid : money(invoiceItems[0].TotalPaid))
      .input('monthlyInstallmentAmount', sql.Decimal(18, 2), monthlyInstallment)
      .query(`
        INSERT INTO [${targetDatabase}].[dbo].[sales] (
          id, invoice_number, customer_id, customer_name, total, paid, remaining, status, date, notes,
          version, locked, created_by, created_at, subtotal, discount, tax, payment_method,
          manual_invoice_ref, sales_rep_id, sales_rep_name, commission_rate, commission_amount,
          installment_months, installment_start_date, upfront_amount, monthly_installment_amount
        )
        VALUES (
          @id, @invoiceNumber, @customerId, @customerName, @total, @paid, @remaining, @status, @date, @notes,
          1, 0, @createdBy, @createdAt, @subtotal, @discount, @tax, 'installment',
          @manualInvoiceRef, @salesRepId, @salesRepName, @commissionRate, @commissionAmount,
          @installmentMonths, @installmentStartDate, @upfrontAmount, @monthlyInstallmentAmount
        )
      `);

    for (const item of invoiceItems) {
      const productId = productIdByOldId.get(item.ProductID);
      if (!productId) continue;
      await new sql.Request(transaction)
        .input('id', sql.NVarChar, crypto.randomUUID())
        .input('saleId', sql.NVarChar, id)
        .input('productId', sql.NVarChar, productId)
        .input('productName', sql.NVarChar, clean(item.ProductName) || clean(item.Barcode) || String(item.ProductID))
        .input('barcode', sql.NVarChar, clean(item.Barcode) || null)
        .input('quantity', sql.Decimal(18, 2), Number(item.Qty || 0))
        .input('unitPrice', sql.Decimal(18, 2), money(item.SellingPrice))
        .input('unitCost', sql.Decimal(18, 2), money(item.CostPrice))
        .input('discount', sql.Decimal(18, 2), money(item.DiscountPer))
        .input('tax', sql.Decimal(18, 2), money(item.VATPer))
        .input('total', sql.Decimal(18, 2), money(item.TotalAmount))
        .query(`
          INSERT INTO [${targetDatabase}].[dbo].[sale_items] (
            id, sale_id, product_id, product_name, barcode, quantity, unit_price, unit_cost, discount, tax, total
          )
          VALUES (
            @id, @saleId, @productId, @productName, @barcode, @quantity, @unitPrice, @unitCost, @discount, @tax, @total
          )
        `);
      saleItemsInserted += 1;
    }

    for (const [index, schedule] of invoiceSchedules.entries()) {
      const paidAmount = money(schedule.kima_msd);
      await new sql.Request(transaction)
        .input('id', sql.NVarChar, crypto.randomUUID())
        .input('saleId', sql.NVarChar, id)
        .input('monthIndex', sql.Int, index + 1)
        .input('dueDate', sql.NVarChar, iso(schedule.date_ins))
        .input('amount', sql.Decimal(18, 2), money(schedule.kima_ins))
        .input('paidAmount', sql.Decimal(18, 2), paidAmount)
        .input('status', sql.NVarChar, scheduleStatus(schedule))
        .input('paidAt', sql.NVarChar, paidAmount > 0 && schedule.date_day ? iso(schedule.date_day) : null)
        .query(`
          INSERT INTO [${targetDatabase}].[dbo].[installment_schedules] (
            id, sale_id, month_index, due_date, amount, paid_amount, status, paid_at
          )
          VALUES (
            @id, @saleId, @monthIndex, @dueDate, @amount, @paidAmount, @status, @paidAt
          )
        `);
      schedulesInserted += 1;
    }

    if (remaining > 0) {
      await new sql.Request(transaction)
        .input('remaining', sql.Decimal(18, 2), remaining)
        .input('updatedAt', sql.NVarChar, now)
        .input('customerId', sql.NVarChar, customer.recordset[0].id)
        .query(`
          UPDATE [${targetDatabase}].[dbo].[customers]
          SET balance = balance + @remaining,
              updated_at = @updatedAt
          WHERE id = @customerId
        `);
      customerBalancesUpdated += 1;
    }

    salesInserted += 1;
  }

  await transaction.commit();
  console.log(JSON.stringify({
    sourceProducts: products.recordset.length,
    productsInserted,
    productsSkipped,
    sourceSales: sales.recordset.length,
    salesInserted,
    salesSkipped,
    salesMissingCustomer,
    saleItemsInserted,
    schedulesInserted,
    customerBalancesUpdated,
  }, null, 2));
} catch (error) {
  if (transaction._aborted === false) {
    await transaction.rollback();
  }
  throw error;
} finally {
  await pool.close();
}
