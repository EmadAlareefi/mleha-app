import { log } from './logger';

/**
 * Client for the AJEX middleware API (https://files.aj-ex.com/AJEX_API_Documentation.pdf).
 *
 * Environment:
 *   AJEX_API_ENVIRONMENT   sandbox | production (default sandbox)
 *   AJEX_API_BASE_URL      optional override of the environment's base URL
 *   AJEX_CLIENT_ID / AJEX_CLIENT_SECRET / AJEX_CUSTOMER_ACCOUNT
 */

const BASE_URLS = {
  sandbox: 'https://api-aone-mw-stage.aj-ex.com',
  production: 'https://api-aone-mw.aj-ex.com',
} as const;

const REQUEST_TIMEOUT_MS = 30_000;
// Refresh a little before AJEX expires the token so an in-flight call never
// carries a token that dies mid-request.
const TOKEN_EXPIRY_MARGIN_MS = 5 * 60 * 1000;

export interface AjexConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  customerAccount: string;
}

export interface AjexAddress {
  name: string;
  phone: string;
  alternatePhone?: string;
  country: string;
  countryCode?: string;
  city: string;
  cityCode?: string;
  region: string;
  regionCode?: string;
  district: string;
  districtCode?: string;
  postalCode?: string;
  addressLine1: string;
  addressLine2?: string;
  longitude?: number;
  latitude?: number;
  email?: string;
  shortAddress?: string;
  addressType?: 'CUSTOMER_MAPPINGS' | 'FREE_TEXT';
}

export interface AjexPackage {
  sequence: number;
  weight: number;
  weightUnit: 'KG';
  dimensionUnit?: 'CM';
  height?: number;
  width?: number;
  length?: number;
  referenceNumber?: string;
}

export interface AjexItem {
  description: string;
  quantity: number;
  unitPrice: number;
  currency: string;
  sku?: string;
  hsCode?: string;
  countryOfOrigin?: string;
  packageSequence: number;
  imageUrl?: string;
  color?: string;
  size?: string;
}

export interface AjexCreateOrderRequest {
  referenceNumber: string;
  customerAccount: string;
  productCode: string;
  contentType: 'DOCUMENT' | 'NON_DOCUMENT';
  pickupMethod?: 'DROP_OFF' | 'COURIER_PICKUP' | 'FULFILLMENT';
  declaredValue?: number;
  declaredValueCurrency?: string;
  cod?: boolean;
  codAmount?: number;
  incoterms?: 'DDP' | 'DDU';
  insured?: boolean;
  labelFormat?: string;
  pickupAddress: AjexAddress;
  deliveryAddress: AjexAddress;
  packages: AjexPackage[];
  items: AjexItem[];
  customFields?: Record<string, string>;
}

export interface AjexCreateOrderData {
  referenceNumber: string;
  trackingId: string;
  waybillFileUrl: string | null;
  destinationZoneCode?: string | null;
  destinationHubCode?: string | null;
}

/** Standard AJEX envelope (section 7 of the API document). */
export interface AjexResponse<T> {
  code: number;
  status: 'SUCCESS' | 'ERROR' | 'BAD_REQUEST' | string;
  msg?: string;
  data?: T;
  transactionId?: string;
  timestamp?: string;
}

export type AjexResult<T> =
  | { success: true; data: T; raw: AjexResponse<T> }
  | { success: false; error: string; status: number; raw: unknown };

export class AjexConfigError extends Error {}

export function getAjexConfig(): AjexConfig | null {
  const clientId = process.env.AJEX_CLIENT_ID?.trim();
  const clientSecret = process.env.AJEX_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;

  const environment =
    process.env.AJEX_API_ENVIRONMENT?.trim().toLowerCase() === 'production' ? 'production' : 'sandbox';
  const baseUrl = (process.env.AJEX_API_BASE_URL?.trim() || BASE_URLS[environment]).replace(/\/+$/, '');

  return {
    baseUrl,
    clientId,
    clientSecret,
    customerAccount: process.env.AJEX_CUSTOMER_ACCOUNT?.trim() || clientId,
  };
}

export const isAjexConfigured = () => getAjexConfig() !== null;

function requireConfig(): AjexConfig {
  const config = getAjexConfig();
  if (!config) {
    throw new AjexConfigError('AJEX_CLIENT_ID and AJEX_CLIENT_SECRET must be set');
  }
  return config;
}

let cachedToken: { key: string; token: string; expiresAt: number } | null = null;

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Turns an AJEX error envelope into one readable line. Validation errors carry
 * a `data` array of `{ field, message }` that is far more useful than `msg`.
 */
