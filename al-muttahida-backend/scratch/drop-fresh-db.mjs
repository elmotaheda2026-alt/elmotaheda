// Drops the AlMuttahida_FreshTest database created for verification.
const m = await import('../dist/db.js');
const db = await m.dbPromise;
await db.run("IF DB_ID('AlMuttahida_FreshTest') IS NOT NULL BEGIN ALTER DATABASE AlMuttahida_FreshTest SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE AlMuttahida_FreshTest; END");
console.log('DROPPED');
process.exit(0);

