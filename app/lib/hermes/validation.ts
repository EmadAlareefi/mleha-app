import { normalizeOrderReference } from '@/app/lib/salla-order-reference';
import { normalizeE164Phone } from '@/app/lib/phone';
import { validationError, HERMES_DEFAULT_TIMEZONE } from './http';
import { addDays, addYears, daysInclusive, isValidTimeZone, parseIsoDate } from './time';

/**
 * Request validation for the Hermes API. Every endpoint declares the exact
 * parameters it accepts; anything else is rejected so typos and smuggled
 * parameters (e.g. `role=manager`, `api_key=...`) fail loudly instead of
 * being silently ignored.
 */

export const MAX_PAGE_SIZE = 50;
export const DEFAULT_PAGE_SIZE = 10;
export const MAX_REPORT_RANGE_DAYS = 92;
export const MAX_REPORT_PAGE_SIZE = 100;
const MAX_PARAM_LENGTH = 200;
const MAX_FILTER_VALUES = 10;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TRACKING_PATTERN = /^[A-Za-z0-9-]{4,40}$/;
const CUSTOMER_ID_PATTERN = /^\d{1,20}$/;
const FILTER_VALUE_PATTERN = /^[\p{L}\p{N} _.\-]{1,64}$/u;

export function assertAllowedParams(params: URLSearchParams, allowed: readonly string[]): void {
  for (const key of new Set(params.keys())) {
    if (!allowed.includes(key)) {
      throw validationError(key, 'unsupported_parameter');
    }
    const values = params.getAll(key);
    if (values.length > 1) throw validationError(key, 'repeated_parameter');
    if (values[0].length > MAX_PARAM_LENGTH) throw validationError(key, 'too_long');
  }
}

function optional(params: URLSearchParams, key: string): string | null {
  const value = params.get(key)?.trim();
  return value ? value : null;
}

export function parseOrderReference(value: string | null, field = 'order_number'): string | null {
  if (value === null) return null;
  const normalized = normalizeOrderReference(value);
  if (!normalized) throw validationError(field, 'invalid_order_number');
  return normalized;
}

export function parsePhone(value: string | null, field = 'phone'): string | null {
  if (value === null) return null;
  const normalized = normalizeE164Phone(value);
  if (!normalized) throw validationError(field, 'invalid_phone');
  return normalized;
}

export function parseEmail(value: string | null, field = 'email'): string | null {
  if (value === null) return null;
  const normalized = value.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(normalized) || normalized.length > 254) throw validationError(field, 'invalid_email');
  return normalized;
}

export function parseTrackingNumber(value: string | null, field = 'tracking_number'): string | null {
  if (value === null) return null;
  // Case is preserved: stored tracking numbers are matched exactly, with an
  // upper-case variant tried as well (see trackingVariants in the store).
  const normalized = value.trim();
  if (!TRACKING_PATTERN.test(normalized)) throw validationError(field, 'invalid_tracking_number');
  return normalized;
}

export function parseCustomerId(value: string | null, field = 'customer_id'): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  if (!CUSTOMER_ID_PATTERN.test(normalized)) throw validationError(field, 'invalid_customer_id');
  return normalized;
}

export interface Pagination {
  page: number;
  pageSize: number;
  offset: number;
}

