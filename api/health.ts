import type { VercelRequest, VercelResponse } from "@vercel/node";

import { handleHealthRequest } from "../src/handlers/health";

export default function handler(_req: VercelRequest, res: VercelResponse) {
  const result = handleHealthRequest();

  for (const [key, value] of Object.entries(result.headers ?? {})) {
    res.setHeader(key, value);
  }

  if (result.body === undefined) {
    res.status(result.status).end();
    return;
  }

  res.status(result.status).json(result.body);
}
