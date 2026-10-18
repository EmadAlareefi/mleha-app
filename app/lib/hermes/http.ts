import { NextResponse } from 'next/server';

/**
 * Response envelope shared by every Hermes endpoint:
 * `{ data, meta: { request_id, generated_at, timezone, currency, ... }, error }`.
 * Error messages are deliberately generic; details go to structured logs only.
 */

export const HERMES_DEFAULT_TIMEZONE = 'Asia/Riyadh';
export const HERMES_REPORT_CURRENCY = 'SAR';

export type HermesErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'validation_error'
  | 'rate_limited'
  | 'https_required'
  | 'temporarily_unavailable'
  | 'internal_error';

const STATUS_BY_CODE: Record<HermesErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  validation_error: 400,
  rate_limited: 429,
  https_required: 403,
  temporarily_unavailable: 503,
  internal_error: 500,
};

const MESSAGE_BY_CODE: Record<HermesErrorCode, string> = {
  unauthenticated: 'Missing or invalid credentials.',
  forbidden: 'This credential is not allowed to perform this action.',
  not_found: 'No matching record was found.',
  validation_error: 'The request parameters are invalid.',
  rate_limited: 'Too many requests. Retry later.',
  https_required: 'HTTPS is required.',
  temporarily_unavailable: 'The service is temporarily unavailable. Retry later.',
  internal_error: 'An unexpected error occurred.',
};

export class HermesError extends Error {
  readonly code: HermesErrorCode;
  readonly status: number;
  /** Safe, non-sensitive details (e.g. which parameter failed validation). */
  readonly details?: Record<string, unknown>;
  readonly retryAfterSeconds?: number;

  constructor(
    code: HermesErrorCode,
    options: { details?: Record<string, unknown>; retryAfterSeconds?: number; message?: string } = {}
  ) {
    super(options.message ?? MESSAGE_BY_CODE[code]);
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = options.details;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export function validationError(field: string, reason: string): HermesError {
  return new HermesError('validation_error', { details: { field, reason } });
}

export interface HermesMeta {
  request_id: string;
  generated_at: string;
  timezone: string;
  currency: string | null;
  [key: string]: unknown;
}

function secureHeaders(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('Cache-Control', 'private, no-store, max-age=0');
  response.headers.set('X-Request-Id', requestId);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  return response;
}

export function successResponse(data: unknown, meta: HermesMeta): NextResponse {
  return secureHeaders(NextResponse.json({ data, meta, error: null }, { status: 200 }), meta.request_id);
}

export function errorResponse(error: HermesError, requestId: string, generatedAt = new Date()): NextResponse {
  const response = NextResponse.json(
    {
      data: null,
      meta: {
        request_id: requestId,
        generated_at: generatedAt.toISOString(),
        timezone: HERMES_DEFAULT_TIMEZONE,
        currency: null,
      },
      error: {
        code: error.code,
        message: MESSAGE_BY_CODE[error.code],
        ...(error.details ? { details: error.details } : {}),
      },
    },
    { status: error.status }
  );
  if (error.retryAfterSeconds) {
    response.headers.set('Retry-After', String(error.retryAfterSeconds));
  }
  if (error.code === 'unauthenticated') {
    response.headers.set('WWW-Authenticate', 'Bearer realm="hermes"');
  }
  return secureHeaders(response, requestId);
}
