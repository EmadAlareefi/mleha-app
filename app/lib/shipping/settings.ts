import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';

/**
 * Shipping v2 switches, stored in the Settings table and read through a short
 * cache (same pattern as app/lib/order-prep/settings.ts).
 */

export type ShippingSettings = {
  /** Serve the new station at /order-shipping (the old page stays at ?v=1). */
  v2Enabled: boolean;
  /** Create the Salla shipment in the background right after packing. */
  precreateEnabled: boolean;
};

export const SHIPPING_SETTING_KEYS = {
  v2Enabled: 'shipping.v2_enabled',
  precreateEnabled: 'shipping.precreate_enabled',
} as const;

export const DEFAULT_SHIPPING_SETTINGS: ShippingSettings = { v2Enabled: false, precreateEnabled: false };

const isOn = (value: string | undefined) => {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'true' || normalized === '1';
};

export function parseShippingSettings(values: Record<string, string | undefined>): ShippingSettings {
  return {
    v2Enabled: isOn(values[SHIPPING_SETTING_KEYS.v2Enabled]),
    precreateEnabled: isOn(values[SHIPPING_SETTING_KEYS.precreateEnabled]),
  };
}

export function sanitizeShippingSettingsPatch(patch: Record<string, unknown>): Partial<ShippingSettings> {
  const result: Partial<ShippingSettings> = {};
  if (typeof patch.v2Enabled === 'boolean') result.v2Enabled = patch.v2Enabled;
  if (typeof patch.precreateEnabled === 'boolean') result.precreateEnabled = patch.precreateEnabled;
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
  const entries = Object.entries(patch) as Array<[keyof ShippingSettings, boolean]>;
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
