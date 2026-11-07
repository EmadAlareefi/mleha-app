import { NextRequest, NextResponse } from 'next/server';
import { getSallaProduct } from '@/app/lib/salla-api';
import { log } from '@/app/lib/logger';
import { isRateLimited } from '@/app/lib/returns/public-rate-limit';

export const runtime = 'nodejs';

const STORE_MERCHANT_ID = process.env.NEXT_PUBLIC_MERCHANT_ID || '1696031053';

/**
 * GET /api/products/category?merchantId=XXX&productId=YYY
 *
 * Gets the category for a specific product
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const merchantId = searchParams.get('merchantId');
    const productId = searchParams.get('productId');

    if (!merchantId || !productId) {
      return NextResponse.json(
        { error: 'merchantId and productId are required' },
        { status: 400 }
      );
    }

    // Public (the customer returns page uses it): only proxy our own store,
    // and keep one client from hammering Salla through us.
    if (merchantId !== STORE_MERCHANT_ID) {
      return NextResponse.json({ error: 'Unknown merchant' }, { status: 400 });
    }
    if (isRateLimited(request, 'product-category', 120)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    log.info('Fetching product category', { merchantId, productId });

    const product = await getSallaProduct(merchantId, productId);

    if (!product) {
      return NextResponse.json(
        { error: 'Product not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      category: product.category,
      categories: product.categories,
    });

  } catch (error) {
    log.error('Error fetching product category', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء جلب تصنيف المنتج' },
      { status: 500 }
    );
  }
}
