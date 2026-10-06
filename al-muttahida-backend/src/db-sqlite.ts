/**
 * SQLite fallback database adapter for desktop mode.
 * Uses sql.js (pure-JS SQLite compiled via Emscripten – no native build tools needed).
 * Provides the same db interface as the MSSQL adapter.
 */
import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { hashPassword } from './utils.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SqliteDbWrapper {
  all<T = any>(query: string, ...params: unknown[]): Promise<T[]>;
  get<T = any>(query: string, ...params: unknown[]): Promise<T | undefined>;
  run(query: string, ...params: unknown[]): Promise<{ rowsAffected: number[] }>;
  withTransaction<T>(work: (db: any) => Promise<T>, maxRetries?: number, delayMs?: number): Promise<T>;
}

/** Determine the SQLite database file path for desktop mode. */
function getSqliteDbPath(): string {
  const userDataDir = process.env.APPDATA
    ? path.join(process.env.APPDATA, 'Al-Muttahida ERP')
    : path.join(os.homedir(), '.almuttahida');

  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  return path.join(userDataDir, 'almuttahida.db');
}

/** Flatten nested array params into a flat list. */
function flattenParams(params: unknown[]): unknown[] {
  const flat: unknown[] = [];
  for (const p of params) {
    if (Array.isArray(p)) {
      flat.push(...p);
    } else {
      flat.push(p);
    }
  }
  return flat;
}

/**
 * Translate a runtime DML/DDL query from MSSQL dialect to SQLite dialect.
 */
function translateDml(query: string): string {
  let q = query;

  // NVARCHAR → TEXT
  q = q.replace(/NVARCHAR\s*\(\s*(?:MAX|\d+)\s*\)/gi, 'TEXT');
  // DECIMAL(m,n) → REAL
  q = q.replace(/DECIMAL\s*\(\s*\d+\s*,\s*\d+\s*\)/gi, 'REAL');
  // BIT → INTEGER
  q = q.replace(/\bBIT\b/gi, 'INTEGER');
  // DATETIME2 → TEXT
  q = q.replace(/\bDATETIME2\b/gi, 'TEXT');
  // N'...' → '...'
  q = q.replace(/\bN'/g, "'");
  // GETUTCDATE() / GETDATE()
  q = q.replace(/GETUTCDATE\s*\(\s*\)/gi, "datetime('now')");
  q = q.replace(/GETDATE\s*\(\s*\)/gi, "datetime('now')");
  // TRY_CONVERT(DATE, col) → date(col)
  q = q.replace(/TRY_CONVERT\s*\(\s*DATE\s*,\s*(\w+)\s*\)/gi, 'date($1)');
  // CAST(GETDATE() AS DATE) → date('now')
  q = q.replace(/CAST\s*\(\s*GETDATE\s*\(\s*\)\s+AS\s+DATE\s*\)/gi, "date('now')");
  // ISNULL(x, y) → COALESCE(x, y)
  q = q.replace(/\bISNULL\s*\(/gi, 'COALESCE(');

  // TOP N → LIMIT N
  const topMatch = q.match(/SELECT\s+TOP\s+(\d+)\s+/i);
  if (topMatch) {
    q = q.replace(/\bTOP\s+\d+\s+/i, '');
    if (!/\bLIMIT\b/i.test(q)) {
      q = q.trimEnd().replace(/;$/, '') + ` LIMIT ${topMatch[1]}`;
    }
  }

  // OFFSET ... ROWS FETCH NEXT ... ROWS ONLY → LIMIT ... OFFSET ...
  const offsetFetch = q.match(/OFFSET\s+(\d+)\s+ROWS\s+FETCH\s+NEXT\s+(\d+)\s+ROWS\s+ONLY/i);
  if (offsetFetch) {
    q = q.replace(/OFFSET\s+\d+\s+ROWS\s+FETCH\s+NEXT\s+\d+\s+ROWS\s+ONLY/i,
      `LIMIT ${offsetFetch[2]} OFFSET ${offsetFetch[1]}`);
  }

  // FOR JSON PATH → remove (not supported in SQLite)
  q = q.replace(/\bFOR\s+JSON\s+PATH\b/gi, '');

  return q;
}

/** Convert sql.js result columns+values to an array of objects. */
function resultToObjects(columns: string[], values: unknown[][]): Record<string, unknown>[] {
  return values.map(row => {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => { obj[col] = row[i]; });
    return obj;
  });
}

// Persistent reference to the sql.js database so we can flush to disk
let _sqliteDb: SqlJsDatabase | null = null;
let _dbPath: string = '';
let _saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Save the in-memory database to disk (debounced). */
function scheduleSave(): void {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    if (_sqliteDb && _dbPath) {
      try {
        const data = _sqliteDb.export();
        fs.writeFileSync(_dbPath, Buffer.from(data));
      } catch (err) {
        console.error('[SQLite] Error saving database to disk:', err);
      }
    }
  }, 1000);
}

