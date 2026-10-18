import crypto from 'crypto';
import type { NextRequest, NextResponse } from 'next/server';
import { log } from '@/app/lib/logger';
import { getClientIp, hashIp } from '@/app/lib/public-request';
import { readActor, type HermesActor } from './actor';
import {
  credentialRejection,
  getApiKeyPepper,
  HermesConfigError,
  parseApiKey,
  readBearerToken,
  verifySecret,
} from './credentials';
import {
  errorResponse,
  HERMES_DEFAULT_TIMEZONE,
  HermesError,
  successResponse,
  type HermesMeta,
} from './http';
import { redactForLog } from './pii';
import { canSeeFullPii, hasScope, normalizeScopes, type HermesScope } from './scopes';
import type { AuditRecord, CredentialRecord, HermesStore } from './store';
import { prismaHermesStore } from './store-prisma';
import { assertAllowedParams } from './validation';

/**
 * Request pipeline shared by every Hermes endpoint:
 *
 *   kill switch → TLS → credential → scope → rate limit → params → handler → audit
 *
 * Every outcome, including failures before authentication, writes one audit
 * row. A successful response is only returned once its audit row is stored
 * (fail closed).
 */

export const RATE_WINDOW_MS = 60_000;
export const MISS_WINDOW_MS = 10 * 60_000;
const DEFAULT_REQUESTS_PER_MINUTE = 60;
const DEFAULT_MISS_BUDGET = 20;
const TOUCH_INTERVAL_MS = 5 * 60_000;

/** Lookup actions whose `not_found` results count toward the enumeration budget. */
export const LOOKUP_ACTIONS = [
  'orders.search',
  'orders.get',
  'customers.search',
  'customers.summary',
  'shipments.search',
  'shipments.get',
] as const;

/** Parameter names that would put a secret in a URL; always rejected. */
const SECRET_PARAM_NAMES = ['api_key', 'apikey', 'key', 'token', 'access_token', 'secret', 'authorization'];

let activeStore: HermesStore = prismaHermesStore;

/** Test seam: swap the data store (in-memory fixtures). */
export function setHermesStore(store: HermesStore | null): void {
  activeStore = store ?? prismaHermesStore;
}

function positiveIntEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export interface AuthenticatedCredential {
  id: string;
  name: string;
  merchantId: string;
  scopes: HermesScope[];
}

export interface HermesContext {
  requestId: string;
  request: NextRequest;
  params: URLSearchParams;
  pathParams: Record<string, string>;
  credential: AuthenticatedCredential;
  fullPii: boolean;
  store: HermesStore;
  now: Date;
  actor: HermesActor;
}

export interface HandlerResult {
  data: unknown;
  meta?: Partial<HermesMeta>;
  audit: {
    outcome?: 'success' | 'not_found';
    targetType?: string | null;
    targetId?: string | null;
    resultCount?: number | null;
    classification: string;
  };
}

export interface HermesRouteConfig {
  action: string;
  scope: HermesScope;
  allowedParams: readonly string[];
  /**
   * Search endpoints also accept their parameters as a POST JSON body so
   * phone numbers and emails stay out of URLs and access logs. POST is still
   * read-only here.
   */
  allowPostBody?: boolean;
}

const MAX_BODY_BYTES = 4096;

async function readBodyParams(request: NextRequest): Promise<URLSearchParams> {
  if (request.nextUrl.search) {
    throw new HermesError('validation_error', { details: { field: 'query', reason: 'use_either_query_or_body' } });
  }
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    throw new HermesError('validation_error', { details: { field: 'body', reason: 'content_type_must_be_application_json' } });
  }
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    throw new HermesError('validation_error', { details: { field: 'body', reason: 'too_large' } });
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HermesError('validation_error', { details: { field: 'body', reason: 'invalid_json' } });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HermesError('validation_error', { details: { field: 'body', reason: 'must_be_object' } });
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (value === null || value === undefined) continue;
    if (typeof value !== 'string' && typeof value !== 'number') {
      throw new HermesError('validation_error', { details: { field: key, reason: 'must_be_string_or_number' } });
    }
    params.set(key, String(value));
  }
  return params;
}

/**
 * Configuration gaps and database connectivity problems are reported as a
 * retryable 503; anything else is a 500. Neither exposes the cause.
 */
