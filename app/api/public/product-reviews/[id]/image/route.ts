import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

const IMAGE_DATA_PATTERN = /^data:(image\/(?:jpeg|png|webp));base64,([a-z0-9+/]+={0,2})$/i;

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const review = await prisma.sallaProductReview.findFirst({
    where: { id, isPublished: true },
    select: { reviewImageData: true },
  });
  const match = review?.reviewImageData?.match(IMAGE_DATA_PATTERN);
  if (!match) return new NextResponse(null, { status: 404 });

  return new NextResponse(Buffer.from(match[2], 'base64'), {
    headers: {
      'Cache-Control': 'public, max-age=300',
      'Content-Type': match[1].toLowerCase(),
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
