import assert from 'node:assert/strict';
import test from 'node:test';
import { applyPagination, hasTopLevelOrderBy, normalizeQueryParams, prepareSqlRequest } from './dbQuery.js';

function createRequestRecorder() {
  const inputs: Array<{ name: string; value: unknown }> = [];
  return {
    inputs,
    input(name: string, value: unknown) {
      inputs.push({ name, value });
      return this;
    },
  };
}

test('normalizeQueryParams preserves empty, scalar, and array parameters', () => {
  const params = ['a', 1, null] as const;

  assert.deepEqual(normalizeQueryParams(), []);
  assert.deepEqual(normalizeQueryParams('id-1'), ['id-1']);
  assert.deepEqual(normalizeQueryParams(params), ['a', 1, null]);
});

test('prepareSqlRequest replaces placeholders and binds parameters in order', () => {
  const request = createRequestRecorder();
  const result = prepareSqlRequest(
    'SELECT * FROM payments WHERE sale_id = ? AND status = ? AND amount >= ?',
    ['sale-1', 'posted', 100],
    request,
  );

  assert.equal(result.preparedQuery, 'SELECT * FROM payments WHERE sale_id = @p1 AND status = @p2 AND amount >= @p3');
  assert.deepEqual(request.inputs, [
    { name: 'p1', value: 'sale-1' },
    { name: 'p2', value: 'posted' },
    { name: 'p3', value: 100 },
  ]);
});

test('prepareSqlRequest rejects missing parameters', () => {
  const request = createRequestRecorder();

  assert.throws(
    () => prepareSqlRequest('SELECT * FROM users WHERE id = ? AND role = ?', ['u1'], request),
    /SQL parameter mismatch: query has 2 placeholders but received 1 values/,
  );
});

test('prepareSqlRequest rejects extra parameters', () => {
  const request = createRequestRecorder();

  assert.throws(
    () => prepareSqlRequest('SELECT * FROM users WHERE id = ?', ['u1', 'admin'], request),
    /SQL parameter mismatch: query has 1 placeholders but received 2 values/,
  );
});
test('hasTopLevelOrderBy ignores nested subquery ordering', () => {
  const query = `
    SELECT s.*,
           (SELECT * FROM installment_schedules WHERE sale_id = s.id ORDER BY month_index ASC FOR JSON PATH) AS schedules_json
    FROM sales s
  `;

  assert.equal(hasTopLevelOrderBy(query), false);
});

test('applyPagination preserves explicit outer ORDER BY before OFFSET FETCH', () => {
  const query = 'SELECT * FROM sales ORDER BY created_at DESC';

  assert.equal(
    applyPagination(query, { page: 2, limit: 10 }),
    'SELECT * FROM sales ORDER BY created_at DESC OFFSET 10 ROWS FETCH NEXT 10 ROWS ONLY',
  );
});

test('applyPagination adds fallback ORDER BY when only nested subqueries are ordered', () => {
  const query = `
    SELECT s.*,
           (SELECT * FROM installment_schedules WHERE sale_id = s.id ORDER BY month_index ASC FOR JSON PATH) AS schedules_json
    FROM sales s
  `;

  const paginated = applyPagination(query, { page: 1, limit: 20 });

  assert.match(paginated, /FROM sales s\s+ORDER BY id OFFSET 0 ROWS FETCH NEXT 20 ROWS ONLY$/);
});

test('applyPagination inserts OFFSET FETCH before top-level FOR JSON PATH', () => {
  const query = 'SELECT * FROM customers FOR JSON PATH';

  assert.equal(
    applyPagination(query, { page: 1, limit: 5 }),
    'SELECT * FROM customers ORDER BY id OFFSET 0 ROWS FETCH NEXT 5 ROWS ONLY FOR JSON PATH',
  );
});