function isTransientFailure(error: unknown): boolean {
  if (error instanceof HermesConfigError) return true;
  const name = (error as { name?: unknown })?.name;
  const code = (error as { code?: unknown })?.code;
  return (
    name === 'PrismaClientInitializationError' ||
    name === 'PrismaClientRustPanicError' ||
    (typeof code === 'string' && /^P1\d{3}$/.test(code)) ||
    code === 'P2024'
  );
}

type RouteContext = { params?: Promise<Record<string, string | string[]>> };

function isHttps(request: NextRequest): boolean {
  const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  if (forwarded) return forwarded === 'https';
  return request.nextUrl.protocol === 'https:';
}

function tlsRequired(): boolean {
  return process.env.NODE_ENV === 'production' && process.env.HERMES_ALLOW_INSECURE_HTTP !== 'true';
}

async function authenticate(
  request: NextRequest,
  store: HermesStore,
  now: Date
): Promise<{ credential: CredentialRecord | null; error: HermesError | null; reason: string | null }> {
  const parsed = parseApiKey(readBearerToken(request.headers.get('authorization')));
  if (!parsed) return { credential: null, error: new HermesError('unauthenticated'), reason: 'missing_or_malformed' };

  const credential = await store.findCredentialByKeyId(parsed.keyId);
  // Same response whether the key id is unknown, the secret is wrong, or the
  // key is revoked/expired — callers learn nothing about which keys exist.
  if (!credential || !verifySecret(parsed.secret, credential.secretHash, getApiKeyPepper())) {
    return { credential: null, error: new HermesError('unauthenticated'), reason: 'unknown_or_bad_secret' };
  }
  const rejection = credentialRejection(credential, now);
  if (rejection) return { credential, error: new HermesError('unauthenticated'), reason: rejection };
  return { credential, error: null, reason: null };
}

