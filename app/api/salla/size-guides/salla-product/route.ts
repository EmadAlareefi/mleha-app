import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import { getSallaProductBySku, getSallaProductDetails } from '@/app/lib/salla-api';
import { extractSallaSizeOptions } from '@/app/lib/salla-size-guide-products';
import { SIZE_GUIDE_SERVICE_KEY } from '@/app/lib/salla-size-guides';
import { resolveSallaMerchantId } from '@/app/api/salla/products/merchant';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !hasServiceAccess(session, SIZE_GUIDE_SERVICE_KEY)) {
    return NextResponse.json({ error: 'غير مصرح لك بإدارة أدلة المقاسات' }, { status: 403 });
  }

  try {
    const productIdParam = request.nextUrl.searchParams.get('productId')?.trim();
    const sku = request.nextUrl.searchParams.get('sku')?.trim();
    const optionId = request.nextUrl.searchParams.get('optionId')?.trim();
    const resolved = await resolveSallaMerchantId();
    if (!resolved.merchantId) throw new Error(resolved.error);

    let productId: string | number | undefined = productIdParam || undefined;
    if (!productId && sku) {
      const match = await getSallaProductBySku(resolved.merchantId, sku);
      if (!match) return NextResponse.json({ error: 'لم يتم العثور على منتج مطابق في سلة' }, { status: 404 });
      productId = match.id;
    }
    if (!productId) return NextResponse.json({ error: 'رقم المنتج أو SKU مطلوب' }, { status: 400 });

    const product = await getSallaProductDetails(resolved.merchantId, productId);
    if (!product.sku?.trim()) {
      return NextResponse.json({ error: 'منتج سلة لا يحتوي على SKU' }, { status: 422 });
    }
    const resolution = extractSallaSizeOptions(product.options);
    const selected = optionId
      ? resolution.matches.find((option) => option.id === optionId) || null
      : resolution.selected;

    return NextResponse.json({
      success: true,
      product: {
        id: String(product.id),
        sku: product.sku.trim(),
        name: product.name,
        imageUrl: product.imageUrl || null,
      },
      sizeOptions: resolution.matches,
      sizeOption: selected,
      requiresOptionSelection: resolution.matches.length > 1 && !selected,
      sizeOptionError: resolution.matches.length === 0
        ? 'لم يتم العثور على خيار المقاس في منتج سلة'
        : selected?.values.length === 0
          ? 'خيار المقاس في سلة لا يحتوي على قيم'
          : null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'تعذر تحميل المنتج من سلة' },
      { status: 500 }
    );
  }
}
