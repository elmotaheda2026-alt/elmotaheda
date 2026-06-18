import sql from 'mssql';
import { config } from './config.js';

/**
 * Create a connection pool to the SQL Server database using the
 * configuration from `config.sql`. The returned object mimics the
 * minimal API used by the route handlers (`all`, `get`, `run`).
 */
export const dbPromise = (async () => {
  const pool = await sql.connect(config.sql);

  function prepareRequest(query: string, params: any[]) {
    const request = pool.request();
    let index = 0;
    const preparedQuery = query.replace(/\?/g, () => {
      index += 1;
      const paramName = `p${index}`;
      request.input(paramName, params[index - 1]);
      return `@${paramName}`;
    });

    if (index !== params.length) {
      throw new Error(`SQL parameter mismatch: query has ${index} placeholders but received ${params.length} values`);
    }

    return { request, preparedQuery };
  }
  return {
    /** Execute a query that returns multiple rows. */
    async all<T = any>(query: string, ...params: any[]): Promise<T[]> {
      const { request, preparedQuery } = prepareRequest(query, params);
      const result = await request.query(preparedQuery);
      return result.recordset as T[];
    },
    /** Execute a query that returns a single row. */
    async get<T = any>(query: string, ...params: any[]): Promise<T | undefined> {
      const { request, preparedQuery } = prepareRequest(query, params);
      const result = await request.query(preparedQuery);
      return result.recordset[0] as T | undefined;
    },
    /** Execute a non‑select statement (INSERT/UPDATE/DELETE). */
    async run(query: string, ...params: any[]) {
      const { request, preparedQuery } = prepareRequest(query, params);
      const result = await request.query(preparedQuery);
      return result;
    },
  };
})();

/**
 * Initialise the DB connection. This function is kept for backward
 * compatibility – it simply resolves when the connection pool is ready.
 */
export async function initDb(): Promise<void> {
  await dbPromise; // ensure the pool is created
}
