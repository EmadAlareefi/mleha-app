import { isProblemReason } from './problem-rules';
import type { ItemCheck, PrepSlotStatus, ProblemItem } from './types';

/** Input validation for the v2 routes; anything malformed is dropped. */

const str = (value: unknown, max = 200): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;

const int = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 10_000 ? value : null;

export function parseHeldSlots(raw: unknown): Array<{ orderId: string; slot: PrepSlotStatus }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 4)
    .map((entry) => ({
      orderId: str((entry as any)?.orderId, 64),
      slot: (entry as any)?.slot === 'assigned' ? ('assigned' as const) : ('preparing' as const),
    }))
    .filter((entry): entry is { orderId: string; slot: PrepSlotStatus } => Boolean(entry.orderId));
}

export function parseItemChecks(raw: unknown): ItemCheck[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 100)
    .map((entry) => {
      const index = int((entry as any)?.index);
      const checked = int((entry as any)?.checked);
      if (index === null || checked === null) return null;
      return {
        index,
        sku: str((entry as any)?.sku, 120),
        checked,
        method: (entry as any)?.method === 'scan' ? 'scan' : 'manual',
      } satisfies ItemCheck;
    })
    .filter((entry): entry is ItemCheck => entry !== null);
}

export function parseProblemItems(raw: unknown): ProblemItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  return raw
    .slice(0, 100)
    .map((entry) => {
      const index = int((entry as any)?.index);
      const reason = (entry as any)?.reason;
      if (index === null || !isProblemReason(reason) || seen.has(index)) return null;
      seen.add(index);
      return { index, reason, sku: str((entry as any)?.sku, 120), name: str((entry as any)?.name, 200) } satisfies ProblemItem;
    })
    .filter((entry): entry is ProblemItem => entry !== null);
}

export const parseOrderId = (raw: unknown) => str(raw, 64);
export const parseNote = (raw: unknown) => str(raw, 400);
