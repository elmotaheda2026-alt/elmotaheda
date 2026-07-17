import sql from 'mssql';
import { config } from './config.js';

/**
 * Create a connection pool to the SQL Server database using the
 * configuration from `config.sql`. The returned object mimics the
 * minimal API used by the route handlers (`all`, `get`, `run`).
 */
export const poolPromise = sql.connect(config.sql);

export const dbPromise = (async () => {
  const pool = await poolPromise;

  // Simulated critical alert hook for database latency/timeouts
  async function triggerCriticalAlert(errorMsg: string, query: string, params: any[]) {
    // eslint-disable-next-line no-console
    console.error('\x1b[41m\x1b[37m 🚨 CRITICAL DB TIMEOUT ALERT 🚨 \x1b[0m');
    // eslint-disable-next-line no-console
    console.error(`Error: ${errorMsg}`);
    // eslint-disable-next-line no-console
    console.error(`Statement: ${query}`);
    // eslint-disable-next-line no-console
    console.error(`Parameters: ${JSON.stringify(params)}`);
  }

  async function executeQueryWithMonitoring<T>(
    queryFn: () => Promise<T>,
    sqlText: string,
    params: any[] = []
  ): Promise<T> {
    const startTime = Date.now();
    try {
      return await queryFn();
    } catch (error: any) {
      const elapsed = Date.now() - startTime;
      const isTimeout = error.message?.toLowerCase().includes('timeout') || elapsed >= 5000;
      if (isTimeout) {
        await triggerCriticalAlert(
          `Database query timed out after ${elapsed}ms (Limit: 5000ms)`,
          sqlText,
          params
        );
      }
      throw error;
    }
  }

  function prepareRequest(query: string, params: any[], request?: any) {
    const req = request || pool.request();
    let index = 0;
    const preparedQuery = query.replace(/\?/g, () => {
      index += 1;
      const paramName = `p${index}`;
      req.input(paramName, params[index - 1]);
      return `@${paramName}`;
    });

    if (index !== params.length) {
      throw new Error(`SQL parameter mismatch: query has ${index} placeholders but received ${params.length} values`);
    }

    return { request: req, preparedQuery };
  }

  return {
    /** Execute a query that returns multiple rows. */
    async all<T = any>(query: string, ...params: any[]): Promise<T[]> {
      const { request, preparedQuery } = prepareRequest(query, params);
      return await executeQueryWithMonitoring(async () => {
        const result = await request.query(preparedQuery);
        return result.recordset as T[];
      }, query, params);
    },
    /** Execute a query that returns a single row. */
    async get<T = any>(query: string, ...params: any[]): Promise<T | undefined> {
      const { request, preparedQuery } = prepareRequest(query, params);
      return await executeQueryWithMonitoring(async () => {
        const result = await request.query(preparedQuery);
        return result.recordset[0] as T | undefined;
      }, query, params);
    },
    /** Execute a non‐select statement (INSERT/UPDATE/DELETE). */
    async run(query: string, ...params: any[]) {
      const { request, preparedQuery } = prepareRequest(query, params);
      return await executeQueryWithMonitoring(async () => {
        return await request.query(preparedQuery);
      }, query, params);
    },
    /** Execute operations within a transaction with transient deadlock retries. */
    async withTransaction<T>(work: (db: any) => Promise<T>, maxRetries = 3, delayMs = 100): Promise<T> {
      let attempt = 0;
      while (true) {
        const transaction = new sql.Transaction(pool);
        try {
          await transaction.begin();
          const txDb = {
            all: async (q: string, ...p: any[]) => {
              const { request, preparedQuery } = prepareRequest(q, p, new sql.Request(transaction));
              const result = await request.query(preparedQuery);
              return result.recordset;
            },
            get: async (q: string, ...p: any[]) => {
              const { request, preparedQuery } = prepareRequest(q, p, new sql.Request(transaction));
              const result = await request.query(preparedQuery);
              return result.recordset[0];
            },
            run: async (q: string, ...p: any[]) => {
              const { request, preparedQuery } = prepareRequest(q, p, new sql.Request(transaction));
              return await request.query(preparedQuery);
            }
          };
          const result = await work(txDb);
          await transaction.commit();
          return result;
        } catch (err: any) {
          try {
            await transaction.rollback();
          } catch (rollbackErr) {
            // Ignore rollback failure if transaction is already closed/aborted
          }
          attempt++;
          const isDeadlock = err.number === 1205 || err.message?.includes('deadlock');
          if (isDeadlock && attempt < maxRetries) {
            // eslint-disable-next-line no-console
            console.warn(`Deadlock detected (Attempt ${attempt}/${maxRetries}). Retrying transaction in ${delayMs * attempt}ms...`);
            await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
            continue;
          }
          throw err;
        }
      }
    }
  };
})();

/**
 * Initialise the DB connection and run migrations.
 */
