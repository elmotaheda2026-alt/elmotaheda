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
    created_at NVARCHAR(40) NOT NULL
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
}
