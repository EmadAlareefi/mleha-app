import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';

/**
 * Supervisor-controlled order prep settings, stored in the Settings table under
 * `order_prep.*` and read through a short in-memory cache so the queue never
 * waits on them.
 */

export type PriorityMode = 'oldest_first' | 'regular_first';
export type ScanMode = 'optional' | 'required' | 'off';

export type PrepSettings = {
  /** oldest_first: strictly by order date. regular_first: campaign mode. */
  priorityMode: PriorityMode;
  /** In campaign mode, promo orders older than this many hours go first anyway. */
  promoAgingHours: number;
  scanMode: ScanMode;
  leaseMinutes: number;
  /** Serve the new page at /order-prep (the old one stays at ?v=1). */
  v2Enabled: boolean;
};

export const PREP_SETTING_KEYS = {
  priorityMode: 'order_prep.priority_mode',
  promoAgingHours: 'order_prep.promo_aging_hours',
  scanMode: 'order_prep.scan_mode',
  leaseMinutes: 'order_prep.lease_minutes',
  v2Enabled: 'order_prep.v2_enabled',
} as const;

export const DEFAULT_PREP_SETTINGS: PrepSettings = {
  priorityMode: 'oldest_first',
  promoAgingHours: 48,
  scanMode: 'optional',
  leaseMinutes: 15,
  v2Enabled: false,
};

const clampInt = (raw: string | undefined, fallback: number, min: number, max: number) => {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

/** Settings from raw key/value rows; unknown or invalid values fall back to defaults. */
export function parsePrepSettings(values: Record<string, string | undefined>): PrepSettings {
  const priority = values[PREP_SETTING_KEYS.priorityMode];
  const scan = values[PREP_SETTING_KEYS.scanMode];
  const v2 = values[PREP_SETTING_KEYS.v2Enabled]?.trim().toLowerCase();
  return {
    priorityMode: priority === 'regular_first' ? 'regular_first' : 'oldest_first',
    promoAgingHours: clampInt(values[PREP_SETTING_KEYS.promoAgingHours], DEFAULT_PREP_SETTINGS.promoAgingHours, 1, 24 * 30),
    scanMode: scan === 'required' || scan === 'off' ? scan : 'optional',
    leaseMinutes: clampInt(values[PREP_SETTING_KEYS.leaseMinutes], DEFAULT_PREP_SETTINGS.leaseMinutes, 3, 120),
    v2Enabled: v2 === 'true' || v2 === '1',
  };
}

/** Validated subset for an update; invalid fields are dropped. */
export function sanitizePrepSettingsPatch(patch: Record<string, unknown>): Partial<PrepSettings> {
  const result: Partial<PrepSettings> = {};
  if (patch.priorityMode === 'oldest_first' || patch.priorityMode === 'regular_first') {
    result.priorityMode = patch.priorityMode;
  }
  if (patch.scanMode === 'optional' || patch.scanMode === 'required' || patch.scanMode === 'off') {
    result.scanMode = patch.scanMode;
  }
  const hours = Number(patch.promoAgingHours);
  if (Number.isInteger(hours) && hours >= 1 && hours <= 24 * 30) result.promoAgingHours = hours;
  const lease = Number(patch.leaseMinutes);
  if (Number.isInteger(lease) && lease >= 3 && lease <= 120) result.leaseMinutes = lease;
  if (typeof patch.v2Enabled === 'boolean') result.v2Enabled = patch.v2Enabled;
  return result;
}

const CACHE_TTL_MS = 10_000;
let cache: { at: number; value: PrepSettings } | null = null;

export async function getPrepSettings(options: { fresh?: boolean } = {}): Promise<PrepSettings> {
  if (!options.fresh && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  try {
    const rows = await prisma.settings.findMany({
      where: { key: { in: Object.values(PREP_SETTING_KEYS) } },
      select: { key: true, value: true },
    });
    const value = parsePrepSettings(Object.fromEntries(rows.map((row) => [row.key, row.value])));
    cache = { at: Date.now(), value };
    return value;
  } catch (error) {
    log.error('Failed to load order prep settings; using last known or defaults', {
      error: error instanceof Error ? error.message : error,
    });
    return cache?.value ?? DEFAULT_PREP_SETTINGS;
  }
}

export async function updatePrepSettings(patch: Partial<PrepSettings>): Promise<PrepSettings> {
  const entries = Object.entries(patch) as Array<[keyof PrepSettings, PrepSettings[keyof PrepSettings]]>;
  await prisma.$transaction(
    entries.map(([field, value]) =>
      prisma.settings.upsert({
        where: { key: PREP_SETTING_KEYS[field] },
        create: { key: PREP_SETTING_KEYS[field], value: String(value), description: `Order prep: ${field}` },
        update: { value: String(value) },
      }),
    ),
  );
  cache = null;
  return getPrepSettings({ fresh: true });
}
