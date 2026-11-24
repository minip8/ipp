import type { ApiError } from '@ipp/contracts';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';

/** Thrown anywhere in a request; rendered as the contract's ApiError. */
export class HttpError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
  toBody(): ApiError {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.retryAfter !== undefined ? { retryAfter: this.retryAfter } : {}),
      },
    };
  }
}

export const badRequest = (message: string, code = 'bad_request') =>
  new HttpError(400, code, message);
export const unauthorized = () => new HttpError(401, 'unauthorized', 'Sign in required');
export const forbidden = (message = 'Not allowed') => new HttpError(403, 'forbidden', message);
export const notFound = (what = 'Resource') => new HttpError(404, 'not_found', `${what} not found`);
export const conflict = (code: string, message: string) => new HttpError(409, code, message);
export const tooLarge = (message: string) => new HttpError(413, 'too_large', message);
export const rateLimited = (
  retryAfter: number,
  code = 'rate_limited',
  message = 'Too many requests',
) => new HttpError(429, code, message, retryAfter);
export const unavailable = (code: string, message: string) => new HttpError(503, code, message);

export function validationError(error: z.ZodError): HttpError {
  const first = error.issues[0];
  const where = first?.path.length ? `${first.path.join('.')}: ` : '';
  return new HttpError(400, 'validation_error', `${where}${first?.message ?? 'invalid request'}`);
}
