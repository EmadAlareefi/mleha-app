import { log } from './logger';
import type { ShipmentAddress } from './smsa-api';
import { resolveAjexCity, resolveAjexLocation } from './ajex/address-mapper';

/**
 * AJEX AONE API client (API document v1.7, the same version as the tracking
 * callback in `ajex-webhook.ts`). Mirrors the integration that passed AJEX's
 * sandbox sign-off in alesaei-app.
 *
 *  - POST {mw}/auth/api/v1/token          { clientId, clientSecret } → { access_token, expires_in }  (no auth header)
 *  - POST {mw}/mwo/api/v1/orders          → { code: 200, status: "SUCCESS", data: { trackingId, waybillFileUrl } }
 *  - GET  {mw}/mwo/api/v1/print/{trackingId}   → PDF (or JSON with waybillFileUrl)
 *  - POST {mw}/mwo/api/v1/orders/cancel   { trackingIds: [...] }
 */

const readEnv = (key: string): string | undefined => {
  const value = process.env[key]?.trim();
  return value || undefined;
};

export type AjexEnvironment = 'sandbox' | 'production';

const HOSTS: Record<AjexEnvironment, string> = {
  sandbox: 'https://api-aone-mw-stage.aj-ex.com',
  production: 'https://api-aone-mw.aj-ex.com',
};

export interface AjexConfig {
  environment: AjexEnvironment;
  authUrl: string;
  orderUrl: string;
  printUrl: string;
  cancelUrl: string;
  clientId?: string;
  clientSecret?: string;
  customerAccount?: string;
  deliveryProductCode: string;
  returnProductCode: string;
}

export const readAjexConfig = (): AjexConfig => {
  const environment: AjexEnvironment =
    readEnv('AJEX_ENVIRONMENT')?.toLowerCase() === 'production' ? 'production' : 'sandbox';
  const host = HOSTS[environment];
  return {
    environment,
    authUrl: readEnv('AJEX_AUTH_URL') ?? `${host}/auth/api/v1/token`,
    orderUrl: readEnv('AJEX_ORDER_URL') ?? `${host}/mwo/api/v1/orders`,
    printUrl: readEnv('AJEX_PRINT_URL') ?? `${host}/mwo/api/v1/print/{trackingId}`,
    cancelUrl: readEnv('AJEX_CANCEL_URL') ?? `${host}/mwo/api/v1/orders/cancel`,
    clientId: readEnv('AJEX_CLIENT_ID'),
    clientSecret: readEnv('AJEX_CLIENT_SECRET'),
    customerAccount: readEnv('AJEX_CUSTOMER_ACCOUNT'),
    deliveryProductCode: readEnv('AJEX_PRODUCT_CODE') ?? 'AJEX DCE',
    returnProductCode: readEnv('AJEX_RETURN_PRODUCT_CODE') ?? 'AJEX RPU',
  };
};

export const isAjexConfigured = (config = readAjexConfig()) =>
  Boolean(config.clientId && config.clientSecret && config.customerAccount);

/** AJEX wants `+<country><number>`, e.g. `+9665xxxxxxxx`. */
export function toAjexPhone(value: string | undefined | null): string {
  const digits = String(value ?? '').replace(/[^\d]/g, '').replace(/^00/, '');
  if (!digits) return '';
  if (digits.startsWith('966')) return `+${digits}`;
  if (digits.startsWith('05') && digits.length === 10) return `+966${digits.slice(1)}`;
  if (digits.startsWith('5') && digits.length === 9) return `+966${digits}`;
  return `+${digits}`;
}

const parseCoordinates = (value?: string) => {
  const match = value?.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  return match ? { latitude: Number(match[1]), longitude: Number(match[2]) } : {};
};

/**
 * Maps an app address to an AJEX address. An exact city/district match is sent
 * as CUSTOMER_MAPPINGS with AJEX's codes; anything else goes as FREE_TEXT so a
 * customer's return is never blocked on our side (AJEX may still reject it).
 */
export function toAjexAddress(address: ShipmentAddress) {
  const phone = toAjexPhone(address.ContactPhoneNumber);
  const common = {
    name: address.ContactName,
    phone,
    alternatePhone: toAjexPhone(address.ContactPhoneNumber2) || phone,
    postalCode: address.PostalCode,
    addressLine1: address.AddressLine1,
    addressLine2: address.AddressLine2,
    shortAddress: address.ShortCode,
    ...parseCoordinates(address.Coordinates),
  };

  const exact = address.District ? resolveAjexLocation(address.City, address.District) : null;
  if (exact) return { ...common, ...exact, addressType: 'CUSTOMER_MAPPINGS' as const };

  const city = resolveAjexCity(address.City);
  return {
    ...common,
    country: 'Saudi Arabia',
    countryCode: 'SAU',
    region: city?.region ?? address.City,
    city: city?.city ?? address.City,
    cityCode: city?.cityCode,
    district: address.District || address.AddressLine2 || address.City,
    addressType: 'FREE_TEXT' as const,
  };
}

