import { log } from './logger';

type SmsaEnvironment = 'production' | 'sandbox' | 'test';

const DEFAULT_ENVIRONMENT: SmsaEnvironment = 'sandbox';
const DEFAULT_BASE_URLS: Record<SmsaEnvironment, string> = {
  production: 'https://ecomapis.smsaexpress.com',
  sandbox: 'https://ecomapis-sandbox.azurewebsites.net',
  test: 'https://ecomapis-sandbox.azurewebsites.net',
};

const rawEnv = (process.env.SMSA_API_ENVIRONMENT ?? process.env.SMSA_ENVIRONMENT ?? DEFAULT_ENVIRONMENT).toLowerCase();
const resolvedEnv: SmsaEnvironment =
  rawEnv === 'production' ? 'production' : rawEnv === 'test' ? 'test' : 'sandbox';

const resolveBaseUrl = (): string => {
  const configuredBase = process.env.SMSA_API_BASE_URL ?? DEFAULT_BASE_URLS[resolvedEnv];
  const trimmed = configuredBase.replace(/\/$/, '');
  return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
};

const resolveApiKey = (): string => {
  if (process.env.SMSA_API_KEY) {
    return process.env.SMSA_API_KEY;
  }

  if (resolvedEnv === 'production' && process.env.SMSA_PRODUCTION_API_KEY) {
    return process.env.SMSA_PRODUCTION_API_KEY;
  }

  const sandboxKey = process.env.SMSA_TEST_API_KEY ?? process.env.SMSA_SANDBOX_API_KEY;
  if (sandboxKey) {
    return sandboxKey;
  }

  return '';
};

const SMSA_API_BASE_URL = resolveBaseUrl();
const SMSA_API_KEY = resolveApiKey();
const SMSA_SERVICE_CODE = process.env.SMSA_SERVICE_CODE ?? 'EDCR';
const SMSA_RETAIL_ID = process.env.SMSA_RETAIL_ID;
const SMSA_WAYBILL_TYPE = (process.env.SMSA_WAYBILL_TYPE as 'PDF' | 'ZPL') ?? 'PDF';

export interface ShipmentAddress {
  ContactName: string;
  ContactPhoneNumber: string;
  AddressLine1: string;
  City: string;
  Country: string;
  AddressLine2?: string;
  ContactPhoneNumber2?: string;
  Coordinates?: string;
  ConsigneeID?: string;
  District?: string;
  PostalCode?: string;
  ShortCode?: string;
}

export interface SMSAReturnRequest {
  OrderNumber: string;
  DeclaredValue: number;
  Parcels: number;
  ShipDate: string;
  ShipmentCurrency: string;
  Weight: number;
  WeightUnit: string;
  ContentDescription: string;
  PickupAddress: ShipmentAddress;
  ReturnToAddress: ShipmentAddress;
  CODAmount?: number;
  DutyPaid?: boolean;
  ServiceCode?: string;
  SMSARetailID?: string;
  VatPaid?: boolean;
  WaybillType?: 'PDF' | 'ZPL';
}

export interface SMSAShipmentResponse {
  success: boolean;
  sawb?: string;
  awbNumber?: string;
  trackingNumber?: string;
  error?: string;
  errorCode?: string;
  rawResponse?: any;
}

const buildSmsaUrl = (path: string): string => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${SMSA_API_BASE_URL}${normalizedPath}`;
};

/**
 * Creates a return shipment via SMSA API (C2B)
 */
export async function createSMSAReturnShipment(
  shipmentData: SMSAReturnRequest
): Promise<SMSAShipmentResponse> {
  if (!SMSA_API_KEY) {
    log.error('SMSA credentials not configured');
    return {
      success: false,
      error: 'SMSA API credentials not configured',
      errorCode: 'MISSING_CREDENTIALS',
    };
  }

  try {
    const payload: Record<string, any> = {
      ...shipmentData,
      WaybillType: shipmentData.WaybillType ?? SMSA_WAYBILL_TYPE,
    };

    if (!payload.ServiceCode && SMSA_SERVICE_CODE) {
      payload.ServiceCode = SMSA_SERVICE_CODE;
    }

    if (!payload.SMSARetailID && SMSA_RETAIL_ID) {
      payload.SMSARetailID = SMSA_RETAIL_ID;
    }

    log.info('Creating SMSA return shipment', {
      reference1: shipmentData.OrderNumber,
      env: resolvedEnv,
    });

    const response = await fetch(buildSmsaUrl('/c2b/new'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        apikey: SMSA_API_KEY,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error('SMSA API request failed', {
        status: response.status,
        error: errorText,
      });

      return {
        success: false,
        error: `SMSA API error: ${response.status}`,
        errorCode: 'API_ERROR',
        rawResponse: errorText,
      };
    }

    const data = await response.json();

    if (data.sawb) {
      log.info('SMSA return shipment created successfully', {
        sawb: data.sawb,
        reference: shipmentData.OrderNumber,
      });

      const awb = data.waybills?.[0]?.awb;

      return {
        success: true,
        sawb: data.sawb,
        awbNumber: awb,
        trackingNumber: awb,
        rawResponse: data,
      };
    }

    log.error('SMSA shipment creation failed', { response: data });

    return {
      success: false,
      error: data.error || data.message || 'Unknown error',
      errorCode: data.errorCode || 'SHIPMENT_FAILED',
      rawResponse: data,
    };
  } catch (error) {
    log.error('Error creating SMSA return shipment', { error });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      errorCode: 'EXCEPTION',
    };
  }
}

/**
 * Tracks a C2B (return) shipment by AWB number
 */
export async function trackC2BShipment(awbNumber: string): Promise<any> {
  if (!SMSA_API_KEY) {
    log.error('SMSA credentials not configured');
    return null;
  }

  try {
    const response = await fetch(buildSmsaUrl(`/c2b/query/${encodeURIComponent(awbNumber)}`), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        apikey: SMSA_API_KEY,
      },
    });

    if (!response.ok) {
      log.error('SMSA tracking request failed', { status: response.status, awbNumber });
      return null;
    }

    return await response.json();
  } catch (error) {
    log.error('Error tracking SMSA shipment', { awbNumber, error });
    return null;
  }
}

/**
 * Tracks a B2C shipment by AWB number
 */
export async function trackB2CShipment(awbNumber: string): Promise<any> {
  if (!SMSA_API_KEY) {
    log.error('SMSA credentials not configured');
    return null;
  }

  try {
    const response = await fetch(buildSmsaUrl(`/shipment/b2c/query/${encodeURIComponent(awbNumber)}`), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        apikey: SMSA_API_KEY,
      },
    });

    if (!response.ok) {
      log.error('SMSA tracking request failed', { status: response.status, awbNumber });
      return null;
    }

    return await response.json();
  } catch (error) {
    log.error('Error tracking SMSA shipment', { awbNumber, error });
    return null;
  }
}
