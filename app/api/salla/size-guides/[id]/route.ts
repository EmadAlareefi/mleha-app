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
import {
  isSizeGuideProductFamilySku,
  sharedSizeGuideFamilySku,
  sizeGuideProductLinkData,
  sizeGuideProductsShareSizes,
} from '@/app/lib/salla-size-guide-links';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
type RouteContext = { params: Promise<{ id: string }> };

async function authorize() {
  const session = await getServerSession(authOptions);
  return hasServiceAccess(session, SIZE_GUIDE_SERVICE_KEY) ? session : null;
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function productId(value: unknown): string {
  const parsed = String(value ?? '').trim().slice(0, 32);
  if (parsed && !/^\d+$/.test(parsed)) throw new Error('رقم منتج سلة غير صالح');
  if (!parsed) throw new Error('اختر منتجاً من سلة');
  return parsed;
}

function productIds(primary: unknown, values: unknown): string[] {
  const raw = [primary, ...(Array.isArray(values) ? values : [])];
  const ids = Array.from(new Set(raw.map(productId)));
  if (ids.length > 30) throw new Error('يمكن ربط 30 منتجاً كحد أقصى في المرة الواحدة');
  return ids;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  if (!(await authorize())) return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  const { id } = await context.params;
  const guide = await prisma.sallaSizeGuide.findUnique({
    where: { id },
    include: { productLinks: { orderBy: { sku: 'asc' } } },
  });
  return guide
    ? NextResponse.json({ success: true, guide })
    : NextResponse.json({ error: 'دليل المقاسات غير موجود' }, { status: 404 });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const session = await authorize();
  if (!session?.user) return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  const { id } = await context.params;

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') throw new Error('بيانات التحديث غير صالحة');
    const input = body as Record<string, unknown>;
    const existing = await prisma.sallaSizeGuide.findUnique({
      where: { id },
      include: { productLinks: true },
    });
    if (!existing) return NextResponse.json({ error: 'دليل المقاسات غير موجود' }, { status: 404 });
    const data: Prisma.SallaSizeGuideUpdateInput = {};
    const targetProductIds = productIds(
      'productId' in input ? input.productId : existing.productId,
      input.productIds
    );
    const rawDocument = 'data' in input ? input.data : existing.draftData;
    const optionId = rawDocument && typeof rawDocument === 'object' && !Array.isArray(rawDocument)
      ? String((rawDocument as Record<string, unknown>).sallaSizeOptionId || '') || null
      : null;
    const merchant = await resolveSallaMerchantId();
    if (!merchant.merchantId) throw new Error(merchant.error);
    const products = await Promise.all(targetProductIds.map((entry, index) => loadSallaSizeGuideProduct(
      merchant.merchantId,
      { productId: entry, optionId: index === 0 ? optionId : null }
    )));
    const product = products[0];
    const incompatible = products.slice(1).find((candidate) => !sizeGuideProductsShareSizes(product, candidate));
    if (incompatible) throw new Error(`مقاسات المنتج ${incompatible.sku} لا تطابق مقاسات المنتج الأساسي ${product.sku}`);
    const occupied = await prisma.sallaSizeGuideProductLink.findMany({
      where: { productId: { in: targetProductIds }, guideId: { not: id } },
      select: { sku: true },
    });
    if (occupied.length) throw new Error(`يوجد دليل مقاسات آخر مرتبط بالمنتج ${occupied[0].sku}`);
    const validated = validateDocumentAgainstSallaProduct(rawDocument, product);
    const selectedLink = existing.productLinks.find((entry) => entry.productId === product.id);
    const replacingLinks = Array.isArray(input.productIds);
    const combinedSkus = replacingLinks
      ? products.map((entry) => entry.sku)
      : Array.from(new Map([
          ...existing.productLinks.map((entry) => [entry.productId, entry.sku] as const),
          ...products.map((entry) => [entry.id, entry.sku] as const),
        ]).values());
    const sharedFamilySku = sharedSizeGuideFamilySku(combinedSkus);
    const preserveFamilySku = Boolean(
      selectedLink && (
        existing.productLinks.length > 1 ||
        isSizeGuideProductFamilySku(existing.sku, selectedLink.sku)
      )
    );

    const guideSku = sharedFamilySku || (preserveFamilySku ? existing.sku : product.sku);
    data.sku = guideSku;
    data.skuKey = sizeGuideSkuKey(guideSku);
    data.productId = product.id;
    data.productName = product.name;
    data.productImageUrl = product.imageUrl;
    data.productLinks = {
      ...(replacingLinks ? { deleteMany: { productId: { notIn: targetProductIds } } } : {}),
      upsert: products.map((entry) => {
        const link = sizeGuideProductLinkData(entry);
        return { where: { productId: entry.id }, create: link, update: link };
      }),
    };
    data.draftData = json(validated.data);
    data.validationIssues = json(validated.issues);
    data.hasIssues = validated.issues.length > 0;

    const audit = sizeGuideAudit(session.user);
    data.updatedById = audit.id;
    data.updatedByName = audit.name;
    data.updatedByUsername = audit.username;
    const guide = await prisma.sallaSizeGuide.update({
      where: { id },
      data,
      include: { productLinks: { orderBy: { sku: 'asc' } } },
    });
    return NextResponse.json({ success: true, guide, canPublish: validated.canPublish });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'تعذر تحديث دليل المقاسات',
        ...(error instanceof SallaSizeGuideError ? { code: error.code, details: error.details } : {}),
      },
      { status: error instanceof SallaSizeGuideError && error.code === 'salla_sizes_changed' ? 409 : 400 }
    );
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  if (!(await authorize())) return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  const { id } = await context.params;
  try {
    await prisma.sallaSizeGuide.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'تعذر حذف الدليل أو أنه غير موجود' }, { status: 404 });
  }
}