export function parsePagination(
  params: URLSearchParams,
  options: { max?: number; defaultSize?: number } = {}
): Pagination {
  const max = options.max ?? MAX_PAGE_SIZE;
  const parseInteger = (key: string, fallback: number, upper: number) => {
    const raw = optional(params, key);
    if (raw === null) return fallback;
    if (!/^\d{1,6}$/.test(raw)) throw validationError(key, 'must_be_positive_integer');
    const value = Number(raw);
    if (value < 1) throw validationError(key, 'must_be_positive_integer');
    if (value > upper) throw validationError(key, `must_be_at_most_${upper}`);
    return value;
  };
  const page = parseInteger('page', 1, 10_000);
  const pageSize = parseInteger('page_size', options.defaultSize ?? DEFAULT_PAGE_SIZE, max);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function paginationMeta(pagination: Pagination, total: number) {
  return {
    page: pagination.page,
    page_size: pagination.pageSize,
    total_items: total,
    total_pages: Math.max(1, Math.ceil(total / pagination.pageSize)),
    has_more: pagination.offset + pagination.pageSize < total,
  };
}

// ------------------------------------------------------------------ order search

export interface OrderSearchCriteria {
  orderNumber: string | null;
  phone: string | null;
  email: string | null;
  trackingNumber: string | null;
}

export function parseOrderSearch(params: URLSearchParams): OrderSearchCriteria {
  const criteria = {
    orderNumber: parseOrderReference(optional(params, 'order_number')),
    phone: parsePhone(optional(params, 'phone')),
    email: parseEmail(optional(params, 'email')),
    trackingNumber: parseTrackingNumber(optional(params, 'tracking_number')),
  };
  const provided = Object.values(criteria).filter(Boolean).length;
  if (provided === 0) throw validationError('order_number|phone|email|tracking_number', 'one_criterion_required');
  if (provided > 1) throw validationError('order_number|phone|email|tracking_number', 'exactly_one_criterion_allowed');
  return criteria;
}

export interface CustomerSearchCriteria {
  phone: string | null;
  email: string | null;
  customerId: string | null;
}

export function parseCustomerSearch(params: URLSearchParams): CustomerSearchCriteria {
  const criteria = {
    phone: parsePhone(optional(params, 'phone')),
    email: parseEmail(optional(params, 'email')),
    customerId: parseCustomerId(optional(params, 'customer_id')),
  };
  const provided = Object.values(criteria).filter(Boolean).length;
  if (provided !== 1) throw validationError('phone|email|customer_id', 'exactly_one_criterion_required');
  return criteria;
}

export interface ShipmentSearchCriteria {
  orderNumber: string | null;
  trackingNumber: string | null;
}

export function parseShipmentSearch(params: URLSearchParams): ShipmentSearchCriteria {
  const criteria = {
    orderNumber: parseOrderReference(optional(params, 'order_number')),
    trackingNumber: parseTrackingNumber(optional(params, 'tracking_number')),
  };
  const provided = Object.values(criteria).filter(Boolean).length;
  if (provided !== 1) throw validationError('order_number|tracking_number', 'exactly_one_criterion_required');
  return criteria;
}

// ------------------------------------------------------------------- reporting

export type ComparisonMode = 'none' | 'previous_period' | 'previous_year';

export interface ReportFilters {
  status: string[];
  payment_method: string[];
  city: string[];
  carrier: string[];
  source: string[];
}

export interface DateRange {
  from: string;
  to: string;
}

export interface ReportParams {
  range: DateRange;
  comparison: (DateRange & { mode: Exclude<ComparisonMode, 'none'> }) | null;
  timeZone: string;
  filters: ReportFilters;
}

export const REPORT_FILTER_KEYS = ['status', 'payment_method', 'city', 'carrier', 'source'] as const;
export const REPORT_BASE_PARAMS = ['from', 'to', 'timezone', 'compare', ...REPORT_FILTER_KEYS] as const;

const STATUS_FILTER_VALUES = new Set([
  'awaiting_payment', 'new', 'processing', 'ready_to_ship', 'shipped', 'out_for_delivery',
  'delivered', 'cancelled', 'return_in_progress', 'returned', 'deleted', 'other',
]);
const CARRIER_FILTER_VALUES = new Set(['smsa', 'ajex', 'dhl', 'aramex', 'redbox', 'fedex', 'ups', 'local_courier', 'other']);

function parseFilterList(params: URLSearchParams, key: string, allowed?: Set<string>): string[] {
  const raw = optional(params, key);
  if (raw === null) return [];
  const values = Array.from(new Set(raw.split(',').map((value) => value.trim()).filter(Boolean)));
  if (values.length === 0 || values.length > MAX_FILTER_VALUES) throw validationError(key, 'invalid_filter_list');
  for (const value of values) {
    if (!FILTER_VALUE_PATTERN.test(value)) throw validationError(key, 'invalid_filter_value');
    if (allowed && !allowed.has(value)) throw validationError(key, 'unsupported_filter_value');
  }
  return values.sort();
}

export function parseReportParams(params: URLSearchParams, now: Date = new Date()): ReportParams {
  const timeZone = optional(params, 'timezone') ?? HERMES_DEFAULT_TIMEZONE;
  if (!isValidTimeZone(timeZone)) throw validationError('timezone', 'invalid_iana_timezone');

  const from = optional(params, 'from');
  const to = optional(params, 'to');
  if (!from || !parseIsoDate(from)) throw validationError('from', 'required_iso_date');
  if (!to || !parseIsoDate(to)) throw validationError('to', 'required_iso_date');
  if (from > to) throw validationError('from', 'must_not_be_after_to');
  if (daysInclusive(from, to) > MAX_REPORT_RANGE_DAYS) {
    throw validationError('to', `range_exceeds_${MAX_REPORT_RANGE_DAYS}_days`);
  }
  // Dates before the store's data begins are fine; far-future ones are typos.
  if (from > addDays(now.toISOString().slice(0, 10), 1)) throw validationError('from', 'must_not_be_in_future');

  const compare = (optional(params, 'compare') ?? 'none') as ComparisonMode;
  if (!['none', 'previous_period', 'previous_year'].includes(compare)) {
    throw validationError('compare', 'must_be_none_previous_period_or_previous_year');
  }

  let comparison: ReportParams['comparison'] = null;
  if (compare === 'previous_period') {
    const length = daysInclusive(from, to);
    comparison = { mode: compare, from: addDays(from, -length), to: addDays(from, -1) };
  } else if (compare === 'previous_year') {
    comparison = { mode: compare, from: addYears(from, -1), to: addYears(to, -1) };
  }

  return {
    range: { from, to },
    comparison,
    timeZone,
    filters: {
      status: parseFilterList(params, 'status', STATUS_FILTER_VALUES),
      payment_method: parseFilterList(params, 'payment_method'),
      city: parseFilterList(params, 'city'),
      carrier: parseFilterList(params, 'carrier', CARRIER_FILTER_VALUES),
      source: parseFilterList(params, 'source'),
    },
  };
}
