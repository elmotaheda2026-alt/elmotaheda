import sql from 'mssql';
import { config } from './config.js';

const poolPromise = new sql.ConnectionPool({
  server: config.sql.host,
  port: config.sql.port,
  user: config.sql.user,
  password: config.sql.password,
  database: config.sql.database,
  options: {
    encrypt: config.sql.encrypt,
    trustServerCertificate: config.sql.trustServerCertificate,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
}).connect();

function bindParams(request: any, params: unknown[]) {
  params.forEach((value, index) => {
    request.input(`p${index + 1}`, value as any);
  });
}

function mapQuery(query: string): string {
  let i = 0;
  return query.replace(/\?/g, () => {
    i += 1;
    return `@p${i}`;
  });
}

export const dbPromise = (async () => {
  const pool = await poolPromise;
  return {
    async run(query: string, ...params: unknown[]) {
      const request = pool.request();
      bindParams(request, params);
      return request.query(mapQuery(query));
    },
    async get<T>(query: string, ...params: unknown[]) {
      const request = pool.request();
      bindParams(request, params);
      const result = await request.query(mapQuery(query));
      return result.recordset[0] as T | undefined;
    },
    async all<T>(query: string, ...params: unknown[]) {
      const request = pool.request();
      bindParams(request, params);
      const result = await request.query(mapQuery(query));
      return result.recordset as T[];
    },
  };
})();

export async function initDb() {
  const db = await dbPromise;
  await db.run(`
  IF OBJECT_ID('users', 'U') IS NULL
  CREATE TABLE users (
    id NVARCHAR(64) PRIMARY KEY,
    name NVARCHAR(200) NOT NULL,
    email NVARCHAR(255) NOT NULL UNIQUE,
    password_hash NVARCHAR(255) NOT NULL,
    role NVARCHAR(50) NOT NULL,
    is_active BIT NOT NULL DEFAULT 1,
    phone NVARCHAR(50),
    permissions NVARCHAR(MAX),
    created_at NVARCHAR(40) NOT NULL
  );

  IF COL_LENGTH('users', 'phone') IS NULL
  ALTER TABLE users ADD phone NVARCHAR(50);

  IF COL_LENGTH('users', 'permissions') IS NULL
  ALTER TABLE users ADD permissions NVARCHAR(MAX);

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

  IF OBJECT_ID('products', 'U') IS NULL
  CREATE TABLE products (
    id NVARCHAR(64) PRIMARY KEY,
    name NVARCHAR(200) NOT NULL,
    barcode NVARCHAR(100) NOT NULL UNIQUE,
    category NVARCHAR(100) NOT NULL,
    fulfillment_type NVARCHAR(20) NOT NULL DEFAULT 'stocked',
    unit NVARCHAR(50) NOT NULL,
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

  IF COL_LENGTH('sales', 'subtotal') IS NULL
  ALTER TABLE sales ADD subtotal DECIMAL(18,2);

  IF COL_LENGTH('sales', 'discount') IS NULL
  ALTER TABLE sales ADD discount DECIMAL(18,2);

  IF COL_LENGTH('sales', 'tax') IS NULL
  ALTER TABLE sales ADD tax DECIMAL(18,2);

  IF COL_LENGTH('sales', 'payment_method') IS NULL
  ALTER TABLE sales ADD payment_method NVARCHAR(30);

  IF COL_LENGTH('sales', 'manual_invoice_ref') IS NULL
  ALTER TABLE sales ADD manual_invoice_ref NVARCHAR(100);

  IF COL_LENGTH('sales', 'sales_rep_id') IS NULL
  ALTER TABLE sales ADD sales_rep_id NVARCHAR(64);

  IF COL_LENGTH('sales', 'sales_rep_name') IS NULL
  ALTER TABLE sales ADD sales_rep_name NVARCHAR(200);

  IF COL_LENGTH('sales', 'commission_rate') IS NULL
  ALTER TABLE sales ADD commission_rate DECIMAL(18,2);

  IF COL_LENGTH('sales', 'commission_amount') IS NULL
  ALTER TABLE sales ADD commission_amount DECIMAL(18,2);

  IF COL_LENGTH('sales', 'installment_months') IS NULL
  ALTER TABLE sales ADD installment_months INT;

  IF COL_LENGTH('sales', 'installment_start_date') IS NULL
  ALTER TABLE sales ADD installment_start_date NVARCHAR(20);

  IF COL_LENGTH('sales', 'upfront_amount') IS NULL
  ALTER TABLE sales ADD upfront_amount DECIMAL(18,2);

  IF COL_LENGTH('sales', 'monthly_installment_amount') IS NULL
  ALTER TABLE sales ADD monthly_installment_amount DECIMAL(18,2);

  IF OBJECT_ID('sale_items', 'U') IS NULL
  CREATE TABLE sale_items (
    id NVARCHAR(64) PRIMARY KEY,
    sale_id NVARCHAR(64) NOT NULL,
    product_id NVARCHAR(64) NOT NULL,
    product_name NVARCHAR(200) NOT NULL,
    barcode NVARCHAR(100) NOT NULL,
    quantity DECIMAL(18,2) NOT NULL,
    unit_price DECIMAL(18,2) NOT NULL,
    discount DECIMAL(18,2) NOT NULL,
    tax DECIMAL(18,2) NOT NULL,
    total DECIMAL(18,2) NOT NULL
  );

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

  IF OBJECT_ID('purchase_items', 'U') IS NULL
  CREATE TABLE purchase_items (
    id NVARCHAR(64) PRIMARY KEY,
    purchase_id NVARCHAR(64) NOT NULL,
    product_id NVARCHAR(64) NOT NULL,
    product_name NVARCHAR(200) NOT NULL,
    barcode NVARCHAR(100) NOT NULL,
    quantity DECIMAL(18,2) NOT NULL,
    unit_price DECIMAL(18,2) NOT NULL,
    discount DECIMAL(18,2) NOT NULL,
    tax DECIMAL(18,2) NOT NULL,
    total DECIMAL(18,2) NOT NULL
  );

  IF OBJECT_ID('installment_schedules', 'U') IS NULL
  CREATE TABLE installment_schedules (
    id NVARCHAR(64) PRIMARY KEY,
    sale_id NVARCHAR(64) NOT NULL,
    month_index INT NOT NULL,
    due_date NVARCHAR(20) NOT NULL,
    amount DECIMAL(18,2) NOT NULL,
    paid_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
    status NVARCHAR(30) NOT NULL
  );

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

  IF COL_LENGTH('payments', 'reference_id') IS NULL
  ALTER TABLE payments ADD reference_id NVARCHAR(64);

  IF COL_LENGTH('payments', 'reference_type') IS NULL
  ALTER TABLE payments ADD reference_type NVARCHAR(30);

  IF COL_LENGTH('payments', 'customer_id') IS NULL
  ALTER TABLE payments ADD customer_id NVARCHAR(64);

  IF COL_LENGTH('payments', 'supplier_id') IS NULL
  ALTER TABLE payments ADD supplier_id NVARCHAR(64);

  IF COL_LENGTH('payments', 'invoice_number') IS NULL
  ALTER TABLE payments ADD invoice_number NVARCHAR(100);

  IF COL_LENGTH('payments', 'affects_customer_balance') IS NULL
  ALTER TABLE payments ADD affects_customer_balance BIT;

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

  IF OBJECT_ID('settings', 'U') IS NULL
  CREATE TABLE settings (
    company_name NVARCHAR(200) NOT NULL,
    company_address NVARCHAR(500) NOT NULL,
    company_phone NVARCHAR(50) NOT NULL,
    company_email NVARCHAR(255) NOT NULL,
    tax_rate DECIMAL(18,2) NOT NULL DEFAULT 14,
    currency NVARCHAR(50) NOT NULL DEFAULT 'جنيه',
    invoice_prefix NVARCHAR(50) NOT NULL DEFAULT 'INV',
    invoice_footer NVARCHAR(1000)
  );

  IF OBJECT_ID('notifications', 'U') IS NULL
  CREATE TABLE notifications (
    id NVARCHAR(64) PRIMARY KEY,
    type NVARCHAR(20) NOT NULL,
    title NVARCHAR(200) NOT NULL,
    message NVARCHAR(1000) NOT NULL,
    is_read BIT NOT NULL DEFAULT 0,
    created_at NVARCHAR(40) NOT NULL
  );

  IF OBJECT_ID('sales_reps', 'U') IS NULL
  CREATE TABLE sales_reps (
    id NVARCHAR(64) PRIMARY KEY,
    name NVARCHAR(200) NOT NULL,
    phone NVARCHAR(50) NOT NULL,
    email NVARCHAR(255),
    address NVARCHAR(500) NOT NULL,
    area NVARCHAR(100) NOT NULL,
    target DECIMAL(18,2) NOT NULL DEFAULT 0,
    achieved DECIMAL(18,2) NOT NULL DEFAULT 0,
    commission DECIMAL(18,2) NOT NULL DEFAULT 0,
    is_active BIT NOT NULL DEFAULT 1,
    created_at NVARCHAR(40) NOT NULL
  );

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
  `);

  // Auto-seed default admin if no users exist
  try {
    const existing = await db.get<{ count: number }>('SELECT COUNT(*) AS count FROM users');
    if ((existing?.count || 0) === 0) {
      const { hashPassword, uid } = await import('./utils.js');
      const hashed = await hashPassword('admin123');
      const id = uid();
      await db.run(
        `INSERT INTO users (id, name, email, password_hash, role, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, 1, ?)`,
        id,
        'مدير النظام',
        'admin@almuttahida.com',
        hashed,
        'admin',
        new Date().toISOString(),
      );
      console.log('Seeded default admin user: admin@almuttahida.com / admin123');
    }
  } catch (err) {
    console.error('Error auto-seeding default admin:', err);
  }
}
