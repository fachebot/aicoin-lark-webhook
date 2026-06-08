import { HttpError } from "../../shared/errors.js";

import type { Kline } from "./types.js";



export async function fetchKlines(

  symbol: string,

  interval: string,

  limit: number = 100,

): Promise<Kline[]> {

  const API_HOSTS = [

  "https://fapi.binance.com/fapi/v1/klines",

  "https://api.binance.com/api/v3/klines",

];





  let lastError: unknown;



  for (const baseUrl of API_HOSTS) {

    const url = `${baseUrl}?symbol=${symbol}&interval=${interval}&limit=${limit}`;



    try {

      const response = await fetch(url);



      if (!response.ok) {

        const body = await response.text();

        if (response.status === 403 || response.status === 451) {

          lastError = body;

          continue;

        }

        throw new HttpError(

          502,

          "binance_api_error",

          `Binance API returned ${response.status}: ${body}`,

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

    } catch (err) {

      lastError = err;

    }

  }



  throw new HttpError(

    502,

    "binance_api_error",

    lastError instanceof Error ? lastError.message : String(lastError),

  );
}