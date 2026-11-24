import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { BIG_PICKUP_THRESHOLD_RANGE } from '@/app/lib/shipping/pickup';

/**
 * Shipping settings, stored in the Settings table and read through a short
 * cache (same pattern as app/lib/order-prep/settings.ts).
 */

export type ShippingSettings = {
  /** Create the Salla shipment in the background right after packing. */
  precreateEnabled: boolean;
  /** Parcels expected for one carrier at which the dashboard says «call them for a big truck». */
  bigPickupThreshold: number;
};

export const SHIPPING_SETTING_KEYS = {
  precreateEnabled: 'shipping.precreate_enabled',
  bigPickupThreshold: 'shipping.big_pickup_threshold',
} as const;

export const DEFAULT_SHIPPING_SETTINGS: ShippingSettings = {
  precreateEnabled: false,
  bigPickupThreshold: BIG_PICKUP_THRESHOLD_RANGE.default,
};

const parseThreshold = (value: string | undefined) => {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return BIG_PICKUP_THRESHOLD_RANGE.default;
  return Math.min(BIG_PICKUP_THRESHOLD_RANGE.max, Math.max(BIG_PICKUP_THRESHOLD_RANGE.min, parsed));
};

const isOn = (value: string | undefined) => {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'true' || normalized === '1';
};

export function parseShippingSettings(values: Record<string, string | undefined>): ShippingSettings {
  return {
    precreateEnabled: isOn(values[SHIPPING_SETTING_KEYS.precreateEnabled]),
    bigPickupThreshold: parseThreshold(values[SHIPPING_SETTING_KEYS.bigPickupThreshold]),
  };
}

export function sanitizeShippingSettingsPatch(patch: Record<string, unknown>): Partial<ShippingSettings> {
  const result: Partial<ShippingSettings> = {};
  if (typeof patch.precreateEnabled === 'boolean') result.precreateEnabled = patch.precreateEnabled;
  const threshold = patch.bigPickupThreshold;
  if (
    typeof threshold === 'number' &&
    Number.isInteger(threshold) &&
    threshold >= BIG_PICKUP_THRESHOLD_RANGE.min &&
    threshold <= BIG_PICKUP_THRESHOLD_RANGE.max
  ) {
    result.bigPickupThreshold = threshold;
  }
  return result;
}

const CACHE_TTL_MS = 10_000;
let cache: { at: number; value: ShippingSettings } | null = null;

export async function getShippingSettings(options: { fresh?: boolean } = {}): Promise<ShippingSettings> {
  if (!options.fresh && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  try {
    const rows = await prisma.settings.findMany({
      where: { key: { in: Object.values(SHIPPING_SETTING_KEYS) } },
      select: { key: true, value: true },
    });
    const value = parseShippingSettings(Object.fromEntries(rows.map((row) => [row.key, row.value])));
    cache = { at: Date.now(), value };
    return value;
  } catch (error) {
    log.error('Failed to load shipping settings; using last known or defaults', {
      error: error instanceof Error ? error.message : error,
    });
    return cache?.value ?? DEFAULT_SHIPPING_SETTINGS;
  }
}

export async function updateShippingSettings(patch: Partial<ShippingSettings>): Promise<ShippingSettings> {
  const entries = Object.entries(patch) as Array<[keyof ShippingSettings, boolean | number]>;
  await prisma.$transaction(
    entries.map(([field, value]) =>
      prisma.settings.upsert({
        where: { key: SHIPPING_SETTING_KEYS[field] },
        create: { key: SHIPPING_SETTING_KEYS[field], value: String(value), description: `Shipping: ${field}` },
        update: { value: String(value) },
      }),
    ),
  );
  cache = null;
  return getShippingSettings({ fresh: true });
}
