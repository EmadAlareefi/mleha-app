import { Prisma } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import {
  MAX_PRODUCT_REVIEWS_PER_BATCH,
  parseProductId,
  parseProductReviewCreate,
  PRODUCT_REVIEW_SERVICE_KEY,
} from '@/app/lib/salla-product-reviews';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

async function authorize() {
  const session = await getServerSession(authOptions);
  return { session, allowed: hasServiceAccess(session, PRODUCT_REVIEW_SERVICE_KEY) };
}

function positiveInteger(value: string | null, fallback: number, maximum: number) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

export async function GET(request: NextRequest) {
  const { allowed } = await authorize();
  if (!allowed) return NextResponse.json({ error: 'غير مصرح لك بإدارة التقييمات' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const productIdParam = searchParams.get('productId');
  let productId: string | undefined;
  try {
    productId = productIdParam ? parseProductId(productIdParam) : undefined;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'رقم المنتج غير صحيح' }, { status: 400 });
  }

  const page = positiveInteger(searchParams.get('page'), 1, 100_000);
  const perPage = positiveInteger(searchParams.get('perPage'), 50, 100);
  const published = searchParams.get('published');
  const query = searchParams.get('q')?.trim().slice(0, 120);

  const where: Prisma.SallaProductReviewWhereInput = {
    ...(productId ? { productId } : {}),
    ...(published === 'true' ? { isPublished: true } : published === 'false' ? { isPublished: false } : {}),
    ...(query
      ? {
          OR: [
            { productName: { contains: query, mode: 'insensitive' } },
            { productSku: { contains: query, mode: 'insensitive' } },
            { reviewerName: { contains: query, mode: 'insensitive' } },
            { reviewerCity: { contains: query, mode: 'insensitive' } },
            { body: { contains: query, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [reviews, total] = await Promise.all([
    prisma.sallaProductReview.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.sallaProductReview.count({ where }),
  ]);

  return NextResponse.json({
    success: true,
    reviews,
    pagination: { page, perPage, total, totalPages: Math.ceil(total / perPage) },
  });
}

export async function POST(request: NextRequest) {
  const { session, allowed } = await authorize();
  if (!allowed || !session?.user) {
    return NextResponse.json({ error: 'غير مصرح لك بإدارة التقييمات' }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => null);
    const values = body && typeof body === 'object' ? (body as Record<string, unknown>).reviews : null;
    if (!Array.isArray(values) || values.length === 0) throw new Error('أضف تقييماً واحداً على الأقل');
    if (values.length > MAX_PRODUCT_REVIEWS_PER_BATCH) {
      throw new Error(`الحد الأعلى للحفظ دفعة واحدة هو ${MAX_PRODUCT_REVIEWS_PER_BATCH} تقييم`);
    }

    const reviews = values.map(parseProductReviewCreate);
    const user = session.user as Record<string, unknown>;
    const audit = {
      createdById: typeof user.id === 'string' ? user.id : null,
      createdByName: typeof user.name === 'string' ? user.name : null,
      createdByUsername: typeof user.username === 'string' ? user.username : null,
      updatedById: typeof user.id === 'string' ? user.id : null,
      updatedByName: typeof user.name === 'string' ? user.name : null,
      updatedByUsername: typeof user.username === 'string' ? user.username : null,
    };

    const result = await prisma.$transaction(async (tx) =>
      tx.sallaProductReview.createMany({
        data: reviews.map((review) => ({ ...review, ...audit, isPublished: true })),
      })
    );

    return NextResponse.json({ success: true, count: result.count }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'تعذر حفظ التقييمات' },
      { status: 400 }
    );
  }
}
