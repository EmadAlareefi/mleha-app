import { fetch as upstreamFetch } from 'undici';
import { prisma } from '@/lib/prisma';
import { getSallaAccessToken, getSallaDispatcher } from '@/app/lib/salla-oauth';
import type { HermesContext, HandlerResult } from './handler';
import { HermesError, validationError } from './http';

// Exact operation templates, never caller-supplied URLs or HTTP methods.
export const SALLA_OPERATIONS = [
  ...['products', 'customers', 'orders', 'categories', 'brands', 'branches'].flatMap(resource => [
    { name: `${resource}.list`, method: 'GET', path: `/${resource}`, scope: `${resource}.read` },
    { name: `${resource}.get`, method: 'GET', path: `/${resource}/{id}`, scope: `${resource}.read` },
    { name: `${resource}.update`, method: 'PUT', path: `/${resource}/{id}`, scope: `${resource}.read_write` },
  ]),
  { name: 'products.create', method: 'POST', path: '/products', scope: 'products.read_write' },
  { name: 'products.delete', method: 'DELETE', path: '/products/{id}', scope: 'products.read_write' },
  { name: 'products.status', method: 'POST', path: '/products/{id}/status', scope: 'products.read_write' },
  { name: 'variants.update', method: 'PUT', path: '/products/variants/{id}', scope: 'products.read_write' },
  { name: 'orders.statuses', method: 'GET', path: '/orders/statuses', scope: 'orders.read' },
  { name: 'orders.status', method: 'POST', path: '/orders/{id}/status', scope: 'orders.read_write' },
  { name: 'orders.items', method: 'GET', path: '/orders/{id}/items', scope: 'orders.read' },
  { name: 'orders.shipments', method: 'GET', path: '/orders/{id}/shipments', scope: 'orders.read' },
  { name: 'customers.create', method: 'POST', path: '/customers', scope: 'customers.read_write' },
  { name: 'categories.create', method: 'POST', path: '/categories', scope: 'categories.read_write' },
  { name: 'brands.create', method: 'POST', path: '/brands', scope: 'brands.read_write' },
] as const;

