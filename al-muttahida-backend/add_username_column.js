// Script to add missing username column to users table if not present
import { dbPromise } from './src/db.js';
(async () => {
  try {
    const db = await dbPromise;
    await db.run(`IF COL_LENGTH('users', 'username') IS NULL ALTER TABLE users ADD username NVARCHAR(100) NULL`);
    console.log('Altered users table: added username column (nullable)');
  } catch (err) {
    console.error('Error altering users table', err);
  }
})();
