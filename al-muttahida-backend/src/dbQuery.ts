export type QueryParam = unknown;
export type QueryParams = readonly QueryParam[];
export type PaginationOptions = { page?: number; limit?: number };

export type RequestLike = { input(name: string, value: QueryParam): unknown };

function keywordAtTopLevel(sql: string, keywordPattern: RegExp): boolean {
  let depth = 0;
  let quote: "'" | '"' | '[' | null = null;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];

    if (quote) {
      if (quote === "'" && char === "'" && next === "'") {
        index += 1;
        continue;
      }
      if ((quote === "'" && char === "'") || (quote === '"' && char === '"') || (quote === '[' && char === ']')) {
        quote = null;
      }
      continue;
    }

    if (char === "'" || char === '"' || char === '[') {
      quote = char as "'" | '"' | '[';
      continue;
    }

    if (char === '(') {
      depth += 1;
      continue;
    }

    if (char === ')') {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (depth === 0) {
      keywordPattern.lastIndex = index;
      const match = keywordPattern.exec(sql);
      if (match?.index === index) return true;
    }
  }

  return false;
}

export function hasTopLevelOrderBy(query: string): boolean {
  return keywordAtTopLevel(query, /\bORDER\s+BY\b/gi);
}

export function applyPagination(query: string, pagination: PaginationOptions): string {
  const limit = Math.min(Math.max(1, Number(pagination.limit) || 20), 50);
  const offset = (Math.max(1, Number(pagination.page) || 1) - 1) * limit;
  const trimmedQuery = query.trim();
  const orderBy = hasTopLevelOrderBy(trimmedQuery) ? '' : 'ORDER BY id ';
  const paginationTokens = `${orderBy}OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;
  const forJsonRegex = /FOR\s+JSON\s+PATH\s*$/i;

  if (forJsonRegex.test(trimmedQuery)) {
    const queryWithoutForJson = trimmedQuery.replace(forJsonRegex, '').trimEnd();
    return `${queryWithoutForJson} ${paginationTokens} FOR JSON PATH`;
  }

  return `${trimmedQuery} ${paginationTokens}`;
}
export function normalizeQueryParams(params?: QueryParam | QueryParams): QueryParam[] {
  if (params === undefined) return [];
  return Array.isArray(params) ? [...params] : [params];
}

export function prepareSqlRequest<TRequest extends RequestLike>(query: string, params: QueryParams, request: TRequest) {
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