/**
 * Create and return a SQLite database wrapper with the same interface as
 * the MSSQL db object.
 */
export async function createSqliteDb(): Promise<SqliteDbWrapper> {
  const dbPath = getSqliteDbPath();
  _dbPath = dbPath;
  console.log(`🗄️  Using SQLite fallback database at: ${dbPath}`);

  const SQL = await initSqlJs();

  // Load existing database from disk if it exists
  let sqliteDb: SqlJsDatabase;
  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    sqliteDb = new SQL.Database(fileBuffer);
    console.log('  Loaded existing SQLite database from disk.');
  } else {
    sqliteDb = new SQL.Database();
    console.log('  Created new SQLite database.');
  }
  _sqliteDb = sqliteDb;

  // Enable WAL mode & foreign keys
  sqliteDb.run('PRAGMA journal_mode = WAL;');
  sqliteDb.run('PRAGMA foreign_keys = ON;');

  // Save to disk immediately after creation
  const initData = sqliteDb.export();
  fs.writeFileSync(dbPath, Buffer.from(initData));

  const wrapper: SqliteDbWrapper = {
    async all<T = any>(query: string, ...args: unknown[]): Promise<T[]> {
      const q = translateDml(query);
      const params = flattenParams(args);
      try {
        const results = sqliteDb.exec(q, params as any[]);
        if (results.length === 0) return [];
        return resultToObjects(results[0].columns, results[0].values) as T[];
      } catch (err) {
        console.error('[SQLite all] Error:', (err as Error).message, '\nQuery:', q.substring(0, 300));
        throw err;
      }
    },

    async get<T = any>(query: string, ...args: unknown[]): Promise<T | undefined> {
      const q = translateDml(query);
      const params = flattenParams(args);
      try {
        const results = sqliteDb.exec(q, params as any[]);
        if (results.length === 0 || results[0].values.length === 0) return undefined;
        return resultToObjects(results[0].columns, results[0].values)[0] as T;
      } catch (err) {
        console.error('[SQLite get] Error:', (err as Error).message, '\nQuery:', q.substring(0, 300));
        throw err;
      }
    },

    async run(query: string, ...params: unknown[]): Promise<{ rowsAffected: number[] }> {
      const q = translateDml(query);
      const flat = flattenParams(params);

      // For multi-statement DDL batches, just exec the whole thing
      // sql.js's exec can handle multiple statements
      if (q.includes('CREATE TABLE') || q.includes('ALTER TABLE') || q.includes('CREATE INDEX') || q.includes('CREATE UNIQUE')) {
        try {
          sqliteDb.exec(q);
        } catch (err: any) {
          // Ignore typical migration errors
          if (!err.message?.includes('duplicate column') &&
              !err.message?.includes('already exists')) {
            console.warn('[SQLite DDL]', err.message?.substring(0, 200));
          }
        }
        scheduleSave();
        return { rowsAffected: [0] };
      }

      try {
        sqliteDb.run(q, flat as any[]);
        const changes = sqliteDb.getRowsModified();
        scheduleSave();
        return { rowsAffected: [changes] };
      } catch (err) {
        console.error('[SQLite run] Error:', (err as Error).message, '\nQuery:', q.substring(0, 300));
        throw err;
      }
    },

    async withTransaction<T>(work: (db: any) => Promise<T>): Promise<T> {
      sqliteDb.run('BEGIN');
      try {
        const result = await work(wrapper);
        sqliteDb.run('COMMIT');
        scheduleSave();
        return result;
      } catch (err) {
        sqliteDb.run('ROLLBACK');
        throw err;
      }
    }
  };

  return wrapper;
}

/**
 * Run the SQLite-specific table creation migrations.
 */
