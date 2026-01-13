import { prisma } from '@/lib/prisma';

type MerchantResolution =
  | { merchantId: string; error?: undefined }
  | { merchantId: null; error: string };

export async function resolveSallaMerchantId(requestedMerchantId?: string | null): Promise<MerchantResolution> {
  if (requestedMerchantId) {
    const auth = await prisma.sallaAuth.findUnique({
      where: { merchantId: requestedMerchantId },
      select: { merchantId: true },
    });

    if (!auth) {
      return { merchantId: null, error: `لا توجد رموز مخزنة للمتجر ${requestedMerchantId}` };
    }

    return { merchantId: auth.merchantId };
  }

  const envMerchantId =
    process.env.NEXT_PUBLIC_MERCHANT_ID ||
    process.env.SALLA_DEFAULT_MERCHANT_ID ||
    process.env.MERCHANT_ID;

  if (envMerchantId) {
    const envAuth = await prisma.sallaAuth.findUnique({
      where: { merchantId: envMerchantId },
      select: { merchantId: true },
    });

    if (envAuth) {
      return { merchantId: envAuth.merchantId };
    }
  }

  const fallbackAuth = await prisma.sallaAuth.findFirst({
    orderBy: { updatedAt: 'desc' },
    select: { merchantId: true },
  });

  if (!fallbackAuth) {
    return {
      merchantId: null,
      error:
        'لا يوجد متجر مرتبط بسلة حالياً، يرجى تشغيل `npm run refresh:salla-tokens` أو اتباع التعليمات في SALLA_TOKEN_REFRESH.md لحفظ الرموز.',
    };
  }

  return { merchantId: fallbackAuth.merchantId };
}
