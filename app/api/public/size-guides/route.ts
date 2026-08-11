import { NextRequest, NextResponse } from 'next/server';
import { corsHeaders, corsPreflight, resolveAllowedOrigin } from '@/app/lib/public-cors';
import { sizeGuideSkuCandidates, sizeGuideSkuKey } from '@/app/lib/salla-size-guides';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
const ALLOWED_METHODS = 'GET, OPTIONS';

export async function OPTIONS(request: NextRequest) {
  return corsPreflight(request, ALLOWED_METHODS);
}

function responseHeaders(origin: string | null) {
  return {
    ...corsHeaders(origin, ALLOWED_METHODS),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
}

export async function GET(request: NextRequest) {
  const origin = resolveAllowedOrigin(request);
  if (!origin) {
    return NextResponse.json(
      { success: false, error: 'origin_not_allowed' },
      { status: 403, headers: responseHeaders(null) }
    );
  }

  const productId = request.nextUrl.searchParams.get('productId')?.trim().slice(0, 32) || '';
  const rawSku = request.nextUrl.searchParams.get('sku')?.trim().slice(0, 120) || '';
  if (!productId && !rawSku) {
    return NextResponse.json(
      { success: false, error: 'product_identifier_required' },
      { status: 400, headers: responseHeaders(origin) }
    );
  }

  let guide = productId
    ? await prisma.sallaSizeGuide.findFirst({
        where: {
          OR: [
            { productId },
            { productLinks: { some: { productId } } },
          ],
        },
      })
    : null;
  let explicitUnpublished = Boolean(guide && !guide.publishedAt);
  if (explicitUnpublished) guide = null;

  if (!guide && !explicitUnpublished && rawSku) {
    const exactKey = sizeGuideSkuKey(rawSku);
    const exact = exactKey
      ? await prisma.sallaSizeGuide.findUnique({ where: { skuKey: exactKey } })
      : null;
    if (exact?.publishedAt) {
      guide = exact;
    } else if (exact) {
      explicitUnpublished = true;
    } else {
      const derived = sizeGuideSkuCandidates(rawSku).filter((candidate) => candidate !== exactKey);
      if (derived.length) {
        const matches = await prisma.sallaSizeGuide.findMany({
          where: { skuKey: { in: derived }, publishedAt: { not: null } },
          take: 2,
        });
        if (matches.length === 1) guide = matches[0];
      }
    }
  }

  if (explicitUnpublished || !guide?.publishedData || !guide.publishedAt) {
    return NextResponse.json(
      { success: false, error: 'size_guide_not_found' },
      { status: 404, headers: responseHeaders(origin) }
    );
  }

  const matchedProductLink = productId
    ? await prisma.sallaSizeGuideProductLink.findUnique({
        where: { productId },
        select: { productName: true },
      })
    : null;

  return NextResponse.json(
    {
      success: true,
      guide: {
        id: guide.id,
        sku: guide.sku,
        productId: productId || guide.productId,
        productName: matchedProductLink?.productName || guide.productName,
        data: guide.publishedData,
        publishedAt: guide.publishedAt,
      },
    },
    { headers: responseHeaders(origin) }
  );
}
