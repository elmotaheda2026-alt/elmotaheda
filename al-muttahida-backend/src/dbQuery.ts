export type QueryParam = unknown;
export type QueryParams = readonly QueryParam[];
export type PaginationOptions = { page?: number; limit?: number };

export type RequestLike = { input(name: string, value: QueryParam): unknown };

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
