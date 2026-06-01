import { getShippingCompanyName } from '@/app/lib/shipping-company';
import { extractSallaTrackingNumber } from '@/app/lib/salla-shipment';
import { detectShipmentCompany, getAllCompanies, SHIPMENT_COMPANIES } from '@/lib/shipment-detector';

export const RETURN_CARRIER_FEES_SETTING_KEY = 'return_carrier_fees';

export interface CarrierFee {
  returnFee: number;
  exchangeFee: number;
}

export type CarrierFeeConfig = Record<string, CarrierFee>;

const CARRIER_ALIASES: Record<string, string[]> = {
  ajex: ['ajex', 'aj-ex', 'aj ex', 'ايجكس', 'أيجكس'],
  aramex: ['aramex', 'ارامكس', 'أرامكس'],
  dhl: ['dhl', 'دي اتش ال', 'دي إتش إل'],
  fedex: ['fedex', 'fed ex', 'فيديكس', 'فيدكس'],
  messenger: ['messenger', 'messenger courier', 'مندوب', 'مندوب توصيل', 'local'],
  naqel: ['naqel', 'ناقل'],
  noon: ['noon', 'نون'],
  redbox: ['redbox', 'red box', 'رد بوكس'],
  smsa: ['smsa', 'سمسا'],
  spl: ['spl', 'saudi post', 'البريد السعودي', 'الشركة السعودية للبريد'],
  ups: ['ups', 'يو بي اس'],
  zajil: ['zajil', 'زاجل'],
};

const normalizeCarrierText = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/[ة]/g, 'ه')
    .replace(/[^\p{L}\p{N}]+/gu, '');

const toFeeAmount = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

export const returnFeeCarriers = getAllCompanies();

export function normalizeCarrierFeeConfig(value: unknown): CarrierFeeConfig {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const config: CarrierFeeConfig = {};
  for (const company of returnFeeCarriers) {
    const entry = (value as Record<string, unknown>)[company.id];
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    config[company.id] = {
      returnFee: toFeeAmount((entry as Record<string, unknown>).returnFee),
      exchangeFee: toFeeAmount((entry as Record<string, unknown>).exchangeFee),
    };
  }

  return config;
}

export function parseCarrierFeeConfig(value?: string | null): CarrierFeeConfig {
  if (!value) {
    return {};
  }

  try {
    return normalizeCarrierFeeConfig(JSON.parse(value));
  } catch {
    return {};
  }
}

export function buildCarrierFeeConfig(
  current: CarrierFeeConfig,
  fallbackReturnFee = 0,
  fallbackExchangeFee = 0,
): CarrierFeeConfig {
  returnFeeCarriers.forEach((company) => {
    current[company.id] = {
      returnFee: toFeeAmount(current[company.id]?.returnFee ?? fallbackReturnFee),
      exchangeFee: toFeeAmount(current[company.id]?.exchangeFee ?? fallbackExchangeFee),
    };
  });

  return current;
}

export function findCarrierIdByName(name?: string | null): string | null {
  if (!name) {
    return null;
  }

  const normalizedName = normalizeCarrierText(name);
  if (!normalizedName) {
    return null;
  }

  for (const company of returnFeeCarriers) {
    const candidates = [
      company.id,
      company.nameAr,
      company.nameEn,
      ...(CARRIER_ALIASES[company.id] || []),
    ];

    if (
      candidates.some((candidate) => {
        const normalizedCandidate = normalizeCarrierText(candidate);
        return (
          normalizedCandidate &&
          (normalizedName === normalizedCandidate ||
            normalizedName.includes(normalizedCandidate) ||
            normalizedCandidate.includes(normalizedName))
        );
      })
    ) {
      return company.id;
    }
  }

  return null;
}

export function resolveReturnCarrierId(order: unknown): string | null {
  const carrierFromName = findCarrierIdByName(getShippingCompanyName(order));
  if (carrierFromName) {
    return carrierFromName;
  }

  const trackingNumber = extractSallaTrackingNumber(order as Record<string, unknown> | null | undefined);
  if (!trackingNumber) {
    return null;
  }

  const detected = detectShipmentCompany(trackingNumber);
  return detected.id === SHIPMENT_COMPANIES.unknown.id ? null : detected.id;
}

export function getCarrierFee(
  carrierFees: CarrierFeeConfig,
  carrierId: string | null,
  type: 'return' | 'exchange',
  fallbackFee = 0,
): number {
  if (!carrierId) {
    return toFeeAmount(fallbackFee);
  }

  const fee = type === 'exchange'
    ? carrierFees[carrierId]?.exchangeFee
    : carrierFees[carrierId]?.returnFee;

  return toFeeAmount(fee ?? fallbackFee);
}
