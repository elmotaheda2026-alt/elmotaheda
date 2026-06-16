// Minimal mock DB implementation to allow running the server without a SQL Server.
export const dbPromise = Promise.resolve({
  async run() { return { recordset: [] }; },
  async get() { return undefined; },
  async all() { return []; },
});

export async function initDb() {
  // no-op
  return;
}
