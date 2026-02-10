import { log } from './logger';

type SmsaEnvironment = 'production' | 'sandbox' | 'test';

const DEFAULT_ENVIRONMENT: SmsaEnvironment = 'sandbox';
const DEFAULT_BASE_URLS: Record<SmsaEnvironment, string> = {
  production: 'https://ecomapis.smsaexpress.com',
  sandbox: 'https://ecomapis.smsaexpress.com',
  test: 'https://ecomapis.smsaexpress.com',
};

const rawEnvInput = (process.env.SMSA_API_ENVIRONMENT ?? process.env.SMSA_ENVIRONMENT ?? DEFAULT_ENVIRONMENT).toLowerCase();
const isCustomEnv = rawEnvInput === 'custom';
const resolvedEnv: SmsaEnvironment =
  rawEnvInput === 'production' ? 'production' : rawEnvInput === 'test' ? 'test' : 'sandbox';
const resolvedEnvLabel = isCustomEnv ? 'custom' : resolvedEnv;

const sanitizeBase = (value: string): string =>
  value.replace(/\/$/, '').replace(/\/api$/, '');

const resolveBaseUrl = (): string => {
  const configuredBase = process.env.SMSA_API_BASE_URL;
  const defaultBase = sanitizeBase(DEFAULT_BASE_URLS[resolvedEnv]);

  if (!configuredBase) {
    return defaultBase;
  }

  const sanitized = sanitizeBase(configuredBase);

  if (isCustomEnv) {
    if (!sanitized) {
      log.warn('SMSA_API_ENVIRONMENT set to custom but SMSA_API_BASE_URL is empty. Falling back to sandbox default.', {
        fallback: defaultBase,
      });
      return defaultBase;
    }
    return sanitized;
  }

  if (sanitized === defaultBase) {
    return sanitized;
  }

  log.warn('SMSA base URL override ignored because it does not match the selected environment', {
    selectedEnv: resolvedEnvLabel,
    configuredBase: sanitized,
    expectedBase: defaultBase,
  });

  return defaultBase;
};

