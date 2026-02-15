/**
 * Detects shipping company based on tracking number format
 */

export interface ShipmentCompany {
  id: string;
  nameAr: string;
  nameEn: string;
  color: string;
}

export const SHIPMENT_COMPANIES: Record<string, ShipmentCompany> = {
  messenger: {
    id: 'messenger',
    nameAr: 'مندوب توصيل',
    nameEn: 'Messenger Courier',
    color: '#9333ea',
  },
  aramex: {
    id: 'aramex',
    nameAr: 'ارامكس',
    nameEn: 'Aramex',
    color: '#e31837',
  },
  smsa: {
    id: 'smsa',
    nameAr: 'سمسا',
    nameEn: 'SMSA',
    color: '#0066cc',
  },
  dhl: {
    id: 'dhl',
    nameAr: 'دي اتش ال',
    nameEn: 'DHL',
    color: '#ffcc00',
  },
  fedex: {
    id: 'fedex',
    nameAr: 'فيديكس',
    nameEn: 'FedEx',
    color: '#4d148c',
  },
  ups: {
    id: 'ups',
    nameAr: 'يو بي اس',
    nameEn: 'UPS',
    color: '#351c15',
  },
  noon: {
    id: 'noon',
    nameAr: 'نون',
    nameEn: 'Noon',
    color: '#feee00',
  },
  zajil: {
    id: 'zajil',
    nameAr: 'زاجل',
    nameEn: 'Zajil',
    color: '#00a651',
  },
  spl: {
    id: 'spl',
    nameAr: 'الشركة السعودية للبريد',
    nameEn: 'Saudi Post (SPL)',
    color: '#006341',
  },
  naqel: {
    id: 'naqel',
    nameAr: 'ناقل',
    nameEn: 'Naqel',
    color: '#ff6b35',
  },
  ajex: {
    id: 'ajex',
    nameAr: 'ايجكس',
    nameEn: 'Ajex',
    color: '#ff6600',
  },
  unknown: {
    id: 'unknown',
    nameAr: 'غير معروف',
    nameEn: 'Unknown',
    color: '#6b7280',
  },
};

const ORDER_NUMBER_REGEX = /^#?\d{6,9}$/;
const ORDER_NUMBER_WITH_PREFIX_REGEX = /^#?ORD[-_\s]?\d{3,}$/i;

function isLikelyOrderNumber(trackingNumber: string): boolean {
  const cleaned = trackingNumber.trim();
  if (!cleaned) {
    return false;
  }
  if (ORDER_NUMBER_WITH_PREFIX_REGEX.test(cleaned)) {
    return true;
  }
  return ORDER_NUMBER_REGEX.test(cleaned);
}

/**
 * Detects the shipping company based on tracking number pattern
 */
export function detectShipmentCompany(trackingNumber: string): ShipmentCompany {
  const cleaned = trackingNumber.trim().toUpperCase();

  if (isLikelyOrderNumber(trackingNumber)) {
    return SHIPMENT_COMPANIES.messenger;
  }

  // Ajex: Starts with "AJEX" followed by numbers
  // Pattern: AJEX123456789
  if (cleaned.startsWith('AJ') && /^AJ[A-Z0-9]+$/.test(cleaned)) {
    return SHIPMENT_COMPANIES.ajex;
  }

  // UPS: Starts with "1Z" followed by 16 characters - Check first (most specific)
  // Pattern: 1Z999AA10123456784
  if (cleaned.startsWith('1Z') && cleaned.length === 18) {
    return SHIPMENT_COMPANIES.ups;
  }

  // Saudi Post (SPL): Starts with "RP", "RR", "CP", "EE", "EA" or similar international codes
  // or 13 digits starting with 92
  // Pattern: RR123456789SA or 9212345678901
  if (/^(RP|RR|CP|EE|EA|LC|LX|RG|RA)\d{9}SA$/.test(cleaned) || /^92\d{11}$/.test(cleaned)) {
    return SHIPMENT_COMPANIES.spl;
  }

  // Noon: Usually contains "NOON" or specific patterns
  if (cleaned.includes('NOON') || cleaned.startsWith('NO')) {
    return SHIPMENT_COMPANIES.noon;
  }

  // Zajil: Usually starts with "ZE" or contains "ZAJIL"
  if (cleaned.startsWith('ZE') || cleaned.includes('ZAJIL')) {
    return SHIPMENT_COMPANIES.zajil;
  }

  // Naqel: Usually contains "NAQ" or specific patterns
  if (cleaned.includes('NAQ') || cleaned.startsWith('NQ')) {
    return SHIPMENT_COMPANIES.naqel;
  }

  // SMSA: 12 digits starting with 23, 29, 30, or contains "SMSA"
  // Pattern: 231234567890, 291536303713, 300123456789
  // Some older accounts also issue 12-digit numbers starting with 4
  if (cleaned.startsWith('SMSA') || /^(23|29|30)\d{10}$/.test(cleaned) || /^4\d{11}$/.test(cleaned)) {
    return SHIPMENT_COMPANIES.smsa;
  }

  // FedEx: Exactly 12 or 15 digits (but not SMSA patterns)
  // Pattern: 123456789012 (12 digits) or 123456789012345 (15 digits)
  if ((/^\d{12}$/.test(cleaned) && !cleaned.startsWith('29') && !cleaned.startsWith('30')) || /^\d{15}$/.test(cleaned)) {
    return SHIPMENT_COMPANIES.fedex;
  }

  // Aramex: 11 digits starting with 5, or 13-14 digits
  // Pattern: 50589568724
  if (/^5\d{10}$/.test(cleaned) || /^\d{13,14}$/.test(cleaned)) {
    return SHIPMENT_COMPANIES.aramex;
  }

  // DHL: 10 digits starting with 5, 1, or 9
  // Pattern: 5871268233
  if (/^[159]\d{9}$/.test(cleaned)) {
    return SHIPMENT_COMPANIES.dhl;
  }

  // Default to unknown
  return SHIPMENT_COMPANIES.unknown;
}

/**
 * Validates if a tracking number is valid (basic check)
 */
export function isValidTrackingNumber(trackingNumber: string): boolean {
  const cleaned = trackingNumber.trim();
  // Must be at least 8 characters and contain some alphanumeric characters
  return cleaned.length >= 8 && /[a-zA-Z0-9]/.test(cleaned);
}

/**
 * Gets all available companies for filtering/selection
 */
export function getAllCompanies(): ShipmentCompany[] {
  return Object.values(SHIPMENT_COMPANIES).filter(c => c.id !== 'unknown');
}
