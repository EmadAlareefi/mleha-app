import { log } from './logger';

// SMSA API Configuration
const SMSA_API_BASE_URL = process.env.SMSA_API_BASE_URL || 'https://track.smsaexpress.com/api';
const SMSA_PASS_KEY = process.env.SMSA_PASS_KEY || '';
const SMSA_ACCOUNT_NUMBER = process.env.SMSA_ACCOUNT_NUMBER || '';

export interface SMSAShipmentRequest {
  // Sender (Merchant) Information
  senderName: string;
  senderPhone: string;
  senderAddress: string;
  senderCity: string;
  senderCountry?: string; // Default: SA

  // Receiver (Customer) Information
  receiverName: string;
  receiverPhone: string;
  receiverAddress: string;
  receiverCity: string;
  receiverCountry?: string; // Default: SA

  // Shipment Details
  shipmentType: 'DLV' | 'RET'; // DLV = Delivery, RET = Return
  numberOfPieces: number;
  weight: number; // in KG
  goodsDescription: string;
  reference1?: string; // Order reference
  reference2?: string; // Additional reference
  declaredValue?: number;
  codAmount?: number; // Cash on Delivery amount

  // Service options
  serviceType?: 'Express' | 'Standard';
}

export interface SMSAShipmentResponse {
  success: boolean;
  awbNumber?: string; // Airway Bill Number (tracking number)
  trackingNumber?: string;
  error?: string;
  errorCode?: string;
  rawResponse?: any;
}

/**
 * Creates a return shipment via SMSA API
 */
export async function createSMSAReturnShipment(
  shipmentData: SMSAShipmentRequest
): Promise<SMSAShipmentResponse> {
  if (!SMSA_PASS_KEY || !SMSA_ACCOUNT_NUMBER) {
    log.error('SMSA credentials not configured');
    return {
      success: false,
      error: 'SMSA API credentials not configured',
      errorCode: 'MISSING_CREDENTIALS'
    };
  }

  try {
    // SMSA API typically uses XML or JSON format
    // This is a generic implementation - adjust based on actual SMSA API documentation
    const payload = {
      passKey: SMSA_PASS_KEY,
      accountNumber: SMSA_ACCOUNT_NUMBER,
      shipmentType: shipmentData.shipmentType,

      // Sender details (for returns, this is the customer)
      consigneeName: shipmentData.receiverName,
      consigneePhone: shipmentData.receiverPhone,
      consigneeAddress: shipmentData.receiverAddress,
      consigneeCity: shipmentData.receiverCity,
      consigneeCountry: shipmentData.receiverCountry || 'SA',

      // Receiver details (for returns, this is the merchant)
      shipperName: shipmentData.senderName,
      shipperPhone: shipmentData.senderPhone,
      shipperAddress: shipmentData.senderAddress,
      shipperCity: shipmentData.senderCity,
      shipperCountry: shipmentData.senderCountry || 'SA',

      // Shipment info
      numberOfPieces: shipmentData.numberOfPieces,
      weight: shipmentData.weight,
      goodsDescription: shipmentData.goodsDescription,
      reference1: shipmentData.reference1 || '',
      reference2: shipmentData.reference2 || '',
      declaredValue: shipmentData.declaredValue || 0,
      codAmount: shipmentData.codAmount || 0,
      serviceType: shipmentData.serviceType || 'Standard',
    };

    log.info('Creating SMSA return shipment', {
      reference1: shipmentData.reference1,
      receiverName: shipmentData.receiverName
    });

    const response = await fetch(`${SMSA_API_BASE_URL}/shipments/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error('SMSA API request failed', {
        status: response.status,
        error: errorText
      });

      return {
        success: false,
        error: `SMSA API error: ${response.status}`,
        errorCode: 'API_ERROR',
        rawResponse: errorText
      };
    }

    const data = await response.json();

    // Parse SMSA response (adjust based on actual API response structure)
    if (data.success || data.AWBNumber || data.awbNumber) {
      const awbNumber = data.AWBNumber || data.awbNumber || data.trackingNumber;

      log.info('SMSA return shipment created successfully', {
        awbNumber,
        reference: shipmentData.reference1
      });

      return {
        success: true,
        awbNumber,
        trackingNumber: awbNumber,
        rawResponse: data
      };
    } else {
      log.error('SMSA shipment creation failed', { response: data });

      return {
        success: false,
        error: data.error || data.message || 'Unknown error',
        errorCode: data.errorCode || 'SHIPMENT_FAILED',
        rawResponse: data
      };
    }

  } catch (error) {
    log.error('Error creating SMSA return shipment', { error });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      errorCode: 'EXCEPTION'
    };
  }
}

/**
 * Tracks a shipment by AWB number
 */
export async function trackSMSAShipment(awbNumber: string): Promise<any> {
  if (!SMSA_PASS_KEY || !SMSA_ACCOUNT_NUMBER) {
    log.error('SMSA credentials not configured');
    return null;
  }

  try {
    const response = await fetch(
      `${SMSA_API_BASE_URL}/track?passKey=${SMSA_PASS_KEY}&awbNumber=${awbNumber}`,
      {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      }
    );

    if (!response.ok) {
      log.error('SMSA tracking request failed', { status: response.status, awbNumber });
      return null;
    }

    const data = await response.json();
    return data;

  } catch (error) {
    log.error('Error tracking SMSA shipment', { awbNumber, error });
    return null;
  }
}

/**
 * Validates SMSA credentials by making a test API call
 */
export async function validateSMSACredentials(): Promise<boolean> {
  if (!SMSA_PASS_KEY || !SMSA_ACCOUNT_NUMBER) {
    return false;
  }

  try {
    // Make a simple API call to validate credentials
    const response = await fetch(
      `${SMSA_API_BASE_URL}/validate?passKey=${SMSA_PASS_KEY}&accountNumber=${SMSA_ACCOUNT_NUMBER}`,
      {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      }
    );

    return response.ok;
  } catch (error) {
    log.error('Error validating SMSA credentials', { error });
    return false;
  }
}

/**
 * Estimates shipping cost (if supported by SMSA API)
 */
export async function estimateSMSAShippingCost(
  fromCity: string,
  toCity: string,
  weight: number
): Promise<number | null> {
  if (!SMSA_PASS_KEY || !SMSA_ACCOUNT_NUMBER) {
    return null;
  }

  try {
    const response = await fetch(
      `${SMSA_API_BASE_URL}/estimate?passKey=${SMSA_PASS_KEY}&from=${fromCity}&to=${toCity}&weight=${weight}`,
      {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      }
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data.cost || data.price || null;

  } catch (error) {
    log.error('Error estimating SMSA shipping cost', { error });
    return null;
  }
}
