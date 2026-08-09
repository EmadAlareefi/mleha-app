import { Prisma } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import {
  optionalSizeGuideText,
  parseSizeGuideDocument,
  parseSizeGuideSku,
  sizeGuideAudit,
  SIZE_GUIDE_SERVICE_KEY,
  validateSizeGuideDocument,
} from '@/app/lib/salla-size-guides';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

async function authorize() {
  const session = await getServerSession(authOptions);
  return { session, allowed: hasServiceAccess(session, SIZE_GUIDE_SERVICE_KEY) };
}

function positiveInteger(value: string | null, fallback: number, maximum: number) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function parseProductId(value: unknown): string | null {
  const productId = optionalSizeGuideText(value, 32);
  if (productId && !/^\d+$/.test(productId)) throw new Error('رقم منتج سلة غير صالح');
  return productId;
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export async function GET(request: NextRequest) {
  const { allowed } = await authorize();
  if (!allowed) return NextResponse.json({ error: 'غير مصرح لك بإدارة أدلة المقاسات' }, { status: 403 });

  const params = request.nextUrl.searchParams;
  const page = positiveInteger(params.get('page'), 1, 100_000);
  const perPage = positiveInteger(params.get('perPage'), 40, 100);
  const status = params.get('status');
  const query = params.get('q')?.trim().slice(0, 120);

  const where: Prisma.SallaSizeGuideWhereInput = {
    ...(status === 'published'
      ? { publishedAt: { not: null } }
      : status === 'draft'
        ? { publishedAt: null }
        : status === 'issues'
          ? { hasIssues: true }
          : {}),
    ...(query
      ? {
          OR: [
            { sku: { contains: query, mode: 'insensitive' } },
            { productId: { contains: query, mode: 'insensitive' } },
            { productName: { contains: query, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [guides, total] = await Promise.all([
    prisma.sallaSizeGuide.findMany({
      where,
      orderBy: [{ hasIssues: 'desc' }, { updatedAt: 'desc' }],
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.sallaSizeGuide.count({ where }),
  ]);

  return NextResponse.json({
    success: true,
    guides,
    pagination: { page, perPage, total, totalPages: Math.ceil(total / perPage) },
  });
}

export async function POST(request: NextRequest) {
  const { session, allowed } = await authorize();
  if (!allowed || !session?.user) {
    return NextResponse.json({ error: 'غير مصرح لك بإدارة أدلة المقاسات' }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') throw new Error('بيانات دليل المقاسات غير صالحة');
    const input = body as Record<string, unknown>;
    const { sku, skuKey } = parseSizeGuideSku(input.sku);
    const validated = validateSizeGuideDocument(parseSizeGuideDocument(input.data));
    const audit = sizeGuideAudit(session.user);

    const guide = await prisma.sallaSizeGuide.create({
      data: {
        sku,
        skuKey,
        productId: parseProductId(input.productId),
        productName: optionalSizeGuideText(input.productName, 250),
        productImageUrl: optionalSizeGuideText(input.productImageUrl, 500),
        draftData: json(validated.data),
        validationIssues: json(validated.issues),
        hasIssues: validated.issues.length > 0,
        createdById: audit.id,
        createdByName: audit.name,
        createdByUsername: audit.username,
        updatedById: audit.id,
        updatedByName: audit.name,
        updatedByUsername: audit.username,
      },
    });
    return NextResponse.json({ success: true, guide, canPublish: validated.canPublish }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'تعذر إنشاء دليل المقاسات' },
      { status: 400 }
    );
  }
}
