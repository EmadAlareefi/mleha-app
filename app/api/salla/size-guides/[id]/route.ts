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

export async function GET(_request: NextRequest, context: RouteContext) {
  if (!(await authorize())) return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  const { id } = await context.params;
  const guide = await prisma.sallaSizeGuide.findUnique({ where: { id } });
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
    const existing = await prisma.sallaSizeGuide.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: 'دليل المقاسات غير موجود' }, { status: 404 });
    const data: Prisma.SallaSizeGuideUpdateInput = {};
    const targetProductId = productId('productId' in input ? input.productId : existing.productId);
    const rawDocument = 'data' in input ? input.data : existing.draftData;
    const optionId = rawDocument && typeof rawDocument === 'object' && !Array.isArray(rawDocument)
      ? String((rawDocument as Record<string, unknown>).sallaSizeOptionId || '') || null
      : null;
    const merchant = await resolveSallaMerchantId();
    if (!merchant.merchantId) throw new Error(merchant.error);
    const product = await loadSallaSizeGuideProduct(merchant.merchantId, {
      productId: targetProductId,
      optionId,
    });
    const validated = validateDocumentAgainstSallaProduct(rawDocument, product);

    data.sku = product.sku;
    data.skuKey = sizeGuideSkuKey(product.sku);
    data.productId = product.id;
    data.productName = product.name;
    data.productImageUrl = product.imageUrl;
    data.draftData = json(validated.data);
    data.validationIssues = json(validated.issues);
    data.hasIssues = validated.issues.length > 0;

    const audit = sizeGuideAudit(session.user);
    data.updatedById = audit.id;
    data.updatedByName = audit.name;
    data.updatedByUsername = audit.username;
    const guide = await prisma.sallaSizeGuide.update({ where: { id }, data });
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