export function describeAjexError(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') {
    return typeof body === 'string' && body.trim() ? body.trim().slice(0, 500) : fallback;
  }
  const envelope = body as { msg?: unknown; message?: unknown; data?: unknown };
  const base =
    (typeof envelope.msg === 'string' && envelope.msg) ||
    (typeof envelope.message === 'string' && envelope.message) ||
    fallback;
  if (Array.isArray(envelope.data)) {
    const details = envelope.data
      .map((entry) =>
        entry && typeof entry === 'object'
          ? [entry.field, entry.message].filter(Boolean).join(': ')
          : String(entry),
      )
      .filter(Boolean);
    if (details.length > 0) return `${base} (${details.join('; ')})`;
  }
  return base;
}

export async function getAjexAccessToken(forceRefresh = false): Promise<string> {
  const config = requireConfig();
  const key = `${config.baseUrl}|${config.clientId}`;

  if (!forceRefresh && cachedToken && cachedToken.key === key && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }

  const response = await fetchWithTimeout(`${config.baseUrl}/auth/api/v1/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: config.clientId, clientSecret: config.clientSecret }),
  });
  const body = (await parseBody(response)) as Record<string, unknown> | null;
  // The token endpoint answers with the bare OAuth payload, though it may be
  // wrapped in the standard envelope on some gateways.
  const payload = (body?.data && typeof body.data === 'object' ? body.data : body) as
    | Record<string, unknown>
    | null;
  const token = typeof payload?.access_token === 'string' ? payload.access_token : null;

  if (!response.ok || !token) {
    throw new Error(`AJEX authentication failed: ${describeAjexError(body, `HTTP ${response.status}`)}`);
  }

  const expiresInSeconds = Number(payload?.expires_in) || 3600;
  cachedToken = {
    key,
    token,
    expiresAt: Date.now() + Math.max(expiresInSeconds * 1000 - TOKEN_EXPIRY_MARGIN_MS, 60_000),
  };
  return token;
}

async function authorizedRequest(path: string, init: RequestInit): Promise<Response> {
  const config = requireConfig();
  const send = async (token: string) =>
    fetchWithTimeout(`${config.baseUrl}${path}`, {
      ...init,
      headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
    });

  let response = await send(await getAjexAccessToken());
  // A token revoked or expired early on AJEX's side: fetch a fresh one once.
  if (response.status === 401) {
    response = await send(await getAjexAccessToken(true));
  }
  return response;
}

async function jsonRequest<T>(path: string, init: RequestInit): Promise<AjexResult<T>> {
  const response = await authorizedRequest(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const body = (await parseBody(response)) as AjexResponse<T> | null;

  const ok =
    response.ok &&
    body !== null &&
    typeof body === 'object' &&
    (body.status === undefined || String(body.status).toUpperCase() === 'SUCCESS') &&
    (body.code === undefined || Number(body.code) === 200);

  if (!ok) {
    return {
      success: false,
      error: describeAjexError(body, `HTTP ${response.status}`),
      status: typeof body?.code === 'number' ? body.code : response.status,
      raw: body,
    };
  }

  return { success: true, data: body.data as T, raw: body };
}

/** Section 2: create order. Returns the waybill (trackingId) and label URL. */
export async function createAjexOrder(
  request: Omit<AjexCreateOrderRequest, 'customerAccount'> & { customerAccount?: string },
): Promise<AjexResult<AjexCreateOrderData>> {
  const config = requireConfig();
  const payload: AjexCreateOrderRequest = {
    ...request,
    customerAccount: request.customerAccount || config.customerAccount,
  };

  const result = await jsonRequest<AjexCreateOrderData>('/mwo/api/v1/orders', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  if (result.success && !result.data?.trackingId) {
    return {
      success: false,
      error: 'AJEX did not return a tracking number',
      status: 502,
      raw: result.raw,
    };
  }

  if (!result.success) {
    log.warn('AJEX create order failed', {
      referenceNumber: payload.referenceNumber,
      status: result.status,
      error: result.error,
    });
  }

  return result;
}

/** Section 3: waybill PDF for a tracking id. */
export async function fetchAjexLabel(
  trackingId: string,
): Promise<{ success: true; pdf: Buffer } | { success: false; error: string; status: number }> {
  const response = await authorizedRequest(
    `/mwo/api/v1/print/${encodeURIComponent(trackingId)}`,
    { method: 'GET' },
  );

  const contentType = response.headers.get('content-type') || '';
  if (response.ok && !contentType.includes('json')) {
    return { success: true, pdf: Buffer.from(await response.arrayBuffer()) };
  }

  const body = await parseBody(response);
  return {
    success: false,
    error: describeAjexError(body, `HTTP ${response.status}`),
    status: response.ok ? 502 : response.status,
  };
}

/** Section 4: current status and event history. */
export async function trackAjexShipment(trackingId: string) {
  return jsonRequest<Record<string, unknown>>(
    `/mwt/api/v1/tracking/${encodeURIComponent(trackingId)}`,
    { method: 'GET' },
  );
}

/** Section 6: cancel one or more shipments. */
export async function cancelAjexShipments(trackingIds: string[]) {
  return jsonRequest<unknown>('/mwo/api/v1/orders/cancel', {
    method: 'POST',
    body: JSON.stringify({ trackingIds }),
  });
}
