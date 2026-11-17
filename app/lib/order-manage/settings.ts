import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { normalizeE164Phone } from '@/app/lib/phone';

/**
 * Customer order self-service (/my-order) switches, stored in the Settings
 * table under `order_manage.*` and read through a short cache (same pattern as
 * app/lib/shipping/settings.ts). Everything defaults to off.
 */

export type OrderManageSettings = {
  /** Master switch: the page, the storefront button and every action. */
  enabled: boolean;
  cancelEnabled: boolean;
  addressEnabled: boolean;
  swapEnabled: boolean;
  itemsEnabled: boolean;
  /** Off: every refund waits for staff, whatever the payment method. */
  autoRefundEnabled: boolean;
  maxChangesPerOrder: number;
  /** Refunds sent automatically per day (SAR); past it they wait for staff. */
  autoRefundDailyCapSar: number;
  /** While non-empty, only orders of these mobiles can use the feature. */
  pilotMobiles: string[];
};

export type OrderManageAction = 'cancel' | 'address' | 'swap' | 'items';

export const ORDER_MANAGE_SETTING_KEYS = {
  enabled: 'order_manage.enabled',
  cancelEnabled: 'order_manage.cancel_enabled',
  addressEnabled: 'order_manage.address_enabled',
  swapEnabled: 'order_manage.swap_enabled',
  itemsEnabled: 'order_manage.items_enabled',
  autoRefundEnabled: 'order_manage.auto_refund_enabled',
  maxChangesPerOrder: 'order_manage.max_changes_per_order',
  autoRefundDailyCapSar: 'order_manage.auto_refund_daily_cap_sar',
  pilotMobiles: 'order_manage.pilot_mobiles',
} as const;

export const DEFAULT_ORDER_MANAGE_SETTINGS: OrderManageSettings = {
  enabled: false,
  cancelEnabled: false,
  addressEnabled: false,
  swapEnabled: false,
  itemsEnabled: false,
  autoRefundEnabled: false,
  maxChangesPerOrder: 3,
  autoRefundDailyCapSar: 5000,
  pilotMobiles: [],
};

const BOOLEAN_FIELDS = ['enabled', 'cancelEnabled', 'addressEnabled', 'swapEnabled', 'itemsEnabled', 'autoRefundEnabled'] as const;
const MAX_CHANGES_RANGE = { min: 1, max: 10 } as const;
const DAILY_CAP_RANGE = { min: 0, max: 1_000_000 } as const;
const MAX_PILOT_MOBILES = 50;

const isOn = (value: string | undefined) => {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'true' || normalized === '1';
};

const clampInt = (raw: string | undefined, fallback: number, range: { min: number; max: number }) => {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(range.max, Math.max(range.min, parsed));
};

/** Mobiles in E.164 without duplicates; anything that is not a phone is dropped. */
export function normalizePilotMobiles(input: unknown): string[] {
  const parts = Array.isArray(input) ? input : typeof input === 'string' ? input.split(/[,\n;]/) : [];
  const mobiles = parts
    .map((part) => (typeof part === 'string' || typeof part === 'number' ? normalizeE164Phone(part) : ''))
    .filter((mobile) => mobile.replace(/\D/g, '').length >= 8);
  return Array.from(new Set(mobiles)).slice(0, MAX_PILOT_MOBILES);
}

export function parseOrderManageSettings(values: Record<string, string | undefined>): OrderManageSettings {
  const keys = ORDER_MANAGE_SETTING_KEYS;
  return {
    enabled: isOn(values[keys.enabled]),
    cancelEnabled: isOn(values[keys.cancelEnabled]),
    addressEnabled: isOn(values[keys.addressEnabled]),
    swapEnabled: isOn(values[keys.swapEnabled]),
    itemsEnabled: isOn(values[keys.itemsEnabled]),
    autoRefundEnabled: isOn(values[keys.autoRefundEnabled]),
    maxChangesPerOrder: clampInt(values[keys.maxChangesPerOrder], DEFAULT_ORDER_MANAGE_SETTINGS.maxChangesPerOrder, MAX_CHANGES_RANGE),
    autoRefundDailyCapSar: clampInt(values[keys.autoRefundDailyCapSar], DEFAULT_ORDER_MANAGE_SETTINGS.autoRefundDailyCapSar, DAILY_CAP_RANGE),
    pilotMobiles: normalizePilotMobiles(values[keys.pilotMobiles] ?? ''),
  };
}

