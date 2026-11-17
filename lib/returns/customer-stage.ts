/**
 * Which screen the public returns page shows for an order, from its Salla
 * status (base slug and the store's own name for it), its age and whether the
 * warehouse has started preparing it.
 *
 * Rules (returns test report, 2026-11-16):
 *  - "طلب جديد" up to 3 hours old and not yet picked up by a packer: the
 *    customer may still cancel or change it.
 *  - Any other open status before delivery (new after 3 hours, the custom
 *    review statuses such as "تحت المراجعة R" or "X4", preparing, "تم التنفيذ",
 *    shipped, out for delivery): wait for the order to arrive.
 *  - "تم التوصيل": returns and exchanges.
 *  - Cancelled: the cancelled screen.
 *  - Being returned ("قيد الاسترجاع") is not decided here: the page first looks
 *    for the customer's open request, which is what that status usually means.
 */

export type CustomerStage = 'returnable' | 'editable' | 'waiting' | 'cancelled' | 'returning' | 'unavailable';

export const EDIT_WINDOW_MS = 3 * 60 * 60 * 1000;

const NEW_ORDER_NAMES = ['طلب جديد', 'بانتظار المراجعة', 'بإنتظار المراجعة'];

export function statusParts(status: unknown): { slug: string; name: string } {
  if (typeof status === 'string') return { slug: status.trim().toLowerCase(), name: status.trim() };
  if (status && typeof status === 'object') {
    const record = status as Record<string, unknown>;
    const slug = String(record.slug ?? '').trim().toLowerCase();
    const name = String(record.name ?? record.customized ?? '').trim();
    return { slug, name };
  }
  return { slug: '', name: '' };
}

const normalize = (value: string) => value.replace(/[إأآ]/g, 'ا').replace(/\s+/g, ' ').trim();

export function customerStage(input: {
  status: unknown;
  placedAt?: string | null;
  prepStarted?: boolean;
  now?: number;
}): CustomerStage {
  const { slug, name } = statusParts(input.status);
  const plainName = normalize(name);

  if (slug.includes('cancel') || slug === 'restored' || plainName.includes('ملغ')) return 'cancelled';
  if (slug === 'delivered' || plainName === 'تم التوصيل' || plainName === 'تم التسليم') return 'returnable';
  if (slug === 'restoring' || plainName.includes('قيد الاسترجاع')) return 'returning';

  const isNew = NEW_ORDER_NAMES.some((candidate) => normalize(candidate) === plainName) || (!name && slug === 'under_review');
  if (isNew) {
    const placed = input.placedAt ? Date.parse(input.placedAt) : NaN;
    const young = Number.isFinite(placed) && (input.now ?? Date.now()) - placed <= EDIT_WINDOW_MS;
    return young && !input.prepStarted ? 'editable' : 'waiting';
  }

  if (['under_review', 'in_progress', 'completed', 'shipped', 'delivering'].includes(slug)) return 'waiting';
  return 'unavailable';
}

/**
 * Salla sends order dates as naive Riyadh time ("2026-11-16 10:00:00") or as
 * `{ date: ... }`. Returns an ISO instant, or null when unparseable.
 */
export function sallaDateToIso(value: unknown): string | null {
  const raw =
    typeof value === 'string'
      ? value
      : value && typeof value === 'object'
        ? String((value as Record<string, unknown>).date ?? '')
        : '';
  if (!raw) return null;
  const base = raw.trim().replace(' ', 'T').replace(/\.\d+$/, '');
  const hasZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(base);
  const parsed = new Date(hasZone ? base : `${base}+03:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
