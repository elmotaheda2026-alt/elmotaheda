import sql from 'mssql';
import { config } from '../src/config.js';

async function main() {
  try {
    console.log('Connecting to MSSQL...');
    const pool = await sql.connect(config.sql);
    console.log('Connected.');

    const tables = [
      'users',
      'customers',
      'suppliers',
      'products',
      'sales',
      'sale_items',
      'purchases',
      'purchase_items',
      'installment_schedules',
      'payments',
      'expenses',
      'notifications',
      'sales_reps',
      'shareholders',
      'shareholder_transactions',
      'collection_tasks',
      'audit_log',
      'closing_periods',
      'reschedule_requests'
    ];

    for (const table of tables) {
      const result = await pool.request().query(`SELECT COUNT(*) as cnt FROM ${table}`);
      console.log(`Table: ${table.padEnd(25)} | Rows: ${result.recordset[0].cnt}`);
    }

    await pool.close();
  } catch (err) {
    console.error('Error:', err);
  }
}

main();
