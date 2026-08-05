import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import {
  parseRating,
  parseReviewImageData,
  parseReviewText,
  PRODUCT_REVIEW_SERVICE_KEY,
} from '@/app/lib/salla-product-reviews';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

async function authorizedSession() {
  const session = await getServerSession(authOptions);
  return hasServiceAccess(session, PRODUCT_REVIEW_SERVICE_KEY) ? session : null;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const session = await authorizedSession();
  if (!session?.user) return NextResponse.json({ error: 'غير مصرح لك بإدارة التقييمات' }, { status: 403 });

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'بيانات التحديث غير صالحة' }, { status: 400 });
  }

  try {
    const input = body as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    if ('reviewerName' in input) data.reviewerName = parseReviewText(input.reviewerName, 'reviewerName');
    if ('reviewerCity' in input) data.reviewerCity = parseReviewText(input.reviewerCity, 'reviewerCity');
    if ('body' in input) data.body = parseReviewText(input.body, 'body');
    if ('reviewImageData' in input) data.reviewImageData = parseReviewImageData(input.reviewImageData);
    if ('rating' in input) data.rating = parseRating(input.rating);
    if ('isPublished' in input) {
      if (typeof input.isPublished !== 'boolean') throw new Error('حالة النشر غير صالحة');
      data.isPublished = input.isPublished;
    }
    if (Object.keys(data).length === 0) throw new Error('لا توجد تغييرات للحفظ');

    const user = session.user as Record<string, unknown>;
    Object.assign(data, {
      updatedById: typeof user.id === 'string' ? user.id : null,
      updatedByName: typeof user.name === 'string' ? user.name : null,
      updatedByUsername: typeof user.username === 'string' ? user.username : null,
    });

    const review = await prisma.sallaProductReview.update({ where: { id }, data });
    return NextResponse.json({ success: true, review });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'تعذر تحديث التقييم' },
      { status: 400 }
    );
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const session = await authorizedSession();
  if (!session) return NextResponse.json({ error: 'غير مصرح لك بإدارة التقييمات' }, { status: 403 });

  const { id } = await context.params;
  try {
    await prisma.sallaProductReview.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'تعذر حذف التقييم أو أنه غير موجود' }, { status: 404 });
  }
}
