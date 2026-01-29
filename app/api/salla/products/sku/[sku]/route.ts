import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { getSallaProductBySku, searchSallaProductsBySku } from '@/app/lib/salla-api';
import { resolveSallaMerchantId } from '@/app/api/salla/products/merchant';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sku: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json(
      { error: 'يجب تسجيل الدخول للوصول إلى بيانات المنتجات' },
      { status: 401 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const requestedMerchant = searchParams.get('merchantId');
    const resolved = await resolveSallaMerchantId(requestedMerchant);

    if (!resolved.merchantId) {
      return NextResponse.json(
        { error: resolved.error || 'لا يوجد متجر مرتبط بسلة حالياً.' },
        { status: requestedMerchant ? 404 : 503 }
      );
    }

    const { sku: skuParam } = await params;
    const rawSku = skuParam ?? '';
    let decodedSku = rawSku;
    try {
      decodedSku = decodeURIComponent(rawSku);
    } catch {
      decodedSku = rawSku;
    }
    const sku = decodedSku.trim();

    if (!sku) {
      return NextResponse.json(
        { error: 'يرجى تمرير رمز SKU صالح في رابط الطلب' },
        { status: 400 }
      );
    }

    const product = await getSallaProductBySku(resolved.merchantId, sku).catch(() => null);

    if (!product) {
      const fallbackMatches = await searchSallaProductsBySku(resolved.merchantId, sku, {
        perPage: 50,
        maxResults: 5,
      });
      if (fallbackMatches.length === 0) {
        return NextResponse.json(
          { error: `لا يوجد منتج في سلة بهذا الرمز (${sku})` },
          { status: 404 }
        );
      }
      const bestMatch = fallbackMatches[0];
      return NextResponse.json({
        success: true,
        product: bestMatch,
        merchantId: resolved.merchantId,
        fallbackMatches,
      });
    }

    return NextResponse.json({
      success: true,
      product,
      merchantId: resolved.merchantId,
    });
  } catch (error) {
    log.error('Failed to load Salla product by SKU', { error });
    const message =
      error instanceof Error ? error.message : 'تعذر تحميل بيانات المنتج من سلة';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
