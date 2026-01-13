import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { listSallaProducts } from '@/app/lib/salla-api';
import { log } from '@/app/lib/logger';
import { resolveSallaMerchantId } from '@/app/api/salla/products/merchant';

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

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: 'يجب تسجيل الدخول للوصول إلى المنتجات' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const requestedMerchant = searchParams.get('merchantId');
    const resolved = await resolveSallaMerchantId(requestedMerchant);

    if (!resolved.merchantId) {
      return NextResponse.json(
        { error: resolved.error || 'لا يوجد متجر مرتبط بسلة.' },
        { status: requestedMerchant ? 404 : 503 }
      );
    }

    const page = parseNumber(searchParams.get('page'), 1);
    const perPage = parseNumber(searchParams.get('perPage'), 100);
    const sku = searchParams.get('sku') || undefined;
    const requestedStatus = searchParams.get('status') || undefined;
    const allowedStatuses = new Set(['hidden', 'sale', 'out']);
    const status = requestedStatus && allowedStatuses.has(requestedStatus) ? requestedStatus : undefined;

    const { products, pagination } = await listSallaProducts(resolved.merchantId, {
      page,
      perPage,
      sku,
      status,
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
