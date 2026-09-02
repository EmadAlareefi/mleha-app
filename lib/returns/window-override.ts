import { prisma } from '@/lib/prisma';

export async function hasActiveReturnWindowOverride(merchantId: string, orderId: string) {
  const override = await prisma.returnWindowOverride.findUnique({
    where: {
      merchantId_orderId: {
        merchantId,
        orderId: String(orderId),
      },
    },
    select: { revokedAt: true },
  });

  return Boolean(override && !override.revokedAt);
}
