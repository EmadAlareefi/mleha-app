import { Prisma } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import {
  parseSizeGuideDocument,
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

export async function POST(_request: Request, context: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !hasServiceAccess(session, SIZE_GUIDE_SERVICE_KEY)) {
    return NextResponse.json({ error: 'غير مصرح لك بنشر أدلة المقاسات' }, { status: 403 });
  }
  const { id } = await context.params;
  const existing = await prisma.sallaSizeGuide.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'دليل المقاسات غير موجود' }, { status: 404 });

  try {
    if (!existing.productId) throw new SallaSizeGuideError('اربط الدليل بمنتج سلة قبل النشر', 'product_id_required');
    const document = parseSizeGuideDocument(existing.draftData);
    const merchant = await resolveSallaMerchantId();
    if (!merchant.merchantId) throw new Error(merchant.error);
    const product = await loadSallaSizeGuideProduct(merchant.merchantId, {
      productId: existing.productId,
      optionId: document.sallaSizeOptionId,
    });
    const validated = validateDocumentAgainstSallaProduct(document, product);
    if (!validated.canPublish) {
      return NextResponse.json(
        { error: 'صحح أخطاء الدليل قبل النشر', issues: validated.issues },
        { status: 400 }
      );
    }
    const audit = sizeGuideAudit(session.user);
    const guide = await prisma.sallaSizeGuide.update({
      where: { id },
      data: {
        sku: product.sku,
        skuKey: sizeGuideSkuKey(product.sku),
        productName: product.name,
        productImageUrl: product.imageUrl,
        draftData: validated.data as unknown as Prisma.InputJsonValue,
        publishedData: validated.data as unknown as Prisma.InputJsonValue,
        validationIssues: validated.issues as unknown as Prisma.InputJsonValue,
        hasIssues: validated.issues.length > 0,
        publishedAt: new Date(),
        publishedById: audit.id,
        publishedByName: audit.name,
        publishedByUsername: audit.username,
      },
    });
    return NextResponse.json({ success: true, guide });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'تعذر نشر دليل المقاسات',
        ...(error instanceof SallaSizeGuideError ? { code: error.code, details: error.details } : {}),
      },
      { status: error instanceof SallaSizeGuideError && error.code === 'salla_sizes_changed' ? 409 : 400 }
    );
  }
}
