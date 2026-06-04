import type { AppEnvironment } from "../src/config/env.js";
import { handleAicoinRequest } from "../src/handlers/aicoin.js";
import { handleHealthRequest } from "../src/handlers/health.js";
import { jsonResult, type HandlerResult } from "../src/shared/http.js";

export type WorkerEnv = AppEnvironment;

interface WorkerDependencies {
  handleAicoinRequest?: typeof handleAicoinRequest;
  handleHealthRequest?: typeof handleHealthRequest;
}

export async function handleWorkerRequest(
  request: Request,
  env: AppEnvironment,
  dependencies: WorkerDependencies = {},
): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  if (url.pathname === "/api/health") {
    if (method !== "GET" && method !== "HEAD") {
      return toResponse(
        jsonResult(405, {
          ok: false,
          error: "method_not_allowed",
          message: "Only GET and HEAD are supported.",
        }),
      );
    }

    const result = (dependencies.handleHealthRequest ?? handleHealthRequest)();
    return toResponse(stripBodyForHead(method, result));
  }

  if (url.pathname === "/api/aicoin") {
    const result = await (
      dependencies.handleAicoinRequest ?? handleAicoinRequest
    )(
      {
        method,
        query: toQueryRecord(url.searchParams),
        headers: toHeaderRecord(request.headers),
        body: shouldReadBody(method) ? await request.text() : undefined,
      },
      method === "POST" ? { configEnv: env } : {},
    );

    return toResponse(stripBodyForHead(method, result));
  }

  return toResponse(
    jsonResult(404, {
      ok: false,
      error: "not_found",
      message: "Route not found.",
    }),
  );
}

export default {
  fetch(request: Request, env: AppEnvironment): Promise<Response> {
    return handleWorkerRequest(request, env);
  },
};

function shouldReadBody(method: string): boolean {
  return method !== "GET" && method !== "HEAD";
}

function stripBodyForHead(
  method: string,
  result: HandlerResult,
): HandlerResult {
  if (method !== "HEAD") {
    return result;
  }

  return {
    status: result.status,
    headers: result.headers,
  };
}

function toQueryRecord(
  searchParams: URLSearchParams,
): Record<string, string | string[] | undefined> {
  const query: Record<string, string | string[] | undefined> = {};

  for (const key of new Set(searchParams.keys())) {
    const values = searchParams.getAll(key);
    query[key] = values.length > 1 ? values : values[0];
  }

  return query;
}

function toHeaderRecord(
  headers: Headers,
): Record<string, string | string[] | undefined> {
  const record: Record<string, string | string[] | undefined> = {};

  for (const [key, value] of headers.entries()) {
    record[key.toLowerCase()] = value;
  }

  return record;
}

function toResponse(result: HandlerResult, omitBody = false): Response {
  const headers = new Headers(result.headers);

  if (result.body === undefined || omitBody) {
    return new Response(null, {
      status: result.status,
      headers,
    });
  }

  const body =
    typeof result.body === "string" ? result.body : JSON.stringify(result.body);
  return new Response(body, {
    status: result.status,
    headers,
  });
}
