import type { VercelRequest, VercelResponse } from "@vercel/node";

import { handleHealthRequest } from "../src/handlers/health.js";

export default function handler(req: VercelRequest, res: VercelResponse) {
  const method = (req.method ?? 'GET').toUpperCase();
  const result = handleHealthRequest();
  const stripped = stripBodyForHead(method, result);

  for (const [key, value] of Object.entries(result.headers ?? {})) {
    res.setHeader(key, value);
  }

  if (stripped.body === undefined) {
    res.status(result.status).end();
    return;
  }

  res.status(stripped.status).json(stripped.body);
}

function stripBodyForHead(method: string, result: { status: number; body?: unknown; headers?: Record<string, string> }): { status: number; body?: unknown; headers?: Record<string, string> } {
  if (method !== 'HEAD') return result;
  return { status: result.status, headers: result.headers };
}
