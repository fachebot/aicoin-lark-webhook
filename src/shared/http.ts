export interface HandlerRequest {
  method?: string;
  query?: Record<string, string | string[] | undefined>;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
}

export interface HandlerResult {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export function jsonResult(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): HandlerResult {
  return {
    status,
    body,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  };
}

export function emptyResult(
  status: number,
  headers: Record<string, string> = {},
): HandlerResult {
  return {
    status,
    headers,
  };
}

export function firstValue(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}
