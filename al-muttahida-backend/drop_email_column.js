// Run a direct raw query to drop dependent constraint and drop column email
import sql from 'mssql';
import { config } from './src/config.js';

(async () => {
  try {
    const pool = await sql.connect(config.sql);
    console.log('Connected to database.');

    // 1. Find constraint names on email column in users table
    const checkQuery = `
      SELECT d.name AS ConstraintName
      FROM sys.default_constraints d
      INNER JOIN sys.columns c ON d.parent_column_id = c.column_id AND d.parent_object_id = c.object_id
      WHERE c.object_id = OBJECT_ID('users') AND c.name = 'email'
      UNION
      SELECT k.name AS ConstraintName
      FROM sys.key_constraints k
      INNER JOIN sys.index_columns ic ON k.parent_object_id = ic.object_id
      INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
      WHERE k.parent_object_id = OBJECT_ID('users') AND c.name = 'email'
      UNION
      SELECT i.name AS ConstraintName
      FROM sys.indexes i
      INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
      INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
      WHERE i.object_id = OBJECT_ID('users') AND c.name = 'email';
    `;
    const result = await pool.request().query(checkQuery);
    console.log('Dependent constraints:', result.recordset);

    for (const row of result.recordset) {
      console.log(`Dropping constraint ${row.ConstraintName}...`);
      await pool.request().query(`ALTER TABLE users DROP CONSTRAINT [${row.ConstraintName}]`);
    }

    // Try dropping index if constraint dropping didn't cover it
    try {
      const dropIndexQuery = `
        IF EXISTS (SELECT * FROM sys.indexes WHERE name = 'UQ__users__AB6E6164E3B8236F' AND object_id = OBJECT_ID('users'))
        DROP INDEX UQ__users__AB6E6164E3B8236F ON users;
      `;
      await pool.request().query(dropIndexQuery);
      console.log('Tried dropping index UQ__users__AB6E6164E3B8236F');
    } catch (e) {
      console.log('Index drop info/skip:', e.message);
    }

    // Also drop default constraints or unique keys using a broader check
    try {
      const dropConstraintQuery = `
        DECLARE @name NVARCHAR(MAX);
        SELECT @name = name FROM sys.objects WHERE type IN ('C', 'F', 'PK', 'UQ', 'D') AND parent_object_id = OBJECT_ID('users') AND name LIKE '%email%';
        IF @name IS NOT NULL
        EXEC('ALTER TABLE users DROP CONSTRAINT [' + @name + ']');
      `;
      await pool.request().query(dropConstraintQuery);
    } catch(e) {}

    // Now try dropping the column
    console.log('Dropping email column...');
    await pool.request().query(`ALTER TABLE users DROP COLUMN email;`);
    console.log('Successfully dropped email column from users.');

    // Ensure username column is added
    console.log('Ensuring username column is added...');
    await pool.request().query(`
      IF COL_LENGTH('users', 'username') IS NULL
      ALTER TABLE users ADD username NVARCHAR(100) NULL;
    `);
    console.log('Done!');
    process.exit(0);
  } catch (err) {
    console.error('Error executing query:', err);
    process.exit(1);
  }
})();