/** One product line on the shipment. */
export interface AjexOrderItem {
  description: string;
  quantity: number;
  unitPrice: number;
  sku?: string;
}

export interface AjexOrderInput {
  /** Unique per request, max 40 characters. */
  referenceNumber: string;
  productCode: string;
  pickup: ShipmentAddress;
  delivery: ShipmentAddress;
  pieces: number;
  weightKg: number;
  declaredValue: number;
  currency: string;
  description: string;
  /**
   * Product lines. When given, each becomes its own AJEX item and `pieces` is
   * their total quantity; otherwise one `description` line carries `pieces`.
   */
  items?: AjexOrderItem[];
  /** Cash on delivery amount, in `currency`. Omit or 0 for prepaid. */
  codAmount?: number;
}

const toAjexItems = (input: AjexOrderInput, pieces: number, declaredValue: number) => {
  const lines = (input.items ?? []).filter((item) => item.quantity >= 1);
  if (lines.length === 0) {
    return [
      {
        description: input.description,
        // AJEX's table types quantity as a string.
        quantity: String(pieces),
        unitPrice: Number((declaredValue / pieces).toFixed(2)),
        currency: input.currency,
        packageSequence: 1,
      },
    ];
  }
  return lines.map((item) => ({
    description: item.description.slice(0, 200),
    quantity: String(Math.round(item.quantity)),
    unitPrice: Math.max(0, Number(item.unitPrice.toFixed(2))),
    currency: input.currency,
    ...(item.sku ? { sku: item.sku } : {}),
    packageSequence: 1,
  }));
};

export function buildAjexOrderPayload(input: AjexOrderInput, config: AjexConfig = readAjexConfig()) {
  const itemPieces = (input.items ?? []).reduce((sum, item) => sum + Math.max(0, Math.round(item.quantity)), 0);
  const pieces = Math.max(1, itemPieces || Math.round(input.pieces));
  const codAmount = input.codAmount && input.codAmount > 0 ? Number(input.codAmount.toFixed(2)) : 0;
  const declaredValue = Math.max(0, Number(input.declaredValue.toFixed(2)));

  return {
    referenceNumber: input.referenceNumber.slice(0, 40),
    customerAccount: config.customerAccount ?? '',
    productCode: input.productCode,
    pickupMethod: 'COURIER_PICKUP',
    contentType: 'NON_DOCUMENT',
    declaredValue,
    declaredValueCurrency: input.currency,
    cod: codAmount > 0,
    codAmount,
    incoterms: 'DDP',
    insured: false,
    labelFormat: 'PDF',
    pickupAddress: toAjexAddress(input.pickup),
    deliveryAddress: toAjexAddress(input.delivery),
    packages: [
      {
        sequence: 1,
        weight: Math.max(0.5, Number(input.weightKg.toFixed(2))),
        weightUnit: 'KG',
      },
    ],
    items: toAjexItems(input, pieces, declaredValue),
  };
}

export interface AjexReturnShipmentInput {
  referenceId: string;
  orderNumber: string;
  pickup: ShipmentAddress;
  receiver: ShipmentAddress;
  pieces: number;
  weightKg: number;
  declaredValue: number;
  currency: string;
  description: string;
  items?: AjexOrderItem[];
}

/** A reverse pickup (AJEX RPU): AJEX collects from the customer and delivers to the warehouse. */
export const buildAjexReturnOrderPayload = (
  input: AjexReturnShipmentInput,
  config: AjexConfig = readAjexConfig(),
) =>
  buildAjexOrderPayload(
    {
      referenceNumber: input.referenceId,
      productCode: config.returnProductCode,
      pickup: input.pickup,
      delivery: input.receiver,
      pieces: input.pieces,
      weightKg: input.weightKg,
      declaredValue: input.declaredValue,
      currency: input.currency,
      description: input.description,
      items: input.items,
    },
    config,
  );

export type AjexOrderPayload = ReturnType<typeof buildAjexOrderPayload>;

export interface AjexShipmentResult {
  success: boolean;
  trackingNumber?: string;
  labelUrl?: string;
  error?: string;
  errorCode?: string;
  request?: unknown;
  rawResponse?: unknown;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

const text = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : typeof value === 'number' ? String(value) : undefined;

/** AJEX can answer HTTP 200 with a failure body, so success is `code 200` + `status SUCCESS`. */
const isAjexSuccess = (body: Record<string, unknown>) =>
  Number(body.code) === 200 && body.status === 'SUCCESS';

export function parseAjexCreateResponse(body: unknown): AjexShipmentResult {
  const record = asRecord(body);
  const data = asRecord(record.data);
  const trackingId = text(data.trackingId);

  if (!isAjexSuccess(record) || !trackingId) {
    return {
      success: false,
      error: text(record.msg) ?? text(record.message) ?? 'AJEX did not return a tracking id',
      errorCode: text(record.status) ?? text(record.code) ?? 'NO_TRACKING_ID',
      rawResponse: body,
    };
  }

  return { success: true, trackingNumber: trackingId, labelUrl: text(data.waybillFileUrl), rawResponse: body };
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAjexToken(config: AjexConfig, forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;

  // AJEX requires the token request to carry no Authorization header.
  const response = await fetch(config.authUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: config.clientId, clientSecret: config.clientSecret }),
  });
  const body = asRecord(await readBody(response));
  const token = text(body.access_token);
  if (!response.ok || !token) {
    throw new Error(`AJEX authentication failed (${response.status}${body.msg ? `: ${body.msg}` : ''})`);
  }

  const ttlSeconds = Number(body.expires_in) || 3600;
  cachedToken = { value: token, expiresAt: Date.now() + Math.max(1, ttlSeconds - 60) * 1000 };
  return token;
}