const enforceBaseForEnv = (base: string): string => {
  if (isCustomEnv) {
    return base;
  }

  const defaultBase = sanitizeBase(DEFAULT_BASE_URLS[resolvedEnv]);

  const lowerBase = base.toLowerCase();

  if (resolvedEnv !== 'production' && lowerBase.includes('smsaexpress.com') && base !== defaultBase) {
    log.warn('SMSA base host looks like production while environment is set to sandbox/test. Forcing sandbox base URL.', {
      selectedEnv: resolvedEnvLabel,
      providedBase: base,
      forcedBase: defaultBase,
    });
    return defaultBase;
  }

  if (resolvedEnv === 'production' && lowerBase.includes('smsaexpress.com') === false) {
    log.warn('SMSA base host does not look like production even though environment is production. Using provided base but please verify.', {
      providedBase: base,
    });
  }

  return base;
};
const resolveApiKey = (): string => {
  if (process.env.SMSA_API_KEY) {
    return process.env.SMSA_API_KEY;
  }

  if (isCustomEnv) {
    log.warn('SMSA_API_ENVIRONMENT set to custom but SMSA_API_KEY is not provided');
    return '';
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

const SMSA_API_BASE_URL = enforceBaseForEnv(resolveBaseUrl());
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
  // Ensure the path starts with /api/ (all SMSA endpoints use /api prefix)
  const apiPath = normalizedPath.startsWith('/api/') ? normalizedPath : `/api${normalizedPath}`;
  return `${SMSA_API_BASE_URL}${apiPath}`;
};

/**
 * Creates a return shipment via SMSA API (C2B)
 */
export async function createSMSAReturnShipment(
  shipmentData: SMSAReturnRequest
): Promise<SMSAShipmentResponse> {
  if (!SMSA_API_KEY) {
    log.error('SMSA credentials not configured', {
      hasKey: !!process.env.SMSA_API_KEY,
      hasProdKey: !!process.env.SMSA_PRODUCTION_API_KEY,
      hasTestKey: !!process.env.SMSA_TEST_API_KEY,
      hasSandboxKey: !!process.env.SMSA_SANDBOX_API_KEY,
      env: resolvedEnvLabel,
    });
    return {
      success: false,
      error: 'SMSA API credentials not configured. Please check your environment variables.',
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

    const url = buildSmsaUrl('/c2b/new');

    log.info('Creating SMSA return shipment', {
      reference1: shipmentData.OrderNumber,
      env: resolvedEnvLabel,
      baseUrl: SMSA_API_BASE_URL,
      url,
      hasApiKey: !!SMSA_API_KEY,
      apiKeyLength: SMSA_API_KEY?.length || 0,
      apiKeyFirst4: SMSA_API_KEY?.substring(0, 4),
      payloadKeys: Object.keys(payload),
    });

    const response = await fetch(url, {
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
        statusText: response.statusText,
        error: errorText,
        env: resolvedEnvLabel,
        baseUrl: SMSA_API_BASE_URL,
      });

      // Provide more specific error messages
      let errorMessage = `SMSA API error: ${response.status}`;
      if (response.status === 401) {
        errorMessage = 'SMSA API authentication failed. Please verify your API key is correct for the environment.';
      } else if (response.status === 403) {
        errorMessage = 'SMSA API access forbidden. Your API key may not have the required permissions.';
      }

      return {
        success: false,
        error: errorMessage,
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
 * Cancels a C2B (return) shipment by AWB number
 */
export async function cancelC2BShipment(awbNumber: string): Promise<{
  success: boolean;
  message?: string;
  error?: string;
}> {
  if (!SMSA_API_KEY) {
    log.error('SMSA credentials not configured');
    return {
      success: false,
      error: 'SMSA API credentials not configured',
    };
  }

  try {
    log.info('Cancelling SMSA C2B shipment', { awbNumber });

    const response = await fetch(buildSmsaUrl(`/c2b/cancel/${encodeURIComponent(awbNumber)}`), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        ApiKey: SMSA_API_KEY,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error('SMSA cancel shipment request failed', { status: response.status, awbNumber, error: errorText });

      // Provide user-friendly error messages
      let errorMessage = `Failed to cancel shipment: ${response.status}`;
      if (response.status === 404) {
        errorMessage = 'Shipment not found or cannot be cancelled. It may have already been picked up or delivered.';
      } else if (errorText.includes('not found') || errorText.includes('No Shipment')) {
        errorMessage = 'Shipment not found in the system. Please verify the tracking number.';
      }

      return {
        success: false,
        error: errorMessage,
      };
    }

    const text = await response.text();
    log.info('SMSA shipment cancelled successfully', { awbNumber, response: text });

    return {
      success: true,
      message: text || 'Shipment cancelled successfully',
    };
  } catch (error) {
    log.error('Error cancelling SMSA shipment', { awbNumber, error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export interface SMSAB2CRequest {
  OrderNumber: string;
  DeclaredValue: number;
  Parcels: number;
  ShipDate: string;
  ShipmentCurrency: string;
  Weight: number;
  WeightUnit: string;
  ContentDescription: string;
  ConsigneeAddress: ShipmentAddress;
  ShipperAddress: ShipmentAddress;
  CODAmount?: number;
  DutyPaid?: boolean;
  ServiceCode?: string;
  SMSARetailID?: string;
  VatPaid?: boolean;
  WaybillType?: 'PDF' | 'ZPL';
}

/**
 * Creates a B2C (business to customer) shipment via SMSA API
 */
export async function createSMSAB2CShipment(
  shipmentData: SMSAB2CRequest
): Promise<SMSAShipmentResponse> {
  if (!SMSA_API_KEY) {
    log.error('SMSA credentials not configured', {
      hasKey: !!process.env.SMSA_API_KEY,
      hasProdKey: !!process.env.SMSA_PRODUCTION_API_KEY,
      hasTestKey: !!process.env.SMSA_TEST_API_KEY,
      hasSandboxKey: !!process.env.SMSA_SANDBOX_API_KEY,
      env: resolvedEnvLabel,
    });
    return {
      success: false,
      error: 'SMSA API credentials not configured. Please check your environment variables.',
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

    const url = buildSmsaUrl('/b2c/new');

    log.info('Creating SMSA B2C shipment', {
      reference: shipmentData.OrderNumber,
      env: resolvedEnvLabel,
      baseUrl: SMSA_API_BASE_URL,
      url,
      hasApiKey: !!SMSA_API_KEY,
    });

    const response = await fetch(url, {
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
      log.error('SMSA B2C API request failed', {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
        env: resolvedEnvLabel,
      });

      let errorMessage = `SMSA API error: ${response.status}`;
      if (response.status === 401) {
        errorMessage = 'SMSA API authentication failed. Please verify your API key.';
      } else if (response.status === 403) {
        errorMessage = 'SMSA API access forbidden. Check API key permissions.';
      }

      return {
        success: false,
        error: errorMessage,
        errorCode: 'API_ERROR',
        rawResponse: errorText,
      };
    }

    const data = await response.json();

    if (data.sawb) {
      log.info('SMSA B2C shipment created successfully', {
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

    log.error('SMSA B2C shipment creation failed', { response: data });

    return {
      success: false,
      error: data.error || data.message || 'Unknown error',
      errorCode: data.errorCode || 'SHIPMENT_FAILED',
      rawResponse: data,
    };
  } catch (error) {
    log.error('Error creating SMSA B2C shipment', { error });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      errorCode: 'EXCEPTION',
    };
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

export interface SMSATrackingScan {
  ScanType?: string;
  ScanDescription?: string;
  ScanDateTime?: string;
  ScanTimeZone?: string;
  City?: string;
  ReceivedBy?: string;
}

export interface SMSATrackingRecord {
  AWB?: string;
  awb?: string;
  Reference?: string;
  Scans?: SMSATrackingScan[];
  isDelivered?: boolean;
  RecipientName?: string;
  OriginCity?: string;
  OriginCountry?: string;
  DesinationCity?: string;
  DesinationCountry?: string;
  [key: string]: unknown;
}

const SMSA_TRACK_BULK_CHUNK_SIZE = 20;

export async function trackBulkShipments(awbNumbers: string[]): Promise<SMSATrackingRecord[]> {
  if (!SMSA_API_KEY) {
    log.error('SMSA credentials not configured');
    return [];
  }

  const normalized = Array.from(
    new Set(
      awbNumbers
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter((value): value is string => value.length > 0)
    )
  );

  if (normalized.length === 0) {
    return [];
  }

  const results: SMSATrackingRecord[] = [];

  for (let i = 0; i < normalized.length; i += SMSA_TRACK_BULK_CHUNK_SIZE) {
    const chunk = normalized.slice(i, i + SMSA_TRACK_BULK_CHUNK_SIZE);

    try {
      const response = await fetch(buildSmsaUrl('/track/bulk'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          apikey: SMSA_API_KEY,
        },
        body: JSON.stringify(chunk),
      });

      if (!response.ok) {
        const errorText = await response.text();
        log.error('SMSA bulk tracking request failed', {
          status: response.status,
          chunkSize: chunk.length,
          error: errorText,
        });
        continue;
      }

      const payload = await response.json();
      const entries = Array.isArray(payload) ? payload : payload ? [payload] : [];

      for (const record of entries) {
        if (record && typeof record === 'object') {
          results.push(record as SMSATrackingRecord);
        }
      }
    } catch (error) {
      log.error('Error performing SMSA bulk tracking request', { error, chunkSize: chunk.length });
    }
  }

  return results;
}