export async function initDb(): Promise<void> {
  const db = await dbPromise; // ensure the pool is created

  await db.run(`
  -- 1. Users
  IF OBJECT_ID('users', 'U') IS NULL
  CREATE TABLE users (
    id NVARCHAR(64) PRIMARY KEY,
    name NVARCHAR(200) NOT NULL,
    username NVARCHAR(100) NOT NULL UNIQUE,
    password_hash NVARCHAR(255) NOT NULL,
    role NVARCHAR(50) NOT NULL,
    is_active BIT NOT NULL DEFAULT 1,
    phone NVARCHAR(50),
    permissions NVARCHAR(MAX),
    created_at NVARCHAR(40) NOT NULL
  );

  IF COL_LENGTH('users', 'phone') IS NULL ALTER TABLE users ADD phone NVARCHAR(50);
  IF COL_LENGTH('users', 'username') IS NULL ALTER TABLE users ADD username NVARCHAR(100) NOT NULL UNIQUE;
  IF COL_LENGTH('users', 'email') IS NOT NULL ALTER TABLE users DROP COLUMN email;
  IF COL_LENGTH('users', 'permissions') IS NULL ALTER TABLE users ADD permissions NVARCHAR(MAX);
  
  -- Restore Primary Key if it was dropped during schema migration
  IF NOT EXISTS (SELECT * FROM sys.key_constraints WHERE type = 'PK' AND parent_object_id = OBJECT_ID('users'))
  BEGIN
      ALTER TABLE users ADD CONSTRAINT PK_users_id PRIMARY KEY (id);
  END


  -- 2. Customers
  IF OBJECT_ID('customers', 'U') IS NULL
  CREATE TABLE customers (
    id NVARCHAR(64) PRIMARY KEY,
    customer_number NVARCHAR(100) NOT NULL UNIQUE,
    name NVARCHAR(200) NOT NULL,
    phone NVARCHAR(50) NOT NULL,
    email NVARCHAR(255),
    address NVARCHAR(500) NOT NULL,
    gender NVARCHAR(10) NOT NULL,
    city NVARCHAR(100) NOT NULL,
    governorate NVARCHAR(100) NOT NULL,
    region NVARCHAR(100) NOT NULL,
    date_of_birth NVARCHAR(20) NOT NULL,
    national_id NVARCHAR(50) NOT NULL,
    age INT NOT NULL,
    pension_date NVARCHAR(20) NOT NULL,
    balance DECIMAL(18,2) NOT NULL DEFAULT 0,
    balance_type NVARCHAR(10) NOT NULL DEFAULT 'debtor',
    notes NVARCHAR(1000),
    image NVARCHAR(MAX),
    guarantors NVARCHAR(MAX),
    is_sued BIT NOT NULL DEFAULT 0,
    sued_date NVARCHAR(40),
    created_at NVARCHAR(40) NOT NULL,
    updated_at NVARCHAR(40) NOT NULL
  );

  -- 3. Suppliers
  IF OBJECT_ID('suppliers', 'U') IS NULL
  CREATE TABLE suppliers (
    id NVARCHAR(64) PRIMARY KEY,
    name NVARCHAR(200) NOT NULL,
    phone NVARCHAR(50) NOT NULL,
    email NVARCHAR(255),
    address NVARCHAR(500) NOT NULL,
    balance DECIMAL(18,2) NOT NULL DEFAULT 0,
    notes NVARCHAR(1000),
    created_at NVARCHAR(40) NOT NULL,
    updated_at NVARCHAR(40) NOT NULL
  );

  -- 4. Products
  IF OBJECT_ID('products', 'U') IS NULL
  CREATE TABLE products (
      id NVARCHAR(64) PRIMARY KEY,
      name NVARCHAR(200) NOT NULL,
      barcode NVARCHAR(100) NULL,
      category NVARCHAR(100) NULL,
      fulfillment_type NVARCHAR(20) NOT NULL DEFAULT 'on_demand',
      unit NVARCHAR(50) NULL,
      purchase_price DECIMAL(18,2) NOT NULL DEFAULT 0,
      sale_price DECIMAL(18,2) NOT NULL DEFAULT 0,
      discount DECIMAL(18,2) NOT NULL DEFAULT 0,
      tax DECIMAL(18,2) NOT NULL DEFAULT 0,
      quantity DECIMAL(18,2) NOT NULL DEFAULT 0,
      min_quantity DECIMAL(18,2) NOT NULL DEFAULT 0,
      image NVARCHAR(MAX),
      description NVARCHAR(1000),
      created_at NVARCHAR(40) NOT NULL,
      updated_at NVARCHAR(40) NOT NULL
    );
  
  -- Remove standard UNIQUE constraint on products.barcode if it exists first, to allow altering column
  DECLARE @ConstraintName NVARCHAR(256);
  SELECT TOP 1 @ConstraintName = name
  FROM sys.objects
  WHERE type = 'UQ' AND parent_object_id = OBJECT_ID('products');
  IF @ConstraintName IS NOT NULL
  BEGIN
      EXEC('ALTER TABLE products DROP CONSTRAINT ' + @ConstraintName);
  END

  -- Remove index if it already exists first, to allow altering column
  IF EXISTS (SELECT * FROM sys.indexes WHERE name = 'UX_products_barcode' AND object_id = OBJECT_ID('products'))
  BEGIN
      DROP INDEX UX_products_barcode ON products;
  END

  -- Alter columns safely
  ALTER TABLE products ALTER COLUMN category NVARCHAR(100) NULL;
  ALTER TABLE products ALTER COLUMN unit NVARCHAR(50) NULL;
  ALTER TABLE products ALTER COLUMN barcode NVARCHAR(100) NULL;

  -- Create filtered unique index (only if it doesn't already exist)
  IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'UX_products_barcode' AND object_id = OBJECT_ID('products'))
  BEGIN
      CREATE UNIQUE NONCLUSTERED INDEX UX_products_barcode ON products(barcode) WHERE barcode IS NOT NULL;
  END

  -- 5. Sales
  IF OBJECT_ID('sales', 'U') IS NULL
  CREATE TABLE sales (
    id NVARCHAR(64) PRIMARY KEY,
    invoice_number NVARCHAR(100) NOT NULL UNIQUE,
    customer_id NVARCHAR(64) NOT NULL,
    customer_name NVARCHAR(200) NOT NULL,
    total DECIMAL(18,2) NOT NULL,
    paid DECIMAL(18,2) NOT NULL DEFAULT 0,
    remaining DECIMAL(18,2) NOT NULL,
    status NVARCHAR(30) NOT NULL,
    date NVARCHAR(20) NOT NULL,
    version INT NOT NULL DEFAULT 1,
    locked BIT NOT NULL DEFAULT 0,
    last_edited_by NVARCHAR(200),
    last_edited_at NVARCHAR(40),
    created_by NVARCHAR(200) NOT NULL,
    created_at NVARCHAR(40) NOT NULL
  );
  BEGIN TRY
    IF COL_LENGTH('sales', 'notes') IS NOT NULL ALTER TABLE sales ALTER COLUMN notes NVARCHAR(MAX);
    IF COL_LENGTH('sales', 'customer_name') IS NOT NULL ALTER TABLE sales ALTER COLUMN customer_name NVARCHAR(MAX);
    IF COL_LENGTH('sales', 'date') IS NOT NULL ALTER TABLE sales ALTER COLUMN date NVARCHAR(50) NOT NULL;
    IF COL_LENGTH('sales', 'installment_start_date') IS NOT NULL ALTER TABLE sales ALTER COLUMN installment_start_date NVARCHAR(50) NULL;
  END TRY
  BEGIN CATCH
    PRINT 'Skipping sales column alter during startup migration';
  END CATCH;

  BEGIN TRY
    IF COL_LENGTH('purchases', 'date') IS NOT NULL ALTER TABLE purchases ALTER COLUMN date NVARCHAR(50) NOT NULL;
  END TRY
  BEGIN CATCH
    PRINT 'Skipping purchases column alter during startup migration';
  END CATCH;
  BEGIN TRY
    IF COL_LENGTH('installment_schedules', 'due_date') IS NOT NULL ALTER TABLE installment_schedules ALTER COLUMN due_date NVARCHAR(50) NOT NULL;
    IF COL_LENGTH('payments', 'date') IS NOT NULL ALTER TABLE payments ALTER COLUMN date NVARCHAR(50) NOT NULL;
    IF COL_LENGTH('expenses', 'date') IS NOT NULL ALTER TABLE expenses ALTER COLUMN date NVARCHAR(50) NOT NULL;
    IF COL_LENGTH('shareholder_transactions', 'date') IS NOT NULL ALTER TABLE shareholder_transactions ALTER COLUMN date NVARCHAR(50) NOT NULL;
    IF COL_LENGTH('collection_tasks', 'due_date') IS NOT NULL ALTER TABLE collection_tasks ALTER COLUMN due_date NVARCHAR(50) NOT NULL;
    IF COL_LENGTH('closing_periods', 'period_date') IS NOT NULL ALTER TABLE closing_periods ALTER COLUMN period_date NVARCHAR(50) NOT NULL;
  END TRY
  BEGIN CATCH
    PRINT 'Skipping date column alters during startup migration';
  END CATCH;

  IF COL_LENGTH('sales', 'subtotal') IS NULL ALTER TABLE sales ADD subtotal DECIMAL(18,2);
  IF COL_LENGTH('sales', 'discount') IS NULL ALTER TABLE sales ADD discount DECIMAL(18,2);
  IF COL_LENGTH('sales', 'tax') IS NULL ALTER TABLE sales ADD tax DECIMAL(18,2);
  IF COL_LENGTH('sales', 'notes') IS NULL ALTER TABLE sales ADD notes NVARCHAR(1000);
  IF COL_LENGTH('sales', 'payment_method') IS NULL ALTER TABLE sales ADD payment_method NVARCHAR(30);
  IF COL_LENGTH('sales', 'manual_invoice_ref') IS NULL ALTER TABLE sales ADD manual_invoice_ref NVARCHAR(100);
  IF COL_LENGTH('sales', 'sales_rep_id') IS NULL ALTER TABLE sales ADD sales_rep_id NVARCHAR(64);
  IF COL_LENGTH('sales', 'sales_rep_name') IS NULL ALTER TABLE sales ADD sales_rep_name NVARCHAR(200);
  IF COL_LENGTH('sales', 'commission_rate') IS NULL ALTER TABLE sales ADD commission_rate DECIMAL(18,2);
  IF COL_LENGTH('sales', 'commission_amount') IS NULL ALTER TABLE sales ADD commission_amount DECIMAL(18,2);
  IF COL_LENGTH('sales', 'installment_months') IS NULL ALTER TABLE sales ADD installment_months INT;
  IF COL_LENGTH('sales', 'installment_start_date') IS NULL ALTER TABLE sales ADD installment_start_date NVARCHAR(20);
  IF COL_LENGTH('sales', 'upfront_amount') IS NULL ALTER TABLE sales ADD upfront_amount DECIMAL(18,2);
  IF COL_LENGTH('sales', 'monthly_installment_amount') IS NULL ALTER TABLE sales ADD monthly_installment_amount DECIMAL(18,2);

  -- 6. Sale Items
  IF OBJECT_ID('sale_items', 'U') IS NULL
  CREATE TABLE sale_items (
    id NVARCHAR(64) PRIMARY KEY,
    sale_id NVARCHAR(64) NOT NULL,
    product_id NVARCHAR(64) NOT NULL,
    product_name NVARCHAR(200) NOT NULL,
    barcode NVARCHAR(100) NULL,
    quantity DECIMAL(18,2) NOT NULL,
    unit_price DECIMAL(18,2) NOT NULL,
    discount DECIMAL(18,2) NOT NULL,
    tax DECIMAL(18,2) NOT NULL,
    total DECIMAL(18,2) NOT NULL
  );
  IF COL_LENGTH('sale_items', 'unit_cost') IS NULL ALTER TABLE sale_items ADD unit_cost DECIMAL(18,2) NOT NULL DEFAULT 0;
  IF COL_LENGTH('sale_items', 'product_name') IS NOT NULL ALTER TABLE sale_items ALTER COLUMN product_name NVARCHAR(MAX);

  IF COL_LENGTH('sale_items', 'barcode') IS NOT NULL ALTER TABLE sale_items ALTER COLUMN barcode NVARCHAR(100) NULL;

  -- 7. Purchases
  IF OBJECT_ID('purchases', 'U') IS NULL
  CREATE TABLE purchases (
    id NVARCHAR(64) PRIMARY KEY,
    invoice_number NVARCHAR(100) NOT NULL UNIQUE,
    supplier_id NVARCHAR(64) NOT NULL,
    supplier_name NVARCHAR(200) NOT NULL,
    subtotal DECIMAL(18,2) NOT NULL,
    discount DECIMAL(18,2) NOT NULL DEFAULT 0,
    tax DECIMAL(18,2) NOT NULL DEFAULT 0,
    total DECIMAL(18,2) NOT NULL,
    paid DECIMAL(18,2) NOT NULL DEFAULT 0,
    remaining DECIMAL(18,2) NOT NULL,
    status NVARCHAR(30) NOT NULL,
    date NVARCHAR(20) NOT NULL,
    notes NVARCHAR(1000),
    created_by NVARCHAR(200) NOT NULL,
    created_at NVARCHAR(40) NOT NULL
  );

  -- 8. Purchase Items
  IF OBJECT_ID('purchase_items', 'U') IS NULL
  CREATE TABLE purchase_items (
    id NVARCHAR(64) PRIMARY KEY,
    purchase_id NVARCHAR(64) NOT NULL,
    product_id NVARCHAR(64) NOT NULL,
    product_name NVARCHAR(200) NOT NULL,
    barcode NVARCHAR(100) NULL,
    quantity DECIMAL(18,2) NOT NULL,
    unit_price DECIMAL(18,2) NOT NULL,
    discount DECIMAL(18,2) NOT NULL,
    tax DECIMAL(18,2) NOT NULL,
    total DECIMAL(18,2) NOT NULL
  );

  IF COL_LENGTH('purchase_items', 'barcode') IS NOT NULL ALTER TABLE purchase_items ALTER COLUMN barcode NVARCHAR(100) NULL;
  IF COL_LENGTH('installment_schedules', 'paid_at') IS NULL ALTER TABLE installment_schedules ADD paid_at NVARCHAR(50) NULL;

  -- 9. Installment Schedules
  IF OBJECT_ID('installment_schedules', 'U') IS NULL
  CREATE TABLE installment_schedules (
    id NVARCHAR(64) PRIMARY KEY,
    sale_id NVARCHAR(64) NOT NULL,
    month_index INT NOT NULL,
    due_date NVARCHAR(20) NOT NULL,
    amount DECIMAL(18,2) NOT NULL,
    paid_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
    status NVARCHAR(30) NOT NULL,
    paid_at NVARCHAR(50) NULL
  );

  -- 10. Payments
  IF OBJECT_ID('payments', 'U') IS NULL
  CREATE TABLE payments (
    id NVARCHAR(64) PRIMARY KEY,
    type NVARCHAR(10) NOT NULL,
    amount DECIMAL(18,2) NOT NULL,
    sale_id NVARCHAR(64) NULL,
    installment_id NVARCHAR(64) NULL,
    description NVARCHAR(600) NOT NULL,
    date NVARCHAR(20) NOT NULL,
    receipt_number NVARCHAR(100) NOT NULL UNIQUE,
    status NVARCHAR(20) NOT NULL DEFAULT 'posted',
    void_ref NVARCHAR(64) NULL,
    approved_by NVARCHAR(200) NULL,
    channel NVARCHAR(30) NULL,
    created_by NVARCHAR(200) NOT NULL,
    created_at NVARCHAR(40) NOT NULL
  );

  IF COL_LENGTH('payments', 'reference_id') IS NULL ALTER TABLE payments ADD reference_id NVARCHAR(64);
  IF COL_LENGTH('payments', 'reference_type') IS NULL ALTER TABLE payments ADD reference_type NVARCHAR(30);
  IF COL_LENGTH('payments', 'customer_id') IS NULL ALTER TABLE payments ADD customer_id NVARCHAR(64);
  IF COL_LENGTH('payments', 'supplier_id') IS NULL ALTER TABLE payments ADD supplier_id NVARCHAR(64);
  IF COL_LENGTH('payments', 'invoice_number') IS NULL ALTER TABLE payments ADD invoice_number NVARCHAR(100);
  IF COL_LENGTH('payments', 'affects_customer_balance') IS NULL ALTER TABLE payments ADD affects_customer_balance BIT;

  -- 11. Expenses
  IF OBJECT_ID('expenses', 'U') IS NULL
  CREATE TABLE expenses (
    id NVARCHAR(64) PRIMARY KEY,
    category NVARCHAR(100) NOT NULL,
    description NVARCHAR(600) NOT NULL,
    amount DECIMAL(18,2) NOT NULL,
    date NVARCHAR(20) NOT NULL,
    receipt NVARCHAR(MAX),
    created_by NVARCHAR(200) NOT NULL,
    created_at NVARCHAR(40) NOT NULL
  );

  -- 12. Settings
  IF OBJECT_ID('settings', 'U') IS NULL
  CREATE TABLE settings (
    company_name NVARCHAR(200) NOT NULL,
    company_address NVARCHAR(500) NOT NULL,
    company_phone NVARCHAR(50) NOT NULL,
    company_email NVARCHAR(255) NOT NULL,
    tax_rate DECIMAL(18,2) NOT NULL DEFAULT 0,
    currency NVARCHAR(50) NOT NULL DEFAULT N'ط¬ظ†ظٹظ‡',
    baseline_capital DECIMAL(18,2) NOT NULL DEFAULT 8500000,
    invoice_prefix NVARCHAR(50) NOT NULL DEFAULT 'INV',
    invoice_footer NVARCHAR(1000)
  );

  -- 13. Notifications
  IF OBJECT_ID('notifications', 'U') IS NULL
  CREATE TABLE notifications (
    id NVARCHAR(64) PRIMARY KEY,
    type NVARCHAR(20) NOT NULL,
    title NVARCHAR(200) NOT NULL,
    message NVARCHAR(1000) NOT NULL,
    is_read BIT NOT NULL DEFAULT 0,
    created_at NVARCHAR(40) NOT NULL
  );

  -- 14. Sales Reps
  IF OBJECT_ID('sales_reps', 'U') IS NULL
  CREATE TABLE sales_reps (
      id NVARCHAR(64) PRIMARY KEY,
      name NVARCHAR(200) NOT NULL,
      phone NVARCHAR(50) NOT NULL,
      email NVARCHAR(255),
      address NVARCHAR(500) NULL,
      area NVARCHAR(100) NULL,
      target DECIMAL(18,2) NOT NULL DEFAULT 0,
      achieved DECIMAL(18,2) NOT NULL DEFAULT 0,
      commission DECIMAL(18,2) NOT NULL DEFAULT 0,
      is_active BIT NOT NULL DEFAULT 1,
      created_at NVARCHAR(40) NOT NULL
    );

  IF COL_LENGTH('sales_reps', 'address') IS NOT NULL ALTER TABLE sales_reps ALTER COLUMN address NVARCHAR(500) NULL;
  IF COL_LENGTH('sales_reps', 'area') IS NOT NULL ALTER TABLE sales_reps ALTER COLUMN area NVARCHAR(100) NULL;

  -- 15. Shareholders
  IF OBJECT_ID('shareholders', 'U') IS NULL
  CREATE TABLE shareholders (
    id NVARCHAR(64) PRIMARY KEY,
    name NVARCHAR(200) NOT NULL,
    phone NVARCHAR(50) NOT NULL,
    share_percentage DECIMAL(18,2) NOT NULL,
    management_fee_percentage DECIMAL(18,2) DEFAULT 0,
    capital DECIMAL(18,2) NOT NULL DEFAULT 0,
    current_balance DECIMAL(18,2) NOT NULL DEFAULT 0,
    notes NVARCHAR(1000),
    created_at NVARCHAR(40) NOT NULL,
    updated_at NVARCHAR(40) NOT NULL
  );

  -- 16. Shareholder Transactions
  IF OBJECT_ID('shareholder_transactions', 'U') IS NULL
  CREATE TABLE shareholder_transactions (
    id NVARCHAR(64) PRIMARY KEY,
    shareholder_id NVARCHAR(64) NOT NULL,
    shareholder_name NVARCHAR(200) NOT NULL,
    type NVARCHAR(50) NOT NULL,
    amount DECIMAL(18,2) NOT NULL,
    date NVARCHAR(20) NOT NULL,
    description NVARCHAR(600) NOT NULL,
    created_by NVARCHAR(200) NOT NULL,
    created_at NVARCHAR(40) NOT NULL
  );

  -- 17. Collection Tasks
  IF OBJECT_ID('collection_tasks', 'U') IS NULL
  CREATE TABLE collection_tasks (
    id NVARCHAR(64) PRIMARY KEY,
    customer_id NVARCHAR(64) NOT NULL,
    customer_name NVARCHAR(200) NOT NULL,
    sale_id NVARCHAR(64) NOT NULL,
    installment_id NVARCHAR(64) NOT NULL,
    due_date NVARCHAR(20) NOT NULL,
    amount DECIMAL(18,2) NOT NULL,
    status NVARCHAR(30) NOT NULL,
    assigned_to_user_id NVARCHAR(64),
    assigned_to_name NVARCHAR(200),
    visit_notes NVARCHAR(1000),
    visit_result NVARCHAR(1000),
    created_at NVARCHAR(40) NOT NULL,
    updated_at NVARCHAR(40) NOT NULL
  );

  -- 18. Audit Log
  IF OBJECT_ID('audit_log', 'U') IS NULL
  CREATE TABLE audit_log (
    id NVARCHAR(64) PRIMARY KEY,
    action NVARCHAR(100) NOT NULL,
    entity_type NVARCHAR(50) NOT NULL,
    entity_id NVARCHAR(64) NOT NULL,
    payload NVARCHAR(MAX) NULL,
    created_by NVARCHAR(200) NOT NULL,
    created_at NVARCHAR(40) NOT NULL
  );

  -- 19. Closing Periods
  IF OBJECT_ID('closing_periods', 'U') IS NULL
  CREATE TABLE closing_periods (
    id NVARCHAR(64) PRIMARY KEY,
    period_type NVARCHAR(20) NOT NULL,
    period_date NVARCHAR(20) NOT NULL,
    status NVARCHAR(20) NOT NULL,
    closed_by NVARCHAR(200) NULL,
    closed_at NVARCHAR(40) NULL,
    notes NVARCHAR(1000) NULL
  );

  -- 20. Reschedule Requests
  IF OBJECT_ID('reschedule_requests', 'U') IS NULL
  CREATE TABLE reschedule_requests (
    id NVARCHAR(64) PRIMARY KEY,
    sale_id NVARCHAR(64) NOT NULL,
    customer_id NVARCHAR(64) NOT NULL,
    reason NVARCHAR(1000) NOT NULL,
    status NVARCHAR(20) NOT NULL,
    old_installment_months INT NOT NULL,
    new_installment_months INT NOT NULL,
    requested_by NVARCHAR(200) NOT NULL,
    requested_at NVARCHAR(40) NOT NULL,
    reviewed_by NVARCHAR(200) NULL,
    reviewed_at NVARCHAR(40) NULL
  );

  -- 21. Historical Archives (Day 5 Database Integrity)
  IF OBJECT_ID('collection_tasks_archive', 'U') IS NULL
  CREATE TABLE collection_tasks_archive (
    id NVARCHAR(64) PRIMARY KEY,
    customer_id NVARCHAR(64) NOT NULL,
    customer_name NVARCHAR(200) NOT NULL,
    sale_id NVARCHAR(64) NOT NULL,
    installment_id NVARCHAR(64) NOT NULL,
    due_date NVARCHAR(20) NOT NULL,
    amount DECIMAL(18,2) NOT NULL,
    status NVARCHAR(30) NOT NULL,
    assigned_to_user_id NVARCHAR(64),
    assigned_to_name NVARCHAR(200),
    visit_notes NVARCHAR(1000),
    visit_result NVARCHAR(1000),
    created_at NVARCHAR(40) NOT NULL,
    updated_at NVARCHAR(40) NOT NULL
  );

  IF OBJECT_ID('payments_archive', 'U') IS NULL
  CREATE TABLE payments_archive (
    id NVARCHAR(64) PRIMARY KEY,
    type NVARCHAR(10) NOT NULL,
    amount DECIMAL(18,2) NOT NULL,
    sale_id NVARCHAR(64) NULL,
    installment_id NVARCHAR(64) NULL,
    description NVARCHAR(600) NOT NULL,
    date NVARCHAR(20) NOT NULL,
    receipt_number NVARCHAR(100) NOT NULL,
    status NVARCHAR(20) NOT NULL,
    void_ref NVARCHAR(64) NULL,
    approved_by NVARCHAR(200) NULL,
    channel NVARCHAR(30) NULL,
    created_by NVARCHAR(200) NOT NULL,
    created_at NVARCHAR(40) NOT NULL,
    reference_id NVARCHAR(64),
    reference_type NVARCHAR(30),
    customer_id NVARCHAR(64),
    supplier_id NVARCHAR(64),
    invoice_number NVARCHAR(100),
    affects_customer_balance BIT
  );
  `);


  // Performance indexes for collection statement and common lookups.
  try {
    await db.run(`
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_installment_schedules_due_status_sale' AND object_id = OBJECT_ID('installment_schedules'))
        CREATE NONCLUSTERED INDEX IX_installment_schedules_due_status_sale
        ON installment_schedules (due_date, status, sale_id)
        INCLUDE (month_index, amount, paid_amount, paid_at);

      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_sales_collection_filters' AND object_id = OBJECT_ID('sales'))
        CREATE NONCLUSTERED INDEX IX_sales_collection_filters
        ON sales (status, sales_rep_id, customer_id, created_at)
        INCLUDE (invoice_number, customer_name, total, paid, remaining, date, payment_method, sales_rep_name);

      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_sales_invoice_customer_name' AND object_id = OBJECT_ID('sales'))
        CREATE NONCLUSTERED INDEX IX_sales_invoice_customer_name
        ON sales (invoice_number, customer_id, sales_rep_id)
        INCLUDE (customer_name, status, created_at);

      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_sales_created_at_lookup' AND object_id = OBJECT_ID('sales'))
        CREATE NONCLUSTERED INDEX IX_sales_created_at_lookup
        ON sales (created_at DESC)
        INCLUDE (invoice_number, customer_id, customer_name, total, paid, remaining, status, date, payment_method, sales_rep_id, sales_rep_name);

      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_payments_sale_status_date' AND object_id = OBJECT_ID('payments'))
        CREATE NONCLUSTERED INDEX IX_payments_sale_status_date
        ON payments (sale_id, status, date DESC);

      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_payments_receipt_number' AND object_id = OBJECT_ID('payments'))
        CREATE NONCLUSTERED INDEX IX_payments_receipt_number
        ON payments (receipt_number);

      -- Covering index for sale_items queries
      IF EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_sale_items_sale_id' AND object_id = OBJECT_ID('sale_items'))
        DROP INDEX IX_sale_items_sale_id ON sale_items;
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_sale_items_sale_id_covering' AND object_id = OBJECT_ID('sale_items'))
        CREATE NONCLUSTERED INDEX IX_sale_items_sale_id_covering
        ON sale_items (sale_id)
        INCLUDE (product_id, product_name, barcode, quantity, unit_price, unit_cost, discount, tax, total);

      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_installment_schedules_sale_month' AND object_id = OBJECT_ID('installment_schedules'))
        CREATE NONCLUSTERED INDEX IX_installment_schedules_sale_month
        ON installment_schedules (sale_id, month_index)
        INCLUDE (due_date, amount, paid_amount, status, paid_at);

      -- Covering index for purchase_items queries
      IF EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_purchase_items_purchase_id' AND object_id = OBJECT_ID('purchase_items'))
        DROP INDEX IX_purchase_items_purchase_id ON purchase_items;
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_purchase_items_purchase_id_covering' AND object_id = OBJECT_ID('purchase_items'))
        CREATE NONCLUSTERED INDEX IX_purchase_items_purchase_id_covering
        ON purchase_items (purchase_id)
        INCLUDE (product_id, product_name, barcode, quantity, unit_price, discount, tax, total);

      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_purchases_supplier_id' AND object_id = OBJECT_ID('purchases'))
        CREATE NONCLUSTERED INDEX IX_purchases_supplier_id
        ON purchases (supplier_id);

      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_customers_sued_id' AND object_id = OBJECT_ID('customers'))
        CREATE NONCLUSTERED INDEX IX_customers_sued_id
        ON customers (is_sued, id)
        INCLUDE (phone, address);

      -- Index for installment schedules due_date range searches
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_installment_schedules_due_date' AND object_id = OBJECT_ID('installment_schedules'))
        CREATE NONCLUSTERED INDEX IX_installment_schedules_due_date
        ON installment_schedules (due_date);

      -- Index for sales created_at range searches
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_sales_created_at' AND object_id = OBJECT_ID('sales'))
        CREATE NONCLUSTERED INDEX IX_sales_created_at
        ON sales (created_at);
    `);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error creating performance indexes:', err);
  }

  // Ensure the default admin account exists on every start.
  try {
    const admin = await db.get<{ id: string }>('SELECT id FROM users WHERE username = ?', 'admin');
    const { hashPassword, uid } = await import('./utils.js');
    const hashed = await hashPassword('admin123');

    if (admin?.id) {
      await db.run(
        `UPDATE users
         SET name = ?, password_hash = ?, role = ?, is_active = 1
         WHERE username = ?`,
        'مدير النظام',
        hashed,
        'admin',
        'admin',
      );
      // eslint-disable-next-line no-console
      console.log('Ensured default admin user: admin / admin123');
    } else {
      const id = uid();
      await db.run(
        `INSERT INTO users (id, name, username, password_hash, role, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, 1, ?)`,
        id,
        'مدير النظام',
        'admin',
        hashed,
        'admin',
        new Date().toISOString(),
      );
      // eslint-disable-next-line no-console
      console.log('Seeded default admin user: admin / admin123');
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error auto-seeding default admin:', err);
  }

  // Migrate existing products to on_demand and zero quantity (as warehouse concept is removed)
  // Only update rows that actually need changing to avoid unnecessary table locks and disk I/O.
  try {
    const result = await db.run(
      "UPDATE products SET fulfillment_type = 'on_demand', quantity = 0 WHERE fulfillment_type <> 'on_demand' OR quantity <> 0"
    );
    // eslint-disable-next-line no-console
    console.log(`Boot migration: ${result.rowsAffected?.[0] ?? 0} products needed updating.`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error migrating products to on_demand:', err);
  }

  // ── Dashboard Metrics Cache (pre-aggregation for fast boot) ───────────
  try {
    await db.run(`
      IF OBJECT_ID('dashboard_metrics_cache', 'U') IS NULL
      CREATE TABLE dashboard_metrics_cache (
        id INT NOT NULL DEFAULT 1 PRIMARY KEY CHECK (id = 1),
        cash_in_total        DECIMAL(18,2) NOT NULL DEFAULT 0,
        cash_out_total       DECIMAL(18,2) NOT NULL DEFAULT 0,
        inventory_value      DECIMAL(18,2) NOT NULL DEFAULT 0,
        customer_receivables DECIMAL(18,2) NOT NULL DEFAULT 0,
        supplier_payables    DECIMAL(18,2) NOT NULL DEFAULT 0,
        subscribed_capital   DECIMAL(18,2) NOT NULL DEFAULT 0,
        capital_deposits     DECIMAL(18,2) NOT NULL DEFAULT 0,
        capital_withdrawals  DECIMAL(18,2) NOT NULL DEFAULT 0,
        all_time_sales       DECIMAL(18,2) NOT NULL DEFAULT 0,
        all_time_cogs        DECIMAL(18,2) NOT NULL DEFAULT 0,
        all_time_expenses    DECIMAL(18,2) NOT NULL DEFAULT 0,
        realized_cash_total  DECIMAL(18,2) NOT NULL DEFAULT 0,
        total_customers      INT NOT NULL DEFAULT 0,
        total_products       INT NOT NULL DEFAULT 0,
        total_suppliers      INT NOT NULL DEFAULT 0,
        pending_installments INT NOT NULL DEFAULT 0,
        overdue_installments INT NOT NULL DEFAULT 0,
        last_refreshed_at    DATETIME2 NOT NULL DEFAULT GETUTCDATE()
      );
    `);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error creating dashboard_metrics_cache table:', err);
  }

  // Create or replace the stored procedure that refreshes the cache
  try {
    await db.run(`
      IF OBJECT_ID('sp_refresh_dashboard_metrics', 'P') IS NOT NULL
        DROP PROCEDURE sp_refresh_dashboard_metrics;
    `);
    await db.run(`
      CREATE PROCEDURE sp_refresh_dashboard_metrics
      AS
      BEGIN
        SET NOCOUNT ON;

        DECLARE
          @cash_in       DECIMAL(18,2),
          @cash_out      DECIMAL(18,2),
          @inventory     DECIMAL(18,2),
          @receivables   DECIMAL(18,2),
          @payables      DECIMAL(18,2),
          @sub_capital   DECIMAL(18,2),
          @cap_deposits  DECIMAL(18,2),
          @cap_withdraw  DECIMAL(18,2),
          @all_sales     DECIMAL(18,2),
          @all_cogs      DECIMAL(18,2),
          @all_expenses  DECIMAL(18,2),
          @realized      DECIMAL(18,2),
          @tot_cust      INT,
          @tot_prod      INT,
          @tot_supp      INT,
          @pending_inst  INT,
          @overdue_inst  INT;

        SELECT @cash_in = COALESCE(SUM(amount), 0)
          FROM payments WHERE type = 'in' AND status = 'posted';

        SELECT @cash_out = COALESCE(SUM(amount), 0)
          FROM payments WHERE type = 'out' AND status = 'posted';

        SELECT @inventory = COALESCE(SUM(quantity * purchase_price), 0)
          FROM products;

        SELECT @receivables = COALESCE(SUM(remaining), 0)
          FROM sales WHERE status <> 'cancelled' AND remaining > 0;

        SELECT @payables = COALESCE(SUM(remaining), 0)
          FROM purchases WHERE status <> 'cancelled' AND remaining > 0;

        SELECT @sub_capital = COALESCE(SUM(capital), 0) FROM shareholders;

        SELECT @cap_deposits = COALESCE(SUM(amount), 0)
          FROM shareholder_transactions WHERE type = 'capital_deposit';

        SELECT @cap_withdraw = COALESCE(SUM(amount), 0)
          FROM shareholder_transactions WHERE type = 'capital_withdrawal';

        SELECT @all_sales = COALESCE(SUM(total), 0)
          FROM sales WHERE status <> 'cancelled';

        SELECT @all_cogs = COALESCE(SUM(si.quantity * si.unit_cost), 0)
          FROM sale_items si
          INNER JOIN sales s ON s.id = si.sale_id
          WHERE s.status <> 'cancelled';

        SELECT @all_expenses = COALESCE(SUM(amount), 0) FROM expenses;

        SELECT @realized = COALESCE(SUM(p.amount), 0)
          FROM payments p
          WHERE p.type = 'in' AND p.status = 'posted'
            AND (p.sale_id IS NOT NULL OR p.reference_type = 'sale' OR p.invoice_number IS NOT NULL);

        SELECT @tot_cust = COUNT(*) FROM customers;
        SELECT @tot_prod = COUNT(*) FROM products;
        SELECT @tot_supp = COUNT(*) FROM suppliers;

        SELECT @pending_inst = COUNT(*)
          FROM installment_schedules WHERE status <> 'paid';

        SELECT @overdue_inst = COUNT(*)
          FROM installment_schedules
          WHERE status <> 'paid'
            AND TRY_CONVERT(DATE, due_date) < CAST(GETDATE() AS DATE);

        MERGE dashboard_metrics_cache AS target
        USING (SELECT 1 AS id) AS source ON target.id = source.id
        WHEN MATCHED THEN UPDATE SET
          cash_in_total       = @cash_in,
          cash_out_total      = @cash_out,
          inventory_value     = @inventory,
          customer_receivables = @receivables,
          supplier_payables   = @payables,
          subscribed_capital  = @sub_capital,
          capital_deposits    = @cap_deposits,
          capital_withdrawals = @cap_withdraw,
          all_time_sales      = @all_sales,
          all_time_cogs       = @all_cogs,
          all_time_expenses   = @all_expenses,
          realized_cash_total = @realized,
          total_customers     = @tot_cust,
          total_products      = @tot_prod,
          total_suppliers     = @tot_supp,
          pending_installments = @pending_inst,
          overdue_installments = @overdue_inst,
          last_refreshed_at   = GETUTCDATE()
        WHEN NOT MATCHED THEN INSERT (
          id, cash_in_total, cash_out_total, inventory_value,
          customer_receivables, supplier_payables, subscribed_capital,
          capital_deposits, capital_withdrawals, all_time_sales,
          all_time_cogs, all_time_expenses, realized_cash_total,
          total_customers, total_products, total_suppliers,
          pending_installments, overdue_installments, last_refreshed_at
        ) VALUES (
          1, @cash_in, @cash_out, @inventory,
          @receivables, @payables, @sub_capital,
          @cap_deposits, @cap_withdraw, @all_sales,
          @all_cogs, @all_expenses, @realized,
          @tot_cust, @tot_prod, @tot_supp,
          @pending_inst, @overdue_inst, GETUTCDATE()
        );
      END;
    `);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error creating sp_refresh_dashboard_metrics:', err);
  }

  // Refresh dashboard cache on startup
  try {
    await db.run('EXEC sp_refresh_dashboard_metrics');
    // eslint-disable-next-line no-console
    console.log('Dashboard metrics cache refreshed.');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error refreshing dashboard cache:', err);
  }
}




