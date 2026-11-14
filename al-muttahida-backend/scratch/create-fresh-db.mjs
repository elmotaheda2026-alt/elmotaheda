// Creates an empty AlMuttahida_FreshTest database using the current working connection.
const m = await import('../dist/db.js');
const db = await m.dbPromise;
await db.run("IF DB_ID('AlMuttahida_FreshTest') IS NOT NULL BEGIN ALTER DATABASE AlMuttahida_FreshTest SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE AlMuttahida_FreshTest; END");
await db.run('CREATE DATABASE AlMuttahida_FreshTest');
console.log('CREATED');
process.exit(0);