async function readBody(response: Response): Promise<unknown> {
  const body = await response.text();
  try {
    return JSON.parse(body);
  } catch {
    return { message: body.slice(0, 2000) };
  }
}

async function ajexFetch(config: AjexConfig, url: string, init: RequestInit): Promise<Response> {
  const send = async (forceRefresh: boolean) =>
    fetch(url, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers ?? {}),
        Authorization: `Bearer ${await getAjexToken(config, forceRefresh)}`,
      },
    });

  const response = await send(false);
  return response.status === 401 ? send(true) : response;
}

export async function createAjexOrder(payload: AjexOrderPayload): Promise<AjexShipmentResult> {
  const config = readAjexConfig();
  if (!isAjexConfigured(config)) {
    return { success: false, error: 'AJEX API credentials are not configured', errorCode: 'MISSING_CREDENTIALS' };
  }

  try {
    log.info('Creating AJEX order', { referenceNumber: payload.referenceNumber, productCode: payload.productCode });
    const response = await ajexFetch(config, config.orderUrl, { method: 'POST', body: JSON.stringify(payload) });
    const parsed = parseAjexCreateResponse(await readBody(response));
    if (!parsed.success) {
      log.error('AJEX order rejected', {
        referenceNumber: payload.referenceNumber,
        status: response.status,
        errorCode: parsed.errorCode,
        error: parsed.error,
      });
    }
    return { ...parsed, request: payload };
  } catch (error) {
    log.error('Error creating AJEX order', { referenceNumber: payload.referenceNumber, error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      errorCode: 'EXCEPTION',
      request: payload,
    };
  }
}

export const createAjexReturnShipment = (input: AjexReturnShipmentInput) =>
  createAjexOrder(buildAjexReturnOrderPayload(input));

const isPdf = (body: Buffer, contentType: string) =>
  contentType.toLowerCase().includes('application/pdf') || body.subarray(0, 4).toString() === '%PDF';

async function downloadPdf(url: string): Promise<Buffer | null> {
  const response = await fetch(url);
  const body = Buffer.from(await response.arrayBuffer());
  return response.ok && isPdf(body, response.headers.get('content-type') || '') ? body : null;
}

/**
 * The waybill PDF from the print endpoint, which returns either the PDF or JSON
 * holding `waybillFileUrl`. Falls back to the URL from the create-order response.
 */
export async function getAjexLabelPdf(trackingId: string, createOrderFileUrl?: string): Promise<Buffer | null> {
  const config = readAjexConfig();
  if (!isAjexConfigured(config)) return null;

  try {
    const url = config.printUrl.replace('{trackingId}', encodeURIComponent(trackingId));
    const response = await ajexFetch(config, url, {
      method: 'GET',
      headers: { Accept: 'application/pdf, application/json' },
    });
    const body = Buffer.from(await response.arrayBuffer());
    if (response.ok && isPdf(body, response.headers.get('content-type') || '')) return body;

    let fileUrl = createOrderFileUrl;
    try {
      const json = asRecord(JSON.parse(body.toString('utf8')));
      fileUrl = text(json.waybillFileUrl) ?? text(asRecord(json.data).waybillFileUrl) ?? fileUrl;
    } catch {
      // Not JSON; fall through to the create-order URL.
    }
    if (fileUrl) return await downloadPdf(fileUrl);

    log.error('AJEX print endpoint returned no PDF', { trackingId, status: response.status });
    return null;
  } catch (error) {
    log.error('AJEX waybill retrieval failed', { trackingId, error });
    return createOrderFileUrl ? downloadPdf(createOrderFileUrl).catch(() => null) : null;
  }
}

export async function cancelAjexShipment(
  trackingId: string,
): Promise<{ success: boolean; error?: string; rawResponse?: unknown }> {
  const config = readAjexConfig();
  if (!isAjexConfigured(config)) return { success: false, error: 'AJEX API credentials are not configured' };

  try {
    const response = await ajexFetch(config, config.cancelUrl, {
      method: 'POST',
      body: JSON.stringify({ trackingIds: [trackingId] }),
    });
    const body = asRecord(await readBody(response));
    if (!isAjexSuccess(body)) {
      return { success: false, error: text(body.msg) ?? `AJEX API error: ${response.status}`, rawResponse: body };
    }
    return { success: true, rawResponse: body };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