export function createHermesHandler(
  config: HermesRouteConfig,
  handle: (ctx: HermesContext) => Promise<HandlerResult>
) {
  return async function hermesRoute(request: NextRequest, routeContext?: RouteContext): Promise<NextResponse> {
    const started = performance.now();
    const now = new Date();
    const requestId = crypto.randomUUID();
    const store = activeStore;
    let params = request.nextUrl.searchParams;
    const actor = readActor(request.headers, request.nextUrl.pathname, { now });
    const ipHash = hashIp(getClientIp(request));

    let credential: CredentialRecord | null = null;
    let scopeUsed: string | null = null;

    const audit = async (fields: Omit<AuditRecord, 'requestId' | 'credentialId' | 'merchantId' | 'action' | 'durationMs' | 'ipHash' | 'actorId' | 'actorChannel' | 'actorVerified' | 'scopeUsed'>) => {
      await store.writeAudit({
        requestId,
        credentialId: credential?.id ?? null,
        merchantId: credential?.merchantId ?? null,
        action: config.action,
        scopeUsed,
        durationMs: Math.round(performance.now() - started),
        ipHash,
        actorId: actor.actorId,
        actorChannel: actor.channel,
        actorVerified: actor.verified,
        ...fields,
      });
    };

    const fail = async (error: HermesError, outcome: AuditRecord['outcome'], detail?: Record<string, unknown>) => {
      log.warn('hermes.request_rejected', {
        requestId,
        action: config.action,
        credentialId: credential?.id ?? null,
        outcome,
        status: error.status,
        ...((detail ? redactForLog(detail) : {}) as Record<string, unknown>),
      });
      try {
        await audit({
          outcome,
          httpStatus: error.status,
          classification: 'none',
          targetType: null,
          targetId: null,
          resultCount: null,
        });
      } catch (auditError) {
        log.error('hermes.audit_write_failed', { requestId, error: redactForLog(auditError) });
      }
      return errorResponse(error, requestId, now);
    };

    try {
      if (process.env.HERMES_API_ENABLED !== 'true') {
        return errorResponse(new HermesError('temporarily_unavailable'), requestId, now);
      }

      if (tlsRequired() && !isHttps(request)) {
        return await fail(new HermesError('https_required'), 'denied', { reason: 'plain_http' });
      }

      for (const name of SECRET_PARAM_NAMES) {
        if (params.has(name)) {
          return await fail(
            new HermesError('validation_error', { details: { field: name, reason: 'credentials_must_use_authorization_header' } }),
            'invalid'
          );
        }
      }

      const auth = await authenticate(request, store, now);
      credential = auth.credential;
      if (auth.error) {
        return await fail(auth.error, 'unauthenticated', { reason: auth.reason });
      }
      const authed = credential!;
      const scopes = normalizeScopes(authed.scopes);

      if (!hasScope(scopes, config.scope)) {
        return await fail(new HermesError('forbidden', { details: { required_scope: config.scope } }), 'denied');
      }
      scopeUsed = config.scope;

      const usage = await store.countUsage(
        authed.id,
        new Date(now.getTime() - RATE_WINDOW_MS),
        new Date(now.getTime() - MISS_WINDOW_MS),
        LOOKUP_ACTIONS
      );
      if (usage.recent >= positiveIntEnv('HERMES_RATE_LIMIT_PER_MINUTE', DEFAULT_REQUESTS_PER_MINUTE)) {
        return await fail(new HermesError('rate_limited', { retryAfterSeconds: 60 }), 'rate_limited');
      }
      const isLookup = (LOOKUP_ACTIONS as readonly string[]).includes(config.action);
      if (isLookup && usage.misses >= positiveIntEnv('HERMES_LOOKUP_MISS_BUDGET', DEFAULT_MISS_BUDGET)) {
        return await fail(new HermesError('rate_limited', { retryAfterSeconds: MISS_WINDOW_MS / 1000 }), 'rate_limited', {
          reason: 'miss_budget',
        });
      }

      try {
        if (request.method === 'POST') {
          if (!config.allowPostBody) throw new HermesError('validation_error', { details: { field: 'method', reason: 'post_not_supported' } });
          params = await readBodyParams(request);
        }
        assertAllowedParams(params, config.allowedParams);
      } catch (error) {
        if (error instanceof HermesError) return await fail(error, 'invalid');
        throw error;
      }

      const rawPathParams = (await routeContext?.params) ?? {};
      const pathParams = Object.fromEntries(
        Object.entries(rawPathParams).map(([key, value]) => [key, Array.isArray(value) ? value.join('/') : value])
      );

      let result: HandlerResult;
      try {
        result = await handle({
          requestId,
          request,
          params,
          pathParams,
          credential: { id: authed.id, name: authed.name, merchantId: authed.merchantId, scopes },
          fullPii: canSeeFullPii(scopes),
          store,
          now,
          actor,
        });
      } catch (error) {
        if (error instanceof HermesError) {
          return await fail(error, error.code === 'not_found' ? 'not_found' : error.code === 'validation_error' ? 'invalid' : 'error');
        }
        throw error;
      }

      const outcome = result.audit.outcome ?? 'success';
      // Fail closed: no data leaves without its audit row.
      await audit({
        outcome,
        httpStatus: 200,
        classification: result.audit.classification,
        targetType: result.audit.targetType ?? null,
        targetId: result.audit.targetId ?? null,
        resultCount: result.audit.resultCount ?? null,
      });

      if (!authed.lastUsedAt || now.getTime() - authed.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
        store.touchCredential(authed.id, now).catch((error) =>
          log.warn('hermes.touch_failed', { requestId, error: redactForLog(error) })
        );
      }

      log.info('hermes.request', {
        requestId,
        action: config.action,
        credentialId: authed.id,
        outcome,
        resultCount: result.audit.resultCount ?? null,
        durationMs: Math.round(performance.now() - started),
      });

      return successResponse(result.data, {
        request_id: requestId,
        generated_at: now.toISOString(),
        timezone: HERMES_DEFAULT_TIMEZONE,
        currency: null,
        ...result.meta,
      });
    } catch (error) {
      const failure = new HermesError(isTransientFailure(error) ? 'temporarily_unavailable' : 'internal_error');
      log.error('hermes.request_failed', {
        requestId,
        action: config.action,
        credentialId: credential?.id ?? null,
        error: redactForLog(error),
      });
      try {
        await audit({
          outcome: 'error',
          httpStatus: failure.status,
          classification: 'none',
          targetType: null,
          targetId: null,
          resultCount: null,
        });
      } catch (auditError) {
        log.error('hermes.audit_write_failed', { requestId, error: redactForLog(auditError) });
      }
      return errorResponse(failure, requestId, now);
    }
  };
}