/** Validated subset for an update; invalid fields are dropped. */
export function sanitizeOrderManageSettingsPatch(patch: Record<string, unknown>): Partial<OrderManageSettings> {
  const result: Partial<OrderManageSettings> = {};
  for (const field of BOOLEAN_FIELDS) {
    const value = patch[field];
    if (typeof value === 'boolean') result[field] = value;
  }
  const maxChanges = Number(patch.maxChangesPerOrder);
  if (Number.isInteger(maxChanges) && maxChanges >= MAX_CHANGES_RANGE.min && maxChanges <= MAX_CHANGES_RANGE.max) {
    result.maxChangesPerOrder = maxChanges;
  }
  const cap = Number(patch.autoRefundDailyCapSar);
  if (patch.autoRefundDailyCapSar !== undefined && Number.isInteger(cap) && cap >= DAILY_CAP_RANGE.min && cap <= DAILY_CAP_RANGE.max) {
    result.autoRefundDailyCapSar = cap;
  }
  if (Array.isArray(patch.pilotMobiles) || typeof patch.pilotMobiles === 'string') {
    result.pilotMobiles = normalizePilotMobiles(patch.pilotMobiles);
  }
  return result;
}

export function isActionEnabled(settings: OrderManageSettings, action: OrderManageAction): boolean {
  if (!settings.enabled) return false;
  if (action === 'cancel') return settings.cancelEnabled;
  if (action === 'address') return settings.addressEnabled;
  if (action === 'swap') return settings.swapEnabled;
  return settings.itemsEnabled;
}

/** During the pilot only listed mobiles get in; an empty list means everyone. */
export function isPilotAllowed(settings: OrderManageSettings, orderPhones: string[]): boolean {
  if (settings.pilotMobiles.length === 0) return true;
  return orderPhones.some((phone) => settings.pilotMobiles.includes(phone));
}

const serialize = (value: OrderManageSettings[keyof OrderManageSettings]): string =>
  Array.isArray(value) ? value.join(',') : String(value);

const CACHE_TTL_MS = 10_000;
let cache: { at: number; value: OrderManageSettings } | null = null;

export async function getOrderManageSettings(options: { fresh?: boolean } = {}): Promise<OrderManageSettings> {
  if (!options.fresh && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  try {
    const rows = await prisma.settings.findMany({
      where: { key: { in: Object.values(ORDER_MANAGE_SETTING_KEYS) } },
      select: { key: true, value: true },
    });
    const value = parseOrderManageSettings(Object.fromEntries(rows.map((row) => [row.key, row.value])));
    cache = { at: Date.now(), value };
    return value;
  } catch (error) {
    // A settings read that fails must not switch the feature on.
    log.error('Failed to load order-manage settings; using last known or defaults', {
      error: error instanceof Error ? error.message : error,
    });
    return cache?.value ?? DEFAULT_ORDER_MANAGE_SETTINGS;
  }
}

export async function updateOrderManageSettings(patch: Partial<OrderManageSettings>): Promise<OrderManageSettings> {
  const entries = Object.entries(patch) as Array<[keyof OrderManageSettings, OrderManageSettings[keyof OrderManageSettings]]>;
  if (entries.length > 0) {
    await prisma.$transaction(
      entries.map(([field, value]) =>
        prisma.settings.upsert({
          where: { key: ORDER_MANAGE_SETTING_KEYS[field] },
          create: { key: ORDER_MANAGE_SETTING_KEYS[field], value: serialize(value), description: `Order manage: ${field}` },
          update: { value: serialize(value) },
        }),
      ),
    );
  }
  cache = null;
  return getOrderManageSettings({ fresh: true });
}

/**
 * Local development talks to the production database and the live store, so
 * outside production a write is refused unless the order is listed in
 * ORDER_MANAGE_DEV_ORDER_ALLOWLIST (comma-separated Salla order ids).
 */
export function isWriteAllowedInThisEnvironment(
  orderId: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.NODE_ENV === 'production') return true;
  const allowed = (env.ORDER_MANAGE_DEV_ORDER_ALLOWLIST || '').split(',').map((id) => id.trim()).filter(Boolean);
  return allowed.includes(orderId);
}
