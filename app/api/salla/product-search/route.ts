import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import {
  getSallaProductBySku,
  getSallaProductVariations,
  listSallaProducts,
  searchSallaProductsBySku,
  type SallaProductSummary,
  type SallaProductVariation,
} from '@/app/lib/salla-api';
import { log } from '@/app/lib/logger';
import { resolveSallaMerchantId } from '@/app/api/salla/products/merchant';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

const MAX_PRODUCTS = 20;

function normalizeText(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function dedupeProducts(products: Array<SallaProductSummary | null | undefined>) {
  const seen = new Set<number>();
  const result: SallaProductSummary[] = [];
  for (const product of products) {
    if (!product || !Number.isFinite(product.id) || seen.has(product.id)) {
      continue;
    }
    seen.add(product.id);
    result.push(product);
    if (result.length >= MAX_PRODUCTS) {
      break;
    }
  }
  return result;
}

async function fetchVariations(merchantId: string, products: SallaProductSummary[]) {
  const entries = await Promise.allSettled(
    products.map(async (product) => ({
      productId: product.id,
      variations: await getSallaProductVariations(merchantId, product.id),
    }))
  );

  const variations: Record<number, SallaProductVariation[]> = {};
  const failed: Array<{ productId: number; message: string }> = [];

  entries.forEach((entry) => {
    if (entry.status === 'fulfilled') {
      variations[entry.value.productId] = entry.value.variations;
    } else {
      log.warn('Product search could not load variations', { error: entry.reason });
    }
  });

  products.forEach((product) => {
    if (!variations[product.id]) {
      variations[product.id] = Array.isArray(product.variations) ? product.variations : [];
      if (variations[product.id].length === 0) {
        failed.push({ productId: product.id, message: 'تعذر تحميل متغيرات المنتج' });
      }
    }
  });

  return { variations, failed };
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'يجب تسجيل الدخول' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const query = normalizeText(searchParams.get('q'));
    const requestedMerchant = searchParams.get('merchantId');

    if (!query) {
      return NextResponse.json({ error: 'يرجى إدخال اسم المنتج أو SKU' }, { status: 400 });
    }

    const resolved = await resolveSallaMerchantId(requestedMerchant);
    if (!resolved.merchantId) {
      return NextResponse.json(
        { error: resolved.error || 'لا يوجد متجر مرتبط بسلة.' },
        { status: requestedMerchant ? 404 : 503 }
      );
    }

    const [exactProduct, skuMatches, keywordResult] = await Promise.all([
      getSallaProductBySku(resolved.merchantId, query).catch(() => null),
      searchSallaProductsBySku(resolved.merchantId, query, {
        perPage: 50,
        maxResults: MAX_PRODUCTS,
      }).catch(() => []),
      listSallaProducts(resolved.merchantId, {
        page: 1,
        perPage: MAX_PRODUCTS,
        keyword: query,
      }).catch(() => ({ products: [] as SallaProductSummary[], pagination: null })),
    ]);

    const products = dedupeProducts([
      exactProduct,
      ...skuMatches,
      ...keywordResult.products,
    ]);

    if (products.length === 0) {
      return NextResponse.json({
        success: true,
        merchantId: resolved.merchantId,
        query,
        products: [],
        variationErrors: [],
      });
    }

    const productIds = products.map((product) => product.id);
    const { variations, failed } = await fetchVariations(resolved.merchantId, products);

    const purchaseRequests = await prisma.sallaPurchaseRequest.findMany({
      where: {
        productId: { in: productIds },
        status: { in: ['requested', 'on_the_way'] },
      },
      orderBy: [{ requestedAt: 'desc' }],
    });

    const requestsByProductId = new Map<number, typeof purchaseRequests>();
    purchaseRequests.forEach((purchaseRequest) => {
      requestsByProductId.set(purchaseRequest.productId, [
        ...(requestsByProductId.get(purchaseRequest.productId) ?? []),
        purchaseRequest,
      ]);
    });

    const enrichedProducts = products.map((product) => {
      const productRequests = requestsByProductId.get(product.id) ?? [];
      const requestedQuantity = productRequests
        .filter((entry) => entry.status === 'requested')
        .reduce((sum, entry) => sum + entry.quantity, 0);
      const onTheWayQuantity = productRequests
        .filter((entry) => entry.status === 'on_the_way')
        .reduce((sum, entry) => sum + entry.quantity, 0);

      return {
        product: {
          ...product,
          variations: variations[product.id] ?? product.variations ?? [],
        },
        stats: {
          requestedQuantity,
          onTheWayQuantity,
          activePurchaseRequests: productRequests.length,
        },
        purchaseRequests: productRequests,
      };
    });

    return NextResponse.json({
      success: true,
      merchantId: resolved.merchantId,
      query,
      products: enrichedProducts,
      variationErrors: failed,
    });
  } catch (error) {
    log.error('Failed to search Salla products with order context', { error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'تعذر البحث عن المنتجات' },
      { status: 500 }
    );
  }
}
