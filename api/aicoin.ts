import type { VercelRequest, VercelResponse } from "@vercel/node";

import { handleAicoinRequest } from "../src/handlers/aicoin.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const method = (req.method ?? 'GET').toUpperCase();

  if (method === 'HEAD') {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader('content-length', '370');
    res.status(200).end();
    return;
  }

  const result = await handleAicoinRequest({
    method: req.method,
    query: req.query,
    headers: req.headers,
    body: req.body,
  });

  for (const [key, value] of Object.entries(result.headers ?? {})) {
    res.setHeader(key, value);
  }

  if (result.body === undefined) {
    res.status(result.status).end();
    return;
  }

  res.status(result.status).json(result.body);
}
