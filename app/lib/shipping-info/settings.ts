import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { normalizePilotMobiles } from '@/app/lib/order-manage/settings';

/**
 * Switches for holding international orders with incomplete shipping info,
 * stored in the Settings table under `shipping_info.*` (same pattern as
 * app/lib/order-manage/settings.ts). Off by default.
 */
export type ShippingInfoSettings = {
  /** Master switch: new orders are checked and held. Pending requests keep working when off. */
  enabled: boolean;
  /** Salla custom status id of "بانتظار استكمال بيانات الشحن". */
  holdStatusId: string;
  /** While non-empty, only orders of these mobiles are held. */
  pilotMobiles: string[];
};

export const SHIPPING_INFO_SETTING_KEYS = {
  enabled: 'shipping_info.enabled',
  holdStatusId: 'shipping_info.hold_status_id',
  pilotMobiles: 'shipping_info.pilot_mobiles',
} as const;

export const DEFAULT_SHIPPING_INFO_SETTINGS: ShippingInfoSettings = {
  enabled: false,
  holdStatusId: '',
  pilotMobiles: [],
};

export function parseShippingInfoSettings(values: Record<string, string | undefined>): ShippingInfoSettings {
  const keys = SHIPPING_INFO_SETTING_KEYS;
  const enabled = ['true', '1'].includes((values[keys.enabled] ?? '').trim().toLowerCase());
  const holdStatusId = (values[keys.holdStatusId] ?? '').trim();
  return {
    enabled,
    holdStatusId: /^\d+$/.test(holdStatusId) ? holdStatusId : '',
    pilotMobiles: normalizePilotMobiles(values[keys.pilotMobiles] ?? ''),
  };
}

export function sanitizeShippingInfoSettingsPatch(patch: Record<string, unknown>): Partial<ShippingInfoSettings> {
  const result: Partial<ShippingInfoSettings> = {};
  if (typeof patch.enabled === 'boolean') result.enabled = patch.enabled;
  if (typeof patch.holdStatusId === 'string' && /^\d*$/.test(patch.holdStatusId.trim())) {
    result.holdStatusId = patch.holdStatusId.trim();
  }
  if (Array.isArray(patch.pilotMobiles) || typeof patch.pilotMobiles === 'string') {
    result.pilotMobiles = normalizePilotMobiles(patch.pilotMobiles);
  }
  return result;
}

const CACHE_TTL_MS = 10_000;
let cache: { at: number; value: ShippingInfoSettings } | null = null;

export async function getShippingInfoSettings(options: { fresh?: boolean } = {}): Promise<ShippingInfoSettings> {
  if (!options.fresh && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  try {
    const rows = await prisma.settings.findMany({
      where: { key: { in: Object.values(SHIPPING_INFO_SETTING_KEYS) } },
      select: { key: true, value: true },
    });
    const value = parseShippingInfoSettings(Object.fromEntries(rows.map((row) => [row.key, row.value])));
    cache = { at: Date.now(), value };
    return value;
  } catch (error) {
    // A settings read that fails must not switch the feature on.
    log.error('Failed to load shipping-info settings; using last known or defaults', {
      error: error instanceof Error ? error.message : error,
    });
    return cache?.value ?? DEFAULT_SHIPPING_INFO_SETTINGS;
  }
}

export async function updateShippingInfoSettings(patch: Partial<ShippingInfoSettings>): Promise<ShippingInfoSettings> {
  const entries = Object.entries(patch) as Array<[keyof ShippingInfoSettings, ShippingInfoSettings[keyof ShippingInfoSettings]]>;
  if (entries.length > 0) {
    await prisma.$transaction(
      entries.map(([field, value]) => {
        const serialized = Array.isArray(value) ? value.join(',') : String(value);
        return prisma.settings.upsert({
          where: { key: SHIPPING_INFO_SETTING_KEYS[field] },
          create: { key: SHIPPING_INFO_SETTING_KEYS[field], value: serialized, description: `Shipping info: ${field}` },
          update: { value: serialized },
        });
      }),
    );
  }
  cache = null;
  return getShippingInfoSettings({ fresh: true });
}
