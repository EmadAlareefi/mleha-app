import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { getSallaProductVariations, type SallaProductVariation } from '@/app/lib/salla-api';
import { resolveSallaMerchantId } from '@/app/api/salla/products/merchant';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

const MAX_VARIATION_PRODUCTS = 120;
const VARIATION_CONCURRENCY = 5;

type VariationFetchResult = {
  variations: Record<number, SallaProductVariation[]>;
  failed: Array<{ productId: number; message: string }>;
};

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: 'يجب تسجيل الدخول للوصول إلى بيانات المنتجات' }, { status: 401 });
  }

  try {
    const body = await request
      .json()
      .catch(() => null)
      .then((value) => (value && typeof value === 'object' ? value : null));

    const productIdsInput: unknown[] = Array.isArray(body?.productIds)
      ? (body?.productIds as unknown[])
      : [];
    const queryMerchant = request.nextUrl.searchParams.get('merchantId');
    const requestedMerchant = (typeof body?.merchantId === 'string' && body.merchantId) || queryMerchant;

    const numericIds = Array.from(
      new Set(
        productIdsInput
          .map((value) => {
            if (typeof value === 'number' && Number.isFinite(value)) {
              return value;
            }
            const parsed = Number.parseInt(String(value), 10);
            return Number.isFinite(parsed) ? parsed : null;
          })
          .filter((value): value is number => value != null)
      )
    ).slice(0, MAX_VARIATION_PRODUCTS);

    if (numericIds.length === 0) {
      return NextResponse.json(
        { error: 'يجب تحديد قائمة المنتجات المطلوب تحميل متغيراتها' },
        { status: 400 }
      );
    }

    const resolved = await resolveSallaMerchantId(requestedMerchant);

    if (!resolved.merchantId) {
      return NextResponse.json(
        { error: resolved.error || 'لا يوجد متجر مرتبط بسلة.' },
        { status: requestedMerchant ? 404 : 503 }
      );
    }

    const { variations, failed } = await fetchVariations(resolved.merchantId, numericIds);

    return NextResponse.json({
      success: true,
      variations,
      failed,
      merchantId: resolved.merchantId,
      truncated: numericIds.length < productIdsInput.length,
    });
  } catch (error) {
    log.error('Failed to load Salla product variations', { error });
    return NextResponse.json(
      { error: 'تعذر تحميل متغيرات المنتجات من سلة' },
      { status: 500 }
    );
  }
}

async function fetchVariations(merchantId: string, productIds: number[]): Promise<VariationFetchResult> {
  const variations: Record<number, SallaProductVariation[]> = {};
  const failed: Array<{ productId: number; message: string }> = [];

  let index = 0;
  const workerCount = Math.min(VARIATION_CONCURRENCY, productIds.length);

  async function worker() {
    while (true) {
      const currentIndex = index++;
      if (currentIndex >= productIds.length) {
        break;
      }
      const productId = productIds[currentIndex];

      try {
        const entries = await getSallaProductVariations(merchantId, productId.toString());
        variations[productId] = entries;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'حدث خطأ غير متوقع أثناء تحميل متغيرات المنتج';
        log.error('Failed to fetch product variations from Salla', {
          merchantId,
          productId,
          error,
        });
        failed.push({ productId, message });
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return { variations, failed };
}
