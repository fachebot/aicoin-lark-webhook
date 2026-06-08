import { HttpError } from "../../shared/errors.js";
import type { Kline } from "./types.js";

export async function fetchKlines(
  symbol: string,
  interval: string,
  limit: number = 100,
): Promise<Kline[]> {
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;

  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    throw new HttpError(
      502,
      "binance_api_error",
      err instanceof Error ? err.message : "Failed to fetch Binance klines.",
    );
  }

  if (!response.ok) {
    throw new HttpError(
      502,
      "binance_api_error",
      `Binance API returned ${response.status}: ${await response.text()}`,
    );
  }

  const raw = (await response.json()) as unknown[][];
  return raw.map((row) => ({
    openTime: row[0] as number,
    open: parseFloat(row[1] as string),
    high: parseFloat(row[2] as string),
    low: parseFloat(row[3] as string),
    close: parseFloat(row[4] as string),
    volume: parseFloat(row[5] as string),
    closeTime: row[6] as number,
  }));
}