export interface SallaBridgeDependencies {
  scopes(merchantId: string): Promise<string[]>;
  request(merchantId: string, path: string, method: string, body?: string): Promise<{ status: number; body: unknown }>;
}
const production: SallaBridgeDependencies = {
  async scopes(merchantId) {
    const auth = await prisma.sallaAuth.findUnique({ where: { merchantId }, select: { scope: true } });
    return (auth?.scope ?? '').split(/\s+/).filter(Boolean);
  },
  async request(merchantId, path, method, body) {
    const token = await getSallaAccessToken(merchantId);
    if (!token) throw new HermesError('temporarily_unavailable');
    const response = await upstreamFetch(`https://api.salla.dev/admin/v2${path}`, {
      method, body, redirect: 'error', signal: AbortSignal.timeout(20000),
      dispatcher: getSallaDispatcher() ?? undefined,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    });
    // Do not log upstream bodies, request payloads, or query strings.
    const text = await response.text();
    if (text.length > 4_000_000) throw new HermesError('temporarily_unavailable');
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* Non-JSON upstream error. */ }
    return { status: response.status, body: data };
  },
};
let dependencies = production;
export function setSallaBridgeDependencies(value: SallaBridgeDependencies | null) {
  dependencies = value ?? production;
}
function granted(scopes: string[], required: string) {
  return scopes.includes(required) || (required.endsWith('.read') && scopes.includes(`${required}_write`));
}
function requirePii(ctx: HermesContext) {
  if (!ctx.fullPii) throw new HermesError('forbidden', { details: { required_scope: 'hermes:manager:pii' } });
}
function objectParam(value: string | null, field: string): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch { /* Report only the field, not its contents. */ }
  throw validationError(field, 'must_be_json_object');
}
// Live data is privileged (PII scope required); credentials and payment secrets
// must still never cross this bridge, including in nested response objects.
export function scrubSalla(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubSalla);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) =>
    !/token|secret|password|authorization|api.?key|cookie|card|iban|bank_account|payment_actions|payment_methods/i.test(key)
  ).map(([key, item]) => [key, scrubSalla(item)]));
}
export async function sallaCapabilities(ctx: HermesContext): Promise<HandlerResult> {
  requirePii(ctx);
  const scopes = await dependencies.scopes(ctx.credential.merchantId);
  return {
    data: { source: 'salla_live', granted_scopes: scopes, operations: SALLA_OPERATIONS.map(op => ({
      ...op, available: granted(scopes, op.scope) && (op.method === 'GET' || ctx.credential.scopes.includes('hermes:salla:write')),
    })) }, audit: { classification: 'operational' },
  };
}
export function sallaOperation(write: boolean) {
  return async (ctx: HermesContext): Promise<HandlerResult> => {
    requirePii(ctx);
    const operation = SALLA_OPERATIONS.find(op => op.name === ctx.params.get('operation'));
    if (!operation || (operation.method !== 'GET') !== write) throw validationError('operation', 'unsupported_operation');
    const id = ctx.params.get('id');
    if (operation.path.includes('{id}') ? !id || !/^[1-9]\d{0,19}$/.test(id) : id !== null) {
      throw validationError('id', 'provide_numeric_salla_id_only_when_required');
    }
    const scopes = await dependencies.scopes(ctx.credential.merchantId);
    if (!granted(scopes, operation.scope)) throw new HermesError('forbidden', { details: { required_salla_scope: operation.scope } });
    const query = objectParam(ctx.params.get('query_json'), 'query_json');
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (!/^[a-z_][a-z0-9_\[\]]{0,63}$/.test(key) || /token|secret|auth|method|merchant|store_id|^key$|^api_key$/i.test(key)
        || !['string', 'number', 'boolean'].includes(typeof value) || String(value).length > 500) {
        throw validationError('query_json', 'unsupported_parameter');
      }
      params.set(key, String(value));
    }
    for (const key of ['page', 'per_page']) {
      if (params.has(key) && (!/^[1-9]\d*$/.test(params.get(key)!) || Number(params.get(key)) > (key === 'page' ? 10000 : 100))) {
        throw validationError('query_json', 'pagination_out_of_range');
      }
    }
    if (operation.name.endsWith('.list') && !params.has('per_page')) params.set('per_page', '50');
    if (!write && ctx.params.has('payload_json')) throw validationError('payload_json', 'read_has_no_payload');
    const payload = write ? objectParam(ctx.params.get('payload_json'), 'payload_json') : undefined;
    if (payload && Object.keys(payload).some(key => /^(?:_method|method|access_token|authorization|merchant_id|store_id)$/i.test(key))) {
      throw validationError('payload_json', 'unsupported_parameter');
    }
    const path = operation.path.replace('{id}', id ?? '') + (params.size ? `?${params}` : '');
    if (write) {
      // Persist intent before any external effect. A later timeout/audit failure
      // cannot prove a mutation failed: clients must reconcile, never retry blindly.
      await ctx.store.writeAudit({
        requestId: ctx.requestId, credentialId: ctx.credential.id, merchantId: ctx.credential.merchantId,
        action: `salla.${operation.name}.attempt`, scopeUsed: 'hermes:salla:write', targetType: operation.name,
        targetId: id, outcome: 'success', httpStatus: 202, classification: 'operational', resultCount: null,
        durationMs: null, ipHash: null, actorId: ctx.actor.actorId, actorChannel: ctx.actor.channel, actorVerified: ctx.actor.verified,
      });
    }
    let response;
    try {
      response = await dependencies.request(ctx.credential.merchantId, path, operation.method, payload ? JSON.stringify(payload) : undefined);
    } catch {
      throw new HermesError('temporarily_unavailable', { details: { mutation_outcome: write ? 'unknown_do_not_retry' : 'not_applicable' } });
    }
    if (response.status >= 400) {
      const code = response.status === 403 ? 'forbidden' : response.status === 404 ? 'not_found'
        : response.status === 429 ? 'rate_limited' : response.status === 400 || response.status === 422 ? 'validation_error' : 'temporarily_unavailable';
      throw new HermesError(code, { details: { upstream_status: response.status, operation: operation.name,
        ...(write ? { mutation_outcome: 'verify_before_retry' } : {}) }, ...(code === 'rate_limited' ? { retryAfterSeconds: 60 } : {}) });
    }
    if (response.status !== 204 && (!response.body || typeof response.body !== 'object')) {
      throw new HermesError('temporarily_unavailable');
    }
    if (response.body && typeof response.body === 'object' && 'success' in response.body && response.body.success === false) {
      throw new HermesError('temporarily_unavailable', { details: { operation: operation.name, mutation_outcome: write ? 'verify_before_retry' : 'not_applicable' } });
    }
    return { data: scrubSalla(response.body), meta: { source: 'salla_live', operation: operation.name, upstream_status: response.status },
      audit: { targetType: operation.name, targetId: id, classification: 'pii:full' } };
  };
}
