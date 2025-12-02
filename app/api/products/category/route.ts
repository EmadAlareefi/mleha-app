import { NextRequest, NextResponse } from 'next/server';
import { getSallaProduct } from '@/app/lib/salla-api';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

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
