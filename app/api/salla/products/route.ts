import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { listSallaProducts } from '@/app/lib/salla-api';
import { log } from '@/app/lib/logger';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

function parseNumber(value: string | null, fallback: number) {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

async function resolveMerchantId(requestedMerchantId?: string | null) {
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
      error: 'لا يوجد متجر مرتبط بسلة حالياً، يرجى تشغيل `npm run refresh:salla-tokens` أو اتباع التعليمات في SALLA_TOKEN_REFRESH.md لحفظ الرموز.',
    };
  }

  return { merchantId: fallbackAuth.merchantId };
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: 'يجب تسجيل الدخول للوصول إلى المنتجات' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const requestedMerchant = searchParams.get('merchantId');
    const resolved = await resolveMerchantId(requestedMerchant);

    if (!resolved.merchantId) {
      return NextResponse.json(
        { error: resolved.error || 'لا يوجد متجر مرتبط بسلة.' },
        { status: requestedMerchant ? 404 : 503 }
      );
    }

    const page = parseNumber(searchParams.get('page'), 1);
    const perPage = parseNumber(searchParams.get('perPage'), 100);
    const sku = searchParams.get('sku') || undefined;

    const { products, pagination } = await listSallaProducts(resolved.merchantId, {
      page,
      perPage,
      sku,
    });

    return NextResponse.json({
      success: true,
      products,
      pagination,
      merchantId: resolved.merchantId,
    });
  } catch (error) {
    log.error('Failed to load Salla products', { error });
    const errorMessage =
      error instanceof Error
        ? error.message
        : 'تعذر تحميل منتجات سلة لهذا التاجر';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
