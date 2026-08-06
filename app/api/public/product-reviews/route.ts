import { NextRequest, NextResponse } from 'next/server';
import { corsHeaders, corsPreflight, resolveAllowedOrigin } from '@/app/lib/public-cors';
import { parseProductId } from '@/app/lib/salla-product-reviews';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

const ALLOWED_METHODS = 'GET, OPTIONS';

export async function OPTIONS(request: NextRequest) {
  return corsPreflight(request, ALLOWED_METHODS);
}

export async function GET(request: NextRequest) {
  const origin = resolveAllowedOrigin(request);
  if (!origin) {
    return NextResponse.json(
      { success: false, error: 'origin_not_allowed' },
      { status: 403, headers: { ...corsHeaders(null, ALLOWED_METHODS), 'Cache-Control': 'no-store' } }
    );
  }

  try {
    const productId = parseProductId(new URL(request.url).searchParams.get('productId'));
    const reviews = await prisma.sallaProductReview.findMany({
      where: { productId, isPublished: true },
      orderBy: [{ createdAt: 'desc' }],
      select: {
        id: true,
        reviewerName: true,
        reviewerCity: true,
        body: true,
        rating: true,
        isVerifiedPurchase: true,
        reviewImageData: true,
        createdAt: true,
      },
    });

    const publicReviews = reviews.map(({ reviewImageData, ...review }) => ({
      ...review,
      reviewImageUrl: reviewImageData
        ? `${request.nextUrl.origin}/api/public/product-reviews/${encodeURIComponent(review.id)}/image`
        : null,
    }));

    return NextResponse.json(
      { success: true, reviews: publicReviews },
      {
        headers: {
          ...corsHeaders(origin, ALLOWED_METHODS),
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'تعذر تحميل التقييمات' },
      {
        status: 400,
        headers: { ...corsHeaders(origin, ALLOWED_METHODS), 'Cache-Control': 'no-store' },
      }
    );
  }
}