export async function initSqliteTables(db: SqliteDbWrapper): Promise<void> {
  console.log('Running SQLite table migrations...');

  const ddl = `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      phone TEXT,
      permissions TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      customer_number TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT,
      address TEXT NOT NULL,
      gender TEXT NOT NULL,
      city TEXT NOT NULL,
      governorate TEXT NOT NULL,
      region TEXT NOT NULL,
      date_of_birth TEXT NOT NULL,
      national_id TEXT NOT NULL,
      age INTEGER NOT NULL,
      pension_date TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      balance_type TEXT NOT NULL DEFAULT 'debtor',
      notes TEXT,
      image TEXT,
      guarantors TEXT,
      is_sued INTEGER NOT NULL DEFAULT 0,
      sued_date TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT,
      address TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      barcode TEXT,
      category TEXT,
      fulfillment_type TEXT NOT NULL DEFAULT 'on_demand',
      unit TEXT,
      purchase_price REAL NOT NULL DEFAULT 0,
      sale_price REAL NOT NULL DEFAULT 0,
      discount REAL NOT NULL DEFAULT 0,
      tax REAL NOT NULL DEFAULT 0,
      quantity REAL NOT NULL DEFAULT 0,
      min_quantity REAL NOT NULL DEFAULT 0,
      image TEXT,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY,
      invoice_number TEXT NOT NULL UNIQUE,
      customer_id TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      total REAL NOT NULL,
      paid REAL NOT NULL DEFAULT 0,
      remaining REAL NOT NULL,
      status TEXT NOT NULL,
      date TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      locked INTEGER NOT NULL DEFAULT 0,
      last_edited_by TEXT,
      last_edited_at TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      subtotal REAL,
      discount REAL,
      tax REAL,
      notes TEXT,
      payment_method TEXT,
      manual_invoice_ref TEXT,
      sales_rep_id TEXT,
      sales_rep_name TEXT,
      commission_rate REAL,
      commission_amount REAL,
      installment_months INTEGER,
      installment_start_date TEXT,
      upfront_amount REAL,
      monthly_installment_amount REAL
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id TEXT PRIMARY KEY,
      sale_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      barcode TEXT,
      quantity REAL NOT NULL,
      unit_price REAL NOT NULL,
      discount REAL NOT NULL,
      tax REAL NOT NULL,
      total REAL NOT NULL,
      unit_cost REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id TEXT PRIMARY KEY,
      invoice_number TEXT NOT NULL UNIQUE,
      supplier_id TEXT NOT NULL,
      supplier_name TEXT NOT NULL,
      subtotal REAL NOT NULL,
      discount REAL NOT NULL DEFAULT 0,
      tax REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL,
      paid REAL NOT NULL DEFAULT 0,
      remaining REAL NOT NULL,
      status TEXT NOT NULL,
      date TEXT NOT NULL,
      notes TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS purchase_items (
      id TEXT PRIMARY KEY,
      purchase_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      barcode TEXT,
      quantity REAL NOT NULL,
      unit_price REAL NOT NULL,
      discount REAL NOT NULL,
      tax REAL NOT NULL,
      total REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS installment_schedules (
      id TEXT PRIMARY KEY,
      sale_id TEXT NOT NULL,
      month_index INTEGER NOT NULL,
      due_date TEXT NOT NULL,
      amount REAL NOT NULL,
      paid_amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      paid_at TEXT
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      sale_id TEXT,
      installment_id TEXT,
      description TEXT NOT NULL,
      date TEXT NOT NULL,
      receipt_number TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'posted',
      void_ref TEXT,
      approved_by TEXT,
      channel TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      reference_id TEXT,
      reference_type TEXT,
      customer_id TEXT,
      supplier_id TEXT,
      invoice_number TEXT,
      affects_customer_balance INTEGER
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      date TEXT NOT NULL,
      receipt TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      company_name TEXT NOT NULL,
      company_address TEXT NOT NULL,
      company_phone TEXT NOT NULL,
      company_email TEXT NOT NULL,
      tax_rate REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'جنيه',
      baseline_capital REAL NOT NULL DEFAULT 8500000,
      invoice_prefix TEXT NOT NULL DEFAULT 'INV',
      invoice_footer TEXT
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sales_reps (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT,
      address TEXT,
      area TEXT,
      target REAL NOT NULL DEFAULT 0,
      achieved REAL NOT NULL DEFAULT 0,
      commission REAL NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shareholders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      share_percentage REAL NOT NULL,
      management_fee_percentage REAL DEFAULT 0,
      capital REAL NOT NULL DEFAULT 0,
      current_balance REAL NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shareholder_transactions (
      id TEXT PRIMARY KEY,
      shareholder_id TEXT NOT NULL,
      shareholder_name TEXT NOT NULL,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      date TEXT NOT NULL,
      description TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS collection_tasks (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      sale_id TEXT NOT NULL,
      installment_id TEXT NOT NULL,
      due_date TEXT NOT NULL,
      amount REAL NOT NULL,
      status TEXT NOT NULL,
      assigned_to_user_id TEXT,
      assigned_to_name TEXT,
      visit_notes TEXT,
      visit_result TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      payload TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS closing_periods (
      id TEXT PRIMARY KEY,
      period_type TEXT NOT NULL,
      period_date TEXT NOT NULL,
      status TEXT NOT NULL,
      closed_by TEXT,
      closed_at TEXT,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS reschedule_requests (
      id TEXT PRIMARY KEY,
      sale_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL,
      old_installment_months INTEGER NOT NULL,
      new_installment_months INTEGER NOT NULL,
      requested_by TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      reviewed_by TEXT,
      reviewed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS collection_tasks_archive (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      sale_id TEXT NOT NULL,
      installment_id TEXT NOT NULL,
      due_date TEXT NOT NULL,
      amount REAL NOT NULL,
      status TEXT NOT NULL,
      assigned_to_user_id TEXT,
      assigned_to_name TEXT,
      visit_notes TEXT,
      visit_result TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payments_archive (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      sale_id TEXT,
      installment_id TEXT,
      description TEXT NOT NULL,
      date TEXT NOT NULL,
      receipt_number TEXT NOT NULL,
      status TEXT NOT NULL,
      void_ref TEXT,
      approved_by TEXT,
      channel TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      reference_id TEXT,
      reference_type TEXT,
      customer_id TEXT,
      supplier_id TEXT,
      invoice_number TEXT,
      affects_customer_balance INTEGER
    );

    CREATE TABLE IF NOT EXISTS dashboard_metrics_cache (
      id INTEGER PRIMARY KEY DEFAULT 1,
      cash_in_total REAL NOT NULL DEFAULT 0,
      cash_out_total REAL NOT NULL DEFAULT 0,
      inventory_value REAL NOT NULL DEFAULT 0,
      customer_receivables REAL NOT NULL DEFAULT 0,
      supplier_payables REAL NOT NULL DEFAULT 0,
      subscribed_capital REAL NOT NULL DEFAULT 0,
      capital_deposits REAL NOT NULL DEFAULT 0,
      capital_withdrawals REAL NOT NULL DEFAULT 0,
      all_time_sales REAL NOT NULL DEFAULT 0,
      all_time_cogs REAL NOT NULL DEFAULT 0,
      all_time_expenses REAL NOT NULL DEFAULT 0,
      realized_cash_total REAL NOT NULL DEFAULT 0,
      total_customers INTEGER NOT NULL DEFAULT 0,
      total_products INTEGER NOT NULL DEFAULT 0,
      total_suppliers INTEGER NOT NULL DEFAULT 0,
      pending_installments INTEGER NOT NULL DEFAULT 0,
      overdue_installments INTEGER NOT NULL DEFAULT 0,
      last_refreshed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `;

  try {
    await db.run(ddl);
  } catch (err: any) {
    console.warn('[SQLite init] DDL batch error:', err.message);
  }

  // Create indexes
  const indexes = [
    'CREATE INDEX IF NOT EXISTS IX_sale_items_sale_id ON sale_items(sale_id)',
    'CREATE INDEX IF NOT EXISTS IX_installment_schedules_sale_id ON installment_schedules(sale_id)',
    'CREATE INDEX IF NOT EXISTS IX_installment_schedules_due_date ON installment_schedules(due_date)',
    'CREATE INDEX IF NOT EXISTS IX_payments_sale_id ON payments(sale_id)',
    'CREATE INDEX IF NOT EXISTS IX_payments_receipt_number ON payments(receipt_number)',
    'CREATE INDEX IF NOT EXISTS IX_purchase_items_purchase_id ON purchase_items(purchase_id)',
    'CREATE INDEX IF NOT EXISTS IX_purchases_supplier_id ON purchases(supplier_id)',
    'CREATE INDEX IF NOT EXISTS IX_sales_created_at ON sales(created_at)',
    'CREATE INDEX IF NOT EXISTS IX_customers_created_at ON customers(created_at)',
    'CREATE INDEX IF NOT EXISTS IX_products_created_at ON products(created_at)',
  ];

  for (const idx of indexes) {
    try {
      await db.run(idx);
    } catch (err: any) {
      console.warn('[SQLite index]', err.message);
    }
  }

  // Seed default admin user if none exists
  try {
    const admin = await db.get<{ id: string }>('SELECT id FROM users WHERE username = ?', 'admin');
    if (!admin?.id) {
      const passwordHash = await hashPassword('admin123');
      const allPermissions = {
        'sales:read': true,
        'sales:write': true,
        'sales:reschedule': true,
        'payments:read': true,
        'payments:write': true,
        'payments:reverse': true,
        'reports:read': true,
        'closing:write': true,
        'users:manage': true,
        'inventory:manage': true,
        'purchases:manage': true,
        'settings:manage': true,
        'shareholders:manage': true,
        'notifications:read': true,
      };
      const userId = Math.random().toString(36).slice(2) + Date.now().toString(36);
      await db.run(
        `INSERT INTO users (id, name, username, password_hash, role, is_active, phone, permissions, created_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        userId,
        'المدير العام',
        'admin',
        passwordHash,
        'admin',
        '01000000000',
        JSON.stringify(allPermissions),
        new Date().toISOString()
      );
      console.log('✅ SQLite: Default admin user created (admin / admin123).');
    }
  } catch (err: any) {
    console.warn('[SQLite seed admin]', err.message);
  }

  console.log('✅ SQLite table migrations completed.');
}
