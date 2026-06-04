export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class LarkAPIError extends Error {
  readonly stage: string;
  readonly status?: number;
  readonly details?: unknown;

  constructor(
    stage: string,
    message: string,
    status?: number,
    details?: unknown,
  ) {
    super(message);
    this.name = "LarkAPIError";
    this.stage = stage;
    this.status = status;
    this.details = details;
  }
}

export function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError;
}
