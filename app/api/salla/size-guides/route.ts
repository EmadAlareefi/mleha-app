import { Prisma } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import {
  sizeGuideAudit,
  sizeGuideSkuKey,
  SIZE_GUIDE_SERVICE_KEY,
} from '@/app/lib/salla-size-guides';
import {
  loadSallaSizeGuideProduct,
  SallaSizeGuideError,
  validateDocumentAgainstSallaProduct,
} from '@/app/lib/salla-size-guide-server';
import { resolveSallaMerchantId } from '@/app/api/salla/products/merchant';
import { sizeGuideProductLinkData } from '@/app/lib/salla-size-guide-links';
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

function parseProductId(value: unknown): string {
  const productId = String(value ?? '').trim().slice(0, 32);
  if (productId && !/^\d+$/.test(productId)) throw new Error('رقم منتج سلة غير صالح');
  if (!productId) throw new Error('اختر منتجاً من سلة');
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
  const link = params.get('link');
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
            { productLinks: { some: {
              OR: [
                { productId: { contains: query, mode: 'insensitive' } },
                { sku: { contains: query, mode: 'insensitive' } },
                { productName: { contains: query, mode: 'insensitive' } },
              ],
            } } },
          ],
        }
      : {}),
    ...(link === 'linked'
      ? { productLinks: { some: {} } }
      : link === 'unlinked'
        ? { productId: null, productLinks: { none: {} } }
        : {}),
  };

  const [guides, total, allTotal, linked, published, drafts, review, issueDocuments] = await Promise.all([
    prisma.sallaSizeGuide.findMany({
      where,
      orderBy: [{ hasIssues: 'desc' }, { updatedAt: 'desc' }],
      skip: (page - 1) * perPage,
      take: perPage,
      include: { productLinks: { orderBy: { sku: 'asc' } } },
    }),
    prisma.sallaSizeGuide.count({ where }),
    prisma.sallaSizeGuide.count(),
    prisma.sallaSizeGuide.count({ where: { productLinks: { some: {} } } }),
    prisma.sallaSizeGuide.count({ where: { publishedAt: { not: null } } }),
    prisma.sallaSizeGuide.count({ where: { publishedAt: null } }),
    prisma.sallaSizeGuide.count({ where: { hasIssues: true } }),
    prisma.sallaSizeGuide.findMany({
      where: { hasIssues: true },
      select: { validationIssues: true },
    }),
  ]);
  const missingFit = issueDocuments.filter((entry) =>
    Array.isArray(entry.validationIssues) && entry.validationIssues.some((issue) =>
      Boolean(issue && typeof issue === 'object' && 'code' in issue && issue.code === 'missing_fit_measurements')
    )
  ).length;

  return NextResponse.json({
    success: true,
    guides,
    pagination: { page, perPage, total, totalPages: Math.ceil(total / perPage) },
    summary: { total: allTotal, linked, published, drafts, review, missingFit },
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
    const productId = parseProductId(input.productId);
    const merchant = await resolveSallaMerchantId();
    if (!merchant.merchantId) throw new Error(merchant.error);
    const optionId = input.data && typeof input.data === 'object'
      ? String((input.data as Record<string, unknown>).sallaSizeOptionId || '') || null
      : null;
    const product = await loadSallaSizeGuideProduct(merchant.merchantId, { productId, optionId });
    const productLink = sizeGuideProductLinkData(product);
    const validated = validateDocumentAgainstSallaProduct(input.data, product);
    const audit = sizeGuideAudit(session.user);

    const guide = await prisma.sallaSizeGuide.create({
      data: {
        sku: product.sku,
        skuKey: sizeGuideSkuKey(product.sku),
        productId: product.id,
        productName: product.name,
        productImageUrl: product.imageUrl,
        productLinks: { create: productLink },
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
      include: { productLinks: { orderBy: { sku: 'asc' } } },
    });
    return NextResponse.json({ success: true, guide, canPublish: validated.canPublish }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'تعذر إنشاء دليل المقاسات',
        ...(error instanceof SallaSizeGuideError ? { code: error.code, details: error.details } : {}),
      },
      { status: error instanceof SallaSizeGuideError && error.code === 'salla_sizes_changed' ? 409 : 400 }
    );
  }
}
