import { prisma } from '@/lib/prisma';
import { WINDOW_OVERRIDE_SCOPES, type WindowOverrideScope } from '@/lib/returns/pieces';

export interface ActiveWindowOverride {
  id: string;
  scope: WindowOverrideScope;
  note: string | null;
  createdBy: string;
}

export const normalizeOverrideScope = (value: unknown): WindowOverrideScope =>
  WINDOW_OVERRIDE_SCOPES.includes(value as WindowOverrideScope) ? (value as WindowOverrideScope) : 'both';

/** The order's active window exception (استثناء مدة الإرجاع), if any. */
export async function getActiveReturnWindowOverride(merchantId: string, orderId: string): Promise<ActiveWindowOverride | null> {
  const override = await prisma.returnWindowOverride.findUnique({
    where: {
      merchantId_orderId: {
        merchantId,
        orderId: String(orderId),
      },
    },
    select: { id: true, scope: true, note: true, createdBy: true, revokedAt: true },
  });
  if (!override || override.revokedAt) return null;
  return { id: override.id, scope: normalizeOverrideScope(override.scope), note: override.note, createdBy: override.createdBy };
}

export async function hasActiveReturnWindowOverride(merchantId: string, orderId: string) {
  return Boolean(await getActiveReturnWindowOverride(merchantId, orderId));
}
