const RETURNABLE_STATUSES = new Set([
  'delivered',
  'completed',
  'delivering',
  'shipped',
  'تم التوصيل',
  'تم التسليم',
  'مكتمل',
  'تم التنفيذ',
  'جاري التوصيل',
  'تم الشحن',
]);

// Shared by the customer page and creation API so stale delivery statuses do
// not block returns or exchanges. Return-window checks still apply separately.
export function isReturnableOrderStatus(status: unknown): boolean {
  const matches = (value: unknown) =>
    typeof value === 'string' && RETURNABLE_STATUSES.has(value.trim().toLowerCase());

  if (typeof status === 'string') return matches(status);
  if (!status || typeof status !== 'object') return false;

  const record = status as Record<string, unknown>;
  // Prefer the canonical slug over a potentially inconsistent display name.
  if (typeof record.slug === 'string' && record.slug.trim()) return matches(record.slug);
  return matches(record.name) || matches(record.status);
}
